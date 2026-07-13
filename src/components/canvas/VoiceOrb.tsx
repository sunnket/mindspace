'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useVoiceStore } from '@/store/voiceStore';
import { useCanvasStore } from '@/store/canvasStore';

/**
 * The dictation HUD: the orb, the live caption, and the code that types what you
 * say into the target block.
 *
 * This used to open its OWN microphone stream — getUserMedia({ audio: true }) —
 * purely to drive the waveform bars. That is almost certainly why voice typing
 * never worked: SpeechRecognition opens the microphone too, and on Windows a
 * second capture of the same device routinely loses the race. The symptom is
 * exactly what was reported — the orb appears, the bars sit flat at their idle
 * height (no audio is reaching the analyser at all), and the recogniser dies
 * with an error.
 *
 * So the orb no longer touches the microphone. It animates from the recogniser's
 * own signals — audiostart/audioend, and words arriving — which is the only
 * thing the levels were ever standing in for.
 */

const BARS = 10;

export default function VoiceOrb() {
  const isListening = useVoiceStore((s) => s.isListening);
  const transcript = useVoiceStore((s) => s.transcript);
  const interimTranscript = useVoiceStore((s) => s.interimTranscript);
  const targetId = useVoiceStore((s) => s.targetId);
  const error = useVoiceStore((s) => s.error);
  const live = useVoiceStore((s) => s.live);
  const hearing = useVoiceStore((s) => s.hearing);
  const updateObject = useCanvasStore((s) => s.updateObject);

  const [wave, setWave] = useState<number[]>(() => new Array(BARS).fill(3));

  /* The bars breathe while the mic is open and leap when words come in. It's an
     honest signal — it tracks the recogniser rather than the room — and it costs
     a requestAnimationFrame instead of a second microphone. */
  const speechAt = useRef(0);
  useEffect(() => {
    speechAt.current = performance.now();
  }, [interimTranscript, transcript]);

  useEffect(() => {
    if (!isListening) {
      setWave(new Array(BARS).fill(3));
      return;
    }
    let raf = 0;
    const tick = () => {
      const now = performance.now();
      const excited = now - speechAt.current < 700 ? 1 : 0.18;
      const amp = (hearing ? 1 : 0.35) * excited;
      setWave(
        Array.from({ length: BARS }, (_, i) => {
          const phase = now / 190 + i * 0.7;
          const envelope = 0.55 + 0.45 * Math.sin((i / (BARS - 1)) * Math.PI); // taller in the middle
          return 3 + Math.abs(Math.sin(phase)) * 22 * amp * envelope;
        })
      );
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isListening, hearing]);

  /* Type what's being said into the target block, live.
     The base content is captured ONCE, when the session's target is set — read
     on every keystroke instead, it would grow by its own output and the note
     would repeat itself forever. */
  const baseContent = useRef('');
  useEffect(() => {
    if (!targetId) {
      baseContent.current = '';
      return;
    }
    const obj = useCanvasStore.getState().objects.find((o) => o.id === targetId);
    baseContent.current = obj?.content || '';
  }, [targetId]);

  useEffect(() => {
    if (!isListening || !targetId) return;
    const spoken = [transcript, interimTranscript].filter((s) => s.trim()).join(' ').trim();
    if (!spoken) return;

    const base = baseContent.current.trim();
    updateObject(targetId, { content: base ? `${base} ${spoken}` : spoken });
  }, [transcript, interimTranscript, isListening, targetId, updateObject]);

  // An error is worth reading, not worth living with.
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => useVoiceStore.getState().setError(null), 7000);
    return () => clearTimeout(t);
  }, [error]);

  const heard = interimTranscript || transcript;
  const status = error
    ? error
    : !live
      ? 'Starting the microphone…'
      : heard || 'Listening — start speaking';

  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[200] pointer-events-none">
      <div className="relative flex flex-col items-center">
        {/* Caption: what it heard, what it's doing, or what actually went wrong */}
        <AnimatePresence>
          {(isListening || error) && (
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
