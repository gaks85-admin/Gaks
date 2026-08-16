// src/components/Auth.tsx
import React, { useState } from 'react';
import { supabase } from '../supabaseClient';
import { Lock, Mail, ArrowLeft, AlertCircle, Eye, EyeOff, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export interface AuthProps {
  onAuthSuccess: (session: any) => void;
  initialMode?: 'login' | 'signup' | 'forgot' | 'reset' | 'verification';
  isInitializing?: boolean;
}

export function AuthSkeleton() {
  return (
    <div className="min-h-[100dvh] w-full bg-[#050507] text-white flex flex-col justify-between items-center px-4 py-6 font-sans select-none overflow-hidden box-border relative">
      <div className="w-full max-w-[380px] my-auto flex flex-col items-center animate-pulse space-y-4 relative z-10">
        <div className="h-6 w-16 bg-zinc-800/60 rounded-md self-start" />
        <div className="w-12 h-12 bg-zinc-800/80 rounded-2xl" />
        <div className="h-7 w-52 bg-zinc-800/80 rounded-lg" />
        <div className="h-4 w-60 bg-zinc-800/40 rounded-md" />
        <div className="w-full space-y-2.5 pt-2">
          <div className="h-12 w-full bg-[#121217] rounded-xl border border-zinc-800/60" />
          <div className="h-12 w-full bg-[#121217] rounded-xl border border-zinc-800/60" />
        </div>
        <div className="w-full h-3 bg-zinc-800/30 rounded my-1" />
        <div className="w-full space-y-3">
          <div className="h-12 w-full bg-[#121217] rounded-xl border border-zinc-800/60" />
          <div className="h-12 w-full bg-[#121217] rounded-xl border border-zinc-800/60" />
        </div>
        <div className="h-12 w-full bg-zinc-200/20 rounded-xl mt-2" />
      </div>
    </div>
  );
}

export default function Auth({ onAuthSuccess, initialMode = 'login', isInitializing = false }: AuthProps) {
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot' | 'reset' | 'verification'>(initialMode);
  
  // Form states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  // UI toggle states
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
  // Loading and feedback states
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [infoToast, setInfoToast] = useState<string | null>(null);

  if (isInitializing) {
    return <AuthSkeleton />;
  }

  // Validations
  const validateEmail = (val: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
  };

  const isFormValid = () => {
    const cleanEmail = email.trim();
    const validEmail = validateEmail(cleanEmail);

    if (mode === 'login') {
      return validEmail && password.length > 0;
    }
    if (mode === 'signup') {
      return (
        validEmail &&
        password.length >= 6
      );
    }
    if (mode === 'forgot') {
      return validEmail;
    }
    if (mode === 'reset') {
      return (
        newPassword.length >= 6 &&
        confirmNewPassword.length >= 6 &&
        newPassword === confirmNewPassword
      );
    }
    return false;
  };

  const showTemporaryInfo = (msg: string) => {
    setInfoToast(msg);
    setTimeout(() => {
      setInfoToast((current) => (current === msg ? null : current));
    }, 4500);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setErrorMessage('Please enter your email address.');
      return;
    }
    if (!validateEmail(cleanEmail)) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }
    if (!password) {
      setErrorMessage('Please enter your password.');
      return;
    }

    setIsLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password: password,
      });

      if (error) {
        setErrorMessage(error.message);
      } else if (data && data.session) {
        setSuccessMessage('Successfully signed in!');
        setTimeout(() => {
          window.history.pushState({}, '', '/');
          onAuthSuccess(data.session);
        }, 500);
      } else {
        setErrorMessage('Unexpected response from auth service.');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'An error occurred during sign in.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    const cleanEmail = email.trim();
    const cleanName = fullName.trim() || cleanEmail.split('@')[0];

    if (!cleanEmail) {
      setErrorMessage('Please enter your email address.');
      return;
    }
    if (!validateEmail(cleanEmail)) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }
    if (!password) {
      setErrorMessage('Please enter a password.');
      return;
    }
    if (password.length < 6) {
      setErrorMessage('Password must be at least 6 characters long.');
      return;
    }

    setIsLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password: password,
        options: {
          data: {
            full_name: cleanName,
          },
        },
      });

      if (error) {
        setErrorMessage(error.message);
      } else {
        // Transition cleanly to the Email Verification page
        setMode('verification');
        setPassword('');
        setConfirmPassword('');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'An error occurred during registration.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setErrorMessage('Please enter your email address.');
      return;
    }
    if (!validateEmail(cleanEmail)) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }

    setIsLoading(true);
    try {
      const { data, error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (error) {
        setErrorMessage(error.message);
      } else {
        setSuccessMessage('We have sent a password reset link to your email.');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to trigger password reset.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignIn = () => {
    setErrorMessage(null);
    showTemporaryInfo('Please use email & password to access your workspace. Google OAuth will be available soon.');
  };

  const handleTelegramSignIn = () => {
    setErrorMessage(null);
    showTemporaryInfo('Please sign in with email first. You can connect your Telegram account for live alerts inside Settings.');
  };

  const switchMode = (newMode: 'login' | 'signup' | 'forgot' | 'reset' | 'verification') => {
    setErrorMessage(null);
    setSuccessMessage(null);
    setInfoToast(null);
    setMode(newMode);
  };

  return (
    <div className="min-h-[100dvh] w-full bg-[#050507] text-white flex flex-col justify-between items-center px-4 py-5 font-sans antialiased select-none relative overflow-x-hidden overflow-y-auto box-border">
      
      {/* Premium dark diagonal sheen overlay matching reference screenshot */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0 bg-[#050507]">
        <div className="absolute -top-[10%] -right-[10%] w-[700px] h-[700px] bg-gradient-to-bl from-zinc-800/15 via-zinc-900/5 to-transparent rounded-full blur-3xl" />
        <div className="absolute top-0 right-0 w-full h-full bg-[radial-gradient(ellipse_at_top_right,rgba(255,255,255,0.03),transparent_75%)]" />
      </div>

      {/* Header Bar with Home link */}
      <div className="w-full max-w-[380px] flex justify-start items-center pt-1 pb-2 relative z-10">
        <button
          type="button"
          onClick={() => {
            setErrorMessage(null);
            setSuccessMessage(null);
            setInfoToast(null);
            setMode('login');
            window.history.pushState({}, '', '/');
          }}
          className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white transition-colors cursor-pointer font-medium py-1 px-1 -ml-1"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Home</span>
        </button>
      </div>

      {/* Main Content Container */}
      <div className="w-full max-w-[380px] my-auto flex flex-col justify-center relative z-10 py-4 box-border">
        
        <AnimatePresence mode="wait">
          {mode === 'verification' ? (
            /* EMAIL VERIFICATION PAGE — Matches Reference Screenshot 2 */
            <motion.div
              key="verification"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="w-full flex flex-col items-center text-center space-y-6"
            >
              {/* Mail Icon in dark rounded badge */}
              <div className="w-16 h-16 rounded-2xl bg-[#121217] border border-zinc-800 flex items-center justify-center text-white shadow-xl">
                <Mail className="w-8 h-8 stroke-[1.5]" />
              </div>

              <div className="space-y-2">
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
                  Check your email
                </h1>
                <p className="text-sm text-zinc-400 leading-relaxed max-w-[310px] mx-auto">
                  We just sent a verification link to<br />
                  <span className="font-medium text-zinc-200">{email || 'your email address'}</span>.
                </p>
              </div>

              <div className="pt-2 w-full">
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className="w-full py-3.5 px-6 rounded-full bg-white text-black font-semibold text-sm hover:bg-zinc-200 active:scale-[0.99] transition-all cursor-pointer shadow-lg flex items-center justify-center gap-2"
                >
                  <span>Go to login</span>
                  <span className="text-base">→</span>
                </button>
              </div>
            </motion.div>
          ) : (
            /* SIGN UP & LOGIN PAGES — Matches Reference Screenshot 1 */
            <motion.div
              key={mode}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="w-full space-y-5"
            >
              {/* Brand Emblem / Logo Badge */}
              <div className="flex justify-center">
                <div className="w-12 h-12 rounded-2xl bg-[#121217] border border-zinc-800 flex items-center justify-center shadow-md relative overflow-hidden group">
                  <span className="text-2xl font-black tracking-tighter text-white font-sans">G</span>
                  <div className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)]" />
                </div>
              </div>

              {/* Title & Subtitle */}
              <div className="text-center space-y-1.5">
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white leading-tight">
                  {mode === 'signup' && 'Create a Gaks AI account'}
                  {mode === 'login' && 'Welcome back'}
                  {mode === 'forgot' && 'Reset password'}
                  {mode === 'reset' && 'Create new password'}
                </h1>
                <p className="text-xs sm:text-sm text-zinc-400 font-normal leading-relaxed">
                  {mode === 'signup' && (
                    <>
                      Already have an account?{' '}
                      <button
                        type="button"
                        onClick={() => switchMode('login')}
                        className="text-white font-bold hover:underline cursor-pointer transition-colors"
                      >
                        Log in.
                      </button>
                    </>
                  )}
                  {mode === 'login' && (
                    <>
                      Don't have an account?{' '}
                      <button
                        type="button"
                        onClick={() => switchMode('signup')}
                        className="text-white font-bold hover:underline cursor-pointer transition-colors"
                      >
                        Create one.
                      </button>
                    </>
                  )}
                  {mode === 'forgot' && "Enter your email address and we'll send a recovery link."}
                  {mode === 'reset' && 'Enter and confirm your secure new password below.'}
                </p>
              </div>

              {/* Error & Info Feedback Banners */}
              {errorMessage && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-start gap-2.5 text-xs leading-relaxed shadow-sm"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{errorMessage}</span>
                </motion.div>
              )}

              {infoToast && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-3 rounded-xl bg-[#121217] border border-zinc-800 text-zinc-300 flex items-start gap-2.5 text-xs leading-relaxed shadow-sm"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-zinc-400" />
                  <span className="flex-1">{infoToast}</span>
                </motion.div>
              )}

              {successMessage && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-start gap-2.5 text-xs leading-relaxed"
                >
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{successMessage}</span>
                </motion.div>
              )}

              {/* Social Auth Buttons */}
              {(mode === 'login' || mode === 'signup') && (
                <div className="space-y-2.5">
                  <button
                    type="button"
                    onClick={handleGoogleSignIn}
                    disabled={isLoading}
                    className="w-full py-3 px-4 rounded-xl bg-[#121217] hover:bg-[#1a1a22] active:scale-[0.99] border border-zinc-800 text-white font-medium text-xs sm:text-sm flex items-center justify-center gap-3 transition-all duration-200 cursor-pointer shadow-sm disabled:opacity-50"
                  >
                    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                      <path fill="#EA4335" d="M12 5.04c1.64 0 3.12.56 4.28 1.67l3.2-3.2C17.52 1.58 14.95 1 12 1 7.35 1 3.4 3.65 1.57 7.5l3.82 2.96C6.32 7.37 8.94 5.04 12 5.04z" />
                      <path fill="#4285F4" d="M23.49 12.27c0-.81-.07-1.59-.2-2.36H12v4.51h6.46c-.29 1.48-1.14 2.73-2.43 3.58l3.78 2.92c2.2-2.03 3.48-5.01 3.48-8.65z" />
                      <path fill="#FBBC05" d="M5.39 14.54c-.25-.75-.39-1.55-.39-2.38s.14-1.63.39-2.38L1.57 6.82C.73 8.49.25 10.37.25 12.37s.48 3.88 1.32 5.55l3.82-3.38z" />
                      <path fill="#34A853" d="M12 23c3.24 0 5.97-1.07 7.96-2.91l-3.78-2.92c-1.05.7-2.4 1.13-4.18 1.13-3.06 0-5.68-2.33-6.61-5.42L1.57 16.2C3.4 20.05 7.35 23 12 23z" />
                    </svg>
                    <span>{mode === 'signup' ? 'Sign up with Google' : 'Log in with Google'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleTelegramSignIn}
                    disabled={isLoading}
                    className="w-full py-3 px-4 rounded-xl bg-[#121217] hover:bg-[#1a1a22] active:scale-[0.99] border border-zinc-800 text-white font-medium text-xs sm:text-sm flex items-center justify-center gap-3 transition-all duration-200 cursor-pointer shadow-sm disabled:opacity-50"
                  >
                    <div className="w-4 h-4 rounded-full bg-[#2AA1DD] flex items-center justify-center shrink-0">
                      <svg className="w-2.5 h-2.5 text-white transform -translate-x-[0.5px] translate-y-[0.5px]" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.446 1.394c-.14.18-.357.295-.6.295-.002 0-.003 0-.005 0l.213-3.054 5.56-5.022c.24-.213-.054-.334-.373-.121l-6.869 4.326-2.96-.924c-.64-.203-.658-.64.135-.954l11.566-4.458c.538-.196 1.006.128.832.94z"/>
                      </svg>
                    </div>
                    <span>{mode === 'signup' ? 'Sign up with Telegram' : 'Log in with Telegram'}</span>
                  </button>

                  {/* Divider */}
                  <div className="flex items-center gap-3 py-1">
                    <div className="h-[1px] flex-1 bg-zinc-800/80" />
                    <span className="text-xs font-normal text-zinc-500">or</span>
                    <div className="h-[1px] flex-1 bg-zinc-800/80" />
                  </div>
                </div>
              )}

              {/* Primary Form */}
              <form
                onSubmit={
                  mode === 'login'
                    ? handleLogin
                    : mode === 'signup'
                    ? handleSignUp
                    : mode === 'forgot'
                    ? handleForgotPassword
                    : handleLogin
                }
                className="space-y-3.5"
                noValidate
              >
                {/* Email Field */}
                {mode !== 'reset' && (
                  <div className="space-y-1.5 text-left">
                    <label className="text-xs font-medium text-zinc-300 block">Email</label>
                    <div className="relative rounded-xl border border-zinc-800 bg-[#121217] focus-within:border-zinc-500 transition-all overflow-hidden">
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => {
                          setEmail(e.target.value);
                          setErrorMessage(null);
                        }}
                        placeholder="alan.turing@example.com"
                        disabled={isLoading}
                        autoComplete="email"
                        className="w-full bg-transparent px-3.5 py-3 text-xs sm:text-sm text-white placeholder-zinc-600 focus:outline-none font-sans"
                      />
                    </div>
                  </div>
                )}

                {/* Password Field (Login & Signup) */}
                {(mode === 'login' || mode === 'signup') && (
                  <div className="space-y-1.5 text-left">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-zinc-300 block">Password</label>
                      {mode === 'login' && (
                        <button
                          type="button"
                          onClick={() => switchMode('forgot')}
                          className="text-xs text-zinc-400 hover:text-white transition-colors cursor-pointer"
                        >
                          Forgot password?
                        </button>
                      )}
                    </div>
                    <div className="relative rounded-xl border border-zinc-800 bg-[#121217] focus-within:border-zinc-500 transition-all overflow-hidden flex items-center pr-3">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => {
                          setPassword(e.target.value);
                          setErrorMessage(null);
                        }}
                        placeholder="••••••••••••"
                        disabled={isLoading}
                        autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                        className="w-full bg-transparent px-3.5 py-3 text-xs sm:text-sm text-white placeholder-zinc-600 focus:outline-none font-sans pr-2"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="p-1 text-zinc-500 hover:text-white transition-colors cursor-pointer shrink-0"
                        title={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                )}

                {/* Primary Submit Button */}
                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={!isFormValid() || isLoading}
                    className="w-full py-3.5 px-4 rounded-xl bg-white text-black font-semibold text-xs sm:text-sm hover:bg-zinc-200 active:scale-[0.99] transition-all duration-200 cursor-pointer flex items-center justify-center gap-2 shadow-md disabled:opacity-35 disabled:cursor-not-allowed"
                  >
                    {isLoading ? (
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded-full border-2 border-black border-t-transparent animate-spin shrink-0" />
                        <span>
                          {mode === 'signup'
                            ? 'Creating account...'
                            : mode === 'login'
                            ? 'Logging in...'
                            : 'Processing...'}
                        </span>
                      </div>
                    ) : (
                      <span>
                        {mode === 'login' && 'Log in'}
                        {mode === 'signup' && 'Create account'}
                        {mode === 'forgot' && 'Send Reset Link'}
                      </span>
                    )}
                  </button>
                </div>
              </form>

              {/* Legal Agreement on Signup */}
              {mode === 'signup' && (
                <p className="text-[11px] text-zinc-500 text-center leading-relaxed max-w-xs mx-auto pt-2">
                  By signing up, you agree to our{' '}
                  <span className="underline text-zinc-400 hover:text-white cursor-pointer transition-colors">Terms</span>
                  ,{' '}
                  <span className="underline text-zinc-400 hover:text-white cursor-pointer transition-colors">Acceptable Use</span>
                  , and{' '}
                  <span className="underline text-zinc-400 hover:text-white cursor-pointer transition-colors">Privacy Policy</span>.
                </p>
              )}

              {/* Forgot password mode back button */}
              {mode === 'forgot' && (
                <div className="text-center pt-2">
                  <button
                    type="button"
                    onClick={() => switchMode('login')}
                    className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white transition-colors cursor-pointer"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Back to Log in</span>
                  </button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Footer Branding */}
      <div className="text-[11px] text-zinc-600 text-center py-2 relative z-10">
        Gaks AI
      </div>

    </div>
  );
}
