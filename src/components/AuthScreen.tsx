"use client";

import React, { useState } from "react";
import { SafeUser } from "@/lib/auth";

interface AuthScreenProps {
  onAuthSuccess: (user: SafeUser) => void;
}

export default function AuthScreen({ onAuthSuccess }: AuthScreenProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
