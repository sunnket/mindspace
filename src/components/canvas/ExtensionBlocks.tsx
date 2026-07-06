'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useCanvasStore } from '@/store/canvasStore';
import { CanvasObjectData } from '@/lib/db';

// --- COUNTDOWN BLOCK ---
export function CountdownBlock({ obj }: { obj: CanvasObjectData }) {
  const updateObject = useCanvasStore((s) => s.updateObject);
  const selectedId = useCanvasStore((s) => s.selectedId);
  const isSelected = selectedId === obj.id;

  const targetDateStr = (obj.style?.countdownDate as string) || '2026-06-14T09:00:00';
  const title = (obj.style?.countdownTitle as string) || 'Launch day';
  const targetTime = useMemo(() => new Date(targetDateStr).getTime(), [targetDateStr]);

  const [timeLeft, setTimeLeft] = useState({
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
    total: 0
  });

  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    function calculate() {
      const diff = targetTime - Date.now();
      if (diff <= 0) {
        setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0, total: 0 });
        return;
      }
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
      const minutes = Math.floor((diff / (1000 * 60)) % 60);
      const seconds = Math.floor((diff / 1000) % 60);
      setTimeLeft({ days, hours, minutes, seconds, total: diff });
    }

    calculate();
    const interval = setInterval(calculate, 1000);
    return () => clearInterval(interval);
  }, [targetTime]);

  // Compute circular progress (arbitrary 30-day max baseline or 100% full)
  const maxDuration = 30 * 24 * 60 * 60 * 1000;
  const pct = Math.max(0, Math.min(100, (timeLeft.total / maxDuration) * 100));
  const radius = 32;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;

  return (
    <div className="flex flex-col h-full bg-[#18181b]/90 border border-white/5 rounded-2xl p-4 text-white justify-between select-none">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-orange-500 flex items-center"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15.5 14" /></svg></span>
          <span className="text-xs font-semibold tracking-wide text-white/80">{title}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400 text-[9px] font-bold uppercase tracking-wider animate-pulse">
            Ticking
          </span>
          {isSelected && (
            <button 
              onClick={() => setShowSettings(!showSettings)} 
              className="text-white/40 hover:text-white text-xs p-1 rounded hover:bg-white/5 transition"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
            </button>
          )}
        </div>
      </div>

      {showSettings ? (
        <div className="flex flex-col gap-2 my-2 p-2 rounded bg-white/5 border border-white/10 pointer-events-auto">
          <div>
            <label className="text-[10px] text-white/50 block mb-0.5">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => updateObject(obj.id, { style: { ...obj.style, countdownTitle: e.target.value } })}
              className="w-full bg-[#111] border border-white/10 rounded px-1.5 py-1 text-xs text-white"
            />
          </div>
          <div>
            <label className="text-[10px] text-white/50 block mb-0.5">Target Date</label>
            <input
              type="datetime-local"
              value={targetDateStr.slice(0, 16)}
              onChange={(e) => updateObject(obj.id, { style: { ...obj.style, countdownDate: e.target.value } })}
              className="w-full bg-[#111] border border-white/10 rounded px-1.5 py-1 text-xs text-white"
            />
          </div>
          <button 
            onClick={() => setShowSettings(false)}
            className="w-full mt-1 py-1 rounded bg-orange-500 text-white font-bold text-xs hover:bg-orange-600 transition"
          >
            Done
          </button>
        </div>
      ) : (
        <>
          {/* Circular Countdown Progress */}
          <div className="flex justify-center items-center my-3 relative">
            <svg width="80" height="80" className="transform -rotate-90">
              <circle cx="40" cy="40" r={radius} fill="transparent" stroke="rgba(255,255,255,0.03)" strokeWidth="4" />
              <circle 
                cx="40" 
                cy="40" 
                r={radius} 
                fill="transparent" 
                stroke="#C97B4B" 
                strokeWidth="4" 
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                strokeLinecap="round"
                className="transition-all duration-1000"
              />
            </svg>
            <div className="absolute text-[18px] font-bold text-white/90">
              {timeLeft.days > 0 ? `${timeLeft.days}d` : `${timeLeft.hours}h`}
            </div>
          </div>

          {/* Time digit blocks */}
          <div className="grid grid-cols-4 gap-1.5 text-center">
            {[
              { val: timeLeft.days, label: 'DAYS' },
              { val: timeLeft.hours, label: 'HOURS' },
              { val: timeLeft.minutes, label: 'MIN' },
              { val: timeLeft.seconds, label: 'SEC' }
            ].map((digit, i) => (
              <div key={i} className="bg-white/5 border border-white/10 rounded-xl p-1.5">
                <span className="block text-lg font-bold tracking-tight text-white">
                  {String(digit.val).padStart(2, '0')}
                </span>
                <span className="block text-[8px] text-white/40 tracking-widest font-semibold mt-0.5">{digit.label}</span>
              </div>
            ))}
          </div>

          <div className="text-[10px] text-center text-white/50 tracking-wide mt-3.5">
            {new Date(targetTime).toLocaleDateString(undefined, {
              month: 'long',
              day: 'numeric',
              year: 'numeric'
            })} at {new Date(targetTime).toLocaleTimeString(undefined, {
              hour: '2-digit',
              minute: '2-digit'
            })}
          </div>
        </>
      )}
    </div>
  );
}

// --- INTERACTIVE POLL / TEAM VOTE BLOCK ---
export function PollBlock({ obj }: { obj: CanvasObjectData }) {
  const updateObject = useCanvasStore((s) => s.updateObject);
  const selectedId = useCanvasStore((s) => s.selectedId);
  const isSelected = selectedId === obj.id;

  const question = (obj.style?.pollQuestion as string) || 'Which onboarding approach?';
  const options = (obj.style?.pollOptions as Array<{ id: string; text: string; votes: number }>) || [];
  const [showSettings, setShowSettings] = useState(false);
  const [newOptionText, setNewOptionText] = useState('');

  const totalVotes = useMemo(() => {
    return options.reduce((sum, opt) => sum + opt.votes, 0);
  }, [options]);

  const handleVote = (optionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updatedOptions = options.map((opt) => {
      if (opt.id === optionId) {
        return { ...opt, votes: opt.votes + 1 };
      }
      return opt;
    });
    updateObject(obj.id, { style: { ...obj.style, pollOptions: updatedOptions } });
  };

  const addOption = () => {
    if (!newOptionText.trim()) return;
    const newOption = {
      id: Math.random().toString(36).substr(2, 9),
      text: newOptionText.trim(),
      votes: 0
    };
    const updated = [...options, newOption];
    updateObject(obj.id, { style: { ...obj.style, pollOptions: updated } });
    setNewOptionText('');
  };

  const removeOption = (id: string) => {
    const updated = options.filter(opt => opt.id !== id);
    updateObject(obj.id, { style: { ...obj.style, pollOptions: updated } });
  };

  return (
    <div className="flex flex-col h-full bg-[#18181b]/90 border border-white/5 rounded-2xl p-4 text-white justify-between select-none">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <span className="text-violet-500 flex items-center"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><line x1="6" y1="20" x2="6" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="18" y1="20" x2="18" y2="14" /></svg></span>
          <span className="text-xs font-semibold tracking-wide text-white/80">Team vote</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400 text-[9px] font-bold uppercase tracking-wider">
            {totalVotes} {totalVotes === 1 ? 'vote' : 'votes'}
          </span>
          {isSelected && (
            <button 
              onClick={() => setShowSettings(!showSettings)} 
              className="text-white/40 hover:text-white text-xs p-1 rounded hover:bg-white/5 transition pointer-events-auto"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col justify-start flex-1 gap-2 overflow-y-auto">
        <h4 className="font-semibold text-xs text-white/90 tracking-wide mb-1 leading-tight">
          {question}
        </h4>

        {showSettings ? (
          <div className="flex flex-col gap-2 p-2 rounded bg-white/5 border border-white/10 pointer-events-auto">
            <div>
              <label className="text-[10px] text-white/50 block mb-0.5">Question</label>
              <input
                type="text"
                value={question}
                onChange={(e) => updateObject(obj.id, { style: { ...obj.style, pollQuestion: e.target.value } })}
                className="w-full bg-[#111] border border-white/10 rounded px-1.5 py-1 text-xs text-white"
              />
            </div>
            <div>
              <label className="text-[10px] text-white/50 block mb-0.5">Options</label>
              <div className="flex flex-col gap-1 mb-1">
                {options.map((opt) => (
                  <div key={opt.id} className="flex items-center justify-between gap-1 bg-[#111] rounded p-1">
                    <span className="text-xs text-white truncate max-w-[150px]">{opt.text}</span>
                    <button 
                      onClick={() => removeOption(opt.id)}
                      className="text-red-400 hover:text-red-500 text-xs px-1"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex gap-1">
                <input
                  type="text"
                  placeholder="Add option..."
                  value={newOptionText}
                  onChange={(e) => setNewOptionText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addOption()}
                  className="w-full bg-[#111] border border-white/10 rounded px-1.5 py-1 text-xs text-white"
                />
                <button 
                  onClick={addOption}
                  className="bg-violet-500 text-white px-2 py-0.5 rounded text-xs hover:bg-violet-600 transition"
                >
                  +
                </button>
              </div>
            </div>
            <button 
              onClick={() => setShowSettings(false)}
              className="w-full mt-1 py-1 rounded bg-violet-500 text-white font-bold text-xs hover:bg-violet-600 transition"
            >
              Done
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5 my-1 pointer-events-auto">
            {options.map((opt) => {
              const pct = totalVotes > 0 ? Math.round((opt.votes / totalVotes) * 100) : 0;
              return (
                <button
                  key={opt.id}
                  onClick={(e) => handleVote(opt.id, e)}
                  className="text-left w-full relative group cursor-pointer"
                >
                  <div className="flex justify-between items-center z-10 relative text-xs px-3 py-2 rounded-xl border border-white/10 hover:border-violet-500/40 bg-white/[0.02] hover:bg-white/[0.04] transition-all">
                    <span className="font-medium text-white/90 group-hover:text-white transition-colors">{opt.text}</span>
                    <span className="text-[10px] font-bold text-white/50 group-hover:text-white/80 transition-colors">{pct}%</span>
                  </div>
                  {/* Fill progress layer behind content */}
                  <div 
                    style={{ width: `${pct}%` }} 
                    className="absolute inset-y-0 left-0 rounded-xl bg-violet-500/10 border-r border-violet-500/20 pointer-events-none transition-all duration-500 ease-out" 
                  />
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex justify-between items-center text-[9px] text-white/40 border-t border-white/5 pt-2.5 mt-2 font-medium">
        <span>{totalVotes} team members voted</span>
        <span>tap an option to vote</span>
      </div>
    </div>
  );
}

// --- LIVE METRIC WITH SVG SPARKLINE CHART ---
export function LiveMetricBlock({ obj }: { obj: CanvasObjectData }) {
  const updateObject = useCanvasStore((s) => s.updateObject);
  const selectedId = useCanvasStore((s) => s.selectedId);
  const isSelected = selectedId === obj.id;

  const title = (obj.style?.metricTitle as string) || 'Onboarding completion rate';
  const value = (obj.style?.metricValue as string) || '71.3%';
  const trend = (obj.style?.metricTrend as string) || '+3.2% this week';
  const chartData = (obj.style?.metricChartData as number[]) || [60, 62, 61, 65, 68, 70, 71.3];

  const [showSettings, setShowSettings] = useState(false);
  const [rawChartData, setRawChartData] = useState(chartData.join(', '));

  // Generate SVG path for Sparkline
  const pathD = useMemo(() => {
    if (chartData.length < 2) return '';
    const width = 240;
    const height = 30;
    const minVal = Math.min(...chartData);
    const maxVal = Math.max(...chartData);
    const valRange = maxVal - minVal || 1;

    const points = chartData.map((val, idx) => {
      const x = (idx / (chartData.length - 1)) * width;
      // Invert Y coordinate since SVG (0,0) is top-left
      const y = height - ((val - minVal) / valRange) * (height - 6) - 3;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    return `M ${points.join(' L ')}`;
  }, [chartData]);

  const handleSaveSettings = () => {
    const parsedData = rawChartData.split(',').map(x => parseFloat(x.trim())).filter(x => !isNaN(x));
    updateObject(obj.id, {
      style: {
        ...obj.style,
        metricTitle: title,
        metricValue: value,
        metricTrend: trend,
        metricChartData: parsedData.length > 0 ? parsedData : chartData
      }
    });
    setShowSettings(false);
  };

  return (
    <div className="flex flex-col h-full bg-[#18181b]/90 border border-white/5 rounded-2xl p-4 text-white justify-between select-none">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-emerald-500 flex items-center"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="3 17 9 11 13 15 21 7" /><polyline points="15 7 21 7 21 13" /></svg></span>
          <span className="text-xs font-semibold tracking-wide text-white/80">Live metric</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 text-[9px] font-bold uppercase tracking-wider flex items-center gap-1 animate-pulse">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Realtime
          </span>
          {isSelected && (
            <button 
              onClick={() => {
                setRawChartData(chartData.join(', '));
                setShowSettings(!showSettings);
              }} 
              className="text-white/40 hover:text-white text-xs p-1 rounded hover:bg-white/5 transition pointer-events-auto"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
            </button>
          )}
        </div>
      </div>

      {showSettings ? (
        <div className="flex flex-col gap-2 my-2 p-2 rounded bg-white/5 border border-white/10 pointer-events-auto">
          <div>
            <label className="text-[10px] text-white/50 block mb-0.5">Metric Label</label>
            <input
              type="text"
              value={title}
              onChange={(e) => updateObject(obj.id, { style: { ...obj.style, metricTitle: e.target.value } })}
              className="w-full bg-[#111] border border-white/10 rounded px-1.5 py-1 text-xs text-white"
            />
          </div>
          <div>
            <label className="text-[10px] text-white/50 block mb-0.5">Value</label>
            <input
              type="text"
              value={value}
              onChange={(e) => updateObject(obj.id, { style: { ...obj.style, metricValue: e.target.value } })}
              className="w-full bg-[#111] border border-white/10 rounded px-1.5 py-1 text-xs text-white"
            />
          </div>
          <div>
            <label className="text-[10px] text-white/50 block mb-0.5">Trend badge text</label>
            <input
              type="text"
              value={trend}
              onChange={(e) => updateObject(obj.id, { style: { ...obj.style, metricTrend: e.target.value } })}
              className="w-full bg-[#111] border border-white/10 rounded px-1.5 py-1 text-xs text-white"
            />
          </div>
          <div>
            <label className="text-[10px] text-white/50 block mb-0.5">Chart Datapoints (comma separated)</label>
            <input
              type="text"
              value={rawChartData}
              onChange={(e) => setRawChartData(e.target.value)}
              className="w-full bg-[#111] border border-white/10 rounded px-1.5 py-1 text-xs text-white font-mono"
            />
          </div>
          <button 
            onClick={handleSaveSettings}
            className="w-full mt-1 py-1 rounded bg-emerald-500 text-white font-bold text-xs hover:bg-emerald-600 transition"
          >
            Save
          </button>
        </div>
      ) : (
        <>
          <div className="my-2.5">
            <span className="text-[11px] text-white/50 tracking-wide block">{title}</span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-3xl font-extrabold tracking-tight text-white">{value}</span>
              <span className="text-[10px] font-bold text-emerald-400 flex items-center gap-0.5">
                {trend.startsWith('+') || trend.startsWith('↗') ? '↗' : '↘'} {trend}
              </span>
            </div>
          </div>

          {/* Sparkline Graph */}
          <div className="w-full h-8 mt-1 overflow-hidden relative">
            <svg className="w-full h-full" viewBox="0 0 240 30" preserveAspectRatio="none">
              <defs>
                <linearGradient id="metricGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgb(16,185,129)" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="rgb(16,185,129)" stopOpacity="0" />
                </linearGradient>
              </defs>
              {/* Fill path */}
              {chartData.length >= 2 && (
                <path 
                  d={`${pathD} L 240,30 L 0,30 Z`} 
                  fill="url(#metricGradient)" 
                  className="transition-all duration-700 ease-in-out"
                />
              )}
              {/* Sparkline stroke */}
              <path 
                d={pathD} 
                fill="none" 
                stroke="#10b981" 
                strokeWidth="2" 
                strokeLinecap="round"
                strokeLinejoin="round"
                className="transition-all duration-700 ease-in-out"
              />
            </svg>
          </div>
        </>
      )}
    </div>
  );
}

// --- QUICK DATA METADATA GRID TABLE ---
export function QuickDataBlock({ obj }: { obj: CanvasObjectData }) {
  const updateObject = useCanvasStore((s) => s.updateObject);
  const selectedId = useCanvasStore((s) => s.selectedId);
  const isSelected = selectedId === obj.id;

  const rows = (obj.style?.quickDataRows as Array<{ key: string; value: string }>) || [
    { key: 'Status', value: 'In progress' },
    { key: 'Owner', value: 'Priya D.' },
    { key: 'Due', value: 'June 14' },
    { key: 'Priority', value: 'High' }
  ];

  const [showSettings, setShowSettings] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  const addRow = () => {
    if (!newKey.trim()) return;
    const updated = [...rows, { key: newKey.trim(), value: newValue.trim() }];
    updateObject(obj.id, { style: { ...obj.style, quickDataRows: updated } });
    setNewKey('');
    setNewValue('');
  };

  const removeRow = (idx: number) => {
    const updated = rows.filter((_, i) => i !== idx);
    updateObject(obj.id, { style: { ...obj.style, quickDataRows: updated } });
  };

  const updateRowValue = (idx: number, val: string) => {
    const updated = rows.map((row, i) => i === idx ? { ...row, value: val } : row);
    updateObject(obj.id, { style: { ...obj.style, quickDataRows: updated } });
  };

  return (
    <div className="flex flex-col h-full bg-[#18181b]/90 border border-white/5 rounded-2xl p-4 text-white justify-between select-none">
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-1.5">
          <span className="text-amber-500 flex items-center"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="14" x2="21" y2="14" /><line x1="10" y1="9" x2="10" y2="20" /></svg></span>
          <span className="text-xs font-semibold tracking-wide text-white/80">Quick data</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 text-[9px] font-bold uppercase tracking-wider">
            Auto
          </span>
          {isSelected && (
            <button 
              onClick={() => setShowSettings(!showSettings)} 
              className="text-white/40 hover:text-white text-xs p-1 rounded hover:bg-white/5 transition pointer-events-auto"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col justify-start overflow-y-auto pr-0.5">
        {showSettings ? (
          <div className="flex flex-col gap-2 p-1.5 rounded bg-white/5 border border-white/10 pointer-events-auto">
            <span className="text-[10px] text-white/40 block border-b border-white/5 pb-1">Edit Key-Values</span>
            <div className="flex flex-col gap-1.5 max-h-[140px] overflow-y-auto">
              {rows.map((row, idx) => (
                <div key={idx} className="flex items-center gap-1">
                  <span className="text-[11px] font-medium text-white/50 w-1/3 truncate">{row.key}</span>
                  <input
                    type="text"
                    value={row.value}
                    onChange={(e) => updateRowValue(idx, e.target.value)}
                    className="w-1/2 bg-[#111] border border-white/10 rounded px-1 py-0.5 text-[11px] text-white"
                  />
                  <button 
                    onClick={() => removeRow(idx)}
                    className="text-red-400 hover:text-red-500 text-xs px-1"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>

            <div className="border-t border-white/5 pt-1.5 flex gap-1">
              <input
                type="text"
                placeholder="Key..."
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                className="w-1/2 bg-[#111] border border-white/10 rounded px-1 py-0.5 text-[10px] text-white"
              />
              <input
                type="text"
                placeholder="Val..."
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addRow()}
                className="w-1/2 bg-[#111] border border-white/10 rounded px-1 py-0.5 text-[10px] text-white"
              />
              <button 
                onClick={addRow}
                className="bg-amber-500 text-white px-2 py-0.5 rounded text-[10px] hover:bg-amber-600 transition"
              >
                +
              </button>
            </div>
            
            <button 
              onClick={() => setShowSettings(false)}
              className="w-full mt-1 py-1 rounded bg-amber-500 text-white font-bold text-[11px] hover:bg-amber-600 transition"
            >
              Done
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2 mt-1">
            {rows.map((row, idx) => {
              // Custom text color for certain priority/status terms
              let valColor = 'text-white/80';
              if (row.value.toLowerCase() === 'in progress') valColor = 'text-emerald-400';
              if (row.value.toLowerCase() === 'done') valColor = 'text-emerald-400';
              if (row.value.toLowerCase() === 'high') valColor = 'text-red-400';
              if (row.value.toLowerCase() === 'medium') valColor = 'text-amber-400';
              
              return (
                <div key={idx} className="flex justify-between items-center text-xs py-0.5">
                  <span className="text-white/40 font-medium tracking-wide">{row.key}</span>
                  <span className={`font-semibold ${valColor}`}>{row.value}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
