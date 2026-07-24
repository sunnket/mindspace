'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuthStore } from '@/store/authStore';
import { checkSignupAccess, redeemAccessKey, requestAccess } from '@/lib/access';

type Mode = 'signin' | 'signup' | 'forgot' | 'update-password' | 'request';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialMode?: 'signin' | 'signup' | 'forgot' | 'update-password';
}

export default function AuthModal({ isOpen, onClose, initialMode = 'signin' }: AuthModalProps) {
  const [mode, setMode] = useState<Mode>(initialMode);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [loading, setLoading] = useState(false);

  /* Invite gate. `unlocked` means the database has confirmed this address is
     allowed to hold an account — only then are the password fields shown.
     It's a courtesy, not the lock: RLS and a trigger on auth.users refuse
     unapproved accounts no matter what this component renders. */
  const [accessKey, setAccessKey] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [reqName, setReqName] = useState('');
  const [reqReason, setReqReason] = useState('');

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
    setAccessKey('');
    setUnlocked(false);
    setReqName('');
    setReqReason('');
  };

  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      resetFormState();
    }
  }, [isOpen, initialMode]);

  const switchMode = (next: Mode) => {
    setMode(next);
    setErrorMsg('');
    setSuccessMsg('');
    setUnlocked(false);
  };

  /** Step 1 of sign-up: is this address invited, or does the key make it so? */
  const handleGate = async () => {
    const access = await checkSignupAccess(email);
    if (access === 'allowed') {
      setUnlocked(true);
      return;
    }

    if (accessKey.trim()) {
      const res = await redeemAccessKey(accessKey, email);
      if (res.ok) {
        setUnlocked(true);
        return;
      }
      setErrorMsg(res.error || 'That access key is not valid.');
      return;
    }

    setErrorMsg(
      access === 'pending'
        ? "Your request is in — you'll be let in once it's approved."
        : 'canvabrains is invite-only. Enter your access key, or request access below.'
    );
  };

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
        if (!unlocked) {
          await handleGate();
          setLoading(false);
          return;
        }
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
          // The allowlist trigger rejects the insert inside Postgres, which
          // GoTrue reports as an opaque "Database error saving new user".
          // Say what actually happened instead of surfacing that.
          const raw = error.message || '';
          setErrorMsg(
            /database error saving new user|not been approved/i.test(raw)
              ? 'That email is not approved for canvabrains. Ask the owner for an access key.'
              : raw || 'Failed to sign up.'
          );
        } else {
          setSuccessMsg('Verification email sent! Check your inbox to activate your account.');
        }
      } else if (mode === 'request') {
        const { status, error } = await requestAccess(email, reqName, reqReason);
        if (error) {
          setErrorMsg(error);
        } else if (status === 'approved') {
          setSuccessMsg("You're already approved — go ahead and create your account.");
          setTimeout(() => {
            switchMode('signup');
            setUnlocked(true);
          }, 1400);
        } else {
          setSuccessMsg("Request sent. You'll be able to sign up once it's approved.");
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
    } catch (err: unknown) {
      setErrorMsg((err as Error)?.message || 'An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  };

  const title =
    mode === 'signin' ? 'Welcome back'
    : mode === 'signup' ? (unlocked ? 'Make some space' : 'Invite only')
    : mode === 'request' ? 'Ask for a key'
    : mode === 'forgot' ? 'Reset your password'
    : 'Set a new password';
  const subtitle =
    mode === 'signin' ? 'Pick up your canvases and notes on any device.'
    : mode === 'signup' ? (unlocked
        ? 'Sync your local work to a private cloud account.'
        : 'This space is private. Enter your access key, or request one.')
    : mode === 'request' ? "Leave your email and the owner will decide. You'll get a key if approved."
    : mode === 'forgot' ? "Enter your email and we'll send a recovery link."
    : 'Type your new password below.';

  // Padding stays inline: the app-wide unlayered `* { padding: 0 }` reset
  // outranks Tailwind's padding utilities, so those render as nothing.
  const inputStyle: React.CSSProperties = { padding: '12px 16px' };
  const inputCls =
    'w-full clay-inset rounded-2xl text-sm outline-none transition-shadow font-normal ' +
    'text-[var(--text-primary)] placeholder:text-[var(--text-muted)] ' +
    'focus:ring-2 focus:ring-[var(--accent)]/40';
  const labelCls = 'text-[10px] uppercase tracking-[0.14em] font-bold text-[var(--text-muted)]';

  const emailLocked = mode === 'signup' && unlocked;
  const showEmail = mode !== 'update-password';
  const showPassword = mode === 'signin' || (mode === 'signup' && unlocked) || mode === 'update-password';
  const showConfirm = (mode === 'signup' && unlocked) || mode === 'update-password';
  const frozen = loading || successMsg.includes('Verification') || successMsg.includes('Request sent');

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
                {mode === 'signup' && !unlocked ? (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                ) : (
                  <span className="text-[var(--accent)] text-[30px] leading-none" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>c</span>
                )}
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
                <div className="text-xs rounded-2xl font-normal leading-relaxed" style={{ padding: '10px 14px', background: 'rgba(214, 106, 91, 0.12)', color: '#B4402F', border: '1px solid rgba(214,106,91,0.2)' }}>
                  {errorMsg}
                </div>
              )}
              {successMsg && (
                <div className="text-xs rounded-2xl font-normal leading-relaxed" style={{ padding: '10px 14px', background: 'rgba(47, 158, 110, 0.12)', color: '#217A54', border: '1px solid rgba(47,158,110,0.2)' }}>
                  {successMsg}
                </div>
              )}

              {showEmail && (
                <div className="flex flex-col gap-1.5">
                  <label className={labelCls + ' px-1'}>Email</label>
                  <input
                    required
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@domain.com"
                    className={inputCls}
                    style={{ ...inputStyle, opacity: emailLocked ? 0.7 : 1 }}
                    disabled={frozen || emailLocked}
                  />
                </div>
              )}

              {/* Sign-up step 1 — the key */}
              {mode === 'signup' && !unlocked && (
                <div className="flex flex-col gap-1.5">
                  <label className={labelCls + ' px-1'}>Access key</label>
                  <input
                    type="text"
                    value={accessKey}
                    onChange={(e) => setAccessKey(e.target.value.toUpperCase())}
                    placeholder="XXXX-XXXX-XXXX"
                    autoComplete="off"
                    spellCheck={false}
                    className={inputCls + ' tracking-[0.18em] font-semibold'}
                    style={inputStyle}
                    disabled={loading}
                  />
                  <span className="text-[10px] text-[var(--text-muted)] px-1 leading-relaxed">
                    Already approved? Leave this blank and continue.
                  </span>
                </div>
              )}

              {/* Request-access extras */}
              {mode === 'request' && (
                <>
                  <div className="flex flex-col gap-1.5">
                    <label className={labelCls + ' px-1'}>Your name</label>
                    <input
                      type="text"
                      value={reqName}
                      onChange={(e) => setReqName(e.target.value)}
                      placeholder="What should I call you?"
                      className={inputCls}
                      style={inputStyle}
                      disabled={frozen}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className={labelCls + ' px-1'}>Why you&apos;d like in</label>
                    <textarea
                      value={reqReason}
                      onChange={(e) => setReqReason(e.target.value)}
                      placeholder="A line or two — how we know each other, what you'd use it for."
                      rows={3}
                      maxLength={500}
                      className={inputCls + ' resize-none'}
                      style={inputStyle}
                      disabled={frozen}
                    />
                  </div>
                </>
              )}

              {showPassword && (
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between items-center px-1">
                    <label className={labelCls}>Password</label>
                    {mode === 'signin' && (
                      <button
                        type="button"
                        onClick={() => switchMode('forgot')}
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
                    style={inputStyle}
                    disabled={frozen}
                  />
                </div>
              )}

              {showConfirm && (
                <div className="flex flex-col gap-1.5">
                  <label className={labelCls + ' px-1'}>Confirm password</label>
                  <input
                    required
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className={inputCls}
                    style={inputStyle}
                    disabled={loading}
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={frozen}
                style={{ padding: '12px 20px' }}
                className="w-full bg-[var(--accent)] text-white font-bold rounded-full text-sm transition-all mt-2 shadow-sm flex items-center justify-center gap-2 cursor-pointer hover:brightness-105 active:scale-[0.99] disabled:opacity-60"
              >
                {loading ? (
                  <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    {mode === 'signin' && 'Sign in'}
                    {mode === 'signup' && (unlocked ? 'Create account' : 'Continue')}
                    {mode === 'request' && 'Send request'}
                    {mode === 'forgot' && 'Send reset link'}
                    {mode === 'update-password' && 'Update password'}
                  </>
                )}
              </button>
            </form>

            {/* Mode switch */}
            <div className="relative text-center mt-5 text-xs text-[var(--text-tertiary)] font-normal">
              {mode === 'signin' && (
                <p>Been invited?{' '}
                  <button onClick={() => switchMode('signup')} className="text-[var(--accent)] hover:underline font-bold cursor-pointer">Use your access key</button>
                </p>
              )}
              {mode === 'signup' && !unlocked && (
                <p>No key?{' '}
                  <button onClick={() => switchMode('request')} className="text-[var(--accent)] hover:underline font-bold cursor-pointer">Request access</button>
                  {' · '}
                  <button onClick={() => switchMode('signin')} className="text-[var(--accent)] hover:underline font-bold cursor-pointer">Sign in</button>
                </p>
              )}
              {mode === 'signup' && unlocked && (
                <p>Already have an account?{' '}
                  <button onClick={() => switchMode('signin')} className="text-[var(--accent)] hover:underline font-bold cursor-pointer">Sign in</button>
                </p>
              )}
              {mode === 'request' && (
                <p>Got a key after all?{' '}
                  <button onClick={() => switchMode('signup')} className="text-[var(--accent)] hover:underline font-bold cursor-pointer">Enter it</button>
                </p>
              )}
              {mode === 'forgot' && (
                <p>Remembered it?{' '}
                  <button onClick={() => switchMode('signin')} className="text-[var(--accent)] hover:underline font-bold cursor-pointer">Sign in</button>
                </p>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
