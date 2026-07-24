'use client';

import { useEffect } from 'react';
import { useAuthStore } from '@/store/authStore';
import AccessGate from './AccessGate';

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const initializeAuth = useAuthStore((s) => s.initializeAuth);

  useEffect(() => {
    initializeAuth();
  }, [initializeAuth]);

  return <AccessGate>{children}</AccessGate>;
}
