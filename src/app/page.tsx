"use client";

// ============================================================================
// DiipMynd — Home Page
// Full-viewport dark page that handles session checks and user login wall.
// ============================================================================

import { useEffect, useState } from "react";
import LiveAvatarStream from "@/components/LiveAvatarStream";
import AuthScreen from "@/components/AuthScreen";
import { SafeUser } from "@/lib/auth";

export default function Home() {
  const [user, setUser] = useState<SafeUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Check if session exists on load
  const checkSession = async () => {
    try {
      const res = await fetch("/api/auth/me");
      const data = await res.json();
      if (data.user) {
        setUser(data.user);
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
  }, []);

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
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

  if (loading) {
    return (
      <main className="relative z-10 flex min-h-dvh flex-col items-center justify-center p-6 bg-slate-50">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 rounded-full border-2 border-indigo-600/20 border-t-indigo-600 animate-spin" />
          <p className="text-xs text-slate-500 tracking-wider uppercase font-semibold">
            Connecting to DiipMynd...
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="relative z-10 flex min-h-dvh flex-col items-center justify-center p-6 md:p-10">
      {user ? (
        <LiveAvatarStream
          user={user}
          onLogout={handleLogout}
          onBalanceUpdated={refreshUserBalance}
        />
      ) : (
        <AuthScreen onAuthSuccess={setUser} />
      )}

      {/* Footer tagline */}
      <footer className="mt-8 text-center">
        <p className="text-xs text-slate-400 tracking-widest uppercase">
          Powered by Decart + Fal.ai · Smart Router · WebRTC · Next.js
        </p>
      </footer>
    </main>
  );
}

