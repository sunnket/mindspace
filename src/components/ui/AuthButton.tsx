'use client';

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuthStore } from '@/store/authStore';
import { useCanvasStore } from '@/store/canvasStore';
import AuthModal from './AuthModal';
import ProfileModal from './ProfileModal';

interface AuthButtonProps {
  hideGuest?: boolean;
  isInline?: boolean;
}

export default function AuthButton({ hideGuest = false, isInline = false }: AuthButtonProps) {
  const { user, signOut, loading } = useAuthStore();
  const isDirty = useCanvasStore((s) => s.isDirty);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'signin' | 'signup' | 'forgot' | 'update-password'>('signin');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSignOut = async () => {
    setDropdownOpen(false);
    await signOut();
  };

  const handleOpenAuth = (mode: 'signin' | 'signup') => {
    setModalMode(mode);
    setModalOpen(true);
  };

  const getInitials = () => {
    if (!user?.email) return '?';
    const parts = user.email.split('@')[0].split(/[._-]/);
    if (parts.length > 1) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return parts[0].substring(0, 2).toUpperCase();
  };

  const avatarUrl = user?.user_metadata?.avatar_url || (user?.email ? `https://api.dicebear.com/7.x/shapes/svg?seed=${encodeURIComponent(user.email)}` : null);
  const displayName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || '';

  if (hideGuest && !user && !loading) {
    return null;
  }

  return (
    <>
      <div 
        className={isInline ? "relative flex items-center gap-3 pointer-events-auto z-50" : "fixed top-12 right-10 z-50 pointer-events-auto flex items-center gap-3"} 
        ref={dropdownRef}
      >
        {loading ? (
          <div className="w-8 h-8 rounded-full border border-black/5 bg-white/40 flex items-center justify-center">
            <span className="w-3.5 h-3.5 border border-t-transparent border-[var(--accent)] rounded-full animate-spin" />
          </div>
        ) : user ? (
          <div className="relative">
            {/* Logged in: Profile Avatar Button */}
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center gap-2 group focus:outline-none cursor-pointer"
            >
              {/* Sync Status Orb */}
              <div className="flex flex-col items-end text-right hidden sm:flex">
                <span className="text-xs text-[var(--text-primary)] font-light leading-none">{displayName}</span>
                <span className="text-[9px] text-[var(--text-muted)] font-light leading-none mt-1 flex items-center gap-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${isDirty ? 'bg-[var(--accent)] animate-pulse' : 'bg-emerald-500'}`} />
                  {isDirty ? 'Saving...' : 'Synced'}
                </span>
              </div>
              <div className="w-8 h-8 rounded-full border border-black/10 overflow-hidden flex items-center justify-center transition-all shadow-sm shrink-0 bg-[var(--bg-primary)]">
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-[var(--accent)] text-white font-medium flex items-center justify-center text-xs tracking-wider">
                    {getInitials()}
                  </div>
                )}
              </div>
            </button>

            {/* Dropdown Menu */}
            <AnimatePresence>
              {dropdownOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 8, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.95 }}
                  transition={{ type: 'spring', damping: 20, stiffness: 300 }}
                  className="absolute right-0 mt-2.5 w-56 glass-panel border border-white/20 dark:border-white/10 p-2.5 shadow-xl rounded-xl z-50"
                  style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                >
                  {/* Dropdown Header */}
                  <div className="px-3 py-2 border-b border-black/5 mb-1.5 flex items-center gap-2">
                    <div className="w-6.5 h-6.5 rounded-full overflow-hidden shrink-0 border border-black/10 bg-[var(--bg-primary)]">
                      {avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full bg-[var(--accent)] text-white text-[9px] font-bold flex items-center justify-center">
                          {getInitials()}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-light">Account</p>
                      <p className="text-xs font-normal truncate mt-0.5 text-[var(--text-primary)]" title={user.email}>{user.email}</p>
                    </div>
                  </div>

                  {/* Dropdown Items */}
                  <button
                    onClick={() => {
                      setDropdownOpen(false);
                      setProfileOpen(true);
                    }}
                    className="w-full text-left px-3 py-2 text-xs font-light hover:bg-white/60 dark:hover:bg-white/10 hover:text-[var(--accent)] rounded-lg transition-colors flex items-center justify-between group cursor-pointer"
                  >
                    <span>My Profile</span>
                    <span className="text-[var(--text-muted)] group-hover:text-[var(--accent)] flex items-center">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                        <circle cx="12" cy="7" r="4" />
                      </svg>
                    </span>
                  </button>

                  <button
                    onClick={() => {
                      setDropdownOpen(false);
                      setModalMode('update-password');
                      setModalOpen(true);
                    }}
                    className="w-full text-left px-3 py-2 text-xs font-light hover:bg-white/60 dark:hover:bg-white/10 hover:text-[var(--accent)] rounded-lg transition-colors flex items-center justify-between group cursor-pointer mt-0.5"
                  >
                    <span>Update Password</span>
                    <span className="text-[var(--text-muted)] group-hover:text-[var(--accent)] flex items-center">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                      </svg>
                    </span>
                  </button>

                  <button
                    onClick={handleSignOut}
                    className="w-full text-left px-3 py-2 text-xs font-light hover:bg-red-50 text-red-500 hover:text-red-600 rounded-lg transition-colors flex items-center justify-between group mt-1 cursor-pointer"
                  >
                    <span>Sign Out</span>
                    <span className="opacity-70 flex items-center">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                        <polyline points="16 17 21 12 16 7" />
                        <line x1="21" y1="12" x2="9" y2="12" />
                      </svg>
                    </span>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ) : (
          /* Guest: Sign In Button */
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleOpenAuth('signin')}
              className="glass-panel px-4 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--accent)] hover:border-[var(--accent)] hover:shadow-sm transition-all focus:outline-none cursor-pointer"
            >
              Sign In
            </button>
            <button
              onClick={() => handleOpenAuth('signup')}
              className="bg-[var(--accent)] hover:bg-[var(--accent-subtle)] text-white hover:text-[var(--accent)] border border-transparent hover:border-[var(--accent)] px-4 py-1.5 text-xs font-medium rounded-xl transition-all shadow-sm focus:outline-none cursor-pointer"
            >
              Sign Up
            </button>
          </div>
        )}
      </div>

      {/* Auth Dialog */}
      <AuthModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        initialMode={modalMode}
      />

      {/* Profile Dialog */}
      <ProfileModal
        isOpen={profileOpen}
        onClose={() => setProfileOpen(false)}
      />
    </>
  );
}
