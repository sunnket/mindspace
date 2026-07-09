'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useCanvasStore } from '@/store/canvasStore';
import { CanvasObjectData } from '@/lib/db';
import { motion, AnimatePresence } from 'framer-motion';

const SparkleIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
  </svg>
);

// The directive the AI runs on a braindump transcript — turn loose speech into
// a laid-out board (checklists, cards, stickies, frames, connectors).
const BRAINDUMP_DIRECTIVE =
  'This is a spoken braindump transcript. Turn it into a beautifully structured board: pull out action items into a checklist, capture key ideas as cards or sticky notes, group related things inside a titled frame, and connect what relates. Keep my words and meaning — organize, do not invent. Lay everything out cleanly with generous spacing.';

// Is browser speech-to-text available? (Chrome/Edge yes; Firefox/some others no.)
const sttSupported = (): boolean =>
  typeof window !== 'undefined' &&
  !!((window as unknown as Record<string, unknown>).SpeechRecognition ||
     (window as unknown as Record<string, unknown>).webkitSpeechRecognition);

export default function VoiceNoteBlock({ obj }: { obj: CanvasObjectData }) {
  const updateObject = useCanvasStore((s) => s.updateObject);
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [recordingTime, setRecordingTime] = useState(0);
  const [waveform, setWaveform] = useState<number[]>([]);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [showTranscript, setShowTranscript] = useState(false);
  const [sttNote, setSttNote] = useState('');
  const [editingTranscript, setEditingTranscript] = useState(false);

  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<BlobPart[]>([]);
  const timer = useRef<NodeJS.Timeout | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const waveformRef = useRef<HTMLDivElement>(null);
  // Local speech recognition (kept separate from global voice-typing) so the
  // braindump captures a transcript alongside the recorded audio.
  const recognitionRef = useRef<any>(null);
  const transcriptRef = useRef('');
  const autoStarted = useRef(false);

  const transcript = (obj.style?.transcript as string) || '';
  const isBraindump = Boolean(obj.style?.braindump);
  const isRecorded = obj.content && obj.content.startsWith('data:audio');

  // Persist the transcript into the object so it survives remounts (viewport
  // culling) and immediately enables the AI sparkle — even mid-recording.
  const saveTranscript = useCallback((text: string) => {
    const cur = useCanvasStore.getState().objects.find((o) => o.id === obj.id);
    if (!cur) return;
    if ((cur.style?.transcript as string) === text) return;
    updateObject(obj.id, { style: { ...cur.style, transcript: text } });
  }, [obj.id, updateObject]);

  // Generate waveform from audio data
  const generateWaveform = async (dataUrl: string) => {
    try {
      const response = await fetch(dataUrl);
      const arrayBuffer = await response.arrayBuffer();
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      const rawData = audioBuffer.getChannelData(0);
      const samples = 56;
      const blockSize = Math.floor(rawData.length / samples);
      const filteredData = [];
      for (let i = 0; i < samples; i++) {
        const blockStart = blockSize * i;
        let sum = 0;
        for (let j = 0; j < blockSize; j++) {
          sum = sum + Math.abs(rawData[blockStart + j]);
        }
        filteredData.push(sum / blockSize);
      }

      const multiplier = Math.pow(Math.max(...filteredData), -1);
      setWaveform(filteredData.map((n) => n * multiplier));
      setDuration(audioBuffer.duration);
    } catch (e) {
      console.error('Waveform generation failed:', e);
      setWaveform(Array.from({ length: 56 }, () => Math.random() * 0.5 + 0.1));
    }
  };

  useEffect(() => {
    if (obj.content && obj.content.startsWith('data:audio')) {
      generateWaveform(obj.content);
    }
  }, [obj.content]);

  // Kick a braindump straight into the AI: structure the transcript onto the canvas.
  const runSparkle = useCallback(() => {
    const text = ((useCanvasStore.getState().objects.find((o) => o.id === obj.id)?.style?.transcript as string) || '').trim();
    if (!text) return;
    window.dispatchEvent(
      new CustomEvent('run-agent', {
        detail: {
          prompt: BRAINDUMP_DIRECTIVE,
          apiKeyIndex: 0,
          x: obj.x + obj.width + 90,
          y: obj.y,
          context: text,
        },
      })
    );
  }, [obj.id, obj.x, obj.y, obj.width]);

  const startRecognition = () => {
    if (typeof window === 'undefined') return;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      // Audio still records; we just can't auto-transcribe here.
      setSttNote("Live transcription isn't supported in this browser — use Chrome, or type the transcript below after recording.");
      return;
    }
    try {
      const recognition = new SR();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      recognition.onresult = (event: any) => {
        let interim = '';
        let gotFinal = false;
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const r = event.results[i];
          if (r.isFinal) { transcriptRef.current += r[0].transcript + ' '; gotFinal = true; }
          else interim += r[0].transcript;
        }
        setLiveTranscript((transcriptRef.current + interim).trim());
        // Persist finals as they land so the transcript is never lost and the
        // sparkle lights up in real time.
        if (gotFinal) saveTranscript(transcriptRef.current.trim());
      };
      recognition.onerror = (event: any) => {
        if (event?.error === 'not-allowed' || event?.error === 'service-not-allowed') {
          setSttNote('Microphone access was blocked — allow it to capture a transcript.');
        } else if (event?.error === 'audio-capture') {
          setSttNote('No microphone was found for transcription.');
        }
      };
      recognition.onend = () => {
        // Chrome auto-stops; restart while we're still recording.
        if (mediaRecorder.current && mediaRecorder.current.state === 'recording') {
          try { recognition.start(); } catch { /* already started */ }
        }
      };
      recognitionRef.current = recognition;
      recognition.start();
    } catch {
      /* transcript optional */
    }
  };

  const stopRecognition = () => {
    const r = recognitionRef.current;
    recognitionRef.current = null;
    if (r) {
      try { r.onend = null; r.stop(); } catch { /* ignore */ }
    }
  };

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder.current = new MediaRecorder(stream);
      chunks.current = [];
      transcriptRef.current = '';
      setLiveTranscript('');
      setSttNote('');

      mediaRecorder.current.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };

      mediaRecorder.current.onstop = async () => {
        const blob = new Blob(chunks.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64data = reader.result as string;
          const capturedTranscript = transcriptRef.current.trim();
          const cur = useCanvasStore.getState().objects.find((o) => o.id === obj.id);
          updateObject(obj.id, {
            content: base64data,
            style: { ...cur?.style, transcript: capturedTranscript || (cur?.style?.transcript as string) || '', autoRecord: false },
          });
          // Always reveal the transcript panel afterwards so the user can read,
          // fix, or type it (and then use the sparkle) — even if STT captured nothing.
          setShowTranscript(true);
          // Braindump auto-structures the moment recording ends (if we have text).
          if (isBraindump && capturedTranscript) {
            setTimeout(() => runSparkle(), 300);
          }
        };
        reader.readAsDataURL(blob);
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.current.start();
      startRecognition();
      setIsRecording(true);
      setRecordingTime(0);
      timer.current = setInterval(() => setRecordingTime((p) => p + 1), 1000);
    } catch (err) {
      console.error('Mic access error:', err);
      setSttNote('Could not access the microphone. Check your browser permissions and try again.');
    }
  }, [obj.id, updateObject, isBraindump, runSparkle]);

  const stopRecording = () => {
    if (mediaRecorder.current && isRecording) {
      mediaRecorder.current.stop();
      stopRecognition();
      setIsRecording(false);
      if (timer.current) clearInterval(timer.current);
    }
  };

  // Braindump auto-starts recording the moment it's dropped on the canvas.
  useEffect(() => {
    if (obj.style?.autoRecord && !isRecorded && !isRecording && !autoStarted.current) {
      autoStarted.current = true;
      // Clear the flag up front so a viewport-culling remount can't start a
      // second recording; it's re-saved (false) when recording finishes too.
      const cur = useCanvasStore.getState().objects.find((o) => o.id === obj.id);
      updateObject(obj.id, { style: { ...cur?.style, autoRecord: false } });
      startRecording();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obj.style?.autoRecord, isRecorded]);

  useEffect(() => {
    return () => {
      stopRecognition();
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  const togglePlay = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!audioRef.current) return;
    if (isPlaying) audioRef.current.pause();
    else audioRef.current.play().catch((err) => console.error('Playback failed:', err));
  }, [isPlaying]);

  const handleWaveformClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!waveformRef.current || !audioRef.current || duration === 0) return;
    const rect = waveformRef.current.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    audioRef.current.currentTime = percent * duration;
    setCurrentTime(percent * duration);
    if (!isPlaying) togglePlay();
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => { setIsPlaying(false); setCurrentTime(0); };
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

  const hasTranscript = transcript.trim().length > 0;

  return (
    <div className="w-full h-full glass-panel flex flex-col px-3.5 py-3 gap-2 overflow-hidden group border border-white/5 shadow-2xl bg-[var(--bg-card)]/80 backdrop-blur-xl rounded-2xl">
      {isRecorded && <audio ref={audioRef} src={obj.content} />}

      {isRecorded ? (
        <>
          <div className="flex items-center gap-3">
            <button
              onClick={togglePlay}
              onMouseDown={(e) => e.stopPropagation()}
              className="w-10 h-10 rounded-full bg-[var(--accent)] flex items-center justify-center text-white flex-shrink-0 hover:scale-105 transition-all shadow-lg"
            >
              {isPlaying ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" className="ml-0.5"><path d="M8 5v14l11-7z" /></svg>
              )}
            </button>

            <div
              ref={waveformRef}
              className="flex-1 h-9 flex items-center gap-[3px] cursor-pointer"
              onClick={handleWaveformClick}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {waveform.map((val, i) => {
                const isActive = i / waveform.length < currentTime / (duration || 1);
                return (
                  <div
                    key={i}
                    className="flex-1 rounded-full transition-all duration-300"
                    style={{
                      height: `${Math.max(15, val * 100)}%`,
                      backgroundColor: isActive ? 'var(--accent)' : 'var(--text-muted)',
                      opacity: isActive ? 1 : 0.25,
                    }}
                  />
                );
              })}
            </div>

            {/* AI Sparkle — structure this recording onto the canvas */}
            <button
              onClick={(e) => { e.stopPropagation(); runSparkle(); }}
              onMouseDown={(e) => e.stopPropagation()}
              disabled={!hasTranscript}
              title={hasTranscript ? 'Structure this into cards & checklists' : 'Add a transcript first (type it below)'}
              className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-all shadow-sm disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer text-white bg-gradient-to-br from-[var(--accent)] to-[var(--accent-light)] hover:scale-105 active:scale-95"
            >
              <SparkleIcon />
            </button>
          </div>

          <div className="flex justify-between items-center text-[9px] text-[var(--text-tertiary)] font-mono tracking-widest uppercase opacity-70">
            <span>{formatTime(currentTime)} / {formatTime(duration)}</span>
            <button
              onClick={(e) => { e.stopPropagation(); setShowTranscript((v) => !v); }}
              onMouseDown={(e) => e.stopPropagation()}
              className="hover:text-[var(--accent)] transition-colors cursor-pointer normal-case tracking-normal font-sans text-[10px]"
            >
              {showTranscript ? 'Hide transcript' : hasTranscript ? 'Show transcript' : 'Add transcript'}
            </button>
          </div>

          <AnimatePresence>
            {showTranscript && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="flex-1 min-h-0 flex flex-col"
                onMouseDown={(e) => e.stopPropagation()}
              >
                {editingTranscript || !hasTranscript ? (
                  <textarea
                    autoFocus={editingTranscript}
                    defaultValue={transcript}
                    onBlur={(e) => { saveTranscript(e.target.value.trim()); setEditingTranscript(false); }}
                    onMouseDown={(e) => e.stopPropagation()}
                    placeholder={sttNote || 'Type or paste the transcript here, then tap the sparkle to structure it…'}
                    className="flex-1 min-h-[54px] max-h-[160px] overflow-y-auto text-[11px] leading-relaxed text-[var(--text-secondary)] bg-black/5 dark:bg-white/5 rounded-lg px-2.5 py-2 select-text outline-none resize-none border border-transparent focus:border-[var(--accent-light)]"
                  />
                ) : (
                  <div
                    onClick={(e) => { e.stopPropagation(); setEditingTranscript(true); }}
                    className="flex-1 min-h-0 overflow-y-auto text-[11px] leading-relaxed text-[var(--text-secondary)] bg-black/5 dark:bg-white/5 rounded-lg px-2.5 py-2 select-text cursor-text"
                    title="Click to edit"
                  >
                    {transcript}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </>
      ) : isRecording ? (
        <div className="flex flex-col w-full h-full gap-2">
          <div className="flex items-center gap-3">
            <motion.div
              className="w-3 h-3 rounded-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)] shrink-0"
              animate={{ scale: [1, 1.3, 1], opacity: [1, 0.6, 1] }}
              transition={{ repeat: Infinity, duration: 0.8 }}
            />
            <div className="flex-1 text-sm font-semibold text-[var(--text-primary)] tracking-wide">
              {isBraindump ? 'BRAINDUMPING' : 'RECORDING'}… {formatTime(recordingTime)}
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); stopRecording(); }}
              onMouseDown={(e) => e.stopPropagation()}
              className="px-4 py-1.5 bg-red-500/20 text-red-500 rounded-full text-[10px] font-bold uppercase tracking-widest hover:bg-red-500/30 transition-colors shrink-0"
            >
              Finish
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto text-[12px] leading-relaxed text-[var(--text-secondary)] italic select-text">
            {liveTranscript || sttNote || (isBraindump ? 'Start talking — I\'ll turn it into a structured board.' : 'Listening…')}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center w-full h-full gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); startRecording(); }}
            onMouseDown={(e) => e.stopPropagation()}
            className="group relative px-7 py-3 bg-[var(--accent)] text-white rounded-2xl text-sm font-bold shadow-xl hover:shadow-[var(--accent-glow)] transition-all overflow-hidden flex items-center gap-2"
          >
            {isBraindump && <SparkleIcon size={15} />}
            <span className="relative z-10">{isBraindump ? 'Start Braindump' : 'Record Voice Note'}</span>
            <div className="absolute inset-0 bg-white/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
          </button>
          {!sttSupported() && (
            <span className="text-[9px] text-[var(--text-tertiary)] text-center px-2">
              Live transcription works best in Chrome. You can also type the transcript after recording.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
