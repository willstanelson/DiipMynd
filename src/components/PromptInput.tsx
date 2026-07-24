// ============================================================================
// DiipMynd — PromptInput Component
// Debounced text input + preset chips for controlling the AI transformation.
// ============================================================================

"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { PromptPreset } from "@/types";

// ── Preset prompts for one-click selection ──────────────────────────────────
const PRESETS: PromptPreset[] = [
  { id: "3d-char",    label: "3D Character",    prompt: "Turn the user into a 3D animated character",             icon: "🎮" },
  { id: "cyberpunk",  label: "Cyberpunk",        prompt: "Transform the user into a cyberpunk style with neon glow", icon: "🌆" },
  { id: "oil-paint",  label: "Oil Painting",     prompt: "Render the user as a classical oil painting portrait",    icon: "🎨" },
  { id: "anime",      label: "Anime",            prompt: "Turn the user into an anime character",                   icon: "✨" },
  { id: "zombie",     label: "Zombie",           prompt: "Transform the user into a realistic zombie",              icon: "🧟" },
  { id: "pixar",      label: "Pixar Style",      prompt: "Render the user as a Pixar-style 3D character",           icon: "🍿" },
];

// ── Background replacement presets ──────────────────────────────────────────
// Uses the same handlePromptChange flow — no new SDK integration needed.
// Decart Lucy 2.5 natively supports background replacement via prompt changes
// on an active session (setPrompt / .set()), with no new connection or token.
const BACKGROUND_PRESETS: PromptPreset[] = [
  { id: "bg-beach",       label: "Beach",            prompt: "Change the background to a sandy beach with clear blue water and a bright sunny sky.",                       icon: "🏖️" },
  { id: "bg-living-room", label: "Cozy Living Room", prompt: "Change the background to a cozy living room with warm lighting, bookshelves, and a fireplace.",              icon: "🏠" },
  { id: "bg-neon-city",   label: "Neon City Night",  prompt: "Change the background to a neon-lit city street at night with reflections on wet pavement.",                 icon: "🌃" },
  { id: "bg-space",       label: "Outer Space",      prompt: "Change the background to a view of outer space with stars, nebulae, and distant planets.",                   icon: "🚀" },
  { id: "bg-forest",      label: "Enchanted Forest", prompt: "Change the background to a lush enchanted forest with glowing fireflies and soft golden light filtering through the canopy.", icon: "🌲" },
  { id: "bg-office",      label: "Modern Office",    prompt: "Change the background to a sleek modern office with floor-to-ceiling windows overlooking a cityscape.",      icon: "🏢" },
];

interface PromptInputProps {
  /** Called with the new prompt text after debounce. */
  onPromptChange: (prompt: string) => void;
  /** Whether the prompt can be changed (e.g., only when connected). */
  disabled?: boolean;
}

export default function PromptInput({ onPromptChange, disabled = false }: PromptInputProps) {
  const [inputValue, setInputValue] = useState("");
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Debounced dispatch ──────────────────────────────────────────────────
  const debouncedEmit = useCallback(
    (text: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        if (text.trim()) onPromptChange(text.trim());
      }, 500);
    },
    [onPromptChange]
  );

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // ── Handlers ────────────────────────────────────────────────────────────
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputValue(val);
    setActivePreset(null);
    debouncedEmit(val);
  };

  const handlePresetClick = (preset: PromptPreset) => {
    setInputValue(preset.prompt);
    setActivePreset(preset.id);
    // Fire immediately for presets (no debounce)
    if (debounceRef.current) clearTimeout(debounceRef.current);
    onPromptChange(preset.prompt);
  };

  // Reusable chip renderer for both preset groups
  const renderChips = (presets: PromptPreset[]) =>
    presets.map((preset) => (
      <button
        key={preset.id}
        onClick={() => handlePresetClick(preset)}
        disabled={disabled}
        className={`
          inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg
          text-xs font-medium tracking-wide
          border transition-all duration-200
          disabled:opacity-30 disabled:cursor-not-allowed
          cursor-pointer
          ${
            activePreset === preset.id
              ? "bg-indigo-50 dark:bg-indigo-950/40 border-indigo-300 dark:border-indigo-900/60 text-indigo-700 dark:text-indigo-400 shadow-sm"
              : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-700 hover:text-slate-800 dark:hover:text-slate-200"
          }
        `}
      >
        <span>{preset.icon}</span>
        <span>{preset.label}</span>
      </button>
    ));

  return (
    <div className="w-full space-y-3">
      {/* ── Text Input ────────────────────────────────────────────────── */}
      <div className="relative group">
        <input
          id="prompt-input"
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          disabled={disabled}
          placeholder="Describe a transformation… e.g. &quot;turn me into a superhero&quot;"
          className="
            w-full px-4 py-3 rounded-xl
            bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800
            text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-600
            text-sm font-medium tracking-wide
            outline-none
            transition-all duration-300
            focus:border-indigo-600 dark:focus:border-indigo-500 focus:ring-2 focus:ring-indigo-600/15
            hover:border-slate-300 dark:hover:border-slate-700
            disabled:opacity-40 disabled:cursor-not-allowed
          "
        />
        {/* Accent line at the bottom */}
        <div className="absolute bottom-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-indigo-600/30 to-transparent opacity-0 group-focus-within:opacity-100 transition-opacity duration-500" />
      </div>

      {/* ── Style Preset Chips ─────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        {renderChips(PRESETS)}
      </div>

      {/* ── Background Preset Chips ────────────────────────────────────── */}
      <div className="space-y-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-600 pl-0.5">
          Change Background
        </p>
        <div className="flex flex-wrap gap-2">
          {renderChips(BACKGROUND_PRESETS)}
        </div>
      </div>
    </div>
  );
}
