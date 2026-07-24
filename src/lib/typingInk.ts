/**
 * Typing as ink — the physics of the "your writing carries your energy" feature.
 *
 * As you type, the interval between keystrokes is turned into an INTENSITY
 * (0 = slow & deliberate, 100 = a fast burst) and stored per character on the
 * block (`style.inkRhythm`). When the note is read back, each character is
 * rendered with a weight + jitter derived from the intensity it was typed at —
 * so fast bursts come out jagged and bold, slow lines calm and even, and the
 * page shows you the ENERGY you wrote it with, not just the words.
 *
 * The heavy per-frame nothing here: this is all pure functions. Capture lives in
 * CanvasObject (keystroke timing), rendering in InkText.
 */

export const INK_FONT = "'Shantell Sans', 'Caveat', cursive";

/** A neutral resting intensity for characters we have no timing for (pastes,
 *  agent-written text, the tail of a resized array). Calm, but still inky. */
export const INK_NEUTRAL = 38;

/** Keystroke interval → intensity. Sub-60ms is a genuine burst; past ~420ms the
 *  writer is deliberate. Clamped and eased so the texture isn't binary. */
export function intervalToIntensity(dtMs: number): number {
  const FAST = 60;
  const SLOW = 420;
  if (dtMs <= FAST) return 100;
  if (dtMs >= SLOW) return 0;
  const t = (dtMs - FAST) / (SLOW - FAST); // 0..1 across the band
  // ease-out so the middle of the band still reads as fairly energetic
  return Math.round((1 - t) * (1 - t) * 100);
}

/** Deterministic per-index pseudo-random in [0,1) — the jitter must be STABLE
 *  across re-renders, or the text would shiver every paint. */
function seeded(n: number): number {
  const x = Math.sin(n * 12.9898 + 4.271) * 43758.5453;
  return x - Math.floor(x);
}

export interface InkCharStyle {
  fontWeight: number;
  /** degrees */
  rotate: number;
  /** px */
  dy: number;
}

/** The look of one character at a given intensity. Fast → heavy, tilted, bouncing
 *  off the baseline (jagged). Slow → light and level (calm). */
export function inkCharStyle(intensity: number, index: number): InkCharStyle {
  const e = Math.max(0, Math.min(100, intensity)) / 100;
  const fontWeight = Math.round(340 + e * 440); // 340..780
  const rot = (seeded(index) - 0.5) * 2;        // -1..1, stable per index
  const bounce = (seeded(index * 7 + 3) - 0.5) * 2;
  return {
    fontWeight,
    rotate: +(rot * e * 6).toFixed(2),   // up to ±6° at full speed, 0 when slow
    dy: +(bounce * e * 2.4).toFixed(2),  // up to ±2.4px vertical jitter
  };
}

/**
 * Fold a keystroke into the per-character rhythm array by diffing old→new text.
 * Handles the three real cases: appending at the caret (the common one),
 * deleting, and inserting/replacing in the middle — via a common-prefix /
 * common-suffix diff. Newly-added characters all take `intensity`; untouched
 * characters keep the intensity they were written at.
 */
export function foldRhythm(
  prev: number[],
  prevText: string,
  nextText: string,
  intensity: number,
): number[] {
  if (prevText === nextText) return prev;
  const pLen = prevText.length;
  const nLen = nextText.length;

  let pre = 0;
  const maxPre = Math.min(pLen, nLen);
  while (pre < maxPre && prevText[pre] === nextText[pre]) pre++;

  let suf = 0;
  const maxSuf = Math.min(pLen - pre, nLen - pre);
  while (suf < maxSuf && prevText[pLen - 1 - suf] === nextText[nLen - 1 - suf]) suf++;

  const addedCount = nLen - pre - suf;
  const added = addedCount > 0 ? new Array(addedCount).fill(intensity) : [];

  // Keep the array aligned even if a prior array was short/absent.
  const head = prev.slice(0, pre);
  while (head.length < pre) head.push(INK_NEUTRAL);
  const tail = prev.slice(pLen - suf);

  return [...head, ...added, ...tail];
}
