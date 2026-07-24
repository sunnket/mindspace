import { create } from 'zustand';
import { useCanvasStore } from '@/store/canvasStore';
import { formatSkillsetForAgent } from '@/lib/skillset';
import { collectRegion, buildRegionDigest, describeRegionImages, imagesInRegion } from '@/lib/frameContext';

/**
 * The brain behind an "Ask AI" frame.
 *
 * Asking a question about a region is a three-stage job, and the UI shows all
 * three because the middle one is slow enough that silence reads as a hang:
 *
 *   1. read    — slice the board down to the frame and unpack every block
 *   2. look    — send the region's images to the vision model (parallel)
 *   3. answer  — stream the reply, and forward any build directive to the
 *                existing canvas agent so the AI can actually edit the region
 *
 * Sessions are keyed by frame id, so each frame keeps its own thread and a
 * follow-up like "and the second one?" still makes sense.
 */

const BUILD_MARKER = '⟦BUILD⟧';

/* A model sometimes emits a ⟦BUILD⟧ with a non-instruction — "None", "N/A",
   "awaiting user input", a bare dash — usually when it's really asking a
   question or offering options but bolts a directive on out of habit. Left
   unguarded, that placeholder reaches the canvas agent as a real build prompt
   and it dutifully renders garbage. Reject anything that isn't an actual
   instruction so a question stays a question. */
function isRealInstruction(instr: string): boolean {
  const s = instr.trim();
  if (s.length < 8) return false;
  return !/^(none|n\/?a|tbd|todo|pending|await|awaiting|null|undefined|no build|no change|[-—.]+)\b/i.test(s);
}

/** Does this reply end by asking the user something? */
function endsWithQuestion(text: string): boolean {
  const t = (text || '').trim();
  if (!t) return false;
  const lastLine = t.split('\n').map((l) => l.trim()).filter(Boolean).pop() || '';
  return /\?[)\]"'*_\s]*$/.test(lastLine);
}

export type FrameAgentStatus = 'idle' | 'reading' | 'looking' | 'thinking' | 'error';

export interface FrameTurn {
  role: 'user' | 'assistant';
  content: string;
  /** Set when this answer also kicked off a change to the canvas. */
  built?: boolean;
}

export interface FrameSession {
  turns: FrameTurn[];
  draft: string;
  status: FrameAgentStatus;
  error: string | null;
  /** Vision progress, so "Looking at 2/5 images…" is honest. */
  visionDone: number;
  visionTotal: number;
}

const emptySession = (): FrameSession => ({
  turns: [], draft: '', status: 'idle', error: null, visionDone: 0, visionTotal: 0,
});

/** Split a finished reply into the visible prose and an optional build directive. */
function parseBuild(full: string): { visible: string; build: { instruction: string; mode: string } | null } {
  const idx = full.indexOf(BUILD_MARKER);
  if (idx === -1) return { visible: full.trim(), build: null };
  const visible = full.slice(0, idx).replace(/```\s*$/, '').trim();
  const rest = full.slice(idx + BUILD_MARKER.length);
  const start = rest.indexOf('{');
  if (start === -1) return { visible, build: null };
  // Balanced-brace scan so trailing prose/fences after the JSON don't break it.
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let i = start; i < rest.length; i++) {
    const c = rest[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) return { visible, build: null };
  // A reply that ends by asking the user something is a clarification, not a
  // build — don't fire a directive the model bolted on anyway.
  if (endsWithQuestion(visible)) return { visible, build: null };
  try {
    const obj = JSON.parse(rest.slice(start, end + 1));
    if (obj && typeof obj.instruction === 'string' && isRealInstruction(obj.instruction)) {
      return {
        visible,
        build: { instruction: obj.instruction.trim(), mode: obj.mode === 'workflow' ? 'workflow' : 'default' },
      };
    }
  } catch {
    /* malformed directive — just show the prose */
  }
  return { visible, build: null };
}

interface FrameAgentState {
  sessions: Record<string, FrameSession>;
  session: (frameId: string) => FrameSession;
  setDraft: (frameId: string, draft: string) => void;
  ask: (frameId: string, question: string) => Promise<void>;
  stop: () => void;
  reset: (frameId: string) => void;
}

let abortController: AbortController | null = null;

export const useFrameAgentStore = create<FrameAgentState>((set, get) => ({
  sessions: {},

  session: (frameId) => get().sessions[frameId] || emptySession(),

  setDraft: (frameId, draft) =>
    set((s) => ({
      sessions: { ...s.sessions, [frameId]: { ...(s.sessions[frameId] || emptySession()), draft } },
    })),

  reset: (frameId) =>
    set((s) => ({ sessions: { ...s.sessions, [frameId]: emptySession() } })),

  stop: () => {
    abortController?.abort();
    abortController = null;
  },

  ask: async (frameId, rawQuestion) => {
    const question = rawQuestion.trim();
    if (!question) return;

    const patch = (p: Partial<FrameSession>) =>
      set((s) => ({
        sessions: { ...s.sessions, [frameId]: { ...(s.sessions[frameId] || emptySession()), ...p } },
      }));

    const current = get().session(frameId);
    if (current.status !== 'idle' && current.status !== 'error') return;

    const canvas = useCanvasStore.getState();
    const frame = canvas.objects.find((o) => o.id === frameId && o.type === 'frame');
    if (!frame) return;

    const priorTurns = current.turns;
    const turns: FrameTurn[] = [...priorTurns, { role: 'user', content: question }, { role: 'assistant', content: '' }];
    patch({ turns, draft: '', status: 'reading', error: null, visionDone: 0, visionTotal: 0 });

    const updateAnswer = (content: string, extra: Partial<FrameTurn> = {}) =>
      set((s) => {
        const sess = s.sessions[frameId] || emptySession();
        const next = [...sess.turns];
        const last = next[next.length - 1];
        // Clearing the thread mid-stream drops the turn we were writing into —
        // don't resurrect it (and never index into an empty array).
        if (!last || last.role !== 'assistant') return {};
        next[next.length - 1] = { role: 'assistant', content, ...extra };
        return { sessions: { ...s.sessions, [frameId]: { ...sess, turns: next } } };
      });

    abortController = new AbortController();
    const signal = abortController.signal;

    try {
      // 1. READ — slice the board down to this frame.
      let region = collectRegion(frame, canvas.objects, canvas.strokes, canvas.connections);

      /* A dropped file only gets its text pulled when someone opens it, so a
         PDF sitting untouched inside the frame would reach the model as
         "Contents: not extracted" — the exact opposite of the promise an agent
         frame makes. Force the extraction first, then re-slice so the digest
         carries the real text. */
      const unread = region.objects.filter(
        (o) => o.style?.isFile && o.style?.fileTextStatus !== 'ready',
      );
      if (unread.length > 0) {
        const { extractTextForBlock } = await import('@/lib/fileIngest');
        await Promise.all(unread.map((o) => extractTextForBlock(o.id).catch(() => '')));
        const fresh = useCanvasStore.getState();
        const freshFrame = fresh.objects.find((o) => o.id === frameId) || frame;
        region = collectRegion(freshFrame, fresh.objects, fresh.strokes, fresh.connections);
      }

      // 2. LOOK — describe the region's images so the agent isn't blind to them.
      const imageCount = imagesInRegion(region).length;
      let visionById: Record<string, string> = {};
      if (imageCount > 0) {
        patch({ status: 'looking', visionTotal: imageCount, visionDone: 0 });
        visionById = await describeRegionImages(region, signal, (done, total) =>
          patch({ visionDone: done, visionTotal: total }),
        );
      }
      if (signal.aborted) throw new DOMException('aborted', 'AbortError');

      const regionContext = buildRegionDigest(region, visionById);

      // 3. ANSWER.
      patch({ status: 'thinking' });
      const history = [
        ...priorTurns.filter((t) => t.content).map((t) => ({ role: t.role, content: t.content })),
        { role: 'user' as const, content: question },
      ];

      const res = await fetch('/api/agent/frame', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: history,
          regionContext,
          skillsetContext: formatSkillsetForAgent(canvas.skillset) || undefined,
        }),
        signal,
      });

      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `The frame agent failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        full += decoder.decode(value, { stream: true });
        // Hide the build directive from the live view as it streams in.
        const visibleNow = full.includes(BUILD_MARKER) ? full.slice(0, full.indexOf(BUILD_MARKER)).trimEnd() : full;
        updateAnswer(visibleNow);
      }

      const { visible, build } = parseBuild(full);
      const finalContent = visible || (build ? 'On it — updating this frame now.' : '…');
      updateAnswer(finalContent, { built: !!build });
      patch({ status: 'idle' });
      abortController = null;

      // Hand any change over to the existing canvas agent, which owns the
      // create/update/move execution — the frame agent decides WHAT, not HOW.
      if (build && typeof window !== 'undefined') {
        const live = useCanvasStore.getState().objects.find((o) => o.id === frameId);
        const anchor = live || frame;
        window.dispatchEvent(new CustomEvent('run-agent', {
          detail: {
            prompt: build.instruction,
            // New work lands just below the frame instead of on top of what's
            // already inside it.
            x: anchor.x,
            y: anchor.y + anchor.height + 48,
            mode: build.mode,
            // The builder gets the region verbatim, so edits to existing blocks
            // are grounded in their real ids and real current text.
            context: `${visible}\n\n--- THE FRAMED REGION THIS REFERS TO ---\n${regionContext}`.slice(0, 14_000),
          },
        }));
      }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        updateAnswer('(stopped)');
        patch({ status: 'idle' });
        abortController = null;
        return;
      }
      const message = (err as Error)?.message || 'Something went wrong.';
      updateAnswer(`⚠️ ${message}`);
      patch({ status: 'error', error: message });
      abortController = null;
    }
  },
}));
