'use client';

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuthStore } from '@/store/authStore';
import { useCanvasStore } from '@/store/canvasStore';
import AuthModal from './AuthModal';

interface AuthButtonProps {
  hideGuest?: boolean;
  isInline?: boolean;
}

export default function AuthButton({ hideGuest = false, isInline = false }: AuthButtonProps) {
  const { user, signOut, loading } = useAuthStore();
  const isDirty = useCanvasStore((s) => s.isDirty);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'signin' | 'signup' | 'forgot'>('signin');
  const [dropdownOpen, setDropdownOpen] = useState(false);
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

  if (hideGuest && !user && !loading) {
    return null;
  }

  return (
    <>
      <div 
        className={isInline ? "relative flex items-center gap-3 pointer-events-auto" : "fixed top-12 right-10 z-50 pointer-events-auto flex items-center gap-3"} 
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
                <span className="text-xs text-[var(--text-primary)] font-light leading-none">{user.email?.split('@')[0]}</span>
                <span className="text-[9px] text-[var(--text-muted)] font-light leading-none mt-1 flex items-center gap-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${isDirty ? 'bg-[var(--accent)] animate-pulse' : 'bg-emerald-500'}`} />
                  {isDirty ? 'Saving...' : 'Synced'}
                </span>
              </div>
              <div className="w-8 h-8 rounded-full bg-[var(--accent)] text-white hover:bg-[var(--accent-subtle)] hover:text-[var(--accent)] border border-transparent hover:border-[var(--accent)] font-medium flex items-center justify-center text-xs tracking-wider transition-all shadow-sm">
                {getInitials()}
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
                  className="absolute right-0 mt-2.5 w-56 glass-panel border border-white/20 p-2.5 shadow-xl rounded-xl"
                  style={{ background: 'rgba(250, 246, 241, 0.96)', color: 'var(--text-primary)' }}
                >
                  {/* Dropdown Header */}
                  <div className="px-3 py-2 border-b border-black/5 mb-1.5">
                    <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-light">Account</p>
                    <p className="text-xs font-normal truncate mt-0.5" title={user.email}>{user.email}</p>
                  </div>

                  {/* Dropdown Items */}
                  <button
                    onClick={() => {
                      setDropdownOpen(false);
                      setModalMode('signin'); // Switch triggers recovery checks internally
                      setModalOpen(true);
                    }}
                    className="w-full text-left px-3 py-2 text-xs font-light hover:bg-white/60 hover:text-[var(--accent)] rounded-lg transition-colors flex items-center justify-between group cursor-pointer"
                  >
                    <span>Update Password</span>
                    <span className="text-[10px] text-[var(--text-muted)] group-hover:text-[var(--accent)]">✎</span>
                  </button>

                  <button
                    onClick={handleSignOut}
                    className="w-full text-left px-3 py-2 text-xs font-light hover:bg-red-50 text-red-500 hover:text-red-600 rounded-lg transition-colors flex items-center justify-between group mt-1 cursor-pointer"
                  >
                    <span>Sign Out</span>
                    <span className="text-[10px] opacity-70">➔</span>
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
    </>
  );
}
