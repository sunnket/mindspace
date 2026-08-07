'use client';

import { useEffect } from 'react';
import { MotionConfig } from 'framer-motion';
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
    /* Fifty-three files animate with framer-motion and exactly two of them
       asked whether the person watching wanted any of it. Someone with
       "reduce motion" set in their OS — because motion makes them ill, not
       because they dislike it — got every panel slide, every modal spring
       and every staggered list anyway.

       `reducedMotion="user"` is the switch for all of it at once: framer
       reads the media query and drops transform and layout animation
       throughout the tree, keeping opacity so nothing vanishes without
       explanation. Chasing it component by component would have been 53
       edits that drift apart the moment someone adds the 54th.

       It sits outside the gate for the same reason the notice layer does:
       the access screen animates too. */
    <MotionConfig reducedMotion="user">
      <AccessGate>{children}</AccessGate>
      {/* Deliberately OUTSIDE the gate. A sign-in failure or a dropped
          connection is exactly the kind of thing that happens while you are
          still on the access screen, and a notice layer that only exists once
          you are through the door cannot report it. */}
      <ConnectionWatcher />
      <Toaster />
    </MotionConfig>
  );
}
