/**
 * What Whisper returns is not what you said.
 *
 * The model was trained on captioned video, so it writes the CAPTION of the room,
 * not a transcript of your voice: `[Music]`, `(knocking)`, `(laughing)`,
 * `[BLANK_AUDIO]`, `(door slams)`. Handed room tone it invents the line that most
 * often accompanies silence in its training data — "Thanks for watching!",
 * "Subtitles by…". And when the audio runs out mid-thought its decoder loops:
 * "Hey, hey, hey, hey." / "This is something. This is something."
 *
 * Every one of those was landing on the canvas. None of them is speech. This is
 * the filter that stands between the model and the page, and NOTHING reaches a
 * block without going through it.
 *
 * Pure string functions on purpose — no store, no DOM, no engine. Both engines
 * (Whisper on-device and the browser's) run their output through the same door.
 */

/** Sound events and stage directions: [Music], (laughing), *sighs*, ♪…♪, <noise>. */
const ANNOTATION = /[[(<*♪][^\])>*♪\n]{0,80}[\])>*♪]/g;

/** A clip cut mid-annotation leaves the opener behind: "…and then (knock". */
const DANGLING = /[[(<]\s*[^\])>\n]{0,40}$/;

/** Speech-shaped noise. Matched against the whole utterance, reduced to bare
 *  letters — so a lone "okay" is dropped but "okay, let's start" survives. */
const GHOST_LINES: RegExp[] = [
  /^(thanks?|thank you)( (so|very) much)?( for)? (watching|listening|coming)/,
  // Whisper's single most common answer to a room with nobody in it.
  /^(thank (you|u)|thanks)( (so|very) much)?$/,
  /^(please )?(like (and|&) )?subscribe/,
  /^(don't forget to|remember to) (like|subscribe)/,
  /^subtitles?( and corrections?)? (by|are|provided)/,
  /^(transcription|transcript|captions?|subs) (by|from)/,
  /^amara ?o?r?g?$/,
  /^(www|http)/,
  /^(mbc |sbs |kbs )?(뉴스|ニュース)/,
  /^blank ?audio$/,
  /^(silence|music|applause|laughter|noise|inaudible|foreign)$/,
  // A single filler word alone is the model breathing, not you talking.
  /^(bye|hello|hi|hey|okay|ok|so|you|yeah|yep|ah|oh|uh|um|erm|hmm|mm|mhm|huh|the end|end|next)$/,
  // …and the same one stuttered: "you you you", "bye bye bye".
  /^(bye|hello|hi|hey|okay|ok|so|you|yeah|ah|oh|uh|um|hmm|mm)( \1)+$/,
];

/** Sounds people make between words. Dropped only when there's real text left. */
const FILLERS = new Set(['um', 'uh', 'erm', 'uhm', 'mm', 'mmm', 'hmm', 'ah', 'eh']);

/** A token stripped to comparable form — punctuation and case carry no meaning
 *  when you're asking "did the decoder just say this again?". */
function keyOf(token: string): string {
  return token.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function bareText(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim();
}

function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

function capitaliseFirst(text: string): string {
  const i = text.search(/\p{L}/u);
  if (i < 0) return text;
  return text.slice(0, i) + text[i].toUpperCase() + text.slice(i + 1);
}

/**
 * Whisper's failure mode when it runs out of audio is to repeat itself, so a
 * phrase that appears back-to-back-to-back is the decoder stuck in a groove, not
 * you being emphatic.
 *
 * Longer loops need less proof than short ones: three "hey"s in a row is a tic
 * people actually have, three repeats of a five-word sentence is never speech.
 * The LAST copy is the one kept — it's the one carrying the sentence's closing
 * punctuation ("This is something." rather than "This is something,").
 */
function collapseLoops(text: string): string {
  let tokens = words(text);
  for (let n = 1; n <= 6; n++) {
    const needed = n <= 2 ? 3 : 2;
    const out: string[] = [];
    let i = 0;
    while (i < tokens.length) {
      const gram = tokens.slice(i, i + n).map(keyOf);
      if (gram.length < n || gram.some((g) => !g)) {
        out.push(tokens[i]);
        i += 1;
        continue;
      }
      let reps = 1;
      for (;;) {
        const next = tokens.slice(i + reps * n, i + (reps + 1) * n).map(keyOf);
        if (next.length < n || next.some((g, k) => g !== gram[k])) break;
        reps += 1;
      }
      if (reps >= needed) {
        out.push(...tokens.slice(i + (reps - 1) * n, i + reps * n));
        i += reps * n;
      } else {
        out.push(tokens[i]);
        i += 1;
      }
    }
    tokens = out;
  }
  return tokens.join(' ');
}

function dropFillers(text: string): string {
  const kept = words(text).filter((t) => !FILLERS.has(keyOf(t)));
  if (!kept.length) return text; // it was ALL filler — let the ghost check judge it
  return kept.join(' ');
}

/** Spacing and punctuation, as a person would have typed it. */
function tidy(text: string): string {
  return text
    .replace(/[ ​]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ +([,.!?;:])/g, '$1')
    .replace(/([,;:])(?=\p{L})/gu, '$1 ')
    .replace(/^[\s,.;:!?\-–—]+/, '')
    .trim();
}

export interface CleanOptions {
  /**
   * On for Whisper, off for the browser's recogniser. Google's service never
   * invents `[Music]` and never loops, so its output only needs tidying — and a
   * user who genuinely says just "okay" should get "okay".
   */
  strict?: boolean;
}

/**
 * One utterance in, clean speech out — or an empty string, which means the model
 * heard the room and nothing was said. Callers MUST treat '' as "write nothing".
 */
export function cleanUtterance(raw: string, opts: CleanOptions = {}): string {
  const strict = opts.strict !== false;
  if (!raw) return '';

  let text = raw;
  // Twice: annotations sit right up against each other — "[Music] (laughing)".
  text = text.replace(ANNOTATION, ' ').replace(ANNOTATION, ' ');
  if (strict) text = text.replace(DANGLING, ' ');
  text = tidy(text);
  if (!text) return '';

  if (strict && GHOST_LINES.some((re) => re.test(bareText(text)))) return '';

  text = collapseLoops(text);
  if (strict) text = dropFillers(text);
  text = tidy(text);

  const bare = bareText(text);
  if (!bare) return '';
  if (strict) {
    if (GHOST_LINES.some((re) => re.test(bare))) return '';
    // A single stray letter is a decoder artefact, not a word. "a" and "I" are.
    if (bare.length < 2 && !/^[ai]$/.test(bare)) return '';
  }

  return text;
}

/**
 * The tail of what's already written and the start of what was just heard can be
 * the same words — an utterance cut at the 18-second ceiling gets re-transcribed
 * with its opening intact, and a browser recogniser sometimes finalises a phrase
 * it had already finalised. Two words of agreement is enough to call it an echo;
 * one is just someone saying "no" twice.
 */
function trimOverlap(before: string, addition: string): string {
  const prev = words(before).map(keyOf);
  const next = words(addition);
  const keys = next.map(keyOf);
  const max = Math.min(8, prev.length, next.length);
  for (let k = max; k >= 2; k--) {
    let same = true;
    for (let i = 0; i < k; i++) {
      if (prev[prev.length - k + i] !== keys[i]) {
        same = false;
        break;
      }
    }
    if (same) return next.slice(k).join(' ');
  }
  return addition.trim();
}

/**
 * The exact string to type at the caret so the new words read as part of the
 * text that's already there: a space if one is needed, a capital if the last
 * sentence was closed, nothing at all if it's an echo of what's already written.
 */
export function insertionFor(before: string, spoken: string): string {
  const add = trimOverlap(before, spoken);
  if (!add) return '';
  if (!before.trim()) return capitaliseFirst(add);

  // Trailing spaces don't end a sentence; a newline does — dictating onto a
  // fresh line should start with a capital, not continue the line above it.
  const closed = /[.!?:\n]/.test(before.replace(/[ \t]+$/, '').slice(-1));
  const piece = closed ? capitaliseFirst(add) : add;
  const glue = /\s/.test(before.slice(-1)) ? '' : ' ';
  return glue + piece;
}

/** The same join, for the case where there's no caret to type at. */
export function joinSpoken(before: string, spoken: string): string {
  return before + insertionFor(before, spoken);
}
