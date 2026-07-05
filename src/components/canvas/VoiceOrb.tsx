'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { v4 as uuidv4 } from 'uuid';
import { useVoiceStore } from '@/store/voiceStore';
import { useCanvasStore } from '@/store/canvasStore';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';

export default function VoiceOrb() {
  const { isListening, transcript, interimTranscript, setIsListening } = useVoiceStore();
  const { startRecognition, stopRecognition } = useSpeechRecognition();
  const addObject = useCanvasStore((s) => s.addObject);
  const updateObject = useCanvasStore((s) => s.updateObject);
  const selectedId = useCanvasStore((s) => s.selectedId);

  const [waveformData, setWaveformData] = useState<number[]>(new Array(10).fill(2));
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationRef = useRef<number | null>(null);

  // Audio analysis for waveform
  useEffect(() => {
    if (isListening) {
      const initAudio = async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
          const analyser = audioContext.createAnalyser();
          const source = audioContext.createMediaStreamSource(stream);
          source.connect(analyser);
          analyser.fftSize = 32;
          
          audioContextRef.current = audioContext;
          analyserRef.current = analyser;

          const bufferLength = analyser.frequencyBinCount;
          const dataArray = new Uint8Array(bufferLength);

          const updateWaveform = () => {
            if (!analyserRef.current) return;
            analyserRef.current.getByteFrequencyData(dataArray);
            
            // Map data to 10 bars
            const newWaveform = Array.from(dataArray.slice(0, 10)).map(v => Math.max(2, v / 15));
            setWaveformData(newWaveform);
            animationRef.current = requestAnimationFrame(updateWaveform);
          };
          updateWaveform();
        } catch (e) {
          console.error('Audio capture failed', e);
        }
      };
      initAudio();
    } else {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (audioContextRef.current) audioContextRef.current.close();
      setWaveformData(new Array(10).fill(2));
    }
  }, [isListening]);

  // Handle transcription updates in real-time
  const baseContentRef = useRef('');
  const currentObjectIdRef = useRef<string | null>(null);
  const sessionActiveRef = useRef(false);

  // When listening starts, identify target or create new card
  useEffect(() => {
    if (isListening) {
      if (!sessionActiveRef.current) {
        sessionActiveRef.current = true;
        const currentObjects = useCanvasStore.getState().objects;
        if (selectedId) {
          currentObjectIdRef.current = selectedId;
          const obj = currentObjects.find(o => o.id === selectedId);
          baseContentRef.current = obj?.content || '';
        } else {
          // Create a new card immediately for this session
          const newId = uuidv4();
          const currentCamera = useCanvasStore.getState().camera;
          const x = (-currentCamera.x + window.innerWidth / 2) / currentCamera.zoom - 150;
          const y = (-currentCamera.y + window.innerHeight / 2) / currentCamera.zoom - 50;
          
          addObject({
            id: newId,
            type: 'text',
            x, y,
            width: 900,
            height: 100,
            content: '', 
          });
          currentObjectIdRef.current = newId;
          baseContentRef.current = '';
        }
      }
    } else {
      // Finalize session
      sessionActiveRef.current = false;
      currentObjectIdRef.current = null;
      baseContentRef.current = '';
    }
  }, [isListening, selectedId, addObject]);

  // Sync base content only if we are in a session and selectedId changes
  useEffect(() => {
    if (isListening && selectedId && selectedId !== currentObjectIdRef.current) {
      currentObjectIdRef.current = selectedId;
      const currentObjects = useCanvasStore.getState().objects;
      const obj = currentObjects.find(o => o.id === selectedId);
      baseContentRef.current = obj?.content || '';
    }
  }, [selectedId, isListening]);

  // Update object content as we speak
  useEffect(() => {
    if (!isListening || !currentObjectIdRef.current) return;

    const fullTranscript = (transcript + ' ' + interimTranscript).trim();
    if (!fullTranscript) return;

    const newContent = baseContentRef.current 
      ? baseContentRef.current + ' ' + fullTranscript 
      : fullTranscript;
      
    // Immediate store update
    updateObject(currentObjectIdRef.current, { content: newContent });
  }, [transcript, interimTranscript]);

  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[200] pointer-events-none">
      <div className="relative flex flex-col items-center">
        
        {/* Captions Overlay - Glassmorphic */}
        <AnimatePresence>
          {isListening && interimTranscript && (
            <motion.div
              initial={{ opacity: 0, y: -20, scale: 0.9 }}
              animate={{ opacity: 1, y: -40, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.9 }}
              className="absolute whitespace-nowrap bg-white/10 backdrop-blur-3xl text-[var(--text-primary)] px-6 py-3 rounded-2xl text-sm font-medium tracking-wide shadow-[0_8px_32px_rgba(0,0,0,0.1)] border border-white/20"
            >
              <span className="opacity-40">Listening...</span>
              <span className="ml-2">{interimTranscript}</span>
              <motion.span
                animate={{ opacity: [0, 1, 0] }}
                transition={{ duration: 1.5, repeat: Infinity }}
                className="ml-2 inline-block w-2 h-2 rounded-full bg-[var(--accent)]"
              />
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
                transition={{ duration: 3, repeat: Infinity, ease: "easeOut" }}
                className="absolute inset-0 rounded-full border border-[var(--accent)] opacity-20"
              />
              <motion.div
                initial={{ scale: 1, opacity: 0.2 }}
                animate={{ scale: 1.8, opacity: 0 }}
                transition={{ duration: 3, delay: 1, repeat: Infinity, ease: "easeOut" }}
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

        {/* Status Label - Removed as requested */}
      </div>
    </div>
  );
}
