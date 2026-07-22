'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFlowStore, type FlowMood } from '@/store/flowStore';

/**
 * Flow Mode overlay — the cinematic writing layer.
 *
 * A warm spotlight tracks your caret while the rest of the canvas falls into a
 * soft dark frame; the toolbar melts away while you type; the room's mood shifts
 * to match what you write; and a little sprite grows with the session's words.
 *
 * All per-frame work (spotlight lerp, momentum decay) writes straight to the DOM
 * from one rAF loop — React only re-renders for the word tally (~4×/s) and mood
 * changes. Reads the active `.text-block-editable` + live selection, so it's
 * fully decoupled from how the canvas stores content.
 */

const WORDS_PER_PAGE = 300;

/* ------------------------------ mood engine ------------------------------ */

const MOOD_LEXICON: { mood: FlowMood; words: string[] }[] = [
  { mood: 'fire',   words: ['fire', 'flame', 'flames', 'burn', 'burning', 'burned', 'ember', 'embers', 'heat', 'spark', 'candle', 'glow', 'blaze', 'ash', 'smoke', 'furnace'] },
  { mood: 'rain',   words: ['rain', 'rainy', 'storm', 'stormy', 'drizzle', 'thunder', 'cloud', 'clouds', 'cloudy', 'grey', 'gray', 'mist', 'wet', 'downpour', 'monsoon', 'umbrella'] },
  { mood: 'ocean',  words: ['ocean', 'sea', 'wave', 'waves', 'tide', 'tides', 'beach', 'shore', 'sail', 'coral', 'current', 'harbor', 'harbour', 'seaside', 'surf'] },
  { mood: 'night',  words: ['night', 'nights', 'midnight', 'moon', 'moonlight', 'star', 'stars', 'starlight', 'sleep', 'dream', 'dreams', 'silence', 'evening', 'dusk', 'nocturnal'] },
  { mood: 'forest', words: ['forest', 'tree', 'trees', 'leaf', 'leaves', 'green', 'wood', 'woods', 'woodland', 'nature', 'grass', 'garden', 'bloom', 'blossom', 'moss', 'meadow'] },
  { mood: 'warm',   words: ['love', 'loved', 'happy', 'happiness', 'joy', 'joyful', 'hope', 'hopeful', 'bright', 'smile', 'light', 'gold', 'golden', 'peace', 'gentle', 'warm', 'home', 'alive', 'wonder', 'beautiful', 'grateful'] },
  { mood: 'cold',   words: ['sad', 'sadness', 'cry', 'crying', 'tears', 'alone', 'lonely', 'cold', 'lost', 'pain', 'fear', 'afraid', 'empty', 'broken', 'grief', 'numb', 'sorrow', 'ache'] },
];

function analyzeMood(raw: string): FlowMood {
  const text = raw.slice(-700).toLowerCase();
  if (!text.trim()) return 'calm';
  const tokens = text.split(/[^a-z']+/);
  const seen = new Set(tokens);
  let best: FlowMood = 'calm';
  let bestScore = 0;
  for (const entry of MOOD_LEXICON) {
    let score = 0;
    for (const w of entry.words) if (seen.has(w)) score++;
    // Priority is encoded by lexicon order — a tie keeps the earlier (stronger) mood.
    if (score > bestScore) { bestScore = score; best = entry.mood; }
  }
  return bestScore > 0 ? best : 'calm';
}

function countWords(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  return t.split(/\s+/).length;
}

/* ---------------------------- ambient weather ---------------------------- */

function moodParticleClass(mood: FlowMood): string {
  if (mood === 'rain') return 'flow-rain';
  if (mood === 'night') return 'flow-star';
  if (mood === 'fire') return 'flow-ember-fx';
  return 'flow-mote';
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

function FlowAmbient({ mood }: { mood: FlowMood }) {
  const cls = moodParticleClass(mood);
  const particles = useMemo(() => {
    const count = mood === 'rain' ? 46 : mood === 'night' ? 42 : mood === 'fire' ? 26 : 22;
    return Array.from({ length: count }, (_, i) => {
      if (cls === 'flow-rain') {
        return { left: `${rand(-4, 100)}%`, animationDuration: `${rand(0.5, 1.05)}s`, animationDelay: `${-rand(0, 1.2)}s` };
      }
      if (cls === 'flow-star') {
        return { left: `${rand(2, 98)}%`, top: `${rand(4, 82)}%`, animationDuration: `${rand(2.2, 5)}s`, animationDelay: `${-rand(0, 4)}s` };
      }
      if (cls === 'flow-ember-fx') {
        return { left: `${rand(4, 96)}%`, animationDuration: `${rand(3.4, 6.5)}s`, animationDelay: `${-rand(0, 5)}s` };
      }
      return { left: `${rand(2, 96)}%`, top: `${rand(6, 92)}%`, animationDuration: `${rand(6, 13)}s`, animationDelay: `${-rand(0, 8)}s` };
    });
  }, [cls, mood]);

  return (
    <div className={`flow-ambient ${cls}`} aria-hidden>
      {particles.map((p, i) => (
        <span key={i} className="p" style={p as React.CSSProperties} />
      ))}
    </div>
  );
}

/* --------------------------- living progress ----------------------------- */

function ProgressWidget({ words, wpm, page, progress, emberRef }: {
  words: number; wpm: number; page: number; progress: number; emberRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="flow-progress" aria-hidden>
      <div className="sprite">
        <div className="ember" ref={emberRef} />
        <svg width="34" height="52" viewBox="0 0 34 52" fill="none">
          <path
            d="M17 50 C 14 40 20 30 17 20 C 15 13 17 11 17 9"
            pathLength={100}
            stroke="rgb(var(--flow-accent))" strokeWidth="2.2" strokeLinecap="round"
            style={{ strokeDasharray: 100, strokeDashoffset: 100 * (1 - progress), transition: 'stroke-dashoffset .6s ease', opacity: 0.9 }}
          />
          {/* leaves unfurl as the page fills */}
          <ellipse cx="10.5" cy="32" rx="6" ry="3" transform="rotate(-28 10.5 32)" fill="rgb(var(--flow-accent))" style={{ opacity: progress > 0.28 ? 0.75 : 0, transition: 'opacity .5s ease' }} />
          <ellipse cx="23.5" cy="24" rx="6" ry="3" transform="rotate(28 23.5 24)" fill="rgb(var(--flow-accent))" style={{ opacity: progress > 0.62 ? 0.75 : 0, transition: 'opacity .5s ease' }} />
          {/* bloom at the crown when a page is nearly done */}
          <circle cx="17" cy="8" r="4" fill="rgb(var(--flow-accent))" style={{ opacity: progress > 0.9 ? 0.9 : 0, transition: 'opacity .5s ease' }} />
        </svg>
      </div>
      <div>
        <div className="stat-words">{words.toLocaleString()}</div>
        <div className="stat-label">words{page > 1 ? ` · p${page}` : ''}</div>
        {wpm > 0 && <div className="stat-wpm">{wpm} wpm</div>}
      </div>
    </div>
  );
}

/* ------------------------------- the layer ------------------------------- */

export default function FlowModeLayer() {
  const enabled = useFlowStore((s) => s.enabled);
  const prefs = useFlowStore((s) => s.prefs);
  const intensity = useFlowStore((s) => s.intensity);
  const mood = useFlowStore((s) => s.mood);
  const setMood = useFlowStore((s) => s.setMood);
  const setTyping = useFlowStore((s) => s.setTyping);
  const setSession = useFlowStore((s) => s.setSession);

  const prefsRef = useRef(prefs); prefsRef.current = prefs;
  const intensityRef = useRef(intensity); intensityRef.current = intensity;

  const spotRef = useRef<HTMLDivElement>(null);
  const edgeRef = useRef<HTMLDivElement>(null);
  const emberRef = useRef<HTMLDivElement>(null);

  const [disp, setDisp] = useState({ words: 0, wpm: 0 });

  useEffect(() => {
    if (!enabled) return;
    document.body.classList.add('flow-on');

    const W = () => window.innerWidth;
    const H = () => window.innerHeight;
    const cur = { x: W() / 2, y: H() / 2, s: 1.4, a: 0 };
    const tgt = { x: W() / 2, y: H() / 2, s: 1.4, a: 0 };
    const stats = {
      words: 0,
      momentum: 0,
      wordTimes: [] as number[],
      baselines: new WeakMap<Element, { w: number; c: number }>(),
    };

    /* ---- typing / chrome ---- */
    let idleTimer = 0;
    let moodTimer = 0;
    const showChrome = () => document.body.classList.remove('flow-typing');
    const goIdle = () => { showChrome(); setTyping(false); };

    const onInput = (e: Event) => {
      const t = e.target as HTMLElement | null;
      const ed = t?.closest?.('.text-block-editable') as HTMLElement | null;
      if (!ed) return;

      setTyping(true);
      if (prefsRef.current.chromeFade) document.body.classList.add('flow-typing');
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(goIdle, 1600);

      if (prefsRef.current.momentum) stats.momentum = Math.min(1, stats.momentum + 0.16);

      const text = ed.textContent || '';
      const w = countWords(text);
      const c = text.length;
      const prev = stats.baselines.get(ed);
      if (prev) {
        const dw = Math.max(0, w - prev.w);
        if (dw > 0) { stats.words += dw; const now = performance.now(); for (let i = 0; i < dw; i++) stats.wordTimes.push(now); }
      }
      stats.baselines.set(ed, { w, c });

      if (prefsRef.current.semanticWeather) {
        window.clearTimeout(moodTimer);
        moodTimer = window.setTimeout(() => setMood(analyzeMood(ed.textContent || '')), 650);
      }
    };

    const onPointerMove = () => showChrome();
    document.addEventListener('input', onInput, true);
    document.addEventListener('pointermove', onPointerMove, true);

    /* ---- spotlight target from caret / active block ---- */
    const computeTarget = () => {
      const ae = document.activeElement as HTMLElement | null;
      const ed = (ae?.classList.contains('text-block-editable') ? ae : ae?.closest?.('.text-block-editable')) as HTMLElement | null;
      if (!ed) { tgt.a = 0; return; }
      const block = ed.getBoundingClientRect();
      if (block.width < 2 || block.height < 2) { tgt.a = 0; return; }

      let cy = block.top + Math.min(block.height, 60) / 2;
      try {
        const sel = window.getSelection();
        if (sel && sel.rangeCount) {
          const rects = sel.getRangeAt(0).getClientRects();
          const r = rects.length ? rects[rects.length - 1] : sel.getRangeAt(0).getBoundingClientRect();
          if (r && r.height > 0) cy = r.top + r.height / 2;
        }
      } catch { /* selection unavailable — fall back to block center */ }

      tgt.x = block.left + block.width / 2;
      tgt.y = cy;
      tgt.s = Math.max(0.8, Math.min(2.6, (block.width / 2) / 150));
      tgt.a = 1;
    };

    /* ---- render loop ---- */
    let raf = 0;
    const tick = () => {
      computeTarget();
      cur.x += (tgt.x - cur.x) * 0.16;
      cur.y += (tgt.y - cur.y) * 0.16;
      cur.s += (tgt.s - cur.s) * 0.14;
      cur.a += (tgt.a - cur.a) * 0.12;

      const spot = spotRef.current;
      if (spot) {
        const on = prefsRef.current.spotlight ? 1 : 0;
        spot.style.transform = `translate3d(${cur.x - 1500}px, ${cur.y - 1500}px, 0) scale(${cur.s})`;
        spot.style.opacity = String(cur.a * intensityRef.current * on);
      }
      const edge = edgeRef.current;
      // A gentle cinematic frame when idle, deepening as you actually write.
      if (edge) edge.style.opacity = String((prefsRef.current.spotlight ? 1 : 0) * (0.3 + intensityRef.current * 0.4) * (0.5 + cur.a * 0.5));

      // momentum decay + ember
      stats.momentum *= 0.955;
      const ember = emberRef.current;
      if (ember) {
        if (prefsRef.current.momentum) {
          ember.style.transform = `scale(${0.7 + stats.momentum * 1.0})`;
          ember.style.opacity = String(0.35 + stats.momentum * 0.6);
        } else {
          ember.style.transform = 'scale(1)';
          ember.style.opacity = '0.4';
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    /* ---- word tally / wpm flush ---- */
    const flush = window.setInterval(() => {
      const now = performance.now();
      while (stats.wordTimes.length && now - stats.wordTimes[0] > 15000) stats.wordTimes.shift();
      const wpm = Math.round(stats.wordTimes.length * (60 / 15));
      setDisp({ words: stats.words, wpm });
      setSession({ words: stats.words, wpm });
    }, 260);

    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(flush);
      window.clearTimeout(idleTimer);
      window.clearTimeout(moodTimer);
      document.removeEventListener('input', onInput, true);
      document.removeEventListener('pointermove', onPointerMove, true);
      document.body.classList.remove('flow-on', 'flow-typing');
    };
  }, [enabled, setMood, setTyping, setSession]);

  if (!enabled) return null;

  const shownMood: FlowMood = prefs.semanticWeather ? mood : 'calm';
  const page = Math.max(1, Math.ceil(disp.words / WORDS_PER_PAGE));
  const inPage = disp.words - (page - 1) * WORDS_PER_PAGE;
  const progress = Math.min(1, inPage / WORDS_PER_PAGE);

  return (
    <div className="flow-root" data-mood={shownMood} aria-hidden>
      <div className="flow-edge" ref={edgeRef} />
      <div className="flow-spotlight" ref={spotRef} />
      {prefs.semanticWeather && <FlowAmbient mood={mood} />}
      {prefs.livingProgress && (
        <ProgressWidget words={disp.words} wpm={disp.wpm} page={page} progress={progress} emberRef={emberRef} />
      )}
    </div>
  );
}
