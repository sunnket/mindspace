'use client';

import React, { Suspense } from 'react';
import dynamic from 'next/dynamic';

const InfiniteCanvas = dynamic(
  () => import('@/components/canvas/InfiniteCanvas'),
  { ssr: false }
);

export default function CanvasPage() {
  return (
    <Suspense
      fallback={
        /* Black, and silent. This fallback is what fills the gap while the
           canvas chunk loads — painting it `--bg-primary` (light cream) put a
           white sheet plus the words "Loading canvas..." in front of every
           board for half a second, on a canvas whose default paper is dark. */
        <div style={{ minHeight: '100vh', background: '#000' }} />
      }
    >
      <InfiniteCanvas />
    </Suspense>
  );
}
