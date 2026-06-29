"use client";

// ============================================================================
// DiipMynd — AuthScreen  ·  Obsidian Night
// Pure monochrome black glass card. No theme toggle, no indigo, no slate.
// The only inverted surface is the primary CTA (white button, black text) —
// used sparingly to draw the eye to the action that progresses the user.
// ============================================================================

import React, { useState, useEffect, useRef } from "react";
import { SafeUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase/client";
import { GoogleLogin } from "@react-oauth/google";


interface AuthScreenProps {
  onAuthSuccess: (user: SafeUser) => void;
  initialMode?: "login" | "signup" | "forgot" | "reset";
}

export default function AuthScreen({ onAuthSuccess, initialMode }: AuthScreenProps) {
  const [mode, setMode] = useState<"login" | "signup" | "forgot" | "reset">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [agree, setAgree] = useState(false);

  const rawNonce = useRef<string>(crypto.randomUUID());
  const [hashedNonce, setHashedNonce] = useState<string | null>(null);

  useEffect(() => {
    const encoder = new TextEncoder();
    const data = encoder.encode(rawNonce.current);
    crypto.subtle.digest("SHA-256", data)
      .then((buf) => {
        const hashArray = Array.from(new Uint8Array(buf));
        const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
        setHashedNonce(hashHex);
      })
      .catch((err) => {
        console.error("Failed to generate nonce hash:", err);
      });
  }, []);

  // Sync mode if initialMode prop changes (e.g. PASSWORD_RECOVERY detected)
  useEffect(() => {
    if (initialMode) {
      setMode(initialMode);
      setError(null);
      setSuccessMessage(null);
    }
  }, [initialMode]);

  const handleOAuthSignIn = async (provider: "google" | "apple") => {
    setError(null);
    setSuccessMessage(null);

    if (mode === "signup" && !agree) {
      setError("You must agree to the Content Policy to create an account.");
      return;
    }

    setLoading(true);
    try {
      const isLocalhost =
        window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1";

      const redirectTo = isLocalhost
        ? `${window.location.origin}/api/auth/callback`
        : `${window.location.origin}/api/auth/callback`;

      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo },
      });
      if (error) throw error;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : `${provider} sign-in failed`;
      setError(message);
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);
    setLoading(true);

    const trimmedEmail = email.trim();

    // ── Forgot Password Mode ────────────────────────────────────────────────
    if (mode === "forgot") {
      if (!trimmedEmail) {
        setError("Please enter your email address.");
        setLoading(false);
        return;
      }
      try {
        const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
          redirectTo: `${window.location.origin}/api/auth/callback`,
        });
        if (error) throw error;
        setSuccessMessage("Password reset email sent! Please check your inbox.");
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to send reset link";
        setError(msg);
      } finally {
        setLoading(false);
      }
      return;
    }

    // ── Reset Password Mode ────────────────────────────────────────────────
    if (mode === "reset") {
      if (!password || !confirmPassword) {
        setError("Please fill in all password fields.");
        setLoading(false);
        return;
      }
      if (password.length < 6) {
        setError("Password must be at least 6 characters.");
        setLoading(false);
        return;
      }
      if (password !== confirmPassword) {
        setError("Passwords do not match.");
        setLoading(false);
        return;
      }
      try {
        const { data, error } = await supabase.auth.updateUser({ password });
        if (error || !data.user) {
          throw error || new Error("Failed to update password.");
        }

        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          throw new Error("No active session found after password reset.");
        }

        const res = await fetch("/api/auth/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accessToken: session.access_token,
            expiresIn: session.expires_in,
          }),
        });

        const resData = await res.json();
        if (!res.ok) {
          throw new Error(resData.error || "Failed to establish cookie session.");
        }

        setSuccessMessage("Password updated successfully!");
        onAuthSuccess(resData.user);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Password reset failed";
        setError(msg);
      } finally {
        setLoading(false);
      }
      return;
    }

    // ── Login / SignUp Modes ────────────────────────────────────────────────
    if (!trimmedEmail || !password) {
      setError("Please fill in all fields.");
      setLoading(false);
      return;
    }

    const consentCheckbox = document.getElementById("disclaimer-consent") as HTMLInputElement | null;
    const isAgreed = consentCheckbox ? consentCheckbox.checked : agree;

    if (mode === "signup" && !isAgreed) {
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

    const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/signup";

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
    <div className="relative w-full max-w-md p-8 rounded-2xl glass-panel-strong flex flex-col items-center animate-scale-in">

      {/* Brand mark — animated bolt */}
      <div className="relative mb-6">
        <div className="absolute inset-0 rounded-xl bg-white/10 blur-md opacity-50 animate-glow" />
        <div className="relative w-12 h-12 rounded-xl bg-gradient-to-br from-white/15 to-white/5 border border-white/10 flex items-center justify-center shadow-lg">
          <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M13 2 3 14h9l-1 8 10-12h-9z" />
          </svg>
        </div>
      </div>

      {/* Title */}
      <div className="text-center mb-8 w-full">
        <h1 className="font-display text-3xl font-bold tracking-tight text-white">
          DiipMynd
        </h1>
        <p className="text-[13px] text-neutral-500 mt-2 font-medium">
          {mode === "login" && "Log in to your account"}
          {mode === "signup" && "Create a new account"}
          {mode === "forgot" && "Reset your password"}
          {mode === "reset" && "Create new password"}
        </p>
      </div>

      {/* Error Message — monochrome with red accent only on the icon */}
      {error && (
        <div className="w-full p-3.5 mb-5 rounded-xl bg-white/[0.03] border border-white/[0.08] flex items-start gap-3 animate-fade-in">
          <div className="mt-0.5 w-4 h-4 rounded-full bg-red-500/15 border border-red-500/30 flex items-center justify-center flex-shrink-0">
            <span className="text-red-400 text-[10px] font-bold">!</span>
          </div>
          <p className="text-[12px] text-neutral-200 font-medium leading-relaxed flex-1">{error}</p>
        </div>
      )}

      {/* Success Message */}
      {successMessage && (
        <div className="w-full p-3.5 mb-5 rounded-xl bg-white/[0.03] border border-white/[0.08] flex items-start gap-3 animate-fade-in">
          <div className="mt-0.5 w-4 h-4 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center flex-shrink-0">
            <svg className="w-2.5 h-2.5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </div>
          <p className="text-[12px] text-neutral-200 font-medium leading-relaxed flex-1">{successMessage}</p>
        </div>
      )}

      {/* OAuth Social Logins */}
      {(mode === "login" || mode === "signup") && (
        <div className="w-full flex flex-col gap-3 mb-5">
          <div className="w-full flex justify-center">
            {hashedNonce ? (
              <GoogleLogin
                nonce={hashedNonce}
                width="384"
                onSuccess={async (credentialResponse) => {
                  if (!credentialResponse.credential) {
                    setError("Google Sign-In failed: no credential received.");
                    return;
                  }

                  setLoading(true);
                  setError(null);
                  try {
                    const { error: authError } = await supabase.auth.signInWithIdToken({
                      provider: "google",
                      token: credentialResponse.credential,
                      nonce: rawNonce.current,
                    });
                    if (authError) throw authError;

                    const res = await fetch("/api/auth/me");
                    const meData = await res.json();
                    if (!res.ok || !meData.user) {
                      throw new Error(meData.error || "Failed to retrieve authenticated user details.");
                    }

                    setLoading(false);
                    onAuthSuccess(meData.user);
                  } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : "Google sign-in failed";
                    setError(msg);
                    setLoading(false);
                  }
                }}
                onError={() => {
                  setError("Google Sign-In failed. Please try again.");
                }}
              />
            ) : (
              <div className="flex items-center justify-center p-2">
                <div className="w-5 h-5 rounded-full border-2 border-white/10 border-t-white/80 animate-spin" />
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => handleOAuthSignIn("apple")}
            disabled={loading}
            className="w-full py-3 rounded-xl font-semibold text-[13px] tracking-wide border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06] hover:border-white/[0.14] text-neutral-200 flex items-center justify-center gap-2.5 cursor-pointer transition-all duration-200"
          >
            <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
              <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 4.17c.66-.81 1.11-1.93.99-3.06-.96.04-2.13.64-2.82 1.45-.6.69-1.12 1.83-.98 2.94.12.02.12.02.24.02.84 0 1.91-.54 2.57-1.35z"/>
            </svg>
            Continue with Apple
          </button>

          {/* Divider */}
          <div className="flex items-center my-2 w-full">
            <div className="flex-1 h-px bg-white/[0.06]" />
            <span className="px-3 text-[10px] font-semibold text-neutral-600 uppercase tracking-[0.2em] flex-shrink-0">
              or use email
            </span>
            <div className="flex-1 h-px bg-white/[0.06]" />
          </div>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="w-full flex flex-col gap-4">
        {/* Email Field */}
        {(mode === "login" || mode === "signup" || mode === "forgot") && (
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-semibold tracking-[0.18em] text-neutral-500 uppercase">
              Email Address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              placeholder="you@studio.com"
              className="w-full px-4 py-3 rounded-xl bg-white/[0.025] border border-white/[0.06] text-white placeholder-neutral-600 focus:border-white/20 focus:bg-white/[0.04] focus:outline-none transition-all text-[14px]"
            />
          </div>
        )}

        {/* Password Field */}
        {(mode === "login" || mode === "signup" || mode === "reset") && (
          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between items-center">
              <label className="text-[10px] font-semibold tracking-[0.18em] text-neutral-500 uppercase">
                {mode === "reset" ? "New Password" : "Password"}
              </label>
              {mode === "login" && (
                <button
                  type="button"
                  onClick={() => {
                    setMode("forgot");
                    setError(null);
                    setSuccessMessage(null);
                  }}
                  className="text-[11px] text-neutral-400 hover:text-white font-semibold transition-colors cursor-pointer"
                >
                  Forgot?
                </button>
              )}
            </div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              placeholder="••••••••"
              className="w-full px-4 py-3 rounded-xl bg-white/[0.025] border border-white/[0.06] text-white placeholder-neutral-600 focus:border-white/20 focus:bg-white/[0.04] focus:outline-none transition-all text-[14px]"
            />
          </div>
        )}

        {/* Confirm Password Field (Reset mode only) */}
        {mode === "reset" && (
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-semibold tracking-[0.18em] text-neutral-500 uppercase">
              Confirm New Password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={loading}
              placeholder="••••••••"
              className="w-full px-4 py-3 rounded-xl bg-white/[0.025] border border-white/[0.06] text-white placeholder-neutral-600 focus:border-white/20 focus:bg-white/[0.04] focus:outline-none transition-all text-[14px]"
            />
          </div>
        )}

        {/* Content Warning & Disclaimer Checkbox (SignUp only) */}
        {mode === "signup" && (
          <div className="flex items-start gap-3 mt-1 px-1">
            <input
              type="checkbox"
              id="disclaimer-consent"
              checked={agree}
              onChange={(e) => setAgree(e.target.checked)}
              disabled={loading}
              className="mt-0.5 h-4 w-4 rounded-[4px] border border-white/15 bg-white/[0.04] accent-white cursor-pointer"
            />
            <label htmlFor="disclaimer-consent" className="text-[11px] text-neutral-500 leading-relaxed cursor-pointer select-none">
              I agree that I will not upload reference images without consent, nor generate non-consensual deepfakes, impersonate others, or create abusive content. I understand that violating this policy will result in immediate termination of my account.
            </label>
          </div>
        )}

        {/* Submit Button — inverted white surface (primary CTA) */}
        <button
          type="submit"
          disabled={loading}
          className="
            w-full mt-3 py-3.5 rounded-xl font-bold text-[13px] tracking-wide
            bg-white text-black shadow-lg
            hover:shadow-xl hover:shadow-white/10 hover:bg-neutral-200
            active:scale-[0.98] disabled:opacity-40 disabled:scale-100 disabled:cursor-not-allowed
            transition-all duration-200 cursor-pointer flex items-center justify-center gap-2
          "
        >
          {loading ? (
            <>
              <div className="w-4 h-4 rounded-full border-2 border-black/20 border-t-black animate-spin" />
              Processing…
            </>
          ) : (
            <>
              {mode === "login" && "Log In"}
              {mode === "signup" && "Create Account"}
              {mode === "forgot" && "Send Reset Link"}
              {mode === "reset" && "Update Password"}
            </>
          )}
        </button>
      </form>

      {/* Switch mode */}
      <div className="mt-7 text-center text-[12px]">
        {mode === "login" && (
          <>
            <span className="text-neutral-500">Don't have an account? </span>
            <button
              type="button"
              onClick={() => {
                setMode("signup");
                setError(null);
                setSuccessMessage(null);
                setAgree(false);
              }}
              disabled={loading}
              className="text-neutral-200 hover:text-white font-semibold underline underline-offset-2 cursor-pointer transition-colors"
            >
              Sign Up
            </button>
          </>
        )}
        {mode === "signup" && (
          <>
            <span className="text-neutral-500">Already have an account? </span>
            <button
              type="button"
              onClick={() => {
                setMode("login");
                setError(null);
                setSuccessMessage(null);
              }}
              disabled={loading}
              className="text-neutral-200 hover:text-white font-semibold underline underline-offset-2 cursor-pointer transition-colors"
            >
              Log In
            </button>
          </>
        )}
        {mode === "forgot" && (
          <button
            type="button"
            onClick={() => {
              setMode("login");
              setError(null);
              setSuccessMessage(null);
            }}
            disabled={loading}
            className="text-neutral-200 hover:text-white font-semibold underline underline-offset-2 cursor-pointer transition-colors"
          >
            Back to Log In
          </button>
        )}
      </div>

      {/* Legal Footer Disclaimer Banner */}
      <div className="mt-6 pt-4 border-t border-white/[0.06] text-[10px] text-neutral-600 text-center max-w-[320px] leading-relaxed">
        <span className="font-semibold text-neutral-500 block mb-1 uppercase tracking-wider">Safety &amp; Policy</span>
        This platform is built for legitimate presentation and content creation. Non-consensual deepfakes or impersonation are strictly banned and will result in instant account deactivation.
      </div>
    </div>
  );
}
