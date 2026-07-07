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
 * Invisible-until-working agent runtime. No prompt modal — the agent is
 * launched inline from any text block via "/agent <task>" (see CanvasObject),
 * which dispatches a `run-agent` window event handled here. While running it
 * shows only a small quiet status pill, Notion-style.
 */
export default function AgentOverlay() {
  const agentLogs = useCanvasStore((s) => s.agentLogs);
  const agentStatus = useCanvasStore((s) => s.agentStatus);
  const setAgentState = useCanvasStore((s) => s.setAgentState);

  const [expanded, setExpanded] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const runningRef = useRef(false);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [agentLogs, expanded]);

  const handleStop = () => {
    runningRef.current = false;
    setAgentState({
      agentRunning: false,
      agentStatus: 'idle',
      agentLogs: [],
    });
  };

  const runAgent = useCallback(async (promptText: string, keyIdx: number, customX?: number, customY?: number, refContext?: string) => {
    if (!promptText.trim() || runningRef.current) return;

    const store = useCanvasStore.getState();
    const { camera } = store;

    runningRef.current = true;

    const startX = customX ?? (-camera.x + window.innerWidth / 2) / camera.zoom;
    const startY = customY ?? (-camera.y + window.innerHeight / 2) / camera.zoom;

    setAgentState({
      agentRunning: true,
      agentStatus: 'running',
      agentLogs: ['[Agent] Reading the canvas...'],
    });

    const addLog = (line: string) => {
      const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      setAgentState({ agentLogs: [...useCanvasStore.getState().agentLogs, `[${ts}] ${line}`] });
    };

    const live = () => useCanvasStore.getState();

    // Snapshot only the canvas level the user is looking at
    const stack = store.canvasStack;
    const activeParent = stack.length > 0
      ? stack[stack.length - 1]
      : (store.urlCanvasId === 'root' ? undefined : store.urlCanvasId);
    const visibleObjects = store.objects.filter(
      (o) => o.parentId === activeParent && !o.style?.isMinimized
    );
    const visibleIds = new Set(visibleObjects.map((o) => o.id));
    const visibleConnections = store.connections.filter(
      (c) => visibleIds.has(c.fromId) && visibleIds.has(c.toId)
    );

    const basePayload = {
      prompt: promptText,
      agentX: startX,
      agentY: startY,
      context: refContext,
      canvas: {
        objects: visibleObjects.map((o) => ({
          id: o.id, type: o.type, x: o.x, y: o.y,
          width: o.width, height: o.height,
          content: o.content, style: o.style,
        })),
        connections: visibleConnections.map((c) => ({ id: c.id, fromId: c.fromId, toId: c.toId })),
      },
    };

    const callApi = async (payload: Record<string, unknown>) => {
      const response = await fetch('/api/agent/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...basePayload, ...payload }),
      });
      return response.json();
    };

    // Track everything the squad creates so the camera can settle on it at the end
    const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    const growBounds = (o: { x: number; y: number; width: number; height: number }) => {
      bounds.minX = Math.min(bounds.minX, o.x);
      bounds.minY = Math.min(bounds.minY, o.y);
      bounds.maxX = Math.max(bounds.maxX, o.x + o.width);
      bounds.maxY = Math.max(bounds.maxY, o.y + o.height);
    };

    // Executes one builder's action list. Streams run concurrently, so tempIds
    // are namespaced per stream while real canvas ids resolve globally.
    const executeActions = async (actions: Action[], streamTag: string) => {
      const idMap: Record<string, string> = {};
      const resolveId = (id?: string) => (id ? (idMap[id] || id) : '');

      for (let i = 0; i < actions.length; i++) {
        if (!runningRef.current) return;
        const action = actions[i];
        if (action.log) addLog(`${streamTag}${action.log}`);

        try {
          switch (action.type) {
            case 'CREATE_OBJECT': {
              if (!action.objData) break;
              const spawned = live().addObject({
                type: action.objData.type,
                x: action.objData.x,
                y: action.objData.y,
                width: action.objData.width,
                height: action.objData.height,
                content: action.objData.content || '',
                style: action.objData.style || {},
              });
              if (action.tempId) idMap[action.tempId] = spawned.id;
              growBounds(spawned);
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
              growBounds({ ...existing, ...updates } as { x: number; y: number; width: number; height: number });
              break;
            }
            case 'DELETE_OBJECT': {
              const targetId = resolveId(action.id);
              if (targetId && live().objects.some((o) => o.id === targetId)) {
                live().removeObject(targetId);
              }
              break;
            }
            case 'CREATE_CONNECTION': {
              const fromId = resolveId(action.fromId);
              const toId = resolveId(action.toId);
              const objs = live().objects;
              if (fromId && toId && objs.some((o) => o.id === fromId) && objs.some((o) => o.id === toId)) {
                live().addConnection(fromId, toId, action.style || {});
              }
              break;
            }
            case 'DELETE_CONNECTION': {
              const connId = action.connectionId || action.id;
              if (connId) live().removeConnection(connId);
              break;
            }
          }
        } catch (actionErr) {
          addLog(`[Error] Step failed: ${actionErr instanceof Error ? actionErr.message : actionErr}`);
        }

        // Just enough delay to read as "being built" without feeling slow
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
    };

    try {
      /* ------------------------------------------------------------------
         Speculative race: a solo builder starts immediately while the
         Director analyzes intent and (maybe) splits the job for a squad.
         Whichever path commits first wins — simple asks never wait for
         the director; big asks get parallel agents.
         ------------------------------------------------------------------ */
      addLog('[Agent] Understanding your intent...');

      interface Subtask { id?: string; title?: string; brief: string; region?: { x: number; y: number; width: number; height: number } }

      let directCommitted = false;
      let squadCommitted = false;

      const directAttempt = (async () => {
        const d = await callApi({ phase: 'build', apiKeyIndex: keyIdx + 4, chainOffset: 1 });
        if (squadCommitted || !runningRef.current) return false;
        if (!d.success || !Array.isArray(d.plan?.actions) || d.plan.actions.length === 0) {
          throw new Error(d.error || 'no executable plan');
        }
        directCommitted = true;
        addLog(`[Plan] ${d.plan.planDescription || 'Building on the canvas'}`);
        await executeActions(d.plan.actions as Action[], '');
        return true;
      })();
      directAttempt.catch(() => { /* judged below — never unhandled */ });

      let director: { intent?: string; designNotes?: string; subtasks: Subtask[] } | null = null;
      try {
        const d = await callApi({ phase: 'plan', apiKeyIndex: keyIdx });
        if (d.success && Array.isArray(d.plan?.subtasks) && d.plan.subtasks.length > 0) {
          director = d.plan;
        }
      } catch { /* director is an optimization — the solo builder still runs */ }

      if (!runningRef.current) return;

      const subtasks: Subtask[] = director?.subtasks?.slice(0, 4) || [];

      /* -------- Solo path: small job, or director unavailable -------- */
      if (directCommitted || subtasks.length <= 1) {
        try {
          const ok = await directAttempt;
          if (!ok && !directCommitted) throw new Error('solo build skipped');
        } catch (soloErr) {
          // Solo failed — if the director produced a refined brief, try once more with it
          if (subtasks.length === 1) {
            const st = subtasks[0];
            if (director?.intent) addLog(`[Plan] ${director.intent}`);
            const d = await callApi({
              phase: 'build', apiKeyIndex: keyIdx + 1, chainOffset: 0,
              brief: st.brief || undefined, region: st.region,
              designNotes: director?.designNotes, intent: director?.intent,
            });
            if (!d.success || !Array.isArray(d.plan?.actions) || d.plan.actions.length === 0) {
              throw new Error(d.error || (soloErr instanceof Error ? soloErr.message : 'no executable plan'));
            }
            addLog(`[Plan] ${d.plan.planDescription || 'Building on the canvas'}`);
            await executeActions(d.plan.actions as Action[], '');
          } else {
            throw soloErr;
          }
        }

        if (!runningRef.current) return;
        addLog('[Success] Done.');
        setAgentState({ agentStatus: 'success', agentRunning: false });
        runningRef.current = false;

        if (bounds.minX !== Infinity) {
          const cam = live().camera;
          live().animateCamera({
            x: window.innerWidth / 2 - ((bounds.minX + bounds.maxX) / 2) * cam.zoom,
            y: window.innerHeight / 2 - ((bounds.minY + bounds.maxY) / 2) * cam.zoom,
            zoom: cam.zoom,
          }, 600);
        }
        setTimeout(() => {
          if (useCanvasStore.getState().agentStatus === 'success') {
            setAgentState({ agentStatus: 'idle', agentLogs: [] });
          }
        }, 2500);
        return;
      }

      /* -------- Squad path: director split the job — deploy parallel agents -------- */
      squadCommitted = true;
      if (director?.intent) addLog(`[Plan] ${director.intent}`);
      {
        addLog(`[Agent] Deploying ${subtasks.length} agents in parallel: ${subtasks.map((s) => s.title || s.id).filter(Boolean).join(', ')}`);
        // Point the camera at the combined work area while the squad builds
        const regions = subtasks.map((s) => s.region).filter(Boolean) as { x: number; y: number; width: number; height: number }[];
        if (regions.length > 0) {
          const cx = (Math.min(...regions.map((r) => r.x)) + Math.max(...regions.map((r) => r.x + r.width))) / 2;
          const cy = (Math.min(...regions.map((r) => r.y)) + Math.max(...regions.map((r) => r.y + r.height))) / 2;
          const cam = live().camera;
          live().animateCamera({
            x: window.innerWidth / 2 - cx * cam.zoom,
            y: window.innerHeight / 2 - cy * cam.zoom,
            zoom: cam.zoom,
          }, 500);
        }
      }

      /* -------- Phase 2: builders run in parallel, executing as they land -------- */
      let succeeded = 0;
      let firstError: Error | null = null;

      await Promise.allSettled(subtasks.map((st, i) => (async () => {
        const tag = subtasks.length > 1 ? `[Agent ${i + 1}] ` : '';
        const d = await callApi({
          phase: 'build',
          apiKeyIndex: keyIdx + i + 1, // director used keyIdx — spread workers across keys
          chainOffset: i,
          brief: st.brief || undefined,
          region: st.region,
          designNotes: director?.designNotes,
          intent: director?.intent,
        });
        if (!runningRef.current) return;
        if (!d.success || !Array.isArray(d.plan?.actions) || d.plan.actions.length === 0) {
          throw new Error(d.error || 'no executable plan');
        }
        if (subtasks.length > 1) addLog(`${tag}${st.title || 'Ready'} — ${d.plan.actions.length} steps`);
        else addLog(`[Plan] ${d.plan.planDescription || 'Building on the canvas'}`);
        await executeActions(d.plan.actions as Action[], tag);
        succeeded++;
      })().catch((err: Error) => {
        firstError = firstError || err;
        addLog(`[Error] ${subtasks.length > 1 ? `Agent ${i + 1}` : 'Agent'} failed: ${err.message}`);
      })));

      if (!runningRef.current) return;
      if (succeeded === 0) {
        throw firstError || new Error('All agents failed');
      }

      addLog('[Success] Done.');
      setAgentState({ agentStatus: 'success', agentRunning: false });
      runningRef.current = false;

      // Settle the camera on everything that was built
      if (bounds.minX !== Infinity) {
        const cam = live().camera;
        live().animateCamera({
          x: window.innerWidth / 2 - ((bounds.minX + bounds.maxX) / 2) * cam.zoom,
          y: window.innerHeight / 2 - ((bounds.minY + bounds.maxY) / 2) * cam.zoom,
          zoom: cam.zoom,
        }, 600);
      }

      setTimeout(() => {
        if (useCanvasStore.getState().agentStatus === 'success') {
          setAgentState({ agentStatus: 'idle', agentLogs: [] });
        }
      }, 2500);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[Agent]', err);
      addLog(`[Failure] ${message}`);
      setAgentState({ agentStatus: 'failed', agentRunning: false });
      runningRef.current = false;

      setTimeout(() => {
        if (useCanvasStore.getState().agentStatus === 'failed') {
          setAgentState({ agentStatus: 'idle', agentLogs: [] });
        }
      }, 6000);
    }
  }, [setAgentState]);

  // Inline "/agent <task>" launches arrive as run-agent window events
  useEffect(() => {
    const handleRunEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ prompt: string; apiKeyIndex?: number; x?: number; y?: number; context?: string }>;
      const { prompt: p, apiKeyIndex: ki, x, y, context } = customEvent.detail;
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
                      else if (log.includes('[Plan]')) color = 'text-sky-400';
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
