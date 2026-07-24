'use client';

import dynamic from 'next/dynamic';

/* Client-only, so there's a real gap before the landing chunk paints. The
   placeholder is black to match the page it becomes — the default (nothing)
   let the body show through, which was fine only once the body stopped being
   cream. Keeping an explicit one means the hand-off is invisible either way. */
const LandingPage = dynamic(
  () => import('@/components/landing/LandingPage'),
  { ssr: false, loading: () => <div style={{ minHeight: '100vh', background: '#000' }} /> }
);

export default function Home() {
  return <LandingPage />;
}
