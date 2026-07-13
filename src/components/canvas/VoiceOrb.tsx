'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useVoiceStore } from '@/store/voiceStore';
import { useCanvasStore } from '@/store/canvasStore';

export default function VoiceOrb() {
  const isListening = useVoiceStore((s) => s.isListening);
  const transcript = useVoiceStore((s) => s.transcript);
  const interimTranscript = useVoiceStore((s) => s.interimTranscript);
  const targetId = useVoiceStore((s) => s.targetId);
  const error = useVoiceStore((s) => s.error);
  const updateObject = useCanvasStore((s) => s.updateObject);

  const [waveformData, setWaveformData] = useState<number[]>(new Array(10).fill(2));
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationRef = useRef<number | null>(null);

  // Audio analysis for the waveform
  useEffect(() => {
    if (!isListening) {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      analyserRef.current = null;
      // Release the mic and the audio graph — a leaked AudioContext keeps the
      // browser's recording indicator lit long after you've stopped.
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      audioContextRef.current?.close().catch(() => {});
      audioContextRef.current = null;
      setWaveformData(new Array(10).fill(2));
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        const analyser = audioContext.createAnalyser();
        audioContext.createMediaStreamSource(stream).connect(analyser);
        analyser.fftSize = 32;

        streamRef.current = stream;
        audioContextRef.current = audioContext;
        analyserRef.current = analyser;

        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          if (!analyserRef.current) return;
          analyserRef.current.getByteFrequencyData(data);
          setWaveformData(Array.from(data.slice(0, 10)).map((v) => Math.max(2, v / 15)));
          animationRef.current = requestAnimationFrame(tick);
        };
        tick();
      } catch (e) {
        console.error('Audio capture failed', e);
      }
    })();

    return () => { cancelled = true; };
  }, [isListening]);

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
    const t = setTimeout(() => useVoiceStore.getState().setError(null), 6000);
    return () => clearTimeout(t);
  }, [error]);

  const caption = error || interimTranscript;

  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[200] pointer-events-none">
      <div className="relative flex flex-col items-center">
        {/* Captions / errors */}
        <AnimatePresence>
          {(isListening || error) && caption && (
            <motion.div
              initial={{ opacity: 0, y: -20, scale: 0.9 }}
              animate={{ opacity: 1, y: -40, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.9 }}
              className={`absolute max-w-[70vw] text-center bg-white/10 backdrop-blur-3xl px-6 py-3 rounded-2xl text-sm font-medium tracking-wide shadow-[0_8px_32px_rgba(0,0,0,0.1)] border ${
                error
                  ? 'text-red-500 border-red-400/30'
                  : 'text-[var(--text-primary)] border-white/20 whitespace-nowrap'
              }`}
            >
              {error ? (
                error
              ) : (
                <>
                  <span className="opacity-40">Listening…</span>
                  <span className="ml-2">{interimTranscript}</span>
                  <motion.span
                    animate={{ opacity: [0, 1, 0] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                    className="ml-2 inline-block w-2 h-2 rounded-full bg-[var(--accent)]"
                  />
                </>
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
              className="relative w-20 h-20 rounded-full bg-white/5 backdrop-blur-2xl shadow-[0_8px_32px_rgba(201,123,75,0.15)] border border-white/20 flex items-center justify-center overflow-hidden"
            >
              {/* Inner Soft Glow */}
              <div className="absolute inset-0 bg-[var(--accent)] opacity-[0.05]" />

              {/* Pulse Rings - Soft & Cinematic */}
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

              {/* Waveform Bars */}
              <div className="flex items-center justify-center gap-[3px] z-10">
                {waveformData.map((h, i) => (
                  <motion.div
                    key={i}
                    animate={{ height: h * 2.5 }}
                    className="w-[3px] bg-[var(--accent)] rounded-full opacity-80"
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
