'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { v4 as uuidv4 } from 'uuid';
import { useCanvasStore } from '@/store/canvasStore';
import { CanvasObjectData } from '@/lib/db';

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

interface Rect { x: number; y: number; w: number; h: number; }

// Relocation breathing room. Only applied when a block is actually moved to
// clear a genuine overlap — near-but-not-touching layouts are left untouched.
const PACK_GAP = 52;

/** True only on a genuine overlap (a few px of real intersection), so the
 *  model's intended spacing between adjacent cards is preserved. */
function rectsOverlap(a: Rect, b: Rect): boolean {
  const tol = 6;
  return (
    a.x + tol < b.x + b.w && b.x + tol < a.x + a.w &&
    a.y + tol < b.y + b.h && b.y + tol < a.y + a.h
  );
}

/** The model reports a nominal height, but text/heading/sticky blocks auto-grow
 *  to fit their content when rendered. Estimate the real height so neighbours
 *  reserve enough vertical room and don't get written over. */
function packHeight(objData: Partial<CanvasObjectData>): number {
  const base = Number(objData.height) || 100;
  const t = objData.type;
  if (t === 'heading' || t === 'text' || t === 'sticky') {
    const content = String(objData.content || '');
    const w = Number(objData.width) || 200;
    // Estimate rendered height GENEROUSLY (over-reserve) — headings render at
    // ~2.2rem and everything auto-grows, so under-reserving is what caused the
    // agent to write blocks over its own text. Better to leave a gap than overlap.
    const charPx = t === 'heading' ? 20 : 8.6; // avg glyph advance
    const lineH = t === 'heading' ? 46 : 26;
    const perLine = Math.max(6, Math.floor((w - 24) / charPx));
    const lines = content.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0);
    const pad = t === 'sticky' ? 40 : 30;
    return Math.max(base, lines * lineH + pad);
  }
  return base;
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
       The model supplies layout INTENT (columns, rows, structure); the client
       guarantees nothing overlaps. Existing content counts as occupied, so new
       work lands in free space beside it. The whole build is shifted as one
       block (preserving the model's relative structure) via `placeOffset`, then
       any genuine residual overlap is resolved by pushing the block down. Frames
       are backdrops — they neither block nor get pushed, so framed items stay
       inside them. */
    const occupied: Rect[] = visibleObjects
      .filter((o) => o.type !== 'frame')
      .map((o) => ({ x: o.x, y: o.y, w: o.width, h: o.height }));
    let placeOffset: { dx: number; dy: number } | null = null;

    const resolveDown = (r: Rect): Rect => {
      const out = { ...r };
      let guard = 0;
      while (guard++ < 600) {
        const hit = occupied.find((o) => rectsOverlap(out, o));
        if (!hit) break;
        out.y = hit.y + hit.h + PACK_GAP;
      }
      return out;
    };

    // Returns the collision-free position for a new object and reserves its space.
    const placeFor = (objData: Partial<CanvasObjectData>): { x: number; y: number } => {
      const w = Number(objData.width) || 200;
      const h = packHeight(objData);
      const ix = Math.round(Number(objData.x) || 0);
      const iy = Math.round(Number(objData.y) || 0);
      if (placeOffset === null) {
        const anchor = resolveDown({ x: ix, y: iy, w, h });
        placeOffset = { dx: anchor.x - ix, dy: anchor.y - iy };
      }
      let r: Rect = { x: ix + placeOffset.dx, y: iy + placeOffset.dy, w, h };
      if (objData.type !== 'frame') {
        r = resolveDown(r);
        occupied.push(r);
      }
      return { x: r.x, y: r.y };
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

    const runAction = (action: Action) => {
      try {
        switch (action.type) {
          case 'CREATE_OBJECT': {
            if (!action.objData) break;
            const pos = placeFor(action.objData);
            const od = action.objData;
            const style = (od.style || {}) as Record<string, unknown>;
            // Images: keep a real URL, otherwise blank now + fetch the picture.
            const imageQuery = od.type === 'image'
              ? (isHttpUrl(od.content) ? '' : (style.imageQuery as string) || od.content || '')
              : '';
            const startContent = od.type === 'image' && !isHttpUrl(od.content) ? '' : (od.content || '');
            const spawned = live().addObject({
              type: od.type,
              x: pos.x, y: pos.y,
              width: od.width, height: od.height,
              content: startContent,
              style,
            });
            if (action.tempId) idMap[action.tempId] = spawned.id;
            // Kick off async media resolution (image search / geocoding).
            if (od.type === 'image' && !isHttpUrl(od.content) && imageQuery.trim()) {
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
            live().updateObject(targetId, {
              ...updates,
              style: updates.style ? { ...existing.style, ...updates.style } : existing.style,
            });
            executed++;
            break;
          }
          case 'DELETE_OBJECT': {
            const targetId = resolveId(action.id);
            if (targetId && live().objects.some((o) => o.id === targetId)) { live().removeObject(targetId); executed++; }
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
            });
            executed++;
            break;
          }
        }
        if (action.log) addLog(action.log);
      } catch (e) {
        console.warn('[Agent] action failed', e);
      }
    };

    const finishSuccess = () => {
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
          filesContext: filesContext || undefined,
          canvas: {
            objects: visibleObjects.map((o) => ({
              id: o.id, type: o.type, x: o.x, y: o.y,
              width: o.width, height: o.height, content: o.content, style: o.style,
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

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!runningRef.current) { reader.cancel(); return; }
        scan(decoder.decode(value, { stream: true }));
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
