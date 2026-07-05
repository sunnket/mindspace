import { create } from 'zustand';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import { pullCloudToLocal, migrateGuestData } from '@/lib/syncService';

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  initialized: boolean;
  setSession: (session: Session | null) => void;
  initializeAuth: () => Promise<void>;
  
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signUp: (email: string, password: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string, redirectTo?: string) => Promise<{ error: any }>;
  updatePassword: (password: string) => Promise<{ error: any }>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  session: null,
  loading: true,
  initialized: false,

  setSession: (session) => {
    set({
      session,
      user: session?.user ?? null,
      loading: false,
    });
  },

  initializeAuth: async () => {
    if (get().initialized) return;

    try {
      // 1. Get initial session
      const { data: { session } } = await supabase.auth.getSession();
      set({
        session,
        user: session?.user ?? null,
        loading: false,
        initialized: true,
      });

      // 2. Set up auth state change listener
      supabase.auth.onAuthStateChange(async (event, newSession) => {
        set({
          session: newSession,
          user: newSession?.user ?? null,
          loading: false,
        });

        // Trigger syncing on login / session restore
        if (newSession) {
          const userId = newSession.user.id;
          const storageKey = `auth_synced_${userId}`;
          const alreadySynced = sessionStorage.getItem(storageKey);
          
          if (!alreadySynced) {
            sessionStorage.setItem(storageKey, 'true');
            // Pull down user's existing work if there is any, otherwise migrate guest work to account
            const pulled = await pullCloudToLocal(userId);
            if (!pulled) {
              await migrateGuestData(userId);
            }
            // Reload window to make sure canvas renders the fetched data
            window.location.reload();
          }
        } else if (event === 'SIGNED_OUT') {
          // Clear storage on logout to allow clean syncs for future sign-ins
          sessionStorage.clear();
        }
      });
    } catch (err) {
      console.error('Failed to initialize auth:', err);
      set({ loading: false, initialized: true });
    }
  },

  signIn: async (email, password) => {
    set({ loading: true });
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        set({ loading: false });
        return { error };
      }
      set({
        session: data.session,
        user: data.user,
        loading: false,
      });
      return { error: null };
    } catch (err: any) {
      set({ loading: false });
      return { error: err };
    }
  },

  signUp: async (email, password) => {
    set({ loading: true });
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
      });
      if (error) {
        set({ loading: false });
        return { error };
      }
      set({
        session: data.session,
        user: data.user,
        loading: false,
      });
      return { error: null };
    } catch (err: any) {
      set({ loading: false });
      return { error: err };
    }
  },

  signOut: async () => {
    set({ loading: true });
    try {
      await supabase.auth.signOut();
      // Clear IndexedDB local database on logout to protect user's privacy
      const { clearAll } = await import('@/lib/db');
      await clearAll();
      set({
        session: null,
        user: null,
        loading: false,
      });
      // Force reload to reset canvas elements to defaults
      window.location.reload();
    } catch (err) {
      console.error('Logout error:', err);
      set({ loading: false });
    }
  },

  resetPassword: async (email, redirectTo) => {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: redirectTo || `${window.location.origin}/canvas`,
      });
      return { error };
    } catch (err: any) {
      return { error: err };
    }
  },

  updatePassword: async (password) => {
    set({ loading: true });
    try {
      const { error } = await supabase.auth.updateUser({
        password: password,
      });
      set({ loading: false });
      return { error };
    } catch (err: any) {
      set({ loading: false });
      return { error: err };
    }
  },
}));
