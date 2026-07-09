'use client';

import React, { useRef, useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCanvasStore } from '@/store/canvasStore';

/**
 * Talk to your canvas. A one-shot voice command: tap the mic, say what you want
 * ("add a countdown to my exam and three study stickies"), and it fires the
 * canvas agent with your spoken prompt. Separate from voice-typing — this speaks
 * straight to the AI.
 */
export default function VoiceCommand() {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [supported, setSupported] = useState(true);
  const recRef = useRef<any>(null);
  const finalRef = useRef('');
  const wantRef = useRef(false);       // does the user still want to be listening?
  const restartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) setSupported(false);
    return () => {
      wantRef.current = false;
      if (restartTimer.current) clearTimeout(restartTimer.current);
      try { recRef.current?.stop(); } catch {}
    };
  }, []);

  const dispatchAgent = useCallback((text: string) => {
    const t = text.trim();
    if (!t) return;
    const { camera } = useCanvasStore.getState();
    const x = (-camera.x + window.innerWidth / 2) / camera.zoom;
    const y = (-camera.y + window.innerHeight / 2) / camera.zoom;
    window.dispatchEvent(new CustomEvent('run-agent', { detail: { prompt: t, x, y } }));
  }, []);

  const start = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    // Reuse one recognizer instance; (re)configure it each time.
    let rec = recRef.current;
    if (!rec) {
      rec = new SR();
      recRef.current = rec;
      rec.continuous = true;      // KEEP listening — don't die after one phrase
      rec.interimResults = true;
      rec.lang = 'en-US';
      rec.onresult = (e: any) => {
        let interimStr = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const chunk = e.results[i][0].transcript;
          if (e.results[i].isFinal) finalRef.current += chunk + ' ';
          else interimStr += chunk;
        }
        setInterim((finalRef.current + interimStr).trim());
      };
      rec.onerror = (e: any) => {
        if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed' || e?.error === 'audio-capture') {
          wantRef.current = false;
          setListening(false);
          setInterim('');
        }
      };
      rec.onend = () => {
        // Chrome auto-stops on a pause / ~60s. Restart if the user hasn't tapped stop.
        if (wantRef.current) {
          restartTimer.current = setTimeout(() => {
            if (wantRef.current) { try { rec.start(); } catch {} }
          }, 250);
        } else {
          setListening(false);
          const said = finalRef.current.trim();
          setInterim('');
          if (said) dispatchAgent(said);
        }
      };
    }
    finalRef.current = '';
    wantRef.current = true;
    try {
      rec.start();
      setListening(true);
      setInterim('');
    } catch { /* already running */ }
  }, [dispatchAgent]);

  const stop = useCallback(() => {
    wantRef.current = false;
    if (restartTimer.current) clearTimeout(restartTimer.current);
    try { recRef.current?.stop(); } catch {}
  }, []);

  if (!supported) return null;

  return (
    <div className="fixed z-[140] flex items-center gap-2" style={{ right: 60, bottom: 156 }}>
      <AnimatePresence>
        {listening && (
          <motion.div
            initial={{ opacity: 0, x: 12, scale: 0.9 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 12, scale: 0.9 }}
            className="glass-panel max-w-[280px] px-3.5 py-2 rounded-2xl text-xs text-[var(--text-primary)] shadow-lg order-first"
          >
            <span className="text-[9px] uppercase tracking-wider font-bold text-[var(--accent)] block mb-0.5">Listening…</span>
            <span className="text-[var(--text-secondary)] line-clamp-2">{interim || 'Say what you want on the canvas'}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.94 }}
        onClick={() => (listening ? stop() : start())}
        title={listening ? 'Stop & send to AI' : 'Ask the AI by voice'}
        className={`relative w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-colors cursor-pointer ${
          listening ? 'bg-red-500 text-white' : 'bg-[var(--accent)] text-white hover:brightness-105'
        }`}
      >
        {listening && (
          <span className="absolute inset-0 rounded-full bg-red-400 opacity-60 animate-ping" />
        )}
        <svg className="relative" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="22" />
        </svg>
        {/* sparkle mark = "AI" */}
        <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-white text-[var(--accent)] flex items-center justify-center shadow" style={{ fontSize: 9 }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 3 1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3Z" /></svg>
        </span>
      </motion.button>
    </div>
  );
}
