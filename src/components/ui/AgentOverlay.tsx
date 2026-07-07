'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCanvasStore } from '@/store/canvasStore';
import { CanvasObjectData } from '@/lib/db';

interface Action {
  type: 'CREATE_OBJECT' | 'UPDATE_OBJECT' | 'DELETE_OBJECT' | 'CREATE_CONNECTION' | 'DELETE_CONNECTION';
  tempId?: string;
  id?: string;
  fromId?: string;
  toId?: string;
  connectionId?: string;
  objData?: Partial<CanvasObjectData>;
  updates?: Partial<CanvasObjectData>;
  style?: Record<string, unknown>;
  log?: string;
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
const PACK_GAP = 40;

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
    const perLine = Math.max(8, Math.floor((Number(objData.width) || 200) / (t === 'heading' ? 15 : 8)));
    const lines = content.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0);
    const lineH = t === 'heading' ? 30 : 24;
    return Math.max(base, lines * lineH + 26);
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

    const runAction = (action: Action) => {
      try {
        switch (action.type) {
          case 'CREATE_OBJECT': {
            if (!action.objData) break;
            const pos = placeFor(action.objData);
            const spawned = live().addObject({
              type: action.objData.type,
              x: pos.x, y: pos.y,
              width: action.objData.width, height: action.objData.height,
              content: action.objData.content || '',
              style: action.objData.style || {},
            });
            if (action.tempId) idMap[action.tempId] = spawned.id;
            executed++;
            gentlePan({ x: pos.x, y: pos.y, width: Number(action.objData.width) || 200, height: Number(action.objData.height) || 100 });
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

      const res = await fetch('/api/agent/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: promptText,
          apiKeyIndex: keyIdx,
          agentX: startX, agentY: startY,
          context: refContext,
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
      const ce = e as CustomEvent<{ prompt: string; apiKeyIndex?: number; x?: number; y?: number; context?: string }>;
      const { prompt: p, apiKeyIndex: ki, x, y, context } = ce.detail;
      runAgent(p, ki ?? 0, x, y, context);
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
