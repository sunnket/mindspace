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
  | 'empty'          // ...or there's nothing on it at all
  | 'rain'           // the Relax layer is weather
  | 'shelter'
  | 'skyshow'        // ...or it's fireflies, lanterns, aurora
  | 'play'
  | 'roll'
  | 'chase'          // the laser
  | 'caught'
  | 'called'         // you wrote its name on the board
  /* --- things it now notices you DOING, rather than things it is doing --- */
  | 'night'          // it is very late and you are still here
  | 'early'          // ...or very early
  | 'undo'           // you undid several things in a row
  | 'deleting'       // the board is getting smaller
  | 'creating'       // blocks are appearing fast
  | 'zoomed_out'     // you pulled back to look at the whole thing
  | 'zoomed_in'      // ...or right up to one block
  | 'returned'       // you were gone a while and came back
  | 'watching'       // your cursor has been sitting on the cat
  | 'moved_block'    // you dragged something past it
  | 'long_session'   // you have been at this for hours
  | 'stretch'        // mid-stretch
  | 'groom'          // mid-wash
  | 'perch';         // up on top of something

const POOLS: Record<ThoughtKind, string[]> = {
  typing_fast: [
    'slow down',
    'whoa',
    'someone had coffee',
    'the keys did nothing to you',
    'go go go',
    'ideas are happening',
    'i cannot read this fast',
    'the keyboard is fine. stop',
    'this is a lot of words',
    'you are typing at me',
    'save some for tomorrow',
    'is it a deadline. it is a deadline',
  ],
  typing_stalled: [
    'and then?',
    'stuck?',
    'the cursor is blinking at you',
    'say the next bit',
    'hm',
    'we were doing so well',
    'the sentence is waiting',
    'i also do not know',
    'go on',
    'blink blink blink',
  ],
  sleep: ['zzz', 'z z z', 'zzZ', 'mrrp', 'zzz...', 'prrr', 'do not', 'five more hours', 'mmf'],
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
    'i have decided to stay',
    'nothing is happening. good',
    'i am supervising',
    'this counts as work',
    'the floor is acceptable',
    'i thought of something. gone now',
    'do you ever just sit',
    'there was a bird once',
    'everything is fine here',
    'i am not doing anything on purpose',
  ],
  walk: [
    'off i go', 'patrol', 'checking things', 'busy', 'important business',
    'i have somewhere to be', 'do not follow', 'this way now', 'errand',
    'walking. as one does', 'i know where i am going',
  ],
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
  rain: ['it is raining', 'wet', 'i do not love this', 'indoors was fine', 'why is the sky doing that', 'my fur', 'this was not agreed'],
  shelter: ['dry here', 'i will wait it out', 'good roof', 'this will do', 'you may join me', 'the rain can wait'],
  skyshow: ['ooh', 'lights', 'look up', 'pretty', 'i could watch this', 'the sky is showing off', 'do that again', 'ok that one was good'],
  play: ['got it', 'again', 'this one moves', 'boop', 'mine', 'stop wriggling', 'it fought back', 'i am winning', 'one more', 'ha'],
  roll: ['aaaa', 'floor is good', 'wriggle', 'no reason', 'the belly is out', 'this is my whole personality', 'do not touch the belly', 'nnnngh'],
  chase: ['THE DOT', 'get it get it', 'mine mine mine', 'come back', 'i see it', 'IT MOVED', 'no escape', 'closer closer'],
  caught: ['got the dot', 'it was mine all along', 'ha', 'defeated', 'i am the best', 'never doubted it'],
  called: ['someone said my name', 'coming', 'that is me', 'you called?', 'i heard that', 'yes. what', 'i am famous'],

  /* --- what it makes of what YOU are doing --- */
  night: [
    'it is very late', 'go to bed', 'the moon is up. you are not', 'nothing good after midnight',
    'this can wait until it is light', 'i sleep at normal times', 'are you ok',
  ],
  early: [
    'it is so early', 'the birds are not even up', 'who is awake at this hour', 'oh. you are up',
    'this is my quiet time', 'coffee first surely',
  ],
  undo: [
    'second thoughts', 'it was fine before', 'backwards then', 'undo undo undo',
    'we are going back in time', 'you did like it once', 'make up your mind',
  ],
  deleting: [
    'gone then', 'that was there a second ago', 'ruthless', 'bye', 'a cull',
    'i liked that one', 'less board than before',
  ],
  creating: [
    'more boxes', 'where do they come from', 'the board is filling up', 'busy busy',
    'another one', 'you are making things', 'save room for me',
  ],
  zoomed_out: [
    'i am tiny now', 'the whole thing', 'so that is what it looks like', 'big picture then',
    'where did i go', 'everything at once',
  ],
  zoomed_in: [
    'very close', 'that is a big box', 'i can see the pixels', 'personal space',
    'we are examining this one',
  ],
  returned: [
    'you are back', 'i waited', 'where were you', 'nothing happened while you were out',
    'i guarded it', 'oh good', 'i did not miss you. much',
  ],
  watching: [
    'yes?', 'that is my face', 'you are staring', 'can i help', 'hello',
    'i see you seeing me', 'go on then. pet',
  ],
  moved_block: [
    'that moved', 'excuse me', 'it was fine there', 'redecorating',
    'i was sitting near that', 'careful',
  ],
  long_session: [
    'you have been here a while', 'stretch. i will wait', 'water exists',
    'this is hour who knows', 'stand up once', 'blink. i am serious',
  ],
  stretch: ['nnngh', 'good stretch', 'every bone', 'that was needed', 'longer than i look'],
  groom: ['busy', 'do not watch', 'maintenance', 'i must be perfect', 'one moment'],
  perch: ['high ground', 'better up here', 'i can see everything', 'the top is mine', 'do not look up'],
};

/* ------------------------------------------------------------------ */
/* Reading the actual board                                            */
/* ------------------------------------------------------------------ */

/** Lines keyed to what a block IS. */
const BY_TYPE: Record<string, string[]> = {
  sticky: ['a little yellow one', 'sticky', 'i could sit on this'],
  image: ['a picture', 'is that food', 'who is that', 'nice picture'],
  text: ['words words words', 'a lot of words', 'reading is hard'],
  heading: ['big letters', 'important then', 'this one shouts'],
  shape: ['a shape', 'geometry', 'very square'],
  browser: ['the internet is in there', 'tiny window', 'do not scroll'],
  drawing: ['you drew this', 'abstract', 'is that me'],
  card: ['a card', 'boxes inside boxes', 'neat'],
  'workflow-node': ['a plan', 'arrows mean plan', 'organised. suspicious'],
  mirror: ['who is that', 'there is a cat in there', 'hello me'],
};

/** ...and lines keyed to what it SAYS. These win — content beats type. */
const BY_CONTENT: { re: RegExp; lines: string[] }[] = [
  { re: /(bug|broken|error|crash|fail)/i, lines: ['something is broken', 'uh oh', 'that sounds bad'] },
  { re: /(todo|task|checklist)/i, lines: ['a list. ambitious', 'so many boxes', 'good luck'] },
  { re: /(idea|maybe|what if)/i, lines: ['an idea!', 'ooh', 'i like this one'] },
  { re: /(meeting|call|standup|sync)/i, lines: ['people talk time', 'sounds long'] },
  { re: /(deadline|due|ship|launch)/i, lines: ['soon then', 'that is coming up'] },
  { re: /(done|shipped|finished|complete)/i, lines: ['finished one', 'nice', 'good'] },
  { re: /\?\s*$/, lines: ['good question', 'i do not know either', 'hm'] },
];

/**
 * What the cat makes of one particular block. Returns null when it hasn't got
 * an opinion, which is most of the time — the caller should fall back to a
 * generic line rather than forcing a comment on every object.
 */
export function readObject(
  o: { type?: string; content?: string } | null | undefined,
  rng: () => number,
): string | null {
  if (!o) return null;
  const text = (o.content || '').trim();
  if (text === '' && o.type !== 'image' && o.type !== 'drawing' && o.type !== 'mirror') {
    return rng() < 0.5 ? 'this one is empty' : 'unfinished';
  }
  for (const rule of BY_CONTENT) {
    if (rule.re.test(text)) return rule.lines[Math.floor(rng() * rule.lines.length)];
  }
  const pool = BY_TYPE[o.type || ''];
  if (pool && rng() < 0.8) return pool[Math.floor(rng() * pool.length)];
  return null;
}

/** Thought clouds shaped like the thing they came from — speech is louder. */
export const SPEECH_KINDS: ReadonlySet<ThoughtKind> = new Set<ThoughtKind>([
  'startle', 'scruff', 'dropped', 'countdown', 'chase', 'caught', 'called', 'play',
  'watching', 'moved_block', 'returned',
]);

/**
 * Everything it has said lately, across every situation.
 *
 * Avoiding only the immediately-previous line per kind (what this used to do)
 * still lets a pool of six cycle round in a couple of minutes, and a companion
 * that repeats itself is one you stop reading. This remembers the last two
 * dozen lines it has actually said and won't reach for any of them, so the
 * bigger pools genuinely feel bigger.
 */
export class ThoughtMemory {
  private recent: string[] = [];
  private limit: number;
  constructor(limit = 24) { this.limit = limit; }
  has(line: string) { return this.recent.includes(line); }
  note(line: string) {
    this.recent.push(line);
    if (this.recent.length > this.limit) this.recent.shift();
  }
}

/**
 * Pull a line for a situation, avoiding anything said recently. Falls back to
 * "the least recently used" rather than giving up, so a small pool under heavy
 * use still rotates instead of sticking.
 */
export function pickThought(kind: ThoughtKind, rng: () => number, memory: ThoughtMemory): string {
  const pool = POOLS[kind];
  if (!pool || pool.length === 0) return '';
  const fresh = pool.filter((l) => !memory.has(l));
  const from = fresh.length ? fresh : pool;
  const line = from[Math.floor(rng() * from.length)];
  memory.note(line);
  return line;
}
