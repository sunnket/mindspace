import { create } from 'zustand';

interface VoiceState {
  isListening: boolean;
  /** Everything said this session, finalised. Appended to — never replaced. */
  transcript: string;
  /** The words currently being guessed at, before they settle. */
  interimTranscript: string;
  isPaused: boolean;
  /** Not supported by this browser (Firefox, most of Safari). */
  unsupported: boolean;
  /** Mic permission denied, or recognition died. Shown on the orb. */
  error: string | null;
  /** The block the dictation is being typed into. */
  targetId: string | null;
  /** The recogniser has actually started (onstart fired), not just been asked to. */
  live: boolean;
  /** The recogniser has the microphone open and is taking audio. */
  hearing: boolean;

  setIsListening: (val: boolean) => void;
  setLive: (val: boolean) => void;
  setHearing: (val: boolean) => void;
  /** Append a finalised phrase. */
  appendTranscript: (val: string) => void;
  setInterimTranscript: (val: string) => void;
  setIsPaused: (val: boolean) => void;
  setUnsupported: (val: boolean) => void;
  setError: (val: string | null) => void;
  setTargetId: (id: string | null) => void;
  /** Start a fresh dictation session against a block. */
  beginSession: (targetId: string) => void;
  reset: () => void;
}

export const useVoiceStore = create<VoiceState>((set) => ({
  isListening: false,
  transcript: '',
  interimTranscript: '',
  isPaused: false,
  unsupported: false,
  error: null,
  targetId: null,
  live: false,
  hearing: false,

  setIsListening: (val) => set({ isListening: val }),
  setLive: (val) => set({ live: val }),
  setHearing: (val) => set({ hearing: val }),

  /* Append, don't overwrite.
     This used to be a plain setter that REPLACED the transcript with whatever
     the recogniser had just finalised — so every time you paused for breath,
     Chrome closed off a result and the sentence you'd already spoken was thrown
     away and overwritten by the next one. Dictation could never accumulate. */
  appendTranscript: (val) =>
    set((s) => {
      const piece = val.trim();
      if (!piece) return s;
      return { transcript: s.transcript ? `${s.transcript} ${piece}` : piece };
    }),

  setInterimTranscript: (val) => set({ interimTranscript: val }),
  setIsPaused: (val) => set({ isPaused: val }),
  setUnsupported: (val) => set({ unsupported: val }),
  setError: (val) => set({ error: val }),
  setTargetId: (id) => set({ targetId: id }),

  beginSession: (targetId) =>
    set({ targetId, transcript: '', interimTranscript: '', isPaused: false, error: null, live: false, hearing: false }),

  reset: () =>
    set({
      transcript: '', interimTranscript: '', isListening: false, isPaused: false,
      targetId: null, error: null, live: false, hearing: false,
    }),
}));
