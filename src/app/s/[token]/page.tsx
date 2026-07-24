'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { loadSharedBoard, type BoardSnapshot } from '@/lib/share';
import SharedCanvasViewer from '@/components/canvas/SharedCanvasViewer';

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
      <div className="glass-panel text-center" style={{ padding: '28px 32px', maxWidth: 420 }}>
        {children}
      </div>
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
    if (!token) { setStatus('missing'); return; }
    loadSharedBoard(token).then((snap) => {
      if (cancelled) return;
      if (snap) { setSnapshot(snap); setStatus('ok'); }
      else setStatus('missing');
    });
    return () => { cancelled = true; };
  }, [token]);

  if (status === 'loading') {
    return (
      <Centered>
        <span className="w-6 h-6 border-2 border-t-transparent border-[var(--accent)] rounded-full animate-spin inline-block" />
        <p className="text-sm text-[var(--text-secondary)]" style={{ marginTop: 12 }}>Loading shared board…</p>
      </Centered>
    );
  }

  if (status === 'missing' || !snapshot) {
    return (
      <Centered>
        <h1 className="text-lg font-bold text-[var(--text-primary)]">Link unavailable</h1>
        <p className="text-sm text-[var(--text-secondary)]" style={{ marginTop: 8 }}>
          This share link is invalid or has been revoked by its owner.
        </p>
        <a href="/" className="inline-block text-[var(--accent)] font-semibold text-sm" style={{ marginTop: 14 }}>
          Go to canvabrains →
        </a>
      </Centered>
    );
  }

  return <SharedCanvasViewer snapshot={snapshot} />;
}
