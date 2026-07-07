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

  const runAgent = useCallback(async (promptText: string, keyIdx: number, customX?: number, customY?: number) => {
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

    addLog('[Agent] Thinking through your request...');

    try {
      const response = await fetch('/api/agent/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: promptText,
          apiKeyIndex: keyIdx,
          agentX: startX,
          agentY: startY,
          canvas: {
            objects: visibleObjects.map((o) => ({
              id: o.id, type: o.type, x: o.x, y: o.y,
              width: o.width, height: o.height,
              content: o.content, style: o.style,
            })),
            connections: visibleConnections.map((c) => ({ id: c.id, fromId: c.fromId, toId: c.toId })),
          },
        }),
      });

      if (!runningRef.current) return;

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to construct plan');
      }

      const plan = data.plan;
      addLog(`[Plan] ${plan.planDescription || 'Building on the canvas'}`);

      const actions: Action[] = Array.isArray(plan.actions) ? plan.actions : [];
      if (actions.length === 0) {
        addLog('[Agent] Nothing to do for this request.');
        setAgentState({ agentStatus: 'success', agentRunning: false });
        runningRef.current = false;
        return;
      }

      const idMap: Record<string, string> = {};
      const resolveId = (id?: string) => (id ? (idMap[id] || id) : '');
      const live = () => useCanvasStore.getState();

      for (let i = 0; i < actions.length; i++) {
        if (!runningRef.current) return;

        const action = actions[i];
        addLog(action.log || `[Agent] Step ${i + 1}/${actions.length}`);

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

              // Gently keep the build in view
              const cam = live().camera;
              live().animateCamera({
                x: window.innerWidth / 2 - (spawned.x + spawned.width / 2) * cam.zoom,
                y: window.innerHeight / 2 - (spawned.y + spawned.height / 2) * cam.zoom,
                zoom: cam.zoom,
              }, 350);
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

        await new Promise((resolve) => setTimeout(resolve, 350));
      }

      if (runningRef.current) {
        addLog('[Success] Done.');
        setAgentState({ agentStatus: 'success', agentRunning: false });
        runningRef.current = false;

        // Settle the camera on the work area
        const cam = live().camera;
        live().animateCamera({
          x: window.innerWidth / 2 - startX * cam.zoom,
          y: window.innerHeight / 2 - startY * cam.zoom,
          zoom: cam.zoom,
        }, 600);

        setTimeout(() => {
          if (useCanvasStore.getState().agentStatus === 'success') {
            setAgentState({ agentStatus: 'idle', agentLogs: [] });
          }
        }, 2500);
      }
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
      const customEvent = e as CustomEvent<{ prompt: string; apiKeyIndex?: number; x?: number; y?: number }>;
      const { prompt: p, apiKeyIndex: ki, x, y } = customEvent.detail;
      runAgent(p, ki ?? 0, x, y);
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
