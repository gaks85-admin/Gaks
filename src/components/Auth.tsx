// src/components/Auth.tsx
import React, { useState } from 'react';
import { supabase } from '../supabaseClient';
import { Lock, Mail, User, ArrowLeft, RefreshCw, AlertCircle, CheckCircle2, Eye, EyeOff, ArrowRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export interface AuthProps {
  onAuthSuccess: (session: any) => void;
  initialMode?: 'login' | 'signup' | 'forgot' | 'reset';
  isInitializing?: boolean;
}

export function AuthSkeleton() {
  return (
    <div className="min-h-screen w-full bg-white dark:bg-black text-zinc-950 dark:text-white flex flex-col justify-center items-center px-6 py-12 font-sans select-none transition-colors duration-300">
      <div className="w-full max-w-[400px] flex flex-col items-center animate-pulse">
        {/* Logo box */}
        <div className="w-16 h-16 rounded-[22px] bg-zinc-50 dark:bg-[#0c0c0e] border border-zinc-200 dark:border-[#262626] mb-6" />
        <div className="h-6 w-24 bg-zinc-100 dark:bg-[#141419] rounded mb-6" />
        {/* Title */}
        <div className="h-8 w-64 bg-zinc-100 dark:bg-[#141419] rounded-lg mb-3" />
        {/* Subtitle */}
        <div className="h-4 w-48 bg-zinc-50 dark:bg-[#0c0c0e] rounded-md mb-8" />
        
        {/* Social buttons skeleton */}
        <div className="w-full space-y-3 mb-6">
          <div className="h-[52px] w-full bg-zinc-50 dark:bg-[#0c0c0e] rounded-[20px] border border-zinc-100 dark:border-[#1f1f24]" />
          <div className="h-[52px] w-full bg-zinc-50 dark:bg-[#0c0c0e] rounded-[20px] border border-zinc-100 dark:border-[#1f1f24]" />
        </div>
        
        {/* OR divider */}
        <div className="w-full h-4 bg-zinc-50 dark:bg-[#0a0a0d] rounded my-4" />
        
        {/* Input skeletons */}
        <div className="w-full space-y-4 mb-6">
          <div className="h-[56px] w-full bg-zinc-50 dark:bg-[#0c0c0e] rounded-[20px] border border-zinc-100 dark:border-[#1f1f24]" />
          <div className="h-[56px] w-full bg-zinc-50 dark:bg-[#0c0c0e] rounded-[20px] border border-zinc-100 dark:border-[#1f1f24]" />
        </div>
        
        {/* Primary button skeleton */}
        <div className="h-[54px] w-full bg-zinc-200 dark:bg-[#1a1a22] rounded-[20px]" />
      </div>
    </div>
  );
}

interface FloatingInputProps {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  disabled?: boolean;
  autoComplete?: string;
  rightElement?: React.ReactNode;
  errorMessage?: string | null;
}

const FloatingInput: React.FC<FloatingInputProps> = ({
  id,
  label,
  type = "text",
  value,
  onChange,
  disabled = false,
  autoComplete,
  rightElement,
  errorMessage
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const hasValue = value.length > 0;
  const isFloating = isFocused || hasValue;

  return (
    <div className="space-y-1.5">
      <div
        className={`relative rounded-[20px] border bg-zinc-50 dark:bg-[#0c0c0e] transition-all duration-200 ${
          errorMessage
            ? 'border-red-500/60 focus-within:border-red-500 focus-within:ring-2 focus-within:ring-red-500/10'
            : isFocused
            ? 'border-zinc-400 dark:border-zinc-500 bg-white dark:bg-[#101015] ring-2 ring-zinc-500/5 dark:ring-white/5'
            : 'border-zinc-200 dark:border-[#262626] hover:border-zinc-300 dark:hover:border-[#383838]'
        }`}
      >
        <input
          id={id}
          type={type}
          value={value}
          onChange={onChange}
          disabled={disabled}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          autoComplete={autoComplete}
          className={`w-full bg-transparent px-4 pb-2 text-[14px] sm:text-[15px] font-medium text-zinc-950 dark:text-white focus:outline-none transition-all rounded-[20px] ${
            rightElement ? 'pr-12' : 'pr-4'
          } ${isFloating ? 'pt-6' : 'pt-4'}`}
        />
        <label
          htmlFor={id}
          className={`absolute left-4 transition-all duration-200 pointer-events-none select-none ${
            isFloating
              ? 'top-2 text-[10px] sm:text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider'
              : 'top-1/2 -translate-y-1/2 text-[14px] font-normal text-zinc-400 dark:text-zinc-500'
          }`}
        >
          {label}
        </label>
        {rightElement && (
          <div className="absolute right-3.5 top-1/2 -translate-y-1/2 z-10 flex items-center">
            {rightElement}
          </div>
        )}
      </div>
      {errorMessage && (
        <p className="text-[12px] text-red-400 font-medium pl-2 tracking-normal animate-fadeIn">
          {errorMessage}
        </p>
      )}
    </div>
  );
};

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
    // Auto-derive a friendly name from email prefix if fullName is empty, to support minimal 3-field signup
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
        redirectTo: `${window.location.origin}/#reset`,
      });

      if (error) {
        setErrorMessage(error.message);
      } else {
        setSuccessMessage('We have sent a secure password reset link to your email address.');
        setTimeout(() => {
          setMode('reset');
        }, 2200);
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
    <div className="min-h-screen w-full bg-white dark:bg-black text-zinc-950 dark:text-white flex flex-col justify-center items-center px-5 py-12 font-sans antialiased select-none relative overflow-x-hidden transition-colors duration-300">
      
      {/* Top ambient glow for high-end aesthetic without glassmorphism noise */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-gradient-to-b from-zinc-100/50 dark:from-zinc-900/40 via-transparent to-transparent blur-[120px] pointer-events-none" />

      {/* Main content container (mobile-first max-w-[400px]) */}
      <div className="w-full max-w-[400px] flex flex-col items-center relative z-10">
        
        {/* Large Gaks AI logo centered near the top */}
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-col items-center mb-8"
        >
          <div className="w-16 h-16 rounded-[22px] bg-white dark:bg-[#0c0c0e] border border-zinc-200 dark:border-[#262626] flex items-center justify-center shadow-[0_12px_36px_rgba(0,0,0,0.1)] dark:shadow-[0_12px_36px_rgba(0,0,0,0.9)] mb-5 relative group overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-tr from-zinc-500/[0.03] dark:from-white/[0.06] via-transparent to-transparent pointer-events-none" />
            <span className="text-3xl font-black tracking-tighter text-zinc-950 dark:text-white">G</span>
            <div className="absolute top-2.5 right-2.5 w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)]" />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xl font-bold tracking-tight text-zinc-950 dark:text-white">Gaks</span>
            <span className="text-xl font-normal text-zinc-400 dark:text-zinc-500">AI</span>
          </div>
        </motion.div>

        <AnimatePresence mode="wait">
          <motion.div
            key={mode}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -14 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="w-full"
          >
            {/* Title & Subtitle */}
            <div className="text-center space-y-2 mb-8">
              <h1 className="text-2xl sm:text-[28px] font-bold tracking-tight text-zinc-950 dark:text-white leading-tight">
                {mode === 'signup' && 'Create your Gaks AI account'}
                {mode === 'login' && 'Log in to Gaks AI'}
                {mode === 'forgot' && 'Reset your password'}
                {mode === 'reset' && 'Create new password'}
              </h1>
              <p className="text-[13px] sm:text-sm text-zinc-500 dark:text-zinc-400 font-normal leading-relaxed max-w-[340px] mx-auto">
                {mode === 'signup' && 'Start using AI-powered market monitoring in minutes.'}
                {mode === 'login' && 'Start using AI-powered market monitoring in minutes.'}
                {mode === 'forgot' && "Enter your email address and we'll send a recovery link."}
                {mode === 'reset' && 'Enter and confirm your secure new password below.'}
              </p>
            </div>

            {/* Error & Info Feedback Banners */}
            {errorMessage && (
              <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className="mb-6 p-4 rounded-[18px] bg-red-500/10 border border-red-500/20 text-red-400 flex items-start gap-3 text-[13px] leading-relaxed shadow-lg"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{errorMessage}</span>
              </motion.div>
            )}

            {infoToast && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-6 p-4 rounded-[18px] bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 flex items-start gap-3 text-[13px] leading-relaxed shadow-lg"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-zinc-400 dark:text-zinc-500" />
                <span className="flex-1">{infoToast}</span>
              </motion.div>
            )}

            {/* SUCCESS CELEBRATION SCREEN */}
            {successMessage ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                className="p-7 sm:p-8 rounded-[24px] border border-zinc-200 dark:border-[#262626] bg-white dark:bg-[#0c0c0e] text-center space-y-6 shadow-2xl relative overflow-hidden"
              >
                <div className="absolute inset-0 bg-gradient-to-b from-zinc-500/[0.01] dark:from-white/[0.02] to-transparent pointer-events-none" />
                <div className="w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 dark:text-emerald-400 flex items-center justify-center mx-auto shadow-[0_0_30px_rgba(16,185,129,0.15)]">
                  <CheckCircle2 className="w-7 h-7 stroke-[2]" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-lg font-bold text-zinc-950 dark:text-white tracking-tight">
                    {mode === 'signup' ? 'Check your email' : 'Success!'}
                  </h3>
                  <p className="text-[13px] text-zinc-500 dark:text-zinc-400 leading-relaxed max-w-[280px] mx-auto">
                    {successMessage}
                  </p>
                </div>
                {mode === 'signup' && (
                  <button
                    type="button"
                    onClick={() => switchMode('login')}
                    className="w-full py-3.5 px-5 rounded-[20px] bg-zinc-950 dark:bg-white text-white dark:text-black font-semibold text-sm hover:bg-zinc-800 dark:hover:bg-zinc-200 active:scale-[0.99] transition-all cursor-pointer shadow-md"
                  >
                    Return to Sign In
                  </button>
                )}
              </motion.div>
            ) : (
              <>
                {/* SOCIAL BUTTONS (Login & Signup modes) */}
                {(mode === 'login' || mode === 'signup') && (
                  <div className="space-y-3 mb-6">
                    <button
                      type="button"
                      onClick={handleGoogleSignIn}
                      disabled={isLoading}
                      className="w-full py-3.5 px-5 rounded-[20px] bg-white dark:bg-[#0c0c0e] hover:bg-zinc-50 dark:hover:bg-[#141419] active:scale-[0.99] border border-zinc-200 dark:border-[#262626] hover:border-zinc-300 dark:hover:border-zinc-700 text-zinc-950 dark:text-white font-medium text-[13px] sm:text-sm flex items-center justify-center gap-3 transition-all duration-200 cursor-pointer shadow-sm disabled:opacity-50"
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
                      className="w-full py-3.5 px-5 rounded-[20px] bg-white dark:bg-[#0c0c0e] hover:bg-zinc-50 dark:hover:bg-[#141419] active:scale-[0.99] border border-zinc-200 dark:border-[#262626] hover:border-zinc-300 dark:hover:border-zinc-700 text-zinc-950 dark:text-white font-medium text-[13px] sm:text-sm flex items-center justify-center gap-3 transition-all duration-200 cursor-pointer shadow-sm disabled:opacity-50"
                    >
                      <svg className="w-4 h-4 shrink-0 text-[#2AA1DD]" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.446 1.394c-.14.18-.357.295-.6.295-.002 0-.003 0-.005 0l.213-3.054 5.56-5.022c.24-.213-.054-.334-.373-.121l-6.869 4.326-2.96-.924c-.64-.203-.658-.64.135-.954l11.566-4.458c.538-.196 1.006.128.832.94z"/>
                      </svg>
                      <span>Continue with Telegram</span>
                    </button>

                    {/* OR Divider */}
                    <div className="flex items-center gap-4 my-6 py-2">
                      <div className="h-[1px] flex-1 bg-zinc-200 dark:bg-[#262626]" />
                      <span className="text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">or</span>
                      <div className="h-[1px] flex-1 bg-zinc-200 dark:bg-[#262626]" />
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
                  className="space-y-3.5"
                  noValidate
                >
                  {/* Email Field (All modes except reset) */}
                  {mode !== 'reset' && (
                    <FloatingInput
                      id="email"
                      label="Email"
                      type="email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        setErrorMessage(null);
                      }}
                      disabled={isLoading}
                      autoComplete="email"
                    />
                  )}

                  {/* Password Field (Login & Signup modes) */}
                  {(mode === 'login' || mode === 'signup') && (
                    <div className="space-y-1">
                      <FloatingInput
                        id="password"
                        label="Password"
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => {
                          setPassword(e.target.value);
                          setErrorMessage(null);
                        }}
                        disabled={isLoading}
                        autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                        rightElement={
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="p-1 text-zinc-500 hover:text-zinc-950 dark:hover:text-white transition-colors cursor-pointer"
                            title={showPassword ? 'Hide password' : 'Show password'}
                          >
                            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        }
                      />
                      
                      {/* Forgot password link on login mode */}
                      {mode === 'login' && (
                        <div className="flex justify-end pt-1 px-1">
                          <button
                            type="button"
                            onClick={() => switchMode('forgot')}
                            className="text-[12px] font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white transition-colors cursor-pointer"
                          >
                            Forgot password?
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Confirm Password Field (Signup mode only) */}
                  {mode === 'signup' && (
                    <FloatingInput
                      id="confirmPassword"
                      label="Confirm Password"
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => {
                        setConfirmPassword(e.target.value);
                        setErrorMessage(null);
                      }}
                      disabled={isLoading}
                      autoComplete="new-password"
                      errorMessage={
                        confirmPassword.length > 0 && password !== confirmPassword
                          ? 'Passwords do not match'
                          : null
                      }
                      rightElement={
                        <button
                          type="button"
                          onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                          className="p-1 text-zinc-500 hover:text-zinc-950 dark:hover:text-white transition-colors cursor-pointer"
                          title={showConfirmPassword ? 'Hide password' : 'Show password'}
                        >
                          {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      }
                    />
                  )}

                  {/* New Password Fields (Reset mode) */}
                  {mode === 'reset' && (
                    <>
                      <FloatingInput
                        id="newPassword"
                        label="New Password"
                        type={showPassword ? 'text' : 'password'}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        disabled={isLoading}
                        rightElement={
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="p-1 text-zinc-500 hover:text-zinc-950 dark:hover:text-white transition-colors cursor-pointer"
                          >
                            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        }
                      />
                      <FloatingInput
                        id="confirmNewPassword"
                        label="Confirm New Password"
                        type={showConfirmPassword ? 'text' : 'password'}
                        value={confirmNewPassword}
                        onChange={(e) => setConfirmNewPassword(e.target.value)}
                        disabled={isLoading}
                        errorMessage={
                          confirmNewPassword.length > 0 && newPassword !== confirmNewPassword
                            ? 'Passwords do not match'
                            : null
                        }
                        rightElement={
                          <button
                            type="button"
                            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                            className="p-1 text-zinc-500 hover:text-zinc-950 dark:hover:text-white transition-colors cursor-pointer"
                          >
                            {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        }
                      />
                    </>
                  )}

                  {/* PRIMARY SUBMIT BUTTON */}
                  <div className="pt-3">
                    <button
                      type="submit"
                      disabled={!isFormValid() || isLoading}
                      className="w-full py-4 px-6 rounded-[20px] bg-zinc-950 dark:bg-white text-white dark:text-black font-semibold text-[14px] sm:text-[15px] hover:bg-zinc-800 dark:hover:bg-zinc-200 active:scale-[0.99] transition-all duration-200 cursor-pointer flex items-center justify-center gap-2.5 shadow-[0_4px_24px_rgba(0,0,0,0.1)] dark:shadow-[0_4px_24px_rgba(255,255,255,0.14)] disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:bg-zinc-950 dark:disabled:hover:bg-white disabled:shadow-none"
                    >
                      {isLoading ? (
                        <div className="flex items-center gap-2.5">
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
                        <span className="flex items-center gap-1.5">
                          <span>
                            {mode === 'login' && 'Sign in'}
                            {mode === 'signup' && 'Create Account'}
                            {mode === 'forgot' && 'Send Reset Link'}
                            {mode === 'reset' && 'Update Password'}
                          </span>
                        </span>
                      )}
                    </button>
                  </div>
                </form>

                {/* BOTTOM NAVIGATION LINKS */}
                <div className="text-center pt-5">
                  {mode === 'signup' && (
                    <p className="text-[13px] text-zinc-500 font-normal">
                      Already have an account?{' '}
                      <button
                        type="button"
                        onClick={() => switchMode('login')}
                        className="text-zinc-950 dark:text-white font-medium hover:underline cursor-pointer transition-colors"
                      >
                        Sign in
                      </button>
                    </p>
                  )}

                  {mode === 'login' && (
                    <p className="text-[13px] text-zinc-500 font-normal">
                      Don't have an account?{' '}
                      <button
                        type="button"
                        onClick={() => switchMode('signup')}
                        className="text-zinc-950 dark:text-white font-medium hover:underline cursor-pointer transition-colors"
                      >
                        Create account
                      </button>
                    </p>
                  )}

                  {(mode === 'forgot' || mode === 'reset') && (
                    <button
                      type="button"
                      onClick={() => switchMode('login')}
                      className="inline-flex items-center gap-1.5 text-[13px] font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white transition-colors cursor-pointer"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>Back to Sign In</span>
                    </button>
                  )}
                </div>
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Minimal Footer */}
      <p className="text-[11px] text-zinc-600 text-center mt-10 tracking-wide relative z-10 max-w-xs">
        By continuing, you agree to our Terms of Service and Privacy Policy.
      </p>

    </div>
  );
}

