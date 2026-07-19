import { v4 as uuidv4 } from 'uuid';
import { supabase } from './supabaseClient';
import { useCanvasStore } from '@/store/canvasStore';
import type { CanvasObjectData, DrawingStroke, ConnectionData } from './db';

/**
 * View-only share links. A share is a self-contained SNAPSHOT of the current
 * board captured from the store — so the public viewer never needs read access
 * to the owner's private tables (see schema_shares.sql). Updating the board and
 * pressing "Update" re-snapshots it.
 */

export interface BoardSnapshot {
  title: string;
  background: unknown;
  objects: CanvasObjectData[];
  connections: ConnectionData[];
  strokes: DrawingStroke[];
  sharedAt: string;
}

/** The board the user is currently looking at (root, or a nested sub-space). */
function currentCanvasId(): string {
  const s = useCanvasStore.getState();
  const stack = s.canvasStack;
  if (stack && stack.length) return stack[stack.length - 1];
  return s.urlCanvasId || 'root';
}

/** Snapshot only what's on this canvas — objects/strokes/connections at this level. */
export function buildSnapshot(): BoardSnapshot {
  const s = useCanvasStore.getState();
  const cid = currentCanvasId();
  const atLevel = <T extends { parentId?: string }>(arr: T[]) =>
    arr.filter((o) => (o.parentId || 'root') === (cid || 'root'));
  return {
    title: s.workspaceTitle || 'Untitled board',
    background: s.canvasBackground ?? null,
    objects: atLevel(s.objects),
    connections: atLevel(s.connections || []),
    strokes: atLevel(s.strokes || []),
    sharedAt: new Date().toISOString(),
  };
}

export function shareUrl(token: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/s/${token}`;
}

/** Find an existing (non-revoked) share for the current board, if any. */
export async function getMyShare(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from('shares')
    .select('token')
    .eq('user_id', user.id)
    .eq('canvas_id', currentCanvasId())
    .eq('revoked', false)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.token ?? null;
}

/** Create a link for this board, or refresh the snapshot of the existing one. */
export async function createOrUpdateShare(): Promise<{ token: string } | { error: string }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Sign in to create a share link.' };

  const snapshot = buildSnapshot();
  if (snapshot.objects.length === 0) return { error: 'This board is empty — add something to share.' };

  const existing = await getMyShare();
  if (existing) {
    const { error } = await supabase
      .from('shares')
      .update({ data: snapshot, title: snapshot.title, updated_at: new Date().toISOString(), revoked: false })
      .eq('token', existing);
    if (error) return { error: error.message };
    return { token: existing };
  }

  const token = uuidv4().replace(/-/g, '');
  const { error } = await supabase.from('shares').insert({
    token,
    user_id: user.id,
    canvas_id: currentCanvasId(),
    title: snapshot.title,
    data: snapshot,
  });
  if (error) return { error: error.message };
  return { token };
}

export async function revokeShare(token: string): Promise<void> {
  await supabase.from('shares').update({ revoked: true }).eq('token', token);
}

/** Public read — returns the snapshot for a valid token, or null. */
export async function loadSharedBoard(token: string): Promise<BoardSnapshot | null> {
  const { data, error } = await supabase.rpc('get_shared_board', { share_token: token });
  if (error || !data) return null;
  return data as BoardSnapshot;
}
