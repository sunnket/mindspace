'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import {
  getMyAccessStatus,
  adminListRequests,
  adminListKeys,
  adminListMembers,
  adminApproveRequest,
  adminDenyRequest,
  adminCreateAccessKey,
  adminRevokeKey,
  adminRevokeMember,
  adminAddMember,
  type AccessRequestRow,
  type AccessKeyRow,
  type MemberRow,
} from '@/lib/access';

/**
 * The owner's door: pending requests, minted access keys, current members.
 *
 * Hiding this behind a status check is only tidiness — every write goes
 * through a SECURITY DEFINER function that re-checks is_owner() in the
 * database, and the three tables are readable by nobody else under RLS. A
 * stranger who types /admin sees an empty shell and gets nothing back.
 */
export default function AccessAdmin() {
  const user = useAuthStore((s) => s.user);
  const authLoading = useAuthStore((s) => s.loading);
  const router = useRouter();

  // Stamped with the user id, so the verdict invalidates itself on account
  // change without a synchronous setState inside the effect (React 19).
  const [ownerCheck, setOwnerCheck] = useState<{ id: string; owner: boolean } | null>(null);
  const [requests, setRequests] = useState<AccessRequestRow[]>([]);
  const [keys, setKeys] = useState<AccessKeyRow[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  // New-key form
  const [label, setLabel] = useState('');
  const [lockEmail, setLockEmail] = useState('');
  const [maxUses, setMaxUses] = useState(1);
  const [days, setDays] = useState(14);
  const [freshKey, setFreshKey] = useState('');

  const [newMember, setNewMember] = useState('');

  const refresh = useCallback(async () => {
    const [r, k, m] = await Promise.all([adminListRequests(), adminListKeys(), adminListMembers()]);
    setRequests(r);
    setKeys(k);
    setMembers(m);
  }, []);

  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    getMyAccessStatus().then((s) => {
      if (cancelled) return;
      setOwnerCheck({ id: user.id, owner: s === 'owner' });
      if (s === 'owner') refresh();
    });
    return () => {
      cancelled = true;
    };
  }, [user, authLoading, refresh]);

  // null = still deciding; false = definitely not the owner.
  const isOwner: boolean | null =
    !user && !authLoading ? false
    : user && ownerCheck?.id === user.id ? ownerCheck.owner
    : null;

  const run = async (fn: () => Promise<unknown>, successNote?: string) => {
    setBusy(true);
    setNote('');
    try {
      await fn();
      await refresh();
      if (successNote) setNote(successNote);
    } catch (e) {
      setNote((e as Error)?.message || 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateKey = async () => {
    setBusy(true);
    setNote('');
    const res = await adminCreateAccessKey({
      label,
      email: lockEmail,
      maxUses,
      days: days > 0 ? days : null,
    });
    setBusy(false);
    if (res.error) {
      setNote(res.error);
      return;
    }
    setFreshKey(res.key ?? '');
    setLabel('');
    setLockEmail('');
    refresh();
  };

  if (isOwner === null) {
    return <Shell><p style={muted}>Checking…</p></Shell>;
  }

  if (!isOwner) {
    return (
      <Shell>
        <h1 style={h1}>Nothing here</h1>
        <p style={muted}>This page belongs to the owner of this space.</p>
        <button style={ghostBtn} onClick={() => router.push('/')}>Back to canvabrains</button>
      </Shell>
    );
  }

  const pending = requests.filter((r) => r.status === 'pending');
  const decided = requests.filter((r) => r.status !== 'pending');
  const liveKeys = keys.filter((k) => !k.revoked && k.uses < k.max_uses && !isExpired(k));

  return (
    <div style={page}>
      <div style={{ width: '100%', maxWidth: 860, display: 'flex', flexDirection: 'column', gap: 22 }}>
        <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <h1 style={h1}>Who gets in</h1>
            <p style={{ ...muted, marginTop: 6 }}>
              {members.length} {members.length === 1 ? 'person' : 'people'} allowed ·{' '}
              {pending.length} waiting · {liveKeys.length} key{liveKeys.length === 1 ? '' : 's'} live
            </p>
          </div>
          <button style={ghostBtn} onClick={() => router.push('/')}>Back</button>
        </header>

        {note && <div style={noteBox}>{note}</div>}

        {/* ---------- pending requests ---------- */}
        <section style={card}>
          <h2 style={h2}>Requests</h2>
          {pending.length === 0 && <p style={{ ...muted, marginTop: 10 }}>Nobody waiting.</p>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
            {pending.map((r) => (
              <div key={r.id} style={row}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    {r.name ? `${r.name} · ` : ''}{r.email}
                  </div>
                  {r.reason && <div style={{ ...muted, marginTop: 4 }}>{r.reason}</div>}
                  <div style={{ ...muted, marginTop: 4, fontSize: 10 }}>{when(r.created_at)}</div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <button
                    disabled={busy}
                    style={primaryBtn}
                    onClick={() => run(() => adminApproveRequest(r.id), `${r.email} can sign up now.`)}
                  >
                    Approve
                  </button>
                  <button
                    disabled={busy}
                    style={ghostBtn}
                    onClick={() => run(() => adminDenyRequest(r.id))}
                  >
                    Deny
                  </button>
                </div>
              </div>
            ))}
          </div>

          {decided.length > 0 && (
            <details style={{ marginTop: 14 }}>
              <summary style={{ ...muted, cursor: 'pointer' }}>Earlier decisions ({decided.length})</summary>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
                {decided.map((r) => (
                  <div key={r.id} style={{ ...muted, display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <span>{r.email}</span>
                    <span style={{ color: r.status === 'approved' ? '#5FBF95' : '#C9705F' }}>{r.status}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </section>

        {/* ---------- mint a key ---------- */}
        <section style={card}>
          <h2 style={h2}>Hand out a key</h2>
          <p style={{ ...muted, marginTop: 6 }}>
            One key, one person. It allowlists whichever email redeems it, then burns itself out.
          </p>

          {freshKey && (
            <div style={keyBox}>
              <span style={{ fontSize: 20, letterSpacing: '0.2em', fontWeight: 700 }}>{freshKey}</span>
              <button
                style={ghostBtn}
                onClick={() => navigator.clipboard?.writeText(freshKey)}
              >
                Copy
              </button>
            </div>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 14 }}>
            <input style={{ ...input, flex: '2 1 180px' }} placeholder="Who is it for?" value={label} onChange={(e) => setLabel(e.target.value)} />
            <input style={{ ...input, flex: '2 1 180px' }} placeholder="Lock to email (optional)" value={lockEmail} onChange={(e) => setLockEmail(e.target.value)} />
            <input style={{ ...input, flex: '0 1 90px' }} type="number" min={1} value={maxUses} onChange={(e) => setMaxUses(Number(e.target.value))} title="Max uses" />
            <input style={{ ...input, flex: '0 1 110px' }} type="number" min={0} value={days} onChange={(e) => setDays(Number(e.target.value))} title="Expires in days (0 = never)" />
            <button style={primaryBtn} disabled={busy} onClick={handleCreateKey}>Create key</button>
          </div>

          {keys.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
              {keys.map((k) => (
                <div key={k.id} style={row}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.12em' }}>
                      {grouped(k.code)}
                    </div>
                    <div style={{ ...muted, marginTop: 4 }}>
                      {k.label || 'no label'}
                      {k.email ? ` · locked to ${k.email}` : ''}
                      {' · '}{k.uses}/{k.max_uses} used
                      {k.expires_at ? ` · expires ${when(k.expires_at)}` : ' · no expiry'}
                      {k.revoked ? ' · revoked' : isExpired(k) ? ' · expired' : ''}
                    </div>
                  </div>
                  {!k.revoked && (
                    <button style={ghostBtn} disabled={busy} onClick={() => run(() => adminRevokeKey(k.id))}>
                      Revoke
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ---------- members ---------- */}
        <section style={card}>
          <h2 style={h2}>Allowed</h2>
          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <input
              style={{ ...input, flex: 1 }}
              placeholder="add someone@example.com directly"
              value={newMember}
              onChange={(e) => setNewMember(e.target.value)}
            />
            <button
              style={primaryBtn}
              disabled={busy || !newMember.includes('@')}
              onClick={() => run(async () => {
                await adminAddMember(newMember);
                setNewMember('');
              }, 'Added.')}
            >
              Add
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
            {members.map((m) => (
              <div key={m.email} style={row}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {m.email}
                    {m.role === 'owner' && <span style={ownerTag}>owner</span>}
                  </div>
                  <div style={{ ...muted, marginTop: 4 }}>{m.note || '—'} · since {when(m.added_at)}</div>
                </div>
                {m.role !== 'owner' && (
                  <button
                    style={dangerBtn}
                    disabled={busy}
                    onClick={() => {
                      if (!confirm(`Cut off ${m.email}? Their account is deleted and their canvases become unreachable.`)) return;
                      run(() => adminRevokeMember(m.email), `${m.email} removed.`);
                    }}
                  >
                    Revoke
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Styles are inline throughout: this page renders outside the app's canvas
 * theming, and the global `* { padding: 0 }` reset would eat Tailwind's
 * spacing utilities anyway.
 * ------------------------------------------------------------------------- */

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ ...page, alignItems: 'flex-start' }}>
      <div style={{ ...card, maxWidth: 420, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
        {children}
      </div>
    </div>
  );
}

const isExpired = (k: AccessKeyRow) => !!k.expires_at && new Date(k.expires_at).getTime() < Date.now();
const grouped = (code: string) => code.replace(/(.{4})(.{4})(.{4})/, '$1-$2-$3');
const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

const page: React.CSSProperties = {
  minHeight: '100vh',
  height: '100%',
  overflowY: 'auto',
  background: '#0B0A09',
  color: '#F2EBE3',
  display: 'flex',
  justifyContent: 'center',
  padding: '48px 20px 80px',
  fontFamily: "'Outfit', 'Inter', sans-serif",
};

const card: React.CSSProperties = {
  background: '#17140F',
  border: '1px solid rgba(216,154,110,0.16)',
  borderRadius: 24,
  padding: '24px 26px',
};

const row: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 14,
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.05)',
  borderRadius: 16,
  padding: '12px 14px',
};

const h1: React.CSSProperties = { fontFamily: "'Playfair Display', serif", fontSize: 30, fontWeight: 400, letterSpacing: '-0.01em' };
const h2: React.CSSProperties = { fontFamily: "'Playfair Display', serif", fontSize: 19, fontWeight: 400 };
const muted: React.CSSProperties = { fontSize: 11.5, color: 'rgba(242,235,227,0.5)', lineHeight: 1.6 };

const input: React.CSSProperties = {
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.09)',
  borderRadius: 12,
  padding: '10px 14px',
  fontSize: 13,
  color: '#F2EBE3',
  outline: 'none',
  minWidth: 0,
};

const primaryBtn: React.CSSProperties = {
  background: '#D89A6E',
  color: '#1A1409',
  border: 'none',
  borderRadius: 999,
  padding: '10px 18px',
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
};

const ghostBtn: React.CSSProperties = {
  background: 'rgba(255,255,255,0.06)',
  color: 'rgba(242,235,227,0.8)',
  border: '1px solid rgba(255,255,255,0.09)',
  borderRadius: 999,
  padding: '10px 18px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};

const dangerBtn: React.CSSProperties = { ...ghostBtn, color: '#E08272', borderColor: 'rgba(224,130,114,0.3)' };

const noteBox: React.CSSProperties = {
  background: 'rgba(216,154,110,0.12)',
  border: '1px solid rgba(216,154,110,0.25)',
  borderRadius: 16,
  padding: '12px 16px',
  fontSize: 12.5,
};

const keyBox: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 14,
  marginTop: 14,
  background: 'rgba(216,154,110,0.12)',
  border: '1px dashed rgba(216,154,110,0.45)',
  borderRadius: 16,
  padding: '14px 18px',
};

const ownerTag: React.CSSProperties = {
  marginLeft: 8,
  fontSize: 9,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: '#D89A6E',
  border: '1px solid rgba(216,154,110,0.35)',
  borderRadius: 999,
  padding: '2px 8px',
};
