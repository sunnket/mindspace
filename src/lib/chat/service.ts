import { v4 as uuidv4 } from 'uuid';
import { supabase } from '@/lib/supabaseClient';

export const ATTACHMENTS_BUCKET = 'chat-attachments';
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // 25MB

export interface ProfileResult {
  id: string;
  username: string;
}

export interface ChatAttachment {
  name: string;
  mime: string;
  size: number;
  path: string;
  kind: 'image' | 'video' | 'file';
}

export interface ChatRoomRow {
  id: string;
  user_a: string;
  user_b: string;
  created_at: number;
  last_message_at: number | null;
  last_message_preview: string | null;
}

export interface ChatMessage {
  id: string;
  roomId: string;
  senderId: string;
  body: string;
  createdAt: number;
  editedAt?: number | null;
  deleted?: boolean;
  attachments?: ChatAttachment[];
}

function rowToMessage(row: {
  id: string; room_id: string; sender_id: string; body: string;
  created_at: number; edited_at: number | null; deleted: boolean | null;
  attachments: ChatAttachment[] | null;
}): ChatMessage {
  return {
    id: row.id,
    roomId: row.room_id,
    senderId: row.sender_id,
    body: row.body,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    deleted: !!row.deleted,
    attachments: row.attachments || [],
  };
}

function attachmentKind(mime: string): ChatAttachment['kind'] {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  return 'file';
}

export function attachmentPreviewText(attachments: ChatAttachment[]): string {
  const first = attachments[0];
  if (!first) return '';
  if (first.kind === 'image') return '📷 Photo';
  if (first.kind === 'video') return '🎬 Video';
  return `📎 ${first.name}`;
}

/** Uploads a file to the room's private attachment folder. `messageId` must
 * be the id the caller will use for the chat_messages row this attaches to
 * (generated up front by the caller) so the storage path and the message
 * that references it line up. */
export async function uploadAttachment(roomId: string, messageId: string, file: File): Promise<ChatAttachment> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`"${file.name}" is too large — max ${Math.floor(MAX_ATTACHMENT_BYTES / (1024 * 1024))}MB.`);
  }
  const safeName = file.name.replace(/[^\w.\-]+/g, '_') || 'file';
  const path = `${roomId}/${messageId}/${safeName}`;
  const { error } = await supabase.storage.from(ATTACHMENTS_BUCKET).upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  });
  if (error) throw error;
  return {
    name: file.name,
    mime: file.type || 'application/octet-stream',
    size: file.size,
    path,
    kind: attachmentKind(file.type || ''),
  };
}

/** Short-lived signed URL for a private attachment — safe to call every render. */
export async function getAttachmentUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(ATTACHMENTS_BUCKET).createSignedUrl(path, 3600);
  if (error) {
    console.error('[chat] getAttachmentUrl failed:', error);
    return null;
  }
  return data?.signedUrl || null;
}

export async function searchUsers(query: string): Promise<ProfileResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const { data, error } = await supabase.rpc('search_profiles', { query: trimmed });
  if (error) {
    console.error('[chat] searchUsers failed:', error);
    return [];
  }
  return (data || []) as ProfileResult[];
}

export async function fetchProfilesByIds(ids: string[]): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const { data, error } = await supabase.from('profiles').select('id, username').in('id', ids);
  if (error) {
    console.error('[chat] fetchProfilesByIds failed:', error);
    return {};
  }
  const out: Record<string, string> = {};
  for (const row of data || []) out[row.id as string] = (row.username as string) || 'Unknown';
  return out;
}

/** Finds or creates the single DM room for an unordered pair of users. */
export async function openOrCreateDm(myUserId: string, otherUserId: string): Promise<string> {
  const [a, b] = [myUserId, otherUserId].sort();

  const { data: existing, error: selectErr } = await supabase
    .from('chat_rooms')
    .select('id')
    .eq('user_a', a)
    .eq('user_b', b)
    .maybeSingle();
  if (selectErr) throw selectErr;
  if (existing) return existing.id as string;

  const id = uuidv4();
  const { error: insertErr } = await supabase.from('chat_rooms').insert({
    id, user_a: a, user_b: b, created_at: Date.now(),
  });
  if (insertErr) {
    // Unique-violation: another tab/user created the room for this pair
    // between our select and insert — just re-select the winner.
    if (insertErr.code === '23505') {
      const { data: winner, error: reselectErr } = await supabase
        .from('chat_rooms')
        .select('id')
        .eq('user_a', a)
        .eq('user_b', b)
        .maybeSingle();
      if (reselectErr) throw reselectErr;
      if (winner) return winner.id as string;
    }
    throw insertErr;
  }
  return id;
}

export async function fetchRooms(myUserId: string): Promise<ChatRoomRow[]> {
  const { data, error } = await supabase
    .from('chat_rooms')
    .select('*')
    .or(`user_a.eq.${myUserId},user_b.eq.${myUserId}`)
    .order('last_message_at', { ascending: false, nullsFirst: false });
  if (error) {
    console.error('[chat] fetchRooms failed:', error);
    return [];
  }
  return (data || []) as ChatRoomRow[];
}

export async function fetchMessages(roomId: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('room_id', roomId)
    .order('created_at', { ascending: true });
  if (error) {
    console.error('[chat] fetchMessages failed:', error);
    return [];
  }
  return (data || []).map(rowToMessage);
}

export async function sendMessage(
  roomId: string,
  senderId: string,
  body: string,
  attachments: ChatAttachment[] = [],
  id: string = uuidv4()
): Promise<ChatMessage> {
  const trimmed = body.trim();
  const createdAt = Date.now();
  const { error } = await supabase.from('chat_messages').insert({
    id, room_id: roomId, sender_id: senderId, body: trimmed, created_at: createdAt, attachments,
  });
  if (error) throw error;

  const preview = trimmed || attachmentPreviewText(attachments);
  // Best-effort — the message is already durably written even if this fails.
  supabase
    .from('chat_rooms')
    .update({ last_message_at: createdAt, last_message_preview: preview.slice(0, 140) })
    .eq('id', roomId)
    .then(({ error: updateErr }) => {
      if (updateErr) console.error('[chat] failed to update room preview:', updateErr);
    });

  return { id, roomId, senderId, body: trimmed, createdAt, attachments };
}

type ChannelHandle = ReturnType<typeof supabase.channel>;
let activeChannel: ChannelHandle | null = null;
let activeRoomId: string | null = null;

export function subscribeToRoom(roomId: string, onInsert: (msg: ChatMessage) => void): void {
  unsubscribeFromRoom();
  activeRoomId = roomId;
  activeChannel = supabase
    .channel(`room:${roomId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `room_id=eq.${roomId}` },
      (payload) => onInsert(rowToMessage(payload.new as Parameters<typeof rowToMessage>[0]))
    )
    .subscribe();
}

export function unsubscribeFromRoom(): void {
  if (activeChannel) {
    try {
      supabase.removeChannel(activeChannel);
    } catch {
      /* noop */
    }
  }
  activeChannel = null;
  activeRoomId = null;
}

export function getActiveSubscribedRoomId(): string | null {
  return activeRoomId;
}
