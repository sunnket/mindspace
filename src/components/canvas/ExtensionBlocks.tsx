'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useCanvasStore } from '@/store/canvasStore';
import { CanvasObjectData } from '@/lib/db';

/* ============================================================
   Shared bits — every block is a light "clay" tile that matches
   the app's cream design, and every piece of text is editable
   right where it sits (no hidden settings forms).
   ============================================================ */

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

/** Text that edits in place. Looks like a label until you click it. */
function Seamless({
  value,
  onChange,
  placeholder,
  className = '',
  center = false,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  center?: boolean;
}) {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onMouseDown={stop}
      onPointerDown={stop}
      onClick={stop}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      className={`w-full min-w-0 bg-transparent outline-none border-b border-transparent hover:border-[var(--border-strong)] focus:border-[var(--accent)] transition-colors cursor-text placeholder:text-[var(--text-muted)] ${center ? 'text-center' : ''} ${className}`}
      style={{ fontFamily: "'Outfit', sans-serif" }}
    />
  );
}

function BlockShell({
  tint,
  icon,
  tag,
  badge,
  children,
}: {
  tint: string;
  icon: React.ReactNode;
  tag: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex flex-col h-full w-full rounded-2xl p-4 pointer-events-auto"
      style={{
        background: '#FFFDFA',
        border: '1px solid rgba(201,123,75,0.16)',
        boxShadow:
          'inset 0 1.5px 0 rgba(255,255,255,0.95), 0 14px 28px -14px rgba(90,62,40,0.22), 0 3px 8px -4px rgba(90,62,40,0.08)',
        color: 'var(--text-primary)',
        fontFamily: "'Outfit', sans-serif",
      }}
    >
      <div className="flex items-center justify-between mb-2 shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className="w-5 h-5 rounded-md flex items-center justify-center shrink-0"
            style={{ background: `${tint}1E`, color: tint }}
          >
            {icon}
          </span>
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-tertiary)] truncate">
            {tag}
          </span>
        </div>
        {badge}
      </div>
      {children}
    </div>
  );
}

function Badge({ tint, children }: { tint: string; children: React.ReactNode }) {
  return (
    <span
      className="px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wider shrink-0 tabular-nums"
      style={{ background: `${tint}1A`, color: tint }}
    >
      {children}
    </span>
  );
}

function MiniIcon({ children, size = 11 }: { children: React.ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

/* ============================================================
   COUNTDOWN — ticking timer to an editable date
   ============================================================ */

export function CountdownBlock({ obj }: { obj: CanvasObjectData }) {
  const updateObject = useCanvasStore((s) => s.updateObject);
  const tint = '#C97B4B';

  const targetDateStr = (obj.style?.countdownDate as string) || '2026-06-14T09:00:00';
  const title = (obj.style?.countdownTitle as string) || 'Launch day';
  const targetTime = useMemo(() => new Date(targetDateStr).getTime(), [targetDateStr]);

  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0, total: 0 });

  useEffect(() => {
    function calculate() {
      const diff = targetTime - Date.now();
      if (diff <= 0) {
        setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0, total: 0 });
        return;
      }
      setTimeLeft({
        days: Math.floor(diff / 86_400_000),
        hours: Math.floor((diff / 3_600_000) % 24),
        minutes: Math.floor((diff / 60_000) % 60),
        seconds: Math.floor((diff / 1000) % 60),
        total: diff,
      });
    }
    calculate();
    const interval = setInterval(calculate, 1000);
    return () => clearInterval(interval);
  }, [targetTime]);

  const patch = (kv: Record<string, unknown>) =>
    updateObject(obj.id, { style: { ...obj.style, ...kv } });

  const maxDuration = 30 * 86_400_000;
  const pct = Math.max(0, Math.min(100, (timeLeft.total / maxDuration) * 100));
  const radius = 30;
  const circumference = 2 * Math.PI * radius;
  const done = timeLeft.total <= 0;

  return (
    <BlockShell
      tint={tint}
      tag="countdown"
      icon={<MiniIcon><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15.5 14" /></MiniIcon>}
      badge={<Badge tint={done ? '#2F9E6E' : tint}>{done ? 'done' : 'ticking'}</Badge>}
    >
      <Seamless
        value={title}
        onChange={(v) => patch({ countdownTitle: v })}
        placeholder="What are you counting down to?"
        className="text-[13px] font-bold"
      />

      <div className="flex justify-center items-center my-2.5 relative shrink-0">
        <svg width="72" height="72" className="-rotate-90">
          <circle cx="36" cy="36" r={radius} fill="transparent" stroke="rgba(90,62,40,0.08)" strokeWidth="5" />
          <circle
            cx="36" cy="36" r={radius}
            fill="transparent" stroke={tint} strokeWidth="5"
            strokeDasharray={circumference}
            strokeDashoffset={circumference - (pct / 100) * circumference}
            strokeLinecap="round"
            className="transition-all duration-1000"
          />
        </svg>
        <span className="absolute text-lg font-extrabold tabular-nums" style={{ color: tint }}>
          {timeLeft.days > 0 ? `${timeLeft.days}d` : `${timeLeft.hours}h`}
        </span>
      </div>

      <div className="grid grid-cols-4 gap-1.5 text-center shrink-0">
        {[
          { val: timeLeft.days, label: 'days' },
          { val: timeLeft.hours, label: 'hrs' },
          { val: timeLeft.minutes, label: 'min' },
          { val: timeLeft.seconds, label: 'sec' },
        ].map((digit, i) => (
          <div key={i} className="rounded-xl py-1.5" style={{ background: '#F5EFE7', boxShadow: 'inset 0 1.5px 4px rgba(90,62,40,0.08)' }}>
            <span className="block text-base font-extrabold tabular-nums leading-tight">{String(digit.val).padStart(2, '0')}</span>
            <span className="block text-[8px] text-[var(--text-tertiary)] uppercase tracking-widest font-bold">{digit.label}</span>
          </div>
        ))}
      </div>

      {/* the date itself is the editor — click it and pick */}
      <input
        type="datetime-local"
        value={targetDateStr.slice(0, 16)}
        onChange={(e) => patch({ countdownDate: e.target.value })}
        onMouseDown={stop}
        onPointerDown={stop}
        onClick={stop}
        className="mt-2.5 w-full text-center text-[10px] font-semibold text-[var(--text-secondary)] bg-transparent outline-none rounded-lg py-1 hover:bg-[#F5EFE7] focus:bg-[#F5EFE7] dark:hover:bg-white/10 dark:focus:bg-white/10 transition-colors cursor-pointer"
      />
    </BlockShell>
  );
}

/* ============================================================
   POLL — question, options and votes, all editable in place
   ============================================================ */

export function PollBlock({ obj }: { obj: CanvasObjectData }) {
  const updateObject = useCanvasStore((s) => s.updateObject);
  const tint = '#8B5FBF';

  const question = (obj.style?.pollQuestion as string) || '';
  const options = (obj.style?.pollOptions as Array<{ id: string; text: string; votes: number }>) || [];
  const [newOption, setNewOption] = useState('');

  const totalVotes = useMemo(() => options.reduce((s, o) => s + o.votes, 0), [options]);
  const patch = (kv: Record<string, unknown>) =>
    updateObject(obj.id, { style: { ...obj.style, ...kv } });

  const vote = (id: string) =>
    patch({ pollOptions: options.map((o) => (o.id === id ? { ...o, votes: o.votes + 1 } : o)) });
  const rename = (id: string, text: string) =>
    patch({ pollOptions: options.map((o) => (o.id === id ? { ...o, text } : o)) });
  const remove = (id: string) => patch({ pollOptions: options.filter((o) => o.id !== id) });
  const add = () => {
    const text = newOption.trim();
    if (!text) return;
    patch({ pollOptions: [...options, { id: Math.random().toString(36).slice(2, 9), text, votes: 0 }] });
    setNewOption('');
  };

  return (
    <BlockShell
      tint={tint}
      tag="team vote"
      icon={<MiniIcon><line x1="6" y1="20" x2="6" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="18" y1="20" x2="18" y2="14" /></MiniIcon>}
      badge={<Badge tint={tint}>{totalVotes} {totalVotes === 1 ? 'vote' : 'votes'}</Badge>}
    >
      <Seamless
        value={question}
        onChange={(v) => patch({ pollQuestion: v })}
        placeholder="Ask your question…"
        className="text-[13px] font-bold mb-2"
      />

      <div className="flex flex-col gap-1.5 flex-1 overflow-y-auto min-h-0">
        {options.map((opt) => {
          const pct = totalVotes > 0 ? Math.round((opt.votes / totalVotes) * 100) : 0;
          return (
            <div key={opt.id} className="relative group/opt rounded-xl overflow-hidden" style={{ background: '#F5EFE7' }}>
              {/* fill */}
              <div
                className="absolute inset-y-0 left-0 transition-all duration-500 ease-out"
                style={{ width: `${pct}%`, background: `${tint}26` }}
              />
              <div className="relative flex items-center gap-1.5 px-2.5 py-1.5">
                {/* vote target */}
                <button
                  onClick={(e) => { stop(e); vote(opt.id); }}
                  onMouseDown={stop}
                  onPointerDown={stop}
                  title="Vote for this"
                  className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center cursor-pointer transition-transform active:scale-90 hover:scale-110"
                  style={{ background: `${tint}22`, color: tint }}
                >
                  <MiniIcon size={10}><path d="M7 10v12M15 5.88L14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88z" /></MiniIcon>
                </button>
                <Seamless
                  value={opt.text}
                  onChange={(v) => rename(opt.id, v)}
                  placeholder="option"
                  className="text-[11.5px] font-semibold flex-1"
                />
                <span className="text-[10px] font-extrabold tabular-nums shrink-0" style={{ color: tint }}>{pct}%</span>
                <button
                  onClick={(e) => { stop(e); remove(opt.id); }}
                  onMouseDown={stop}
                  onPointerDown={stop}
                  aria-label="Remove option"
                  className="shrink-0 w-4 h-4 rounded-full items-center justify-center text-[var(--text-muted)] hover:text-red-500 hidden group-hover/opt:flex cursor-pointer"
                >
                  <MiniIcon size={9}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></MiniIcon>
                </button>
              </div>
            </div>
          );
        })}

        {/* add option inline */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl border border-dashed border-[var(--border-strong)]">
          <span className="text-[var(--text-muted)] shrink-0">
            <MiniIcon size={10}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></MiniIcon>
          </span>
          <input
            type="text"
            value={newOption}
            placeholder="add an option…"
            onChange={(e) => setNewOption(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            onBlur={add}
            onMouseDown={stop}
            onPointerDown={stop}
            onClick={stop}
            className="w-full bg-transparent outline-none text-[11px] font-medium placeholder:text-[var(--text-muted)] cursor-text"
          />
        </div>
      </div>

      <div className="text-[9px] text-[var(--text-tertiary)] font-semibold pt-2 mt-1 border-t border-[var(--border)] shrink-0">
        tap the thumb to vote · click any text to edit it
      </div>
    </BlockShell>
  );
}

/* ============================================================
   LIVE METRIC — headline number + sparkline, edit in place
   ============================================================ */

export function LiveMetricBlock({ obj }: { obj: CanvasObjectData }) {
  const updateObject = useCanvasStore((s) => s.updateObject);
  const selectedId = useCanvasStore((s) => s.selectedId);
  const isSelected = selectedId === obj.id;
  const tint = '#2F9E6E';

  const title = (obj.style?.metricTitle as string) || '';
  const value = (obj.style?.metricValue as string) || '';
  const trend = (obj.style?.metricTrend as string) || '';
  const chartData = (obj.style?.metricChartData as number[]) || [60, 62, 61, 65, 68, 70, 71.3];
  const [rawData, setRawData] = useState(chartData.join(', '));

  const patch = (kv: Record<string, unknown>) =>
    updateObject(obj.id, { style: { ...obj.style, ...kv } });

  const pathD = useMemo(() => {
    if (chartData.length < 2) return '';
    const w = 240; const h = 30;
    const min = Math.min(...chartData); const max = Math.max(...chartData);
    const range = max - min || 1;
    const pts = chartData.map((v, i) => `${((i / (chartData.length - 1)) * w).toFixed(1)},${(h - ((v - min) / range) * (h - 6) - 3).toFixed(1)}`);
    return `M ${pts.join(' L ')}`;
  }, [chartData]);

  const trendUp = trend.trim().startsWith('+') || trend.includes('up');

  return (
    <BlockShell
      tint={tint}
      tag="live metric"
      icon={<MiniIcon><polyline points="3 17 9 11 13 15 21 7" /><polyline points="15 7 21 7 21 13" /></MiniIcon>}
      badge={<Badge tint={tint}>live</Badge>}
    >
      <Seamless value={title} onChange={(v) => patch({ metricTitle: v })} placeholder="metric name" className="text-[11px] font-semibold text-[var(--text-secondary)]" />

      <div className="flex items-baseline gap-2 mt-1 mb-1">
        <Seamless value={value} onChange={(v) => patch({ metricValue: v })} placeholder="0" className="text-[26px] font-extrabold tracking-tight tabular-nums !w-auto" />
        <span className="flex items-center gap-0.5 shrink-0" style={{ color: trendUp ? '#2F9E6E' : '#D64545' }}>
          <MiniIcon size={10}>{trendUp ? <polyline points="3 17 9 11 13 15 21 7" /> : <polyline points="3 7 9 13 13 9 21 17" />}</MiniIcon>
        </span>
        <Seamless value={trend} onChange={(v) => patch({ metricTrend: v })} placeholder="+0% this week" className={`text-[10px] font-bold !w-auto flex-1 ${trendUp ? 'text-[#2F9E6E]' : 'text-[#D64545]'}`} />
      </div>

      <div className="w-full h-9 overflow-hidden">
        <svg className="w-full h-full" viewBox="0 0 240 30" preserveAspectRatio="none">
          <defs>
            <linearGradient id={`mg-${obj.id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={tint} stopOpacity="0.22" />
              <stop offset="100%" stopColor={tint} stopOpacity="0" />
            </linearGradient>
          </defs>
          {chartData.length >= 2 && <path d={`${pathD} L 240,30 L 0,30 Z`} fill={`url(#mg-${obj.id})`} />}
          <path d={pathD} fill="none" stroke={tint} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      {/* data points editable when the block is selected */}
      {isSelected && (
        <input
          type="text"
          value={rawData}
          onChange={(e) => setRawData(e.target.value)}
          onBlur={() => {
            const parsed = rawData.split(',').map((x) => parseFloat(x.trim())).filter((x) => !isNaN(x));
            if (parsed.length >= 2) patch({ metricChartData: parsed });
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          onMouseDown={stop}
          onPointerDown={stop}
          onClick={stop}
          title="Chart datapoints (comma separated)"
          className="mt-1 w-full bg-[#F5EFE7] dark:bg-white/10 rounded-lg px-2 py-1 text-[9px] font-mono text-[var(--text-secondary)] outline-none focus:ring-1 focus:ring-[var(--accent)]/40 cursor-text tabular-nums"
        />
      )}
    </BlockShell>
  );
}

/* ============================================================
   QUICK DATA — key/value grid, every cell editable in place
   ============================================================ */

export function QuickDataBlock({ obj }: { obj: CanvasObjectData }) {
  const updateObject = useCanvasStore((s) => s.updateObject);
  const tint = '#C9904B';

  const rows = (obj.style?.quickDataRows as Array<{ key: string; value: string }>) || [];
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  const patch = (kv: Record<string, unknown>) =>
    updateObject(obj.id, { style: { ...obj.style, ...kv } });

  const setRow = (idx: number, part: 'key' | 'value', v: string) =>
    patch({ quickDataRows: rows.map((r, i) => (i === idx ? { ...r, [part]: v } : r)) });
  const removeRow = (idx: number) => patch({ quickDataRows: rows.filter((_, i) => i !== idx) });
  const addRow = () => {
    if (!newKey.trim() && !newValue.trim()) return;
    patch({ quickDataRows: [...rows, { key: newKey.trim() || 'key', value: newValue.trim() }] });
    setNewKey('');
    setNewValue('');
  };

  const valueColor = (v: string) => {
    const s = v.toLowerCase();
    if (s === 'done' || s === 'in progress' || s === 'active') return '#2F9E6E';
    if (s === 'high' || s === 'blocked' || s === 'urgent') return '#D64545';
    if (s === 'medium' || s === 'pending') return '#C9904B';
    return 'var(--text-primary)';
  };

  return (
    <BlockShell
      tint={tint}
      tag="quick data"
      icon={<MiniIcon><rect x="3" y="4" width="18" height="16" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="14" x2="21" y2="14" /><line x1="10" y1="9" x2="10" y2="20" /></MiniIcon>}
      badge={<Badge tint={tint}>{rows.length} rows</Badge>}
    >
      <div className="flex-1 flex flex-col gap-0.5 overflow-y-auto min-h-0">
        {rows.map((row, idx) => (
          <div key={idx} className="group/row flex items-center gap-2 py-1 border-b border-[var(--border)] last:border-b-0">
            <Seamless value={row.key} onChange={(v) => setRow(idx, 'key', v)} placeholder="key" className="text-[10.5px] font-semibold text-[var(--text-tertiary)] !w-[38%] shrink-0" />
            <input
              type="text"
              value={row.value}
              onChange={(e) => setRow(idx, 'value', e.target.value)}
              onMouseDown={stop}
              onPointerDown={stop}
              onClick={stop}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              placeholder="value"
              className="flex-1 min-w-0 bg-transparent outline-none text-[11.5px] font-bold text-right cursor-text border-b border-transparent hover:border-[var(--border-strong)] focus:border-[var(--accent)] transition-colors"
              style={{ color: valueColor(row.value), fontFamily: "'Outfit', sans-serif" }}
            />
            <button
              onClick={(e) => { stop(e); removeRow(idx); }}
              onMouseDown={stop}
              onPointerDown={stop}
              aria-label="Remove row"
              className="w-4 h-4 rounded-full items-center justify-center text-[var(--text-muted)] hover:text-red-500 hidden group-hover/row:flex shrink-0 cursor-pointer"
            >
              <MiniIcon size={9}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></MiniIcon>
            </button>
          </div>
        ))}

        {/* add row inline */}
        <div className="flex items-center gap-2 py-1.5 mt-0.5 rounded-lg">
          <input
            type="text" value={newKey} placeholder="+ key"
            onChange={(e) => setNewKey(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addRow()}
            onMouseDown={stop} onPointerDown={stop} onClick={stop}
            className="w-[38%] shrink-0 bg-[#F5EFE7] dark:bg-white/10 rounded-md px-1.5 py-1 text-[10px] font-semibold outline-none focus:ring-1 focus:ring-[var(--accent)]/40 cursor-text placeholder:text-[var(--text-muted)]"
          />
          <input
            type="text" value={newValue} placeholder="value"
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addRow()}
            onBlur={addRow}
            onMouseDown={stop} onPointerDown={stop} onClick={stop}
            className="flex-1 min-w-0 bg-[#F5EFE7] dark:bg-white/10 rounded-md px-1.5 py-1 text-[10px] font-semibold outline-none focus:ring-1 focus:ring-[var(--accent)]/40 cursor-text placeholder:text-[var(--text-muted)]"
          />
        </div>
      </div>
    </BlockShell>
  );
}

/* ============================================================
   FOCUS TIMER — stopwatch with start / pause / reset
   ============================================================ */

export function FocusTimerBlock({ obj }: { obj: CanvasObjectData }) {
  const updateObject = useCanvasStore((s) => s.updateObject);
  const tint = '#3E63DD';

  const label = (obj.style?.timerLabel as string) || '';
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [running]);

  const patch = (kv: Record<string, unknown>) =>
    updateObject(obj.id, { style: { ...obj.style, ...kv } });

  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');

  const Btn = ({ onClick, children, primary = false, label: aria }: { onClick: () => void; children: React.ReactNode; primary?: boolean; label: string }) => (
    <button
      onClick={(e) => { stop(e); onClick(); }}
      onMouseDown={stop}
      onPointerDown={stop}
      aria-label={aria}
      className="h-8 px-4 rounded-full text-[11px] font-bold flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer"
      style={primary
        ? { background: tint, color: '#fff', boxShadow: `0 6px 14px -6px ${tint}AA, inset 0 1px 0 rgba(255,255,255,0.3)` }
        : { background: '#F5EFE7', color: 'var(--text-secondary)', boxShadow: 'inset 0 1.5px 4px rgba(90,62,40,0.08)' }}
    >
      {children}
    </button>
  );

  return (
    <BlockShell
      tint={tint}
      tag="focus timer"
      icon={<MiniIcon><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2 2M9 2h6" /></MiniIcon>}
      badge={<Badge tint={running ? '#2F9E6E' : tint}>{running ? 'focusing' : 'paused'}</Badge>}
    >
      <Seamless
        value={label}
        onChange={(v) => patch({ timerLabel: v })}
        placeholder="What are you focusing on?"
        className="text-[12px] font-semibold text-[var(--text-secondary)]"
      />

      <div className="flex-1 flex items-center justify-center py-1">
        <span className="text-[40px] font-extrabold tracking-tight tabular-nums leading-none" style={{ color: running ? tint : 'var(--text-primary)' }}>
          {mm}:{ss}
        </span>
      </div>

      <div className="flex justify-center gap-2 shrink-0">
        <Btn primary onClick={() => setRunning((r) => !r)} label={running ? 'Pause' : 'Start'}>
          <MiniIcon size={10}>{running ? (<><line x1="9" y1="5" x2="9" y2="19" /><line x1="15" y1="5" x2="15" y2="19" /></>) : (<polygon points="6 4 20 12 6 20 6 4" />)}</MiniIcon>
          {running ? 'Pause' : 'Start'}
        </Btn>
        <Btn onClick={() => { setRunning(false); setElapsed(0); }} label="Reset">
          <MiniIcon size={10}><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></MiniIcon>
          Reset
        </Btn>
      </div>
    </BlockShell>
  );
}

/* ============================================================
   DECISION SPINNER — add choices, spin, let fate decide
   ============================================================ */

export function DecisionBlock({ obj }: { obj: CanvasObjectData }) {
  const updateObject = useCanvasStore((s) => s.updateObject);
  const tint = '#E93D82';

  const title = (obj.style?.decisionTitle as string) || '';
  const options = (obj.style?.decisionOptions as string[]) || [];
  const result = (obj.style?.decisionResult as string) || '';
  const [newChoice, setNewChoice] = useState('');
  const [spinIndex, setSpinIndex] = useState<number | null>(null);
  const [spinning, setSpinning] = useState(false);
  const timeouts = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => timeouts.current.forEach(clearTimeout), []);

  const patch = (kv: Record<string, unknown>) =>
    updateObject(obj.id, { style: { ...obj.style, ...kv } });

  const spin = () => {
    if (spinning || options.length < 2) return;
    setSpinning(true);
    patch({ decisionResult: '' });
    const winner = Math.floor(Math.random() * options.length);
    const steps = 12 + winner;
    let delay = 0;
    for (let i = 1; i <= steps; i++) {
      delay += 45 + Math.pow(i / steps, 2) * 190;
      const idx = i % options.length;
      const isLast = i === steps;
      const t = setTimeout(() => {
        setSpinIndex(idx);
        if (isLast) {
          const land = setTimeout(() => {
            setSpinIndex(winner);
            setSpinning(false);
            patch({ decisionResult: options[winner] });
          }, 230);
          timeouts.current.push(land);
        }
      }, delay);
      timeouts.current.push(t);
    }
  };

  const removeChoice = (idx: number) => patch({ decisionOptions: options.filter((_, i) => i !== idx), decisionResult: '' });
  const renameChoice = (idx: number, v: string) => patch({ decisionOptions: options.map((o, i) => (i === idx ? v : o)) });
  const addChoice = () => {
    const v = newChoice.trim();
    if (!v) return;
    patch({ decisionOptions: [...options, v], decisionResult: '' });
    setNewChoice('');
  };

  return (
    <BlockShell
      tint={tint}
      tag="decision spinner"
      icon={<MiniIcon><polyline points="16 3 21 3 21 8" /><line x1="4" y1="20" x2="21" y2="3" /><polyline points="21 16 21 21 16 21" /><line x1="15" y1="15" x2="21" y2="21" /><line x1="4" y1="4" x2="9" y2="9" /></MiniIcon>}
      badge={<Badge tint={tint}>{options.length} choices</Badge>}
    >
      <Seamless
        value={title}
        onChange={(v) => patch({ decisionTitle: v })}
        placeholder="What can't you decide?"
        className="text-[13px] font-bold mb-2"
      />

      <div className="flex flex-wrap gap-1.5 flex-1 content-start overflow-y-auto min-h-0">
        {options.map((option, idx) => {
          const active = spinIndex === idx;
          const won = !spinning && result === option && result !== '';
          return (
            <span
              key={idx}
              className="group/chip inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-full transition-all duration-150"
              style={{
                background: won ? tint : active ? `${tint}33` : '#F5EFE7',
                color: won ? '#fff' : 'var(--text-primary)',
                transform: active || won ? 'scale(1.06)' : 'scale(1)',
                boxShadow: won ? `0 6px 14px -6px ${tint}AA` : 'inset 0 1px 3px rgba(90,62,40,0.07)',
              }}
            >
              <input
                type="text"
                value={option}
                onChange={(e) => renameChoice(idx, e.target.value)}
                onMouseDown={stop} onPointerDown={stop} onClick={stop}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                className="bg-transparent outline-none text-[11px] font-bold cursor-text"
                style={{ width: `${Math.max(option.length, 3)}ch`, color: 'inherit', fontFamily: "'Outfit', sans-serif" }}
              />
              <button
                onClick={(e) => { stop(e); removeChoice(idx); }}
                onMouseDown={stop} onPointerDown={stop}
                aria-label="Remove choice"
                className="w-3.5 h-3.5 rounded-full items-center justify-center opacity-0 group-hover/chip:opacity-70 hover:!opacity-100 cursor-pointer hidden group-hover/chip:flex"
              >
                <MiniIcon size={8}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></MiniIcon>
              </button>
            </span>
          );
        })}

        <input
          type="text"
          value={newChoice}
          placeholder="+ choice"
          onChange={(e) => setNewChoice(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addChoice()}
          onBlur={addChoice}
          onMouseDown={stop} onPointerDown={stop} onClick={stop}
          className="px-2.5 py-1 rounded-full border border-dashed border-[var(--border-strong)] bg-transparent outline-none text-[11px] font-semibold w-[9ch] focus:w-[14ch] transition-all cursor-text placeholder:text-[var(--text-muted)]"
        />
      </div>

      <div className="flex items-center gap-2 pt-2.5 mt-1 border-t border-[var(--border)] shrink-0">
        <button
          onClick={(e) => { stop(e); spin(); }}
          onMouseDown={stop} onPointerDown={stop}
          disabled={spinning || options.length < 2}
          className="h-8 px-4 rounded-full text-[11px] font-bold text-white flex items-center gap-1.5 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          style={{ background: tint, boxShadow: `0 6px 14px -6px ${tint}AA, inset 0 1px 0 rgba(255,255,255,0.3)` }}
        >
          <MiniIcon size={10}><polyline points="16 3 21 3 21 8" /><line x1="4" y1="20" x2="21" y2="3" /></MiniIcon>
          {spinning ? 'deciding…' : 'Decide for me'}
        </button>
        {result && !spinning && (
          <span className="text-[11px] font-bold truncate" style={{ color: tint }}>
            → {result}
          </span>
        )}
      </div>
    </BlockShell>
  );
}

/* ============================================================
   PROGRESS GOAL — a fat clay bar you drag to update
   ============================================================ */

export function ProgressBlock({ obj }: { obj: CanvasObjectData }) {
  const updateObject = useCanvasStore((s) => s.updateObject);
  const tint = '#2F9E6E';

  const label = (obj.style?.progressLabel as string) || '';
  const value = Math.max(0, Math.min(100, (obj.style?.progressValue as number) ?? 0));
  const trackRef = useRef<HTMLDivElement>(null);

  const patch = useCallback(
    (kv: Record<string, unknown>) => updateObject(obj.id, { style: { ...obj.style, ...kv } }),
    [updateObject, obj.id, obj.style]
  );

  const setFromClientX = useCallback((clientX: number) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const pct = Math.round(Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * 100);
    patch({ progressValue: pct });
  }, [patch]);

  const startDrag = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setFromClientX(e.clientX);
    const move = (ev: PointerEvent) => setFromClientX(ev.clientX);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const done = value >= 100;

  return (
    <BlockShell
      tint={tint}
      tag="progress goal"
      icon={<MiniIcon><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" fill="currentColor" /></MiniIcon>}
      badge={<Badge tint={done ? '#C9904B' : tint}>{done ? 'complete' : `${value}%`}</Badge>}
    >
      <Seamless
        value={label}
        onChange={(v) => patch({ progressLabel: v })}
        placeholder="Name your goal…"
        className="text-[13px] font-bold"
      />

      <div className="flex-1 flex flex-col justify-center gap-2 py-1.5">
        {/* draggable clay track */}
        <div
          ref={trackRef}
          onPointerDown={startDrag}
          onMouseDown={stop}
          onClick={stop}
          role="slider"
          aria-valuenow={value}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Progress"
          className="relative h-6 rounded-full cursor-ew-resize touch-none"
          style={{ background: '#F5EFE7', boxShadow: 'inset 0 2px 5px rgba(90,62,40,0.12)' }}
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-150"
            style={{
              width: `${value}%`,
              background: `linear-gradient(180deg, ${tint}E6, ${tint})`,
              boxShadow: `inset 0 1.5px 0 rgba(255,255,255,0.4), 0 2px 6px -2px ${tint}99`,
              minWidth: value > 0 ? '1.5rem' : 0,
            }}
          />
          {/* handle */}
          <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-white transition-[left] duration-150 pointer-events-none"
            style={{ left: `${value}%`, boxShadow: '0 2px 6px rgba(90,62,40,0.35), inset 0 1px 0 #fff' }}
          />
        </div>

        <div className="flex justify-between text-[9px] font-bold text-[var(--text-muted)] tabular-nums px-0.5 select-none">
          <span>0</span><span>25</span><span>50</span><span>75</span><span>100</span>
        </div>
      </div>

      <div className="flex items-center justify-between shrink-0">
        <div className="flex gap-1">
          {[-10, -5, +5, +10].map((step) => (
            <button
              key={step}
              onClick={(e) => { stop(e); patch({ progressValue: Math.max(0, Math.min(100, value + step)) }); }}
              onMouseDown={stop} onPointerDown={stop}
              className="px-2 py-1 rounded-lg text-[9.5px] font-extrabold tabular-nums text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
              style={{ background: '#F5EFE7', boxShadow: 'inset 0 1px 3px rgba(90,62,40,0.07)' }}
            >
              {step > 0 ? `+${step}` : step}
            </button>
          ))}
        </div>
        <span className="text-lg font-extrabold tabular-nums" style={{ color: done ? '#C9904B' : tint }}>{value}%</span>
      </div>
    </BlockShell>
  );
}
