'use client';

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCanvasStore } from '@/store/canvasStore';
import { CanvasObjectData } from '@/lib/db';

interface Action {
  type: 'CREATE_OBJECT' | 'CREATE_CONNECTION';
  tempId?: string;
  fromId?: string;
  toId?: string;
  objData?: {
    type: 'text' | 'sticky' | 'card' | 'heading' | 'frame' | 'workflow-node';
    x: number;
    y: number;
    width: number;
    height: number;
    content: string;
    style?: Record<string, unknown>;
  };
  style?: Record<string, unknown>;
  log: string;
}

// Custom SVGs for premium feel and zero compilation conflicts
const SparksIcon = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
  </svg>
);

const CloseIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const StopIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" fill="currentColor" />
  </svg>
);

export default function AgentOverlay() {
  const agentPromptOpen = useCanvasStore((s) => s.agentPromptOpen);
  const setAgentPromptOpen = useCanvasStore((s) => s.setAgentPromptOpen);
  const agentRunning = useCanvasStore((s) => s.agentRunning);
  const agentLogs = useCanvasStore((s) => s.agentLogs);
  const agentStatus = useCanvasStore((s) => s.agentStatus);
  const setAgentState = useCanvasStore((s) => s.setAgentState);
  
  const camera = useCanvasStore((s) => s.camera);
  const addObject = useCanvasStore((s) => s.addObject);
  const addConnection = useCanvasStore((s) => s.addConnection);
  const animateCamera = useCanvasStore((s) => s.animateCamera);

  const [promptInput, setPromptInput] = useState('');
  const [keyIndex, setKeyIndex] = useState(0);
  const [showConsole, setShowConsole] = useState(false);

  const promptInputRef = useRef<HTMLTextAreaElement>(null);
  const consoleEndRef = useRef<HTMLDivElement>(null);
  const runningRef = useRef(false);

  // Auto-focus input on open
  useEffect(() => {
    if (agentPromptOpen) {
      setPromptInput('');
      setTimeout(() => promptInputRef.current?.focus(), 150);
    }
  }, [agentPromptOpen]);

  // Auto-scroll logs
  useEffect(() => {
    if (consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [agentLogs]);

  // Stop running agent
  const handleStop = () => {
    runningRef.current = false;
    setAgentState({
      agentRunning: false,
      agentStatus: 'idle',
      agentLogs: [...agentLogs, `[${new Date().toLocaleTimeString()}] [Agent] Building interrupted by user.`]
    });
  };

  // Run AI Agent Background Loop
  const runAgent = async (promptText: string, keyIdx: number, customX?: number, customY?: number) => {
    if (!promptText.trim()) return;

    runningRef.current = true;
    setAgentPromptOpen(false);

    // Initial center position in coordinates
    const startX = customX ?? (-camera.x + window.innerWidth / 2) / camera.zoom;
    const startY = customY ?? (-camera.y + window.innerHeight / 2) / camera.zoom;

    setAgentState({
      agentRunning: true,
      agentStatus: 'running',
      agentLogs: [`[Agent] Initializing background task...`]
    });

    const addLog = (line: string) => {
      const curLogs = useCanvasStore.getState().agentLogs;
      const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      setAgentState({
        agentLogs: [...curLogs, `[${ts}] ${line}`]
      });
    };

    addLog(`[Agent] Querying NVIDIA NIM Llama 3.3 (Key ${keyIdx + 1})...`);

    try {
      const response = await fetch('/api/agent/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: promptText,
          apiKeyIndex: keyIdx,
          agentX: startX,
          agentY: startY,
        }),
      });

      if (!runningRef.current) return;

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to construct plan');
      }

      const plan = data.plan;
      const planDesc = plan.planDescription || 'Building spatial elements';
      addLog(`[Plan] ${planDesc}`);

      const actions: Action[] = plan.actions || [];
      if (actions.length === 0) {
        addLog('[Warning] No actions in plan.');
        setAgentState({ agentStatus: 'success', agentRunning: false });
        runningRef.current = false;
        return;
      }

      addLog(`[Agent] Plan accepted. Executing ${actions.length} canvas operations...`);

      const idMap: Record<string, string> = {};

      for (let i = 0; i < actions.length; i++) {
        if (!runningRef.current) {
          addLog('[Agent] Aborting execution loop.');
          return;
        }

        const action = actions[i];
        addLog(action.log || `[Executing] Action ${i + 1}/${actions.length}`);

        try {
          if (action.type === 'CREATE_OBJECT' && action.objData) {
            const spawned = addObject({
              type: action.objData.type,
              x: action.objData.x,
              y: action.objData.y,
              width: action.objData.width,
              height: action.objData.height,
              content: action.objData.content || '',
              style: action.objData.style || {},
            });

            if (action.tempId) {
              idMap[action.tempId] = spawned.id;
            }

            // Animate camera to focus on new node
            const targetCamX = window.innerWidth / 2 - (spawned.x + spawned.width / 2);
            const targetCamY = window.innerHeight / 2 - (spawned.y + spawned.height / 2);
            animateCamera({ x: targetCamX, y: targetCamY, zoom: 0.85 }, 400);

          } else if (action.type === 'CREATE_CONNECTION') {
            const resolvedFromId = action.fromId ? (idMap[action.fromId] || action.fromId) : '';
            const resolvedToId = action.toId ? (idMap[action.toId] || action.toId) : '';

            if (resolvedFromId && resolvedToId) {
              addConnection(resolvedFromId, resolvedToId, action.style || {});
            }
          }
        } catch (actionErr: any) {
          addLog(`[Error] Action failed: ${actionErr.message}`);
        }

        // Wait 800ms
        await new Promise((resolve) => setTimeout(resolve, 800));
      }

      if (runningRef.current) {
        addLog('[Success] Background build complete!');
        setAgentState({ agentStatus: 'success', agentRunning: false });
        runningRef.current = false;
        
        // Refocus camera on the general area
        const targetCamX = window.innerWidth / 2 - startX;
        const targetCamY = window.innerHeight / 2 - startY;
        animateCamera({ x: targetCamX, y: targetCamY, zoom: 0.95 }, 600);

        // Auto-dismiss HUD
        setTimeout(() => {
          if (useCanvasStore.getState().agentStatus === 'success') {
            setAgentState({ agentStatus: 'idle', agentLogs: [] });
          }
        }, 4000);
      }

    } catch (err: any) {
      console.error(err);
      addLog(`[Failure] Agent crashed: ${err.message}`);
      setAgentState({ agentStatus: 'failed', agentRunning: false });
      runningRef.current = false;

      // Auto-dismiss HUD
      setTimeout(() => {
        if (useCanvasStore.getState().agentStatus === 'failed') {
          setAgentState({ agentStatus: 'idle', agentLogs: [] });
        }
      }, 5000);
    }
  };

  // Listen to custom window events for /agent command triggers
  useEffect(() => {
    const handleRunEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ prompt: string; apiKeyIndex?: number; x?: number; y?: number }>;
      const { prompt: p, apiKeyIndex: ki, x, y } = customEvent.detail;
      runAgent(p, ki ?? 0, x, y);
    };

    window.addEventListener('run-agent', handleRunEvent);
    return () => window.removeEventListener('run-agent', handleRunEvent);
  }, [camera]);

  const latestLog = agentLogs.length > 0 ? agentLogs[agentLogs.length - 1] : '';

  return (
    <>
      {/* 1. SPOTLIGHT PROMPT COMMAND BAR */}
      <AnimatePresence>
        {agentPromptOpen && (
          <div className="fixed inset-0 z-[300] flex items-start justify-center pt-[18vh] bg-black/40 backdrop-blur-sm" onClick={() => setAgentPromptOpen(false)}>
            <motion.div
              className="w-full max-w-lg mx-4"
              initial={{ y: -15, opacity: 0, scale: 0.96 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: -15, opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              onClick={(e) => e.stopPropagation()}
            >
              <div 
                className="rounded-2xl border border-white/10 shadow-2xl overflow-hidden"
                style={{
                  background: 'rgba(23, 20, 18, 0.92)',
                  backdropFilter: 'blur(20px)'
                }}
              >
                {/* Header bar */}
                <div className="px-4 py-3 border-b border-white/5 bg-white/5 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-white">
                    <SparksIcon size={14} />
                    <span className="text-xs font-bold uppercase tracking-wider" style={{ fontFamily: "'Outfit', sans-serif" }}>
                      Deploy AI Canvas Agent
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <select
                      value={keyIndex}
                      onChange={(e) => setKeyIndex(Number(e.target.value))}
                      className="bg-transparent border-none outline-none text-[10px] font-bold text-zinc-400 hover:text-white cursor-pointer select-none"
                    >
                      <option value={0} className="bg-zinc-900 text-white">NVIDIA Key 1</option>
                      <option value={1} className="bg-zinc-900 text-white">NVIDIA Key 2</option>
                      <option value={2} className="bg-zinc-900 text-white">NVIDIA Key 3</option>
                      <option value={3} className="bg-zinc-900 text-white">NVIDIA Key 4</option>
                      <option value={4} className="bg-zinc-900 text-white">NVIDIA Key 5</option>
                    </select>
                    <button 
                      onClick={() => setAgentPromptOpen(false)}
                      className="text-zinc-500 hover:text-white transition-colors cursor-pointer border-none bg-transparent"
                    >
                      <CloseIcon size={14} />
                    </button>
                  </div>
                </div>

                {/* Prompt Textarea */}
                <div className="p-4">
                  <textarea
                    ref={promptInputRef}
                    value={promptInput}
                    onChange={(e) => setPromptInput(e.target.value)}
                    placeholder="Ask the Agent to build anything on the canvas... (e.g. 'Build a software release timeline with checklists')"
                    className="w-full h-24 bg-transparent border-none outline-none text-sm text-white placeholder:text-zinc-500 resize-none font-light leading-relaxed"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        runAgent(promptInput, keyIndex);
                      } else if (e.key === 'Escape') {
                        setAgentPromptOpen(false);
                      }
                    }}
                  />
                  
                  {/* Footer hint */}
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/5 text-[10px] text-zinc-500 select-none">
                    <span>Press <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white text-[9px]">Enter</kbd> to Deploy, <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white text-[9px]">Esc</kbd> to close</span>
                    <button 
                      onClick={() => runAgent(promptInput, keyIndex)}
                      disabled={!promptInput.trim()}
                      className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed text-white font-bold cursor-pointer transition-colors border-none"
                    >
                      Deploy Agent
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 2. FLOATING HUD SYSTEM STATUS (TOP-CENTER) */}
      <AnimatePresence>
        {agentStatus !== 'idle' && (
          <motion.div
            className="fixed top-6 left-1/2 z-[250]"
            initial={{ y: -50, x: '-50%', opacity: 0, scale: 0.9 }}
            animate={{ y: 0, x: '-50%', opacity: 1, scale: 1 }}
            exit={{ y: -50, x: '-50%', opacity: 0, scale: 0.9 }}
            transition={{ type: 'spring', damping: 20, stiffness: 200 }}
          >
            <div
              className={`flex flex-col rounded-2xl border overflow-hidden shadow-2xl transition-all duration-300 ${
                agentStatus === 'running' 
                  ? 'border-indigo-500/60 shadow-indigo-500/10' 
                  : agentStatus === 'success' 
                    ? 'border-emerald-500/60 shadow-emerald-500/10' 
                    : 'border-red-500/60 shadow-red-500/10'
              }`}
              style={{
                width: '360px',
                background: 'rgba(23, 20, 18, 0.90)',
                backdropFilter: 'blur(16px)'
              }}
            >
              {/* HUD Main Bar */}
              <div className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  {/* Status pulsar */}
                  <div className="relative shrink-0 flex items-center justify-center">
                    {agentStatus === 'running' && (
                      <span className="absolute inline-flex h-3 w-3 rounded-full bg-indigo-400 opacity-75 animate-ping" />
                    )}
                    <span className={`relative inline-flex rounded-full h-2 w-2 ${
                      agentStatus === 'running' 
                        ? 'bg-indigo-400' 
                        : agentStatus === 'success' 
                          ? 'bg-emerald-400' 
                          : 'bg-red-400'
                    }`} />
                  </div>

                  {/* Status log label */}
                  <div className="flex flex-col min-w-0">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 leading-tight">
                      {agentStatus === 'running' ? 'AI Agent Deploying...' : agentStatus === 'success' ? 'Agent Success' : 'Agent Failed'}
                    </span>
                    <span className="text-xs text-white truncate font-light leading-normal mt-0.5" style={{ direction: 'rtl', textAlign: 'left' }}>
                      {latestLog ? latestLog.replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, '') : 'Waiting...'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {/* Console toggle button */}
                  <button 
                    onClick={() => setShowConsole(!showConsole)}
                    className="p-1 rounded hover:bg-white/5 text-zinc-400 hover:text-white transition-colors cursor-pointer border-none bg-transparent"
                    title="Toggle Console Log"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="4 17 10 11 4 5" />
                      <line x1="12" y1="19" x2="20" y2="19" />
                    </svg>
                  </button>

                  {/* Stop execution button */}
                  {agentStatus === 'running' && (
                    <button
                      onClick={handleStop}
                      className="p-1.5 rounded-lg bg-red-600/80 hover:bg-red-600 text-white cursor-pointer transition-colors border-none flex items-center justify-center"
                      title="Cancel Build"
                    >
                      <StopIcon size={10} />
                    </button>
                  )}
                </div>
              </div>

              {/* Animated Progress Bar */}
              {agentStatus === 'running' && (
                <div className="h-0.5 w-full bg-zinc-900 overflow-hidden relative">
                  <div className="h-full bg-indigo-500 absolute top-0 left-0 animate-progress-indeterminate" style={{ width: '40%' }} />
                </div>
              )}

              {/* Real-time Expandable Console Log panel */}
              <AnimatePresence>
                {showConsole && (
                  <motion.div
                    className="border-t border-white/5 bg-black/40 overflow-hidden"
                    initial={{ height: 0 }}
                    animate={{ height: 160 }}
                    exit={{ height: 0 }}
                  >
                    <div className="p-3 h-full overflow-y-auto font-mono text-[9px] text-zinc-400 flex flex-col gap-1 custom-scrollbar text-left select-text">
                      {agentLogs.map((log, idx) => {
                        let color = 'text-zinc-500';
                        if (log.includes('[Success]')) color = 'text-emerald-400 font-bold';
                        else if (log.includes('[Failure]') || log.includes('[Error]')) color = 'text-red-400';
                        else if (log.includes('[Plan]')) color = 'text-sky-400';
                        else if (log.includes('[Agent]')) color = 'text-indigo-400';
                        else if (log.includes('[Executing]')) color = 'text-amber-400';
                        return <div key={idx} className={color}>{log}</div>;
                      })}
                      <div ref={consoleEndRef} />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
