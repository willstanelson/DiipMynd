"use client";

// ============================================================================
// DiipMynd — Home Page  ·  Obsidian Night (dark locked)
// Session check + auth wall. Theme is permanently dark — no toggle, no
// localStorage dance, no system-preference detection.
// ============================================================================

import { useEffect, useState } from "react";
import WorkstationLayout from "@/components/WorkstationLayout";
import AuthScreen from "@/components/AuthScreen";
import { SafeUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase/client";

export default function Home() {
  const [user, setUser] = useState<SafeUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [authMode, setAuthMode] = useState<"login" | "signup" | "forgot" | "reset">("login");

  // ── Hard-lock to dark mode ────────────────────────────────────────────────
  // Mount once, set the dark class, never change it. Also strip any stale
  // "theme" entry from localStorage so legacy code doesn't re-introduce light.
  useEffect(() => {
    document.documentElement.classList.add("dark");
    document.documentElement.classList.remove("light");
    document.documentElement.style.colorScheme = "dark";
    try {
      localStorage.removeItem("theme");
    } catch {
      /* noop */
    }
  }, []);

  // Check if session exists on load
  const checkSession = async () => {
    try {
      const isRecovery = typeof window !== "undefined" && (
        window.location.hash.includes("type=recovery") ||
        window.location.search.includes("type=recovery")
      );

      if (isRecovery) {
        setAuthMode("reset");
        setLoading(false);
        return;
      }

      const res = await fetch("/api/auth/me");
      const data = await res.json();
      if (data.user) {
        setUser(data.user);
        if (window.location.hash || window.location.search.includes("code=")) {
          window.history.replaceState(null, "", window.location.pathname);
        }
      } else {
        setUser(null);
      }
    } catch (err) {
      console.error("[app] Failed to verify session:", err);
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log("[app] onAuthStateChange fired:", { event, hasSession: !!session, userEmail: session?.user?.email });

      if (event === "PASSWORD_RECOVERY") {
        setAuthMode("reset");
        setLoading(false);
        return;
      }

      if (event === "SIGNED_IN" && session && authMode !== "reset") {
        try {
          const res = await fetch("/api/auth/me");
          const data = await res.json();
          if (data.user) {
            setUser(data.user);
            if (window.location.hash || window.location.search.includes("code=")) {
              window.history.replaceState(null, "", window.location.pathname);
            }
          }
        } catch (err) {
          console.error("[app] Failed to sync session on auth state change:", err);
        }
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [authMode]);

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      await supabase.auth.signOut();
      setUser(null);
    } catch (err) {
      console.error("[app] Logout request failed:", err);
    }
  };

  const refreshUserBalance = async () => {
    try {
      const res = await fetch("/api/auth/me");
      const data = await res.json();
      if (data.user) {
        setUser(data.user);
      }
    } catch (err) {
      console.error("[app] Failed to refresh user balance:", err);
    }
  };

  // ── Loading screen — obsidian spinner ─────────────────────────────────────
  if (loading) {
    return (
      <main className="relative z-10 flex min-h-dvh flex-col items-center justify-center p-6 bg-[#030304]">
        <div className="aurora-bg" />
        <div className="relative flex flex-col items-center gap-5">
          {/* Three-ring monochrome spinner */}
          <div className="relative w-12 h-12">
            <div className="absolute inset-0 rounded-full border border-white/10" />
            <div className="absolute inset-0 rounded-full border-2 border-white/10 border-t-white/80 animate-spin" />
            <div className="absolute inset-1.5 rounded-full border border-white/5 border-b-white/40 animate-spin" style={{ animationDirection: "reverse", animationDuration: "1.4s" }} />
          </div>
          <p className="text-[11px] text-neutral-600 tracking-[0.2em] uppercase font-semibold">
            Connecting to DiipMynd
          </p>
        </div>
      </main>
    );
  }

  // ── Authenticated → Workstation · Otherwise → AuthScreen ───────────────────
  return user && authMode !== "reset" ? (
    <WorkstationLayout
      user={user}
      onLogout={handleLogout}
      onBalanceUpdated={refreshUserBalance}
    />
  ) : (
    <main className="relative z-10 flex min-h-dvh flex-col items-center justify-center p-6 md:p-10">
      <div className="aurora-bg" />
      <AuthScreen
        onAuthSuccess={(u) => {
          setUser(u);
          setAuthMode("login");
        }}
        initialMode={authMode}
      />
    </main>
  );
}
