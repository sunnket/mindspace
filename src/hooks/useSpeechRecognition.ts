'use client';

import { useCallback, useEffect } from 'react';
import { useVoiceStore } from '@/store/voiceStore';
import {
  startLocalSpeech,
  stopLocalSpeech,
  isLocalSpeechRunning,
  warmUpLocalSpeech,
} from '@/lib/voice/localSpeech';
import { openDictation, closeDictation, commitSpoken } from '@/lib/voice/dictation';

/**
 * Dictation. Speak, and the words land wherever you were about to type.
 *
 * TWO ENGINES, because one of them isn't ours.
 *
 * `SpeechRecognition` is not on-device speech recognition — it is a client for
 * GOOGLE'S speech service. The browser streams your microphone to Google and
 * streams words back. Where that service can't be reached it fails with `network`
 * on every attempt, forever, no matter how healthy the connection is: a Chromium
 * build without a Google API key (every embedded/IDE preview browser, Brave, most
 * forks), a network or region that blocks the endpoint. It is not a hiccup and
 * retrying it is pointless.
 *
 * So the first `network` failure switches to Whisper running ON THIS MACHINE (see
 * lib/voice/localSpeech) mid-session, in the same place, and remembers the choice
 * for a day so the next press goes straight there. Google's engine is the fast
 * path when it works; it is no longer the only path.
 *
 * NEITHER ENGINE WRITES ANYTHING ITSELF. Both hand finished phrases to
 * commitSpoken, which cleans them (lib/voice/cleanTranscript — this is where
 * `[Music]` and `(laughing)` die) and types them at the caret. One door in, one
 * door out; the HUD is a spectator.
 *
 * The recogniser is a MODULE-level singleton, not a ref inside the hook. It has
 * to be: this hook is mounted in two places at once (the toolbar button and the
 * orb), each of those used to build its own SpeechRecognition, and only the one
 * whose button you happened to press was ever started — while the other's
 * unmount cleanup could stop it. One recogniser, one session, shared state.
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
/** `network` errors this session. One is worth a single quick retry; two means
 *  the service genuinely isn't there for this browser, and we stop pretending. */
let networkRetries = 0;

/* THE SILENT FAILURE.
   `network` is the loud way Google's recogniser fails. The quiet way is worse
   and just as common in embedded browsers: it starts, it reports the microphone
   open, it fires soundstart as you talk — and it returns nothing. No result, no
   error, no end. Forever. That is a session that looks perfect and types nothing,
   which is precisely what "voice typing doesn't work" looks like from the
   outside, and the old code had no way to notice it.
   So: if it has HEARD something and still hasn't produced a single word, it gets
   a few seconds and then the on-device engine takes over. Sound in, nothing out,
   is a broken engine. */
const DEAF_MS = 10_000;
let deafTimer: ReturnType<typeof setTimeout> | null = null;
let sawResult = false;
let heardSound = false;
let deadCycles = 0;

function clearDeafTimer() {
  if (deafTimer) {
    clearTimeout(deafTimer);
    deafTimer = null;
  }
}

/** Armed the moment the recogniser goes live, because the events that would
 *  prove it's deaf are exactly the events a dead engine doesn't send. */
function watchForSilentFailure() {
  if (sawResult || deafTimer || !wantListening) return;
  deafTimer = setTimeout(() => {
    deafTimer = null;
    if (!wantListening || sawResult || isLocalSpeechRunning()) return;
    fallBackToLocal();
  }, DEAF_MS);
}

/** Remembered verdict on Google's speech service. Expires, so a laptop that was
 *  on a blocking network at the office isn't stuck on the local engine at home. */
const ENGINE_KEY = 'mindspace.voiceEngine';
const ENGINE_TTL = 24 * 60 * 60 * 1000;
/** Set the first time anyone dictates. Only then is it worth spending a model
 *  download on someone who may never press the button. */
const USED_KEY = 'mindspace.voiceUsed';

function preferLocal(): boolean {
  try {
    const raw = localStorage.getItem(ENGINE_KEY);
    if (!raw) return false;
    const { engine, at } = JSON.parse(raw);
    if (Date.now() - at > ENGINE_TTL) {
      localStorage.removeItem(ENGINE_KEY);
      return false;
    }
    return engine === 'local';
  } catch {
    return false;
  }
}

function rememberLocal() {
  try {
    localStorage.setItem(ENGINE_KEY, JSON.stringify({ engine: 'local', at: Date.now() }));
  } catch {
    /* private mode — we'll just re-discover it next time */
  }
}

function markUsed() {
  try {
    localStorage.setItem(USED_KEY, '1');
  } catch {
    /* nothing to do */
  }
}

function hasDictatedBefore(): boolean {
  try {
    return localStorage.getItem(USED_KEY) === '1';
  } catch {
    return false;
  }
}

function getRecognitionCtor(): any {
  if (typeof window === 'undefined') return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

/**
 * Get the on-device model onto this machine before it's needed.
 *
 * Cold start is the entire "why does this take so long" experience — a download,
 * a runtime boot and a first inference, all stacked in front of the first
 * sentence. Warming on hover means the press is instant; warming on idle means
 * even the hover is spare. Only done when the local engine is actually the one
 * that will run: there's no sense downloading Whisper for someone whose browser
 * talks to Google fine.
 */
export function warmVoiceEngine(): void {
  if (typeof window === 'undefined') return;
  if (getRecognitionCtor() && !preferLocal()) return;
  warmUpLocalSpeech();
}

/** Same, but only for people who've dictated before — for idle-time preloading,
 *  where spending a model download on a stranger would be rude. */
export function warmVoiceEngineIfUsed(): void {
  if (hasDictatedBefore()) warmVoiceEngine();
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
      // Only ever seen now if the local engine ALSO failed to come up.
      return "Google's speech service is unreachable and on-device speech didn't load. Check your connection.";
    case 'language-not-supported':
      return `Your browser can't dictate in ${recognitionLang()}. Try switching Chrome to English.`;
    default:
      return `Voice typing error: ${code}`;
  }
}

/**
 * Google's engine has failed in a way that will not recover. Hand the live
 * session over to the on-device one — same target, same caret, no interruption
 * the user has to act on.
 */
function fallBackToLocal() {
  wantListening = false;
  clearDeafTimer();
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  try {
    recognition?.stop();
  } catch {
    /* already down — that's why we're here */
  }

  /* Only remember the verdict when the engine actually PROVED it's broken: it
     errored, or it heard sound and returned nothing. Timing out on a user who
     simply didn't speak is not evidence of anything, and writing it down would
     park them on the on-device engine for a day over a moment's hesitation. */
  if (heardSound || networkRetries > 0) rememberLocal();

  const voice = useVoiceStore.getState();
  voice.setError(null);
  voice.setInterimTranscript('');
  voice.setNotice('Switching to on-device voice typing…');
  void startLocalSpeech();
}

export const useSpeechRecognition = () => {
  const isListening = useVoiceStore((s) => s.isListening);
  const unsupported = useVoiceStore((s) => s.unsupported);

  const stopRecognition = useCallback(() => {
    wantListening = false;
    clearDeafTimer();
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
    try {
      recognition?.stop();
    } catch {
      /* already stopped */
    }

    if (isLocalSpeechRunning()) {
      // It folds in its own last sentence and lets go of the target once the
      // queue has drained.
      stopLocalSpeech();
      return;
    }

    const voice = useVoiceStore.getState();
    // Anything still in flight is worth having — commit it before letting go.
    const tail = voice.interimTranscript.trim();
    voice.setInterimTranscript('');
    if (tail) commitSpoken(tail, { strict: false });
    voice.setNotice(null);
    voice.setIsListening(false);
    closeDictation();
  }, []);

  const startRecognition = useCallback(() => {
    const Ctor = getRecognitionCtor();
    const voice = useVoiceStore.getState();

    /* Give the words somewhere to go BEFORE the mic opens: the field that has
       the caret, the selected block, or a new text box in the middle of the
       view — see lib/voice/dictation. There is no version of pressing this
       button where you then have to go and click somewhere. */
    const targetId = openDictation();

    markUsed();
    voice.beginSession(targetId);
    voice.setUnsupported(false);

    /* Pick an engine. No SpeechRecognition at all (Firefox, Safari) used to mean
       "no voice typing on this browser" — it doesn't any more, because the local
       engine only needs WebAudio and WASM. And if Google's service already proved
       unreachable here, don't spend a second failing to reach it again. */
    if (!Ctor || preferLocal()) {
      void startLocalSpeech();
      return;
    }

    voice.setEngine('browser');
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
        store.setNotice(null);
        store.setLive(true);
        watchForSilentFailure();
      };

      recognition.onaudiostart = () => {
        useVoiceStore.getState().setHearing(true);
      };
      recognition.onaudioend = () => {
        useVoiceStore.getState().setHearing(false);
      };

      // Something reached the microphone. From here the engine owes us words,
      // and failing to deliver is a fact about the engine, not the room.
      recognition.onsoundstart = () => {
        heardSound = true;
        useVoiceStore.getState().setHearing(true);
        watchForSilentFailure();
      };
      recognition.onspeechstart = () => {
        heardSound = true;
        watchForSilentFailure();
      };

      recognition.onresult = (event: any) => {
        const store = useVoiceStore.getState();
        sawResult = true;
        deadCycles = 0;
        clearDeafTimer();
        networkRetries = 0; // it's working — forget any earlier wobble
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const text = result[0]?.transcript ?? '';
          // Finalised phrases get typed; guesses only ever reach the caption.
          // Google's engine doesn't invent sound effects, so its output isn't
          // put through the strict filter — a user who says "okay" means it.
          if (result.isFinal) commitSpoken(text, { strict: false });
          else interim += text;
        }
        store.setInterimTranscript(interim.trim());
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

        /* `network` means Google's speech backend didn't answer, and on a browser
           where it never answers this fires on every start — which is exactly the
           bug people hit: a perfect connection, and voice typing insisting the
           network is down. Allow ONE retry for a genuine blip (onend restarts us),
           then stop blaming the user's wifi and switch to the engine that doesn't
           need Google at all.

           `service-not-allowed` is the same story with a different label: the
           browser has no key for the service. Straight to local. */
        if (code === 'network') {
          networkRetries += 1;
          if (networkRetries <= 1) {
            store.setNotice('Reaching the speech service…');
            return; // onend restarts it once
          }
          fallBackToLocal();
          return;
        }
        if (code === 'service-not-allowed') {
          fallBackToLocal();
          return;
        }

        // Anything else is terminal for this session. Say what it actually was —
        // the old message swallowed the code and left nothing to act on.
        wantListening = false;
        store.setError(describeError(code));
        store.setIsListening(false);
        store.setLive(false);
        closeDictation();
      };

      // Chrome ends a continuous session on its own every minute or so, and
      // after every silence. Restart it so dictation actually stays on until
      // the user says stop.
      recognition.onend = () => {
        useVoiceStore.getState().setLive(false);
        if (!wantListening) return;

        // A whole session that produced nothing. Two of those in a row and we
        // stop giving it the microphone.
        if (!sawResult) {
          deadCycles += 1;
          if (deadCycles >= 2) {
            fallBackToLocal();
            return;
          }
        }

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
    sawResult = false;
    heardSound = false;
    deadCycles = 0;
    clearDeafTimer();

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
      if (mounted > 0) return;
      if (isLocalSpeechRunning()) stopLocalSpeech();
      if (!wantListening) return;
      wantListening = false;
      if (restartTimer) clearTimeout(restartTimer);
      try {
        recognition?.stop();
      } catch {
        /* ignore */
      }
      useVoiceStore.getState().setIsListening(false);
      closeDictation();
    };
  }, []);

  return { startRecognition, stopRecognition, isListening, unsupported };
};
