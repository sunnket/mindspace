'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { v4 as uuidv4 } from 'uuid';
import { useCanvasStore } from '@/store/canvasStore';
import { CanvasObjectData } from '@/lib/db';
import { Occupancy, rectOf, isBackdrop, settle, fitFrame } from '@/lib/canvasLayout';
import { extractUrl, newLinkCard, linkPreviewStyle, normalizeUrl, LINK_CARD_SIZE } from '@/lib/linkPreview';

interface Action {
  type:
    | 'CREATE_OBJECT'
    | 'UPDATE_OBJECT'
    | 'DELETE_OBJECT'
    | 'CREATE_CONNECTION'
    | 'DELETE_CONNECTION'
    | 'CREATE_STROKE'
    | 'CREATE_SCENE';
  tempId?: string;
  id?: string;
  fromId?: string;
  toId?: string;
  connectionId?: string;
  objData?: Partial<CanvasObjectData>;
  updates?: Partial<CanvasObjectData>;
  style?: Record<string, unknown>;
  // CREATE_STROKE
  points?: number[][];
  color?: string;
  size?: number;
  isHighlighter?: boolean;
  // CREATE_SCENE
  name?: string;
  notes?: string;
  x?: number;
  y?: number;
  zoom?: number;
  log?: string;
}

/** Downscale an image data URL for the vision model (keeps payload small so the
 *  NIM inline-image limit is respected). Falls back to the original on failure. */
function downscaleImage(dataUrl: string, max = 768, quality = 0.6): Promise<string> {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(dataUrl);
        ctx.drawImage(img, 0, 0, w, h);
        try {
          resolve(canvas.toDataURL('image/jpeg', quality));
        } catch {
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    } catch {
      resolve(dataUrl);
    }
  });
}

const IMAGE_TASK_RE =
  /\b(caption|captions|describe|description|alt[\s-]?text|title|analy[sz]e|summari[sz]e|transcribe|what(?:'s| is| does)?[^.]*\b(image|picture|photo|pic|screenshot))\b|\b(this|the|my)\s+(image|picture|photo|pic|screenshot)\b/i;

/** Is this task about an image the user placed? */
function isImageTask(text: string): boolean {
  return IMAGE_TASK_RE.test(text || '');
}

const StopIcon = ({ size = 9 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <rect x="4" y="4" width="16" height="16" rx="3" />
  </svg>
);

/**
 * Incrementally extracts complete action objects from a streaming JSON string.
 * The model emits { "actions": [ {..}, {..} ], "planDescription": ".." } and we
 * fire each action the instant its closing brace arrives — so blocks appear on
 * the canvas while the model is still writing the rest of the plan.
 */
function makeActionScanner(onAction: (a: Action) => void) {
  let buf = '';
  let started = false; // found the actions [
  let done = false;    // hit the closing ] of actions
  let i = 0;
  let depth = 0;
  let inStr = false;
  let esc = false;
  let objStart = -1;

  return (chunk: string) => {
    if (done) { buf += chunk; return; }
    buf += chunk;

    if (!started) {
      const key = buf.indexOf('"actions"');
      if (key === -1) return;
      const br = buf.indexOf('[', key);
      if (br === -1) return;
      i = br + 1;
      started = true;
    }

    for (; i < buf.length; i++) {
      const c = buf[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') { inStr = true; continue; }
      if (c === '{') { if (depth === 0) objStart = i; depth++; }
      else if (c === '}') {
        depth--;
        if (depth === 0 && objStart >= 0) {
          const slice = buf.slice(objStart, i + 1);
          try { onAction(JSON.parse(slice) as Action); } catch { /* skip malformed */ }
          objStart = -1;
        }
      } else if (c === ']' && depth === 0) {
        done = true;
        return;
      }
    }
  };
}


/**
 * Guaranteed local build. When every model is unreachable we still put something
 * useful on the canvas from the prompt alone, so the agent NEVER produces nothing.
 */
function localFallbackActions(prompt: string, context: string | undefined, x: number, y: number): Action[] {
  const source = (context && context.trim()) ? context : prompt;
  const title = prompt.trim().replace(/\s+/g, ' ').slice(0, 60).replace(/^./, (c) => c.toUpperCase());

  const actions: Action[] = [{
    type: 'CREATE_OBJECT', tempId: 'fb_h',
    objData: { type: 'heading', x, y, width: 440, height: 60, content: title || 'New note', style: {} },
    log: 'Adding a heading...',
  }];

  // Split the source into list-ish items
  const items = source
    .split(/\n|;|(?:,\s)|(?:\d+[.)]\s)|(?:[-*•]\s)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1 && s.toLowerCase() !== prompt.trim().toLowerCase())
    .slice(0, 8);

  if (items.length >= 2) {
    const todo = items.map((t, idx) => ({ id: String(idx + 1), text: t.slice(0, 120), done: false }));
    actions.push({
      type: 'CREATE_OBJECT', tempId: 'fb_todo',
      objData: {
        type: 'card', x, y: y + 84, width: 320, height: 300,
        content: JSON.stringify(todo),
        style: { isTodo: true, todoTitle: title || 'Checklist' },
      },
      log: 'Turning it into a checklist...',
    });
  } else {
    const palette = ['#FEF3C7', '#F3E8FF', '#ECFDF5'];
    const notes = (source.match(/[^.!?\n]+[.!?]?/g) || [source]).map((s) => s.trim()).filter(Boolean).slice(0, 3);
    notes.forEach((note, idx) => {
      actions.push({
        type: 'CREATE_OBJECT', tempId: `fb_s${idx}`,
        objData: {
          type: 'sticky', x: x + idx * 224, y: y + 84, width: 200, height: 160,
          content: note.slice(0, 180), style: { color: palette[idx % palette.length] },
        },
        log: 'Adding a note...',
      });
    });
  }
  return actions;
}

export default function AgentOverlay() {
  const agentLogs = useCanvasStore((s) => s.agentLogs);
  const agentStatus = useCanvasStore((s) => s.agentStatus);
  const setAgentState = useCanvasStore((s) => s.setAgentState);

  const [expanded, setExpanded] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const runningRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [agentLogs, expanded]);

  const handleStop = () => {
    runningRef.current = false;
    abortRef.current?.abort();
    setAgentState({ agentRunning: false, agentStatus: 'idle', agentLogs: [] });
  };

  const runAgent = useCallback(async (
    promptText: string, keyIdx: number, customX?: number, customY?: number, refContext?: string,
    filesContextArg?: string, briefArg?: string, modeArg?: string,
  ) => {
    if (!promptText.trim() || runningRef.current) return;

    const store = useCanvasStore.getState();
    const { camera } = store;
    runningRef.current = true;

    const startX = customX ?? (-camera.x + window.innerWidth / 2) / camera.zoom;
    const startY = customY ?? (-camera.y + window.innerHeight / 2) / camera.zoom;

    setAgentState({ agentRunning: true, agentStatus: 'running', agentLogs: ['[Agent] Working...'] });

    const addLog = (line: string) => {
      const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      setAgentState({ agentLogs: [...useCanvasStore.getState().agentLogs, `[${ts}] ${line}`] });
    };
    const live = () => useCanvasStore.getState();

    // Snapshot the canvas level the user is looking at
    const stack = store.canvasStack;
    const activeParent = stack.length > 0
      ? stack[stack.length - 1]
      : (store.urlCanvasId === 'root' ? undefined : store.urlCanvasId);
    const visibleObjects = store.objects.filter((o) => o.parentId === activeParent && !o.style?.isMinimized);
    const visibleIds = new Set(visibleObjects.map((o) => o.id));
    const visibleConnections = store.connections.filter((c) => visibleIds.has(c.fromId) && visibleIds.has(c.toId));

    // Gather text from any File blocks the user dropped so the agent can read
    // them. Use an explicit arg (the file card's "Ask AI" button) if given;
    // otherwise pull from the selected file, else the file(s) nearest to where
    // the agent was invoked. Cap the total so we never blow the model context.
    const FILES_BUDGET = 26_000;
    let filesContext = (filesContextArg || '').slice(0, FILES_BUDGET);
    if (!filesContext) {
      const fileBlocks = visibleObjects.filter(
        (o) => o.style?.isFile && typeof o.style?.fileText === 'string' && (o.style.fileText as string).trim()
      );
      if (fileBlocks.length) {
        const selected = store.selectedId ? fileBlocks.find((o) => o.id === store.selectedId) : undefined;
        const ordered = selected
          ? [selected, ...fileBlocks.filter((o) => o.id !== selected.id)]
          : [...fileBlocks].sort(
              (a, b) => Math.hypot(a.x - startX, a.y - startY) - Math.hypot(b.x - startX, b.y - startY)
            );
        const parts: string[] = [];
        let budget = FILES_BUDGET;
        for (const f of ordered) {
          if (budget <= 200) break;
          const nm = (f.style?.fileName as string) || 'file';
          const body = (f.style?.fileText as string).slice(0, budget - 40);
          const chunk = `FILE: ${nm}\n${body}`;
          parts.push(chunk);
          budget -= chunk.length + 4;
        }
        filesContext = parts.join('\n\n---\n\n');
      }
    }

    // --- shared execution state ---
    const idMap: Record<string, string> = {};
    const resolveId = (id?: string) => (id ? (idMap[id] || id) : '');
    let executed = 0;

    /* --- collision-free layout ---------------------------------------------
       The model supplies layout INTENT (columns, rows, structure); the CLIENT
       guarantees nothing overlaps. This is deterministic on purpose: no amount
       of prompting makes a language model reliably solve 2D packing against
       auto-growing text, so we never trust its coordinates as final.

       Occupancy is keyed by object id (see canvasLayout.Occupancy) so MOVING a
       block updates its footprint instead of leaving a ghost at the old spot —
       and every rect uses the block's MEASURED rendered height, not the nominal
       one it was stored with. Those two facts are what let "organize my canvas"
       (a pile of UPDATE_OBJECT moves) come out clean.

       Frames are backdrops: they neither block nor get pushed, so framed items
       stay inside their frame.

       The whole new build is shifted as one block via `placeOffset`, preserving
       the model's relative structure, then any residual overlap is resolved by
       pushing down. */
    const occupancy = new Occupancy(visibleObjects);
    /** Everything the agent touched — the only blocks the settle pass may move. */
    const touched = new Set<string>();
    let placeOffset: { dx: number; dy: number } | null = null;

    // Collision-free position for a NEW object. Space is reserved by the caller
    // once the object exists and has a real id (so the rect can be re-keyed if
    // the block is later moved).
    const placeFor = (objData: Partial<CanvasObjectData>): { x: number; y: number } => {
      const ix = Math.round(Number(objData.x) || 0);
      const iy = Math.round(Number(objData.y) || 0);

      // Anchor the build: the first block decides how far the WHOLE plan shifts
      // to reach free space, so the model's internal spacing survives intact.
      if (placeOffset === null) {
        const anchor = occupancy.resolveDown(rectOf(objData));
        placeOffset = { dx: anchor.x - ix, dy: anchor.y - iy };
      }

      const shifted = { ...objData, x: ix + placeOffset.dx, y: iy + placeOffset.dy };
      if (isBackdrop(shifted)) return { x: shifted.x, y: shifted.y };

      const free = occupancy.resolveDown(rectOf(shifted));
      return { x: free.x, y: free.y };
    };

    /* Reposition an EXISTING object. This is the path "organize / tidy / group
       this" takes, and until now it wrote the model's raw coordinates straight
       to the store with no collision check at all — which is exactly how blocks
       landed on top of each other during a reorganize. Now a move is packed
       against everything else, using real heights. */
    const moveTo = (obj: CanvasObjectData, next: Partial<CanvasObjectData>): { x: number; y: number } => {
      const merged = { ...obj, ...next };
      occupancy.remove(obj.id); // vacate the old spot before re-packing
      const free = occupancy.resolveDown(rectOf(merged), obj.id);
      occupancy.setRect(obj.id, free);
      return { x: free.x, y: free.y };
    };

    let panned = false;
    const gentlePan = (o: { x: number; y: number; width: number; height: number }) => {
      // Bring the work into view WITHOUT changing zoom (no zoom in/out).
      if (panned) return;
      panned = true;
      const cam = live().camera;
      const cx = o.x + o.width / 2;
      const cy = o.y + o.height / 2;
      const screenX = cx * cam.zoom + cam.x;
      const screenY = cy * cam.zoom + cam.y;
      const off = screenX < 40 || screenY < 40 || screenX > window.innerWidth - 40 || screenY > window.innerHeight - 40;
      if (off) {
        live().animateCamera({ x: window.innerWidth / 2 - cx * cam.zoom, y: window.innerHeight / 2 - cy * cam.zoom, zoom: cam.zoom }, 450);
      }
    };

    const isHttpUrl = (s: unknown): s is string => typeof s === 'string' && /^https?:\/\//i.test(s);

    // Fetch a real photo for an image block and drop it in once it resolves, so
    // the agent can actually SHOW things from the web. Non-blocking.
    const resolveImage = async (id: string, query: string) => {
      try {
        const r = await fetch(`/api/image-search?q=${encodeURIComponent(query)}`, { signal: abortRef.current?.signal });
        if (!r.ok) return;
        const j = await r.json();
        if (j?.url && runningRef.current) live().updateObject(id, { content: j.url });
      } catch { /* leave the placeholder */ }
    };

    // Geocode a place name and turn the block into a live map centered on it.
    const resolveMap = async (id: string, query: string) => {
      try {
        const r = await fetch(`/api/geocode?q=${encodeURIComponent(query)}&limit=1`, { signal: abortRef.current?.signal });
        if (!r.ok) return;
        const j = await r.json();
        const p = j?.results?.[0];
        if (p && runningRef.current) {
          const existing = live().objects.find((o) => o.id === id);
          live().updateObject(id, {
            content: p.name || p.label || query,
            style: { ...existing?.style, isMap: true, mapLat: p.lat, mapLng: p.lng, mapLabel: p.label, mapName: p.name, mapBbox: p.bbox, mapKind: p.kind },
          });
        }
      } catch { /* leave the block as-is */ }
    };

    // GENERATE a real image with a strong diffusion model and drop it in once it
    // resolves. Stored as a data URL so it persists with the board. Non-blocking.
    const resolveGenImage = async (id: string, prompt: string, style?: string) => {
      try {
        const q = `/api/image-generate?q=${encodeURIComponent(prompt)}${style ? `&style=${encodeURIComponent(style)}` : ''}`;
        const r = await fetch(q, { signal: abortRef.current?.signal });
        if (!r.ok) return;
        const blob = await r.blob();
        if (!/^image\//i.test(blob.type)) return;
        const dataUrl = await new Promise<string>((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(fr.result as string);
          fr.onerror = rej;
          fr.readAsDataURL(blob);
        });
        if (runningRef.current) live().updateObject(id, { content: dataUrl });
      } catch { /* leave the placeholder */ }
    };

    const runAction = (action: Action) => {
      try {
        switch (action.type) {
          case 'CREATE_OBJECT': {
            if (!action.objData) break;

            /* The embedded browser is the USER'S tool — they open it from the
               toolbar. The agent must never spawn one: asking it for links should
               hand back link cards, not hijack the canvas with a live browser.
               The prompt forbids it, but a prompt is not a guarantee, so any
               "browser" the model still asks for is rewritten into a link card
               here. Its URL is the one thing worth keeping. */
            let od: Partial<CanvasObjectData> = action.objData;
            if (od.type === 'browser') {
              const target = extractUrl(String(od.content || ''));
              if (!target) break; // a browser with no URL has nothing worth keeping
              const title = od.style?.linkTitle as string | undefined;
              od = {
                ...newLinkCard(target, Number(od.x) || 0, Number(od.y) || 0),
                style: { ...linkPreviewStyle(target), ...(title ? { linkTitle: title } : {}) },
              };
            }

            /* A link card the model wrote by hand carries only isLinkPreview +
               linkUrl (+ maybe a title). Fold in the real link-card style so the
               URL is normalized — the model routinely drops the scheme, and
               "youtube.com/watch?v=X" is not a fetchable target — and so the
               card starts in its loading state and hydrates its own thumbnail.
               The model's title/description survive as placeholders until the
               real metadata lands. */
            if (od.type === 'card' && od.style?.isLinkPreview && od.style?.linkUrl) {
              const raw = String(od.style.linkUrl);
              od = {
                ...od,
                width: Number(od.width) || LINK_CARD_SIZE.width,
                height: Number(od.height) || LINK_CARD_SIZE.height,
                style: { ...od.style, ...linkPreviewStyle(raw) },
              };
            }

            const pos = placeFor(od);
            const style = (od.style || {}) as Record<string, unknown>;
            const isImg = od.type === 'image';
            // Images: keep a real URL as-is. Otherwise decide GENERATE (AI makes a
            // new picture) vs SEARCH (fetch a real photo from the web), blank the
            // content now and resolve it asynchronously.
            const genPrompt = isImg && !isHttpUrl(od.content)
              ? ((style.imagePrompt as string) || (style.generate ? (style.imageQuery as string) || od.content || '' : ''))
              : '';
            const wantsGen = isImg && Boolean(genPrompt && (style.generate || style.imagePrompt));
            const imageQuery = isImg && !wantsGen && !isHttpUrl(od.content)
              ? ((style.imageQuery as string) || od.content || '')
              : '';
            const startContent = isImg && !isHttpUrl(od.content) ? '' : (od.content || '');
            const spawned = live().addObject({
              type: od.type,
              x: pos.x, y: pos.y,
              width: od.width, height: od.height,
              content: startContent,
              style,
            });
            if (action.tempId) idMap[action.tempId] = spawned.id;
            // Reserve its footprint under the REAL id, so if a later action moves
            // this block the old rect is vacated instead of haunting the board.
            occupancy.set(spawned);
            touched.add(spawned.id);
            // Kick off async media resolution (image generate / search / geocoding).
            if (wantsGen && genPrompt.trim()) {
              void resolveGenImage(spawned.id, genPrompt.trim(), style.imageStyle as string | undefined);
            } else if (imageQuery.trim()) {
              void resolveImage(spawned.id, imageQuery.trim());
            }
            if (od.type === 'card' && style.isMap && !style.mapLat && typeof style.mapQuery === 'string' && style.mapQuery.trim()) {
              void resolveMap(spawned.id, (style.mapQuery as string).trim());
            }
            executed++;
            gentlePan({ x: pos.x, y: pos.y, width: Number(od.width) || 200, height: Number(od.height) || 100 });
            break;
          }
          case 'UPDATE_OBJECT': {
            const targetId = resolveId(action.id);
            const updates = action.updates || action.objData;
            if (!targetId || !updates) break;
            const existing = live().objects.find((o) => o.id === targetId);
            if (!existing) break;

            const merged: Partial<CanvasObjectData> = {
              ...updates,
              style: updates.style ? { ...existing.style, ...updates.style } : existing.style,
            };

            // A MOVE (this is what "organize / tidy / group my canvas" is made
            // of) gets packed against the rest of the board, with real heights,
            // exactly like a new block would. The model's coordinates are its
            // INTENT — the ordering and grouping it wants — not the last word on
            // where the block physically lands.
            const wantsMove = updates.x !== undefined || updates.y !== undefined;
            if (wantsMove && !isBackdrop(existing)) {
              const pos = moveTo(existing, merged);
              merged.x = pos.x;
              merged.y = pos.y;
            } else if (wantsMove) {
              merged.x = Math.round(Number(updates.x ?? existing.x));
              merged.y = Math.round(Number(updates.y ?? existing.y));
            }

            live().updateObject(targetId, merged);
            touched.add(targetId);
            // Content or size changed → the block's real footprint changed too.
            if (!wantsMove) occupancy.set({ ...existing, ...merged });
            executed++;
            break;
          }
          case 'DELETE_OBJECT': {
            const targetId = resolveId(action.id);
            if (targetId && live().objects.some((o) => o.id === targetId)) {
              live().removeObject(targetId);
              occupancy.remove(targetId); // its space is free again
              touched.delete(targetId);
              executed++;
            }
            break;
          }
          case 'CREATE_CONNECTION': {
            const fromId = resolveId(action.fromId);
            const toId = resolveId(action.toId);
            const objs = live().objects;
            if (fromId && toId && objs.some((o) => o.id === fromId) && objs.some((o) => o.id === toId)) {
              live().addConnection(fromId, toId, action.style || {});
              executed++;
            }
            break;
          }
          case 'DELETE_CONNECTION': {
            const connId = action.connectionId || action.id;
            if (connId) { live().removeConnection(connId); executed++; }
            break;
          }
          case 'CREATE_STROKE': {
            const raw = Array.isArray(action.points) ? action.points : [];
            const dx = placeOffset?.dx || 0;
            const dy = placeOffset?.dy || 0;
            const pts = raw
              .filter((p) => Array.isArray(p) && p.length >= 2 && isFinite(Number(p[0])) && isFinite(Number(p[1])))
              .map((p) => [Number(p[0]) + dx, Number(p[1]) + dy, 0.5]);
            if (pts.length >= 2) {
              live().addStroke({
                id: uuidv4(),
                points: pts,
                color: (action.color as string) || '#2D2A26',
                size: Math.max(1, Number(action.size) || 4),
                isHighlighter: Boolean(action.isHighlighter),
                createdAt: Date.now(),
              });
              executed++;
              const xs = pts.map((p) => p[0]);
              const ys = pts.map((p) => p[1]);
              const minX = Math.min(...xs), minY = Math.min(...ys);
              gentlePan({ x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY });
            }
            break;
          }
          case 'CREATE_SCENE': {
            const zoom = Math.min(2, Math.max(0.15, Number(action.zoom) || 0.8));
            const cx = isFinite(Number(action.x)) ? Number(action.x) : startX;
            const cy = isFinite(Number(action.y)) ? Number(action.y) : startY;
            live().addSceneWithCamera(action.name || `Scene ${live().scenes.length + 1}`, {
              x: window.innerWidth / 2 - cx * zoom,
              y: window.innerHeight / 2 - cy * zoom,
              zoom,
            }, undefined, action.notes);
            executed++;
            break;
          }
        }
        if (action.log) addLog(action.log);
      } catch (e) {
        console.warn('[Agent] action failed', e);
      }
    };

    /* --- final settle -------------------------------------------------------
       The last word on layout. Everything above packs blocks using ESTIMATED
       heights, because a block's true height isn't knowable until it has
       rendered. By now it has: React has committed, every text/heading/sticky
       has measured itself through the ResizeObserver in CanvasObject and grown
       to its real size.

       So re-run the de-overlap against those real measurements and fix whatever
       the estimate got wrong. Only blocks the agent itself touched may move —
       the user's untouched work never shifts under them. Then re-fit any frame
       the agent drew so its backdrop still contains its (now taller) contents.

       This is what makes "no text over text" a guarantee rather than a hope. */
    const settleLayout = () => {
      if (touched.size === 0) return;

      // Two frames out: let the store commit and the ResizeObservers report the
      // heights of anything that just grew.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const state = useCanvasStore.getState();
        const board = state.objects.filter(
          (o) => o.parentId === activeParent && !o.style?.isMinimized
        );

        const moves = settle(board, touched);
        for (const m of moves) state.updateObject(m.id, { x: m.x, y: m.y });

        if (moves.length) {
          console.debug(`[Agent] settle: nudged ${moves.length} block(s) clear of an overlap`);
        }

        // Re-fit the agent's frames around their (settled, real-height) contents.
        const after = useCanvasStore.getState().objects.filter(
          (o) => o.parentId === activeParent && !o.style?.isMinimized
        );
        for (const frame of after) {
          if (frame.type !== 'frame' || !touched.has(frame.id)) continue;
          const inside = after.filter(
            (o) =>
              o.id !== frame.id &&
              o.type !== 'frame' &&
              o.x >= frame.x - 24 &&
              o.y >= frame.y - 24 &&
              o.x < frame.x + frame.width + 24 &&
              o.y < frame.y + frame.height + 24
          );
          const fit = fitFrame(frame, inside);
          if (fit) useCanvasStore.getState().updateObject(frame.id, fit);
        }
      }));
    };

    const finishSuccess = () => {
      settleLayout();
      addLog('[Success] Done.');
      setAgentState({ agentStatus: 'success', agentRunning: false });
      runningRef.current = false;
      setTimeout(() => {
        if (useCanvasStore.getState().agentStatus === 'success') setAgentState({ agentStatus: 'idle', agentLogs: [] });
      }, 2200);
    };

    const runLocalFallback = () => {
      addLog('[Agent] Building offline...');
      localFallbackActions(promptText, refContext, startX, startY).forEach(runAction);
      finishSuccess();
    };

    try {
      const controller = new AbortController();
      abortRef.current = controller;

      // If the task is about an image the user placed, LOOK at it first so any
      // caption/description is grounded in what the picture actually shows.
      let visionContext: string | undefined;
      if (isImageTask(promptText)) {
        const isImg = (o?: CanvasObjectData) =>
          !!o && (o.type === 'image' || (typeof o.content === 'string' && o.content.startsWith('data:image')));
        const selected = store.selectedId ? live().objects.find((o) => o.id === store.selectedId) : undefined;
        let target: CanvasObjectData | undefined = isImg(selected) ? selected : undefined;
        if (!target) {
          const imgs = visibleObjects.filter(isImg);
          if (imgs.length) {
            target = imgs.reduce((best, o) =>
              Math.hypot(o.x - startX, o.y - startY) < Math.hypot(best.x - startX, best.y - startY) ? o : best
            );
          }
        }
        if (target && typeof target.content === 'string' && target.content.startsWith('data:image')) {
          addLog('[Agent] Looking at your image...');
          try {
            const small = await downscaleImage(target.content);
            const vres = await fetch('/api/vision', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ image: small }),
              signal: controller.signal,
            });
            if (vres.ok) {
              const vjson = await vres.json();
              if (vjson?.description) {
                visionContext = `Image at (x:${Math.round(target.x)}, y:${Math.round(target.y)}, ${Math.round(target.width)}x${Math.round(target.height)}) shows: ${vjson.description}`;
              }
            }
          } catch { /* vision is best-effort — proceed without it */ }
        }
        if (!runningRef.current) return;
      }

      // If the user pasted URL(s), CRAWL them so the agent works from the real
      // page — "read this", "summarize this docs page", "pull X from this link".
      let webContext: string | undefined;
      const urlsInPrompt = Array.from(
        new Set((promptText.match(/https?:\/\/[^\s)]+/gi) || []).map((u) => u.replace(/[.,]+$/, '')))
      ).slice(0, 3);
      if (urlsInPrompt.length) {
        addLog('[Agent] Reading the web…');
        const parts: string[] = [];
        for (const u of urlsInPrompt) {
          try {
            const r = await fetch(`/api/fetch-url?url=${encodeURIComponent(u)}`, { signal: controller.signal });
            if (r.ok) {
              const j = await r.json();
              if (j?.text) parts.push(`URL: ${j.url || u}\nTITLE: ${j.title || ''}\n${j.text}`);
            }
          } catch { /* skip a page that won't load */ }
        }
        if (parts.length) webContext = parts.join('\n\n----------\n\n').slice(0, 24_000);
        if (!runningRef.current) return;
      }

      // Memory pass: fetch facts about the user
      let memoriesContext: string | undefined;
      addLog('[Agent] Checking memory...');
      try {
        const memRes = await fetch('/api/agent/memory?action=get', { signal: controller.signal });
        if (memRes.ok) {
          const memJson = await memRes.json();
          if (memJson.success && memJson.memories && memJson.memories.length > 0) {
            memoriesContext = memJson.memories.map((m: any) => `- ${m.key}: ${m.value}`).join('\n');
          }
        }
      } catch { /* best effort */ }
      if (!runningRef.current) return;

      // Smart pre-passes based on prompt intent
      let searchContext: string | undefined;
      let weatherContext: string | undefined;
      let dictContext: string | undefined;
      let wikiContext: string | undefined;
      let newsContext: string | undefined;
      let youtubeContext: string | undefined;
      let quotesContext: string | undefined;
      let countryContext: string | undefined;
      let triviaContext: string | undefined;

      const pLower = promptText.toLowerCase();

      // Expanded web search triggers — catches way more natural language queries
      if (/\b(search|find|google|look up|who is|what is|how to|best|top|compare|vs|versus|recommend|review|list of|examples of|alternatives|how much|price|cost|where can i|when did|why does|which is)\b/i.test(pLower)) {
        addLog('[Agent] Searching the web...');
        try {
          const sRes = await fetch(`/api/web-search?q=${encodeURIComponent(promptText)}`, { signal: controller.signal });
          if (sRes.ok) {
            const sJson = await sRes.json();
            if (sJson.success && sJson.results?.length) {
              searchContext = sJson.results.map((r: any) => `URL: ${r.url}\nTITLE: ${r.title}\nSNIPPET: ${r.snippet}`).join('\n\n');
            }
          }
        } catch { /* best effort */ }
      }
      if (!runningRef.current) return;

      if (/\b(weather|temperature|forecast|climate|rain|snow|humidity|wind)\b/i.test(pLower)) {
        addLog('[Agent] Checking weather...');
        try {
          const match = promptText.match(/(?:in|at|for) ([a-zA-Z\s,]+)/i);
          const q = match ? match[1].trim() : promptText;
          const wRes = await fetch(`/api/weather?q=${encodeURIComponent(q)}`, { signal: controller.signal });
          if (wRes.ok) {
            const wJson = await wRes.json();
            if (!wJson.error) {
              weatherContext = `Location: ${wJson.location?.name}, ${wJson.location?.country}\nTemp: ${wJson.current?.temperature}${wJson.units?.temperature}, ${wJson.current?.condition}`;
            }
          }
        } catch { /* best effort */ }
      }
      if (!runningRef.current) return;

      if (/\b(meaning|define|definition|synonym|dictionary|antonym|word meaning)\b/i.test(pLower)) {
        addLog('[Agent] Looking up definition...');
        try {
          const match = promptText.match(/(?:define|meaning of|definition of|what does .* mean) ([a-zA-Z]+)/i);
          const w = match ? match[1].trim() : promptText.split(' ').pop() || '';
          const dRes = await fetch(`/api/dictionary?word=${encodeURIComponent(w)}`, { signal: controller.signal });
          if (dRes.ok) {
            const dJson = await dRes.json();
            if (dJson.success && dJson.results?.length) {
              dictContext = JSON.stringify(dJson.results, null, 2);
            }
          }
        } catch { /* best effort */ }
      }
      if (!runningRef.current) return;

      // Expanded Wikipedia triggers
      if (/\b(wiki|wikipedia|who is|who was|history of|biography|about|origin of|founded|inventor|discovery|explain .* concept)\b/i.test(pLower)) {
        addLog('[Agent] Querying Wikipedia...');
        try {
          const match = promptText.match(/(?:who is|who was|what is|history of|biography of|about|wikipedia|origin of|explain) ([a-zA-Z0-9\s]+)/i);
          const q = match ? match[1].trim() : promptText;
          const wikiRes = await fetch(`/api/wikipedia?q=${encodeURIComponent(q)}`, { signal: controller.signal });
          if (wikiRes.ok) {
            const wikiJson = await wikiRes.json();
            if (wikiJson.success) {
              wikiContext = `TITLE: ${wikiJson.title}\nSUMMARY: ${wikiJson.summary}\nURL: ${wikiJson.url}`;
            }
          }
        } catch { /* best effort */ }
      }
      if (!runningRef.current) return;

      // Expanded news triggers
      if (/\b(news|latest|breaking|headlines|update|recent|today|happening|current events|trending)\b/i.test(pLower)) {
        addLog('[Agent] Fetching latest news...');
        try {
          const match = promptText.match(/(?:news about|latest on|headlines for|update on|trending) ([a-zA-Z0-9\s]+)/i);
          const q = match ? match[1].trim() : undefined;
          const nRes = await fetch(`/api/news${q ? `?q=${encodeURIComponent(q)}` : ''}`, { signal: controller.signal });
          if (nRes.ok) {
            const nJson = await nRes.json();
            if (nJson.success && nJson.results?.length) {
              newsContext = nJson.results.map((r: any) => `URL: ${r.url}\nTITLE: ${r.title}\nSNIPPET: ${r.snippet}`).join('\n\n');
            }
          }
        } catch { /* best effort */ }
      }
      if (!runningRef.current) return;

      // Expanded YouTube triggers — also fire web search alongside for link redundancy
      if (/\b(youtube|video|song|music|listen to|watch|play|track|album|artist|singer|band|clip|trailer|mv|music video|remix|cover|live performance)\b/i.test(pLower)) {
        addLog('[Agent] Searching YouTube...');
        try {
          /* Hand the endpoint the prompt EXACTLY as the user wrote it, flagged as
             an instruction rather than a query — it distills the search terms
             itself.

             What used to happen here was a regex that stripped a list of stop
             words out of the prompt, which turned "bring me good youtube music
             links" into "bring good links". YouTube was then asked for that, and
             obligingly returned four videos about a bookmarking app — the exact
             board the user sent us a screenshot of. Words like "bring me",
             "youtube" and "links" describe the errand, not the music; deciding
             which words are which is a judgement call, so a model makes it. */
          const yRes = await fetch(
            `/api/youtube-search?q=${encodeURIComponent(promptText)}&intent=1&limit=5`,
            { signal: controller.signal }
          );
          if (yRes.ok) {
            const yJson = await yRes.json();
            if (yJson.success && yJson.results?.length) {
              if (yJson.query) addLog(`[Agent] Searching YouTube for "${yJson.query}"…`);
              // Hand over the title and channel too — with them the model writes a
              // Link Card that says what the video IS, instead of a naked URL.
              youtubeContext = yJson.results
                .map((r: { url: string; title: string; author: string }, i: number) =>
                  `Result ${i + 1}: ${r.url}\n  TITLE: ${r.title}\n  CHANNEL: ${r.author}`
                )
                .join('\n');
            }
          }
        } catch { /* best effort */ }
        // Also run a web search for links if we haven't already
        if (!searchContext) {
          try {
            const sRes = await fetch(`/api/web-search?q=${encodeURIComponent(promptText)}`, { signal: controller.signal });
            if (sRes.ok) {
              const sJson = await sRes.json();
              if (sJson.success && sJson.results?.length) {
                searchContext = sJson.results.map((r: any) => `URL: ${r.url}\nTITLE: ${r.title}\nSNIPPET: ${r.snippet}`).join('\n\n');
              }
            }
          } catch { /* best effort */ }
        }
      }
      if (!runningRef.current) return;

      // Quotes API
      if (/\b(quote|quotes|inspire|inspiration|motivation|motivational|words of wisdom|famous saying|wise words)\b/i.test(pLower)) {
        addLog('[Agent] Finding quotes...');
        try {
          const qRes = await fetch(`/api/quotes-search?limit=5`, { signal: controller.signal });
          if (qRes.ok) {
            const qJson = await qRes.json();
            if (qJson.success && qJson.results?.length) {
              quotesContext = qJson.results.map((q: { text: string; author: string }) => `"${q.text}" — ${q.author}`).join('\n\n');
            }
          }
        } catch { /* best effort */ }
      }
      if (!runningRef.current) return;

      // Country info API
      if (/\b(country|capital of|population of|flag of|currency of|language of|languages in|about .* country)\b/i.test(pLower)) {
        addLog('[Agent] Looking up country info...');
        try {
          const match = promptText.match(/(?:about|country|capital of|population of|flag of|currency of|language of|languages in) ([a-zA-Z\s]+)/i);
          const q = match ? match[1].trim() : promptText;
          const cRes = await fetch(`/api/country-info?q=${encodeURIComponent(q)}`, { signal: controller.signal });
          if (cRes.ok) {
            const cJson = await cRes.json();
            if (cJson.success && cJson.results?.length) {
              countryContext = cJson.results.map((c: Record<string, string>) => `${c.name} (${c.official})\nCapital: ${c.capital}\nPopulation: ${c.population}\nRegion: ${c.region}, ${c.subregion}\nLanguages: ${c.languages}\nCurrencies: ${c.currencies}\nArea: ${c.area}\nTimezones: ${c.timezones}`).join('\n\n');
            }
          }
        } catch { /* best effort */ }
      }
      if (!runningRef.current) return;

      // Trivia API
      if (/\b(trivia|quiz|fun fact|random fact|did you know|brain teaser)\b/i.test(pLower)) {
        addLog('[Agent] Getting trivia...');
        try {
          const tRes = await fetch(`/api/trivia?amount=5`, { signal: controller.signal });
          if (tRes.ok) {
            const tJson = await tRes.json();
            if (tJson.success && tJson.results?.length) {
              triviaContext = tJson.results.map((t: { question: string; correct_answer: string; category: string }) => `Q: ${t.question}\nA: ${t.correct_answer}\nCategory: ${t.category}`).join('\n\n');
            }
          }
        } catch { /* best effort */ }
      }
      if (!runningRef.current) return;

      const res = await fetch('/api/agent/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: promptText,
          apiKeyIndex: keyIdx,
          agentX: startX, agentY: startY,
          context: refContext,
          brief: briefArg,
          mode: modeArg,
          visionContext,
          webContext,
          memoriesContext,
          searchContext,
          weatherContext,
          dictContext,
          wikiContext,
          newsContext,
          youtubeContext,
          quotesContext,
          countryContext,
          triviaContext,
          filesContext: filesContext || undefined,
          canvas: {
            isDark: store.canvasBackground.dark,
            // Send the height each block ACTUALLY renders at, not the nominal one
            // it was stored with. A note created as height:120 that grew to 600px
            // of text has to look 600px tall to the model, or it plans the next
            // block 200px down — straight through the middle of the note.
            objects: visibleObjects.map((o) => ({
              id: o.id, type: o.type, x: o.x, y: o.y,
              width: o.width, height: Math.round(rectOf(o).h), content: o.content, style: o.style,
            })),
            connections: visibleConnections.map((c) => ({ id: c.id, fromId: c.fromId, toId: c.toId })),
          },
        }),
        signal: controller.signal,
      });

      if (!runningRef.current) return;

      // Non-streamed error response → guaranteed local build instead of failing
      if (!res.ok || !res.body) {
        runLocalFallback();
        return;
      }

      // Stream the plan; execute each action the instant it completes
      const scan = makeActionScanner((action) => { if (runningRef.current) runAction(action); });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullResponse = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!runningRef.current) { reader.cancel(); return; }
        const chunk = decoder.decode(value, { stream: true });
        fullResponse += chunk;
        scan(chunk);
      }

      if (!runningRef.current) return;

      // After streaming is done, process memory instructions & validate newly created links
      try {
        const payload = JSON.parse(fullResponse);
        
        /* 1. Link validation.
           This has never actually run. It matched on style.isLink (no link card
           has ever carried that flag — it's isLinkPreview), and then compared
           `vJson.status` against 'dead' when /api/link-validate returns no
           `status` field at all; it answers { valid, reason, platform }. So the
           condition was false every single time and a URL the model invented sat
           on the board looking perfectly real until you clicked it.

           Now every link card the agent creates is checked in parallel, and a
           dead one is flipped into the card's real error state — which says what
           went wrong and offers Open URL / Retry — rather than pretending. */
        const linkActions = (payload.actions || []).filter(
          (a: any) => a.type === 'CREATE_OBJECT' && a.objData?.style?.isLinkPreview && a.objData?.style?.linkUrl
        );

        await Promise.all(
          linkActions.map(async (action: any) => {
            const url = normalizeUrl(String(action.objData.style.linkUrl));
            if (!url) return;
            try {
              const vRes = await fetch(`/api/link-validate?url=${encodeURIComponent(url)}`);
              if (!vRes.ok) return;
              const vJson = await vRes.json();
              if (vJson.valid !== false) return;

              const createdObj = live().objects.find(
                (o) => o.style?.isLinkPreview && o.style?.linkUrl === url
              );
              if (!createdObj) return;

              addLog(`[Agent] Dropped a dead link: ${vJson.reason || 'unreachable'}`);
              live().updateObject(createdObj.id, {
                style: {
                  ...createdObj.style,
                  linkLoading: false,
                  linkResolved: true,
                  linkError: true,
                  linkErrorReason: vJson.reason || 'This link is broken',
                },
              });
            } catch { /* validation is best-effort — never block the build on it */ }
          })
        );

        // 2. Memory Processing
        if (payload.memories && Array.isArray(payload.memories)) {
          for (const mem of payload.memories) {
            if (mem.forget) {
              await fetch('/api/agent/memory', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'delete', key: mem.forget }),
              });
            } else if (mem.key && mem.value) {
              await fetch('/api/agent/memory', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'set', key: mem.key, value: mem.value, category: mem.category || 'fact' }),
              });
            }
          }
        }
      } catch (err) {
        console.warn('[Agent] Post-processing failed', err);
      }

      if (!runningRef.current) return;

      if (executed === 0) {
        // Model responded but produced nothing usable → still guarantee output
        runLocalFallback();
        return;
      }
      finishSuccess();
    } catch (err) {
      if (!runningRef.current) return; // user stopped
      console.error('[Agent]', err);
      // Never leave the canvas empty — fall back locally
      if (executed === 0) {
        runLocalFallback();
      } else {
        finishSuccess();
      }
    }
  }, [setAgentState]);

  // Inline "/agent <task>" launches arrive as run-agent window events
  useEffect(() => {
    const handleRunEvent = (e: Event) => {
      const ce = e as CustomEvent<{ prompt: string; apiKeyIndex?: number; x?: number; y?: number; context?: string; filesContext?: string; brief?: string; mode?: string }>;
      const { prompt: p, apiKeyIndex: ki, x, y, context, filesContext, brief, mode } = ce.detail;
      runAgent(p, ki ?? 0, x, y, context, filesContext, brief, mode);
    };
    window.addEventListener('run-agent', handleRunEvent);
    return () => window.removeEventListener('run-agent', handleRunEvent);
  }, [runAgent]);

  const latestLog = agentLogs.length > 0 ? agentLogs[agentLogs.length - 1] : '';
  const latestText = latestLog.replace(/^\[\d{2}:\d{2}:\d{2}(?:\s?[AP]M)?\]\s*/i, '');

  return (
    <AnimatePresence>
      {agentStatus !== 'idle' && (
        <motion.div
          className="fixed top-5 left-1/2 z-[250]"
          initial={{ y: -24, x: '-50%', opacity: 0 }}
          animate={{ y: 0, x: '-50%', opacity: 1 }}
          exit={{ y: -24, x: '-50%', opacity: 0 }}
          transition={{ type: 'spring', damping: 22, stiffness: 260 }}
        >
          <div
            className="flex flex-col rounded-full border border-white/10 shadow-lg overflow-hidden"
            style={{
              background: 'rgba(23, 20, 18, 0.88)',
              backdropFilter: 'blur(14px)',
              borderRadius: expanded ? 14 : 999,
              maxWidth: 420,
            }}
          >
            <div
              className="pl-3 pr-2 py-1.5 flex items-center gap-2.5 cursor-pointer select-none"
              onClick={() => setExpanded((v) => !v)}
              title="Click to see details"
            >
              <span className="relative shrink-0 flex items-center justify-center w-2 h-2">
                {agentStatus === 'running' && (
                  <span className="absolute inline-flex h-2 w-2 rounded-full bg-indigo-400 opacity-75 animate-ping" />
                )}
                <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${
                  agentStatus === 'running' ? 'bg-indigo-400' : agentStatus === 'success' ? 'bg-emerald-400' : 'bg-red-400'
                }`} />
              </span>

              <span className="text-[11px] text-zinc-200 font-light truncate max-w-[300px]">
                {agentStatus === 'failed' ? latestText || 'Agent failed' : latestText || 'Working...'}
              </span>

              {agentStatus === 'running' && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleStop(); }}
                  className="p-1 rounded-full text-zinc-500 hover:text-red-400 hover:bg-white/5 transition-colors cursor-pointer border-none bg-transparent flex items-center"
                  title="Stop agent"
                >
                  <StopIcon size={9} />
                </button>
              )}
            </div>

            <AnimatePresence>
              {expanded && (
                <motion.div
                  className="border-t border-white/5 bg-black/30 overflow-hidden"
                  initial={{ height: 0 }}
                  animate={{ height: 120 }}
                  exit={{ height: 0 }}
                >
                  <div className="px-3 py-2 h-full overflow-y-auto font-mono text-[9px] text-zinc-400 flex flex-col gap-0.5 text-left select-text">
                    {agentLogs.map((log, idx) => {
                      let color = 'text-zinc-500';
                      if (log.includes('[Success]')) color = 'text-emerald-400';
                      else if (log.includes('[Failure]') || log.includes('[Error]')) color = 'text-red-400';
                      else if (log.includes('[Agent]')) color = 'text-indigo-400';
                      return <div key={idx} className={color}>{log}</div>;
                    })}
                    <div ref={logEndRef} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
