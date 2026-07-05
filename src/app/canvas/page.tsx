'use client';

import React, { Suspense } from 'react';
import dynamic from 'next/dynamic';

const InfiniteCanvas = dynamic(
  () => import('@/components/canvas/InfiniteCanvas'),
  { ssr: false }
);

export default function CanvasPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center">Loading canvas...</div>}>
      <InfiniteCanvas />
    </Suspense>
  );
}
