'use client';

import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCanvasStore } from '@/store/canvasStore';
import { SKILL_PRESETS, activeRuleCount, isSkillsetActive } from '@/lib/skillset';

const spring = { type: 'spring' as const, stiffness: 300, damping: 30 };

/**
 * One line-art glyph per preset pack, keyed by its stable id.
 *
 * These cards used to carry an emoji each (📚 🚀 🎨 …). Emoji render in the
 * platform's own colours and its own cartoon style, so eight of them in a grid
 * fought both the accent colour of the card they sat on and the restrained
 * outline iconography used everywhere else in the app. A stroked glyph inherits
 * `currentColor`, so each one now picks up its pack's accent and the grid reads
 * as one designed set.
 */
function PresetGlyph({ id, size = 17 }: { id: string; size?: number }) {
  const wrap = (children: React.ReactNode) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
  switch (id) {
    // Study Buddy — an open book
    case 'study-buddy': return wrap(<><path d="M12 6.5C10.5 5 8.5 4.5 4 4.5v13C8.5 17.5 10.5 18 12 19.5" /><path d="M12 6.5c1.5-1.5 3.5-2 8-2v13c-4.5 0-6.5.5-8 2" /><path d="M12 6.5v13" /></>);
    // Startup War Room — a trajectory climbing off a launch pad
    case 'startup-war-room': return wrap(<><path d="M4 20c5-1 9-5 13.5-13.5" /><path d="M14 4.5h5.5V10" /><path d="M7 17l-2.5 3.5" /></>);
    // Design Studio — compass / bezier node
    case 'design-studio': return wrap(<><circle cx="12" cy="7" r="3" /><path d="M9.6 9.2 5.5 20l6.5-4 6.5 4-4.1-10.8" /></>);
    // Research Lab — a flask
    case 'research-lab': return wrap(<><path d="M9 3h6M10 3v6.2L4.8 18a2 2 0 0 0 1.7 3h11a2 2 0 0 0 1.7-3L14 9.2V3" /><path d="M7.2 14h9.6" /></>);
    // Code Architect — blueprint grid with a bracket
    case 'code-architect': return wrap(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9.5 9 7 12l2.5 3M14.5 9 17 12l-2.5 3" /></>);
    // Zen Minimalist — a single leaf
    case 'zen-minimalist': return wrap(<><path d="M4 20c0-8 6-14 16-14 0 10-6 15-16 14Z" /><path d="M9 15c2.5-2.5 5-4 8-5" /></>);
    // Brainstorm Machine — a lamp
    case 'brainstorm-machine': return wrap(<><path d="M9 18h6" /><path d="M10 21h4" /><path d="M12 3a6 6 0 0 0-3.5 10.9V18h7v-4.1A6 6 0 0 0 12 3Z" /></>);
    // Content Kitchen — a nib
    case 'content-kitchen': return wrap(<><path d="M12 19l7-7-7-7-7 7 7 7Z" opacity="0.35" /><path d="M4 20l3.5-3.5" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z" /></>);
    default: return wrap(<><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></>);
  }
}

/* A small pill toggle switch. Padding/margins are inline throughout this file
   because the app's global reset (`* { padding:0; margin:0 }`) is unlayered and
   overrides Tailwind's spacing utilities. */
function Toggle({ on, onChange, label }: { on: boolean; onChange: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onChange}
      role="switch"
      aria-checked={on}
      aria-label={label}
      className="relative shrink-0 rounded-full transition-colors duration-200"
      style={{
        width: 38,
        height: 22,
        background: on ? 'var(--accent)' : 'var(--border-strong)',
      }}
    >
      <motion.span
        className="absolute rounded-full bg-white shadow-sm"
        style={{ width: 16, height: 16, top: 3 }}
        animate={{ left: on ? 19 : 3 }}
        transition={spring}
      />
    </button>
  );
}

/** A textarea that grows to fit its content — used for each rule. */
function AutoTextarea({
  value,
  onChange,
  placeholder,
  disabled,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const resize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };
  useEffect(() => {
    resize();
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      disabled={disabled}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value)}
      onInput={resize}
      placeholder={placeholder}
      rows={1}
      className="w-full bg-transparent border-none outline-none resize-none text-[13px] leading-snug text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]"
      style={{ padding: 0, fontFamily: "'Inter', sans-serif" }}
    />
  );
}

export default function SkillSetPanel() {
  const open = useCanvasStore((s) => s.skillSetPanelOpen);
  const setOpen = useCanvasStore((s) => s.setSkillSetPanelOpen);
  const title = useCanvasStore((s) => s.workspaceTitle);
  const skillset = useCanvasStore((s) => s.skillset);

  const toggleEnabled = useCanvasStore((s) => s.toggleSkillsetEnabled);
  const setPersona = useCanvasStore((s) => s.setSkillsetPersona);
  const addRule = useCanvasStore((s) => s.addSkillRule);
  const updateRule = useCanvasStore((s) => s.updateSkillRule);
  const toggleRule = useCanvasStore((s) => s.toggleSkillRule);
  const removeRule = useCanvasStore((s) => s.removeSkillRule);
  const installPresetById = useCanvasStore((s) => s.installSkillPreset);
  const clearSkillset = useCanvasStore((s) => s.clearSkillset);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  const enabled = skillset?.enabled ?? false;
  const active = isSkillsetActive(skillset);
  const count = activeRuleCount(skillset);
  const rules = skillset?.rules ?? [];
  const installed = new Set(skillset?.presets ?? []);
  const dim = skillset ? !enabled : false;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[320] flex items-center justify-center"
          style={{ padding: 16 }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {/* scrim */}
          <div
            className="absolute inset-0 bg-[rgba(45,42,38,0.38)] backdrop-blur-md"
            onClick={() => setOpen(false)}
          />

          <motion.div
            initial={{ opacity: 0, y: 22, scale: 0.965 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 22, scale: 0.965 }}
            transition={spring}
            role="dialog"
            aria-modal="true"
            aria-label="Canvas Skill Set"
            className="clay-card relative w-full rounded-[28px] z-10 flex flex-col overflow-hidden"
            style={{ maxWidth: 640, maxHeight: '86vh' }}
          >
            {/* ---------- Header ---------- */}
            <div
              className="relative flex items-start gap-3 border-b border-[var(--border)]"
              style={{ padding: '22px 24px 18px' }}
            >
              <span
                className="shrink-0 flex items-center justify-center text-white rounded-2xl shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]"
                style={{ width: 40, height: 40, background: 'var(--accent)' }}
              >
                {/* scroll / rules glyph */}
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                  <path d="M9 7h7M9 11h7" />
                </svg>
              </span>
              <div className="flex-1 min-w-0" style={{ paddingRight: 96 }}>
                <h2 className="text-[17px] font-bold text-[var(--text-primary)] leading-tight" style={{ fontFamily: "'Outfit', sans-serif" }}>
                  Skill Set
                </h2>
                <p className="text-[11.5px] text-[var(--text-secondary)] leading-snug truncate" style={{ marginTop: 2 }}>
                  Rules the agent obeys in <span className="font-semibold text-[var(--text-primary)]">{title || 'this canvas'}</span>
                </p>
              </div>

              {/* master toggle + close, pinned top-right */}
              <div className="absolute flex items-center gap-2.5" style={{ top: 20, right: 20 }}>
                <span className="text-[10px] uppercase font-semibold tracking-wider" style={{ color: enabled ? 'var(--accent)' : 'var(--text-tertiary)' }}>
                  {enabled ? 'On' : 'Off'}
                </span>
                <Toggle on={enabled} onChange={toggleEnabled} label="Enable skill set" />
                <button
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-black/5 transition-colors rounded-full"
                  style={{ width: 28, height: 28 }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>

            {/* ---------- Body (scrolls) ---------- */}
            <div className="overflow-y-auto flex-1" style={{ padding: '18px 24px 8px', opacity: dim ? 0.55 : 1, transition: 'opacity .2s' }}>
              {/* Persona */}
              <div className="flex flex-col gap-1.5" style={{ marginBottom: 20 }}>
                <label className="text-[10px] uppercase font-semibold tracking-wider text-[var(--text-muted)]">
                  Agent persona <span className="normal-case font-normal text-[var(--text-tertiary)]">· optional</span>
                </label>
                <div
                  className="rounded-xl border border-[var(--border)] bg-[var(--bg-glass)] focus-within:border-[var(--accent)] transition-colors"
                  style={{ padding: '10px 12px' }}
                >
                  <AutoTextarea
                    value={skillset?.persona ?? ''}
                    onChange={setPersona}
                    disabled={dim}
                    placeholder="e.g. You are a patient physics tutor who explains with analogies."
                  />
                </div>
              </div>

              {/* Rules */}
              <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
                <label className="text-[10px] uppercase font-semibold tracking-wider text-[var(--text-muted)]">
                  Rules {count > 0 && <span className="text-[var(--accent)]">· {count} active</span>}
                </label>
                <button
                  onClick={() => addRule('')}
                  disabled={dim}
                  className="flex items-center gap-1 text-[11px] font-semibold text-[var(--accent)] hover:opacity-80 transition-opacity disabled:opacity-40"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                  Add rule
                </button>
              </div>

              {rules.length === 0 ? (
                <div
                  className="rounded-xl border border-dashed border-[var(--border-strong)] text-center"
                  style={{ padding: '18px 16px', marginBottom: 20 }}
                >
                  <p className="text-[12.5px] text-[var(--text-secondary)]">No rules yet.</p>
                  <p className="text-[11px] text-[var(--text-tertiary)]" style={{ marginTop: 3 }}>
                    Add your own, or install a skill pack below to start.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-2" style={{ marginBottom: 20 }}>
                  {rules.map((r, i) => (
                    <div
                      key={r.id}
                      className="group flex items-start gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] transition-colors hover:border-[var(--border-strong)]"
                      style={{ padding: '10px 12px', opacity: r.enabled ? 1 : 0.5 }}
                    >
                      <button
                        onClick={() => toggleRule(r.id)}
                        aria-label={r.enabled ? 'Disable rule' : 'Enable rule'}
                        className="shrink-0 flex items-center justify-center rounded-md border transition-all"
                        style={{
                          width: 18, height: 18, marginTop: 1,
                          background: r.enabled ? 'var(--accent)' : 'transparent',
                          borderColor: r.enabled ? 'var(--accent)' : 'var(--border-strong)',
                        }}
                      >
                        {r.enabled && (
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                        )}
                      </button>
                      <span className="shrink-0 text-[11px] font-mono text-[var(--text-tertiary)] select-none" style={{ marginTop: 1, width: 14 }}>{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <AutoTextarea
                          value={r.text}
                          onChange={(v) => updateRule(r.id, v)}
                          disabled={dim}
                          autoFocus={r.text === ''}
                          placeholder="Describe how the agent should behave…"
                        />
                      </div>
                      <button
                        onClick={() => removeRule(r.id)}
                        aria-label="Delete rule"
                        className="shrink-0 flex items-center justify-center text-[var(--text-tertiary)] hover:text-[#D64545] opacity-0 group-hover:opacity-100 transition-all rounded-md hover:bg-black/5"
                        style={{ width: 22, height: 22 }}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Preset gallery */}
              <div className="border-t border-[var(--border)]" style={{ paddingTop: 16, marginBottom: 4 }}>
                <div className="flex items-center gap-1.5" style={{ marginBottom: 4 }}>
                  <span className="text-[10px] uppercase font-semibold tracking-wider text-[var(--text-muted)]">Install a skill pack</span>
                  {/* Stroked spark, not ✨ — same reason as the pack glyphs. */}
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-[var(--text-muted)]">
                    <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3Z" />
                  </svg>
                </div>
                <p className="text-[11px] text-[var(--text-secondary)]" style={{ marginBottom: 12 }}>
                  One click adds a proven persona + rules. Packs stack — mix and match.
                </p>
                <div className="grid grid-cols-2 gap-2.5">
                  {SKILL_PRESETS.map((p) => {
                    const isIn = installed.has(p.id);
                    return (
                      <button
                        key={p.id}
                        onClick={() => installPresetById(p.id)}
                        className="group relative text-left rounded-2xl border transition-all hover:shadow-md"
                        style={{
                          padding: '12px 13px',
                          borderColor: isIn ? p.accent : 'var(--border)',
                          background: isIn ? `${p.accent}14` : 'var(--bg-card)',
                        }}
                      >
                        <div className="flex items-start gap-2.5">
                          <span
                            className="shrink-0 flex items-center justify-center rounded-xl"
                            style={{ width: 34, height: 34, background: `${p.accent}22`, color: p.accent }}
                          >
                            <PresetGlyph id={p.id} />
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[13px] font-bold text-[var(--text-primary)] truncate" style={{ fontFamily: "'Outfit', sans-serif" }}>{p.name}</span>
                            </div>
                            <p className="text-[10.5px] text-[var(--text-secondary)] leading-snug" style={{ marginTop: 2 }}>{p.tagline}</p>
                          </div>
                        </div>
                        <div className="flex items-center justify-between" style={{ marginTop: 9 }}>
                          <span className="text-[10px] font-medium text-[var(--text-tertiary)]">{p.rules.length} rules</span>
                          <span
                            className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide rounded-full transition-colors"
                            style={{
                              padding: '3px 9px',
                              color: isIn ? '#fff' : p.accent,
                              background: isIn ? p.accent : `${p.accent}1f`,
                            }}
                          >
                            {isIn ? (
                              <>
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                                Installed
                              </>
                            ) : (
                              'Install'
                            )}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* ---------- Footer ---------- */}
            <div
              className="flex items-center justify-between border-t border-[var(--border)] bg-[var(--bg-glass)]"
              style={{ padding: '12px 24px' }}
            >
              <div className="flex items-center gap-2">
                <span
                  className="rounded-full"
                  style={{ width: 7, height: 7, background: active ? '#2F9E6E' : 'var(--text-muted)' }}
                />
                <span className="text-[11px] text-[var(--text-secondary)]">
                  {active ? `Active — the agent follows ${count} rule${count === 1 ? '' : 's'} here` : 'Inactive — agent uses its default behavior'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {skillset && (
                  <button
                    onClick={() => { if (window.confirm('Remove this canvas’s entire skill set?')) clearSkillset(); }}
                    className="text-[11px] font-medium text-[var(--text-tertiary)] hover:text-[#D64545] transition-colors"
                    style={{ padding: '6px 8px' }}
                  >
                    Clear all
                  </button>
                )}
                <button
                  onClick={() => setOpen(false)}
                  className="text-[12px] font-bold text-white rounded-full shadow-sm hover:brightness-105 transition-all"
                  style={{ padding: '7px 18px', background: 'var(--accent)' }}
                >
                  Done
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
