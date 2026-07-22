/**
 * What the cat is thinking.
 *
 * A companion that only ever emits "zzz" stops being read after a day. So the
 * lines are pooled by situation, drawn without immediate repeats, and gated
 * hard on frequency — a thought every few seconds is a chatbot sitting on your
 * canvas, not an animal that occasionally has an opinion.
 *
 * Rules for adding lines:
 *  - Lowercase, short, no terminal punctuation unless it's doing work. The
 *    bubble is ~18 characters wide before it starts covering the board.
 *  - The cat is a bystander with opinions, never an assistant. It does not
 *    offer help, summarise your work, or congratulate you on productivity.
 *  - Funny by observation, not by joke construction. It's a cat.
 */

export type ThoughtKind =
  | 'typing_fast'    // you're on a tear
  | 'typing_stalled' // you stopped mid-thought and the cursor is just sitting there
  | 'sleep'
  | 'idle'
  | 'walk'
  | 'block'          // arrived somewhere interesting
  | 'stale'          // sitting by something you haven't touched in a long time
  | 'timer'          // a focus session is running
  | 'countdown'      // a deadline is inside 24h
  | 'mirror'
  | 'pile'
  | 'nest'
  | 'scruff'         // being carried
  | 'dropped'
  | 'startle'
  | 'pet'
  | 'clutter'        // the canvas has got away from you
  | 'empty';         // ...or there's nothing on it at all

const POOLS: Record<ThoughtKind, string[]> = {
  typing_fast: [
    'slow down',
    'whoa',
    'someone had coffee',
    'the keys did nothing to you',
    'go go go',
    'ideas are happening',
    'i cannot read this fast',
  ],
  typing_stalled: [
    'and then?',
    'stuck?',
    'the cursor is blinking at you',
    'say the next bit',
    'hm',
  ],
  sleep: ['zzz', 'z z z', 'zzZ', 'mrrp', 'zzz...'],
  idle: [
    'hm.',
    'thinking about nothing',
    'the sun was here earlier',
    'what if boxes',
    'i could nap',
    'no thoughts',
    'this is a good spot',
    'i live here now',
    'you missed a spot',
    'something smells like tuesday',
  ],
  walk: ['off i go', 'patrol', 'checking things', 'busy', 'important business'],
  block: [
    'what is this one',
    'mine now',
    'this looks important',
    'i shall sit on it',
    'load bearing box',
    'smells like a todo',
  ],
  stale: [
    'this one is dusty',
    'remember this?',
    'nobody has loved this in weeks',
    'archaeology',
  ],
  timer: [
    'focus. i am watching',
    'no new tabs',
    'i will wait',
    'we are working',
    'do not look at me',
  ],
  countdown: [
    'uh',
    'the date. THE DATE',
    'tick tick',
    'this is soon',
    'have you seen this',
  ],
  mirror: ['who is that', 'there is a cat in there', 'hello me', 'suspicious'],
  pile: ['a pile. excellent', 'good stack', 'i sit on top now', 'tallest one wins'],
  nest: ['my things', 'still here. good', 'nobody touch this', 'treasure'],
  scruff: ['rude', 'put me down', 'i was busy', 'unhand me', 'this is undignified'],
  dropped: ['ow', 'i meant to do that', 'landed it', 'unnecessary'],
  startle: ['!!', 'AAA', 'what', 'do not'],
  pet: ['mrrp', 'purr', 'ok this is fine', 'again', '<3'],
  clutter: [
    'this is a lot',
    'too many boxes',
    'organised? no',
    'i have lost track',
  ],
  empty: [
    'nothing here',
    'write something',
    'big empty',
    'just us then',
  ],
};

/** Thought clouds shaped like the thing they came from — speech is louder. */
export const SPEECH_KINDS: ReadonlySet<ThoughtKind> = new Set<ThoughtKind>([
  'startle', 'scruff', 'dropped', 'countdown',
]);

/**
 * Pull a line, never the same one twice running for that situation.
 * `recent` is mutated — it's the caller's per-cat memory of what it just said.
 */
export function pickThought(
  kind: ThoughtKind,
  rng: () => number,
  recent: Map<ThoughtKind, string>,
): string {
  const pool = POOLS[kind];
  if (!pool || pool.length === 0) return '';
  const last = recent.get(kind);
  let line = pool[Math.floor(rng() * pool.length)];
  if (pool.length > 1 && line === last) {
    line = pool[(pool.indexOf(line) + 1 + Math.floor(rng() * (pool.length - 1))) % pool.length];
  }
  recent.set(kind, line);
  return line;
}
