"use client";

import React, { useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { SafeUser } from "@/lib/auth";

interface AuthScreenProps {
  onAuthSuccess: (user: SafeUser) => void;
  theme: "light" | "dark";
  toggleTheme: () => void;
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabase = createClient(supabaseUrl, supabaseAnonKey);

export default function AuthScreen({ onAuthSuccess, theme, toggleTheme }: AuthScreenProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agree, setAgree] = useState(false);

  const handleOAuthSignIn = async (provider: "google" | "apple") => {
    setError(null);
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/api/auth/callback`,
        },
      });
      if (error) {
        throw error;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : `${provider} sign-in failed`;
      setError(message);
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError("Please fill in all fields.");
      setLoading(false);
      return;
    }

    if (!isLogin && !agree) {
      setError("You must agree to the Content Policy to create an account.");
      setLoading(false);
      return;
    }

    if (!trimmedEmail.includes("@")) {
      setError("Please enter a valid email address.");
      setLoading(false);
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      setLoading(false);
      return;
    }

    const endpoint = isLogin ? "/api/auth/login" : "/api/auth/signup";

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmedEmail, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Something went wrong. Please try again.");
      }

      onAuthSuccess(data.user);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Request failed";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative w-full max-w-md p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl dark:shadow-slate-950/40 flex flex-col items-center transition-colors duration-200">
      {/* Theme Toggle in Top Right of the card */}
      <button
        onClick={toggleTheme}
        className="absolute top-4 right-4 p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
        title={theme === "light" ? "Switch to Dark Mode" : "Switch to Light Mode"}
      >
        {theme === "light" ? "🌙" : "☀️"}
      </button>

      {/* Title */}
      <div className="text-center mb-8 w-full">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
          DiipMynd
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
          {isLogin ? "Log in to your account" : "Create a new account"}
        </p>
      </div>

      {/* Error Message */}
      {error && (
        <div className="w-full p-4 mb-6 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-100 dark:border-rose-900/40 text-center animate-shake">
          <p className="text-xs text-rose-600 dark:text-rose-400 font-medium">{error}</p>
        </div>
      )}

      {/* OAuth Social Logins */}
      <div className="w-full flex flex-col gap-3 mb-5">
        <button
          type="button"
          onClick={() => handleOAuthSignIn("google")}
          disabled={loading}
          className="w-full py-3 rounded-xl font-bold text-xs tracking-wide border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center gap-2 cursor-pointer transition-all duration-200"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/>
          </svg>
          Continue with Google
        </button>
        <button
          type="button"
          onClick={() => handleOAuthSignIn("apple")}
          disabled={loading}
          className="w-full py-3 rounded-xl font-bold text-xs tracking-wide border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center gap-2 cursor-pointer transition-all duration-200"
        >
          <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
            <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 4.17c.66-.81 1.11-1.93.99-3.06-.96.04-2.13.64-2.82 1.45-.6.69-1.12 1.83-.98 2.94.12.02.12.02.24.02.84 0 1.91-.54 2.57-1.35z"/>
          </svg>
          Continue with Apple
        </button>

        {/* Divider */}
        <div className="flex items-center my-3 w-full">
          <div className="flex-1 h-[1px] bg-slate-200 dark:bg-slate-800" />
          <span className="px-3 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest flex-shrink-0">
            or use email & password
          </span>
          <div className="flex-1 h-[1px] bg-slate-200 dark:bg-slate-800" />
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="w-full flex flex-col gap-5">
        {/* Email Field */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold tracking-wider text-slate-500 dark:text-slate-400 uppercase">
            Email Address
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
            placeholder="willstanelson@gmail.com"
            className="w-full px-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-600 focus:border-indigo-600 dark:focus:border-indigo-500 focus:bg-white dark:focus:bg-slate-900 focus:outline-none transition-all text-sm"
          />
        </div>

        {/* Password Field */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold tracking-wider text-slate-500 dark:text-slate-400 uppercase">
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
            placeholder="••••••••"
            className="w-full px-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-600 focus:border-indigo-600 dark:focus:border-indigo-500 focus:bg-white dark:focus:bg-slate-900 focus:outline-none transition-all text-sm"
          />
        </div>

        {/* Content Warning & Disclaimer Checkbox (SignUp only) */}
        {!isLogin && (
          <div className="flex items-start gap-3 mt-1 px-1">
            <input
              type="checkbox"
              id="disclaimer-consent"
              checked={agree}
              onChange={(e) => setAgree(e.target.checked)}
              disabled={loading}
              className="mt-1.5 h-4 w-4 rounded border-slate-350 dark:border-slate-700 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
            />
            <label htmlFor="disclaimer-consent" className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed cursor-pointer select-none">
              I agree that I will not upload reference images without consent, nor generate non-consensual deepfakes, impersonate others, or create abusive content. I understand that violating this policy will result in immediate termination of my account.
            </label>
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={loading}
          className="
            w-full mt-2 py-3.5 rounded-xl font-bold text-sm tracking-wide
            bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/10
            hover:shadow-lg hover:shadow-indigo-600/15
            active:scale-[0.98] disabled:opacity-50 disabled:scale-100
            transition-all duration-200 cursor-pointer flex items-center justify-center gap-2
          "
        >
          {loading ? (
            <>
              <div className="w-4 h-4 rounded-full border-2 border-white/20 border-t-white animate-spin" />
              Processing...
            </>
          ) : isLogin ? (
            "Log In"
          ) : (
            "Create Account"
          )}
        </button>
      </form>

      {/* Switch mode */}
      <div className="mt-8 text-center text-xs">
        <span className="text-slate-500 dark:text-slate-400">
          {isLogin ? "Don't have an account? " : "Already have an account? "}
        </span>
        <button
          type="button"
          onClick={() => {
            setIsLogin(!isLogin);
            setError(null);
            setAgree(false); // Reset agree state
          }}
          disabled={loading}
          className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-350 font-semibold underline cursor-pointer transition-colors"
        >
          {isLogin ? "Sign Up" : "Log In"}
        </button>
      </div>

      {/* Legal Footer Disclaimer Banner */}
      <div className="mt-6 pt-4 border-t border-slate-150 dark:border-slate-800 text-[10px] text-slate-400 dark:text-slate-500 text-center max-w-[320px] leading-relaxed transition-colors duration-200">
        <span className="font-bold text-slate-550 dark:text-slate-450 block mb-1">⚠️ Safety & Policy Warning</span>
        This platform is built for legitimate presentation and content creation. Non-consensual deepfakes or impersonation are strictly banned and will result in instant account deactivation.
      </div>
    </div>
  );
}
