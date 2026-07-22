'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useCanvasStore } from '@/store/canvasStore';
import { CanvasObjectData } from '@/lib/db';
import {
  TimelineItem,
  TIMELINE_COLORS,
  readTimelineItems,
  timelineRange,
  parseISODate,
  toISODate,
  addDays,
  daysBetween,
} from '@/lib/timeline';

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
      className="flex flex-col h-full w-full rounded-2xl pointer-events-auto bg-[#FFFDFA] dark:bg-[var(--bg-secondary)] border border-[rgba(var(--accent-rgb),0.16)] dark:border-white/10 shadow-[inset_0_1.5px_0_rgba(255,255,255,0.95),0_14px_28px_-14px_rgba(90,62,40,0.22),0_3px_8px_-4px_rgba(90,62,40,0.08)] dark:shadow-[0_14px_28px_-14px_rgba(0,0,0,0.6),0_3px_8px_-4px_rgba(0,0,0,0.5)]"
      style={{
        color: 'var(--text-primary)',
        fontFamily: "'Outfit', sans-serif",
        // Tailwind p-* is dead in this app (unlayered global reset) — all
        // block padding must be inline. Same story for every margin below.
        padding: '14px 16px',
      }}
    >
      <div className="flex items-center justify-between shrink-0" style={{ marginBottom: 8 }}>
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
      className="rounded-full text-[9px] font-extrabold uppercase tracking-wider shrink-0 tabular-nums"
      style={{ background: `${tint}1A`, color: tint, padding: '2.5px 8px' }}
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
  // The ring warms up as the moment gets close: green-ish far out is wrong for
  // a deadline — clay normally, red inside the final 24 hours.
  const urgent = !done && timeLeft.total < 86_400_000;
  const ringColor = done ? '#2F9E6E' : urgent ? '#D64545' : tint;

  return (
    <BlockShell
      tint={ringColor}
      tag="countdown"
      icon={<MiniIcon><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15.5 14" /></MiniIcon>}
      badge={<Badge tint={ringColor}>{done ? 'it’s here' : urgent ? 'final day' : 'ticking'}</Badge>}
    >
      <Seamless
        value={title}
        onChange={(v) => patch({ countdownTitle: v })}
        placeholder="What are you counting down to?"
        className="text-[13px] font-bold"
      />

      <div className="flex justify-center items-center relative shrink-0" style={{ margin: '10px 0' }}>
        <svg width="72" height="72" className="-rotate-90">
          <circle cx="36" cy="36" r={radius} fill="transparent" stroke="var(--track)" strokeWidth="5" />
          <circle
            cx="36" cy="36" r={radius}
            fill="transparent" stroke={ringColor} strokeWidth="5"
            strokeDasharray={circumference}
            strokeDashoffset={done ? 0 : circumference - (pct / 100) * circumference}
            strokeLinecap="round"
            className="transition-all duration-1000"
          />
        </svg>
        <span className="absolute text-lg font-extrabold tabular-nums" style={{ color: ringColor }}>
          {done ? '🎉' : timeLeft.days > 0 ? `${timeLeft.days}d` : `${timeLeft.hours}h`}
        </span>
      </div>

      {done ? (
        <div className="text-center shrink-0 rounded-xl" style={{ padding: '8px 10px', background: 'rgba(47,158,110,0.1)' }}>
          <span className="text-[12px] font-bold" style={{ color: '#2F9E6E' }}>The day has arrived!</span>
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-1.5 text-center shrink-0">
          {[
            { val: timeLeft.days, label: 'days' },
            { val: timeLeft.hours, label: 'hrs' },
            { val: timeLeft.minutes, label: 'min' },
            { val: timeLeft.seconds, label: 'sec' },
          ].map((digit, i) => (
            <div key={i} className="rounded-xl" style={{ background: 'var(--well)', boxShadow: 'var(--well-inset)', padding: '6px 0' }}>
              <span className="block text-base font-extrabold tabular-nums leading-tight">{String(digit.val).padStart(2, '0')}</span>
              <span className="block text-[8px] text-[var(--text-tertiary)] uppercase tracking-widest font-bold">{digit.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* the date itself is the editor — click it and pick */}
      <input
        type="datetime-local"
        value={targetDateStr.slice(0, 16)}
        onChange={(e) => patch({ countdownDate: e.target.value })}
        onMouseDown={stop}
        onPointerDown={stop}
        onClick={stop}
        className="w-full text-center text-[10px] font-semibold text-[var(--text-secondary)] bg-transparent outline-none rounded-lg hover:bg-[#F5EFE7] focus:bg-[#F5EFE7] dark:hover:bg-white/10 dark:focus:bg-white/10 transition-colors cursor-pointer"
        style={{ marginTop: 10, padding: '4px 8px' }}
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
          const leading = totalVotes > 0 && opt.votes > 0 && opt.votes === Math.max(...options.map((o) => o.votes));
          return (
            <div key={opt.id} className="relative group/opt rounded-xl overflow-hidden" style={{ background: 'var(--well)' }}>
              {/* fill */}
              <div
                className="absolute inset-y-0 left-0 transition-all duration-500 ease-out"
                style={{ width: `${pct}%`, background: leading ? `${tint}38` : `${tint}26` }}
              />
              <div className="relative flex items-center gap-1.5" style={{ padding: '6px 10px' }}>
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
                {leading && <span className="text-[9px] shrink-0" title="In the lead" aria-label="In the lead">👑</span>}
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
        <div className="flex items-center gap-1.5 rounded-xl border border-dashed border-[var(--border-strong)]" style={{ padding: '4px 10px' }}>
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

      <div className="flex items-center justify-between border-t border-[var(--border)] shrink-0" style={{ paddingTop: 8, marginTop: 4 }}>
        <span className="text-[9px] text-[var(--text-tertiary)] font-semibold">tap the thumb to vote</span>
        {totalVotes > 0 && (
          <button
            onClick={(e) => { stop(e); patch({ pollOptions: options.map((o) => ({ ...o, votes: 0 })) }); }}
            onMouseDown={stop} onPointerDown={stop}
            title="Reset all votes"
            className="text-[9px] font-bold text-[var(--text-muted)] hover:text-red-500 transition-colors cursor-pointer"
          >
            reset votes
          </button>
        )}
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

  // Data-entry first: a freshly inserted metric asks for its numbers before it
  // renders the sparkline. Existing/agent-made metrics (no metricSetup flag)
  // skip straight to the live view.
  const setup = obj.style?.metricSetup === true;
  const [sTitle, setSTitle] = useState(title);
  const [sValue, setSValue] = useState(value);
  const [sTrend, setSTrend] = useState(trend);
  const [sData, setSData] = useState((obj.style?.metricChartData as number[] | undefined)?.join(', ') || '');

  // All hooks must run before any conditional return (Rules of Hooks), so the
  // sparkline path + trend are computed up here even in setup mode.
  const pathD = useMemo(() => {
    if (chartData.length < 2) return '';
    const w = 240; const h = 30;
    const min = Math.min(...chartData); const max = Math.max(...chartData);
    const range = max - min || 1;
    const pts = chartData.map((v, i) => `${((i / (chartData.length - 1)) * w).toFixed(1)},${(h - ((v - min) / range) * (h - 6) - 3).toFixed(1)}`);
    return `M ${pts.join(' L ')}`;
  }, [chartData]);
  const trendUp = trend.trim().startsWith('+') || trend.includes('up');

  if (setup) {
    const finish = () => {
      const parsed = sData.split(',').map((x) => parseFloat(x.trim())).filter((x) => !isNaN(x));
      patch({
        metricTitle: sTitle.trim() || 'Metric',
        metricValue: sValue.trim() || '0',
        metricTrend: sTrend.trim(),
        metricChartData: parsed.length >= 2 ? parsed : [0, 0],
        metricSetup: false,
      });
    };
    return (
      <BlockShell
        tint={tint}
        tag="live metric"
        icon={<MiniIcon><polyline points="3 17 9 11 13 15 21 7" /><polyline points="15 7 21 7 21 13" /></MiniIcon>}
        badge={<Badge tint={tint}>set up</Badge>}
      >
        <p className="text-[11.5px] font-bold text-[var(--text-primary)]" style={{ marginBottom: 6 }}>Fill in your metric</p>
        <div className="flex-1 flex flex-col gap-1.5 overflow-y-auto min-h-0">
          <input type="text" value={sTitle} onChange={(e) => setSTitle(e.target.value)} placeholder="Metric name" onMouseDown={stop} onPointerDown={stop} onClick={stop}
            className="w-full bg-[var(--well)] rounded-md text-[11px] font-semibold outline-none focus:ring-1 focus:ring-[var(--accent)]/40 cursor-text placeholder:text-[var(--text-muted)]" style={{ padding: '4px 8px' }} />
          <div className="flex gap-1.5">
            <input type="text" value={sValue} onChange={(e) => setSValue(e.target.value)} placeholder="Value (e.g. 71%)" onMouseDown={stop} onPointerDown={stop} onClick={stop}
              className="flex-1 min-w-0 bg-[var(--well)] rounded-md text-[11px] font-bold outline-none focus:ring-1 focus:ring-[var(--accent)]/40 cursor-text placeholder:text-[var(--text-muted)]" style={{ padding: '4px 8px' }} />
            <input type="text" value={sTrend} onChange={(e) => setSTrend(e.target.value)} placeholder="+3% this week" onMouseDown={stop} onPointerDown={stop} onClick={stop}
              className="flex-1 min-w-0 bg-[var(--well)] rounded-md text-[11px] font-semibold outline-none focus:ring-1 focus:ring-[var(--accent)]/40 cursor-text placeholder:text-[var(--text-muted)]" style={{ padding: '4px 8px' }} />
          </div>
          <input type="text" value={sData} onChange={(e) => setSData(e.target.value)} placeholder="Trend points: 60, 65, 70, 71" onMouseDown={stop} onPointerDown={stop} onClick={stop}
            onKeyDown={(e) => e.key === 'Enter' && finish()}
            className="w-full bg-[var(--well)] rounded-md text-[10px] font-mono tabular-nums outline-none focus:ring-1 focus:ring-[var(--accent)]/40 cursor-text placeholder:text-[var(--text-muted)]" style={{ padding: '4px 8px' }} />
        </div>
        <button
          onClick={(e) => { stop(e); finish(); }}
          onMouseDown={stop} onPointerDown={stop}
          className="h-7 rounded-full text-[11px] font-bold text-white flex items-center justify-center gap-1.5 self-end transition-all active:scale-95 cursor-pointer"
          style={{ background: tint, boxShadow: `0 6px 14px -6px ${tint}AA, inset 0 1px 0 rgba(255,255,255,0.3)`, padding: '0 14px', marginTop: 8 }}
        >
          <MiniIcon size={10}><polyline points="20 6 9 17 4 12" /></MiniIcon>
          Show metric
        </button>
      </BlockShell>
    );
  }

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
          className="w-full bg-[#F5EFE7] dark:bg-white/10 rounded-lg text-[9px] font-mono text-[var(--text-secondary)] outline-none focus:ring-1 focus:ring-[var(--accent)]/40 cursor-text tabular-nums"
          style={{ padding: '4px 8px', marginTop: 4 }}
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
          <div key={idx} className="group/row flex items-center gap-2 border-b border-[var(--border)] last:border-b-0" style={{ padding: '4px 0' }}>
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
        <div className="flex items-center gap-2 rounded-lg" style={{ padding: '6px 0', marginTop: 2 }}>
          <input
            type="text" value={newKey} placeholder="+ key"
            onChange={(e) => setNewKey(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addRow()}
            onMouseDown={stop} onPointerDown={stop} onClick={stop}
            className="w-[38%] shrink-0 bg-[#F5EFE7] dark:bg-white/10 rounded-md text-[10px] font-semibold outline-none focus:ring-1 focus:ring-[var(--accent)]/40 cursor-text placeholder:text-[var(--text-muted)]"
            style={{ padding: '4px 6px' }}
          />
          <input
            type="text" value={newValue} placeholder="value"
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addRow()}
            onBlur={addRow}
            onMouseDown={stop} onPointerDown={stop} onClick={stop}
            className="flex-1 min-w-0 bg-[#F5EFE7] dark:bg-white/10 rounded-md text-[10px] font-semibold outline-none focus:ring-1 focus:ring-[var(--accent)]/40 cursor-text placeholder:text-[var(--text-muted)]"
            style={{ padding: '4px 6px' }}
          />
        </div>
      </div>
    </BlockShell>
  );
}

/* ============================================================
   FOCUS TIMER — a real Pomodoro. Focus / short break / long
   break modes, a progress ring, session dots, and a chime when
   a session lands. Running state lives on the object (endsAt
   timestamp), so it survives reloads and shows in collab.
   ============================================================ */

type PomodoroMode = 'focus' | 'short' | 'long';

const POMO_MODES: { id: PomodoroMode; label: string; tint: string; defMin: number }[] = [
  { id: 'focus', label: 'Focus', tint: '#3E63DD', defMin: 25 },
  { id: 'short', label: 'Break', tint: '#2F9E6E', defMin: 5 },
  { id: 'long', label: 'Long', tint: '#8B5FBF', defMin: 15 },
];

/** Two rising sine notes — enough "ding" to notice, no audio file needed. */
function pomodoroChime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const play = (freq: number, t0: number, dur = 0.22) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t0);
      g.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t0 + dur);
      o.connect(g);
      g.connect(ctx.destination);
      o.start(ctx.currentTime + t0);
      o.stop(ctx.currentTime + t0 + dur + 0.05);
    };
    play(880, 0);
    play(1174.66, 0.22);
    setTimeout(() => { void ctx.close(); }, 1000);
  } catch { /* audio blocked — the visual state change still lands */ }
}

export function FocusTimerBlock({ obj }: { obj: CanvasObjectData }) {
  const updateObject = useCanvasStore((s) => s.updateObject);

  const label = (obj.style?.timerLabel as string) || '';
  const mode = (obj.style?.timerMode as PomodoroMode) || 'focus';
  const sessions = (obj.style?.timerSessions as number) || 0;
  const endsAt = (obj.style?.timerEndsAt as number | null) ?? null;
  const pausedRemaining = (obj.style?.timerRemaining as number | null) ?? null;
  const storedMins = (obj.style?.timerMins as Partial<Record<PomodoroMode, number>>) || {};

  const meta = POMO_MODES.find((m) => m.id === mode) || POMO_MODES[0];
  const tint = meta.tint;
  const mins = storedMins[mode] ?? meta.defMin;
  const total = mins * 60;

  const patch = (kv: Record<string, unknown>) =>
    updateObject(obj.id, { style: { ...obj.style, ...kv } });

  // The clock only re-renders while something is actually counting down.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!endsAt) return;
    setNow(Date.now());
    const iv = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(iv);
  }, [endsAt]);

  const running = endsAt !== null;
  const remaining = running
    ? Math.max(0, Math.round((endsAt - now) / 1000))
    : (pausedRemaining ?? total);
  const idleFresh = !running && pausedRemaining === null;

  // Session complete → chime, count it, and tee up the next mode.
  const completedRef = useRef(false);
  useEffect(() => {
    if (!running) { completedRef.current = false; return; }
    if (remaining <= 0 && !completedRef.current) {
      completedRef.current = true;
      pomodoroChime();
      const isFocus = mode === 'focus';
      const nextSessions = isFocus ? sessions + 1 : sessions;
      const nextMode: PomodoroMode = isFocus
        ? (nextSessions > 0 && nextSessions % 4 === 0 ? 'long' : 'short')
        : 'focus';
      patch({ timerEndsAt: null, timerRemaining: null, timerSessions: nextSessions, timerMode: nextMode });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining, running, mode, sessions]);

  const start = () => patch({ timerEndsAt: Date.now() + remaining * 1000, timerRemaining: null });
  const pause = () => patch({ timerEndsAt: null, timerRemaining: remaining });
  const reset = () => patch({ timerEndsAt: null, timerRemaining: null });
  const switchMode = (m: PomodoroMode) => patch({ timerMode: m, timerEndsAt: null, timerRemaining: null });
  const adjustMins = (delta: number) => {
    const next = Math.max(1, Math.min(180, mins + delta));
    patch({ timerMins: { ...storedMins, [mode]: next }, timerRemaining: null });
  };

  const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
  const ss = String(remaining % 60).padStart(2, '0');
  const frac = total > 0 ? remaining / total : 0;
  const R = 52;
  const CIRC = 2 * Math.PI * R;
  const cycleDone = sessions % 4;

  const Btn = ({ onClick, children, primary = false, label: aria }: { onClick: () => void; children: React.ReactNode; primary?: boolean; label: string }) => (
    <button
      onClick={(e) => { stop(e); onClick(); }}
      onMouseDown={stop}
      onPointerDown={stop}
      aria-label={aria}
      className="h-8 rounded-full text-[11px] font-bold flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer"
      style={{
        padding: '0 16px',
        ...(primary
          ? { background: tint, color: '#fff', boxShadow: `0 6px 14px -6px ${tint}AA, inset 0 1px 0 rgba(255,255,255,0.3)` }
          : { background: 'var(--well)', color: 'var(--text-secondary)', boxShadow: 'var(--well-inset)' }),
      }}
    >
      {children}
    </button>
  );

  return (
    <BlockShell
      tint={tint}
      tag="focus timer"
      icon={<MiniIcon><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2 2M9 2h6" /></MiniIcon>}
      badge={<Badge tint={running ? tint : '#C9904B'}>{running ? (mode === 'focus' ? 'focusing' : 'on break') : 'ready'}</Badge>}
    >
      <Seamless
        value={label}
        onChange={(v) => patch({ timerLabel: v })}
        placeholder="What are you focusing on?"
        className="text-[12px] font-semibold text-[var(--text-secondary)]"
      />

      {/* Mode switch */}
      <div
        className="flex rounded-full self-center shrink-0"
        style={{ background: 'var(--well)', boxShadow: 'var(--well-inset)', padding: 3, marginTop: 8 }}
      >
        {POMO_MODES.map((m) => (
          <button
            key={m.id}
            onClick={(e) => { stop(e); switchMode(m.id); }}
            onMouseDown={stop} onPointerDown={stop}
            className="rounded-full text-[10px] font-bold transition-all cursor-pointer"
            style={{
              padding: '3px 11px',
              background: m.id === mode ? m.tint : 'transparent',
              color: m.id === mode ? '#fff' : 'var(--text-tertiary)',
              boxShadow: m.id === mode ? `0 3px 8px -3px ${m.tint}AA` : 'none',
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Ring + time */}
      <div className="flex-1 flex items-center justify-center min-h-0" style={{ padding: '6px 0' }}>
        <div className="relative flex items-center justify-center">
          <svg width="128" height="128" className="-rotate-90">
            <circle cx="64" cy="64" r={R} fill="transparent" stroke="var(--track)" strokeWidth="7" />
            <circle
              cx="64" cy="64" r={R}
              fill="transparent" stroke={tint} strokeWidth="7"
              strokeDasharray={CIRC}
              strokeDashoffset={CIRC * (1 - frac)}
              strokeLinecap="round"
              className="transition-all duration-500"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center select-none">
            <span className="text-[27px] font-extrabold tracking-tight tabular-nums leading-none" style={{ color: running ? tint : 'var(--text-primary)' }}>
              {mm}:{ss}
            </span>
            {idleFresh ? (
              <div className="flex items-center gap-1" style={{ marginTop: 4 }}>
                <button
                  onClick={(e) => { stop(e); adjustMins(-5); }}
                  onMouseDown={stop} onPointerDown={stop}
                  aria-label="Shorter"
                  className="w-[18px] h-[18px] rounded-full flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] cursor-pointer"
                  style={{ background: 'var(--well)' }}
                >
                  <MiniIcon size={9}><line x1="5" y1="12" x2="19" y2="12" /></MiniIcon>
                </button>
                <span className="text-[9px] font-bold text-[var(--text-tertiary)] tabular-nums" style={{ minWidth: 38, textAlign: 'center' }}>{mins} min</span>
                <button
                  onClick={(e) => { stop(e); adjustMins(5); }}
                  onMouseDown={stop} onPointerDown={stop}
                  aria-label="Longer"
                  className="w-[18px] h-[18px] rounded-full flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] cursor-pointer"
                  style={{ background: 'var(--well)' }}
                >
                  <MiniIcon size={9}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></MiniIcon>
                </button>
              </div>
            ) : (
              <span className="text-[9px] font-bold uppercase tracking-widest text-[var(--text-muted)]" style={{ marginTop: 4 }}>
                {mode === 'focus' ? 'deep work' : 'recharge'}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Session dots — 4 pomodoros to a long break */}
      <div className="flex items-center justify-center gap-1.5 shrink-0" style={{ marginBottom: 8 }} title={`${sessions} focus ${sessions === 1 ? 'session' : 'sessions'} done`}>
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className="w-1.5 h-1.5 rounded-full transition-colors"
            style={{ background: i < cycleDone ? '#3E63DD' : 'var(--track)' }}
          />
        ))}
        {sessions > 0 && (
          <span className="text-[9px] font-bold text-[var(--text-tertiary)] tabular-nums" style={{ marginLeft: 4 }}>{sessions} done</span>
        )}
      </div>

      <div className="flex justify-center gap-2 shrink-0">
        <Btn primary onClick={running ? pause : start} label={running ? 'Pause' : 'Start'}>
          <MiniIcon size={10}>{running ? (<><line x1="9" y1="5" x2="9" y2="19" /><line x1="15" y1="5" x2="15" y2="19" /></>) : (<polygon points="6 4 20 12 6 20 6 4" />)}</MiniIcon>
          {running ? 'Pause' : (pausedRemaining !== null ? 'Resume' : 'Start')}
        </Btn>
        <Btn onClick={reset} label="Reset">
          <MiniIcon size={10}><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></MiniIcon>
          Reset
        </Btn>
      </div>
    </BlockShell>
  );
}

/* ============================================================
   DECISION SPINNER — an actual wheel of fortune. Segments are
   your choices; it spins with real momentum, lands with a
   confetti burst, and the chips below edit the wheel in place.
   ============================================================ */

const SPIN_MS = 3800;
const CONFETTI = ['#E93D82', '#3E63DD', '#2F9E6E', '#C9904B', '#8B5FBF', '#C97B4B'];

export function DecisionBlock({ obj }: { obj: CanvasObjectData }) {
  const updateObject = useCanvasStore((s) => s.updateObject);
  const tint = '#E93D82';

  const title = (obj.style?.decisionTitle as string) || '';
  const options = (obj.style?.decisionOptions as string[]) || [];
  const result = (obj.style?.decisionResult as string) || '';
  const [newChoice, setNewChoice] = useState('');
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [burst, setBurst] = useState(0);
  const timeouts = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => timeouts.current.forEach(clearTimeout), []);

  const patch = (kv: Record<string, unknown>) =>
    updateObject(obj.id, { style: { ...obj.style, ...kv } });

  const spin = () => {
    if (spinning || options.length < 2) return;
    const winner = Math.floor(Math.random() * options.length);
    const seg = 360 / options.length;
    // The pointer sits at the top; end with the winner's centre under it.
    const target = (360 - (winner + 0.5) * seg + 360) % 360;
    const current = ((rotation % 360) + 360) % 360;
    const delta = ((target - current) % 360 + 360) % 360;
    const fullTurns = 360 * (4 + Math.floor(Math.random() * 2));
    setSpinning(true);
    setBurst(0);
    patch({ decisionResult: '' });
    setRotation(rotation + fullTurns + delta);
    const t = setTimeout(() => {
      setSpinning(false);
      setBurst(Date.now());
      patch({ decisionResult: options[winner] });
      const clear = setTimeout(() => setBurst(0), 1200);
      timeouts.current.push(clear);
    }, SPIN_MS + 80);
    timeouts.current.push(t);
  };

  const removeChoice = (idx: number) => patch({ decisionOptions: options.filter((_, i) => i !== idx), decisionResult: '' });
  const renameChoice = (idx: number, v: string) => patch({ decisionOptions: options.map((o, i) => (i === idx ? v : o)) });
  const addChoice = () => {
    const v = newChoice.trim();
    if (!v) return;
    patch({ decisionOptions: [...options, v], decisionResult: '' });
    setNewChoice('');
  };

  // ---- wheel geometry ----
  const n = Math.max(options.length, 1);
  const seg = 360 / n;
  const cx = 60, cy = 60, r = 55;
  const labelSize = n > 8 ? 5 : n > 5 ? 6.2 : n > 3 ? 7.2 : 8.2;
  const clip = (s: string) => (s.length > 10 ? s.slice(0, 9) + '…' : s || '…');

  const wedges = options.map((option, i) => {
    const color = CHART_PALETTE[i % CHART_PALETTE.length];
    if (n === 1) {
      return <circle key={i} cx={cx} cy={cy} r={r} fill={color} />;
    }
    const start = i * seg;
    const end = (i + 1) * seg;
    const [x1, y1] = polar(cx, cy, r, start);
    const [x2, y2] = polar(cx, cy, r, end);
    const large = seg > 180 ? 1 : 0;
    return (
      <g key={i}>
        <path
          d={`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`}
          fill={color}
          stroke="#FFFDFA"
          strokeWidth="1"
          strokeLinejoin="round"
        />
        <text
          x={cx}
          y={cy - r * 0.62}
          textAnchor="middle"
          dominantBaseline="middle"
          transform={`rotate(${start + seg / 2} ${cx} ${cy})`}
          fill="#fff"
          fontSize={labelSize}
          fontWeight="700"
          fontFamily="'Outfit', sans-serif"
          style={{ userSelect: 'none' }}
        >
          {clip(option)}
        </text>
      </g>
    );
  });

  return (
    <BlockShell
      tint={tint}
      tag="decision spinner"
      icon={<MiniIcon><circle cx="12" cy="12" r="9" /><path d="M12 3v9l6.4 6.4" /><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" /></MiniIcon>}
      badge={<Badge tint={tint}>{spinning ? 'spinning' : `${options.length} choices`}</Badge>}
    >
      <Seamless
        value={title}
        onChange={(v) => patch({ decisionTitle: v })}
        placeholder="What can't you decide?"
        className="text-[13px] font-bold"
      />

      {/* The wheel */}
      <div className="relative flex items-center justify-center shrink-0" style={{ padding: '10px 0 6px' }}>
        {/* pointer */}
        <div
          className="absolute z-10"
          style={{ top: 4, left: '50%', transform: 'translateX(-50%)' }}
        >
          <svg width="16" height="14" viewBox="0 0 16 14" aria-hidden="true">
            <path d="M8 14 1 1h14Z" fill="var(--text-primary)" stroke="#FFFDFA" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
        </div>

        <div className="relative" style={{ width: 150, height: 150 }}>
          <svg
            viewBox="0 0 120 120"
            className="w-full h-full"
            style={{
              transform: `rotate(${rotation}deg)`,
              transition: spinning ? `transform ${SPIN_MS}ms cubic-bezier(0.12, 0.75, 0.13, 1)` : 'none',
              filter: 'drop-shadow(0 6px 12px rgba(90,62,40,0.18))',
            }}
          >
            {options.length >= 2 ? wedges : (
              <circle cx={cx} cy={cy} r={r} fill="var(--well)" stroke="var(--border-strong)" strokeDasharray="4,4" />
            )}
          </svg>
          {/* hub — doubles as the spin button */}
          <button
            onClick={(e) => { stop(e); spin(); }}
            onMouseDown={stop} onPointerDown={stop}
            disabled={spinning || options.length < 2}
            aria-label="Spin the wheel"
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-11 h-11 rounded-full flex items-center justify-center text-[9px] font-extrabold uppercase tracking-wider transition-all active:scale-90 disabled:cursor-not-allowed cursor-pointer"
            style={{
              background: '#FFFDFA',
              color: spinning ? 'var(--text-muted)' : tint,
              boxShadow: '0 3px 10px rgba(90,62,40,0.28), inset 0 1px 0 #fff',
            }}
          >
            {spinning ? '…' : 'spin'}
          </button>

          {/* confetti burst on landing */}
          {burst > 0 && (
            <div className="absolute inset-0 pointer-events-none overflow-visible">
              {Array.from({ length: 18 }, (_, i) => {
                const a = (i / 18) * Math.PI * 2;
                const dist = 58 + (i % 5) * 14;
                return (
                  <motion.span
                    key={`${burst}-${i}`}
                    className="absolute left-1/2 top-1/2 rounded-[2px]"
                    style={{ width: i % 3 === 0 ? 7 : 5, height: i % 2 === 0 ? 9 : 5, background: CONFETTI[i % CONFETTI.length] }}
                    initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 1 }}
                    animate={{
                      x: Math.cos(a) * dist,
                      y: Math.sin(a) * dist - 12,
                      opacity: 0,
                      rotate: (i % 2 === 0 ? 1 : -1) * (180 + i * 24),
                      scale: 0.6,
                    }}
                    transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Result */}
      <div className="flex items-center justify-center shrink-0" style={{ minHeight: 22, marginBottom: 4 }}>
        {result && !spinning ? (
          <motion.span
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="rounded-full text-[11.5px] font-extrabold text-white truncate"
            style={{ background: tint, padding: '3px 14px', boxShadow: `0 6px 14px -6px ${tint}AA`, maxWidth: '90%' }}
          >
            🎉 {result}
          </motion.span>
        ) : (
          <span className="text-[9.5px] font-semibold text-[var(--text-muted)] select-none">
            {options.length < 2 ? 'add at least two choices' : spinning ? 'no take-backs…' : 'tap the hub to spin'}
          </span>
        )}
      </div>

      {/* Choice chips */}
      <div className="flex flex-wrap gap-1.5 content-start overflow-y-auto min-h-0 shrink-0" style={{ maxHeight: 84 }}>
        {options.map((option, idx) => {
          const won = !spinning && result === option && result !== '';
          const color = CHART_PALETTE[idx % CHART_PALETTE.length];
          return (
            <span
              key={idx}
              className="group/chip inline-flex items-center gap-1 rounded-full transition-all duration-150"
              style={{
                padding: '3px 7px 3px 9px',
                background: won ? tint : 'var(--well)',
                color: won ? '#fff' : 'var(--text-primary)',
                boxShadow: won ? `0 6px 14px -6px ${tint}AA` : 'var(--well-inset)',
              }}
            >
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: won ? '#fff' : color }} />
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
          className="rounded-full border border-dashed border-[var(--border-strong)] bg-transparent outline-none text-[11px] font-semibold w-[9ch] focus:w-[14ch] transition-all cursor-text placeholder:text-[var(--text-muted)]"
          style={{ padding: '3px 10px' }}
        />
      </div>
    </BlockShell>
  );
}

/* ============================================================
   PROGRESS GOAL — drag the clay bar (or flip to a ring), or
   track real numbers: 7 / 12 chapters. Milestone ticks, and a
   little celebration when the goal lands.
   ============================================================ */

export function ProgressBlock({ obj }: { obj: CanvasObjectData }) {
  const updateObject = useCanvasStore((s) => s.updateObject);
  const tint = '#2F9E6E';
  const gold = '#C9904B';

  const label = (obj.style?.progressLabel as string) || '';
  const view = (obj.style?.progressView as 'bar' | 'ring') || 'bar';
  const target = obj.style?.progressTarget as number | undefined;
  const current = (obj.style?.progressCurrent as number) ?? 0;
  const hasTarget = typeof target === 'number' && target > 0;
  const unit = (obj.style?.progressUnit as string) || '';
  const rawValue = hasTarget
    ? (current / (target as number)) * 100
    : ((obj.style?.progressValue as number) ?? 0);
  const value = Math.max(0, Math.min(100, Math.round(rawValue)));
  const trackRef = useRef<HTMLDivElement>(null);

  const patch = useCallback(
    (kv: Record<string, unknown>) => updateObject(obj.id, { style: { ...obj.style, ...kv } }),
    [updateObject, obj.id, obj.style]
  );

  const setPct = useCallback((pct: number) => {
    const clamped = Math.max(0, Math.min(100, pct));
    if (hasTarget) patch({ progressCurrent: Math.round((clamped / 100) * (target as number)) });
    else patch({ progressValue: clamped });
  }, [patch, hasTarget, target]);

  const setFromClientX = useCallback((clientX: number) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    setPct(Math.round(Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * 100));
  }, [setPct]);

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
  const barColor = done ? gold : tint;
  const steps = hasTarget ? [-1, +1] : [-10, -5, +5, +10];
  const stepLabel = (s: number) => (s > 0 ? `+${s}` : `${s}`);
  const applyStep = (s: number) => {
    if (hasTarget) patch({ progressCurrent: Math.max(0, Math.min(target as number, current + s)) });
    else setPct(value + s);
  };

  const R = 40;
  const CIRC = 2 * Math.PI * R;

  const ViewToggle = (
    <div className="flex rounded-full shrink-0" style={{ background: 'var(--well)', boxShadow: 'var(--well-inset)', padding: 2 }}>
      {(['bar', 'ring'] as const).map((v) => (
        <button
          key={v}
          onClick={(e) => { stop(e); patch({ progressView: v }); }}
          onMouseDown={stop} onPointerDown={stop}
          title={v === 'bar' ? 'Bar view' : 'Ring view'}
          aria-label={v === 'bar' ? 'Bar view' : 'Ring view'}
          className="w-5 h-5 rounded-full flex items-center justify-center transition-all cursor-pointer"
          style={{ background: view === v ? '#FFFDFA' : 'transparent', color: view === v ? tint : 'var(--text-muted)', boxShadow: view === v ? '0 1px 3px rgba(90,62,40,0.2)' : 'none' }}
        >
          {v === 'bar'
            ? <MiniIcon size={9}><line x1="4" y1="12" x2="20" y2="12" strokeWidth="4" /></MiniIcon>
            : <MiniIcon size={9}><circle cx="12" cy="12" r="8" /></MiniIcon>}
        </button>
      ))}
    </div>
  );

  return (
    <BlockShell
      tint={barColor}
      tag="progress goal"
      icon={<MiniIcon><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" fill="currentColor" /></MiniIcon>}
      badge={<Badge tint={barColor}>{done ? 'complete 🎉' : `${value}%`}</Badge>}
    >
      <div className="flex items-center gap-2">
        <Seamless
          value={label}
          onChange={(v) => patch({ progressLabel: v })}
          placeholder="Name your goal…"
          className="text-[13px] font-bold"
        />
        {ViewToggle}
      </div>

      {/* Real-number tracking: 7 / 12 chapters */}
      <div className="flex items-center gap-1 shrink-0" style={{ marginTop: 4 }}>
        {hasTarget ? (
          <>
            <input
              type="text" inputMode="numeric" value={String(current)}
              onChange={(e) => { const n = parseInt(e.target.value, 10); patch({ progressCurrent: isNaN(n) ? 0 : Math.max(0, n) }); }}
              onMouseDown={stop} onPointerDown={stop} onClick={stop}
              className="w-[5ch] bg-[var(--well)] rounded-md text-[11px] font-extrabold tabular-nums text-center outline-none focus:ring-1 focus:ring-[var(--accent)]/40 cursor-text"
              style={{ padding: '2px 4px' }}
              aria-label="Current amount"
            />
            <span className="text-[11px] font-bold text-[var(--text-muted)]">/</span>
            <input
              type="text" inputMode="numeric" value={String(target)}
              onChange={(e) => { const n = parseInt(e.target.value, 10); patch({ progressTarget: isNaN(n) || n <= 0 ? 1 : n }); }}
              onMouseDown={stop} onPointerDown={stop} onClick={stop}
              className="w-[5ch] bg-[var(--well)] rounded-md text-[11px] font-extrabold tabular-nums text-center outline-none focus:ring-1 focus:ring-[var(--accent)]/40 cursor-text"
              style={{ padding: '2px 4px' }}
              aria-label="Target amount"
            />
            <input
              type="text" value={unit} placeholder="unit"
              onChange={(e) => patch({ progressUnit: e.target.value })}
              onMouseDown={stop} onPointerDown={stop} onClick={stop}
              className="flex-1 min-w-0 bg-transparent outline-none text-[10.5px] font-semibold text-[var(--text-secondary)] cursor-text placeholder:text-[var(--text-muted)]"
            />
            <button
              onClick={(e) => { stop(e); patch({ progressTarget: undefined, progressCurrent: undefined, progressUnit: undefined, progressValue: value }); }}
              onMouseDown={stop} onPointerDown={stop}
              title="Back to plain percent"
              className="text-[9px] font-bold text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-pointer shrink-0"
            >
              ×
            </button>
          </>
        ) : (
          <button
            onClick={(e) => { stop(e); patch({ progressTarget: 10, progressCurrent: Math.round((value / 100) * 10) }); }}
            onMouseDown={stop} onPointerDown={stop}
            className="text-[9.5px] font-bold text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors cursor-pointer"
          >
            + track real numbers (7 / 12 chapters…)
          </button>
        )}
      </div>

      {view === 'ring' ? (
        <div className="flex-1 flex items-center justify-center min-h-0" style={{ padding: '4px 0' }}>
          <div className="relative flex items-center justify-center">
            <svg width="100" height="100" className="-rotate-90">
              <circle cx="50" cy="50" r={R} fill="transparent" stroke="var(--track)" strokeWidth="9" />
              <circle
                cx="50" cy="50" r={R}
                fill="transparent" stroke={barColor} strokeWidth="9"
                strokeDasharray={CIRC}
                strokeDashoffset={CIRC * (1 - value / 100)}
                strokeLinecap="round"
                className="transition-all duration-300"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center select-none">
              <span className="text-[22px] font-extrabold tabular-nums leading-none" style={{ color: barColor }}>{value}%</span>
              {hasTarget && <span className="text-[8.5px] font-bold text-[var(--text-tertiary)] tabular-nums" style={{ marginTop: 2 }}>{current} / {target}{unit ? ` ${unit}` : ''}</span>}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col justify-center gap-2 min-h-0" style={{ padding: '6px 0' }}>
          {/* draggable clay track with milestone ticks */}
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
            style={{ background: 'var(--well)', boxShadow: 'var(--well-inset-deep)' }}
          >
            <div
              className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-150"
              style={{
                width: `${value}%`,
                background: `linear-gradient(180deg, ${barColor}E6, ${barColor})`,
                boxShadow: `inset 0 1.5px 0 rgba(255,255,255,0.4), 0 2px 6px -2px ${barColor}99`,
                minWidth: value > 0 ? '1.5rem' : 0,
              }}
            />
            {/* milestone ticks */}
            {[25, 50, 75].map((m) => (
              <span
                key={m}
                className="absolute top-1/2 -translate-y-1/2 w-px h-2.5 pointer-events-none"
                style={{ left: `${m}%`, background: value >= m ? 'rgba(255,255,255,0.55)' : 'var(--border-strong)' }}
              />
            ))}
            {/* handle */}
            <div
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-white transition-[left] duration-150 pointer-events-none"
              style={{ left: `${value}%`, boxShadow: '0 2px 6px rgba(90,62,40,0.35), inset 0 1px 0 #fff' }}
            />
          </div>

          <div className="flex justify-between text-[9px] font-bold text-[var(--text-muted)] tabular-nums select-none">
            <span>0</span><span>25</span><span>50</span><span>75</span><span>100</span>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between shrink-0">
        <div className="flex gap-1">
          {steps.map((s) => (
            <button
              key={s}
              onClick={(e) => { stop(e); applyStep(s); }}
              onMouseDown={stop} onPointerDown={stop}
              className="rounded-lg text-[9.5px] font-extrabold tabular-nums text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
              style={{ background: 'var(--well)', boxShadow: 'var(--well-inset)', padding: '4px 8px' }}
            >
              {stepLabel(s)}
            </button>
          ))}
        </div>
        <span className="text-lg font-extrabold tabular-nums" style={{ color: barColor }}>
          {done ? '🎉 ' : ''}{hasTarget && view === 'bar' ? `${current}/${target}` : `${value}%`}
        </span>
      </div>
    </BlockShell>
  );
}

/* ============================================================
   CHART — Notion-style data viz. Pick a type, fill in your data,
   THEN it renders. Bar / horizontal bar / line / donut / number.
   ============================================================ */

type ChartRow = { label: string; value: number };
type ChartType = 'bar' | 'hbar' | 'line' | 'area' | 'donut' | 'pie' | 'number';

const CHART_TINT = '#C97B4B';
// Categorical palette (accent first) for slices / multi-series.
const CHART_PALETTE = ['#C97B4B', '#3E63DD', '#2F9E6E', '#E93D82', '#8B5FBF', '#C9904B', '#45B761', '#D64545'];

const CHART_TYPES: { id: ChartType; label: string; hint: string; icon: React.ReactNode }[] = [
  { id: 'bar', label: 'Vertical bar', hint: 'compare categories', icon: <MiniIcon><line x1="6" y1="20" x2="6" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="18" y1="20" x2="18" y2="14" /></MiniIcon> },
  { id: 'hbar', label: 'Horizontal bar', hint: 'ranked lists, long labels', icon: <MiniIcon><line x1="4" y1="6" x2="16" y2="6" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="18" x2="11" y2="18" /></MiniIcon> },
  { id: 'line', label: 'Line', hint: 'change over time', icon: <MiniIcon><polyline points="3 17 9 11 13 15 21 6" /></MiniIcon> },
  { id: 'area', label: 'Area', hint: 'volume over time', icon: <MiniIcon><path d="M3 17 9 11l4 4 8-9v11H3Z" fill="currentColor" stroke="none" opacity="0.35" /><polyline points="3 17 9 11 13 15 21 6" /></MiniIcon> },
  { id: 'donut', label: 'Donut', hint: 'parts of a whole + total', icon: <MiniIcon><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /></MiniIcon> },
  { id: 'pie', label: 'Pie', hint: 'parts of a whole', icon: <MiniIcon><circle cx="12" cy="12" r="9" /><path d="M12 3v9l6.4 6.4" /></MiniIcon> },
  { id: 'number', label: 'Big number', hint: 'one headline stat', icon: <MiniIcon><line x1="4" y1="9" x2="20" y2="9" /><line x1="4" y1="15" x2="20" y2="15" /><line x1="10" y1="3" x2="8" y2="21" /><line x1="16" y1="3" x2="14" y2="21" /></MiniIcon> },
];

/** Catmull-Rom → cubic bezier so line/area charts read as a curve, not a zigzag. */
function smoothPath(pts: [number, number][]): string {
  if (pts.length < 2) return '';
  let d = `M ${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

function fmtNum(n: number): string {
  if (!isFinite(n)) return '0';
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(abs >= 1e10 ? 0 : 1) + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(abs >= 1e7 ? 0 : 1) + 'M';
  if (abs >= 1e3) return (n / 1e3).toFixed(abs >= 1e4 ? 0 : 1) + 'K';
  return String(Math.round(n * 100) / 100);
}

function polar(cx: number, cy: number, r: number, angle: number): [number, number] {
  const a = (angle - 90) * (Math.PI / 180);
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

/** Small text button used in the chart footer. */
function ChartLink({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={(e) => { stop(e); onClick(); }}
      onMouseDown={stop}
      onPointerDown={stop}
      className="inline-flex items-center gap-1 text-[10px] font-bold text-[var(--text-tertiary)] hover:text-[var(--accent)] transition-colors cursor-pointer"
    >
      {children}
    </button>
  );
}

export function ChartBlock({ obj }: { obj: CanvasObjectData }) {
  const updateObject = useCanvasStore((s) => s.updateObject);

  const chartType = obj.style?.chartType as ChartType | undefined;
  const title = (obj.style?.chartTitle as string) || '';
  const savedData = useMemo<ChartRow[]>(
    () => (Array.isArray(obj.style?.chartData) ? (obj.style!.chartData as ChartRow[]) : []),
    [obj.style]
  );
  const ready = obj.style?.chartReady === true && savedData.length > 0;

  // Phase: pick a type → enter data → see the chart. Starts on whichever step
  // the object's data implies, so the agent can drop a finished chart straight in.
  const [phase, setPhase] = useState<'type' | 'data' | 'chart'>(
    !chartType ? 'type' : ready ? 'chart' : 'data'
  );

  // Editable draft rows (kept as strings so typing is smooth).
  const [draft, setDraft] = useState<{ label: string; value: string }[]>(() =>
    savedData.length
      ? savedData.map((r) => ({ label: String(r.label ?? ''), value: String(r.value ?? '') }))
      : [{ label: '', value: '' }, { label: '', value: '' }, { label: '', value: '' }]
  );

  const patch = (kv: Record<string, unknown>) =>
    updateObject(obj.id, { style: { ...obj.style, ...kv } });

  const pickType = (t: ChartType) => {
    patch({ chartType: t });
    if (t === 'number' && draft.length > 1) setDraft([draft[0] || { label: '', value: '' }]);
    setPhase('data');
  };

  const commit = () => {
    const rows: ChartRow[] = draft
      .map((r) => ({ label: r.label.trim(), value: parseFloat(r.value) }))
      .filter((r) => !isNaN(r.value));
    if (rows.length === 0) return;
    patch({ chartData: rows, chartReady: true });
    setPhase('chart');
  };

  const setDraftRow = (i: number, part: 'label' | 'value', v: string) =>
    setDraft((d) => d.map((r, idx) => (idx === i ? { ...r, [part]: v } : r)));
  const addDraftRow = () => setDraft((d) => [...d, { label: '', value: '' }]);
  const removeDraftRow = (i: number) => setDraft((d) => (d.length > 1 ? d.filter((_, idx) => idx !== i) : d));

  const typeLabel = CHART_TYPES.find((t) => t.id === chartType)?.label || 'Chart';

  /* ---- PHASE 1: pick a chart type (Notion-style list) ---- */
  if (phase === 'type') {
    return (
      <BlockShell
        tint={CHART_TINT}
        tag="chart"
        icon={<MiniIcon><line x1="6" y1="20" x2="6" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="18" y1="20" x2="18" y2="14" /></MiniIcon>}
        badge={<Badge tint={CHART_TINT}>new</Badge>}
      >
        <p className="text-[12px] font-bold text-[var(--text-primary)]" style={{ marginBottom: 6 }}>Pick a chart type</p>
        <div className="flex-1 flex flex-col gap-1 overflow-y-auto min-h-0">
          {CHART_TYPES.map((t) => (
            <button
              key={t.id}
              onClick={(e) => { stop(e); pickType(t.id); }}
              onMouseDown={stop}
              onPointerDown={stop}
              className="w-full flex items-center gap-2.5 rounded-xl text-left transition-colors cursor-pointer hover:bg-[var(--well)]"
              style={{ padding: '6px 9px' }}
            >
              <span className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${CHART_TINT}1E`, color: CHART_TINT }}>
                {t.icon}
              </span>
              <span className="min-w-0 flex-1 flex items-baseline gap-1.5">
                <span className="text-[12px] font-semibold text-[var(--text-primary)] shrink-0">{t.label}</span>
                <span className="text-[9.5px] text-[var(--text-muted)] truncate">{t.hint}</span>
              </span>
            </button>
          ))}
        </div>
      </BlockShell>
    );
  }

  /* ---- PHASE 2: fill in the data ---- */
  if (phase === 'data') {
    const isNumber = chartType === 'number';
    return (
      <BlockShell
        tint={CHART_TINT}
        tag={typeLabel}
        icon={<MiniIcon><rect x="3" y="4" width="18" height="16" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="10" y1="9" x2="10" y2="20" /></MiniIcon>}
        badge={<Badge tint={CHART_TINT}>data</Badge>}
      >
        <Seamless value={title} onChange={(v) => patch({ chartTitle: v })} placeholder="Chart title…" className="text-[12px] font-bold mb-1.5" />

        {isNumber ? (
          <div className="flex-1 flex flex-col justify-center gap-2">
            <input
              type="text" inputMode="decimal" value={draft[0]?.value ?? ''}
              onChange={(e) => setDraftRow(0, 'value', e.target.value)}
              onMouseDown={stop} onPointerDown={stop} onClick={stop}
              placeholder="0"
              className="w-full text-center text-[30px] font-extrabold tabular-nums bg-[var(--well)] rounded-xl outline-none focus:ring-1 focus:ring-[var(--accent)]/40 cursor-text"
              style={{ padding: '8px 10px' }}
            />
            <input
              type="text" value={draft[0]?.label ?? ''}
              onChange={(e) => setDraftRow(0, 'label', e.target.value)}
              onMouseDown={stop} onPointerDown={stop} onClick={stop}
              placeholder="Label (e.g. Active users)"
              className="w-full text-center text-[11px] font-semibold text-[var(--text-secondary)] bg-transparent outline-none cursor-text"
            />
          </div>
        ) : (
          <div className="flex-1 flex flex-col gap-1 overflow-y-auto min-h-0">
            {draft.map((r, i) => (
              <div key={i} className="group/dr flex items-center gap-1.5">
                {/* the series colour this row will get, so the data phase
                    already reads like the chart it's about to become */}
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ background: chartType === 'line' || chartType === 'area' ? CHART_TINT : CHART_PALETTE[i % CHART_PALETTE.length] }}
                />
                <input
                  type="text" value={r.label} placeholder="label"
                  onChange={(e) => setDraftRow(i, 'label', e.target.value)}
                  onMouseDown={stop} onPointerDown={stop} onClick={stop}
                  className="flex-1 min-w-0 bg-[var(--well)] rounded-md text-[11px] font-semibold outline-none focus:ring-1 focus:ring-[var(--accent)]/40 cursor-text placeholder:text-[var(--text-muted)]"
                  style={{ padding: '4px 8px' }}
                />
                <input
                  type="text" inputMode="decimal" value={r.value} placeholder="0"
                  onChange={(e) => setDraftRow(i, 'value', e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && commit()}
                  onMouseDown={stop} onPointerDown={stop} onClick={stop}
                  className="w-[64px] shrink-0 bg-[var(--well)] rounded-md text-[11px] font-bold text-right tabular-nums outline-none focus:ring-1 focus:ring-[var(--accent)]/40 cursor-text placeholder:text-[var(--text-muted)]"
                  style={{ padding: '4px 8px' }}
                />
                <button
                  onClick={(e) => { stop(e); removeDraftRow(i); }}
                  onMouseDown={stop} onPointerDown={stop}
                  aria-label="Remove row"
                  className="w-4 h-4 rounded-full items-center justify-center text-[var(--text-muted)] hover:text-red-500 hidden group-hover/dr:flex shrink-0 cursor-pointer"
                >
                  <MiniIcon size={9}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></MiniIcon>
                </button>
              </div>
            ))}
            <button
              onClick={(e) => { stop(e); addDraftRow(); }}
              onMouseDown={stop} onPointerDown={stop}
              className="flex items-center gap-1 rounded-md text-[10px] font-bold text-[var(--text-tertiary)] hover:text-[var(--accent)] border border-dashed border-[var(--border-strong)] cursor-pointer w-fit"
              style={{ padding: '3px 8px', marginTop: 2 }}
            >
              <MiniIcon size={10}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></MiniIcon>
              Add row
            </button>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-[var(--border)] shrink-0" style={{ paddingTop: 8, marginTop: 4 }}>
          <ChartLink onClick={() => setPhase('type')}>
            <MiniIcon size={10}><polyline points="15 18 9 12 15 6" /></MiniIcon> Type
          </ChartLink>
          <button
            onClick={(e) => { stop(e); commit(); }}
            onMouseDown={stop} onPointerDown={stop}
            className="h-7 rounded-full text-[11px] font-bold text-white flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer"
            style={{ background: CHART_TINT, boxShadow: `0 6px 14px -6px ${CHART_TINT}AA, inset 0 1px 0 rgba(255,255,255,0.3)`, padding: '0 14px' }}
          >
            <MiniIcon size={10}><polyline points="20 6 9 17 4 12" /></MiniIcon>
            Create chart
          </button>
        </div>
      </BlockShell>
    );
  }

  /* ---- PHASE 3: render the chart ---- */
  const data = savedData;
  const maxVal = Math.max(...data.map((d) => d.value), 0) || 1;
  const gridFracs = [0.25, 0.5, 0.75, 1];
  /** Room reserved above each bar for its value label — the gridlines use the
   *  same offset so the scale they claim is the scale the bars actually use. */
  const BAR_LABEL_H = 14;

  let chart: React.ReactNode = null;

  if (chartType === 'number') {
    const d0 = data[0];
    chart = (
      <div className="flex-1 flex flex-col items-center justify-center">
        <span className="text-[42px] leading-none font-extrabold tabular-nums" style={{ color: CHART_TINT }}>{d0 ? fmtNum(d0.value) : '0'}</span>
        {d0?.label && <span className="text-[12px] font-semibold text-[var(--text-secondary)] text-center" style={{ marginTop: 6 }}>{d0.label}</span>}
      </div>
    );
  } else if (chartType === 'bar') {
    chart = (
      <div className="flex-1 flex flex-col min-h-0">
        <div className="relative flex-1 min-h-0">
          {gridFracs.map((f) => (
            <div key={f} className="absolute inset-x-0 flex items-center gap-1 pointer-events-none" style={{ bottom: `calc((100% - ${BAR_LABEL_H}px) * ${f})` }}>
              <span className="w-6 shrink-0 text-right text-[7.5px] font-semibold text-[var(--text-muted)] tabular-nums leading-none">{fmtNum(maxVal * f)}</span>
              <span className="flex-1 border-t border-dashed border-[var(--track)]" />
            </div>
          ))}
          <div className="absolute inset-y-0 right-0 flex items-stretch gap-2" style={{ left: 30 }}>
            {data.map((d, i) => {
              const color = CHART_PALETTE[i % CHART_PALETTE.length];
              return (
                <div key={i} className="group/bar flex-1 min-w-0 flex flex-col items-center justify-end" title={`${d.label}: ${d.value}`}>
                  <span className="text-[9px] font-bold tabular-nums text-[var(--text-secondary)] shrink-0 leading-none" style={{ marginBottom: 3 }}>{fmtNum(d.value)}</span>
                  <div
                    className="w-[72%] rounded-t-[5px] transition-all duration-300 group-hover/bar:brightness-110"
                    style={{
                      height: `calc((100% - ${BAR_LABEL_H}px) * ${Math.max(0.02, Math.max(0, d.value) / maxVal)})`,
                      background: `linear-gradient(180deg, ${color}, ${color}B8)`,
                      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.35)',
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
        <div className="flex gap-2 shrink-0" style={{ paddingLeft: 30, marginTop: 3 }}>
          {data.map((d, i) => (
            <span key={i} className="flex-1 min-w-0 text-[8.5px] font-semibold text-[var(--text-tertiary)] truncate text-center" title={d.label}>{d.label}</span>
          ))}
        </div>
      </div>
    );
  } else if (chartType === 'hbar') {
    chart = (
      <div className="flex-1 flex flex-col justify-center gap-1.5 min-h-0 overflow-y-auto">
        {data.map((d, i) => {
          const color = CHART_PALETTE[i % CHART_PALETTE.length];
          const w = Math.max(0, d.value) / maxVal;
          return (
            <div key={i} className="flex items-center gap-2" title={`${d.label}: ${d.value}`}>
              <span className="w-[32%] shrink-0 text-[10px] font-semibold text-[var(--text-tertiary)] truncate text-right" title={d.label}>{d.label}</span>
              <div className="relative flex-1 h-4 rounded-full min-w-0" style={{ background: 'var(--well)', boxShadow: 'var(--well-inset)' }}>
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${Math.max(4, w * 100)}%`,
                    background: `linear-gradient(90deg, ${color}C8, ${color})`,
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3)',
                  }}
                />
                <span
                  className="absolute top-1/2 -translate-y-1/2 text-[8.5px] font-extrabold tabular-nums pointer-events-none"
                  style={w > 0.82 ? { right: 6, color: '#fff' } : { left: `calc(${Math.max(4, w * 100)}% + 5px)`, color: 'var(--text-secondary)' }}
                >
                  {fmtNum(d.value)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    );
  } else if (chartType === 'line' || chartType === 'area') {
    const w = 260, h = 96, padX = 10, padTop = 8, padBot = 6;
    const minV = Math.min(...data.map((d) => d.value), 0);
    const range = maxVal - minV || 1;
    const pts = data.map((d, i) => {
      const x = data.length === 1 ? w / 2 : padX + (i / (data.length - 1)) * (w - padX * 2);
      const y = h - padBot - ((d.value - minV) / range) * (h - padTop - padBot);
      return [x, y] as [number, number];
    });
    const path = smoothPath(pts);
    const gridYs = gridFracs.map((f) => h - padBot - f * (h - padTop - padBot));
    chart = (
      <div className="flex-1 flex flex-col min-h-0">
        <div className="relative flex-1 min-h-0">
          <svg className="w-full h-full" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
            <defs>
              <linearGradient id={`cl-${obj.id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CHART_TINT} stopOpacity={chartType === 'area' ? 0.34 : 0.16} />
                <stop offset="100%" stopColor={CHART_TINT} stopOpacity="0" />
              </linearGradient>
            </defs>
            {gridYs.map((gy, gi) => (
              <line key={gi} x1={padX} y1={gy} x2={w - padX} y2={gy} stroke="var(--track)" strokeDasharray="3,3" vectorEffect="non-scaling-stroke" />
            ))}
            {pts.length >= 2 && (
              <path d={`${path} L ${pts[pts.length - 1][0].toFixed(1)},${h - padBot} L ${pts[0][0].toFixed(1)},${h - padBot} Z`} fill={`url(#cl-${obj.id})`} />
            )}
            <path d={path} fill="none" stroke={CHART_TINT} strokeWidth={chartType === 'area' ? 2 : 2.5} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            {pts.map((p, i) => (
              <circle key={i} cx={p[0]} cy={p[1]} r="2.6" fill="#fff" stroke={CHART_TINT} strokeWidth="2" vectorEffect="non-scaling-stroke">
                <title>{`${data[i].label}: ${data[i].value}`}</title>
              </circle>
            ))}
          </svg>
          <span className="absolute left-0.5 top-0 text-[7.5px] font-semibold text-[var(--text-muted)] tabular-nums pointer-events-none leading-none">{fmtNum(maxVal)}</span>
          <span className="absolute left-0.5 bottom-0 text-[7.5px] font-semibold text-[var(--text-muted)] tabular-nums pointer-events-none leading-none">{fmtNum(minV)}</span>
        </div>
        <div className="flex justify-between shrink-0" style={{ marginTop: 3 }}>
          {data.map((d, i) => <span key={i} className="text-[8.5px] font-semibold text-[var(--text-tertiary)] truncate flex-1 text-center" title={`${d.label}: ${d.value}`}>{d.label}</span>)}
        </div>
      </div>
    );
  } else if (chartType === 'donut' || chartType === 'pie') {
    const total = data.reduce((s, d) => s + Math.max(0, d.value), 0) || 1;
    const cx = 50, cy = 50, rOuter = 46, rInner = chartType === 'donut' ? 26 : 0;
    let acc = 0;
    const arcs = data.map((d, i) => {
      const frac = Math.max(0, d.value) / total;
      if (frac <= 0) return null;
      const color = CHART_PALETTE[i % CHART_PALETTE.length];
      const start = acc * 360;
      acc += frac;
      const end = acc * 360;
      // One value owning the whole circle can't be drawn as an arc (start == end).
      if (end - start >= 359.9) {
        return rInner > 0
          ? <circle key={i} cx={cx} cy={cy} r={(rOuter + rInner) / 2} fill="none" stroke={color} strokeWidth={rOuter - rInner} />
          : <circle key={i} cx={cx} cy={cy} r={rOuter} fill={color} />;
      }
      const large = end - start > 180 ? 1 : 0;
      const [x1, y1] = polar(cx, cy, rOuter, start);
      const [x2, y2] = polar(cx, cy, rOuter, end);
      let dPath: string;
      if (rInner === 0) {
        dPath = `M ${cx} ${cy} L ${x1} ${y1} A ${rOuter} ${rOuter} 0 ${large} 1 ${x2} ${y2} Z`;
      } else {
        const [x3, y3] = polar(cx, cy, rInner, end);
        const [x4, y4] = polar(cx, cy, rInner, start);
        dPath = `M ${x1} ${y1} A ${rOuter} ${rOuter} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${rInner} ${rInner} 0 ${large} 0 ${x4} ${y4} Z`;
      }
      return (
        <path key={i} d={dPath} fill={color} stroke="#FFFDFA" strokeWidth="1.2" strokeLinejoin="round">
          <title>{`${d.label}: ${d.value} (${Math.round(frac * 100)}%)`}</title>
        </path>
      );
    });
    chart = (
      <div className="flex-1 flex items-center gap-3 min-h-0">
        <div className="relative shrink-0" style={{ width: 104, height: 104 }}>
          <svg viewBox="0 0 100 100" className="w-full h-full">{arcs}</svg>
          {chartType === 'donut' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-[15px] font-extrabold tabular-nums text-[var(--text-primary)] leading-none">{fmtNum(total)}</span>
              <span className="text-[7.5px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">total</span>
            </div>
          )}
        </div>
        <div className="flex-1 flex flex-col gap-1 overflow-y-auto min-h-0">
          {data.map((d, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: CHART_PALETTE[i % CHART_PALETTE.length] }} />
              <span className="text-[10px] font-semibold text-[var(--text-secondary)] truncate flex-1" title={d.label}>{d.label}</span>
              <span className="text-[9px] text-[var(--text-muted)] tabular-nums shrink-0">{fmtNum(d.value)}</span>
              <span className="w-7 shrink-0 text-right text-[10px] font-extrabold tabular-nums text-[var(--text-primary)]">{Math.round((Math.max(0, d.value) / total) * 100)}%</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <BlockShell
      tint={CHART_TINT}
      tag={typeLabel}
      icon={<MiniIcon><line x1="6" y1="20" x2="6" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="18" y1="20" x2="18" y2="14" /></MiniIcon>}
      badge={<Badge tint={CHART_TINT}>{data.length} pts</Badge>}
    >
      <Seamless value={title} onChange={(v) => patch({ chartTitle: v })} placeholder="Chart title…" className="text-[12px] font-bold" />
      {chart}
      <div className="flex items-center gap-3 border-t border-[var(--border)] shrink-0" style={{ paddingTop: 8, marginTop: 4 }}>
        <ChartLink onClick={() => { setDraft(data.map((r) => ({ label: String(r.label ?? ''), value: String(r.value ?? '') }))); setPhase('data'); }}>
          <MiniIcon size={10}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></MiniIcon> Edit data
        </ChartLink>
        <ChartLink onClick={() => setPhase('type')}>
          <MiniIcon size={10}><polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></MiniIcon> Change type
        </ChartLink>
      </div>
    </BlockShell>
  );
}

/* ============================================================
   TIMELINE — a gantt/roadmap view: one draggable bar per item,
   a day ruler, and a live "today" marker
   ============================================================ */

const TIMELINE_TINT = '#C97B4B';
/** World px per day column. Also the drag quantum — one day, never half of one. */
const DAY_W = 34;
const ROW_H = 30;
/** Width of the fixed label gutter on the left of the ruler. */
const LABEL_W = 122;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function TimelineBlock({ obj }: { obj: CanvasObjectData }) {
  const updateObject = useCanvasStore((s) => s.updateObject);
  const zoom = useCanvasStore((s) => s.camera.zoom);

  const items = readTimelineItems(obj);
  const title = (obj.style?.timelineTitle as string) ?? 'Timeline';

  const [draftLabel, setDraftLabel] = useState('');
  /** Live drag state — the committed items only change on pointerup. */
  const drag = useRef<{ id: string; edge: 'move' | 'end'; startX: number; from: TimelineItem } | null>(null);
  const [preview, setPreview] = useState<TimelineItem[] | null>(null);
  /** Mirror of `preview` readable from the pointerup handler, which closes over
   *  the render that started the drag and would otherwise see it as null. */
  const previewRef = useRef<TimelineItem[] | null>(null);

  const shown = preview ?? items;
  const { start: rangeStart, days } = useMemo(() => timelineRange(shown), [shown]);
  const today = daysBetween(rangeStart, new Date());

  const patch = (kv: Record<string, unknown>) => updateObject(obj.id, { style: { ...obj.style, ...kv } });
  const setItems = (next: TimelineItem[]) => patch({ timelineItems: next });

  const setItem = (id: string, part: Partial<TimelineItem>) =>
    setItems(items.map((i) => (i.id === id ? { ...i, ...part } : i)));
  const removeItem = (id: string) => setItems(items.filter((i) => i.id !== id));

  const addItem = () => {
    const label = draftLabel.trim();
    if (!label) return;
    // A new item starts where the plan currently ends, so the roadmap grows
    // forward instead of piling everything onto today.
    const last = items.length ? items.reduce((a, b) => (parseISODate(a.end) > parseISODate(b.end) ? a : b)) : null;
    const from = last ? addDays(parseISODate(last.end), 1) : new Date();
    setItems([
      ...items,
      {
        id: crypto.randomUUID(),
        label,
        start: toISODate(from),
        end: toISODate(addDays(from, 2)),
        color: TIMELINE_COLORS[items.length % TIMELINE_COLORS.length],
      },
    ]);
    setDraftLabel('');
  };

  /* Drag a bar to move it, or its right edge to restretch it. The canvas is a
     scaled world, so screen pixels are divided by the camera zoom before they
     mean anything in day columns — otherwise a bar would run away from the
     cursor at any zoom but 1. */
  const beginDrag = (e: React.PointerEvent, item: TimelineItem, edge: 'move' | 'end') => {
    e.stopPropagation();
    e.preventDefault();
    drag.current = { id: item.id, edge, startX: e.clientX, from: item };

    const onMove = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const delta = Math.round((ev.clientX - d.startX) / zoom / DAY_W);
      const s = parseISODate(d.from.start);
      const en = parseISODate(d.from.end);
      const next =
        d.edge === 'move'
          ? { ...d.from, start: toISODate(addDays(s, delta)), end: toISODate(addDays(en, delta)) }
          // Never let the end cross the start — a bar is at minimum one day.
          : { ...d.from, end: toISODate(addDays(en, Math.max(delta, -daysBetween(s, en)))) };
      const nextItems = items.map((i) => (i.id === d.id ? next : i));
      previewRef.current = nextItems;
      setPreview(nextItems);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      drag.current = null;
      const committed = previewRef.current;
      previewRef.current = null;
      setPreview(null);
      if (committed) setItems(committed);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <BlockShell
      tint={TIMELINE_TINT}
      tag="timeline"
      icon={<MiniIcon><rect x="3" y="4" width="18" height="16" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="8" y1="13" x2="15" y2="13" /><line x1="6" y1="17" x2="12" y2="17" /></MiniIcon>}
      badge={<Badge tint={TIMELINE_TINT}>{items.length} items</Badge>}
    >
      <Seamless
        value={title}
        onChange={(v) => patch({ timelineTitle: v })}
        placeholder="Timeline title…"
        className="text-[12px] font-bold mb-1.5"
      />

      <div
        className="flex-1 min-h-0 overflow-auto rounded-xl border border-[var(--border)] bg-[#FCF8F3] dark:bg-black/20"
        onWheel={stop}
        onPointerDown={stop}
      >
        <div className="relative" style={{ width: LABEL_W + days * DAY_W, minHeight: '100%' }}>
          {/* Day ruler */}
          <div className="sticky top-0 z-20 flex h-9 bg-[#FCF8F3] dark:bg-[#1c1917] border-b border-[var(--border)]">
            <div className="shrink-0 flex items-end text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-tertiary)]" style={{ width: LABEL_W, paddingBottom: 4, paddingLeft: 8 }}>
              {MONTHS[rangeStart.getMonth()]} {rangeStart.getFullYear()}
            </div>
            {Array.from({ length: days }, (_, i) => {
              const d = addDays(rangeStart, i);
              const isToday = i === today;
              return (
                <div
                  key={i}
                  className="shrink-0 flex items-end justify-center border-l border-[var(--border)]"
                  style={{ width: DAY_W, paddingBottom: 4 }}
                >
                  <span
                    className={`text-[9px] tabular-nums font-semibold ${isToday ? 'text-white' : 'text-[var(--text-tertiary)]'}`}
                    style={isToday ? { background: '#D64545', borderRadius: 999, padding: '1px 5px' } : undefined}
                  >
                    {d.getDate()}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Today line — drawn over the rows, under the bars' labels */}
          {today >= 0 && today < days && (
            <div
              className="absolute top-9 bottom-0 w-px z-10 pointer-events-none"
              style={{ left: LABEL_W + today * DAY_W + DAY_W / 2, background: '#D64545' }}
            />
          )}

          {/* Rows */}
          <div className="relative">
            {shown.map((item) => {
              const s = Math.max(0, daysBetween(rangeStart, parseISODate(item.start)));
              const span = Math.max(1, daysBetween(parseISODate(item.start), parseISODate(item.end)) + 1);
              const color = item.color || TIMELINE_TINT;
              return (
                <div key={item.id} className="group/tl flex items-center border-b border-[var(--border)] last:border-b-0" style={{ height: ROW_H }}>
                  <div className="shrink-0 flex items-center gap-1" style={{ width: LABEL_W, paddingLeft: 8, paddingRight: 4 }}>
                    <Seamless
                      value={item.label}
                      onChange={(v) => setItem(item.id, { label: v })}
                      placeholder="Task…"
                      className="text-[10.5px] font-semibold"
                    />
                    <button
                      onClick={(e) => { stop(e); removeItem(item.id); }}
                      onMouseDown={stop}
                      onPointerDown={stop}
                      aria-label="Remove item"
                      className="w-4 h-4 rounded-full items-center justify-center text-[var(--text-muted)] hover:text-red-500 hidden group-hover/tl:flex shrink-0 cursor-pointer"
                    >
                      <MiniIcon size={9}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></MiniIcon>
                    </button>
                  </div>

                  <div className="relative flex-1 h-full">
                    <div
                      onPointerDown={(e) => beginDrag(e, item, 'move')}
                      title={`${item.start} → ${item.end}`}
                      className="absolute top-1/2 -translate-y-1/2 h-[19px] rounded-full flex items-center cursor-grab active:cursor-grabbing shadow-sm select-none"
                      style={{
                        left: s * DAY_W + 3,
                        width: span * DAY_W - 6,
                        background: color,
                        opacity: item.done ? 0.45 : 1,
                        padding: '0 8px',
                      }}
                    >
                      <span className="text-[9.5px] font-bold text-white truncate">{item.label}</span>
                      {/* Right-edge grip: restretches the bar */}
                      <span
                        onPointerDown={(e) => beginDrag(e, item, 'end')}
                        className="absolute right-0 top-0 h-full w-2 cursor-ew-resize rounded-r-full"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Add an item */}
      <div className="flex items-center gap-2 shrink-0" style={{ paddingTop: 8 }}>
        <input
          type="text"
          value={draftLabel}
          placeholder="+ add a milestone"
          onChange={(e) => setDraftLabel(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addItem()}
          onMouseDown={stop}
          onPointerDown={stop}
          onClick={stop}
          className="flex-1 min-w-0 bg-[#F5EFE7] dark:bg-white/10 rounded-md text-[10px] font-semibold outline-none focus:ring-1 focus:ring-[var(--accent)]/40 cursor-text placeholder:text-[var(--text-muted)]"
          style={{ padding: '4px 8px' }}
        />
      </div>
    </BlockShell>
  );
}

/* ============================================================
   TABLE — a real grid. Editable header + cells, add/remove rows
   and columns, Enter walks down a column, arrows move between
   rows, and pasting TSV from a spreadsheet fills the grid.
   ============================================================ */

const TABLE_TINT = '#8B5FBF';
const CELL_MIN_W = 96;

/** True if the string reads as a number (so the cell right-aligns like one). */
function looksNumeric(v: string): boolean {
  const t = v.trim().replace(/[,%$€£\s]/g, '');
  return t !== '' && !isNaN(Number(t));
}

export function TableBlock({ obj }: { obj: CanvasObjectData }) {
  const updateObject = useCanvasStore((s) => s.updateObject);
  const rootRef = useRef<HTMLDivElement>(null);

  const title = (obj.style?.tableTitle as string) || '';
  const cols = useMemo<string[]>(
    () => (Array.isArray(obj.style?.tableCols) && (obj.style!.tableCols as string[]).length
      ? (obj.style!.tableCols as string[])
      : ['Column A', 'Column B']),
    [obj.style]
  );
  const rows = useMemo<string[][]>(() => {
    const raw = Array.isArray(obj.style?.tableRows) ? (obj.style!.tableRows as string[][]) : [];
    // Every row padded/truncated to the header width so the grid never skews.
    return raw.map((r) => Array.from({ length: cols.length }, (_, i) => String(r?.[i] ?? '')));
  }, [obj.style, cols.length]);

  const patch = (kv: Record<string, unknown>) =>
    updateObject(obj.id, { style: { ...obj.style, ...kv } });

  const setCell = (r: number, c: number, v: string) =>
    patch({ tableRows: rows.map((row, ri) => (ri === r ? row.map((cell, ci) => (ci === c ? v : cell)) : row)) });
  const setHeader = (c: number, v: string) =>
    patch({ tableCols: cols.map((h, ci) => (ci === c ? v : h)) });

  const addRow = (at?: number) => {
    const blank = Array.from({ length: cols.length }, () => '');
    const idx = at ?? rows.length;
    patch({ tableRows: [...rows.slice(0, idx), blank, ...rows.slice(idx)] });
  };
  const removeRow = (r: number) => patch({ tableRows: rows.filter((_, ri) => ri !== r) });
  const addCol = () => {
    patch({
      tableCols: [...cols, ''],
      tableRows: rows.map((row) => [...row, '']),
    });
    focusCell(-1, cols.length);
  };
  const removeCol = (c: number) => {
    if (cols.length <= 1) return;
    patch({
      tableCols: cols.filter((_, ci) => ci !== c),
      tableRows: rows.map((row) => row.filter((_, ci) => ci !== c)),
    });
  };

  /** Focus the input at (row, col) — row -1 is the header. */
  const focusCell = (r: number, c: number) => {
    requestAnimationFrame(() => {
      const el = rootRef.current?.querySelector<HTMLInputElement>(`input[data-tcell="${r}:${c}"]`);
      el?.focus();
      el?.select();
    });
  };

  const onCellKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, r: number, c: number) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (r >= rows.length - 1) addRow();
      focusCell(r + 1, c);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (r < rows.length - 1) focusCell(r + 1, c);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusCell(r - 1, c); // r-1 === -1 lands on the header, which is right
    } else if (e.key === 'Escape') {
      (e.target as HTMLInputElement).blur();
    }
  };

  /** Paste a block of cells (tab/newline separated — i.e. copied from any
   *  spreadsheet) into the grid starting at (r, c). Grows the table to fit. */
  const onCellPaste = (e: React.ClipboardEvent<HTMLInputElement>, r: number, c: number) => {
    const text = e.clipboardData.getData('text/plain');
    if (!/[\t\n]/.test(text)) return; // single value → let the input handle it
    e.preventDefault();
    const grid = text.replace(/\r/g, '').split('\n').filter((l) => l.length > 0).map((l) => l.split('\t'));
    const needCols = Math.max(cols.length, c + Math.max(...grid.map((g) => g.length)));
    const needRows = Math.max(rows.length, r + grid.length);
    const nextCols = Array.from({ length: needCols }, (_, i) => cols[i] ?? '');
    const nextRows = Array.from({ length: needRows }, (_, ri) =>
      Array.from({ length: needCols }, (_, ci) => {
        const pasted = grid[ri - r]?.[ci - c];
        return pasted !== undefined ? pasted : String(rows[ri]?.[ci] ?? '');
      })
    );
    patch({ tableCols: nextCols, tableRows: nextRows });
  };

  const template = `repeat(${cols.length}, minmax(${CELL_MIN_W}px, 1fr)) 26px`;
  const minW = cols.length * CELL_MIN_W + 26;
  const filled = rows.reduce((n, row) => n + (row.some((cell) => cell.trim() !== '') ? 1 : 0), 0);

  return (
    <BlockShell
      tint={TABLE_TINT}
      tag="table"
      icon={<MiniIcon><rect x="3" y="4" width="18" height="16" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="14" x2="21" y2="14" /><line x1="9" y1="4" x2="9" y2="20" /><line x1="15" y1="4" x2="15" y2="20" /></MiniIcon>}
      badge={<Badge tint={TABLE_TINT}>{rows.length} × {cols.length}</Badge>}
    >
      <Seamless
        value={title}
        onChange={(v) => patch({ tableTitle: v })}
        placeholder="Table title…"
        className="text-[12px] font-bold"
      />

      <div
        ref={rootRef}
        className="flex-1 min-h-0 overflow-auto rounded-xl border border-[var(--border)] bg-[#FCF8F3] dark:bg-black/20 custom-scrollbar"
        style={{ marginTop: 8 }}
        onWheel={stop}
        onPointerDown={stop}
        onMouseDown={stop}
      >
        <div style={{ minWidth: minW }}>
          {/* Header row — sticky so long tables keep their labels */}
          <div
            className="sticky top-0 z-10 grid bg-[#F5EFE7] dark:bg-[#26221E] border-b border-[var(--border-strong)]"
            style={{ gridTemplateColumns: template }}
          >
            {cols.map((h, c) => (
              <div key={c} className="group/th relative flex items-center border-r border-[var(--border)] last:border-r-0">
                <input
                  type="text"
                  value={h}
                  data-tcell={`-1:${c}`}
                  placeholder={`Column ${String.fromCharCode(65 + (c % 26))}`}
                  onChange={(e) => setHeader(c, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); focusCell(0, c); }
                  }}
                  onMouseDown={stop} onPointerDown={stop} onClick={stop}
                  className="w-full min-w-0 bg-transparent outline-none text-[10.5px] font-extrabold uppercase tracking-[0.08em] cursor-text placeholder:normal-case placeholder:tracking-normal placeholder:font-semibold placeholder:text-[var(--text-muted)]"
                  style={{ padding: '7px 9px', color: TABLE_TINT }}
                />
                {cols.length > 1 && (
                  <button
                    onClick={(e) => { stop(e); removeCol(c); }}
                    onMouseDown={stop} onPointerDown={stop}
                    aria-label="Remove column"
                    title="Remove column"
                    className="absolute right-0.5 w-3.5 h-3.5 rounded-full items-center justify-center text-[var(--text-muted)] hover:text-red-500 hidden group-hover/th:flex cursor-pointer bg-inherit"
                  >
                    <MiniIcon size={8}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></MiniIcon>
                  </button>
                )}
              </div>
            ))}
            <button
              onClick={(e) => { stop(e); addCol(); }}
              onMouseDown={stop} onPointerDown={stop}
              aria-label="Add column"
              title="Add column"
              className="flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors cursor-pointer"
            >
              <MiniIcon size={11}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></MiniIcon>
            </button>
          </div>

          {/* Body rows */}
          {rows.map((row, r) => (
            <div
              key={r}
              className="group/tr grid border-b border-[var(--border)] last:border-b-0 hover:bg-[rgba(139,95,191,0.045)] transition-colors"
              style={{ gridTemplateColumns: template, background: r % 2 === 1 ? 'rgba(90,62,40,0.025)' : undefined }}
            >
              {row.map((cell, c) => (
                <div key={c} className="flex items-center border-r border-[var(--border)] last:border-r-0 min-w-0">
                  <input
                    type="text"
                    value={cell}
                    data-tcell={`${r}:${c}`}
                    onChange={(e) => setCell(r, c, e.target.value)}
                    onKeyDown={(e) => onCellKeyDown(e, r, c)}
                    onPaste={(e) => onCellPaste(e, r, c)}
                    onMouseDown={stop} onPointerDown={stop} onClick={stop}
                    className={`w-full min-w-0 bg-transparent outline-none text-[11.5px] font-medium text-[var(--text-primary)] cursor-text focus:bg-[rgba(139,95,191,0.07)] ${looksNumeric(cell) ? 'text-right tabular-nums' : ''}`}
                    style={{ padding: '6px 9px' }}
                  />
                </div>
              ))}
              <button
                onClick={(e) => { stop(e); removeRow(r); }}
                onMouseDown={stop} onPointerDown={stop}
                aria-label="Remove row"
                title="Remove row"
                className="items-center justify-center text-[var(--text-muted)] hover:text-red-500 hidden group-hover/tr:flex cursor-pointer"
              >
                <MiniIcon size={9}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></MiniIcon>
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between shrink-0" style={{ paddingTop: 8 }}>
        <button
          onClick={(e) => { stop(e); addRow(); focusCell(rows.length, 0); }}
          onMouseDown={stop} onPointerDown={stop}
          className="flex items-center gap-1 rounded-lg text-[10px] font-bold text-[var(--text-tertiary)] hover:text-[var(--accent)] border border-dashed border-[var(--border-strong)] cursor-pointer transition-colors"
          style={{ padding: '3px 9px' }}
        >
          <MiniIcon size={10}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></MiniIcon>
          Add row
        </button>
        <span className="text-[9px] font-semibold text-[var(--text-muted)] select-none">
          {filled}/{rows.length} filled · paste from a spreadsheet works
        </span>
      </div>
    </BlockShell>
  );
}
