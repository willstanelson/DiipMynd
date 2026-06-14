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
            bg-white/5 border border-white/10
            text-white placeholder-white/30
            text-sm font-medium tracking-wide
            outline-none
            transition-all duration-300
            focus:border-violet-500/60 focus:ring-2 focus:ring-violet-500/20
            hover:border-white/20
            disabled:opacity-40 disabled:cursor-not-allowed
            backdrop-blur-sm
          "
        />
        {/* Gradient accent line at the bottom */}
        <div className="absolute bottom-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-violet-500/40 to-transparent opacity-0 group-focus-within:opacity-100 transition-opacity duration-500" />
      </div>

      {/* ── Preset Chips ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            onClick={() => handlePresetClick(preset)}
            disabled={disabled}
            className={`
              inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg
              text-xs font-medium tracking-wide
              border transition-all duration-200
              disabled:opacity-30 disabled:cursor-not-allowed
              ${
                activePreset === preset.id
                  ? "bg-violet-500/20 border-violet-500/50 text-violet-300 shadow-lg shadow-violet-500/10"
                  : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10 hover:border-white/20 hover:text-white/80"
              }
            `}
          >
            <span>{preset.icon}</span>
            <span>{preset.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
