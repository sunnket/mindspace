import { useCanvasStore } from '@/store/canvasStore';

/**
 * Gravity — a lightweight physics layer. Two entry points:
 *  - runAutoCluster(): a one-shot force-directed simulation that springs a
 *    messy board into an organized graph (connectors = springs, cards repel),
 *    then freezes. Committed as a single undo step; final positions broadcast.
 *  - momentumGlide(): flick physics after a drag release — the card slides,
 *    decelerates with friction, and softly bumps to rest against neighbours.
 *
 * Both write positions directly to the store during animation (no per-frame
 * collab flood) and commit once at the end. The rAF loops end themselves when
 * the motion settles, so there's no idle CPU cost.
 */

let clusterRunning = false;

export function runAutoCluster() {
  if (clusterRunning) return;
  const store = useCanvasStore.getState();
  const nodes = store.objects.filter((o) => !o.style?.isMinimized && o.type !== 'frame');
  if (nodes.length < 2) return;

  clusterRunning = true;

  const pos = new Map(nodes.map((n) => [n.id, { x: n.x + n.width / 2, y: n.y + n.height / 2 }]));
  const before = new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
  const vel = new Map([...pos.keys()].map((id) => [id, { x: 0, y: 0 }]));
  const adj = store.connections.filter((c) => pos.has(c.fromId) && pos.has(c.toId));

  let cx = 0, cy = 0;
  pos.forEach((p) => { cx += p.x; cy += p.y; });
  cx /= nodes.length; cy /= nodes.length;

  const REPULSE = 120000;
  const SPRING = 0.02;
  const IDEAL = 260;
  const CENTER = 0.008;
  const DAMP = 0.86;
  const DURATION = 1500;
  const start = performance.now();

  const tick = (now: number) => {
    const t = (now - start) / DURATION;
    const ids = [...pos.keys()];
    const force = new Map(ids.map((id) => [id, { x: 0, y: 0 }]));

    for (let i = 0; i < ids.length; i++) {
      const a = pos.get(ids[i])!;
      for (let j = i + 1; j < ids.length; j++) {
        const b = pos.get(ids[j])!;
        let dx = a.x - b.x, dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) { d2 = 1; dx = Math.random() - 0.5; dy = Math.random() - 0.5; }
        const d = Math.sqrt(d2);
        const rep = REPULSE / d2;
        const fx = (dx / d) * rep, fy = (dy / d) * rep;
        force.get(ids[i])!.x += fx; force.get(ids[i])!.y += fy;
        force.get(ids[j])!.x -= fx; force.get(ids[j])!.y -= fy;
      }
      force.get(ids[i])!.x += (cx - a.x) * CENTER;
      force.get(ids[i])!.y += (cy - a.y) * CENTER;
    }

    for (const c of adj) {
      const a = pos.get(c.fromId)!, b = pos.get(c.toId)!;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 1;
      const f = (d - IDEAL) * SPRING;
      const fx = (dx / d) * f, fy = (dy / d) * f;
      force.get(c.fromId)!.x += fx; force.get(c.fromId)!.y += fy;
      force.get(c.toId)!.x -= fx; force.get(c.toId)!.y -= fy;
    }

    for (const id of ids) {
      const v = vel.get(id)!, p = pos.get(id)!, f = force.get(id)!;
      v.x = (v.x + f.x) * DAMP; v.y = (v.y + f.y) * DAMP;
      v.x = Math.max(-70, Math.min(70, v.x)); v.y = Math.max(-70, Math.min(70, v.y));
      p.x += v.x; p.y += v.y;
    }

    const cur = useCanvasStore.getState().objects;
    useCanvasStore.setState({
      objects: cur.map((o) => {
        const p = pos.get(o.id);
        return p ? { ...o, x: p.x - o.width / 2, y: p.y - o.height / 2 } : o;
      }),
      isDirty: true,
    });

    if (t < 1) requestAnimationFrame(tick);
    else finish();
  };

  const finish = () => {
    clusterRunning = false;
    const cur = useCanvasStore.getState().objects;
    const bulk = [...before.keys()]
      .map((id) => {
        const o = cur.find((x) => x.id === id);
        return o ? { id, before: before.get(id)!, after: { x: o.x, y: o.y } } : null;
      })
      .filter((b): b is { id: string; before: { x: number; y: number }; after: { x: number; y: number } } => !!b);
    useCanvasStore.getState().pushUndo({ type: 'bulk-move', bulk });
    // Persist + broadcast final resting positions once each.
    const updateObject = useCanvasStore.getState().updateObject;
    bulk.forEach((b) => updateObject(b.id, { x: b.after.x, y: b.after.y }));
  };

  requestAnimationFrame(tick);
}

const gliding = new Set<string>();

/** Flick physics: glide an object with friction, softly settling on contact. */
export function momentumGlide(id: string, vx: number, vy: number) {
  if (gliding.has(id)) return;
  if (Math.hypot(vx, vy) < 1.2) return;
  gliding.add(id);

  const FRICTION = 0.9;
  let v = { x: vx, y: vy };

  const step = () => {
    const st = useCanvasStore.getState();
    const obj = st.objects.find((o) => o.id === id);
    if (!obj || Math.hypot(v.x, v.y) < 0.4) {
      gliding.delete(id);
      if (obj) st.updateObject(id, { x: obj.x, y: obj.y }); // commit + broadcast final
      return;
    }
    const nx = obj.x + v.x;
    const ny = obj.y + v.y;

    // Soft collision: if the next spot overlaps a neighbour, bleed off velocity.
    let bumped = false;
    for (const o of st.objects) {
      if (o.id === id || o.style?.isMinimized || o.type === 'frame' || o.type === 'arrow') continue;
      if (nx < o.x + o.width && nx + obj.width > o.x && ny < o.y + o.height && ny + obj.height > o.y) {
        bumped = true;
        break;
      }
    }
    if (bumped) { v.x *= -0.25; v.y *= -0.25; }
    else { v.x *= FRICTION; v.y *= FRICTION; }

    useCanvasStore.setState({
      objects: st.objects.map((o) => (o.id === id ? { ...o, x: nx, y: ny } : o)),
      isDirty: true,
    });
    requestAnimationFrame(step);
  };

  requestAnimationFrame(step);
}
