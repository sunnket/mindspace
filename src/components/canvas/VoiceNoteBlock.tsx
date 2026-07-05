'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useCanvasStore } from '@/store/canvasStore';
import { CanvasObjectData } from '@/lib/db';
import { motion } from 'framer-motion';

export default function VoiceNoteBlock({ obj }: { obj: CanvasObjectData }) {
  const updateObject = useCanvasStore((s) => s.updateObject);
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [recordingTime, setRecordingTime] = useState(0);
  const [waveform, setWaveform] = useState<number[]>([]);
  
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<BlobPart[]>([]);
  const timer = useRef<NodeJS.Timeout | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const waveformRef = useRef<HTMLDivElement>(null);

  // Generate waveform from audio data
  const generateWaveform = async (dataUrl: string) => {
    try {
      const response = await fetch(dataUrl);
      const arrayBuffer = await response.arrayBuffer();
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      
      const rawData = audioBuffer.getChannelData(0); // Use first channel
      const samples = 60; // Number of bars
      const blockSize = Math.floor(rawData.length / samples);
      const filteredData = [];
      for (let i = 0; i < samples; i++) {
        let blockStart = blockSize * i;
        let sum = 0;
        for (let j = 0; j < blockSize; j++) {
          sum = sum + Math.abs(rawData[blockStart + j]);
        }
        filteredData.push(sum / blockSize);
      }
      
      const multiplier = Math.pow(Math.max(...filteredData), -1);
      const normalizedData = filteredData.map(n => n * multiplier);
      setWaveform(normalizedData);
      setDuration(audioBuffer.duration);
    } catch (e) {
      console.error("Waveform generation failed:", e);
      // Fallback
      setWaveform(Array.from({ length: 60 }, () => Math.random() * 0.5 + 0.1));
    }
  };

  useEffect(() => {
    if (obj.content && obj.content.startsWith('data:audio')) {
      generateWaveform(obj.content);
    }
  }, [obj.content]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder.current = new MediaRecorder(stream);
      chunks.current = [];

      mediaRecorder.current.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };

      mediaRecorder.current.onstop = async () => {
        const blob = new Blob(chunks.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64data = reader.result as string;
          updateObject(obj.id, { content: base64data });
        };
        reader.readAsDataURL(blob);
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.current.start();
      setIsRecording(true);
      setRecordingTime(0);
      timer.current = setInterval(() => setRecordingTime((p) => p + 1), 1000);
    } catch (err) {
      console.error('Mic access error:', err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorder.current && isRecording) {
      mediaRecorder.current.stop();
      setIsRecording(false);
      if (timer.current) clearInterval(timer.current);
    }
  };

  const togglePlay = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!audioRef.current) return;
    
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(err => console.error("Playback failed:", err));
    }
  }, [isPlaying]);

  const handleWaveformClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!waveformRef.current || !audioRef.current || duration === 0) return;
    
    const rect = waveformRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = x / rect.width;
    const newTime = percent * duration;
    
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
    if (!isPlaying) togglePlay();
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
    };
  }, [obj.content]);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const isRecorded = obj.content && obj.content.startsWith('data:audio');

  return (
    <div className="w-full h-full glass-panel flex items-center px-4 gap-4 overflow-hidden group border border-white/5 shadow-2xl bg-[var(--bg-card)]/80 backdrop-blur-xl rounded-2xl">
      {isRecorded && (
        <audio ref={audioRef} src={obj.content} />
      )}

      {isRecorded ? (
        <>
          <button
            onClick={togglePlay}
            onMouseDown={(e) => e.stopPropagation()}
            className="w-11 h-11 rounded-full bg-[var(--accent)] flex items-center justify-center text-white flex-shrink-0 hover:scale-105 transition-all shadow-[0_0_15px_rgba(var(--accent-rgb),0.3)]"
          >
            {isPlaying ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="ml-1">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          <div className="flex-1 flex flex-col gap-1.5 py-1">
            <div 
              ref={waveformRef}
              className="h-10 flex items-center gap-[3px] cursor-pointer"
              onClick={handleWaveformClick}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {waveform.map((val, i) => {
                const progress = currentTime / (duration || 1);
                const isActive = (i / waveform.length) < progress;
                return (
                  <div
                    key={i}
                    className="flex-1 rounded-full transition-all duration-300"
                    style={{
                      height: `${Math.max(15, val * 100)}%`,
                      backgroundColor: isActive ? 'var(--accent)' : 'var(--text-muted)',
                      opacity: isActive ? 1 : 0.25,
                      transform: isActive ? 'scaleY(1.1)' : 'scaleY(1)'
                    }}
                  />
                );
              })}
            </div>
            <div className="flex justify-between text-[9px] text-[var(--text-tertiary)] font-mono tracking-widest uppercase opacity-70">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>
        </>
      ) : isRecording ? (
        <div className="flex items-center w-full gap-4 px-2">
          <motion.div 
            className="w-3 h-3 rounded-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]"
            animate={{ scale: [1, 1.3, 1], opacity: [1, 0.6, 1] }}
            transition={{ repeat: Infinity, duration: 0.8 }}
          />
          <div className="flex-1 text-sm font-semibold text-[var(--text-primary)] tracking-wide">
            RECORDING... {formatTime(recordingTime)}
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); stopRecording(); }}
            onMouseDown={(e) => e.stopPropagation()}
            className="px-4 py-1.5 bg-red-500/20 text-red-500 rounded-full text-[10px] font-bold uppercase tracking-widest hover:bg-red-500/30 transition-colors"
          >
            Finish
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-center w-full">
          <button
            onClick={(e) => { e.stopPropagation(); startRecording(); }}
            onMouseDown={(e) => e.stopPropagation()}
            className="group relative px-8 py-3 bg-[var(--accent)] text-white rounded-2xl text-sm font-bold shadow-xl hover:shadow-[var(--accent-glow)] transition-all overflow-hidden"
          >
            <span className="relative z-10">Record Voice Note</span>
            <div className="absolute inset-0 bg-white/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
          </button>
        </div>
      )}
    </div>
  );
}
