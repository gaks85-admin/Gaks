// src/components/ResetPassword.tsx
import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { Eye, EyeOff, CheckCircle2, AlertCircle, ArrowLeft, KeyRound } from 'lucide-react';
import { motion } from 'motion/react';

interface ResetPasswordProps {
  onComplete?: () => void;
}

export default function ResetPassword({ onComplete }: ResetPasswordProps) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [hasRecoverySession, setHasRecoverySession] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const checkSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        
        const hasHashToken = typeof window !== 'undefined' && (
          window.location.hash.includes('access_token') ||
          window.location.hash.includes('type=recovery') ||
          window.location.search.includes('code=')
        );

        if (session || hasHashToken) {
          if (mounted) {
            setHasRecoverySession(true);
          }
        } else {
          if (mounted) {
            setHasRecoverySession(false);
          }
        }
      } catch (err) {
        console.error('Error checking recovery session:', err);
      } finally {
        if (mounted) {
          setIsCheckingSession(false);
        }
      }
    };

    checkSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || session) {
        if (mounted) {
          setHasRecoverySession(true);
          setIsCheckingSession(false);
        }
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const handleGoToLogin = () => {
    window.history.pushState({}, '', '/');
    if (onComplete) {
      onComplete();
    } else {
      window.location.href = '/';
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
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
        setSuccessMessage('Password updated successfully! Redirecting to login...');
        
        await supabase.auth.signOut();

        setTimeout(() => {
          handleGoToLogin();
        }, 2000);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to update your password.');
    } finally {
      setIsLoading(false);
    }
  };

  const isFormValid = newPassword.length >= 6 && confirmNewPassword.length >= 6 && newPassword === confirmNewPassword;

  return (
    <div className="min-h-[100dvh] w-full bg-[#050507] text-white flex flex-col justify-between items-center px-4 py-5 font-sans antialiased select-none relative overflow-x-hidden overflow-y-auto box-border">
      
      {/* Background Sheen */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0 bg-[#050507]">
        <div className="absolute -top-[10%] -right-[10%] w-[700px] h-[700px] bg-gradient-to-bl from-zinc-800/15 via-zinc-900/5 to-transparent rounded-full blur-3xl" />
        <div className="absolute top-0 right-0 w-full h-full bg-[radial-gradient(ellipse_at_top_right,rgba(255,255,255,0.03),transparent_75%)]" />
      </div>

      {/* Header Bar */}
      <div className="w-full max-w-[380px] flex justify-start items-center pt-1 pb-2 relative z-10">
        <button
          type="button"
          onClick={handleGoToLogin}
          className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white transition-colors cursor-pointer font-medium py-1 px-1 -ml-1"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Home</span>
        </button>
      </div>

      {/* Main Container */}
      <div className="w-full max-w-[380px] my-auto flex flex-col justify-center relative z-10 py-4 box-border space-y-5">
        
        {/* Brand Badge */}
        <div className="flex justify-center">
          <div className="w-12 h-12 rounded-2xl bg-[#121217] border border-zinc-800 flex items-center justify-center shadow-md relative overflow-hidden group">
            <span className="text-2xl font-black tracking-tighter text-white font-sans">G</span>
            <div className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)]" />
          </div>
        </div>

        {/* Title */}
        <div className="text-center space-y-1.5">
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white leading-tight">
            Create new password
          </h1>
          <p className="text-xs sm:text-sm text-zinc-400 font-normal leading-relaxed">
            Please enter and confirm your secure new password.
          </p>
        </div>

        {/* Banners */}
        {errorMessage && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-start gap-2.5 text-xs leading-relaxed shadow-sm">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Success Screen */}
        {successMessage ? (
          <div className="p-4 rounded-xl border border-zinc-800 bg-[#121217] text-center space-y-4">
            <div className="w-10 h-10 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-5 h-5 stroke-[2]" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-white">Password Updated</h3>
              <p className="text-xs text-zinc-400 max-w-[260px] mx-auto leading-relaxed">
                {successMessage}
              </p>
            </div>
            <button
              type="button"
              onClick={handleGoToLogin}
              className="w-full py-3 px-4 rounded-xl bg-white text-black font-semibold text-xs sm:text-sm hover:bg-zinc-200 transition-all cursor-pointer"
            >
              Go to Log in
            </button>
          </div>
        ) : isCheckingSession ? (
          <div className="p-6 rounded-xl border border-zinc-800 bg-[#121217] text-center space-y-3">
            <div className="w-5 h-5 rounded-full border-2 border-white border-t-transparent animate-spin mx-auto" />
            <p className="text-xs text-zinc-400 font-medium">Verifying recovery link...</p>
          </div>
        ) : !hasRecoverySession ? (
          <div className="p-6 rounded-xl border border-zinc-800 bg-[#121217] text-center space-y-4">
            <div className="w-10 h-10 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mx-auto">
              <KeyRound className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-white">No Recovery Session</h3>
              <p className="text-xs text-zinc-400 leading-relaxed max-w-[260px] mx-auto">
                Please request a password reset link from the login page.
              </p>
            </div>
            <button
              type="button"
              onClick={handleGoToLogin}
              className="w-full py-3 px-4 rounded-xl bg-white text-black font-semibold text-xs sm:text-sm hover:bg-zinc-200 transition-all cursor-pointer"
            >
              Return to Log in
            </button>
          </div>
        ) : (
          <form onSubmit={handleUpdatePassword} className="space-y-3.5" noValidate>
            <div className="space-y-1.5 text-left">
              <label className="text-xs font-medium text-zinc-300 block">New Password</label>
              <div className="relative rounded-xl border border-zinc-800 bg-[#121217] focus-within:border-zinc-500 transition-all overflow-hidden flex items-center pr-3">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value);
                    setErrorMessage(null);
                  }}
                  disabled={isLoading}
                  placeholder="••••••••••••"
                  className="w-full bg-transparent px-3.5 py-3 text-xs sm:text-sm text-white placeholder-zinc-600 focus:outline-none font-sans pr-2"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="p-1 text-zinc-500 hover:text-white transition-colors cursor-pointer shrink-0"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5 text-left">
              <label className="text-xs font-medium text-zinc-300 block">Confirm New Password</label>
              <div className="relative rounded-xl border border-zinc-800 bg-[#121217] focus-within:border-zinc-500 transition-all overflow-hidden flex items-center pr-3">
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmNewPassword}
                  onChange={(e) => {
                    setConfirmNewPassword(e.target.value);
                    setErrorMessage(null);
                  }}
                  disabled={isLoading}
                  placeholder="••••••••••••"
                  className="w-full bg-transparent px-3.5 py-3 text-xs sm:text-sm text-white placeholder-zinc-600 focus:outline-none font-sans pr-2"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="p-1 text-zinc-500 hover:text-white transition-colors cursor-pointer shrink-0"
                >
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={!isFormValid || isLoading}
                className="w-full py-3.5 px-4 rounded-xl bg-white text-black font-semibold text-xs sm:text-sm hover:bg-zinc-200 transition-all cursor-pointer shadow-md disabled:opacity-35 disabled:cursor-not-allowed"
              >
                {isLoading ? 'Updating password...' : 'Update Password'}
              </button>
            </div>
          </form>
        )}
      </div>

      <div className="text-[11px] text-zinc-600 text-center py-2 relative z-10">
        Gaks AI
      </div>

    </div>
  );
}
