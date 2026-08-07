// src/components/Auth.tsx
import React, { useState } from 'react';
import { supabase } from '../supabaseClient';
import { Lock, Mail, User, ArrowLeft, RefreshCw, AlertCircle, CheckCircle2, Eye, EyeOff, ShieldCheck, Zap, TrendingUp } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export interface AuthProps {
  onAuthSuccess: (session: any) => void;
  initialMode?: 'login' | 'signup' | 'forgot' | 'reset';
  isInitializing?: boolean;
}

export function AuthSkeleton() {
  return (
    <div className="min-h-[100dvh] w-full bg-[#030305] text-white flex flex-col justify-between items-center px-4 py-6 font-sans select-none overflow-hidden">
      <div className="w-full max-w-[380px] my-auto flex flex-col items-center animate-pulse space-y-4">
        {/* Brand title skeleton */}
        <div className="h-9 w-36 bg-[#12121a] rounded-xl" />
        {/* Title & subtitle */}
        <div className="h-6 w-48 bg-[#12121a] rounded-lg" />
        <div className="h-4 w-64 bg-[#0c0c12] rounded-md" />
        {/* Social buttons */}
        <div className="w-full space-y-2.5 pt-2">
          <div className="h-[48px] w-full bg-[#0c0c12] rounded-2xl border border-[#1e1e2b]" />
          <div className="h-[48px] w-full bg-[#0c0c12] rounded-2xl border border-[#1e1e2b]" />
        </div>
        {/* OR divider */}
        <div className="w-full h-3 bg-[#0a0a0d] rounded my-1" />
        {/* Input skeletons */}
        <div className="w-full space-y-3">
          <div className="h-[50px] w-full bg-[#0c0c12] rounded-2xl border border-[#1e1e2b]" />
          <div className="h-[50px] w-full bg-[#0c0c12] rounded-2xl border border-[#1e1e2b]" />
        </div>
        {/* Primary button skeleton */}
        <div className="h-[50px] w-full bg-zinc-200/20 rounded-2xl mt-1" />
      </div>
    </div>
  );
}

export default function Auth({ onAuthSuccess, initialMode = 'login', isInitializing = false }: AuthProps) {
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot' | 'reset'>(initialMode);
  
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
        password.length >= 6 &&
        confirmPassword.length >= 6 &&
        password === confirmPassword
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
        setSuccessMessage('Successfully signed in! Restoring workspace...');
        setTimeout(() => {
          window.history.pushState({}, '', '/');
          onAuthSuccess(data.session);
        }, 600);
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
    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match. Please verify your confirmation password.');
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
        setSuccessMessage('Registration successful! We have sent a verification email to your inbox. Please confirm your email address to activate your account.');
        setFullName('');
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
        setSuccessMessage('We have sent a secure password reset link to your email address.');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to trigger password reset.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!newPassword) {
      setErrorMessage('Please enter your new password.');
      return;
    }
    if (newPassword.length < 6) {
      setErrorMessage('Password must be at least 6 characters long.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setErrorMessage('New passwords do not match.');
      return;
    }

    setIsLoading(true);
    try {
      const { data, error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) {
        setErrorMessage(error.message);
      } else {
        setSuccessMessage('Password updated successfully! Signing you into your workspace...');
        setTimeout(async () => {
          const { data: sessionData } = await supabase.auth.getSession();
          if (sessionData?.session) {
            onAuthSuccess(sessionData.session);
          } else {
            setMode('login');
          }
        }, 1500);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to update your password.');
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

  const switchMode = (newMode: 'login' | 'signup' | 'forgot' | 'reset') => {
    setErrorMessage(null);
    setSuccessMessage(null);
    setInfoToast(null);
    setMode(newMode);
  };

  return (
    <div className="min-h-[100dvh] w-full bg-[#030305] text-white flex flex-col justify-between items-center px-4 py-5 font-sans antialiased select-none relative overflow-y-auto">
      
      {/* Top ambient aura */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(255,255,255,0.06),rgba(0,0,0,0))] pointer-events-none" />

      {/* Main content container */}
      <div className="w-full max-w-[380px] sm:max-w-[400px] my-auto flex flex-col justify-center relative z-10 space-y-4 sm:space-y-5 py-2">
        
        {/* Brand heading */}
        <motion.div 
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="text-center space-y-1"
        >
          <div className="flex items-center justify-center gap-2">
            <span className="text-4xl sm:text-5xl font-black tracking-tight text-white">Gaks</span>
            <span className="text-4xl sm:text-5xl font-black tracking-tight text-zinc-400">AI</span>
          </div>
          <div className="w-24 h-[1px] bg-gradient-to-r from-transparent via-zinc-700/60 to-transparent mx-auto my-1.5" />
        </motion.div>

        <AnimatePresence mode="wait">
          <motion.div
            key={mode}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="w-full space-y-4"
          >
            {/* Title & Subtitle */}
            <div className="text-center space-y-1.5">
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white leading-tight">
                {mode === 'signup' && 'Create account'}
                {mode === 'login' && 'Welcome back'}
                {mode === 'forgot' && 'Reset password'}
                {mode === 'reset' && 'Create new password'}
              </h1>
              <p className="text-xs sm:text-sm text-zinc-400 font-normal leading-relaxed max-w-[340px] mx-auto">
                {mode === 'signup' && 'Start using AI-powered market monitoring in minutes.'}
                {mode === 'login' && 'Log in to your account and continue monitoring the markets with AI.'}
                {mode === 'forgot' && "Enter your email address and we'll send a recovery link."}
                {mode === 'reset' && 'Enter and confirm your secure new password below.'}
              </p>
            </div>

            {/* Error & Info Feedback Banners */}
            {errorMessage && (
              <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-start gap-2.5 text-xs leading-relaxed shadow-sm"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{errorMessage}</span>
              </motion.div>
            )}

            {infoToast && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-3.5 rounded-2xl bg-[#0c0c12] border border-[#1e1e2b] text-zinc-300 flex items-start gap-2.5 text-xs leading-relaxed shadow-sm"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-zinc-400" />
                <span className="flex-1">{infoToast}</span>
              </motion.div>
            )}

            {/* SUCCESS CELEBRATION SCREEN */}
            {successMessage ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                className="p-6 rounded-3xl border border-[#1e1e2b] bg-[#0c0c12] text-center space-y-4 shadow-2xl relative overflow-hidden"
              >
                <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mx-auto shadow-[0_0_20px_rgba(16,185,129,0.15)]">
                  <CheckCircle2 className="w-6 h-6 stroke-[2]" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-base font-bold text-white tracking-tight">
                    {mode === 'signup' ? 'Check your email' : 'Success!'}
                  </h3>
                  <p className="text-xs text-zinc-400 leading-relaxed max-w-[260px] mx-auto">
                    {successMessage}
                  </p>
                </div>
                {mode === 'signup' && (
                  <button
                    type="button"
                    onClick={() => switchMode('login')}
                    className="w-full py-3 px-4 rounded-2xl bg-white text-black font-semibold text-xs sm:text-sm hover:bg-zinc-200 active:scale-[0.99] transition-all cursor-pointer shadow-md"
                  >
                    Return to Sign In
                  </button>
                )}
              </motion.div>
            ) : (
              <>
                {/* SOCIAL BUTTONS (Login & Signup modes) */}
                {(mode === 'login' || mode === 'signup') && (
                  <div className="space-y-2.5">
                    <button
                      type="button"
                      onClick={handleGoogleSignIn}
                      disabled={isLoading}
                      className="w-full py-3 sm:py-3.5 px-4 rounded-2xl bg-[#0c0c12] hover:bg-[#14141d] active:scale-[0.99] border border-[#1e1e2b] text-white font-medium text-xs sm:text-sm flex items-center justify-center gap-3 transition-all duration-200 cursor-pointer shadow-sm disabled:opacity-50"
                    >
                      <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                        <path fill="#EA4335" d="M12 5.04c1.64 0 3.12.56 4.28 1.67l3.2-3.2C17.52 1.58 14.95 1 12 1 7.35 1 3.4 3.65 1.57 7.5l3.82 2.96C6.32 7.37 8.94 5.04 12 5.04z" />
                        <path fill="#4285F4" d="M23.49 12.27c0-.81-.07-1.59-.2-2.36H12v4.51h6.46c-.29 1.48-1.14 2.73-2.43 3.58l3.78 2.92c2.2-2.03 3.48-5.01 3.48-8.65z" />
                        <path fill="#FBBC05" d="M5.39 14.54c-.25-.75-.39-1.55-.39-2.38s.14-1.63.39-2.38L1.57 6.82C.73 8.49.25 10.37.25 12.37s.48 3.88 1.32 5.55l3.82-3.38z" />
                        <path fill="#34A853" d="M12 23c3.24 0 5.97-1.07 7.96-2.91l-3.78-2.92c-1.05.7-2.4 1.13-4.18 1.13-3.06 0-5.68-2.33-6.61-5.42L1.57 16.2C3.4 20.05 7.35 23 12 23z" />
                      </svg>
                      <span>Continue with Google</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleTelegramSignIn}
                      disabled={isLoading}
                      className="w-full py-3 sm:py-3.5 px-4 rounded-2xl bg-[#0c0c12] hover:bg-[#14141d] active:scale-[0.99] border border-[#1e1e2b] text-white font-medium text-xs sm:text-sm flex items-center justify-center gap-3 transition-all duration-200 cursor-pointer shadow-sm disabled:opacity-50"
                    >
                      <div className="w-4 h-4 rounded-full bg-[#2AA1DD] flex items-center justify-center shrink-0">
                        <svg className="w-3 h-3 text-white transform -translate-x-[0.5px] translate-y-[0.5px]" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.446 1.394c-.14.18-.357.295-.6.295-.002 0-.003 0-.005 0l.213-3.054 5.56-5.022c.24-.213-.054-.334-.373-.121l-6.869 4.326-2.96-.924c-.64-.203-.658-.64.135-.954l11.566-4.458c.538-.196 1.006.128.832.94z"/>
                        </svg>
                      </div>
                      <span>Continue with Telegram</span>
                    </button>

                    {/* OR Divider */}
                    <div className="flex items-center gap-4 my-2">
                      <div className="h-[1px] flex-1 bg-[#1e1e2b]" />
                      <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">OR</span>
                      <div className="h-[1px] flex-1 bg-[#1e1e2b]" />
                    </div>
                  </div>
                )}

                {/* PRIMARY FORM */}
                <form
                  onSubmit={
                    mode === 'login'
                      ? handleLogin
                      : mode === 'signup'
                      ? handleSignUp
                      : mode === 'forgot'
                      ? handleForgotPassword
                      : handleResetPassword
                  }
                  className="space-y-3"
                  noValidate
                >
                  {/* Name field (Signup mode) */}
                  {mode === 'signup' && (
                    <div className="relative flex items-center bg-[#0c0c12] border border-[#1e1e2b] focus-within:border-zinc-400 focus-within:ring-1 focus-within:ring-white/10 rounded-2xl px-4 py-3 sm:py-3.5 transition-all">
                      <User className="w-4 h-4 text-zinc-500 shrink-0 mr-3" />
                      <input
                        type="text"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="Full Name (optional)"
                        disabled={isLoading}
                        autoComplete="name"
                        className="w-full bg-transparent text-xs sm:text-sm text-white placeholder-zinc-500 focus:outline-none font-medium"
                      />
                    </div>
                  )}

                  {/* Email Field (All modes except reset) */}
                  {mode !== 'reset' && (
                    <div className="relative flex items-center bg-[#0c0c12] border border-[#1e1e2b] focus-within:border-zinc-400 focus-within:ring-1 focus-within:ring-white/10 rounded-2xl px-4 py-3 sm:py-3.5 transition-all">
                      <Mail className="w-4 h-4 text-zinc-500 shrink-0 mr-3" />
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => {
                          setEmail(e.target.value);
                          setErrorMessage(null);
                        }}
                        placeholder="Email"
                        disabled={isLoading}
                        autoComplete="email"
                        className="w-full bg-transparent text-xs sm:text-sm text-white placeholder-zinc-500 focus:outline-none font-medium"
                      />
                    </div>
                  )}

                  {/* Password Field (Login & Signup modes) */}
                  {(mode === 'login' || mode === 'signup') && (
                    <div className="space-y-1.5">
                      <div className="relative flex items-center bg-[#0c0c12] border border-[#1e1e2b] focus-within:border-zinc-400 focus-within:ring-1 focus-within:ring-white/10 rounded-2xl px-4 py-3 sm:py-3.5 transition-all">
                        <Lock className="w-4 h-4 text-zinc-500 shrink-0 mr-3" />
                        <input
                          type={showPassword ? 'text' : 'password'}
                          value={password}
                          onChange={(e) => {
                            setPassword(e.target.value);
                            setErrorMessage(null);
                          }}
                          placeholder="Password"
                          disabled={isLoading}
                          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                          className="w-full bg-transparent text-xs sm:text-sm text-white placeholder-zinc-500 focus:outline-none font-medium pr-2"
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
                      
                      {/* Forgot password link on login mode */}
                      {mode === 'login' && (
                        <div className="flex justify-end pt-0.5">
                          <button
                            type="button"
                            onClick={() => switchMode('forgot')}
                            className="text-xs font-medium text-zinc-400 hover:text-white transition-colors cursor-pointer"
                          >
                            Forgot password?
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Confirm Password Field (Signup mode only) */}
                  {mode === 'signup' && (
                    <div className="space-y-1">
                      <div className="relative flex items-center bg-[#0c0c12] border border-[#1e1e2b] focus-within:border-zinc-400 focus-within:ring-1 focus-within:ring-white/10 rounded-2xl px-4 py-3 sm:py-3.5 transition-all">
                        <Lock className="w-4 h-4 text-zinc-500 shrink-0 mr-3" />
                        <input
                          type={showConfirmPassword ? 'text' : 'password'}
                          value={confirmPassword}
                          onChange={(e) => {
                            setConfirmPassword(e.target.value);
                            setErrorMessage(null);
                          }}
                          placeholder="Confirm Password"
                          disabled={isLoading}
                          autoComplete="new-password"
                          className="w-full bg-transparent text-xs sm:text-sm text-white placeholder-zinc-500 focus:outline-none font-medium pr-2"
                        />
                        <button
                          type="button"
                          onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                          className="p-1 text-zinc-500 hover:text-white transition-colors cursor-pointer shrink-0"
                          title={showConfirmPassword ? 'Hide password' : 'Show password'}
                        >
                          {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      {confirmPassword.length > 0 && password !== confirmPassword && (
                        <p className="text-[11px] text-rose-400 font-medium pl-1">
                          Passwords do not match
                        </p>
                      )}
                    </div>
                  )}

                  {/* New Password Fields (Reset mode) */}
                  {mode === 'reset' && (
                    <>
                      <div className="relative flex items-center bg-[#0c0c12] border border-[#1e1e2b] focus-within:border-zinc-400 focus-within:ring-1 focus-within:ring-white/10 rounded-2xl px-4 py-3 sm:py-3.5 transition-all">
                        <Lock className="w-4 h-4 text-zinc-500 shrink-0 mr-3" />
                        <input
                          type={showPassword ? 'text' : 'password'}
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="New Password"
                          disabled={isLoading}
                          className="w-full bg-transparent text-xs sm:text-sm text-white placeholder-zinc-500 focus:outline-none font-medium pr-2"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="p-1 text-zinc-500 hover:text-white transition-colors cursor-pointer shrink-0"
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      <div className="space-y-1">
                        <div className="relative flex items-center bg-[#0c0c12] border border-[#1e1e2b] focus-within:border-zinc-400 focus-within:ring-1 focus-within:ring-white/10 rounded-2xl px-4 py-3 sm:py-3.5 transition-all">
                          <Lock className="w-4 h-4 text-zinc-500 shrink-0 mr-3" />
                          <input
                            type={showConfirmPassword ? 'text' : 'password'}
                            value={confirmNewPassword}
                            onChange={(e) => setConfirmNewPassword(e.target.value)}
                            placeholder="Confirm New Password"
                            disabled={isLoading}
                            className="w-full bg-transparent text-xs sm:text-sm text-white placeholder-zinc-500 focus:outline-none font-medium pr-2"
                          />
                          <button
                            type="button"
                            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                            className="p-1 text-zinc-500 hover:text-white transition-colors cursor-pointer shrink-0"
                          >
                            {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                        {confirmNewPassword.length > 0 && newPassword !== confirmNewPassword && (
                          <p className="text-[11px] text-rose-400 font-medium pl-1">
                            New passwords do not match
                          </p>
                        )}
                      </div>
                    </>
                  )}

                  {/* PRIMARY SUBMIT BUTTON */}
                  <div className="pt-2">
                    <button
                      type="submit"
                      disabled={!isFormValid() || isLoading}
                      className="w-full py-3.5 px-5 rounded-2xl bg-white hover:bg-zinc-200 text-black font-bold text-sm sm:text-base active:scale-[0.99] transition-all duration-200 cursor-pointer flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(255,255,255,0.1)] disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:bg-white"
                    >
                      {isLoading ? (
                        <div className="flex items-center gap-2">
                          <div className="w-4 h-4 rounded-full border-2 border-black border-t-transparent animate-spin shrink-0" />
                          <span>
                            {mode === 'signup'
                              ? 'Creating account...'
                              : mode === 'login'
                              ? 'Signing in...'
                              : 'Processing...'}
                          </span>
                        </div>
                      ) : (
                        <span>
                          {mode === 'login' && 'Sign in'}
                          {mode === 'signup' && 'Create account'}
                          {mode === 'forgot' && 'Send Reset Link'}
                          {mode === 'reset' && 'Update Password'}
                        </span>
                      )}
                    </button>
                  </div>
                </form>

                {/* BOTTOM NAVIGATION LINKS */}
                <div className="text-center pt-1">
                  {mode === 'signup' && (
                    <p className="text-xs sm:text-sm text-zinc-400 font-normal">
                      Already have an account?{' '}
                      <button
                        type="button"
                        onClick={() => switchMode('login')}
                        className="text-white font-bold hover:underline cursor-pointer transition-colors"
                      >
                        Sign in
                      </button>
                    </p>
                  )}

                  {mode === 'login' && (
                    <p className="text-xs sm:text-sm text-zinc-400 font-normal">
                      Don't have an account?{' '}
                      <button
                        type="button"
                        onClick={() => switchMode('signup')}
                        className="text-white font-bold hover:underline cursor-pointer transition-colors"
                      >
                        Create account
                      </button>
                    </p>
                  )}

                  {(mode === 'forgot' || mode === 'reset') && (
                    <button
                      type="button"
                      onClick={() => switchMode('login')}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-400 hover:text-white transition-colors cursor-pointer"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>Back to Sign In</span>
                    </button>
                  )}
                </div>

                {/* Trust Badges */}
                <div className="grid grid-cols-3 gap-2 py-4 border-t border-[#181820] mt-3">
                  <div className="flex flex-col items-center text-center space-y-1">
                    <div className="w-9 h-9 rounded-xl bg-[#0c0c12] border border-[#1e1e2b] flex items-center justify-center text-zinc-300">
                      <ShieldCheck className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold text-white">Secure</span>
                    <span className="text-[10px] text-zinc-500">Bank-level security</span>
                  </div>
                  <div className="flex flex-col items-center text-center space-y-1 border-x border-[#181820] px-1">
                    <div className="w-9 h-9 rounded-xl bg-[#0c0c12] border border-[#1e1e2b] flex items-center justify-center text-zinc-300">
                      <Zap className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold text-white">AI-Powered</span>
                    <span className="text-[10px] text-zinc-500">Smarter market insights</span>
                  </div>
                  <div className="flex flex-col items-center text-center space-y-1">
                    <div className="w-9 h-9 rounded-xl bg-[#0c0c12] border border-[#1e1e2b] flex items-center justify-center text-zinc-300">
                      <TrendingUp className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold text-white">Real-Time</span>
                    <span className="text-[10px] text-zinc-500">24/7 market monitoring</span>
                  </div>
                </div>
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Minimal Footer */}
      <p className="text-[11px] text-zinc-500 text-center tracking-normal relative z-10 max-w-xs pt-2 pb-2">
        By continuing, you agree to our{' '}
        <span className="underline text-zinc-400 hover:text-white cursor-pointer transition-colors">Terms of Service</span>
        {' '}and{' '}
        <span className="underline text-zinc-400 hover:text-white cursor-pointer transition-colors">Privacy Policy</span>.
      </p>

    </div>
  );
}


