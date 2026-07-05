import { create } from 'zustand';

interface VoiceState {
  isListening: boolean;
  transcript: string;
  interimTranscript: string;
  isPaused: boolean;
  setIsListening: (val: boolean) => void;
  setTranscript: (val: string) => void;
  setInterimTranscript: (val: string) => void;
  setIsPaused: (val: boolean) => void;
  reset: () => void;
}

export const useVoiceStore = create<VoiceState>((set) => ({
  isListening: false,
  transcript: '',
  interimTranscript: '',
  isPaused: false,
  setIsListening: (val) => set({ isListening: val }),
  setTranscript: (val) => set({ transcript: val }),
  setInterimTranscript: (val) => set({ interimTranscript: val }),
  setIsPaused: (val) => set({ isPaused: val }),
  reset: () => set({ transcript: '', interimTranscript: '', isListening: false, isPaused: false }),
}));
