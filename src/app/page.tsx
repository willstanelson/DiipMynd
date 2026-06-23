"use client";

// ============================================================================
// DiipMynd — Home Page
// Full-viewport dark page that handles session checks and user login wall.
// ============================================================================

import { useEffect, useState } from "react";
import LiveAvatarStream from "@/components/LiveAvatarStream";
import AuthScreen from "@/components/AuthScreen";
import { SafeUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export default function Home() {
  const [user, setUser] = useState<SafeUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState<"light" | "dark">("light");

  // Initialize theme from localStorage or system preference
  useEffect(() => {
    const savedTheme = localStorage.getItem("theme") as "light" | "dark" | null;
    const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const initialTheme = savedTheme || (systemPrefersDark ? "dark" : "light");
    
    setTheme(initialTheme);
    if (initialTheme === "dark") {
      document.documentElement.classList.add("dark");
      document.documentElement.classList.remove("light");
    } else {
      document.documentElement.classList.add("light");
      document.documentElement.classList.remove("dark");
    }
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === "light" ? "dark" : "light";
    setTheme(nextTheme);
    localStorage.setItem("theme", nextTheme);
    if (nextTheme === "dark") {
      document.documentElement.classList.add("dark");
      document.documentElement.classList.remove("light");
    } else {
      document.documentElement.classList.add("light");
      document.documentElement.classList.remove("dark");
    }
  };

  // Check if session exists on load
  const checkSession = async () => {
    try {
      // 1. Check if there is an active Supabase client-side session (handles OAuth callback codes/tokens)
      const { data: { session } } = await supabase.auth.getSession();
      
      if (session) {
        // Synchronize browser session to server-side HttpOnly cookie session
        const res = await fetch("/api/auth/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accessToken: session.access_token,
            expiresIn: session.expires_in,
          }),
        });
        
        const data = await res.json();
        if (data.user) {
          setUser(data.user);
          // Clean up the OAuth authorization parameters and hash fragments from URL bar
          if (window.location.hash || window.location.search.includes("code=")) {
            window.history.replaceState(null, "", window.location.pathname);
          }
          setLoading(false);
          return;
        } else if (data.error) {
          // If token exchange fails (e.g. user suspended), sign out locally
          await supabase.auth.signOut();
          setUser(null);
          setLoading(false);
          return;
        }
      }

      // 2. Otherwise fallback to standard cookie session check
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

    // Listen for auth state changes (e.g. initial recovery, OAuth redirect SIGNED_IN)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_IN" && session) {
        try {
          const res = await fetch("/api/auth/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              accessToken: session.access_token,
              expiresIn: session.expires_in,
            }),
          });
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
  }, []);

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      await supabase.auth.signOut(); // Clean up client-side local session
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
      <main className="relative z-10 flex min-h-dvh flex-col items-center justify-center p-6 bg-slate-50 dark:bg-slate-950 transition-colors duration-200">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 rounded-full border-2 border-indigo-600/20 border-t-indigo-600 animate-spin" />
          <p className="text-xs text-slate-500 dark:text-slate-400 tracking-wider uppercase font-semibold">
            Connecting to DiipMynd...
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="relative z-10 flex min-h-dvh flex-col items-center justify-center p-6 md:p-10 transition-colors duration-200">
      {user ? (
        <LiveAvatarStream
          user={user}
          onLogout={handleLogout}
          onBalanceUpdated={refreshUserBalance}
          theme={theme}
          toggleTheme={toggleTheme}
        />
      ) : (
        <AuthScreen 
          onAuthSuccess={setUser}
          theme={theme}
          toggleTheme={toggleTheme}
        />
      )}

      {/* Footer tagline */}
      <footer className="mt-8 text-center">
        <p className="text-xs text-slate-400 dark:text-slate-500 tracking-widest uppercase">
          Powered by Decart + Fal.ai · Smart Router · WebRTC · Next.js
        </p>
      </footer>
    </main>
  );
}

