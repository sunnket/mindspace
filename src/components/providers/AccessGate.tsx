'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import { getMyAccessStatus, requestAccess, redeemAccessKey, type AccessStatus } from '@/lib/access';

/**
 * Parks a signed-in-but-unapproved account on a waiting screen instead of
 * dropping it into an app where every query silently returns nothing.
 *
 * The database has already refused them by this point — RLS gates every table
 * on public.is_approved(). This is the explanation, not the enforcement, which
 * is why an unreachable check fails open (see lib/access.ts): a network blip
 * must never lock the owner out of their own canvas.
 */
export default function AccessGate({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const authLoading = useAuthStore((s) => s.loading);
  const signOut = useAuthStore((s) => s.signOut);
  const pathname = usePathname();

  /* Stamped with the user id it belongs to, so signing out or switching
     accounts invalidates it by derivation instead of a synchronous reset
     inside the effect (which React 19 rejects as a cascading render). */
  const [checked, setChecked] = useState<{ id: string; status: AccessStatus } | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    getMyAccessStatus().then((s) => {
      if (!cancelled) setChecked({ id: user.id, status: s });
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const status = user && checked?.id === user.id ? checked.status : null;

  // Public share links belong to whoever holds the token — never gated.
  const isPublicRoute = pathname?.startsWith('/s/');

  const blocked =
    !!user && !authLoading && !isPublicRoute && (status === 'pending' || status === 'blocked');

  if (!blocked) return <>{children}</>;

  const email = user?.email ?? '';

  const handleKey = async () => {
    if (!key.trim()) return;
    setBusy(true);
    setErr('');
    const res = await redeemAccessKey(key, email);
    setBusy(false);
    if (!res.ok) {
      setErr(res.error || 'That key is not valid.');
      return;
    }
    // The session's claims don't change, but its RLS answers do — a reload is
    // the honest way to re-run every query that came back empty.
    window.location.reload();
  };

  const handleRequest = async () => {
    setBusy(true);
    setErr('');
    const res = await requestAccess(email);
    setBusy(false);
    if (res.error) {
      setErr(res.error);
      return;
    }
    setMsg("Request sent. You'll get in as soon as it's approved.");
    if (user) setChecked({ id: user.id, status: 'pending' });
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: '#0B0A09' }}
    >
      <div
        className="relative w-full max-w-md mx-4 clay-card rounded-[30px] flex flex-col text-center"
        style={{
          padding: '40px 32px 32px',
          color: 'var(--text-primary)',
          ['--accent' as string]: '#D89A6E',
          ['--accent-rgb' as string]: '216, 154, 110',
        }}
      >
        <div
          className="w-14 h-14 rounded-2xl clay-inset flex items-center justify-center self-center"
          style={{ marginBottom: 18 }}
          aria-hidden="true"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
        </div>

        <h2 className="text-[26px] font-normal tracking-tight leading-tight" style={{ fontFamily: "'Playfair Display', serif" }}>
          {status === 'pending' ? 'Waiting on approval' : 'Not on the list'}
        </h2>
        <p className="text-[12px] text-[var(--text-tertiary)] leading-relaxed self-center" style={{ maxWidth: 320, marginTop: 10 }}>
          {status === 'pending'
            ? 'Your account exists, but the owner hasn’t let it in yet. You’ll see your space the moment they do.'
            : 'This canvabrains is private. Ask the owner for an access key, or send a request.'}
        </p>
        <p className="text-[11px] text-[var(--text-muted)]" style={{ marginTop: 8 }}>
          Signed in as {email}
        </p>

        {err && (
          <div className="text-xs rounded-2xl leading-relaxed" style={{ padding: '10px 14px', marginTop: 16, background: 'rgba(214,106,91,0.12)', color: '#B4402F', border: '1px solid rgba(214,106,91,0.2)' }}>
            {err}
          </div>
        )}
        {msg && (
          <div className="text-xs rounded-2xl leading-relaxed" style={{ padding: '10px 14px', marginTop: 16, background: 'rgba(47,158,110,0.12)', color: '#217A54', border: '1px solid rgba(47,158,110,0.2)' }}>
            {msg}
          </div>
        )}

        <div className="flex flex-col gap-2.5" style={{ marginTop: 20 }}>
          <input
            value={key}
            onChange={(e) => setKey(e.target.value.toUpperCase())}
            placeholder="XXXX-XXXX-XXXX"
            autoComplete="off"
            spellCheck={false}
            className="w-full clay-inset rounded-2xl text-sm outline-none text-center tracking-[0.18em] font-semibold text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:ring-2 focus:ring-[var(--accent)]/40"
            style={{ padding: '12px 16px' }}
            disabled={busy}
          />
          <button
            onClick={handleKey}
            disabled={busy || !key.trim()}
            style={{ padding: '12px 20px' }}
            className="w-full bg-[var(--accent)] text-white font-bold rounded-full text-sm transition-all cursor-pointer hover:brightness-105 active:scale-[0.99] disabled:opacity-50"
          >
            Unlock with key
          </button>

          <div className="flex items-center gap-2" style={{ marginTop: 6 }}>
            {status !== 'pending' && (
              <button
                onClick={handleRequest}
                disabled={busy}
                style={{ padding: '10px 18px' }}
                className="flex-1 clay-inset rounded-full text-[12px] font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all cursor-pointer disabled:opacity-50"
              >
                Request access
              </button>
            )}
            <button
              onClick={() => signOut()}
              style={{ padding: '10px 18px' }}
              className="flex-1 clay-inset rounded-full text-[12px] font-bold text-[var(--text-secondary)] hover:text-red-500 transition-all cursor-pointer"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
