'use client';

import dynamic from 'next/dynamic';

/* Client-only like the rest of the app: this page reads the Supabase session
   from the browser, and there is nothing worth prerendering on the server. */
const AccessAdmin = dynamic(() => import('@/components/admin/AccessAdmin'), {
  ssr: false,
  loading: () => <div style={{ minHeight: '100vh', background: '#0B0A09' }} />,
});

export default function AdminPage() {
  return <AccessAdmin />;
}
