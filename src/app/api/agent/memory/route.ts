import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Agent memory CRUD. Stores per-user facts, preferences, and instructions
 * the canvas agent can recall across sessions. Auth via Supabase JWT.
 *
 *   GET    /api/agent/memory              → { memories: Memory[] }
 *   POST   /api/agent/memory              → { memory: Memory }
 *   DELETE /api/agent/memory?id=<id>      → { deleted: true }
 */

const MAX_MEMORIES_PER_USER = 500;
const MAX_VALUE_LENGTH = 2000;

function supabaseFromRequest(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  const authHeader = req.headers.get('authorization');
  const cookieHeader = req.headers.get('cookie');

  // Extract the access token from the Authorization header, or from the
  // Supabase auth cookie if the request is coming from SSR/middleware.
  let accessToken = '';
  if (authHeader?.startsWith('Bearer ')) {
    accessToken = authHeader.slice(7);
  } else if (cookieHeader) {
    // Supabase stores the session in sb-<ref>-auth-token cookie
    const match = cookieHeader.match(/sb-[^-]+-auth-token=([^;]+)/);
    if (match) {
      try {
        const parsed = JSON.parse(decodeURIComponent(match[1]));
        accessToken = parsed?.access_token || parsed?.[0]?.access_token || '';
      } catch {
        /* not JSON, try raw */
        accessToken = match[1];
      }
    }
  }

  if (!accessToken) return null;

  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

export async function GET(req: NextRequest) {
  const sb = supabaseFromRequest(req);
  if (!sb) return NextResponse.json({ memories: [] });

  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ memories: [] });

  const { data, error } = await sb
    .from('agent_memory')
    .select('*')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(MAX_MEMORIES_PER_USER);

  if (error) {
    console.error('[agent/memory] GET error:', error.message);
    return NextResponse.json({ memories: [], error: error.message });
  }

  return NextResponse.json({ memories: data || [] });
}

export async function POST(req: NextRequest) {
  const sb = supabaseFromRequest(req);
  if (!sb) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await req.json();
  const { category, key, value, sourcePrompt } = body;

  if (!key || !value) {
    return NextResponse.json({ error: 'key and value are required' }, { status: 400 });
  }

  const now = Date.now();
  const id = `mem_${now}_${Math.random().toString(36).slice(2, 8)}`;

  // Check if a memory with the same key already exists — update it instead
  const { data: existing } = await sb
    .from('agent_memory')
    .select('id')
    .eq('user_id', user.id)
    .eq('key', key)
    .limit(1);

  if (existing && existing.length > 0) {
    const { error } = await sb
      .from('agent_memory')
      .update({
        value: String(value).slice(0, MAX_VALUE_LENGTH),
        category: category || 'fact',
        source_prompt: sourcePrompt?.slice(0, 500) || null,
        updated_at: now,
      })
      .eq('id', existing[0].id);

    if (error) {
      console.error('[agent/memory] UPDATE error:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ memory: { ...existing[0], value, updated_at: now }, updated: true });
  }

  // Enforce cap
  const { count } = await sb
    .from('agent_memory')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id);

  if ((count || 0) >= MAX_MEMORIES_PER_USER) {
    // Delete oldest to make room
    const { data: oldest } = await sb
      .from('agent_memory')
      .select('id')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: true })
      .limit(1);
    if (oldest?.[0]) {
      await sb.from('agent_memory').delete().eq('id', oldest[0].id);
    }
  }

  const memory = {
    id,
    user_id: user.id,
    category: category || 'fact',
    key: String(key).slice(0, 200),
    value: String(value).slice(0, MAX_VALUE_LENGTH),
    source_prompt: sourcePrompt?.slice(0, 500) || null,
    created_at: now,
    updated_at: now,
  };

  const { error } = await sb.from('agent_memory').insert(memory);
  if (error) {
    console.error('[agent/memory] INSERT error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ memory, created: true });
}

export async function DELETE(req: NextRequest) {
  const sb = supabaseFromRequest(req);
  if (!sb) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id param required' }, { status: 400 });

  const { error } = await sb
    .from('agent_memory')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) {
    console.error('[agent/memory] DELETE error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: true });
}
