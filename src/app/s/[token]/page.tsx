'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { loadSharedBoard, type BoardSnapshot } from '@/lib/share';
import SharedCanvasViewer from '@/components/canvas/SharedCanvasViewer';

/**
 * The page a stranger lands on.
 *
 * This route has an audience nothing else in the app has: someone who has never
 * used canvabrains, arriving from a link in a chat, with no idea what they are
 * about to see. Both of its non-happy states used to be one centred glass box —
 * a bare spinner while loading, a flat "Link unavailable" if not — and for a
 * first-ever impression of the product that is a wasted screen in the one place
 * a wasted screen costs the most.
 *
 * Both states are painted on the app's own black paper rather than the light
 * `--bg-primary` they used before, because that variable is only correct once
 * the canvas theme has been applied — on this route nothing applies it, so the
 * old panels flashed light-on-light before the board took over.
 */

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center" style={{ background: '#000', padding: 24 }}>
      {children}
    </div>
  );
}

/** The wordmark, matched to BootScreen so the app's entry points agree. */
function Wordmark() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: 11,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(201, 123, 75, 0.14)',
          color: '#C97B4B',
          fontFamily: "'Bebas Neue', 'Outfit', sans-serif",
          fontSize: 19,
          lineHeight: 1,
        }}
      >
        c
      </div>
      <span
        style={{
          fontFamily: "'Bebas Neue', 'Outfit', sans-serif",
          fontSize: 23,
          letterSpacing: '-0.01em',
          color: 'rgba(255, 253, 250, 0.72)',
          lineHeight: 1,
        }}
      >
        canvabrains
      </span>
    </div>
  );
}

/**
 * Loading is a SKELETON OF A BOARD, not a spinner.
 *
 * A spinner communicates exactly one thing — "wait" — and says nothing about
 * what is being waited for. A handful of card shapes in a loose spatial
 * arrangement says "a board is arriving", which is both more informative and a
 * fair description of the product. It matters here more than elsewhere because
 * a shared snapshot can be large, so this is a screen people actually sit on.
 */
function BoardSkeleton() {
  // Deliberately irregular. A tidy grid of equal rectangles reads as a table;
  // scattered cards of differing sizes read as a canvas, which is the point.
  const cards = [
    { left: 0, top: 0, w: 132, h: 84 },
    { left: 150, top: 22, w: 104, h: 104 },
    { left: 24, top: 102, w: 96, h: 62 },
    { left: 150, top: 144, w: 132, h: 54 },
    { left: 0, top: 182, w: 128, h: 46 },
  ];

  return (
    <div style={{ position: 'relative', width: 282, height: 228 }} aria-hidden="true">
      {cards.map((c, i) => (
        <div
          key={i}
          className="share-skeleton-card"
          style={{
            position: 'absolute',
            left: c.left,
            top: c.top,
            width: c.w,
            height: c.h,
            borderRadius: 12,
            // Staggered so the board ASSEMBLES rather than pulsing as one
            // block — the difference between "loading" and "being built".
            animationDelay: `${i * 130}ms`,
          }}
        />
      ))}
    </div>
  );
}

export default function SharePage() {
  const params = useParams();
  const token = Array.isArray(params?.token) ? params.token[0] : (params?.token as string | undefined);
  const [status, setStatus] = useState<'loading' | 'ok' | 'missing'>('loading');
  const [snapshot, setSnapshot] = useState<BoardSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    // No synchronous setState here. A route reached without a token can never
    // resolve, which makes "missing" a fact DERIVED from the params rather than
    // a state transition — and setting it in the effect body only bought an
    // extra render pass to reach a conclusion already available at render time.
    if (!token) return;
    loadSharedBoard(token).then((snap) => {
      if (cancelled) return;
      if (snap) { setSnapshot(snap); setStatus('ok'); }
      else setStatus('missing');
    });
    return () => { cancelled = true; };
  }, [token]);

  const resolved = token ? status : 'missing';

  if (resolved === 'loading') {
    return (
      <Shell>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 30 }}>
          <BoardSkeleton />
          <Wordmark />
          <p role="status" style={{ fontSize: 12.5, color: 'rgba(255, 253, 250, 0.42)' }}>
            Opening the shared board…
          </p>
        </div>
      </Shell>
    );
  }

  if (resolved === 'missing' || !snapshot) {
    return (
      <Shell>
        <div style={{ maxWidth: 380, textAlign: 'center' }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 15,
              margin: '0 auto 20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(255, 253, 250, 0.05)',
              border: '1px solid rgba(255, 253, 250, 0.09)',
              color: 'rgba(255, 253, 250, 0.4)',
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="10.5" width="16" height="10" rx="2.5" />
              <path d="M8 10.5V7a4 4 0 0 1 7.3-2.3" />
            </svg>
          </div>

          <h1 style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.02em', color: 'rgba(255, 253, 250, 0.92)' }}>
            This board isn&apos;t available
          </h1>

          {/* Names both real causes rather than the ambiguous "invalid or
              revoked". Someone who understands the sender switched the link off
              behaves differently from someone who thinks they mistyped a URL. */}
          <p style={{ fontSize: 13.5, lineHeight: 1.6, color: 'rgba(255, 253, 250, 0.55)', marginTop: 10 }}>
            The link may have been turned off by its owner, or the address may be
            incomplete. Asking them for a fresh link is the quickest fix.
          </p>

          {/* A dead link is still a first impression, so it ends on an
              invitation instead of a dead end. */}
          <Link
            href="/"
            style={{
              display: 'inline-block',
              marginTop: 22,
              padding: '9px 18px',
              borderRadius: 999,
              fontSize: 13,
              fontWeight: 700,
              textDecoration: 'none',
              color: '#1A1613',
              background: '#C97B4B',
            }}
          >
            Try canvabrains
          </Link>
        </div>
      </Shell>
    );
  }

  return <SharedCanvasViewer snapshot={snapshot} />;
}
