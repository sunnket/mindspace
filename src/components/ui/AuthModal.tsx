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

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center pointer-events-auto">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/35 backdrop-blur-[4px]"
          />

          {/* Modal Content */}
          <motion.div
            initial={{ scale: 0.94, opacity: 0, y: 15 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.94, opacity: 0, y: 15 }}
            transition={{ type: 'spring', damping: 25, stiffness: 350 }}
            className="relative w-full max-w-md mx-4 glass-panel border border-white/20 p-8 shadow-2xl rounded-2xl flex flex-col z-10"
            style={{
              background: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
            }}
          >
            {/* Close Button */}
            <button
              onClick={onClose}
              className="absolute top-5 right-5 text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors text-sm w-7 h-7 flex items-center justify-center rounded-full hover:bg-white/50"
            >
              ✕
            </button>

            {/* Header */}
            <div className="text-center mb-6">
              <h2 className="text-2xl font-light tracking-tight mb-2" style={{ fontFamily: "'Outfit', sans-serif" }}>
                {mode === 'signin' && 'Welcome back'}
                {mode === 'signup' && 'Create space'}
                {mode === 'forgot' && 'Reset password'}
                {mode === 'update-password' && 'Enter new password'}
              </h2>
              <p className="text-xs text-[var(--text-muted)] font-light">
                {mode === 'signin' && 'Access your canvases and notes from any device'}
                {mode === 'signup' && 'Sync your local canvas offline work to a secure cloud account'}
                {mode === 'forgot' && "Enter your email and we'll send you a recovery link"}
                {mode === 'update-password' && 'Please type your new password below'}
              </p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {/* Error & Success Messages */}
              {errorMsg && (
                <div className="p-3 text-xs bg-red-50 text-red-600 rounded-lg border border-red-100 font-light leading-relaxed">
                  {errorMsg}
                </div>
              )}
              {successMsg && (
                <div className="p-3 text-xs bg-emerald-50 text-emerald-600 rounded-lg border border-emerald-100 font-light leading-relaxed">
                  {successMsg}
                </div>
              )}

              {/* Email Input */}
              {mode !== 'update-password' && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Email Address</label>
                  <input
                    required
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@domain.com"
                    className="w-full bg-white/70 dark:bg-white/10 border border-black/10 dark:border-white/15 focus:border-[var(--accent)] rounded-lg px-3 py-2 text-sm outline-none transition-all font-light"
                    disabled={loading || successMsg.includes('Verification')}
                  />
                </div>
              )}

              {/* Password Input */}
              {mode !== 'forgot' && (
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Password</label>
                    {mode === 'signin' && (
                      <button
                        type="button"
                        onClick={() => setMode('forgot')}
                        className="text-[10px] text-[var(--accent)] hover:underline"
                      >
                        Forgot password?
                      </button>
                    )}
                  </div>
                  <input
                    required
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-white/70 dark:bg-white/10 border border-black/10 dark:border-white/15 focus:border-[var(--accent)] rounded-lg px-3 py-2 text-sm outline-none transition-all font-light"
                    disabled={loading || successMsg.includes('Verification')}
                  />
                </div>
              )}

              {/* Confirm Password Input */}
              {(mode === 'signup' || mode === 'update-password') && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Confirm Password</label>
                  <input
                    required
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-white/70 dark:bg-white/10 border border-black/10 dark:border-white/15 focus:border-[var(--accent)] rounded-lg px-3 py-2 text-sm outline-none transition-all font-light"
                    disabled={loading}
                  />
                </div>
              )}

              {/* Submit Button */}
              <button
                type="submit"
                disabled={loading || successMsg.includes('Verification')}
                className="w-full bg-[var(--accent)] hover:bg-[var(--accent-subtle)] text-white hover:text-[var(--accent)] border border-transparent hover:border-[var(--accent)] font-medium rounded-lg py-2.5 text-sm transition-all mt-2 shadow-sm flex items-center justify-center gap-2 cursor-pointer"
              >
                {loading ? (
                  <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    {mode === 'signin' && 'Sign In'}
                    {mode === 'signup' && 'Create Account'}
                    {mode === 'forgot' && 'Send Reset Link'}
                    {mode === 'update-password' && 'Update Password'}
                  </>
                )}
              </button>
            </form>

            {/* Mode Switch Footers */}
            <div className="text-center mt-6 pt-4 border-t border-black/5 text-xs text-[var(--text-muted)] font-light">
              {mode === 'signin' && (
                <p>
                  New to Mindspace?{' '}
                  <button onClick={() => setMode('signup')} className="text-[var(--accent)] hover:underline font-normal">
                    Create an account
                  </button>
                </p>
              )}
              {mode === 'signup' && (
                <p>
                  Already have an account?{' '}
                  <button onClick={() => setMode('signin')} className="text-[var(--accent)] hover:underline font-normal">
                    Sign in
                  </button>
                </p>
              )}
              {mode === 'forgot' && (
                <p>
                  Remember your password?{' '}
                  <button onClick={() => setMode('signin')} className="text-[var(--accent)] hover:underline font-normal">
                    Sign in
                  </button>
                </p>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
