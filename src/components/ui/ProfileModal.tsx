'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuthStore } from '@/store/authStore';
import { supabase } from '@/lib/supabaseClient';

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ProfileModal({ isOpen, onClose }: ProfileModalProps) {
  const { user } = useAuthStore();
  const [fullName, setFullName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && user) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFullName(user.user_metadata?.full_name || user.email?.split('@')[0] || '');
      setAvatarUrl(
        user.user_metadata?.avatar_url ||
        `https://api.dicebear.com/7.x/shapes/svg?seed=${encodeURIComponent(user.email || user.id)}`
      );
      setErrorMsg('');
      setSuccessMsg('');
    }
  }, [isOpen, user]);

  if (!isOpen || !user) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setErrorMsg('Image must be under 5MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const size = Math.min(img.width, img.height);
          const sx = (img.width - size) / 2;
          const sy = (img.height - size) / 2;
          ctx.drawImage(img, sx, sy, size, size, 0, 0, 128, 128);
          
          try {
            const base64 = canvas.toDataURL('image/jpeg', 0.85);
            setAvatarUrl(base64);
            setErrorMsg('');
          } catch {
            setErrorMsg('Failed to process image file.');
          }
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleRandomizeAvatar = () => {
    const randomSeed = Math.random().toString(36).substring(7);
    const newAvatar = `https://api.dicebear.com/7.x/shapes/svg?seed=${encodeURIComponent(randomSeed)}`;
    setAvatarUrl(newAvatar);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    setLoading(true);

    try {
      const trimmedName = fullName.trim();
      const { error } = await supabase.auth.updateUser({
        data: {
          full_name: trimmedName,
          avatar_url: avatarUrl,
        },
      });

      if (error) {
        setErrorMsg(error.message || 'Failed to update profile.');
      } else {
        // Mirror the name + photo into the PUBLIC profiles table so other
        // people see them in chat. Auth metadata is private to each user, so
        // without this the DM chat only ever had the auto-generated handle to
        // show — hence the "it shows my initials, not my photo" bug. Best-effort
        // (the auth update already succeeded); needs schema_chat_profiles.sql.
        supabase
          .from('profiles')
          .update({ display_name: trimmedName, avatar_url: avatarUrl })
          .eq('id', user.id)
          .then(({ error: profErr }) => {
            if (profErr) console.error('[profile] failed to sync profiles row:', profErr);
          });

        setSuccessMsg('Profile updated successfully!');
        setTimeout(() => {
          onClose();
        }, 1200);
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'An error occurred.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
        {/* Overlay */}
        <motion.div
          className="fixed inset-0 bg-black/45 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        />

        {/* Modal content */}
        <motion.div
          className="relative w-full max-w-md overflow-hidden rounded-[26px] clay-card p-8 border border-white/20 dark:border-white/10 z-10"
          style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
          initial={{ scale: 0.9, y: 15, opacity: 0 }}
          animate={{ scale: 1, y: 0, opacity: 1 }}
          exit={{ scale: 0.9, y: 15, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 280 }}
        >
          {/* Close button */}
          <button
            onClick={onClose}
            type="button"
            aria-label="Close"
            className="absolute top-5 right-5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>

          <h2 className="text-xl font-bold tracking-tight mb-6" style={{ fontFamily: "'Playfair Display', serif" }}>
            My Profile
          </h2>

          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            {/* Avatar block */}
            <div className="flex flex-col items-center gap-3.5 mb-2">
              <div className="relative w-20 h-20 rounded-full border-2 border-[var(--accent)]/30 overflow-hidden flex items-center justify-center shadow-md bg-[var(--bg-primary)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={avatarUrl} alt="User profile" className="w-full h-full object-cover" />
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3.5 py-1.5 rounded-lg clay-inset text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                >
                  Upload Photo
                </button>
                <button
                  type="button"
                  onClick={handleRandomizeAvatar}
                  className="px-3.5 py-1.5 rounded-lg clay-inset text-[10px] font-bold uppercase tracking-wider text-[var(--accent)] hover:brightness-105 transition-colors cursor-pointer"
                >
                  Randomize
                </button>
              </div>

              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept="image/*"
                className="hidden"
              />
            </div>

            {/* Email Field (Read-only) */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[9px] uppercase tracking-wider font-extrabold text-[var(--text-muted)]">
                Email Address
              </label>
              <input
                type="email"
                value={user.email || ''}
                disabled
                className="clay-inset bg-transparent opacity-60 w-full px-4 py-2.5 rounded-xl text-xs outline-none cursor-not-allowed text-[var(--text-secondary)]"
              />
            </div>

            {/* Full name field */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[9px] uppercase tracking-wider font-extrabold text-[var(--text-muted)]">
                Full Name / Username
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Enter your name"
                className="clay-inset bg-transparent w-full px-4 py-2.5 rounded-xl text-xs outline-none border border-transparent focus:border-[var(--accent)] transition-all text-[var(--text-primary)]"
                required
              />
            </div>

            {/* Info Section (Read-only) */}
            <div className="flex flex-col gap-1 text-[9px] text-[var(--text-muted)] px-1 mt-1 font-mono">
              <div className="flex justify-between">
                <span>USER ID:</span>
                <span className="truncate max-w-[200px]" title={user.id}>{user.id}</span>
              </div>
              <div className="flex justify-between">
                <span>JOINED:</span>
                <span>{new Date(user.created_at).toLocaleDateString()}</span>
              </div>
            </div>

            {/* Error / Success Feedback */}
            {errorMsg && (
              <p className="text-red-500 text-xs font-medium text-center mt-1 bg-red-500/10 py-1.5 rounded-xl">
                {errorMsg}
              </p>
            )}
            {successMsg && (
              <p className="text-emerald-500 text-xs font-medium text-center mt-1 bg-emerald-500/10 py-1.5 rounded-xl">
                {successMsg}
              </p>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-3 bg-[var(--accent)] text-white text-xs font-extrabold uppercase tracking-widest rounded-xl cursor-pointer shadow-[0_12px_24px_-8px_rgba(var(--accent-rgb),0.55),inset_0_1px_0_rgba(255,255,255,0.35)] hover:brightness-105 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <span className="w-3.5 h-3.5 border border-t-transparent border-white rounded-full animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </button>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
