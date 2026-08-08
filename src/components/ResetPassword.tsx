import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { Lock, Eye, EyeOff, CheckCircle2, AlertCircle, ArrowLeft, KeyRound } from 'lucide-react';
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
        
        // Sign out to ensure clean state with new password
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
    <div className="h-[100dvh] w-full max-w-[100vw] bg-[#030305] text-white flex flex-col justify-between items-center px-3.5 py-3.5 font-sans antialiased select-none relative overflow-hidden box-border">
      
      {/* Top ambient glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-[500px] h-[250px] bg-gradient-to-b from-zinc-800/20 via-transparent to-transparent blur-[100px] pointer-events-none overflow-hidden" />

      <div className="w-full max-w-[400px] flex flex-col items-center relative z-10">
        
        {/* Logo */}
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-col items-center mb-8"
        >
          <div className="w-16 h-16 rounded-[22px] bg-white dark:bg-[#0c0c0e] border border-zinc-200 dark:border-[#262626] flex items-center justify-center shadow-[0_12px_36px_rgba(0,0,0,0.1)] dark:shadow-[0_12px_36px_rgba(0,0,0,0.9)] mb-5 relative group overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-tr from-zinc-500/[0.03] dark:from-white/[0.06] via-transparent to-transparent pointer-events-none" />
            <span className="text-3xl font-black tracking-tighter text-zinc-950 dark:text-white">G</span>
            <div className="absolute top-2.5 right-2.5 w-1.5 h-1.5 rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.8)]" />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xl font-bold tracking-tight text-zinc-950 dark:text-white">Gaks</span>
            <span className="text-xl font-normal text-zinc-400 dark:text-zinc-500">AI</span>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="w-full"
        >
          {/* Header */}
          <div className="text-center space-y-2 mb-8">
            <h1 className="text-2xl sm:text-[28px] font-bold tracking-tight text-zinc-950 dark:text-white leading-tight">
              Create New Password
            </h1>
            <p className="text-[13px] sm:text-sm text-zinc-500 dark:text-zinc-400 font-normal leading-relaxed max-w-[340px] mx-auto">
              Please enter and confirm your new secure password.
            </p>
          </div>

          {/* Feedback Banners */}
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

          {/* Success screen */}
          {successMessage ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              className="p-7 sm:p-8 rounded-[24px] border border-zinc-200 dark:border-[#262626] bg-white dark:bg-[#0c0c0e] text-center space-y-6 shadow-2xl relative overflow-hidden"
            >
              <div className="w-14 h-14 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-100 flex items-center justify-center mx-auto shadow-[0_0_30px_rgba(255,255,255,0.1)]">
                <CheckCircle2 className="w-7 h-7 stroke-[2]" />
              </div>
              <div className="space-y-2">
                <h3 className="text-lg font-bold text-zinc-950 dark:text-white tracking-tight">
                  Password Updated
                </h3>
                <p className="text-[13px] text-zinc-500 dark:text-zinc-400 leading-relaxed max-w-[280px] mx-auto">
                  {successMessage}
                </p>
              </div>
              <button
                type="button"
                onClick={handleGoToLogin}
                className="w-full py-3.5 px-5 rounded-[20px] bg-zinc-950 dark:bg-white text-white dark:text-black font-semibold text-sm hover:bg-zinc-800 dark:hover:bg-zinc-200 active:scale-[0.99] transition-all cursor-pointer shadow-md"
              >
                Go to Sign In
              </button>
            </motion.div>
          ) : isCheckingSession ? (
            <div className="p-8 rounded-[24px] border border-zinc-200 dark:border-[#262626] bg-white dark:bg-[#0c0c0e] text-center space-y-4">
              <div className="w-6 h-6 rounded-full border-2 border-zinc-950 dark:border-white border-t-transparent animate-spin mx-auto" />
              <p className="text-xs text-zinc-500 font-medium">Verifying recovery link...</p>
            </div>
          ) : !hasRecoverySession ? (
            <div className="p-7 sm:p-8 rounded-[24px] border border-zinc-200 dark:border-[#262626] bg-white dark:bg-[#0c0c0e] text-center space-y-6 shadow-xl">
              <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-500 flex items-center justify-center mx-auto">
                <KeyRound className="w-6 h-6" />
              </div>
              <div className="space-y-2">
                <h3 className="text-base font-bold text-zinc-950 dark:text-white">
                  No Active Recovery Session
                </h3>
                <p className="text-[13px] text-zinc-500 dark:text-zinc-400 leading-relaxed max-w-[280px] mx-auto">
                  Please use the password reset link sent to your email, or request a new reset link.
                </p>
              </div>
              <button
                type="button"
                onClick={handleGoToLogin}
                className="w-full py-3.5 px-5 rounded-[20px] bg-zinc-950 dark:bg-white text-white dark:text-black font-semibold text-sm hover:bg-zinc-800 dark:hover:bg-zinc-200 active:scale-[0.99] transition-all cursor-pointer shadow-md flex items-center justify-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Return to Sign In</span>
              </button>
            </div>
          ) : (
            <form onSubmit={handleUpdatePassword} className="space-y-4" noValidate>
              {/* New Password Input */}
              <div className="space-y-1.5">
                <div className="relative rounded-[20px] border border-zinc-200 dark:border-[#262626] bg-zinc-50 dark:bg-[#0c0c0e] focus-within:border-zinc-400 dark:focus-within:border-zinc-500 focus-within:bg-white dark:focus-within:bg-[#101015] transition-all">
                  <input
                    id="newPassword"
                    type={showPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => {
                      setNewPassword(e.target.value);
                      setErrorMessage(null);
                    }}
                    disabled={isLoading}
                    placeholder="New Password"
                    className="w-full bg-transparent px-4 py-4 text-[14px] sm:text-[15px] font-medium text-zinc-950 dark:text-white focus:outline-none rounded-[20px] pr-12"
                  />
                  <div className="absolute right-3.5 top-1/2 -translate-y-1/2 z-10 flex items-center">
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="p-1 text-zinc-500 hover:text-zinc-950 dark:hover:text-white transition-colors cursor-pointer"
                      title={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Confirm New Password Input */}
              <div className="space-y-1.5">
                <div className={`relative rounded-[20px] border bg-zinc-50 dark:bg-[#0c0c0e] focus-within:bg-white dark:focus-within:bg-[#101015] transition-all ${
                  confirmNewPassword.length > 0 && newPassword !== confirmNewPassword
                    ? 'border-red-500/60'
                    : 'border-zinc-200 dark:border-[#262626] focus-within:border-zinc-400 dark:focus-within:border-zinc-500'
                }`}>
                  <input
                    id="confirmNewPassword"
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmNewPassword}
                    onChange={(e) => {
                      setConfirmNewPassword(e.target.value);
                      setErrorMessage(null);
                    }}
                    disabled={isLoading}
                    placeholder="Confirm New Password"
                    className="w-full bg-transparent px-4 py-4 text-[14px] sm:text-[15px] font-medium text-zinc-950 dark:text-white focus:outline-none rounded-[20px] pr-12"
                  />
                  <div className="absolute right-3.5 top-1/2 -translate-y-1/2 z-10 flex items-center">
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="p-1 text-zinc-500 hover:text-zinc-950 dark:hover:text-white transition-colors cursor-pointer"
                      title={showConfirmPassword ? 'Hide password' : 'Show password'}
                    >
                      {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                {confirmNewPassword.length > 0 && newPassword !== confirmNewPassword && (
                  <p className="text-[12px] text-red-400 font-medium pl-2">
                    Passwords do not match
                  </p>
                )}
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={!isFormValid || isLoading}
                  className="w-full py-4 px-6 rounded-[20px] bg-zinc-950 dark:bg-white text-white dark:text-black font-semibold text-[14px] sm:text-[15px] hover:bg-zinc-800 dark:hover:bg-zinc-200 active:scale-[0.99] transition-all duration-200 cursor-pointer flex items-center justify-center gap-2.5 shadow-lg disabled:opacity-35 disabled:cursor-not-allowed"
                >
                  {isLoading ? (
                    <div className="flex items-center gap-2.5">
                      <div className="w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin shrink-0" />
                      <span>Updating password...</span>
                    </div>
                  ) : (
                    <span>Update Password</span>
                  )}
                </button>
              </div>

              <div className="text-center pt-4">
                <button
                  type="button"
                  onClick={handleGoToLogin}
                  className="inline-flex items-center gap-1.5 text-[13px] font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white transition-colors cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back to Sign In</span>
                </button>
              </div>
            </form>
          )}
        </motion.div>
      </div>

      <p className="text-[11px] text-zinc-600 text-center mt-10 tracking-wide relative z-10 max-w-xs">
        Protected by Gaks AI Security Architecture.
      </p>
    </div>
  );
}
