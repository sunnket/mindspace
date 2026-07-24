'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuthStore } from '@/store/authStore';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialMode?: 'signin' | 'signup' | 'forgot' | 'update-password';
}

export default function AuthModal({ isOpen, onClose, initialMode = 'signin' }: AuthModalProps) {
  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot' | 'update-password'>(initialMode);
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const { signIn, signUp, resetPassword, updatePassword } = useAuthStore();

  // Detect if user landed on the page from a password recovery link
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const hash = window.location.hash;
      if (hash.includes('type=recovery') || hash.includes('recovery')) {
        setMode('update-password');
        // Clean hash to avoid loop
        window.history.replaceState(null, '', window.location.pathname);
      }
    }
  }, []);

  const resetFormState = () => {
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setErrorMsg('');
    setSuccessMsg('');
    setLoading(false);
  };

  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      resetFormState();
    }
  }, [isOpen, initialMode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    setLoading(true);

    try {
      if (mode === 'signin') {
        const { error } = await signIn(email, password);
        if (error) {
          setErrorMsg(error.message || 'Failed to sign in. Please check your credentials.');
        } else {
          setSuccessMsg('Successfully signed in!');
          setTimeout(() => {
            onClose();
          }, 1000);
        }
      } else if (mode === 'signup') {
        if (password !== confirmPassword) {
          setErrorMsg('Passwords do not match');
          setLoading(false);
          return;
        }
        if (password.length < 6) {
          setErrorMsg('Password must be at least 6 characters');
          setLoading(false);
          return;
        }

        const { error } = await signUp(email, password);
        if (error) {
          setErrorMsg(error.message || 'Failed to sign up.');
        } else {
          setSuccessMsg('Verification email sent! Check your inbox to activate your account.');
        }
      } else if (mode === 'forgot') {
        const { error } = await resetPassword(email);
        if (error) {
          setErrorMsg(error.message || 'Could not send reset link.');
        } else {
          setSuccessMsg('Password reset link sent to your email!');
        }
      } else if (mode === 'update-password') {
        if (password !== confirmPassword) {
          setErrorMsg('Passwords do not match');
          setLoading(false);
          return;
        }
        if (password.length < 6) {
          setErrorMsg('Password must be at least 6 characters');
          setLoading(false);
          return;
        }

        const { error } = await updatePassword(password);
        if (error) {
          setErrorMsg(error.message || 'Failed to update password.');
        } else {
          setSuccessMsg('Password updated successfully! Redirecting...');
          setTimeout(() => {
            setMode('signin');
            resetFormState();
          }, 2000);
        }
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  };

  const title =
    mode === 'signin' ? 'Welcome back'
    : mode === 'signup' ? 'Make some space'
    : mode === 'forgot' ? 'Reset your password'
    : 'Set a new password';
  const subtitle =
    mode === 'signin' ? 'Pick up your canvases and notes on any device.'
    : mode === 'signup' ? 'Sync your local work to a private cloud account.'
    : mode === 'forgot' ? "Enter your email and we'll send a recovery link."
    : 'Type your new password below.';

  const inputCls =
    'w-full clay-inset rounded-2xl px-4 py-3 text-sm outline-none transition-shadow font-normal ' +
    'text-[var(--text-primary)] placeholder:text-[var(--text-muted)] ' +
    'focus:ring-2 focus:ring-[var(--accent)]/40';

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center pointer-events-auto">
          {/* Warm blurred backdrop, matching the landing's paper mood */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 backdrop-blur-[5px]"
            style={{ background: 'rgba(45, 42, 38, 0.42)' }}
          />

          {/* Clay card — same language as the landing gallery. Softer accent
              scoped here so the modal reads as part of that world. */}
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 16 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 16 }}
            transition={{ type: 'spring', damping: 24, stiffness: 320 }}
            className="relative w-full max-w-md mx-4 clay-card rounded-[30px] flex flex-col z-10 overflow-hidden"
            style={{
              color: 'var(--text-primary)',
              padding: '34px 32px 28px',
              ['--accent' as string]: '#D89A6E',
              ['--accent-rgb' as string]: '216, 154, 110',
              ['--accent-light' as string]: '#E9BE9B',
              ['--accent-subtle' as string]: 'rgba(216, 154, 110, 0.12)',
            }}
          >
            {/* soft accent bloom in the corner, like the Continue card */}
            <div className="absolute -top-24 -right-20 w-64 h-64 rounded-full pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(var(--accent-rgb),0.14), transparent 65%)' }} />

            {/* Close */}
            <button
              onClick={onClose}
              aria-label="Close"
              className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors cursor-pointer"
              style={{ background: 'var(--well)' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>

            {/* Brand + header */}
            <div className="relative flex flex-col items-center text-center gap-3.5 mb-6">
              <div className="w-14 h-14 rounded-2xl clay-inset flex items-center justify-center" aria-hidden="true">
                <span className="text-[var(--accent)] text-[30px] leading-none" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>c</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[13px] font-light tracking-tight leading-none text-[var(--text-tertiary)]" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>
                  canvabrains
                </span>
                <h2 className="text-[26px] font-normal tracking-tight leading-tight" style={{ fontFamily: "'Playfair Display', serif" }}>
                  {title}
                </h2>
                <p className="text-[12px] text-[var(--text-tertiary)] font-normal leading-relaxed" style={{ maxWidth: 300 }}>
                  {subtitle}
                </p>
              </div>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="relative flex flex-col gap-3.5">
              {errorMsg && (
                <div className="px-3.5 py-2.5 text-xs rounded-2xl font-normal leading-relaxed" style={{ background: 'rgba(214, 106, 91, 0.12)', color: '#B4402F', border: '1px solid rgba(214,106,91,0.2)' }}>
                  {errorMsg}
                </div>
              )}
              {successMsg && (
                <div className="px-3.5 py-2.5 text-xs rounded-2xl font-normal leading-relaxed" style={{ background: 'rgba(47, 158, 110, 0.12)', color: '#217A54', border: '1px solid rgba(47,158,110,0.2)' }}>
                  {successMsg}
                </div>
              )}

              {mode !== 'update-password' && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] uppercase tracking-[0.14em] font-bold text-[var(--text-muted)] px-1">Email</label>
                  <input
                    required
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@domain.com"
                    className={inputCls}
                    disabled={loading || successMsg.includes('Verification')}
                  />
                </div>
              )}

              {mode !== 'forgot' && (
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between items-center px-1">
                    <label className="text-[10px] uppercase tracking-[0.14em] font-bold text-[var(--text-muted)]">Password</label>
                    {mode === 'signin' && (
                      <button
                        type="button"
                        onClick={() => setMode('forgot')}
                        className="text-[10px] font-semibold text-[var(--accent)] hover:underline cursor-pointer"
                      >
                        Forgot?
                      </button>
                    )}
                  </div>
                  <input
                    required
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className={inputCls}
                    disabled={loading || successMsg.includes('Verification')}
                  />
                </div>
              )}

              {(mode === 'signup' || mode === 'update-password') && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] uppercase tracking-[0.14em] font-bold text-[var(--text-muted)] px-1">Confirm password</label>
                  <input
                    required
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className={inputCls}
                    disabled={loading}
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={loading || successMsg.includes('Verification')}
                className="w-full bg-[var(--accent)] text-white font-bold rounded-full py-3 text-sm transition-all mt-2 shadow-sm flex items-center justify-center gap-2 cursor-pointer hover:brightness-105 active:scale-[0.99] disabled:opacity-60"
              >
                {loading ? (
                  <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    {mode === 'signin' && 'Sign in'}
                    {mode === 'signup' && 'Create account'}
                    {mode === 'forgot' && 'Send reset link'}
                    {mode === 'update-password' && 'Update password'}
                  </>
                )}
              </button>
            </form>

            {/* Mode switch */}
            <div className="relative text-center mt-5 text-xs text-[var(--text-tertiary)] font-normal">
              {mode === 'signin' && (
                <p>New here?{' '}
                  <button onClick={() => setMode('signup')} className="text-[var(--accent)] hover:underline font-bold cursor-pointer">Create an account</button>
                </p>
              )}
              {mode === 'signup' && (
                <p>Already have an account?{' '}
                  <button onClick={() => setMode('signin')} className="text-[var(--accent)] hover:underline font-bold cursor-pointer">Sign in</button>
                </p>
              )}
              {mode === 'forgot' && (
                <p>Remembered it?{' '}
                  <button onClick={() => setMode('signin')} className="text-[var(--accent)] hover:underline font-bold cursor-pointer">Sign in</button>
                </p>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
