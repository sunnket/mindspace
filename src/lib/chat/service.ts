import { v4 as uuidv4 } from 'uuid';
import { supabase } from '@/lib/supabaseClient';

export interface ProfileResult {
  id: string;
  username: string;
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
}

function rowToMessage(row: {
  id: string; room_id: string; sender_id: string; body: string;
  created_at: number; edited_at: number | null; deleted: boolean | null;
}): ChatMessage {
  return {
    id: row.id,
    roomId: row.room_id,
    senderId: row.sender_id,
    body: row.body,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    deleted: !!row.deleted,
  };
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

export async function sendMessage(roomId: string, senderId: string, body: string): Promise<ChatMessage> {
  const trimmed = body.trim();
  const id = uuidv4();
  const createdAt = Date.now();
  const { error } = await supabase.from('chat_messages').insert({
    id, room_id: roomId, sender_id: senderId, body: trimmed, created_at: createdAt,
  });
  if (error) throw error;

  // Best-effort — the message is already durably written even if this fails.
  supabase
    .from('chat_rooms')
    .update({ last_message_at: createdAt, last_message_preview: trimmed.slice(0, 140) })
    .eq('id', roomId)
    .then(({ error: updateErr }) => {
      if (updateErr) console.error('[chat] failed to update room preview:', updateErr);
    });

  return { id, roomId, senderId, body: trimmed, createdAt };
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
