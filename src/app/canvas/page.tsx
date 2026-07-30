'use client';

import React, { Suspense } from 'react';
import dynamic from 'next/dynamic';
import BootScreen from '@/components/providers/BootScreen';

const InfiniteCanvas = dynamic(
  () => import('@/components/canvas/InfiniteCanvas'),
  { ssr: false, loading: () => <BootScreen /> }
);

export default function CanvasPage() {
  return (
    /* The fallback used to be a silent black rectangle. It matched the dark
       paper, which solved the white-flash it was written for, but it also meant
       the browser had nothing contentful to paint — so on a cold load the canvas
       showed an empty black frame for seconds with no sign it was working. The
       boot shell is server-rendered, so it is on screen immediately and the real
       board simply covers it. */
    <Suspense fallback={<BootScreen />}>
      <InfiniteCanvas />
    </Suspense>
  );
}
