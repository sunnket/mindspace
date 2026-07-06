'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useCanvasStore } from '@/store/canvasStore';
import { CanvasObjectData } from '@/lib/db';

interface AgentBlockProps {
  obj: CanvasObjectData;
}

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

// Inline standard SVG Icons to avoid external dependency compilation errors
const PlayIcon = ({ size = 13, className }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" />
  </svg>
);

const SquareIcon = ({ size = 13, className }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" fill="currentColor" />
  </svg>
);

const RefreshCwIcon = ({ size = 13, className }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`animate-spin-slow ${className || ''}`}>
    <polyline points="23 4 23 10 17 10" />
    <polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);

const TerminalIcon = ({ size = 13, className }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" y1="19" x2="20" y2="19" />
  </svg>
);

const LayersIcon = ({ size = 13, className }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <polygon points="12 2 2 7 12 12 22 7 12 2" />
    <polyline points="2 17 12 22 22 17" />
    <polyline points="2 12 12 17 22 12" />
  </svg>
);

export default function AgentBlock({ obj }: AgentBlockProps) {
  const updateObject = useCanvasStore((s) => s.updateObject);
  const addObject = useCanvasStore((s) => s.addObject);
  const addConnection = useCanvasStore((s) => s.addConnection);
  const animateCamera = useCanvasStore((s) => s.animateCamera);

  // Read state from style property
  const style = obj.style || {};
  const prompt = (style.agentPrompt as string) || '';
  const logs = (style.agentLogs as string[]) || ['[Ready] Agent waiting for task...'];
  const status = (style.agentStatus as 'idle' | 'running' | 'success' | 'failed') || 'idle';
  const apiKeyIndex = (style.apiKeyIndex as number) || 0;

  const [localPrompt, setLocalPrompt] = useState(prompt);
  const [localKeyIndex, setLocalKeyIndex] = useState(apiKeyIndex);
  
  const consoleEndRef = useRef<HTMLDivElement>(null);
  const runningRef = useRef(false);

  // Auto-scroll the console logs to the bottom
  useEffect(() => {
    if (consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  const updateAgentStyle = (updates: Record<string, unknown>) => {
    updateObject(obj.id, {
      style: {
        ...obj.style,
        ...updates,
      },
    });
  };

  const addLogLine = (line: string) => {
    const currentLogs = (useCanvasStore.getState().objects.find(o => o.id === obj.id)?.style?.agentLogs as string[]) || [];
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    updateAgentStyle({
      agentLogs: [...currentLogs, `[${timestamp}] ${line}`],
    });
  };

  const handleStop = () => {
    runningRef.current = false;
    updateAgentStyle({ agentStatus: 'idle' });
    addLogLine('[Agent] Execution stopped by user.');
  };

  const handleRun = async () => {
    if (!localPrompt.trim()) return;

    runningRef.current = true;
    updateAgentStyle({
      agentPrompt: localPrompt,
      apiKeyIndex: localKeyIndex,
      agentStatus: 'running',
      agentLogs: [], // Clear previous logs
    });

    addLogLine('[Agent] Initializing AI Canvas Agent...');
    addLogLine(`[Agent] Selected API Key Index: Key ${localKeyIndex + 1}`);
    addLogLine('[Agent] Querying Llama 3.3 model from NVIDIA NIM API...');

    try {
      const response = await fetch('/api/agent/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: localPrompt,
          apiKeyIndex: localKeyIndex,
          agentX: obj.x,
          agentY: obj.y,
        }),
      });

      if (!runningRef.current) return;

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch plan from agent');
      }

      const plan = data.plan;
      const planDesc = plan.planDescription || 'Building spatial canvas elements';
      addLogLine(`[Plan] ${planDesc}`);

      const actions: Action[] = plan.actions || [];
      if (actions.length === 0) {
        addLogLine('[Warning] No actions returned by the planner.');
        updateAgentStyle({ agentStatus: 'success' });
        runningRef.current = false;
        return;
      }

      addLogLine(`[Agent] Planning complete. Executing ${actions.length} actions step-by-step...`);

      // Dictionary mapping temporary LLM IDs to real canvas UUIDs
      const idMap: Record<string, string> = {};

      for (let i = 0; i < actions.length; i++) {
        if (!runningRef.current) {
          addLogLine('[Agent] Aborting execution loop.');
          return;
        }

        const action = actions[i];
        addLogLine(action.log || `[Executing] Action ${i + 1}/${actions.length}`);

        try {
          if (action.type === 'CREATE_OBJECT' && action.objData) {
            // Resolve nested IDs inside stringified Todo Checklist content if applicable
            let content = action.objData.content;
            if (action.objData.style?.isTodo && content) {
              try {
                // If it's a JSON string, check if it's already stringified.
                // Re-resolve or pass it as is.
                const parsed = JSON.parse(content);
                content = JSON.stringify(parsed);
              } catch (pe) {
                // Not JSON, pass as is
              }
            }

            // Create object on the canvas
            const spawned = addObject({
              type: action.objData.type,
              x: action.objData.x,
              y: action.objData.y,
              width: action.objData.width,
              height: action.objData.height,
              content: content || '',
              style: action.objData.style || {},
            });

            if (action.tempId) {
              idMap[action.tempId] = spawned.id;
            }

            // Animate camera to focus on the newly created object
            const targetCamX = window.innerWidth / 2 - (spawned.x + spawned.width / 2);
            const targetCamY = window.innerHeight / 2 - (spawned.y + spawned.height / 2);
            animateCamera({ x: targetCamX, y: targetCamY, zoom: 0.85 }, 400);

          } else if (action.type === 'CREATE_CONNECTION') {
            const resolvedFromId = action.fromId ? (idMap[action.fromId] || action.fromId) : '';
            const resolvedToId = action.toId ? (idMap[action.toId] || action.toId) : '';

            if (resolvedFromId && resolvedToId) {
              addConnection(resolvedFromId, resolvedToId, action.style || {});
            } else {
              addLogLine(`[Error] Could not resolve connection endpoints: from=${action.fromId}, to=${action.toId}`);
            }
          }
        } catch (actionErr: any) {
          addLogLine(`[Error] Action failed: ${actionErr.message}`);
        }

        // Wait 800ms before taking the next action
        await new Promise((resolve) => setTimeout(resolve, 800));
      }

      if (runningRef.current) {
        addLogLine('[Success] AI Canvas Agent completed all tasks successfully!');
        updateAgentStyle({ agentStatus: 'success' });
        runningRef.current = false;
        
        // Return camera focus back to the Agent card
        const agentCamX = window.innerWidth / 2 - (obj.x + obj.width / 2);
        const agentCamY = window.innerHeight / 2 - (obj.y + obj.height / 2);
        animateCamera({ x: agentCamX, y: agentCamY, zoom: 1.0 }, 600);
      }

    } catch (err: any) {
      console.error(err);
      addLogLine(`[Failure] Agent crashed: ${err.message}`);
      updateAgentStyle({ agentStatus: 'failed' });
      runningRef.current = false;
    }
  };

  return (
    <div 
      className={`w-full h-full flex flex-col rounded-2xl overflow-hidden glass-panel border shadow-2xl transition-all duration-300 ${
        status === 'running' 
          ? 'border-indigo-500/70 shadow-indigo-500/10' 
          : status === 'success' 
            ? 'border-emerald-500/60 shadow-emerald-500/5' 
            : status === 'failed' 
              ? 'border-red-500/60 shadow-red-500/5' 
              : 'border-[var(--border)]'
      }`}
      style={{
        background: 'rgba(23, 20, 18, 0.88)',
        backdropFilter: 'blur(16px)',
      }}
      onMouseDown={(e) => e.stopPropagation()} // Stop canvas dragging from inputs
    >
      {/* Agent Header */}
      <div className="px-4 py-3 flex items-center justify-between border-b border-white/10 bg-white/5">
        <div className="flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full ${
            status === 'running' 
              ? 'bg-indigo-400 animate-pulse' 
              : status === 'success' 
                ? 'bg-emerald-400' 
                : status === 'failed' 
                  ? 'bg-red-400' 
                  : 'bg-zinc-400'
          }`} />
          <span className="text-xs font-bold uppercase tracking-wider text-white" style={{ fontFamily: "'Outfit', sans-serif" }}>
            Mindspace AI Agent
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <LayersIcon size={13} className="text-zinc-400" />
          <select
            value={localKeyIndex}
            onChange={(e) => setLocalKeyIndex(Number(e.target.value))}
            disabled={status === 'running'}
            className="bg-transparent border-none outline-none text-[10px] font-bold text-zinc-300 hover:text-white cursor-pointer select-none"
          >
            <option value={0} className="bg-zinc-900 text-white">NVIDIA Key 1</option>
            <option value={1} className="bg-zinc-900 text-white">NVIDIA Key 2</option>
            <option value={2} className="bg-zinc-900 text-white">NVIDIA Key 3</option>
            <option value={3} className="bg-zinc-900 text-white">NVIDIA Key 4</option>
            <option value={4} className="bg-zinc-900 text-white">NVIDIA Key 5</option>
          </select>
        </div>
      </div>

      {/* Main Form */}
      <div className="p-4 flex-1 flex flex-col gap-3 overflow-y-auto custom-scrollbar">
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Describe Canvas Task</label>
          <textarea
            value={localPrompt}
            onChange={(e) => setLocalPrompt(e.target.value)}
            disabled={status === 'running'}
            placeholder="e.g. Create a visual product design pipeline with checklists, decision wheels, and flow arrows connecting milestones..."
            className="w-full h-24 p-3 bg-zinc-950/70 border border-white/10 rounded-xl text-xs text-white placeholder:text-zinc-600 outline-none focus:border-indigo-500/50 resize-none transition-colors"
          />
        </div>

        {/* Action Button */}
        {status === 'running' ? (
          <button
            onClick={handleStop}
            className="w-full py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-red-950/30 transition-all border-none"
          >
            <SquareIcon size={13} /> Stop Building
          </button>
        ) : (
          <button
            onClick={handleRun}
            disabled={!localPrompt.trim()}
            className="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-xs font-bold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-indigo-950/30 transition-all border-none"
          >
            {status === 'idle' ? (
              <>
                <PlayIcon size={13} /> Deploy Agent
              </>
            ) : (
              <>
                <RefreshCwIcon size={13} /> Rebuild Board
              </>
            )}
          </button>
        )}

        {/* Terminal Logs */}
        <div className="flex-1 flex flex-col min-h-[140px] rounded-xl border border-white/5 bg-black/60 overflow-hidden">
          <div className="px-3 py-2 border-b border-white/5 bg-white/2 flex items-center gap-1.5">
            <TerminalIcon size={12} className="text-indigo-400" />
            <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">Agent Console logs</span>
          </div>
          <div className="flex-1 p-3 overflow-y-auto font-mono text-[10px] leading-relaxed flex flex-col gap-1.5 custom-scrollbar text-left select-text">
            {logs.map((log, idx) => {
              let colorClass = 'text-zinc-400';
              if (log.includes('[Success]')) colorClass = 'text-emerald-400 font-bold';
              else if (log.includes('[Failure]') || log.includes('[Error]')) colorClass = 'text-red-400 font-bold';
              else if (log.includes('[Plan]')) colorClass = 'text-sky-400';
              else if (log.includes('[Agent]')) colorClass = 'text-indigo-400';
              else if (log.includes('[Executing]')) colorClass = 'text-amber-400 animate-pulse';
              else if (log.includes('[Ready]')) colorClass = 'text-zinc-500';

              return (
                <div key={idx} className={colorClass}>
                  {log}
                </div>
              );
            })}
            <div ref={consoleEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
}
