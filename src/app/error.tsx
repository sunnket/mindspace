'use client';

import { useEffect } from 'react';

/**
 * The last line of defence, and mostly a REASSURANCE screen.
 *
 * BlockErrorBoundary contains anything thrown by an individual block, so what
 * reaches this file is a failure in the canvas shell itself — the store, the
 * camera pipeline, a provider. Rare, but when it happens the user's instinct is
 * immediate and wrong: "my board is gone."
 *
 * It isn't. Every edit is written to IndexedDB before anything else happens
 * (see the cloud-persistence note in syncService), so a render crash cannot
 * touch the data — it only destroyed the view of it. Saying that plainly, in
 * the first sentence, is the entire job of this screen. The recovery button is
 * almost secondary.
 *
 * `unstable_retry` — NOT `reset`. Next 16.2 renamed the recovery prop, and the
 * two are not interchangeable: `reset()` merely clears the error state and
 * re-renders from what is already in memory, while `unstable_retry()` re-fetches
 * and re-renders the segment, which is what actually recovers a route.
 */
export default function ErrorPage({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error('[canvabrains] route error:', error);
  }, [error]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#000',
        padding: 24,
      }}
    >
      <div style={{ maxWidth: 400, textAlign: 'center' }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 14,
            margin: '0 auto 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(201, 123, 75, 0.14)',
            color: '#C97B4B',
            fontFamily: "'Bebas Neue', 'Outfit', sans-serif",
            fontSize: 24,
            lineHeight: 1,
          }}
        >
          c
        </div>

        <h1
          style={{
            fontFamily: "'Outfit', sans-serif",
            fontSize: 20,
            fontWeight: 600,
            letterSpacing: '-0.02em',
            color: 'rgba(255, 253, 250, 0.92)',
          }}
        >
          Something broke on screen
        </h1>

        {/* The reassurance, first and in the brightest text on the page. */}
        <p
          style={{
            fontSize: 13.5,
            lineHeight: 1.55,
            color: 'rgba(255, 253, 250, 0.62)',
            marginTop: 10,
          }}
        >
          Your boards are saved on this device — nothing was lost. Reloading the
          view is usually all it takes.
        </p>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 22 }}>
          <button
            type="button"
            onClick={() => unstable_retry()}
            style={{
              padding: '9px 18px',
              borderRadius: 999,
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
              color: '#1A1613',
              background: '#C97B4B',
              border: 'none',
            }}
          >
            Reload the board
          </button>
          {/* A hard navigation, NOT a <Link>. Client-side routing would carry
              the same already-broken React tree over to the landing page; a
              full document load is the only way to guarantee the user lands in
              a clean one, which is the entire promise of this button. */}
          <button
            type="button"
            onClick={() => window.location.assign('/')}
            style={{
              padding: '9px 18px',
              borderRadius: 999,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              color: 'rgba(255, 253, 250, 0.72)',
              background: 'rgba(255, 253, 250, 0.07)',
              border: '1px solid rgba(255, 253, 250, 0.12)',
            }}
          >
            All boards
          </button>
        </div>

        {/* The digest is the only handle that ties this screen to a server log
            line, so it is worth showing — quietly, for someone who is reporting
            the problem rather than someone who is merely startled by it. */}
        {error.digest && (
          <p
            style={{
              marginTop: 20,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10,
              color: 'rgba(255, 253, 250, 0.26)',
            }}
          >
            ref {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
