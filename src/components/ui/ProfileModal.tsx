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

  const joined = new Date(user.created_at).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const displayName = fullName.trim() || user.email?.split('@')[0] || 'You';

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
        {/* Overlay */}
        <motion.div
          className="fixed inset-0 backdrop-blur-[5px]"
          style={{ background: 'rgba(45, 42, 38, 0.42)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        />

        {/* Modal content — same warm-accent clay world as the sign-in card. */}
        <motion.div
          className="relative w-full max-w-[400px] overflow-hidden rounded-[30px] clay-card z-10"
          style={{
            color: 'var(--text-primary)',
            ['--accent' as string]: '#D89A6E',
            ['--accent-rgb' as string]: '216, 154, 110',
            ['--accent-light' as string]: '#E9BE9B',
            ['--accent-subtle' as string]: 'rgba(216, 154, 110, 0.12)',
          }}
          initial={{ scale: 0.95, y: 16, opacity: 0 }}
          animate={{ scale: 1, y: 0, opacity: 1 }}
          exit={{ scale: 0.95, y: 16, opacity: 0 }}
          transition={{ type: 'spring', damping: 24, stiffness: 320 }}
        >
          {/* Cover band with a soft accent wash — the avatar overlaps it. */}
          <div
            className="relative h-24"
            style={{ background: 'linear-gradient(135deg, rgba(var(--accent-rgb),0.9), rgba(var(--accent-rgb),0.45))' }}
          >
            <div className="absolute inset-0 opacity-40" style={{ background: 'radial-gradient(120% 100% at 80% -20%, rgba(255,255,255,0.5), transparent 60%)' }} />
            <button
              onClick={onClose}
              type="button"
              aria-label="Close"
              className="absolute top-3.5 right-3.5 w-8 h-8 flex items-center justify-center rounded-full bg-white/25 text-white hover:bg-white/40 transition-colors cursor-pointer backdrop-blur-sm"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <div style={{ padding: '0 28px 26px' }}>
            {/* Avatar — overlaps the cover, click to change, hover shows a camera. */}
            <div className="flex flex-col items-center" style={{ marginTop: -44 }}>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="group relative w-[88px] h-[88px] rounded-full overflow-hidden cursor-pointer shrink-0"
                style={{ boxShadow: '0 0 0 4px var(--bg-secondary), 0 10px 24px -10px rgba(0,0,0,0.5)' }}
                title="Change photo"
                aria-label="Change profile photo"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={avatarUrl} alt="Your profile" className="w-full h-full object-cover" />
                <span className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity text-white">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" />
                  </svg>
                </span>
              </button>

              <h2 className="text-[22px] font-normal tracking-tight leading-tight mt-3 text-center max-w-full truncate" style={{ fontFamily: "'Playfair Display', serif" }}>
                {displayName}
              </h2>
              <p className="text-[11px] text-[var(--text-tertiary)] leading-tight mt-0.5 flex items-center gap-1.5">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>
                {user.email}
              </p>

              <div className="flex items-center gap-2 mt-3">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-full clay-inset text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                  style={{ padding: '6px 12px' }}
                >
                  Upload photo
                </button>
                <button
                  type="button"
                  onClick={handleRandomizeAvatar}
                  className="rounded-full clay-inset text-[10px] font-bold uppercase tracking-wider text-[var(--accent)] hover:brightness-105 transition-colors cursor-pointer flex items-center gap-1"
                  style={{ padding: '6px 12px' }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
                  Shuffle
                </button>
              </div>

              <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*" className="hidden" />
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4" style={{ marginTop: 22 }}>
              {/* Display name */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] uppercase tracking-[0.14em] font-bold text-[var(--text-muted)] px-1">
                  Display name
                </label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Enter your name"
                  className="w-full clay-inset rounded-2xl px-4 py-3 text-sm outline-none transition-shadow font-normal text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:ring-2 focus:ring-[var(--accent)]/40"
                  required
                />
                <p className="text-[10px] text-[var(--text-tertiary)] px-1 leading-snug">
                  This is the name and photo people see in chat &amp; live sessions.
                </p>
              </div>

              {/* Meta row */}
              <div className="flex items-center gap-2">
                <div className="flex-1 clay-inset rounded-2xl flex flex-col gap-0.5" style={{ padding: '10px 14px' }}>
                  <span className="text-[9px] uppercase tracking-wider font-extrabold text-[var(--text-muted)]">Member since</span>
                  <span className="text-[12px] font-semibold text-[var(--text-secondary)]">{joined}</span>
                </div>
                <div className="flex-1 clay-inset rounded-2xl flex flex-col gap-0.5" style={{ padding: '10px 14px' }}>
                  <span className="text-[9px] uppercase tracking-wider font-extrabold text-[var(--text-muted)]">Account</span>
                  <span className="text-[12px] font-semibold text-[var(--text-secondary)] flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Synced
                  </span>
                </div>
              </div>

              {errorMsg && (
                <div className="px-3.5 py-2.5 text-xs rounded-2xl font-normal leading-relaxed text-center" style={{ background: 'rgba(214, 106, 91, 0.12)', color: '#B4402F', border: '1px solid rgba(214,106,91,0.2)' }}>
                  {errorMsg}
                </div>
              )}
              {successMsg && (
                <div className="px-3.5 py-2.5 text-xs rounded-2xl font-normal leading-relaxed text-center" style={{ background: 'rgba(47, 158, 110, 0.12)', color: '#217A54', border: '1px solid rgba(47,158,110,0.2)' }}>
                  {successMsg}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-[var(--accent)] text-white text-sm font-bold rounded-full cursor-pointer shadow-[0_10px_22px_-8px_rgba(var(--accent-rgb),0.6),inset_0_1px_0_rgba(255,255,255,0.3)] hover:brightness-105 active:scale-[0.99] transition-all disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <><span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> Saving…</>
                ) : (
                  'Save changes'
                )}
              </button>
            </form>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
