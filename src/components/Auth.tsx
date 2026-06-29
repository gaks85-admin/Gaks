// src/components/Auth.tsx
import React, { useState } from 'react';
import { supabase } from '../supabaseClient';
import { Lock, Mail, User, ArrowLeft, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';

interface AuthProps {
  onAuthSuccess: (session: any) => void;
  initialMode?: 'login' | 'signup' | 'forgot' | 'reset';
}

export default function Auth({ onAuthSuccess, initialMode = 'login' }: AuthProps) {
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot' | 'reset'>(initialMode);
  
  // Form states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  
  // Loading and feedback states
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Validations
  const validateEmail = (val: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
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
    const cleanName = fullName.trim();

    if (!cleanName) {
      setErrorMessage('Please enter your full name.');
      return;
    }
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
        setSuccessMessage('Registration successful! A confirmation email has been sent. Please check your inbox and confirm your email address to verify your account before logging in.');
        setFullName('');
        setEmail('');
        setPassword('');
        setMode('login');
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
        setSuccessMessage('Password reset link sent to your email.');
        // For testing ease in the sandbox:
        setTimeout(() => {
          setMode('reset');
        }, 2000);
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

    setIsLoading(true);
    try {
      const { data, error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) {
        setErrorMessage(error.message);
      } else {
        setSuccessMessage('Password updated successfully! Signing you in...');
        setTimeout(() => {
          const session = localStorage.getItem('gaks_active_user');
          if (session) {
            onAuthSuccess(JSON.parse(session));
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

  // Google OAuth flow simulation (for premium screenshots alignment)
  const handleGoogleSignIn = () => {
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsLoading(true);
    setTimeout(() => {
      // Simulate Google auth login
      const mockProfile = {
        id: 'google-user-' + Math.floor(Math.random() * 1000000),
        full_name: 'Gaks Trader',
        email: 'trader@gaks.ai',
        avatar_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop&crop=face',
        subscription_plan: 'Premium Pro',
        telegram_connected: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      
      // Save simulation
      localStorage.setItem('gaks_active_user', JSON.stringify(mockProfile));
      onAuthSuccess({ user: mockProfile, access_token: 'google-token-abc' });
      setIsLoading(false);
    }, 1000);
  };

  return (
    <div className="min-h-screen w-full bg-[#030303] text-zinc-100 flex flex-col justify-center items-center px-6 py-12 select-none">
      
      {/* Brand logo header matching screenshots */}
      <div className="text-center mb-8 space-y-2">
        <div className="flex items-center justify-center gap-2">
          <span className="text-4xl font-extrabold tracking-tight text-white font-display">Gaks</span>
          <span className="text-2xl font-bold text-zinc-500 font-display">AI</span>
        </div>
        <p className="text-sm font-semibold tracking-wide text-zinc-400 font-display">
          Premium AI Forex Assistant
        </p>
      </div>

      {/* Primary Authenticate Card with elegant border */}
      <div className="w-full max-w-md p-7 sm:p-9 rounded-[2.5rem] border border-zinc-900 bg-[#08080a] shadow-2xl relative overflow-hidden transition-all duration-300">
        
        {/* Decorative inner glow */}
        <div className="absolute inset-0 bg-gradient-to-b from-white/[0.01] to-transparent pointer-events-none rounded-[2.5rem]" />

        {/* View switching animations container */}
        <div className="space-y-6">

          {/* Title Area */}
          <div className="space-y-1.5">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white font-display">
              {mode === 'login' && 'Sign in to your account'}
              {mode === 'signup' && 'Create your account'}
              {mode === 'forgot' && 'Forgot Password'}
              {mode === 'reset' && 'Reset your password'}
            </h2>
            <p className="text-xs text-zinc-500 font-medium">
              {mode === 'login' && 'Continue to your trading workspace.'}
              {mode === 'signup' && 'Get started with Gaks AI in seconds.'}
              {mode === 'forgot' && 'Enter your email to reset your credentials.'}
              {mode === 'reset' && 'Enter your secure new password.'}
            </p>
          </div>

          {/* Feedback Badges */}
          {errorMessage && (
            <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-start gap-3 text-xs leading-relaxed animate-shake">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {successMessage && (
            <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-start gap-3 text-xs leading-relaxed">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{successMessage}</span>
            </div>
          )}

          {/* Mode Form Content */}
          {(mode === 'login' || mode === 'signup') && (
            <>
              {/* Google Button */}
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={isLoading}
                className="w-full py-3.5 px-4 rounded-2xl border border-zinc-800 hover:border-zinc-700/80 bg-zinc-950/20 hover:bg-zinc-900/60 text-white font-semibold text-xs flex items-center justify-center gap-2.5 transition-all cursor-pointer"
              >
                {/* Google Colored 'G' icon built via inline paths */}
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                  <path
                    fill="#EA4335"
                    d="M12 5.04c1.64 0 3.12.56 4.28 1.67l3.2-3.2C17.52 1.58 14.95 1 12 1 7.35 1 3.4 3.65 1.57 7.5l3.82 2.96C6.32 7.37 8.94 5.04 12 5.04z"
                  />
                  <path
                    fill="#4285F4"
                    d="M23.49 12.27c0-.81-.07-1.59-.2-2.36H12v4.51h6.46c-.29 1.48-1.14 2.73-2.43 3.58l3.78 2.92c2.2-2.03 3.48-5.01 3.48-8.65z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.39 14.54c-.25-.75-.39-1.55-.39-2.38s.14-1.63.39-2.38L1.57 6.82C.73 8.49.25 10.37.25 12.37s.48 3.88 1.32 5.55l3.82-3.38z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c3.24 0 5.97-1.07 7.96-2.91l-3.78-2.92c-1.05.7-2.4 1.13-4.18 1.13-3.06 0-5.68-2.33-6.61-5.42L1.57 16.2C3.4 20.05 7.35 23 12 23z"
                  />
                </svg>
                <span>Continue with Google</span>
              </button>

              {/* Divider */}
              <div className="flex items-center gap-3">
                <div className="h-[1px] flex-1 bg-zinc-900" />
                <span className="text-[10px] font-bold tracking-wider text-zinc-600 uppercase">OR</span>
                <div className="h-[1px] flex-1 bg-zinc-900" />
              </div>
            </>
          )}

          {/* Primary Form */}
          <form onSubmit={
            mode === 'login' ? handleLogin :
            mode === 'signup' ? handleSignUp :
            mode === 'forgot' ? handleForgotPassword :
            handleResetPassword
          } className="space-y-4">
            
            {/* Full Name (Sign Up only) */}
            {mode === 'signup' && (
              <div className="space-y-2">
                <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Full Name</label>
                <div className="relative rounded-2xl border border-zinc-900 focus-within:border-zinc-700 bg-zinc-950/40 transition-colors overflow-hidden">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Your Name"
                    className="w-full bg-transparent py-3.5 pl-11 pr-4 text-xs font-semibold text-white focus:outline-none"
                    disabled={isLoading}
                  />
                </div>
              </div>
            )}

            {/* Email Address (Except Reset password) */}
            {mode !== 'reset' && (
              <div className="space-y-2">
                <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Email</label>
                <div className="relative rounded-2xl border border-zinc-900 focus-within:border-zinc-700 bg-zinc-950/40 transition-colors overflow-hidden">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
                  <input
                    type="text"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full bg-transparent py-3.5 pl-11 pr-4 text-xs font-semibold text-white focus:outline-none"
                    disabled={isLoading}
                  />
                </div>
              </div>
            )}

            {/* Password (Login / Sign Up) */}
            {(mode === 'login' || mode === 'signup') && (
              <div className="space-y-2">
                <div className="flex justify-between items-baseline">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Password</label>
                  {mode === 'login' && (
                    <button
                      type="button"
                      onClick={() => {
                        setErrorMessage(null);
                        setSuccessMessage(null);
                        setMode('forgot');
                      }}
                      className="text-[11px] font-semibold text-zinc-500 hover:text-white transition-colors cursor-pointer"
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <div className="relative rounded-2xl border border-zinc-900 focus-within:border-zinc-700 bg-zinc-950/40 transition-colors overflow-hidden">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="........"
                    className="w-full bg-transparent py-3.5 pl-11 pr-4 text-xs font-semibold text-white focus:outline-none"
                    disabled={isLoading}
                  />
                </div>
              </div>
            )}

            {/* New Password (Reset password view) */}
            {mode === 'reset' && (
              <div className="space-y-2">
                <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">New Password</label>
                <div className="relative rounded-2xl border border-zinc-900 focus-within:border-zinc-700 bg-zinc-950/40 transition-colors overflow-hidden">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="........"
                    className="w-full bg-transparent py-3.5 pl-11 pr-4 text-xs font-semibold text-white focus:outline-none"
                    disabled={isLoading}
                  />
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-4 rounded-full bg-white text-zinc-950 font-extrabold text-xs tracking-wide hover:bg-zinc-200 transition-all cursor-pointer flex items-center justify-center gap-2 shadow-lg disabled:opacity-50"
              >
                {isLoading && <RefreshCw className="w-4 h-4 animate-spin shrink-0" />}
                <span>
                  {mode === 'login' && 'Sign in'}
                  {mode === 'signup' && 'Create account'}
                  {mode === 'forgot' && 'Send Reset Link'}
                  {mode === 'reset' && 'Reset Password'}
                </span>
              </button>
            </div>
          </form>

          {/* Mode toggle / navigation links */}
          <div className="text-center pt-1">
            {mode === 'login' && (
              <p className="text-xs text-zinc-500 font-medium">
                New to Gaks?{' '}
                <span
                  onClick={() => {
                    setErrorMessage(null);
                    setSuccessMessage(null);
                    setMode('signup');
                  }}
                  className="text-white font-semibold hover:underline cursor-pointer"
                >
                  Create an account
                </span>
              </p>
            )}

            {mode === 'signup' && (
              <p className="text-xs text-zinc-500 font-medium">
                Already have an account?{' '}
                <span
                  onClick={() => {
                    setErrorMessage(null);
                    setSuccessMessage(null);
                    setMode('login');
                  }}
                  className="text-white font-semibold hover:underline cursor-pointer"
                >
                  Sign in
                </span>
              </p>
            )}

            {(mode === 'forgot' || mode === 'reset') && (
              <button
                type="button"
                onClick={() => {
                  setErrorMessage(null);
                  setSuccessMessage(null);
                  setMode('login');
                }}
                className="inline-flex items-center gap-1 text-xs font-semibold text-zinc-400 hover:text-white transition-colors cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back to Sign In</span>
              </button>
            )}
          </div>

        </div>
      </div>

      {/* Footer agreements */}
      <p className="text-[11px] text-zinc-600 text-center mt-6 tracking-wide">
        By continuing, you agree to our Terms and Privacy Policy.
      </p>

    </div>
  );
}
