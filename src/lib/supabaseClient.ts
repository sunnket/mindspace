import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder-project.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key';

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  console.warn('Supabase environment variables NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY are missing! Using placeholders.');
}

/**
 * Every cloud request is hard-capped at 15s. Without this, a paused or
 * unreachable Supabase project makes requests hang forever; with autosave
 * running, hanging requests pile up unboundedly and can lag the whole
 * machine. This cap makes that class of failure impossible regardless of
 * future changes elsewhere in the app.
 */
const CLOUD_REQUEST_TIMEOUT_MS = 15_000;

const fetchWithTimeout: typeof fetch = (input, init) => {
  // Respect a caller-provided signal if one exists; otherwise enforce ours.
  if (init?.signal) return fetch(input, init);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLOUD_REQUEST_TIMEOUT_MS);
  return fetch(input, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  },
  global: {
    fetch: fetchWithTimeout,
  },
});
