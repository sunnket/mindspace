import { create } from 'zustand';

/**
 * Which PDF block (if any) is currently open in the immersive reader.
 *
 * Deliberately a tiny standalone store (like the pattern used for the other
 * full-screen overlays) rather than a new field on the big canvas store — the
 * reader is pure view state, so nothing here persists or syncs. The *contents*
 * of a reading session (last page, bookmarks, highlights, chosen atmosphere) are
 * saved on the canvas object's `style`, not here, so they survive reload.
 */
interface PdfReaderState {
  /** The id of the file block being read, or null when the reader is closed. */
  objId: string | null;
  openReader: (objId: string) => void;
  closeReader: () => void;
}

export const usePdfReaderStore = create<PdfReaderState>((set) => ({
  objId: null,
  openReader: (objId) => set({ objId }),
  closeReader: () => set({ objId: null }),
}));
