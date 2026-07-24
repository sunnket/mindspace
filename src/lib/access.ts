import { supabase } from '@/lib/supabaseClient';

/**
 * Invite-only access control — client half of `supabase/schema_access_control.sql`.
 *
 * Nothing here is a security boundary. The database is: RLS requires
 * `public.is_approved()` on every table, and a trigger on auth.users refuses
 * to create an account whose email isn't on the allowlist. These calls exist
 * so the UI can say something useful instead of letting people walk into a
 * wall of empty screens and generic errors.
 *
 * That split decides how failures are handled below: the sign-up gate fails
 * CLOSED (a broken check must never look like an invitation), while the
 * signed-in gate fails OPEN (a dropped connection must never lock you out of
 * your own app — the database is still refusing everything regardless).
 */

export type AccessStatus = 'anon' | 'owner' | 'approved' | 'pending' | 'blocked';
export type SignupAccess = 'allowed' | 'pending' | 'blocked';

/** True once the migration has been run — used to keep the app usable before then. */
function isMissingFunction(error: unknown): boolean {
  const msg = (error as { message?: string })?.message ?? '';
  const code = (error as { code?: string })?.code ?? '';
  return code === 'PGRST202' || /function .* does not exist|could not find the function/i.test(msg);
}

export async function getMyAccessStatus(): Promise<AccessStatus> {
  try {
    const { data, error } = await supabase.rpc('my_access_status');
    if (error) {
      // Migration not applied yet, or the network blinked: don't gate anyone.
      if (isMissingFunction(error)) return 'owner';
      return 'approved';
    }
    return (data as AccessStatus) ?? 'approved';
  } catch {
    return 'approved';
  }
}

export async function checkSignupAccess(email: string): Promise<SignupAccess> {
  const { data, error } = await supabase.rpc('check_signup_access', { p_email: email });
  if (error) {
    if (isMissingFunction(error)) return 'allowed'; // gate not installed yet
    return 'blocked';
  }
  return (data as SignupAccess) ?? 'blocked';
}

export async function redeemAccessKey(key: string, email: string): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.rpc('redeem_access_key', { p_key: key, p_email: email });
  if (error) return { ok: false, error: error.message || 'Could not check that key.' };
  const res = data as { ok?: boolean; error?: string } | null;
  return res?.ok ? { ok: true } : { ok: false, error: res?.error || 'That access key is not valid.' };
}

export async function requestAccess(
  email: string,
  name?: string,
  reason?: string
): Promise<{ status: 'pending' | 'approved' | null; error?: string }> {
  const { data, error } = await supabase.rpc('request_access', {
    p_email: email,
    p_name: name ?? null,
    p_reason: reason ?? null,
  });
  if (error) return { status: null, error: error.message || 'Could not send your request.' };
  return { status: (data as 'pending' | 'approved') ?? 'pending' };
}

/* ---------------------------------------------------------------------------
 * Owner-only. Every one of these is re-checked server-side by is_owner();
 * hiding the UI is a courtesy, not the lock.
 * ------------------------------------------------------------------------- */

export interface AccessRequestRow {
  id: string;
  email: string;
  name: string | null;
  reason: string | null;
  status: 'pending' | 'approved' | 'denied';
  created_at: string;
  decided_at: string | null;
}

export interface AccessKeyRow {
  id: string;
  code: string;
  label: string | null;
  email: string | null;
  max_uses: number;
  uses: number;
  expires_at: string | null;
  revoked: boolean;
  created_at: string;
  last_used_at: string | null;
}

export interface MemberRow {
  email: string;
  role: string;
  note: string | null;
  added_at: string;
}

export async function adminListRequests(): Promise<AccessRequestRow[]> {
  const { data } = await supabase
    .from('access_requests')
    .select('*')
    .order('created_at', { ascending: false });
  return (data as AccessRequestRow[]) ?? [];
}

export async function adminListKeys(): Promise<AccessKeyRow[]> {
  const { data } = await supabase
    .from('access_keys')
    .select('*')
    .order('created_at', { ascending: false });
  return (data as AccessKeyRow[]) ?? [];
}

export async function adminListMembers(): Promise<MemberRow[]> {
  const { data } = await supabase
    .from('allowlist')
    .select('*')
    .order('added_at', { ascending: true });
  return (data as MemberRow[]) ?? [];
}

export async function adminApproveRequest(id: string) {
  return supabase.rpc('admin_approve_request', { p_id: id });
}

export async function adminDenyRequest(id: string) {
  return supabase.rpc('admin_deny_request', { p_id: id });
}

export async function adminRevokeMember(email: string, deleteAccount = true) {
  return supabase.rpc('admin_revoke_member', { p_email: email, p_delete_account: deleteAccount });
}

export async function adminRevokeKey(id: string) {
  return supabase.rpc('admin_revoke_key', { p_id: id });
}

export async function adminCreateAccessKey(opts: {
  label?: string;
  email?: string;
  maxUses?: number;
  days?: number | null;
}): Promise<{ key?: string; error?: string }> {
  const { data, error } = await supabase.rpc('admin_create_access_key', {
    p_label: opts.label || null,
    p_email: opts.email || null,
    p_max_uses: opts.maxUses ?? 1,
    p_days: opts.days ?? null,
  });
  if (error) return { error: error.message || 'Could not create a key.' };
  return { key: data as string };
}

/** Adds someone straight to the allowlist, no key and no request. */
export async function adminAddMember(email: string, note?: string) {
  return supabase
    .from('allowlist')
    .insert({ email: email.trim().toLowerCase(), role: 'member', note: note || 'added by owner' });
}
