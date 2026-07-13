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
/** Consecutive `network` errors. Chrome's speech backend hiccups; it recovers. */
let networkRetries = 0;

function getRecognitionCtor(): any {
  if (typeof window === 'undefined') return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

/**
 * Dictate in the user's own language. Hardcoding en-US made an Indian-English or
 * Hindi speaker fight the recogniser for every sentence; the browser already
 * knows what they speak.
 */
function recognitionLang(): string {
  if (typeof navigator === 'undefined') return 'en-US';
  return navigator.language || 'en-US';
}

/** Plain English for the error codes the Web Speech API throws. */
function describeError(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone blocked. Allow mic access for this site, then hit voice typing again.';
    case 'audio-capture':
      return 'No microphone found. Check that one is plugged in and not in use by another app.';
    case 'network':
      return 'Speech service unreachable. Check your connection — retrying…';
    case 'language-not-supported':
      return `Your browser can't dictate in ${recognitionLang()}. Try switching Chrome to English.`;
    default:
      return `Voice typing error: ${code}`;
  }
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
      recognition.maxAlternatives = 1;
      recognition.lang = recognitionLang();

      recognition.onstart = () => {
        const store = useVoiceStore.getState();
        store.setError(null);
        store.setLive(true);
      };

      recognition.onaudiostart = () => {
        useVoiceStore.getState().setHearing(true);
      };
      recognition.onaudioend = () => {
        useVoiceStore.getState().setHearing(false);
      };

      recognition.onresult = (event: any) => {
        const store = useVoiceStore.getState();
        networkRetries = 0; // it's working — forget any earlier wobble
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const text = result[0]?.transcript ?? '';
          if (result.isFinal) store.appendTranscript(text);
          else interim += text;
        }
        store.setInterimTranscript(interim);
        store.setIsPaused(false);
      };

      recognition.onerror = (event: any) => {
        const store = useVoiceStore.getState();
        const code = String(event?.error || 'unknown');

        // A silence isn't a failure — onend restarts us and we keep listening.
        if (code === 'no-speech') {
          store.setIsPaused(true);
          return;
        }
        // We aborted it ourselves (stop(), or a restart racing a stop).
        if (code === 'aborted') return;

        /* Chrome's speech backend drops out on a flaky connection and throws
           `network`. It almost always comes straight back, so ride it out
           rather than tearing the session down under the user — onend is about
           to restart us anyway. */
        if (code === 'network' && networkRetries < 4) {
          networkRetries += 1;
          store.setError(describeError(code));
          return;
        }

        // Anything else is terminal for this session. Say what it actually was —
        // the old message swallowed the code and left nothing to act on.
        wantListening = false;
        store.setError(describeError(code));
        store.setIsListening(false);
        store.setLive(false);
      };

      // Chrome ends a continuous session on its own every minute or so, and
      // after every silence. Restart it so dictation actually stays on until
      // the user says stop.
      recognition.onend = () => {
        useVoiceStore.getState().setLive(false);
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

    recognition.lang = recognitionLang();
    networkRetries = 0;

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
