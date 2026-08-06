'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCanvasStore, resolveParentId } from '@/store/canvasStore';
import { CanvasObjectData } from '@/lib/db';
import { Occupancy, rectOf, isBackdrop, settle, fitFrame, contentHeight } from '@/lib/canvasLayout';
import { formatSkillsetForAgent } from '@/lib/skillset';
import { extractUrl, newLinkCard, linkPreviewStyle, normalizeUrl, LINK_CARD_SIZE } from '@/lib/linkPreview';

/* CREATE_STROKE is deliberately absent. The agent used to be able to lay down
   freehand ink, and it did — unasked, all over people's boards, leaving stray
   squiggles they then had to hunt down and erase. The pen belongs to the user.
   A stroke action arriving from a model that still remembers the old schema is
   ignored (see runAction's default). */
interface Action {
  type:
    | 'CREATE_OBJECT'
    | 'UPDATE_OBJECT'
    | 'DELETE_OBJECT'
    | 'CREATE_CONNECTION'
    | 'DELETE_CONNECTION'
    | 'CREATE_SCENE';
  tempId?: string;
  id?: string;
  fromId?: string;
  toId?: string;
  connectionId?: string;
  objData?: Partial<CanvasObjectData>;
  updates?: Partial<CanvasObjectData>;
  style?: Record<string, unknown>;
  // CREATE_SCENE
  name?: string;
  notes?: string;
  x?: number;
  y?: number;
  zoom?: number;
  log?: string;
}

/** Downscale an image data URL for the vision model (keeps payload small so the
 *  NIM inline-image limit is respected). Falls back to the original on failure. */
function downscaleImage(dataUrl: string, max = 768, quality = 0.6): Promise<string> {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(dataUrl);
        ctx.drawImage(img, 0, 0, w, h);
        try {
          resolve(canvas.toDataURL('image/jpeg', quality));
        } catch {
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    } catch {
      resolve(dataUrl);
    }
  });
}

const IMAGE_TASK_RE =
  /\b(caption|captions|describe|description|alt[\s-]?text|title|analy[sz]e|summari[sz]e|transcribe|what(?:'s| is| does)?[^.]*\b(image|picture|photo|pic|screenshot))\b|\b(this|the|my)\s+(image|picture|photo|pic|screenshot)\b/i;

/** Is this task about an image the user placed? */
function isImageTask(text: string): boolean {
  return IMAGE_TASK_RE.test(text || '');
}

/** Peel a ```json … ``` wrapper off a model response, if it added one. */
function stripCodeFence(text: string): string {
  const s = (text || '').trim();
  if (!s.startsWith('```')) return s;
  return s
    .replace(/^```[a-zA-Z]*\s*/, '')
    .replace(/```\s*$/, '')
    .trim();
}

const StopIcon = ({ size = 9 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <rect x="4" y="4" width="16" height="16" rx="3" />
  </svg>
);

/**
 * Parse one action, repairing the escaping mistake every model on this tier
 * makes sooner or later.
 *
 * Several widgets take a JSON ARRAY inside a JSON STRING (a To-Do's items, a
 * chart's data when the model puts it in `content`). Writing that correctly
 * means emitting \" for each inner quote, and models routinely emit \\" — which
 * terminates the string early and makes the whole action unparseable. The
 * scanner silently dropped those, so the user saw a board that was missing
 * exactly the checklist or chart they asked for, with no error anywhere. That
 * is a real slice of the "it half did it / the widget I asked for is missing"
 * complaint. Verified against live output: this recovers the action intact.
 */
function parseAction(slice: string): Action | null {
  try { return JSON.parse(slice) as Action; } catch { /* try to repair */ }
  try { return JSON.parse(slice.replace(/\\\\"/g, '\\"')) as Action; } catch { /* give up */ }
  return null;
}

interface MemoryEntry { key?: string; value?: string; category?: string; forget?: string }

/** The object types the canvas can actually render. */
const REAL_TYPES = new Set([
  'text', 'heading', 'sticky', 'shape', 'frame', 'image', 'card', 'workflow-node', 'browser', 'drawing',
]);

/* Every widget in the schema is a "card" wearing a style flag, and models
   regularly shorten that to the widget's own name — observed live: a link card
   emitted as {"type":"link", style:{isLinkPreview:true,…}}. The canvas has no
   "link" type, so the block rendered as nothing: content the user asked for,
   silently absent. Map the obvious aliases back onto a real type instead of
   dropping them. */
const TYPE_ALIASES: Record<string, string> = {
  link: 'card', linkcard: 'card', 'link-card': 'card', url: 'card',
  todo: 'card', checklist: 'card', task: 'card', tasks: 'card',
  chart: 'card', graph: 'card', timeline: 'card', gantt: 'card',
  map: 'card', weather: 'card', quote: 'card', code: 'card', mermaid: 'card',
  diagram: 'card', timer: 'card', countdown: 'card', poll: 'card',
  metric: 'card', progress: 'card', table: 'card', decision: 'card',
  note: 'sticky', 'sticky-note': 'sticky', stickynote: 'sticky',
  title: 'heading', header: 'heading', h1: 'heading', h2: 'heading',
  paragraph: 'text', body: 'text', markdown: 'text',
  picture: 'image', photo: 'image', img: 'image',
  group: 'frame', container: 'frame', section: 'frame',
};

function normalizeType(raw: unknown, style: Record<string, unknown>): string | undefined {
  const t = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (REAL_TYPES.has(t)) return t;
  if (TYPE_ALIASES[t]) return TYPE_ALIASES[t];
  // Unknown name, but it carries a card feature flag → it's a card.
  if (Object.keys(style).some((k) => /^is[A-Z]/.test(k))) return 'card';
  return t || undefined;
}

/**
 * Pull the "memories" array out of a plan without parsing the whole document.
 * Scans brace-by-brace from the "memories" key, exactly like the action scanner,
 * so one bad escape elsewhere in the plan can't cost the user their memories.
 */
function extractMemories(text: string): MemoryEntry[] {
  const key = text.indexOf('"memories"');
  if (key === -1) return [];
  const open = text.indexOf('[', key);
  if (open === -1) return [];
  const out: MemoryEntry[] = [];
  let depth = 0, inStr = false, esc = false, objStart = -1;
  for (let i = open + 1; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') { if (depth === 0) objStart = i; depth++; }
    else if (c === '}') {
      depth--;
      if (depth === 0 && objStart >= 0) {
        try { out.push(JSON.parse(text.slice(objStart, i + 1)) as MemoryEntry); } catch { /* skip */ }
        objStart = -1;
      }
    } else if (c === ']' && depth === 0) break;
  }
  return out;
}

/**
 * Incrementally extracts complete action objects from a streaming JSON string.
 * The model emits { "actions": [ {..}, {..} ], "planDescription": ".." } and we
 * fire each action the instant its closing brace arrives — so blocks appear on
 * the canvas while the model is still writing the rest of the plan.
 */
function makeActionScanner(onAction: (a: Action) => void) {
  let buf = '';
  let started = false; // found where the actions begin
  let done = false;    // hit the closing ] of actions
  /* True when the model skipped the wrapper entirely and is streaming bare
     top-level objects. In that mode there is no closing ']' to stop at. */
  let bare = false;
  let i = 0;
  let depth = 0;
  let inStr = false;
  let esc = false;
  let objStart = -1;

  return (chunk: string) => {
    if (done) { buf += chunk; return; }
    buf += chunk;

    if (!started) {
      const key = buf.indexOf('"actions"');
      let br = key !== -1 ? buf.indexOf('[', key) : -1;
      // ROBUSTNESS: some models ignore the "return {\"actions\":[...]}" rule and
      // emit a BARE array — often behind a "### Actions" header or a ```json
      // fence. Left unhandled, the scanner found no "actions" key, extracted
      // nothing, and the client fell back to echoing the prompt as a heading +
      // sticky (the "why did it just repeat my question" bug). So when there's no
      // wrapper, lock onto the first '[' that begins an array of objects.
      if (br === -1 && key === -1) {
        let p = buf.indexOf('[');
        while (p !== -1) {
          const m = buf.slice(p + 1).match(/^\s*(\S)/);
          if (!m) { p = -1; break; }          // only whitespace so far — wait for more
          if (m[1] === '{') { br = p; break; } // array of objects — start here
          p = buf.indexOf('[', p + 1);         // a non-object array — keep scanning
        }
      }

      if (br !== -1) {
        i = br + 1;
        started = true;
      } else {
        /* NO WRAPPER AND NO ARRAY — just {…}\n{…}\n{…}. Observed live from
           llama-3.1-8b on a link-card build: a perfectly good plan, every
           action valid, and the client executed NOTHING because it was hunting
           for a bracket that never came. That is one of the ways a run ended
           with the board untouched and no explanation. Lock onto the first
           brace that actually begins an action object and stream from there. */
        const brace = buf.indexOf('{');
        if (brace === -1) return;
        if (!/^\s*\{\s*"(?:type|tempId)"\s*:/.test(buf.slice(brace, brace + 40))) {
          // Not an action object (or not enough of it yet) — wait for more.
          if (buf.length - brace > 40) { /* it's something else; keep scanning later chunks */ }
          return;
        }
        i = brace;
        started = true;
        bare = true;
      }
    }

    for (; i < buf.length; i++) {
      const c = buf[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') { inStr = true; continue; }
      if (c === '{') { if (depth === 0) objStart = i; depth++; }
      else if (c === '}') {
        depth--;
        if (depth === 0 && objStart >= 0) {
          const parsed = parseAction(buf.slice(objStart, i + 1));
          if (parsed) onAction(parsed);
          objStart = -1;
        }
      } else if (c === ']' && depth === 0 && !bare) {
        done = true;
        return;
      }
    }
  };
}


/* ── THE ARROW GATE ─────────────────────────────────────────────────────────
   Connectors were the agent's most compulsive habit: it wired arrows between
   blocks on almost every board — reports, notes, dashboards, plain answers —
   where they mean nothing and just make the canvas look scribbled on.

   Prose alone could never fix this. The old prompt already carried a whole
   "CONNECTION DISCIPLINE — connectors are the agent's most OVERUSED tool"
   paragraph and the model drew them anyway, because CREATE_CONNECTION sits
   right there in the action list and joining things up LOOKS like effort. A
   deterministic gate is the only thing that actually holds.

   So: connectors are DROPPED unless this run is genuinely about a flow. That
   means workflow mode, or the user's own words asking for one. Same reasoning
   as the pen — an unasked-for mark the user has to hunt down and delete is
   worse than no mark at all. */
/* Deliberately NOT matching bare "flow", "process", "graph", "tree" or
   "sequence": "the process of photosynthesis", "a bar graph of revenue" and
   "explain the sequence" are ordinary content asks, and letting them through
   re-creates the exact arrow spam this gate exists to stop. Each of those words
   only counts when it is unmistakably about a diagram. */
const WANTS_CONNECTORS_RE =
  /\b(flow ?chart|flow diagram|workflow|work ?flow|process (?:map|diagram|flow)|pipeline|mind ?map|mindmap|diagram|sequence diagram|org ?chart|decision tree|tree diagram|dependenc(?:y|ies)|funnel|user journey|state machine|connect(?:s|ed|ing|ions?)?|link(?:ed|s)? (?:up|together)|arrows?|hierarchy|steps? in order)\b/i;

/* ── THE FRAME GATE ─────────────────────────────────────────────────────────
   The old prompt literally ORDERED this: "COMPREHENSIVE FRAMING: When providing
   a full answer, research summary, or web crawl result, WRAP YOUR ENTIRE ANSWER
   in a frame." So every answer came back boxed, whether or not a box helped.
   Frames are now opt-in the same way connectors are: the user asks for one, or
   it's a workflow (where a phase box per phase IS the diagram). */
/* "board", "section" and "area" are deliberately absent: "build me a board
   about X" and "a report with sections on Y" are how people describe ordinary
   content, not a request for boxes drawn around it. Framing is only allowed
   when the user asked for grouping in so many words — or is reorganising, where
   labelled groups are the whole point. */
const WANTS_FRAMES_RE =
  /\b(frame|frames|framed|box(?:es)? around|group(?:s|ed|ing)?|organi[sz]e|reorgani[sz]e|tidy|clean ?up|categor(?:y|ies|ise|ize|ised|ized)|panel|container|zone)\b/i;

/* ── WHEN TO BUILD IN PARALLEL ──────────────────────────────────────────────
   One model writing one plan is throughput-bound at ~200 chars/second, so when
   a board genuinely needs depth the model writes LESS rather than taking
   longer. Measured before this existed: 22,344 characters of the user's own
   report handed in with "make this more detailed" came back as 12 blocks
   holding 1,984 characters — an 11x COMPRESSION of the thing they asked to
   expand, in 58 seconds. No prompt fixes that; the writing has to happen
   concurrently.

   So a big ask is split into sections by /api/agent/outline and every section
   is written at the same time on a different key. Reserved for asks that
   actually want depth — a short edit gains nothing and would only pay for the
   extra outline round trip. */
const WANTS_DEPTH_RE =
  /\b(detailed?|in depth|in-depth|comprehensive|thorough(?:ly)?|end.to.end|deep.dive|research|full report|complete guide|ultimate guide|everything about|tell me everything|elaborate|expand|more detail|breakdown|break it down|write.?up|study guide|curriculum|syllabus|dossier|whitepaper|exhaustive|long|extensive)\b/i;

/** Enough source material that summarising it would throw away the user's work. */
const BIG_SOURCE_CHARS = 3500;

/* Spread consecutive runs across the key pool.
   Every caller that fires an inline /agent passes apiKeyIndex: 0 (or nothing),
   so the hedge's lead slot always landed on key 1 — two builds started close
   together queued behind each other on one key while four sat idle. The racer
   rotates keys BY SLOT, not by run, so it could never fix this itself. */
let runCounter = 0;

/* The "guaranteed local build" that used to live here is DEAD, deliberately.
   When every model failed it echoed the user's own prompt back onto the canvas
   as a heading + sticky — output-shaped noise that read as the agent
   gaslighting you with your own words (and got reported as a hallucination
   twice). The replacement contract: retry the whole model race once on fresh
   keys, and if that also fails, say so honestly in the status pill and put
   NOTHING fake on the board. */

export default function AgentOverlay() {
  const agentLogs = useCanvasStore((s) => s.agentLogs);
  const agentStatus = useCanvasStore((s) => s.agentStatus);
  const setAgentState = useCanvasStore((s) => s.setAgentState);

  const [expanded, setExpanded] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const runningRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  /** The chat message id (if any) that kicked off the run in flight, so Stop can
   *  resolve its "Building…" chip to error instead of leaving it spinning. */
  const activeSourceIdRef = useRef<string | null>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [agentLogs, expanded]);

  const handleStop = () => {
    runningRef.current = false;
    abortRef.current?.abort();
    window.dispatchEvent(new Event('agent-cursor-hide'));
    // Resolve the chat chip of whatever was building so it doesn't spin forever.
    if (activeSourceIdRef.current && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('agent-build-state', { detail: { sourceId: activeSourceIdRef.current, state: 'error' } }));
      activeSourceIdRef.current = null;
    }
    setAgentState({ agentRunning: false, agentStatus: 'idle', agentLogs: [] });
  };

  const runAgent = useCallback(async (
    promptText: string, keyIdx: number, customX?: number, customY?: number, refContext?: string,
    filesContextArg?: string, briefArg?: string, modeArg?: string, sourceId?: string,
  ) => {
    if (!promptText.trim()) return;

    /* When a build was kicked off from the AI chat panel, report its real
       progress back to that chat message so its "Building this on your canvas…"
       chip resolves to done / error instead of spinning forever. A no-op for
       inline /agent runs (no sourceId). */
    const emitBuildState = (state: 'building' | 'done' | 'error') => {
      if (!sourceId || typeof window === 'undefined') return;
      window.dispatchEvent(new CustomEvent('agent-build-state', { detail: { sourceId, state } }));
    };

    // Another run is already in flight: don't queue a second, but resolve this
    // build's chip so the chat doesn't wait on a run that never starts.
    if (runningRef.current) { emitBuildState('error'); return; }

    const store = useCanvasStore.getState();
    const { camera } = store;
    runningRef.current = true;
    activeSourceIdRef.current = sourceId ?? null;
    // Start each run on a different key so back-to-back builds don't all queue
    // behind each other on key 1 (see runCounter above).
    const keyStart = (keyIdx || 0) + runCounter++;

    const startX = customX ?? (-camera.x + window.innerWidth / 2) / camera.zoom;
    const startY = customY ?? (-camera.y + window.innerHeight / 2) / camera.zoom;

    setAgentState({ agentRunning: true, agentStatus: 'running', agentLogs: ['[Agent] Working...'] });

    const addLog = (line: string) => {
      const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      setAgentState({ agentLogs: [...useCanvasStore.getState().agentLogs, `[${ts}] ${line}`] });
    };
    const live = () => useCanvasStore.getState();

    /* The agent's visible hand (AgentCursor). Every block it touches sends the
       pointer gliding there with a note of what it's doing — the run reads as a
       live collaborator working the board instead of blocks silently popping in. */
    const cursorTo = (cx: number, cy: number, note?: string) => {
      window.dispatchEvent(new CustomEvent('agent-cursor', {
        detail: { x: cx, y: cy, note: note?.replace(/\.{2,}$/, '').replace(/…$/, '') },
      }));
    };
    const cursorHide = () => window.dispatchEvent(new Event('agent-cursor-hide'));
    cursorTo(startX, startY, 'Thinking');

    // Snapshot the canvas level the user is looking at
    const activeParent = resolveParentId(store.canvasStack, store.urlCanvasId);
    const visibleObjects = store.objects.filter((o) => o.parentId === activeParent && !o.style?.isMinimized);
    const visibleIds = new Set(visibleObjects.map((o) => o.id));
    const visibleConnections = store.connections.filter((c) => visibleIds.has(c.fromId) && visibleIds.has(c.toId));

    // Gather text from any File blocks the user dropped so the agent can read
    // them. Use an explicit arg (the file card's "Ask AI" button) if given;
    // otherwise pull from the selected file, else the file(s) nearest to where
    // the agent was invoked. Cap the total so we never blow the model context.
    /* How much of the dropped file(s) the agent actually gets to read.
       This was 26k characters — about twelve pages — so any real document was
       silently cut off a fifth of the way in and the agent answered from the
       opening chapter as if it were the whole book. Every model in the chain
       carries a 128k-token window; 120k characters is roughly 30k tokens, which
       leaves ample room for the system prompt, the canvas snapshot and the reply,
       and lets a normal report, paper or contract go in whole. */
    const FILES_BUDGET = 120_000;
    let filesContext = (filesContextArg || '').slice(0, FILES_BUDGET);
    if (!filesContext) {
      const fileBlocks = visibleObjects.filter(
        (o) => o.style?.isFile && typeof o.style?.fileText === 'string' && (o.style.fileText as string).trim()
      );
      if (fileBlocks.length) {
        const selected = store.selectedId ? fileBlocks.find((o) => o.id === store.selectedId) : undefined;
        const ordered = selected
          ? [selected, ...fileBlocks.filter((o) => o.id !== selected.id)]
          : [...fileBlocks].sort(
              (a, b) => Math.hypot(a.x - startX, a.y - startY) - Math.hypot(b.x - startX, b.y - startY)
            );
        const parts: string[] = [];
        let budget = FILES_BUDGET;
        for (const f of ordered) {
          if (budget <= 200) break;
          const nm = (f.style?.fileName as string) || 'file';
          const body = (f.style?.fileText as string).slice(0, budget - 40);
          const chunk = `FILE: ${nm}\n${body}`;
          parts.push(chunk);
          budget -= chunk.length + 4;
        }
        filesContext = parts.join('\n\n---\n\n');
      }
    }

    // --- shared execution state ---
    const idMap: Record<string, string> = {};
    const resolveId = (id?: string) => (id ? (idMap[id] || id) : '');
    let executed = 0;

    /* --- collision-free layout ---------------------------------------------
       The model supplies layout INTENT (columns, rows, structure); the CLIENT
       guarantees nothing overlaps. This is deterministic on purpose: no amount
       of prompting makes a language model reliably solve 2D packing against
       auto-growing text, so we never trust its coordinates as final.

       Occupancy is keyed by object id (see canvasLayout.Occupancy) so MOVING a
       block updates its footprint instead of leaving a ghost at the old spot —
       and every rect uses the block's MEASURED rendered height, not the nominal
       one it was stored with. Those two facts are what let "organize my canvas"
       (a pile of UPDATE_OBJECT moves) come out clean.

       Frames are backdrops: they neither block nor get pushed, so framed items
       stay inside their frame.

       The whole new build is shifted as one block via `placeOffset`, preserving
       the model's relative structure, then any residual overlap is resolved by
       pushing down. */
    const occupancy = new Occupancy(visibleObjects);
    /** Everything the agent touched — the only blocks the settle pass may move. */
    const touched = new Set<string>();
    let placeOffset: { dx: number; dy: number } | null = null;

    // Collision-free position for a NEW object. Space is reserved by the caller
    // once the object exists and has a real id (so the rect can be re-keyed if
    // the block is later moved).
    const placeFor = (objData: Partial<CanvasObjectData>): { x: number; y: number } => {
      const ix = Math.round(Number(objData.x) || 0);
      const iy = Math.round(Number(objData.y) || 0);

      // Anchor the build: the first block decides how far the WHOLE plan shifts
      // to reach free space, so the model's internal spacing survives intact.
      if (placeOffset === null) {
        const anchor = occupancy.resolveDown(rectOf(objData));
        placeOffset = { dx: anchor.x - ix, dy: anchor.y - iy };
      }

      const shifted = { ...objData, x: ix + placeOffset.dx, y: iy + placeOffset.dy };
      if (isBackdrop(shifted)) return { x: shifted.x, y: shifted.y };

      const free = occupancy.resolveDown(rectOf(shifted));
      return { x: free.x, y: free.y };
    };

    /* Reposition an EXISTING object. This is the path "organize / tidy / group
       this" takes, and until now it wrote the model's raw coordinates straight
       to the store with no collision check at all — which is exactly how blocks
       landed on top of each other during a reorganize. Now a move is packed
       against everything else, using real heights. */
    const moveTo = (obj: CanvasObjectData, next: Partial<CanvasObjectData>): { x: number; y: number } => {
      const merged = { ...obj, ...next };
      occupancy.remove(obj.id); // vacate the old spot before re-packing
      const free = occupancy.resolveDown(rectOf(merged), obj.id);
      occupancy.setRect(obj.id, free);
      return { x: free.x, y: free.y };
    };

    /* While a section writer is streaming, every block it creates is FORCED
       into that section's column. The prompt tells it "x = <columnX> EXACTLY"
       and it mostly complies — but measured live, 3 of 7 writers drifted (one
       column emitting blocks at both x=520 and x=730), which reads as a ragged,
       broken layout. Column alignment is geometry, not judgement, so the client
       decides it. Same reasoning as the arrow gate and the height clamp. */
    let forcedColumnX: number | null = null;

    let panned = false;
    const gentlePan = (o: { x: number; y: number; width: number; height: number }) => {
      // Bring the work into view WITHOUT changing zoom (no zoom in/out).
      if (panned) return;
      panned = true;
      const cam = live().camera;
      const cx = o.x + o.width / 2;
      const cy = o.y + o.height / 2;
      const screenX = cx * cam.zoom + cam.x;
      const screenY = cy * cam.zoom + cam.y;
      const off = screenX < 40 || screenY < 40 || screenX > window.innerWidth - 40 || screenY > window.innerHeight - 40;
      if (off) {
        live().animateCamera({ x: window.innerWidth / 2 - cx * cam.zoom, y: window.innerHeight / 2 - cy * cam.zoom, zoom: cam.zoom }, 450);
      }
    };

    const isHttpUrl = (s: unknown): s is string => typeof s === 'string' && /^https?:\/\//i.test(s);

    /* Decide ONCE, from the user's actual words, whether this run is allowed to
       draw arrows or boxes. Both default to NO — see the gate definitions above
       for why prompting alone never held. `briefArg` and `refContext` are the
       chat/frame handoff, so a build kicked off from a conversation about a
       workflow still gets its connectors. */
    const intentText = `${promptText} ${briefArg || ''} ${(refContext || '').slice(0, 400)}`;
    const allowConnectors = modeArg === 'workflow' || WANTS_CONNECTORS_RE.test(intentText);
    const allowFrames = modeArg === 'workflow' || WANTS_FRAMES_RE.test(intentText);
    let blockedConnectors = 0;
    let blockedFrames = 0;

    /* Fetch a real photo for an image block and drop it in once it resolves, so
       the agent can actually SHOW things from the web.

       When the search comes back empty, the block used to be left sitting there
       as an empty grey "Drop image here" slot — a hole in the board that looks
       like a bug, because it is one. Fall back to GENERATING the picture, and if
       even that fails, take the block away: no image is better than a permanent
       placeholder for one. Non-blocking either way. */
    const resolveImage = async (id: string, query: string) => {
      try {
        const r = await fetch(`/api/image-search?q=${encodeURIComponent(query)}`, { signal: abortRef.current?.signal });
        const j = r.ok ? await r.json() : null;
        if (j?.url) {
          if (runningRef.current) live().updateObject(id, { content: j.url });
          return;
        }
      } catch { /* fall through to the generator */ }

      if (!runningRef.current) return;
      const made = await resolveGenImage(id, query);
      if (!made && runningRef.current) {
        const still = live().objects.find((o) => o.id === id);
        if (still && !still.content) {
          live().removeObject(id);
          occupancy.remove(id);
          touched.delete(id);
        }
      }
    };

    // Geocode a place name and turn the block into a live map centered on it.
    const resolveMap = async (id: string, query: string) => {
      try {
        const r = await fetch(`/api/geocode?q=${encodeURIComponent(query)}&limit=1`, { signal: abortRef.current?.signal });
        if (!r.ok) return;
        const j = await r.json();
        const p = j?.results?.[0];
        if (p && runningRef.current) {
          const existing = live().objects.find((o) => o.id === id);
          live().updateObject(id, {
            content: p.name || p.label || query,
            style: { ...existing?.style, isMap: true, mapLat: p.lat, mapLng: p.lng, mapLabel: p.label, mapName: p.name, mapBbox: p.bbox, mapKind: p.kind },
          });
        }
      } catch { /* leave the block as-is */ }
    };

    /* GENERATE a real image with a strong diffusion model and drop it in once it
       resolves. Stored as a data URL so it persists with the board. Non-blocking.
       Resolves true only if a picture actually landed — the search path leans on
       that to decide whether to clear a block it couldn't fill. */
    const resolveGenImage = async (id: string, prompt: string, style?: string): Promise<boolean> => {
      try {
        const q = `/api/image-generate?q=${encodeURIComponent(prompt)}${style ? `&style=${encodeURIComponent(style)}` : ''}`;
        const r = await fetch(q, { signal: abortRef.current?.signal });
        if (!r.ok) return false;
        const blob = await r.blob();
        if (!/^image\//i.test(blob.type)) return false;
        const dataUrl = await new Promise<string>((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(fr.result as string);
          fr.onerror = rej;
          fr.readAsDataURL(blob);
        });
        if (!runningRef.current) return false;
        live().updateObject(id, { content: dataUrl });
        return true;
      } catch {
        return false;
      }
    };

    /* Every link the agent places gets checked the moment it lands, and a dead
       one is taken away again.

       Validation used to run at the very END of the stream, from a JSON.parse
       that threw on any fenced response — so in practice it never ran, and even
       when it did, its idea of "fixing" a broken link was to leave the card
       sitting there wearing an error state. Neither is what anyone wants: if the
       URL doesn't resolve, the card should not be on the board at all. The links
       that remain are the ones that work. */
    const linkChecks: Promise<void>[] = [];
    const verifyLink = (id: string, rawUrl: string) => {
      const url = normalizeUrl(rawUrl);
      if (!url) return;

      linkChecks.push(
        (async () => {
          try {
            const res = await fetch(`/api/link-validate?url=${encodeURIComponent(url)}`, {
              signal: abortRef.current?.signal,
            });
            if (!res.ok) return; // can't tell — give the link the benefit of the doubt
            const json = await res.json();
            if (json?.valid !== false) return;

            const card = live().objects.find((o) => o.id === id);
            if (!card) return;
            addLog(`[Agent] Dropped a dead link (${json.reason || 'unreachable'}): ${url}`);
            live().removeObject(id);
            occupancy.remove(id);
            touched.delete(id);
          } catch {
            /* validation is best-effort — never take a card away on our own error */
          }
        })()
      );
    };

    const runAction = (action: Action) => {
      try {
        switch (action.type) {
          case 'CREATE_OBJECT': {
            if (!action.objData) break;

            /* The embedded browser is the USER'S tool — they open it from the
               toolbar. The agent must never spawn one: asking it for links should
               hand back link cards, not hijack the canvas with a live browser.
               The prompt forbids it, but a prompt is not a guarantee, so any
               "browser" the model still asks for is rewritten into a link card
               here. Its URL is the one thing worth keeping. */
            let od: Partial<CanvasObjectData> = action.objData;
            // Map widget shorthands ("link", "todo", "chart"…) onto the real
            // type before anything else looks at it.
            const normalized = normalizeType(od.type, (od.style || {}) as Record<string, unknown>);
            if (normalized && normalized !== od.type) {
              od = { ...od, type: normalized as CanvasObjectData['type'] };
            }

            /* An unasked-for frame is just a box drawn around the answer — drop
               it and let the columns speak. Checked AFTER normalization so a
               frame arriving as "group" or "container" is caught too. Its
               children are unaffected and get placed normally. */
            if (od.type === 'frame' && !allowFrames) { blockedFrames++; break; }

            /* SIZE THE BLOCK TO ITS CONTENT, not to whatever number the model
               guessed. Models habitually declare height 400-800 for two lines
               of text; the layout engine honours that (it never shrinks a
               block), so the board came out with vast empty gaps between
               paragraphs. Auto-grow types measure themselves the moment they
               render anyway, so an honest starting height costs nothing and a
               dishonest one costs a hole in the board. */
            if (od.type === 'text' || od.type === 'heading' || od.type === 'sticky' || od.type === 'workflow-node') {
              /* Floors keep the shrink from going ugly: a sticky note holding
                 six words should still look like a note, not a label. */
              const floor = od.type === 'sticky' ? 140 : od.type === 'heading' ? 56 : 60;
              const honest = Math.max(floor, contentHeight(od));
              const declared = Number(od.height) || 0;
              if (declared > honest) od = { ...od, height: honest };
            }

            // Section writers own exactly one column — see forcedColumnX.
            if (forcedColumnX !== null) od = { ...od, x: forcedColumnX };

            if (od.type === 'browser') {
              const target = extractUrl(String(od.content || ''));
              if (!target) break; // a browser with no URL has nothing worth keeping
              const title = od.style?.linkTitle as string | undefined;
              od = {
                ...newLinkCard(target, Number(od.x) || 0, Number(od.y) || 0),
                style: { ...linkPreviewStyle(target), ...(title ? { linkTitle: title } : {}) },
              };
            }

            /* A link card the model wrote by hand carries only isLinkPreview +
               linkUrl (+ maybe a title). Fold in the real link-card style so the
               URL is normalized — the model routinely drops the scheme, and
               "youtube.com/watch?v=X" is not a fetchable target — and so the
               card starts in its loading state and hydrates its own thumbnail.
               The model's title/description survive as placeholders until the
               real metadata lands. */
            if (od.type === 'card' && od.style?.isLinkPreview && od.style?.linkUrl) {
              const raw = String(od.style.linkUrl);
              od = {
                ...od,
                width: Number(od.width) || LINK_CARD_SIZE.width,
                height: Number(od.height) || LINK_CARD_SIZE.height,
                style: { ...od.style, ...linkPreviewStyle(raw) },
              };
            }

            const pos = placeFor(od);
            const style = (od.style || {}) as Record<string, unknown>;
            const isImg = od.type === 'image';
            // Images: keep a real URL as-is. Otherwise decide GENERATE (AI makes a
            // new picture) vs SEARCH (fetch a real photo from the web), blank the
            // content now and resolve it asynchronously.
            const genPrompt = isImg && !isHttpUrl(od.content)
              ? ((style.imagePrompt as string) || (style.generate ? (style.imageQuery as string) || od.content || '' : ''))
              : '';
            const wantsGen = isImg && Boolean(genPrompt && (style.generate || style.imagePrompt));
            const imageQuery = isImg && !wantsGen && !isHttpUrl(od.content)
              ? ((style.imageQuery as string) || od.content || '')
              : '';
            const startContent = isImg && !isHttpUrl(od.content) ? '' : (od.content || '');
            const spawned = live().addObject({
              type: od.type,
              x: pos.x, y: pos.y,
              width: od.width, height: od.height,
              content: startContent,
              style,
            });
            if (action.tempId) idMap[action.tempId] = spawned.id;
            // Reserve its footprint under the REAL id, so if a later action moves
            // this block the old rect is vacated instead of haunting the board.
            occupancy.set(spawned);
            touched.add(spawned.id);
            // Kick off async media resolution (image generate / search / geocoding).
            if (wantsGen && genPrompt.trim()) {
              void resolveGenImage(spawned.id, genPrompt.trim(), style.imageStyle as string | undefined);
            } else if (imageQuery.trim()) {
              void resolveImage(spawned.id, imageQuery.trim());
            }
            // Check the link the moment the card lands. A dead one is removed
            // again before the run finishes, so it never survives on the board.
            if (od.type === 'card' && style.isLinkPreview && typeof style.linkUrl === 'string') {
              verifyLink(spawned.id, style.linkUrl);
            }
            if (od.type === 'card' && style.isMap && !style.mapLat && typeof style.mapQuery === 'string' && style.mapQuery.trim()) {
              void resolveMap(spawned.id, (style.mapQuery as string).trim());
            }
            executed++;
            cursorTo(
              pos.x + Math.min(48, (Number(od.width) || 200) / 2),
              pos.y + Math.min(36, (Number(od.height) || 100) / 2),
              action.log,
            );
            gentlePan({ x: pos.x, y: pos.y, width: Number(od.width) || 200, height: Number(od.height) || 100 });
            break;
          }
          case 'UPDATE_OBJECT': {
            const targetId = resolveId(action.id);
            const updates = action.updates || action.objData;
            if (!targetId || !updates) break;
            const existing = live().objects.find((o) => o.id === targetId);
            if (!existing) break;

            const merged: Partial<CanvasObjectData> = {
              ...updates,
              style: updates.style ? { ...existing.style, ...updates.style } : existing.style,
            };

            // A MOVE (this is what "organize / tidy / group my canvas" is made
            // of) gets packed against the rest of the board, with real heights,
            // exactly like a new block would. The model's coordinates are its
            // INTENT — the ordering and grouping it wants — not the last word on
            // where the block physically lands.
            const wantsMove = updates.x !== undefined || updates.y !== undefined;
            if (wantsMove && !isBackdrop(existing)) {
              const pos = moveTo(existing, merged);
              merged.x = pos.x;
              merged.y = pos.y;
            } else if (wantsMove) {
              merged.x = Math.round(Number(updates.x ?? existing.x));
              merged.y = Math.round(Number(updates.y ?? existing.y));
            }

            live().updateObject(targetId, merged);
            touched.add(targetId);
            // Content or size changed → the block's real footprint changed too.
            if (!wantsMove) occupancy.set({ ...existing, ...merged });
            executed++;
            cursorTo(Number(merged.x ?? existing.x) + 40, Number(merged.y ?? existing.y) + 28, action.log);
            break;
          }
          case 'DELETE_OBJECT': {
            const targetId = resolveId(action.id);
            const doomed = targetId ? live().objects.find((o) => o.id === targetId) : undefined;
            if (doomed) {
              cursorTo(doomed.x + 40, doomed.y + 28, action.log);
              live().removeObject(targetId);
              occupancy.remove(targetId); // its space is free again
              touched.delete(targetId);
              executed++;
            }
            break;
          }
          case 'CREATE_CONNECTION': {
            if (!allowConnectors) { blockedConnectors++; break; }
            const fromId = resolveId(action.fromId);
            const toId = resolveId(action.toId);
            const objs = live().objects;
            const fromObj = objs.find((o) => o.id === fromId);
            const toObj = objs.find((o) => o.id === toId);
            if (fromObj && toObj) {
              live().addConnection(fromId, toId, action.style || {});
              executed++;
              cursorTo(
                (fromObj.x + fromObj.width / 2 + toObj.x + toObj.width / 2) / 2,
                (fromObj.y + fromObj.height / 2 + toObj.y + toObj.height / 2) / 2,
                action.log,
              );
            }
            break;
          }
          case 'DELETE_CONNECTION': {
            const connId = action.connectionId || action.id;
            if (connId) { live().removeConnection(connId); executed++; }
            break;
          }
          case 'CREATE_SCENE': {
            const zoom = Math.min(2, Math.max(0.15, Number(action.zoom) || 0.8));
            const cx = isFinite(Number(action.x)) ? Number(action.x) : startX;
            const cy = isFinite(Number(action.y)) ? Number(action.y) : startY;
            live().addSceneWithCamera(action.name || `Scene ${live().scenes.length + 1}`, {
              x: window.innerWidth / 2 - cx * zoom,
              y: window.innerHeight / 2 - cy * zoom,
              zoom,
            }, undefined, action.notes);
            executed++;
            break;
          }
        }
        if (action.log) addLog(action.log);
      } catch (e) {
        console.warn('[Agent] action failed', e);
      }
    };

    /* --- final settle -------------------------------------------------------
       The last word on layout. Everything above packs blocks using ESTIMATED
       heights, because a block's true height isn't knowable until it has
       rendered. By now it has: React has committed, every text/heading/sticky
       has measured itself through the ResizeObserver in CanvasObject and grown
       to its real size.

       So re-run the de-overlap against those real measurements and fix whatever
       the estimate got wrong. Only blocks the agent itself touched may move —
       the user's untouched work never shifts under them. Then re-fit any frame
       the agent drew so its backdrop still contains its (now taller) contents.

       This is what makes "no text over text" a guarantee rather than a hope. */
    const settleLayout = () => {
      if (touched.size === 0) return;

      // Two frames out: let the store commit and the ResizeObservers report the
      // heights of anything that just grew.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const state = useCanvasStore.getState();
        const board = state.objects.filter(
          (o) => o.parentId === activeParent && !o.style?.isMinimized
        );

        const moves = settle(board, touched);
        for (const m of moves) state.updateObject(m.id, { x: m.x, y: m.y });

        if (moves.length) {
          console.debug(`[Agent] settle: nudged ${moves.length} block(s) clear of an overlap`);
        }

        // Re-fit the agent's frames around their (settled, real-height) contents.
        const after = useCanvasStore.getState().objects.filter(
          (o) => o.parentId === activeParent && !o.style?.isMinimized
        );
        for (const frame of after) {
          if (frame.type !== 'frame' || !touched.has(frame.id)) continue;
          const inside = after.filter(
            (o) =>
              o.id !== frame.id &&
              o.type !== 'frame' &&
              o.x >= frame.x - 24 &&
              o.y >= frame.y - 24 &&
              o.x < frame.x + frame.width + 24 &&
              o.y < frame.y + frame.height + 24
          );
          const fit = fitFrame(frame, inside);
          if (fit) useCanvasStore.getState().updateObject(frame.id, fit);
        }
      }));
    };

    const finishSuccess = () => {
      settleLayout();
      cursorHide();
      if (blockedConnectors || blockedFrames) {
        console.debug(
          `[Agent] gate: dropped ${blockedConnectors} unrequested connector(s), ${blockedFrames} unrequested frame(s)`
        );
      }
      addLog('[Success] Done.');
      setAgentState({ agentStatus: 'success', agentRunning: false });
      runningRef.current = false;
      emitBuildState('done');
      activeSourceIdRef.current = null;
      setTimeout(() => {
        if (useCanvasStore.getState().agentStatus === 'success') setAgentState({ agentStatus: 'idle', agentLogs: [] });
      }, 2200);
    };

    /* Honest failure: the real reason in the status pill, and the build chip
       resolved to error.
       NOTHING IS PUT ON THE CANVAS. This used to drop a red sticky note at the
       agent's spot, which meant a failed run left litter the user had to find
       and delete by hand — a failure that damages the board is worse than one
       that simply reports itself. The pill says what happened; the canvas stays
       exactly as the user left it. */
    const failRun = (msg: string) => {
      cursorHide();
      addLog(`[Failure] ${msg}`);
      setAgentState({ agentStatus: 'failed', agentRunning: false });
      runningRef.current = false;
      emitBuildState('error');
      activeSourceIdRef.current = null;
      setTimeout(() => {
        if (useCanvasStore.getState().agentStatus === 'failed') setAgentState({ agentStatus: 'idle', agentLogs: [] });
      }, 6000);
    };

    try {
      const controller = new AbortController();
      abortRef.current = controller;

      /* --- Context pre-passes: ALL CONCURRENT, ALL HARD-CAPPED --------------
         Vision, URL crawling, memory, search, weather, wiki, news, youtube… are
         best-effort garnish — none of them is worth stalling the build for. They
         used to run with NO deadline at all (and vision + crawling ran SERIALLY
         before the rest), so a single hanging upstream held "Gathering context…"
         hostage for minutes. Now every source runs in ONE parallel batch on a
         shared abort signal with a hard deadline: whatever answered in time
         ships with the prompt, the rest are cut loose mid-flight. The user's
         Stop button aborts through the same wire. */
      /* Two tiers of deadline. PRIMARY sources (vision, the URLs the user
         pasted, memory, verified YouTube results a video ask depends on) get the
         full window — they ARE the material. GARNISH (search/wiki/news/quotes/…)
         is nice-to-have seasoning.

         Both were cut hard. This whole phase runs BEFORE the model is even
         called, so its deadline is pure dead time added to every single run —
         and the garnish triggers are so broad ("about", "today", "update",
         "best", "how to", "recent") that a plain build fires two or three
         lookups it never needed and then waited on them. 8s/4.5s of that, on
         top of a build, is a large part of why the canvas agent felt slow next
         to chat, which does none of this at all. A source that can't answer in
         2.5s wasn't going to change the board much anyway. */
      const CONTEXT_DEADLINE_MS = 5000;
      const GARNISH_DEADLINE_MS = 2500;
      const ctxController = new AbortController();
      const garnishController = new AbortController();
      const onMainAbort = () => { ctxController.abort(); garnishController.abort(); };
      controller.signal.addEventListener('abort', onMainAbort);
      const ctxTimer = setTimeout(() => { ctxController.abort(); garnishController.abort(); }, CONTEXT_DEADLINE_MS);
      const garnishTimer = setTimeout(() => garnishController.abort(), GARNISH_DEADLINE_MS);
      const sig = ctxController.signal;
      const gsig = garnishController.signal;

      let visionContext: string | undefined;
      let webContext: string | undefined;
      let memoriesContext: string | undefined;
      let searchContext: string | undefined;
      let weatherContext: string | undefined;
      let dictContext: string | undefined;
      let wikiContext: string | undefined;
      let newsContext: string | undefined;
      let youtubeContext: string | undefined;
      let quotesContext: string | undefined;
      let countryContext: string | undefined;
      let triviaContext: string | undefined;

      /* ── OUTLINE, STARTED EARLY ────────────────────────────────────────────
         The planning pass gates every section writer, so its latency is felt
         directly. But it only needs the prompt and the material the user
         already handed over — none of which comes from the context lookups
         below. So fire it NOW, alongside them, and by the time the context
         batch settles the outline is usually already in hand. On the common
         path this makes planning cost nothing in wall-clock time at all. */
      const depthWanted =
        modeArg !== 'workflow' &&
        (WANTS_DEPTH_RE.test(promptText) ||
          (refContext || '').length > BIG_SOURCE_CHARS ||
          filesContext.length > BIG_SOURCE_CHARS);

      const outlineCtl = new AbortController();
      const onOutlineAbort = () => outlineCtl.abort();
      controller.signal.addEventListener('abort', onOutlineAbort);
      const outlineTimer = depthWanted ? setTimeout(() => outlineCtl.abort(), 16_000) : undefined;
      const skillsetForRun = formatSkillsetForAgent(store.skillset) || undefined;
      const outlinePromise: Promise<{ boardTitle: string; sections: { title: string; brief: string; widgets: string[] }[] } | null> =
        depthWanted
          ? (async () => {
            try {
              const r = await fetch('/api/agent/outline', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  prompt: promptText,
                  context: refContext,
                  filesContext: filesContext || undefined,
                  skillsetContext: skillsetForRun,
                  apiKeyIndex: keyStart,
                }),
                signal: outlineCtl.signal,
              });
              if (!r.ok) return null;
              const j = await r.json();
              if (j?.success && Array.isArray(j.sections) && j.sections.length >= 3) {
                return { boardTitle: String(j.boardTitle || ''), sections: j.sections };
              }
              return null;
            } catch {
              return null;
            }
          })()
          : Promise.resolve(null);

      const pLower = promptText.toLowerCase();
      const wantsYouTube = /\b(youtube|video|song|music|listen to|watch|play|track|album|artist|singer|band|clip|trailer|mv|music video|remix|cover|live performance)\b/i.test(pLower);
      const pre: Promise<void>[] = [];
      const ctxStart = Date.now();
      addLog('[Agent] Gathering context…');

      // VISION — if the task is about an image the user placed, LOOK at it so
      // any caption/description is grounded in what the picture actually shows.
      if (isImageTask(promptText)) {
        const isImg = (o?: CanvasObjectData) =>
          !!o && (o.type === 'image' || (typeof o.content === 'string' && o.content.startsWith('data:image')));
        const selected = store.selectedId ? live().objects.find((o) => o.id === store.selectedId) : undefined;
        let target: CanvasObjectData | undefined = isImg(selected) ? selected : undefined;
        if (!target) {
          const imgs = visibleObjects.filter(isImg);
          if (imgs.length) {
            target = imgs.reduce((best, o) =>
              Math.hypot(o.x - startX, o.y - startY) < Math.hypot(best.x - startX, best.y - startY) ? o : best
            );
          }
        }
        const vt = target && typeof target.content === 'string' && target.content.startsWith('data:image') ? target : undefined;
        if (vt) {
          pre.push((async () => {
            try {
              const small = await downscaleImage(vt.content);
              const vres = await fetch('/api/vision', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: small }),
                signal: sig,
              });
              if (vres.ok) {
                const vjson = await vres.json();
                if (vjson?.description) {
                  visionContext = `Image at (x:${Math.round(vt.x)}, y:${Math.round(vt.y)}, ${Math.round(vt.width)}x${Math.round(vt.height)}) shows: ${vjson.description}`;
                }
              }
            } catch { /* vision is best-effort — proceed without it */ }
          })());
        }
      }

      // URL CRAWL — if the user pasted URL(s), fetch them ALL in parallel so the
      // agent works from the real pages ("read this", "summarize this docs page").
      const urlsInPrompt = Array.from(
        new Set((promptText.match(/https?:\/\/[^\s)]+/gi) || []).map((u) => u.replace(/[.,]+$/, '')))
      ).slice(0, 3);
      const crawlSlots: (string | null)[] = urlsInPrompt.map(() => null);
      urlsInPrompt.forEach((u, idx) => {
        pre.push((async () => {
          try {
            const r = await fetch(`/api/fetch-url?url=${encodeURIComponent(u)}`, { signal: sig });
            if (r.ok) {
              const j = await r.json();
              if (j?.text) crawlSlots[idx] = `URL: ${j.url || u}\nTITLE: ${j.title || ''}\n${j.text}`;
            }
          } catch { /* skip a page that won't load */ }
        })());
      });

      // Memory (always)
      pre.push((async () => {
        try {
          const memRes = await fetch('/api/agent/memory?action=get', { signal: sig });
          if (memRes.ok) {
            const memJson = await memRes.json();
            if (memJson.success && memJson.memories?.length) {
              memoriesContext = memJson.memories.map((m: { key: string; value: string }) => `- ${m.key}: ${m.value}`).join('\n');
            }
          }
        } catch { /* best effort */ }
      })());

      // wantsYouTube also fires a plain web search (link redundancy for video
      // asks) — IN the batch, not as a sequential tail after it.
      if (wantsYouTube || /\b(search|find|google|look up|who is|what is|how to|best|top|compare|vs|versus|recommend|review|list of|examples of|alternatives|how much|price|cost|where can i|when did|why does|which is)\b/i.test(pLower)) {
        pre.push((async () => {
          try {
            const sRes = await fetch(`/api/web-search?q=${encodeURIComponent(promptText)}`, { signal: gsig });
            if (sRes.ok) {
              const sJson = await sRes.json();
              if (sJson.success && sJson.results?.length) {
                searchContext = sJson.results.map((r: { url: string; title: string; snippet: string }) => `URL: ${r.url}\nTITLE: ${r.title}\nSNIPPET: ${r.snippet}`).join('\n\n');
              }
            }
          } catch { /* best effort */ }
        })());
      }

      if (/\b(weather|temperature|forecast|climate|rain|snow|humidity|wind)\b/i.test(pLower)) {
        pre.push((async () => {
          try {
            const match = promptText.match(/(?:in|at|for) ([a-zA-Z\s,]+)/i);
            const q = match ? match[1].trim() : promptText;
            const wRes = await fetch(`/api/weather?q=${encodeURIComponent(q)}`, { signal: gsig });
            if (wRes.ok) {
              const wJson = await wRes.json();
              if (!wJson.error) {
                weatherContext = `Location: ${wJson.location?.name}, ${wJson.location?.country}\nTemp: ${wJson.current?.temperature}${wJson.units?.temperature}, ${wJson.current?.condition}`;
              }
            }
          } catch { /* best effort */ }
        })());
      }

      if (/\b(meaning|define|definition|synonym|dictionary|antonym|word meaning)\b/i.test(pLower)) {
        pre.push((async () => {
          try {
            const match = promptText.match(/(?:define|meaning of|definition of|what does .* mean) ([a-zA-Z]+)/i);
            const w = match ? match[1].trim() : promptText.split(' ').pop() || '';
            const dRes = await fetch(`/api/dictionary?word=${encodeURIComponent(w)}`, { signal: gsig });
            if (dRes.ok) {
              const dJson = await dRes.json();
              if (dJson.success && dJson.results?.length) dictContext = JSON.stringify(dJson.results, null, 2);
            }
          } catch { /* best effort */ }
        })());
      }

      if (/\b(wiki|wikipedia|who is|who was|history of|biography|about|origin of|founded|inventor|discovery|explain .* concept)\b/i.test(pLower)) {
        pre.push((async () => {
          try {
            const match = promptText.match(/(?:who is|who was|what is|history of|biography of|about|wikipedia|origin of|explain) ([a-zA-Z0-9\s]+)/i);
            const q = match ? match[1].trim() : promptText;
            const wikiRes = await fetch(`/api/wikipedia?q=${encodeURIComponent(q)}`, { signal: gsig });
            if (wikiRes.ok) {
              const wikiJson = await wikiRes.json();
              if (wikiJson.success) wikiContext = `TITLE: ${wikiJson.title}\nSUMMARY: ${wikiJson.summary}\nURL: ${wikiJson.url}`;
            }
          } catch { /* best effort */ }
        })());
      }

      /* "update" and "today" used to be in here, so "update this note" or "add
         today's tasks" fired a news lookup and then waited on it. A news fetch
         now needs an actual news word. */
      if (/\b(news|breaking|headlines|current events|trending|latest on|recent developments|what'?s happening)\b/i.test(pLower)) {
        pre.push((async () => {
          try {
            const match = promptText.match(/(?:news about|latest on|headlines for|update on|trending) ([a-zA-Z0-9\s]+)/i);
            const q = match ? match[1].trim() : undefined;
            const nRes = await fetch(`/api/news${q ? `?q=${encodeURIComponent(q)}` : ''}`, { signal: gsig });
            if (nRes.ok) {
              const nJson = await nRes.json();
              if (nJson.success && nJson.results?.length) {
                newsContext = nJson.results.map((r: { url: string; title: string; snippet: string }) => `URL: ${r.url}\nTITLE: ${r.title}\nSNIPPET: ${r.snippet}`).join('\n\n');
              }
            }
          } catch { /* best effort */ }
        })());
      }

      if (wantsYouTube) {
        pre.push((async () => {
          try {
            // Hand the endpoint the prompt verbatim (intent=1) so it distills the
            // real search terms itself instead of a lossy stop-word strip.
            const yRes = await fetch(`/api/youtube-search?q=${encodeURIComponent(promptText)}&intent=1&limit=5`, { signal: sig });
            if (yRes.ok) {
              const yJson = await yRes.json();
              if (yJson.success && yJson.results?.length) {
                youtubeContext = yJson.results
                  .map((r: { url: string; title: string; author: string }, i: number) =>
                    `Result ${i + 1}: ${r.url}\n  TITLE: ${r.title}\n  CHANNEL: ${r.author}`)
                  .join('\n');
              }
            }
          } catch { /* best effort */ }
        })());
      }

      if (/\b(quote|quotes|inspire|inspiration|motivation|motivational|words of wisdom|famous saying|wise words)\b/i.test(pLower)) {
        pre.push((async () => {
          try {
            const qRes = await fetch(`/api/quotes-search?limit=5`, { signal: gsig });
            if (qRes.ok) {
              const qJson = await qRes.json();
              if (qJson.success && qJson.results?.length) {
                quotesContext = qJson.results.map((q: { text: string; author: string }) => `"${q.text}" — ${q.author}`).join('\n\n');
              }
            }
          } catch { /* best effort */ }
        })());
      }

      if (/\b(country|capital of|population of|flag of|currency of|language of|languages in|about .* country)\b/i.test(pLower)) {
        pre.push((async () => {
          try {
            const match = promptText.match(/(?:about|country|capital of|population of|flag of|currency of|language of|languages in) ([a-zA-Z\s]+)/i);
            const q = match ? match[1].trim() : promptText;
            const cRes = await fetch(`/api/country-info?q=${encodeURIComponent(q)}`, { signal: gsig });
            if (cRes.ok) {
              const cJson = await cRes.json();
              if (cJson.success && cJson.results?.length) {
                countryContext = cJson.results.map((c: Record<string, string>) => `${c.name} (${c.official})\nCapital: ${c.capital}\nPopulation: ${c.population}\nRegion: ${c.region}, ${c.subregion}\nLanguages: ${c.languages}\nCurrencies: ${c.currencies}\nArea: ${c.area}\nTimezones: ${c.timezones}`).join('\n\n');
              }
            }
          } catch { /* best effort */ }
        })());
      }

      if (/\b(trivia|quiz|fun fact|random fact|did you know|brain teaser)\b/i.test(pLower)) {
        pre.push((async () => {
          try {
            const tRes = await fetch(`/api/trivia?amount=5`, { signal: gsig });
            if (tRes.ok) {
              const tJson = await tRes.json();
              if (tJson.success && tJson.results?.length) {
                triviaContext = tJson.results.map((t: { question: string; correct_answer: string; category: string }) => `Q: ${t.question}\nA: ${t.correct_answer}\nCategory: ${t.category}`).join('\n\n');
              }
            }
          } catch { /* best effort */ }
        })());
      }

      await Promise.all(pre);
      clearTimeout(ctxTimer);
      clearTimeout(garnishTimer);
      controller.signal.removeEventListener('abort', onMainAbort);
      {
        const crawled = crawlSlots.filter((s): s is string => Boolean(s));
        if (crawled.length) webContext = crawled.join('\n\n----------\n\n').slice(0, 24_000);
      }
      addLog(`[Agent] Context ready in ${((Date.now() - ctxStart) / 1000).toFixed(1)}s — thinking…`);
      if (!runningRef.current) return;

      const requestBody = {
        prompt: promptText,
        agentX: startX, agentY: startY,
        context: refContext,
        brief: briefArg,
        mode: modeArg,
        visionContext,
        webContext,
        memoriesContext,
        searchContext,
        weatherContext,
        dictContext,
        wikiContext,
        newsContext,
        youtubeContext,
        quotesContext,
        countryContext,
        triviaContext,
        filesContext: filesContext || undefined,
        // Per-canvas Skill Set — standing rules the agent must obey here.
        skillsetContext: formatSkillsetForAgent(store.skillset) || undefined,
        canvas: {
          isDark: store.canvasBackground.dark,
          // Send the height each block ACTUALLY renders at, not the nominal one
          // it was stored with. A note created as height:120 that grew to 600px
          // of text has to look 600px tall to the model, or it plans the next
          // block 200px down — straight through the middle of the note.
          objects: visibleObjects.map((o) => ({
            id: o.id, type: o.type, x: o.x, y: o.y,
            width: o.width, height: Math.round(rectOf(o).h), content: o.content, style: o.style,
          })),
          connections: visibleConnections.map((c) => ({ id: c.id, fromId: c.fromId, toId: c.toId })),
        },
      };

      /* ── PARALLEL SECTION BUILD ────────────────────────────────────────────
         For an ask that genuinely wants depth, split the board and write every
         column AT THE SAME TIME on a different key. See WANTS_DEPTH_RE above
         for the measurement that forced this.

         Strictly bounded, because the two-phase "Director" that was removed
         from this codebase in 2026-07 failed exactly here: it made the user
         WAIT on a planning round trip before anything appeared. Two things stop
         that repeating: the outline is fired EARLY, in parallel with the
         context lookups, so on the common path it is already in hand by the
         time we get here and costs nothing; and it carries a hard deadline
         after which ANY problem — slow, malformed, too few sections — falls
         silently through to the ordinary single-pass build below. The user can
         only ever end up with the old behaviour or better, never with a stall. */
      const buildInParallel = async (): Promise<boolean> => {
        // Started back before the context lookups — usually already resolved.
        const outline = await outlinePromise;
        if (outlineTimer !== undefined) clearTimeout(outlineTimer);
        controller.signal.removeEventListener('abort', onOutlineAbort);

        if (!runningRef.current) return true;
        if (!outline || outline.sections.length < 3) return false; // single pass
        const { sections, boardTitle } = outline;

        /* Reserve the whole band up front so the columns land together in free
           space, then give each writer an absolute column. Because the writers
           get real world coordinates, the per-run placeOffset must be neutral —
           otherwise every section would be shifted twice. */
        const COL_STEP = 520;
        const bandW = COL_STEP * sections.length;
        const anchor = occupancy.resolveDown({ x: Math.round(startX), y: Math.round(startY), w: bandW, h: 320 });
        placeOffset = { dx: 0, dy: 0 };

        let headY = anchor.y;
        if (boardTitle) {
          const titleObj = live().addObject({
            type: 'heading', x: anchor.x, y: anchor.y,
            width: Math.min(900, bandW - 60), height: 64,
            content: boardTitle, style: {},
          });
          occupancy.set(titleObj);
          touched.add(titleObj.id);
          executed++;
          headY = anchor.y + 110;
          cursorTo(anchor.x + 40, anchor.y + 28, 'Titling the board');
          gentlePan({ x: anchor.x, y: anchor.y, width: 400, height: 64 });
        }

        addLog(`[Agent] Writing ${sections.length} sections at once…`);

        const writeSection = async (sec: { title: string; brief: string; widgets: string[] }, i: number, keyBump: number): Promise<number> => {
          const colX = anchor.x + i * COL_STEP;
          try {
            const res = await fetch('/api/agent/run', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ...requestBody,
                mode: 'section',
                sectionTitle: sec.title,
                sectionBrief: sec.brief,
                sectionWidgets: sec.widgets,
                columnX: colX,
                columnY: headY,
                // Each writer starts on its OWN key so the columns are written
                // in genuine parallel instead of queueing on one worker.
                apiKeyIndex: keyStart + i + keyBump,
                canvas: { isDark: store.canvasBackground.dark, objects: [], connections: [] },
              }),
              signal: controller.signal,
            });
            if (!res.ok || !res.body) return 0;
            let n = 0;
            const scan = makeActionScanner((action) => {
              if (!runningRef.current) return;
              /* Bind every block this writer produces to its own column. Set
                 immediately before each action runs (not around the whole
                 await) because sibling writers interleave at every await
                 point — a value held across one would be the wrong column's. */
              forcedColumnX = colX;
              try { runAction(action); } finally { forcedColumnX = null; }
              n++;
            });
            const reader = res.body.getReader();
            const dec = new TextDecoder();
            /* STRAGGLER BOUND. The board is only finished when its slowest
               column is, so one unlucky writer holds up everything. Measured
               live on a congested tier: a single section took 339 SECONDS while
               its siblings finished in 38-50s, turning a 50s board into a
               405s one. Past this deadline the writer is cut loose — whatever
               it already streamed is on the canvas and keeps its place. */
            const cutoff = Date.now() + 75_000;
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (!runningRef.current) { reader.cancel(); break; }
              scan(dec.decode(value, { stream: true }));
              if (Date.now() > cutoff) {
                console.debug(`[Agent] section "${sec.title}" hit the 75s bound with ${n} block(s) — moving on`);
                reader.cancel();
                break;
              }
            }
            return n;
          } catch {
            return 0;
          }
        };

        /* A section that comes back with nothing is a piece of the user's
           request silently missing from the board — the exact failure this
           design exists to prevent (observed live: one writer of seven returned
           an unusable stream and its column was simply absent). So each writer
           retries ITSELF once, on a different key.

           Retrying inside the writer rather than after Promise.all matters:
           a retry pass bolted on afterwards runs only once every sibling has
           finished, adding its full duration to the wall clock. Measured that
           way it cost ~48s on top of a 55s board. Here it overlaps with the
           siblings still writing, so a failure costs almost nothing. */
        const results = await Promise.all(sections.map(async (sec, i) => {
          const n = await writeSection(sec, i, 0);
          if (n > 0 || !runningRef.current) return n;
          addLog(`[Agent] Rewriting "${sec.title}"…`);
          return writeSection(sec, i, 2);
        }));

        const built = results.reduce((a, b) => a + b, 0);
        const stillEmpty = results.filter((n) => n === 0).length;
        if (stillEmpty) console.debug(`[Agent] ${stillEmpty}/${sections.length} section(s) never landed`);
        // Any section landing is a usable board; none landing means fall back.
        return built > 0;
      };

      if (depthWanted) {
        const ok = await buildInParallel();
        if (!runningRef.current) return;
        if (ok) {
          if (linkChecks.length) {
            await Promise.race([Promise.all(linkChecks), new Promise<void>((r) => setTimeout(r, 6000))]);
          }
          if (!runningRef.current) return;
          finishSuccess();
          return;
        }
        addLog('[Agent] Building it in one pass instead…');
      }

      /* --- call the model & stream the plan, with ONE automatic retry --------
         A hedged race can still lose an unlucky round to tier congestion (every
         slot stalling past its deadline), and rarely a model streams JSON the
         scanner can't use. Both used to end in the prompt-echo fallback. Now a
         failed or empty round is re-raced ONCE on a rotated key alignment — a
         fresh round usually lands on warmer workers. Returns true when this
         round produced actions (or the user stopped — nothing left to do). */
      let fullResponse = '';
      /* Why the round failed, so the user is told the TRUTH instead of a
         blanket "models are busy". The route classifies its own failures
         (oversized / rate-limit / gone / timeout) and some of them — an
         over-long prompt above all — can never be fixed by trying again. */
      let failKind = '';
      let failMessage = '';
      const streamPlanRound = async (keyOffset: number): Promise<boolean> => {
        const res = await fetch('/api/agent/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...requestBody, apiKeyIndex: keyStart + keyOffset }),
          signal: controller.signal,
        });
        if (!runningRef.current) return true; // stopped — don't retry
        if (!res.ok || !res.body) {
          try {
            const j = await res.json();
            failKind = String(j?.kind || '');
            failMessage = String(j?.error || '');
          } catch { /* not JSON — fall back to the generic message */ }
          return false;
        }

        // Stream the plan; execute each action the instant it completes.
        const scan = makeActionScanner((action) => { if (runningRef.current) runAction(action); });
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        const roundStart = Date.now();
        fullResponse = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!runningRef.current) { reader.cancel(); return true; }
          const chunk = decoder.decode(value, { stream: true });
          fullResponse += chunk;
          scan(chunk);
          /* DUD-ROUND WATCHDOG. A real plan puts "actions" FIRST, so its first
             action completes within the first couple thousand characters. A
             model that instead streams PROSE (live-verified: llama-70b answered
             a heavy build with a 97-second markdown essay — zero actions) would
             otherwise hold this loop hostage to the very end. If we're several
             thousand chars or 45s in with NOTHING parsed, the round is a dud —
             cut it loose and let the retry (or the honest failure) take over. */
          if (executed === 0 && (fullResponse.length > 6000 || Date.now() - roundStart > 45_000)) {
            reader.cancel();
            return false;
          }
        }
        return executed > 0;
      };

      let planOk = await streamPlanRound(0);
      /* Retry ONLY what a retry can actually fix. The old code re-sent a byte
         -identical body on a different key even when the first round failed
         because the prompt was too big for the context window — which 400s the
         same way every time, on every key, and just doubled the wait before
         showing a message that blamed "busy models" for a size problem. */
      const retryable = !failKind || failKind === 'timeout' || failKind === 'rate-limit' || failKind === 'upstream';
      if (!planOk && runningRef.current && retryable) {
        addLog('[Agent] First attempt came back empty — re-racing on different keys…');
        planOk = await streamPlanRound(2); // rotate two keys forward, not just one
      }
      if (!runningRef.current) return;
      if (!planOk) {
        failRun(
          failMessage ||
          'No model returned a usable plan — nothing was built, and your board is untouched. Try again in a moment.'
        );
        return;
      }

      // Every link card fired off its own check the moment it landed (verifyLink).
      // Let those finish before we call the run done, so a dead card is gone from
      // the board before the user is told the agent is finished — but NEVER let a
      // slow validator hold the whole run hostage (that's a big part of the "it
      // just sits there saying building" feeling). Cap the wait; any late failure
      // still removes its own card when it resolves.
      if (linkChecks.length) {
        addLog('[Agent] Checking every link works…');
        await Promise.race([
          Promise.all(linkChecks),
          new Promise<void>((resolve) => setTimeout(resolve, 6000)),
        ]);
      }

      if (!runningRef.current) return;

      // After streaming is done, process memory instructions
      try {
        /* Extract the memories array on its own rather than parsing the whole
           document. Measured across every model on the tier, a whole-document
           JSON.parse of a real plan FAILS almost every time — a stray escape
           anywhere in thousands of characters of content is enough, and one
           always turns up. So this branch silently never ran and the agent has
           not saved a memory in a long time. The streaming scanner never cared
           (it hunts the actions array brace by brace), which is why the board
           still built and this stayed invisible. Now memories are pulled out
           with the same tolerant, per-object scan the actions get. */
        const payload = { memories: extractMemories(stripCodeFence(fullResponse)) };

        if (payload.memories && Array.isArray(payload.memories)) {
          for (const mem of payload.memories) {
            if (mem.forget) {
              await fetch('/api/agent/memory', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'delete', key: mem.forget }),
              });
            } else if (mem.key && mem.value) {
              await fetch('/api/agent/memory', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'set', key: mem.key, value: mem.value, category: mem.category || 'fact' }),
              });
            }
          }
        }
      } catch (err) {
        console.warn('[Agent] Post-processing failed', err);
      }

      if (!runningRef.current) return;

      finishSuccess(); // planOk guaranteed executed > 0 above
    } catch (err) {
      if (!runningRef.current) return; // user stopped
      console.error('[Agent]', err);
      // A partial board still deserves its settle pass; an empty run fails honestly.
      if (executed === 0) failRun('Something went wrong mid-run — nothing was built. Try again.');
      else finishSuccess();
    }
  }, [setAgentState]);

  // Inline "/agent <task>" launches arrive as run-agent window events
  useEffect(() => {
    const handleRunEvent = (e: Event) => {
      const ce = e as CustomEvent<{ prompt: string; apiKeyIndex?: number; x?: number; y?: number; context?: string; filesContext?: string; brief?: string; mode?: string; sourceId?: string }>;
      const { prompt: p, apiKeyIndex: ki, x, y, context, filesContext, brief, mode, sourceId } = ce.detail;
      runAgent(p, ki ?? 0, x, y, context, filesContext, brief, mode, sourceId);
    };
    window.addEventListener('run-agent', handleRunEvent);
    return () => window.removeEventListener('run-agent', handleRunEvent);
  }, [runAgent]);

  const latestLog = agentLogs.length > 0 ? agentLogs[agentLogs.length - 1] : '';
  const latestText = latestLog.replace(/^\[\d{2}:\d{2}:\d{2}(?:\s?[AP]M)?\]\s*/i, '');

  return (
    <AnimatePresence>
      {agentStatus !== 'idle' && (
        <motion.div
          className="fixed top-5 left-1/2 z-[250]"
          initial={{ y: -24, x: '-50%', opacity: 0 }}
          animate={{ y: 0, x: '-50%', opacity: 1 }}
          exit={{ y: -24, x: '-50%', opacity: 0 }}
          transition={{ type: 'spring', damping: 22, stiffness: 260 }}
        >
          <div
            className="flex flex-col rounded-full border border-white/10 shadow-lg overflow-hidden"
            style={{
              background: 'rgba(23, 20, 18, 0.88)',
              backdropFilter: 'blur(14px)',
              borderRadius: expanded ? 14 : 999,
              maxWidth: 420,
            }}
          >
            <div
              className="pl-3 pr-2 py-1.5 flex items-center gap-2.5 cursor-pointer select-none"
              onClick={() => setExpanded((v) => !v)}
              title="Click to see details"
            >
              <span className="relative shrink-0 flex items-center justify-center w-2 h-2">
                {agentStatus === 'running' && (
                  <span className="absolute inline-flex h-2 w-2 rounded-full bg-indigo-400 opacity-75 animate-ping" />
                )}
                <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${
                  agentStatus === 'running' ? 'bg-indigo-400' : agentStatus === 'success' ? 'bg-emerald-400' : 'bg-red-400'
                }`} />
              </span>

              <span className="text-[11px] text-zinc-200 font-light truncate max-w-[300px]">
                {agentStatus === 'failed' ? latestText || 'Agent failed' : latestText || 'Working...'}
              </span>

              {agentStatus === 'running' && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleStop(); }}
                  className="p-1 rounded-full text-zinc-500 hover:text-red-400 hover:bg-white/5 transition-colors cursor-pointer border-none bg-transparent flex items-center"
                  title="Stop agent"
                >
                  <StopIcon size={9} />
                </button>
              )}
            </div>

            <AnimatePresence>
              {expanded && (
                <motion.div
                  className="border-t border-white/5 bg-black/30 overflow-hidden"
                  initial={{ height: 0 }}
                  animate={{ height: 120 }}
                  exit={{ height: 0 }}
                >
                  <div className="px-3 py-2 h-full overflow-y-auto font-mono text-[9px] text-zinc-400 flex flex-col gap-0.5 text-left select-text">
                    {agentLogs.map((log, idx) => {
                      let color = 'text-zinc-500';
                      if (log.includes('[Success]')) color = 'text-emerald-400';
                      else if (log.includes('[Failure]') || log.includes('[Error]')) color = 'text-red-400';
                      else if (log.includes('[Agent]')) color = 'text-indigo-400';
                      return <div key={idx} className={color}>{log}</div>;
                    })}
                    <div ref={logEndRef} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
