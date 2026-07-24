import { supabase } from '@/lib/supabaseClient';

/**
 * Agent chat persistence — per-canvas conversation between the user and the AI
 * canvas agent.
 *
 * Signed in  → Supabase (`agent_chat_messages`), synced across devices.
 * Signed out → localStorage, keyed per canvas.
 *
 * The service degrades gracefully: if the Supabase table doesn't exist yet (the
 * migration hasn't been run) or any cloud call fails, it silently falls back to
 * localStorage so the feature works immediately regardless.
 */

export type ChatRole = 'user' | 'assistant';

/** Display-only attachment metadata shown on a message bubble. */
export interface ChatAttachmentMeta {
  name: string;
  kind: 'file' | 'image' | 'block';
  size?: number;
}

export interface AgentChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
  attachments?: ChatAttachmentMeta[];
  /** Client-only: set true while an assistant reply is still streaming. */
  streaming?: boolean;
  /** Client-only: a canvas build this message kicked off (for the "Building…" chip). */
  built?: boolean;
  /** Client-only: live status of the canvas build this message kicked off, so the
   *  chip stops saying "Building…" forever and flips to done / error for real. */
  buildState?: 'building' | 'done' | 'error';
}

const LOCAL_PREFIX = 'mindspace:agentchat:';
const LOCAL_CAP = 200; // messages kept per canvas locally

function localKey(canvasId: string): string {
  return `${LOCAL_PREFIX}${canvasId || 'root'}`;
}

export function loadLocal(canvasId: string): AgentChatMessage[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(localKey(canvasId));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function saveLocal(canvasId: string, messages: AgentChatMessage[]): void {
  if (typeof window === 'undefined') return;
  try {
    // Strip live-only flags before persisting. `buildState` is a session-only
    // progress indicator — persisting "building" would make a reloaded message
    // spin forever — so drop it; `built` is kept so a past build still reads as
    // "Built on your canvas".
    const clean = messages
      .slice(-LOCAL_CAP)
      .map(({ streaming, buildState, ...m }) => m); // eslint-disable-line @typescript-eslint/no-unused-vars
    window.localStorage.setItem(localKey(canvasId), JSON.stringify(clean));
  } catch {
    /* quota / serialization — best effort */
  }
}

export function clearLocal(canvasId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(localKey(canvasId));
  } catch {
    /* ignore */
  }
}

interface CloudRow {
  id: string;
  role: ChatRole;
  content: string;
  attachments: ChatAttachmentMeta[] | null;
  created_at: number;
}

/** Load the thread for a canvas. Cloud when a userId is given, else local. */
export async function loadThread(canvasId: string, userId: string | null): Promise<AgentChatMessage[]> {
  if (!userId) return loadLocal(canvasId);
  try {
    const { data, error } = await supabase
      .from('agent_chat_messages')
      .select('id, role, content, attachments, created_at')
      .eq('user_id', userId)
      .eq('canvas_id', canvasId || 'root')
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data as CloudRow[] | null || []).map((r) => ({
      id: r.id,
      role: r.role,
      content: r.content,
      createdAt: r.created_at,
      attachments: r.attachments || undefined,
    }));
  } catch (err) {
    console.warn('[agentChat] cloud load failed, using local:', err);
    return loadLocal(canvasId);
  }
}

/** Persist a single message (cloud when signed in). Best-effort. */
export async function saveMessage(
  canvasId: string,
  userId: string | null,
  msg: AgentChatMessage,
): Promise<void> {
  if (!userId) return; // local snapshots are written wholesale by the store
  try {
    const { error } = await supabase.from('agent_chat_messages').insert({
      id: msg.id,
      user_id: userId,
      canvas_id: canvasId || 'root',
      role: msg.role,
      content: msg.content,
      attachments: msg.attachments || [],
      created_at: msg.createdAt,
    });
    if (error) throw error;
  } catch (err) {
    console.warn('[agentChat] cloud save failed:', err);
  }
}

/** Update a message's content (used once an assistant stream finishes). */
export async function updateMessageContent(
  userId: string | null,
  id: string,
  content: string,
): Promise<void> {
  if (!userId) return;
  try {
    await supabase.from('agent_chat_messages').update({ content }).eq('id', id).eq('user_id', userId);
  } catch (err) {
    console.warn('[agentChat] cloud update failed:', err);
  }
}

/** Wipe a canvas thread. */
export async function clearThread(canvasId: string, userId: string | null): Promise<void> {
  clearLocal(canvasId);
  if (!userId) return;
  try {
    await supabase
      .from('agent_chat_messages')
      .delete()
      .eq('user_id', userId)
      .eq('canvas_id', canvasId || 'root');
  } catch (err) {
    console.warn('[agentChat] cloud clear failed:', err);
  }
}

/* ------------------------------------------------------------------ *
 *  Dropped-file text extraction (so the agent can read what you drop
 *  into the chat). Text-like files are read in the browser; everything
 *  else goes through the existing /api/file-extract route.
 * ------------------------------------------------------------------ */

const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|log|json|jsonl|ya?ml|xml|html?|css|scss|less|js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|c|h|cpp|cc|hpp|cs|php|swift|sh|bash|sql|r|lua|pl|dart|vue|svelte|toml|ini|env|graphql|gql|proto)$/i;

export interface ExtractedFile {
  name: string;
  kind: 'file' | 'image';
  size: number;
  /** Extracted text, capped. Empty for images / unreadable files. */
  text: string;
}

const PER_FILE_TEXT_CAP = 60_000;

export async function extractDroppedFile(file: File): Promise<ExtractedFile> {
  const base: ExtractedFile = {
    name: file.name || 'file',
    kind: file.type.startsWith('image/') ? 'image' : 'file',
    size: file.size,
    text: '',
  };
  if (base.kind === 'image') return base;

  // Read text-like files directly — no server round-trip.
  if (TEXT_EXT.test(file.name) || file.type.startsWith('text/')) {
    try {
      base.text = (await file.text()).slice(0, PER_FILE_TEXT_CAP);
      return base;
    } catch {
      return base;
    }
  }

  // Everything else (pdf / docx / pptx / xlsx …) → server extraction.
  try {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/file-extract', { method: 'POST', body: form });
    if (res.ok) {
      const data = await res.json();
      base.text = (data.text || '').slice(0, PER_FILE_TEXT_CAP);
    }
  } catch {
    /* best effort — the agent just won't have this file's text */
  }
  return base;
}
