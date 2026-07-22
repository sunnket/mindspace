import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { useCanvasStore, resolveParentId } from '@/store/canvasStore';
import { useAuthStore } from '@/store/authStore';
import { formatSkillsetForAgent } from '@/lib/skillset';
import {
  AgentChatMessage,
  ChatAttachmentMeta,
  extractDroppedFile,
  loadThread,
  saveLocal,
  saveMessage,
  updateMessageContent,
  clearThread as clearThreadService,
} from '@/lib/agentChat/service';

/** A dropped file / canvas block waiting to be sent with the next message. */
export interface PendingAttachment {
  id: string;
  name: string;
  kind: 'file' | 'image' | 'block';
  size?: number;
  /** Text the agent should read (file text or a block's content). */
  text: string;
}

const BUILD_MARKER = '⟦BUILD⟧';

/** Split a finished assistant reply into the visible prose and an optional build. */
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
  try {
    const obj = JSON.parse(rest.slice(start, end + 1));
    if (obj && typeof obj.instruction === 'string' && obj.instruction.trim()) {
      return { visible, build: { instruction: obj.instruction.trim(), mode: obj.mode === 'workflow' ? 'workflow' : 'default' } };
    }
  } catch {
    /* malformed directive — just show the prose */
  }
  return { visible, build: null };
}

/** A compact text snapshot of the visible board so the chat model has awareness. */
function buildCanvasContext(): string {
  const store = useCanvasStore.getState();
  const activeParent = resolveParentId(store.canvasStack, store.urlCanvasId);
  const objs = store.objects.filter((o) => o.parentId === activeParent && !o.style?.isMinimized);
  if (objs.length === 0) return '';
  const cam = store.camera;
  const cx = (-cam.x + (typeof window !== 'undefined' ? window.innerWidth : 1200) / 2) / cam.zoom;
  const cy = (-cam.y + (typeof window !== 'undefined' ? window.innerHeight : 800) / 2) / cam.zoom;
  const near = [...objs].sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy)).slice(0, 60);
  const rows = near.map((o) => {
    const s = o.style || {};
    let label = (o.content || '').replace(/\s+/g, ' ').slice(0, 160);
    if (s.isRepo) label = `[code repo: ${(s.repoName as string) || 'repo'}]`;
    else if (s.isTodo) label = `[todo: ${(s.todoTitle as string) || 'tasks'}]`;
    else if (s.isChart) label = `[chart: ${(s.chartTitle as string) || o.type}]`;
    else if (s.isCode) label = `[code] ${label}`;
    else if (o.type === 'image') label = '[image]';
    else if (s.isFile) label = `[file: ${(s.fileName as string) || 'file'}]`;
    return { id: o.id, type: o.type, x: Math.round(o.x), y: Math.round(o.y), w: Math.round(o.width), h: Math.round(o.height), text: label };
  });
  return JSON.stringify(rows);
}

function currentCanvasId(): string {
  const store = useCanvasStore.getState();
  const stack = store.canvasStack;
  return stack.length > 0 ? stack[stack.length - 1] : (store.urlCanvasId || 'root');
}

interface AgentChatState {
  canvasId: string;
  panelOpen: boolean;
  maximized: boolean;
  width: number;
  messagesByCanvas: Record<string, AgentChatMessage[]>;
  loadingByCanvas: Record<string, boolean>;
  streaming: boolean;
  pending: PendingAttachment[];
  error: string | null;

  open: () => void;
  close: () => void;
  toggle: () => void;
  setMaximized: (v: boolean) => void;
  setWidth: (w: number) => void;
  syncCanvas: (id: string) => Promise<void>;

  addFiles: (files: FileList | File[]) => Promise<void>;
  addBlockContext: (label: string, content: string) => void;
  removePending: (id: string) => void;

  send: (text: string) => Promise<void>;
  stop: () => void;
  clear: () => Promise<void>;
  /** Update the live build status of the message that kicked off a canvas build.
   *  Driven by `agent-build-state` events the canvas agent dispatches. */
  setBuildState: (messageId: string, state: 'building' | 'done' | 'error') => void;
}

let abortController: AbortController | null = null;

export const useAgentChatStore = create<AgentChatState>((set, get) => ({
  canvasId: 'root',
  panelOpen: false,
  maximized: false,
  width: 440,
  messagesByCanvas: {},
  loadingByCanvas: {},
  streaming: false,
  pending: [],
  error: null,

  open: () => { set({ panelOpen: true }); void get().syncCanvas(currentCanvasId()); },
  close: () => set({ panelOpen: false }),
  toggle: () => { const willOpen = !get().panelOpen; set({ panelOpen: willOpen }); if (willOpen) void get().syncCanvas(currentCanvasId()); },
  setMaximized: (maximized) => set({ maximized }),
  setWidth: (width) => set({ width: Math.max(360, Math.min(880, width)) }),

  syncCanvas: async (id) => {
    const canvasId = id || 'root';
    if (get().canvasId === canvasId && get().messagesByCanvas[canvasId]) { set({ canvasId }); return; }
    set({ canvasId });
    if (get().messagesByCanvas[canvasId]) return; // already loaded this session
    set((s) => ({ loadingByCanvas: { ...s.loadingByCanvas, [canvasId]: true } }));
    const userId = useAuthStore.getState().user?.id || null;
    const msgs = await loadThread(canvasId, userId);
    set((s) => ({
      messagesByCanvas: { ...s.messagesByCanvas, [canvasId]: msgs },
      loadingByCanvas: { ...s.loadingByCanvas, [canvasId]: false },
    }));
  },

  addFiles: async (files) => {
    const arr = Array.from(files as ArrayLike<File>);
    for (const file of arr) {
      const extracted = await extractDroppedFile(file);
      set((s) => ({
        pending: [...s.pending, {
          id: uuidv4(), name: extracted.name, kind: extracted.kind, size: extracted.size,
          text: extracted.text,
        }],
      }));
    }
  },

  addBlockContext: (label, content) => {
    set((s) => ({
      pending: [...s.pending, { id: uuidv4(), name: label || 'canvas block', kind: 'block', text: (content || '').slice(0, 20_000) }],
    }));
    if (!get().panelOpen) get().open();
  },

  removePending: (id) => set((s) => ({ pending: s.pending.filter((p) => p.id !== id) })),

  stop: () => {
    abortController?.abort();
    abortController = null;
    set({ streaming: false });
  },

  send: async (rawText) => {
    const text = rawText.trim();
    const pending = get().pending;
    if ((!text && pending.length === 0) || get().streaming) return;

    const canvasId = get().canvasId || 'root';
    const userId = useAuthStore.getState().user?.id || null;

    const attachMeta: ChatAttachmentMeta[] = pending.map((p) => ({ name: p.name, kind: p.kind, size: p.size }));
    const userMsg: AgentChatMessage = {
      id: uuidv4(), role: 'user',
      content: text || (pending.length ? `(shared ${pending.length} item${pending.length > 1 ? 's' : ''})` : ''),
      createdAt: Date.now(),
      attachments: attachMeta.length ? attachMeta : undefined,
    };

    // Assemble the file/block context the model reads (not shown in the bubble).
    const filesContext = pending
      .filter((p) => p.text && p.text.trim())
      .map((p) => `${p.kind === 'block' ? 'CANVAS BLOCK' : 'FILE'}: ${p.name}\n${p.text}`)
      .join('\n\n---\n\n');

    const asstId = uuidv4();
    const asstMsg: AgentChatMessage = { id: asstId, role: 'assistant', content: '', createdAt: Date.now() + 1, streaming: true };

    const prevList = get().messagesByCanvas[canvasId] || [];
    const nextList = [...prevList, userMsg, asstMsg];
    set((s) => ({
      messagesByCanvas: { ...s.messagesByCanvas, [canvasId]: nextList },
      streaming: true, pending: [], error: null,
    }));

    // Persist the user turn (cloud when signed in; local otherwise). The empty
    // streaming assistant bubble is deliberately NOT saved yet — only its final
    // content is, once the stream finishes.
    void saveMessage(canvasId, userId, userMsg);
    if (!userId) saveLocal(canvasId, [...prevList, userMsg]);

    const updateAsst = (patch: Partial<AgentChatMessage>) => {
      set((s) => ({
        messagesByCanvas: {
          ...s.messagesByCanvas,
          [canvasId]: (s.messagesByCanvas[canvasId] || []).map((m) => (m.id === asstId ? { ...m, ...patch } : m)),
        },
      }));
    };

    const historyForApi = prevList
      .filter((m) => !m.streaming)
      .map((m) => ({ role: m.role, content: m.content }))
      .concat([{ role: 'user' as const, content: text || '(see attached)' }]);

    abortController = new AbortController();
    let full = '';
    try {
      const res = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: historyForApi,
          canvasContext: buildCanvasContext(),
          filesContext: filesContext || undefined,
          skillsetContext: formatSkillsetForAgent(useCanvasStore.getState().skillset) || undefined,
        }),
        signal: abortController.signal,
      });

      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Chat failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        full += decoder.decode(value, { stream: true });
        // Live display hides anything from the build marker onward.
        const visibleNow = full.includes(BUILD_MARKER) ? full.slice(0, full.indexOf(BUILD_MARKER)).trimEnd() : full;
        updateAsst({ content: visibleNow });
      }

      const { visible, build } = parseBuild(full);
      const finalContent = visible || (build ? 'On it — building that on your canvas now.' : '…');
      updateAsst({ content: finalContent, streaming: false, built: !!build, buildState: build ? 'building' : undefined });

      // Persist the finished assistant turn.
      const finalMsg: AgentChatMessage = { id: asstId, role: 'assistant', content: finalContent, createdAt: asstMsg.createdAt, built: !!build };
      if (userId) void saveMessage(canvasId, userId, finalMsg);
      else saveLocal(canvasId, get().messagesByCanvas[canvasId] || []);

      set({ streaming: false });
      abortController = null;

      // Fire the canvas build through the existing agent pipeline.
      if (build && typeof window !== 'undefined') {
        const cam = useCanvasStore.getState().camera;
        const x = (-cam.x + window.innerWidth / 2) / cam.zoom;
        const y = (-cam.y + window.innerHeight / 2) / cam.zoom;
        // Ground the builder in the ACTUAL answer we just wrote. The builder never
        // sees this chat, so a thin or referential instruction ("put the report
        // above on the canvas") otherwise leaves it to invent a topic from the
        // canvas snapshot — which is exactly how a media report turned into a
        // "your canvas has 2 objects" meta-report. Hand over the real content as
        // source material; the instruction just says how to lay it out.
        const clean = (visible || '').replace(/\s+/g, ' ').trim();
        const grounding = clean.length > 120 ? visible.slice(0, 14000) : undefined;
        window.dispatchEvent(new CustomEvent('run-agent', {
          // sourceId lets the canvas agent report this build's real progress back
          // to THIS chat message, so the "Building…" chip resolves to done/error.
          detail: { prompt: build.instruction, x, y, mode: build.mode, context: grounding, filesContext: filesContext || undefined, sourceId: asstId },
        }));
      }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        updateAsst({ content: (full && full.split(BUILD_MARKER)[0].trim()) || '(stopped)', streaming: false });
        set({ streaming: false });
        return;
      }
      const message = (err as Error)?.message || 'Something went wrong.';
      updateAsst({ content: `⚠️ ${message}`, streaming: false });
      set({ streaming: false, error: message });
      abortController = null;
    }
  },

  clear: async () => {
    const canvasId = get().canvasId || 'root';
    const userId = useAuthStore.getState().user?.id || null;
    set((s) => ({ messagesByCanvas: { ...s.messagesByCanvas, [canvasId]: [] } }));
    await clearThreadService(canvasId, userId);
  },

  setBuildState: (messageId, state) => set((s) => {
    // The message could live under any canvas thread (the user may have switched
    // boards while the build ran), so scan them all and patch the one match.
    const next: Record<string, AgentChatMessage[]> = { ...s.messagesByCanvas };
    let changed = false;
    for (const cid of Object.keys(next)) {
      const list = next[cid];
      if (!list.some((m) => m.id === messageId)) continue;
      next[cid] = list.map((m) => (m.id === messageId ? { ...m, buildState: state, built: true } : m));
      changed = true;
    }
    return changed ? { messagesByCanvas: next } : {};
  }),
}));
