// ============================================================================
// DiipMynd — Coming Soon / Feature Lockdown Placeholder (Obsidian Night)
// ============================================================================

"use client";

import React from "react";

interface ComingSoonProps {
  feature: string;
}

export default function ComingSoon({ feature }: ComingSoonProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[400px] px-6 text-center animate-fade-in">
      <div className="relative max-w-md p-8 md:p-10 rounded-3xl bg-[rgba(15,15,20,0.4)] border border-white/[0.06] backdrop-blur-xl shadow-2xl flex flex-col items-center gap-6 overflow-hidden">
        {/* Glow backdrop decorative bubble */}
        <div className="absolute -top-24 -left-24 w-48 h-48 rounded-full bg-violet-600/10 blur-[80px]" />
        <div className="absolute -bottom-24 -right-24 w-48 h-48 rounded-full bg-cyan-600/10 blur-[80px]" />

        {/* Floating icon wrapper */}
        <div className="relative w-16 h-16 rounded-2xl bg-white/[0.02] border border-white/[0.08] flex items-center justify-center shadow-lg group">
          {/* Subtle slow spinning border overlay */}
          <div className="absolute inset-0 rounded-2xl border border-dashed border-white/10 group-hover:rotate-45 transition-transform duration-[6000ms]" />
          <svg className="w-8 h-8 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
          </svg>
        </div>

        {/* Feature Lock Title & Badge */}
        <div className="flex flex-col gap-2 items-center z-10">
          <span className="px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider text-amber-300 bg-amber-500/10 border border-amber-500/20">
            Feature Paused
          </span>
          <h3 className="text-lg font-bold text-white tracking-wide mt-1">
            {feature}
          </h3>
        </div>

        {/* Copy */}
        <p className="text-xs text-neutral-400 leading-relaxed max-w-xs z-10">
          This feature is temporarily paused while we finish hardening Live Mask & Stream.
        </p>

        {/* Progress rail decorator */}
        <div className="w-full h-1 bg-white/[0.04] rounded-full overflow-hidden z-10 relative">
          <div className="absolute left-0 top-0 bottom-0 w-1/3 bg-gradient-to-r from-violet-500 to-cyan-500 rounded-full animate-[shimmer_2s_infinite]" />
        </div>
      </div>
    </div>
  );
}
