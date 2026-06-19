"use client";

import React, { useState } from "react";
import { SafeUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

interface AuthScreenProps {
  onAuthSuccess: (user: SafeUser) => void;
}

export default function AuthScreen({ onAuthSuccess }: AuthScreenProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleOAuthSignIn = async (provider: "google" | "apple") => {
    setError(null);
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/DiipMynd/api/auth/callback`,
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

    const endpoint = isLogin ? "/DiipMynd/api/auth/login" : "/DiipMynd/api/auth/signup";

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
    <div className="w-full max-w-md p-8 rounded-3xl bg-slate-900/60 border border-white/10 backdrop-blur-xl shadow-2xl shadow-violet-500/10 flex flex-col items-center">
      {/* Title */}
      <div className="text-center mb-8 w-full">
        <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-violet-400 via-cyan-400 to-fuchsia-400 bg-clip-text text-transparent">
          DiipMynd
        </h1>
        <p className="text-sm text-white/50 mt-2">
          {isLogin ? "Log in to your account" : "Create a new account"}
        </p>
      </div>

      {/* Error Message */}
      {error && (
        <div className="w-full p-4.5 mb-6 rounded-xl bg-rose-500/10 border border-rose-500/20 text-center animate-shake">
          <p className="text-xs text-rose-300 font-medium">{error}</p>
        </div>
      )}

      {/* OAuth Social Logins */}
      <div className="w-full flex flex-col gap-3 mb-5">
        <button
          type="button"
          onClick={() => handleOAuthSignIn("google")}
          disabled={loading}
          className="w-full py-3 rounded-xl font-bold text-xs tracking-wide border border-white/10 hover:border-white/20 bg-white/[0.03] hover:bg-white/[0.06] text-white flex items-center justify-center gap-2 cursor-pointer transition-all duration-200"
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
          className="w-full py-3 rounded-xl font-bold text-xs tracking-wide border border-white/10 hover:border-white/20 bg-white/[0.03] hover:bg-white/[0.06] text-white flex items-center justify-center gap-2 cursor-pointer transition-all duration-200"
        >
          <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
            <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 4.17c.66-.81 1.11-1.93.99-3.06-.96.04-2.13.64-2.82 1.45-.6.69-1.12 1.83-.98 2.94.12.02.12.02.24.02.84 0 1.91-.54 2.57-1.35z"/>
          </svg>
          Continue with Apple
        </button>

        {/* Divider */}
        <div className="flex items-center my-3 w-full">
          <div className="flex-1 h-[1px] bg-white/5" />
          <span className="px-3 text-[10px] font-bold text-white/30 uppercase tracking-widest flex-shrink-0">
            or use email & password
          </span>
          <div className="flex-1 h-[1px] bg-white/5" />
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="w-full flex flex-col gap-5">
        {/* Email Field */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold tracking-wider text-white/40 uppercase">
            Email Address
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
            placeholder="willstanelson@gmail.com"
            className="w-full px-4 py-3 rounded-xl bg-white/[0.03] border border-white/10 text-white placeholder-white/20 focus:border-violet-500 focus:bg-white/[0.05] focus:outline-none transition-all text-sm"
          />
        </div>

        {/* Password Field */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold tracking-wider text-white/40 uppercase">
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
            placeholder="••••••••"
            className="w-full px-4 py-3 rounded-xl bg-white/[0.03] border border-white/10 text-white placeholder-white/20 focus:border-violet-500 focus:bg-white/[0.05] focus:outline-none transition-all text-sm"
          />
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={loading}
          className="
            w-full mt-2 py-3.5 rounded-xl font-bold text-sm tracking-wide
            bg-gradient-to-r from-violet-600 to-cyan-500
            text-white shadow-lg shadow-violet-500/20
            hover:shadow-xl hover:shadow-violet-500/30 hover:brightness-110
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
        <span className="text-white/40">
          {isLogin ? "Don't have an account? " : "Already have an account? "}
        </span>
        <button
          type="button"
          onClick={() => {
            setIsLogin(!isLogin);
            setError(null);
          }}
          disabled={loading}
          className="text-violet-400 hover:text-violet-300 font-semibold underline cursor-pointer transition-colors"
        >
          {isLogin ? "Sign Up" : "Log In"}
        </button>
      </div>
    </div>
  );
}
