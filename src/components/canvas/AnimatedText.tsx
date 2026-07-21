'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  resolveAnim,
  type AnimPreset,
  type AnimTrigger,
  SCRAMBLE_GLYPHS,
  MATRIX_GLYPHS,
} from '@/lib/textAnim';

/**
 * The text-animation engine (runtime half of src/lib/textAnim.ts).
 *
 * Wraps the normal RichText render. When no animation is configured — or the
 * viewer prefers reduced motion — it returns `children` untouched (zero cost,
 * full markdown). Otherwise it either:
 *   • surface  → wraps children in one animated class (markdown preserved), or
 *   • kinetic  → tokenises `content` into staggered line/word/char spans, or
 *   • special  → drives typewriter / scramble on a JS clock.
 *
 * Everything runs on transform / opacity / filter so it composites cheaply and
 * never triggers layout — the block's measured size stays stable throughout.
 */

/* ----------------------------- shared helpers ---------------------------- */

function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const m = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduce(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return reduce;
}

/** Deterministic 0..1 pseudo-random keyed by index+salt (stable across renders). */
function rnd(i: number, salt: number): number {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

type CSSVars = React.CSSProperties & Record<`--${string}`, string | number>;

/**
 * Playback wiring shared by every family. Loop effects run continuously; the
 * rest reveal when scrolled into view (which also fires the moment they mount
 * on-screen, and re-fires when a present-mode scene brings them back) and can
 * be replayed on click. `runId` remounts the inner tree to restart cleanly.
 */
function usePlayback(trigger: AnimTrigger, loop: boolean) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [runId, setRunId] = useState(0);
  const [playing, setPlaying] = useState(loop);

  useEffect(() => {
    if (loop) {
      setPlaying(true);
      return;
    }
    const el = rootRef.current;
    if (!el) return;
    let inView = false;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && !inView) {
            inView = true;
            setRunId((n) => n + 1);
            setPlaying(true);
          } else if (!e.isIntersecting && inView) {
            inView = false;
            setPlaying(false);
          }
        }
      },
      { threshold: 0.12 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [loop]);

  const replay = useCallback(() => {
    setRunId((n) => n + 1);
    setPlaying(true);
  }, []);

  return { rootRef, runId, playing, replay };
}

/* --------------------------- kinetic tokeniser --------------------------- */

const CHAR_CAP = 420;
const WORD_CAP = 240;

/** Split content into staggered spans. Returns null when it's too large to split
 *  gracefully (caller falls back to a simple surface fade). */
function buildKinetic(content: string, unit: 'char' | 'word' | 'line'): React.ReactNode | null {
  const text = content.replace(/\s+$/g, '');
  if (!text) return null;

  // Degrade to a coarser unit for very long text so we never emit thousands of spans.
  let u = unit;
  if (u === 'char' && text.length > CHAR_CAP) u = 'word';
  if (u === 'word' && text.split(/\s+/).length > WORD_CAP) u = 'line';

  const lines = text.split('\n');
  let idx = 0; // running stagger index across the whole block

  const unitStyle = (i: number): CSSVars => ({
    '--i': i,
    '--rx': (rnd(i, 1) * 2 - 1).toFixed(3),
    '--ry': (rnd(i, 2) * 2 - 1).toFixed(3),
    '--rr': (rnd(i, 3) * 2 - 1).toFixed(3),
  });

  const out: React.ReactNode[] = [];

  lines.forEach((line, li) => {
    if (line === '') {
      out.push(<span key={`ln${li}`} className="ct-line" style={{ display: 'block', height: '0.62em' }} />);
      return;
    }

    if (u === 'line') {
      out.push(
        <span key={`ln${li}`} className="ct-line" style={{ display: 'block' }}>
          <span className="ct-u" style={{ display: 'block', ...unitStyle(idx++) }}>{line}</span>
        </span>
      );
      return;
    }

    // Preserve whitespace runs as plain text so wrapping stays natural.
    const parts = line.split(/(\s+)/);
    const inner: React.ReactNode[] = parts.map((part, pi) => {
      if (part === '' ) return null;
      if (/^\s+$/.test(part)) return <React.Fragment key={`w${li}-${pi}`}>{part}</React.Fragment>;

      if (u === 'word') {
        return (
          <span key={`w${li}-${pi}`} className="ct-u ct-word" style={{ display: 'inline-block', ...unitStyle(idx++) }}>
            {part}
          </span>
        );
      }
      // char: keep the word intact (inline-block) so it never wraps mid-word,
      // animate each glyph inside it.
      const chars = Array.from(part).map((ch, ci) => (
        <span key={ci} className="ct-u ct-char" style={{ display: 'inline-block', ...unitStyle(idx++) }}>
          {ch}
        </span>
      ));
      return (
        <span key={`w${li}-${pi}`} className="ct-word" style={{ display: 'inline-block', whiteSpace: 'nowrap' }}>
          {chars}
        </span>
      );
    });

    out.push(
      <span key={`ln${li}`} className="ct-line" style={{ display: 'block' }}>
        {inner}
      </span>
    );
  });

  return <>{out}</>;
}

/* -------------------------------- families ------------------------------- */

function SurfaceText({
  preset,
  playing,
  runId,
  children,
}: {
  preset: AnimPreset;
  playing: boolean;
  runId: number;
  children: React.ReactNode;
}) {
  const style: CSSVars = {
    display: 'block',
    ['--ct-dur']: `${preset.dur ?? 2400}ms`,
  };
  return (
    <span
      key={runId}
      className={`ct-surface ct-${preset.id}${playing ? ' ct-play' : ''}${preset.loop ? ' ct-loop' : ''}`}
      style={style}
      data-text={typeof children === 'string' ? children : undefined}
    >
      {children}
    </span>
  );
}

function CssKinetic({
  preset,
  playing,
  runId,
  speed,
  stagger,
  tokens,
}: {
  preset: AnimPreset;
  playing: boolean;
  runId: number;
  speed: number;
  stagger: number;
  tokens: React.ReactNode;
}) {
  const style: CSSVars = {
    ['--ct-speed']: speed,
    ['--ct-stagger']: `${stagger}ms`,
    ['--ct-dur']: `${preset.dur ?? 620}ms`,
  };
  return (
    <span
      key={runId}
      className={`ct-kinetic ct-${preset.id}${playing ? ' ct-play' : ''}${preset.loop ? ' ct-loop' : ''}`}
      style={style}
    >
      {tokens}
    </span>
  );
}

/** Typewriter — reveals a growing prefix over an invisible full-text layer that
 *  reserves the final size, so the block never reflows and the caret sits right. */
function TypewriterText({
  content,
  playing,
  runId,
  speed,
  perChar,
  loop,
}: {
  content: string;
  playing: boolean;
  runId: number;
  speed: number;
  perChar: number;
  loop: boolean;
}) {
  const text = content.replace(/\s+$/g, '');
  const [n, setN] = useState(0);

  useEffect(() => {
    setN(0);
    if (!playing || !text) return;
    let raf = 0;
    let hold = 0;
    let start = 0;
    const step = Math.max(14, perChar / speed);
    const total = text.length;
    const tick = (t: number) => {
      if (!start) start = t;
      const shown = Math.min(total, Math.floor((t - start) / step));
      setN(shown);
      if (shown < total) {
        raf = requestAnimationFrame(tick);
      } else if (loop) {
        // brief hold on the full line, then retype from the top
        hold = window.setTimeout(() => { start = 0; setN(0); raf = requestAnimationFrame(tick); }, 1100);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); clearTimeout(hold); };
  }, [text, playing, speed, perChar, loop, runId]);

  const done = n >= text.length;
  return (
    <span key={runId} className="ct-typewriter" style={{ position: 'relative', display: 'inline-block', minWidth: '1ch' }}>
      <span aria-hidden style={{ visibility: 'hidden', whiteSpace: 'pre-wrap' }}>{text || ' '}</span>
      <span style={{ position: 'absolute', inset: 0, whiteSpace: 'pre-wrap' }}>
        {text.slice(0, n)}
        <span className={`ct-caret${done && !loop ? ' ct-caret-done' : ''}`} aria-hidden>|</span>
      </span>
    </span>
  );
}

/** Scramble / decrypt — each glyph churns through random characters, then settles
 *  into place on a staggered schedule. Rendered over a reserved invisible layer. */
function ScrambleText({
  content,
  playing,
  runId,
  speed,
  stagger,
  loop,
  matrix,
}: {
  content: string;
  playing: boolean;
  runId: number;
  speed: number;
  stagger: number;
  loop: boolean;
  matrix: boolean;
}) {
  const text = content.replace(/\s+$/g, '');
  const chars = useMemo(() => Array.from(text), [text]);
  const pool = matrix ? MATRIX_GLYPHS : SCRAMBLE_GLYPHS;
  const [display, setDisplay] = useState<string[]>(() => chars.map(() => ''));

  useEffect(() => {
    if (!playing || chars.length === 0) {
      setDisplay(chars.map(() => ''));
      return;
    }
    let raf = 0;
    let hold = 0;
    let start = 0;
    const st = Math.max(18, stagger / speed);
    const settleEach = 340 / speed; // how long a glyph scrambles before locking
    const totalMs = chars.length * st + settleEach;

    const frame = (t: number) => {
      if (!start) start = t;
      const el = t - start;
      const next = chars.map((real, i) => {
        if (real === ' ') return ' ';
        const begin = i * st;
        if (el >= begin + settleEach) return real; // locked
        if (el < begin) return el < begin - 120 ? '' : pool[Math.floor(rnd(i, Math.floor(el / 40)) * pool.length)];
        return pool[Math.floor(rnd(i, Math.floor(el / 40)) * pool.length)];
      });
      setDisplay(next);
      if (el < totalMs) {
        raf = requestAnimationFrame(frame);
      } else {
        setDisplay(chars);
        if (loop) {
          hold = window.setTimeout(() => { start = 0; raf = requestAnimationFrame(frame); }, 1200);
        }
      }
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); clearTimeout(hold); };
  }, [chars, playing, speed, stagger, loop, matrix, pool, runId]);

  return (
    <span key={runId} className={`ct-scramble${matrix ? ' ct-matrix' : ''}`} style={{ position: 'relative', display: 'inline-block' }}>
      <span aria-hidden style={{ visibility: 'hidden', whiteSpace: 'pre-wrap' }}>{text || ' '}</span>
      <span style={{ position: 'absolute', inset: 0, whiteSpace: 'pre-wrap' }} aria-label={text}>
        {chars.map((real, i) => {
          if (real === '\n') return <br key={i} />;
          const shown = display[i] ?? '';
          const locked = shown === real;
          return (
            <span key={i} className={locked ? 'ct-locked' : 'ct-churn'} style={{ display: 'inline-block' }}>
              {shown === '' ? '​' : shown}
            </span>
          );
        })}
      </span>
    </span>
  );
}

/* -------------------------------- wrapper -------------------------------- */

export default function AnimatedText({
  content,
  anim,
  children,
}: {
  content: string;
  anim: unknown;
  children: React.ReactNode;
}) {
  const reduce = usePrefersReducedMotion();
  const resolved = resolveAnim(anim);

  // Nothing to play, or the viewer opted out of motion → the plain, fully
  // markdown-capable render. This is also the SSR / no-JS path.
  const preset = resolved?.preset;
  const isLoop = !!preset?.loop || resolved?.cfg.trigger === 'loop';
  const { rootRef, runId, playing, replay } = usePlayback(resolved?.cfg.trigger ?? 'appear', isLoop);

  if (!resolved || reduce) return <>{children}</>;

  const { cfg } = resolved;
  const clickable = cfg.trigger === 'click';

  let inner: React.ReactNode;
  if (preset!.special === 'typewriter') {
    inner = (
      <TypewriterText content={content} playing={playing} runId={runId} speed={cfg.speed} perChar={preset!.dur ?? 55} loop={isLoop} />
    );
  } else if (preset!.special === 'scramble') {
    inner = (
      <ScrambleText content={content} playing={playing} runId={runId} speed={cfg.speed} stagger={cfg.stagger} loop={isLoop} matrix={preset!.id === 'matrix'} />
    );
  } else if (preset!.kind === 'kinetic') {
    const tokens = buildKinetic(content, (preset!.unit ?? 'word'));
    if (tokens === null) {
      inner = (
        <span key={runId} className={`ct-surface ct-fade-simple${playing ? ' ct-play' : ''}`} style={{ display: 'block' }}>
          {children}
        </span>
      );
    } else {
      inner = <CssKinetic preset={preset!} playing={playing} runId={runId} speed={cfg.speed} stagger={cfg.stagger} tokens={tokens} />;
    }
  } else {
    inner = <SurfaceText preset={preset!} playing={playing} runId={runId}>{children}</SurfaceText>;
  }

  return (
    <div
      ref={rootRef}
      className="ct-root"
      style={{ display: 'block', cursor: clickable ? 'pointer' : undefined }}
      onClick={clickable ? (e) => { e.stopPropagation(); replay(); } : undefined}
      title={clickable ? 'Click to replay' : undefined}
    >
      {inner}
    </div>
  );
}
