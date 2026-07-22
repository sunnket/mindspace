import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/**
 * Flow Mode — the "live the moment" writing experience.
 *
 * A cinematic focus layer that narrows the canvas to the words you're writing: a
 * warm spotlight follows your caret, everything else falls into a soft dark frame,
 * the chrome melts away while you type, the room's mood shifts to match what you
 * write (semantic weather), and a living-progress sprite grows as the words flow.
 *
 * This store holds only the *preferences* (persisted) and a little live runtime
 * state (mood, typing, session tallies). The heavy per-frame work — the spotlight
 * lerp, momentum decay, particle motion — lives in FlowModeLayer and writes to the
 * DOM directly, so it never round-trips through React.
 */

export type FlowMood =
  | 'calm'
  | 'warm'
  | 'cold'
  | 'rain'
  | 'night'
  | 'fire'
  | 'ocean'
  | 'forest';

/** The living-progress metaphor: a candle burning down, a tree growing, a coffee
 *  draining — each fills over a "page" of words, then begins a fresh one. */
export type FlowProgressStyle = 'candle' | 'tree' | 'coffee';

export interface FlowPrefs {
  /** Warm spotlight that follows the caret + cinematic edge vignette. */
  spotlight: boolean;
  /** Toolbar / panels melt away while you're typing, return when you pause. */
  chromeFade: boolean;
  /** Momentum ember + typing rhythm feedback. */
  momentum: boolean;
  /** Read the mood of what you write and shift the room to match. */
  semanticWeather: boolean;
  /** A living metaphor (candle / tree / coffee) + session word tally. */
  livingProgress: boolean;
  /** Which metaphor the living-progress card shows. */
  progressStyle: FlowProgressStyle;
}

export interface FlowSession {
  /** Words written since Flow Mode was switched on this sitting. */
  words: number;
  /** A gentle rolling words-per-minute. */
  wpm: number;
  startedAt: number;
}

interface FlowState {
  enabled: boolean;
  prefs: FlowPrefs;
  /** Overall dimming strength of the room, 0.4–1. */
  intensity: number;
  /** Where the draggable progress card sits (top-left px). null = default spot. */
  progressPos: { x: number; y: number } | null;

  // --- live runtime (not persisted) ---
  mood: FlowMood;
  typing: boolean;
  session: FlowSession;

  toggle: () => void;
  setEnabled: (v: boolean) => void;
  setPref: <K extends keyof FlowPrefs>(key: K, value: FlowPrefs[K]) => void;
  setIntensity: (v: number) => void;

  setMood: (m: FlowMood) => void;
  setTyping: (v: boolean) => void;
  setSession: (s: Partial<FlowSession>) => void;
  resetSession: () => void;
  setProgressPos: (p: { x: number; y: number } | null) => void;
}

const DEFAULT_PREFS: FlowPrefs = {
  spotlight: true,
  chromeFade: true,
  momentum: true,
  semanticWeather: true,
  livingProgress: true,
  progressStyle: 'candle',
};

const freshSession = (): FlowSession => ({ words: 0, wpm: 0, startedAt: Date.now() });

export const useFlowStore = create<FlowState>()(
  persist(
    (set) => ({
      enabled: false,
      prefs: DEFAULT_PREFS,
      intensity: 0.9,
      progressPos: null,

      mood: 'calm',
      typing: false,
      session: freshSession(),

      toggle: () =>
        set((s) => {
          const next = !s.enabled;
          return { enabled: next, session: next ? freshSession() : s.session, mood: next ? 'calm' : s.mood };
        }),
      setEnabled: (v) => set((s) => ({ enabled: v, session: v && !s.enabled ? freshSession() : s.session })),
      setPref: (key, value) => set((s) => ({ prefs: { ...s.prefs, [key]: value } })),
      setIntensity: (v) => set({ intensity: Math.max(0.4, Math.min(1, v)) }),

      setMood: (m) => set({ mood: m }),
      setTyping: (v) => set((s) => (s.typing === v ? s : { typing: v })),
      setSession: (s2) => set((s) => ({ session: { ...s.session, ...s2 } })),
      resetSession: () => set({ session: freshSession() }),
      setProgressPos: (p) => set({ progressPos: p }),
    }),
    {
      name: 'canvabrains.flow',
      version: 2,
      storage: createJSONStorage(() => localStorage),
      // Persist preferences only — never the live session / mood / typing state.
      partialize: (s) => ({ enabled: s.enabled, prefs: s.prefs, intensity: s.intensity, progressPos: s.progressPos }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<FlowState>;
        return {
          ...current,
          ...p,
          prefs: { ...DEFAULT_PREFS, ...(p.prefs ?? {}) },
        };
      },
    }
  )
);
