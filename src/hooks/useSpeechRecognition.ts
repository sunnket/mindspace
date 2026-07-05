'use client';

import { useEffect, useCallback, useRef } from 'react';
import { useVoiceStore } from '@/store/voiceStore';
import { useCanvasStore } from '@/store/canvasStore';

export const useSpeechRecognition = () => {
  const { isListening, setIsListening, setTranscript, setInterimTranscript, setIsPaused } = useVoiceStore();
  const recognitionRef = useRef<any>(null);
  const restartTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const startRecognition = useCallback(() => {
    if (typeof window !== 'undefined') {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognition) {
        console.warn('Speech Recognition not supported in this browser.');
        return;
      }

      setIsListening(true);
      setIsPaused(false);

      if (!recognitionRef.current) {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onstart = () => {
          console.log('Speech recognition started');
        };

        recognition.onresult = (event: any) => {
          let interim = '';
          let final = '';

          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              final += event.results[i][0].transcript;
            } else {
              interim += event.results[i][0].transcript;
            }
          }

          if (final) {
            setTranscript(final);
          }
          setInterimTranscript(interim);
        };

        recognition.onerror = (event: any) => {
          console.error('Speech recognition error', event.error);
          if (event.error === 'no-speech') {
            setIsPaused(true);
          }
          if (event.error === 'not-allowed') {
            setIsListening(false);
          }
        };

        recognition.onend = () => {
          console.log('Speech recognition ended');
          // Restart if we are still supposed to be listening (Chrome timeout fix)
          if (useVoiceStore.getState().isListening) {
            restartTimeoutRef.current = setTimeout(() => {
              if (useVoiceStore.getState().isListening) {
                try {
                  recognition.start();
                } catch (e) {}
              }
            }, 300);
          }
        };

        recognitionRef.current = recognition;
      }

      try {
        recognitionRef.current.start();
      } catch (e) {
        console.warn('Recognition already started');
      }
    }
  }, [setIsListening, setIsPaused, setTranscript, setInterimTranscript]);

  const stopRecognition = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
      if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);
    }
  }, [setIsListening]);

  useEffect(() => {
    return () => {
      if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);
      if (recognitionRef.current) recognitionRef.current.stop();
    };
  }, []);

  return { startRecognition, stopRecognition };
};
