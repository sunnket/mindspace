'use client';

import dynamic from 'next/dynamic';
import BootScreen from '@/components/providers/BootScreen';

/* Client-only, so there's a real gap before the landing chunk paints. That gap
   used to be a bare black div — which the browser does not count as a
   *contentful* paint, so FCP never fired until the entire app was ready. The
   boot shell is plain server-rendered markup, so it lands on the first frame
   and the page stops looking dead while its chunk arrives. */
const LandingPage = dynamic(
  () => import('@/components/landing/LandingPage'),
  { ssr: false, loading: () => <BootScreen /> }
);

export default function Home() {
  return <LandingPage />;
}
