'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useVoiceStore } from '@/store/voiceStore';
import { getInputLevel } from '@/lib/voice/localSpeech';

/**
 * The dictation HUD: the orb, the caption, and nothing else.
 *
 * This component used to be where dictation was actually WRITTEN — it held a
 * snapshot of the target block and rewrote it from the transcript on every
 * change, which is how half-heard guesses, sound-effect captions and duplicated
 * sentences ended up on the canvas. Writing now happens in lib/voice/dictation,
 * at the caret, one finished phrase at a time. The orb only reports.
 *
 * It also doesn't open a microphone. It used to — getUserMedia({ audio: true })
 * purely to drive the waveform — and a second capture of the same device
 * routinely loses the race on Windows, which is very likely why voice typing
 * never worked at all. The engine already has the mic open and hands out its
 * level; the bars read that.
 */

const BARS = 10;
/** The caption is a status line, not a document. */
const CAPTION_CHARS = 90;

function tail(text: string): string {
  const t = text.trim();
  return t.length > CAPTION_CHARS ? `…${t.slice(-CAPTION_CHARS)}` : t;
}

export default function VoiceOrb() {
  const isListening = useVoiceStore((s) => s.isListening);
  const transcript = useVoiceStore((s) => s.transcript);
  const interimTranscript = useVoiceStore((s) => s.interimTranscript);
  const error = useVoiceStore((s) => s.error);
  const notice = useVoiceStore((s) => s.notice);
  const live = useVoiceStore((s) => s.live);
  /* Chrome hangs its own recogniser up every minute and we restart it. That
     plumbing was flipping the caption back to "Starting the microphone…"
     mid-sentence, so a healthy session read as one that kept falling over. */
  const everLive = useVoiceStore((s) => s.everLive);
  const hearing = useVoiceStore((s) => s.hearing);
  const pending = useVoiceStore((s) => s.pending);
  const engine = useVoiceStore((s) => s.engine);

  const [wave, setWave] = useState<number[]>(() => new Array(BARS).fill(3));

  /* The bars follow the actual microphone when the on-device engine is running
     — it measures the room anyway to decide where sentences begin and end, so
     the level is free and honest. Google's engine gives us no signal at all, so
     there the bars breathe while the mic is open and leap when words arrive. */
  const speechAt = useRef(0);
  useEffect(() => {
    speechAt.current = performance.now();
  }, [interimTranscript, transcript]);

  useEffect(() => {
    // Nothing to reset when it stops: the orb unmounts with the session, and the
    // first frame of the next one overwrites every bar before it's on screen.
    if (!isListening) return;
    let raf = 0;
    const tick = () => {
      const now = performance.now();
      const excited = now - speechAt.current < 700 ? 1 : 0.18;
      const amp =
        engine === 'local'
          ? 0.12 + getInputLevel() * 1.6
          : (hearing ? 1 : 0.35) * excited;
      setWave(
        Array.from({ length: BARS }, (_, i) => {
          const phase = now / 190 + i * 0.7;
          const envelope = 0.55 + 0.45 * Math.sin((i / (BARS - 1)) * Math.PI); // taller in the middle
          return 3 + Math.abs(Math.sin(phase)) * 22 * Math.min(1.4, amp) * envelope;
        })
      );
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isListening, hearing, engine]);

  // An error is worth reading, not worth living with.
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => useVoiceStore.getState().setError(null), 7000);
    return () => clearTimeout(t);
  }, [error]);

  /* What the pill says, in order of what the user needs to know. A notice
     outranks the caption but is not an error: "switching to on-device voice
     typing", "setting up — 40%". The old code only had red text to say anything
     with, which is how a routine engine switch looked like a broken connection. */
  const status = error
    ? error
    : !live && !everLive
      ? notice || 'Starting the microphone…'
      : notice
        ? notice
        : interimTranscript
          ? tail(interimTranscript)
          : pending > 0
            ? 'Writing that down…'
            : transcript
              ? tail(transcript)
              : hearing
                ? 'Listening…'
                : 'Listening — start speaking';

  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[200] pointer-events-none">
      <div className="relative flex flex-col items-center">
        {/* Caption: what it heard, what it's doing, or what actually went wrong */}
        <AnimatePresence>
          {(isListening || error || notice) && (
            <motion.div
              initial={{ opacity: 0, y: -20, scale: 0.9 }}
              animate={{ opacity: 1, y: -40, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.9 }}
              className={`absolute w-max max-w-[70vw] text-center bg-[var(--bg-card)] backdrop-blur-3xl px-6 py-3 rounded-2xl text-sm font-medium tracking-wide shadow-[var(--shadow-lg)] border ${
                error
                  ? 'text-red-500 border-red-400/40'
                  : 'text-[var(--text-primary)] border-[var(--border-strong)]'
              }`}
            >
              {status}
              {!error && (
                <motion.span
                  animate={{ opacity: [0, 1, 0] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                  className="ml-2 inline-block w-2 h-2 rounded-full bg-[var(--accent)] align-middle"
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Cinematic Orb (Glassmorphic + Soft Glow) */}
        <AnimatePresence>
          {isListening && (
            <motion.div
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              className="relative w-20 h-20 rounded-full bg-white/5 backdrop-blur-2xl shadow-[0_8px_32px_rgba(var(--accent-rgb),0.15)] border border-white/20 flex items-center justify-center overflow-hidden"
            >
              <div className="absolute inset-0 bg-[var(--accent)] opacity-[0.05]" />

              <motion.div
                initial={{ scale: 1, opacity: 0.3 }}
                animate={{ scale: 2.2, opacity: 0 }}
                transition={{ duration: 3, repeat: Infinity, ease: 'easeOut' }}
                className="absolute inset-0 rounded-full border border-[var(--accent)] opacity-20"
              />
              <motion.div
                initial={{ scale: 1, opacity: 0.2 }}
                animate={{ scale: 1.8, opacity: 0 }}
                transition={{ duration: 3, delay: 1, repeat: Infinity, ease: 'easeOut' }}
                className="absolute inset-0 rounded-full border border-[var(--accent)] opacity-10"
              />

              <div className="flex items-end justify-center gap-[3px] z-10 h-8">
                {wave.map((h, i) => (
                  <div
                    key={i}
                    className="w-[3px] bg-[var(--accent)] rounded-full opacity-80"
                    style={{ height: h }}
                  />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
