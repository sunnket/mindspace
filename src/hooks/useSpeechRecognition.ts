'use client';

import { useCallback, useEffect } from 'react';
import { useVoiceStore } from '@/store/voiceStore';
import { useCanvasStore } from '@/store/canvasStore';

/**
 * Dictation. Speak, and the words land in a block on the canvas.
 *
 * The recogniser is a MODULE-level singleton, not a ref inside the hook. It has
 * to be: this hook is mounted in two places at once (the toolbar button and the
 * orb), each of those used to build its own SpeechRecognition, and only the one
 * whose button you happened to press was ever started — while the other's
 * unmount cleanup could stop it. One recogniser, one session, shared state.
 *
 * The target block is chosen (or created) HERE, at the moment listening starts,
 * so there is exactly one owner of "where do the words go" and it exists before
 * the first result can possibly arrive.
 */

type Recognition = any;

let recognition: Recognition | null = null;
let restartTimer: ReturnType<typeof setTimeout> | null = null;
/** True between start() and an explicit stop — drives the auto-restart. */
let wantListening = false;
/** How many components currently hold this hook. The mic only closes when the
 *  LAST one goes away — the toolbar and the orb both mount it, and either one
 *  unmounting must not cut the other's session off. */
let mounted = 0;

function getRecognitionCtor(): any {
  if (typeof window === 'undefined') return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

export const useSpeechRecognition = () => {
  const isListening = useVoiceStore((s) => s.isListening);
  const unsupported = useVoiceStore((s) => s.unsupported);

  const stopRecognition = useCallback(() => {
    wantListening = false;
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
    try {
      recognition?.stop();
    } catch {
      /* already stopped */
    }

    const voice = useVoiceStore.getState();
    // Fold anything still in flight into the final text before we let go.
    if (voice.interimTranscript.trim()) {
      voice.appendTranscript(voice.interimTranscript);
      voice.setInterimTranscript('');
    }
    voice.setIsListening(false);
  }, []);

  const startRecognition = useCallback(() => {
    const Ctor = getRecognitionCtor();
    const voice = useVoiceStore.getState();

    if (!Ctor) {
      voice.setUnsupported(true);
      voice.setError('Voice typing needs Chrome or Edge — this browser has no speech recognition.');
      return;
    }
    voice.setUnsupported(false);

    /* Give the words somewhere to go BEFORE the mic opens. Dictate into the
       selected block if there's a sensible one; otherwise drop a fresh text box
       in the middle of the view — that's the "a text box just appears when I hit
       voice typing" behaviour. It is left selected but NOT in edit mode: an
       editing block is an uncontrolled contentEditable, and writing to the store
       wouldn't show up in it. */
    const canvas = useCanvasStore.getState();
    const selected = canvas.selectedId
      ? canvas.objects.find((o) => o.id === canvas.selectedId)
      : undefined;
    const dictatable =
      selected && ['text', 'heading', 'sticky'].includes(selected.type)
        ? selected
        : undefined;

    let targetId: string;
    if (dictatable) {
      targetId = dictatable.id;
    } else {
      const { camera } = canvas;
      const block = canvas.addObject({
        type: 'text',
        x: (-camera.x + window.innerWidth / 2) / camera.zoom - 200,
        y: (-camera.y + window.innerHeight / 2) / camera.zoom - 40,
        width: 400,
        height: 60,
        content: '',
      });
      targetId = block.id;
      canvas.setEditingId(null);
      canvas.setSelectedId(block.id);
    }

    voice.beginSession(targetId);
    voice.setIsListening(true);
    wantListening = true;

    if (!recognition) {
      recognition = new Ctor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event: any) => {
        const store = useVoiceStore.getState();
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const text = result[0]?.transcript ?? '';
          if (result.isFinal) store.appendTranscript(text);
          else interim += text;
        }
        store.setInterimTranscript(interim);
        if (interim || event.results.length) store.setIsPaused(false);
      };

      recognition.onerror = (event: any) => {
        const store = useVoiceStore.getState();
        if (event.error === 'no-speech') {
          store.setIsPaused(true);
          return; // onend will restart us
        }
        if (event.error === 'aborted') return;
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          wantListening = false;
          store.setError('Microphone blocked. Allow mic access for this site and try again.');
          store.setIsListening(false);
          return;
        }
        store.setError(`Voice typing hit an error: ${event.error}`);
      };

      // Chrome ends a continuous session on its own every minute or so, and
      // after every silence. Restart it so dictation actually stays on until
      // the user says stop.
      recognition.onend = () => {
        if (!wantListening) return;
        restartTimer = setTimeout(() => {
          if (!wantListening) return;
          try {
            recognition.start();
          } catch {
            /* it was already running — nothing to do */
          }
        }, 250);
      };
    }

    try {
      recognition.start();
    } catch {
      // start() throws if it's already running; the session is live either way.
    }
  }, []);

  // Never leave the mic open behind a closing canvas.
  useEffect(() => {
    mounted += 1;
    return () => {
      mounted -= 1;
      if (mounted > 0 || !wantListening) return;
      wantListening = false;
      if (restartTimer) clearTimeout(restartTimer);
      try {
        recognition?.stop();
      } catch {
        /* ignore */
      }
      useVoiceStore.getState().setIsListening(false);
    };
  }, []);

  return { startRecognition, stopRecognition, isListening, unsupported };
};
