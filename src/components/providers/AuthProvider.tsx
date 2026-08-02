'use client';

import { useEffect } from 'react';
import { useAuthStore } from '@/store/authStore';
import AccessGate from './AccessGate';
import Toaster from '@/components/ui/Toaster';
import ConnectionWatcher from './ConnectionWatcher';

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const initializeAuth = useAuthStore((s) => s.initializeAuth);

  useEffect(() => {
    initializeAuth();
  }, [initializeAuth]);

  return (
    <>
      <AccessGate>{children}</AccessGate>
      {/* Deliberately OUTSIDE the gate. A sign-in failure or a dropped
          connection is exactly the kind of thing that happens while you are
          still on the access screen, and a notice layer that only exists once
          you are through the door cannot report it. */}
      <ConnectionWatcher />
      <Toaster />
    </>
  );
}
