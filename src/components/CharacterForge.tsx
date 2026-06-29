// ============================================================================
// DiipMynd — Character Forge  ·  Obsidian Night
// Enables creators to generate consistent avatars/characters using Flux.
// Appends a reusable description profile (Character Profile) to prompts.
// ============================================================================

"use client";

import React, { useState } from "react";
import { fal } from "@fal-ai/client";
import { SafeUser } from "@/lib/auth";
import { IMAGE_MODELS } from "@/lib/packages";
import { supabase } from "@/lib/supabase/client";

interface CharacterForgeProps {
  user: SafeUser;
  onBalanceUpdated: () => void;
  onUseAsReference?: (url: string) => void;
}

const ASPECT_RATIOS = [
  { label: "1:1 Square", width: 1024, height: 1024, ratio: "1:1" },
  { label: "16:9 Landscape", width: 1024, height: 576, ratio: "16:9" },
  { label: "9:16 Portrait", width: 576, height: 1024, ratio: "9:16" },
  { label: "4:3 Standard", width: 1024, height: 768, ratio: "4:3" },
];

// ── Inline SVG icons ──
type IconProps = { className?: string };
const MaskIcon = ({ className = "w-5 h-5" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 5c4-1 12-1 16 0 0 8-3 14-8 14S4 13 4 5z" />
    <circle cx="9" cy="10" r="1" fill="currentColor" /><circle cx="15" cy="10" r="1" fill="currentColor" />
    <path d="M9 15c1.5 1 4.5 1 6 0" />
  </svg>
);
const DnaIcon = ({ className = "w-4 h-4" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 4c0 8 16 8 16 16M20 4c0 8-16 8-16 16" />
    <path d="M7 5h10M7 19h10M9 9h6M9 15h6" />
  </svg>
);
const FilmIcon = ({ className = "w-3.5 h-3.5" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M7 3v18M17 3v18M3 7.5h4M3 12h4M3 16.5h4M17 7.5h4M17 12h4M17 16.5h4" />
  </svg>
);

export default function CharacterForge({ user, onBalanceUpdated, onUseAsReference }: CharacterForgeProps) {
  const [model, setModel] = useState<string>(IMAGE_MODELS[0].endpoint);
  const [prompt, setPrompt] = useState("");
  const [characterName, setCharacterName] = useState("");
  const [characterDetails, setCharacterDetails] = useState("");
  const [selectedRatio, setSelectedRatio] = useState(ASPECT_RATIOS[0]);
  const [customWidth, setCustomWidth] = useState(1024);
  const [customHeight, setCustomHeight] = useState(1024);
  const [isCustomDimensions, setIsCustomDimensions] = useState(false);
  const [steps, setSteps] = useState(20);
  const [generating, setGenerating] = useState(false);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const getCreditCost = () => {
    const matched = IMAGE_MODELS.find((m) => m.endpoint === model);
    return matched ? matched.creditCost : 5;
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) {
      setError("Please enter a visual prompt description.");
      return;
    }

    setGenerating(true);
    setError(null);
    setResultImage(null);

    try {
      let fullPrompt = prompt.trim();
      if (characterName.trim() || characterDetails.trim()) {
        const namePart = characterName.trim() ? `Character Profile name: ${characterName.trim()}. ` : "";
        const detailsPart = characterDetails.trim() ? `Character appearance visual features: ${characterDetails.trim()}. ` : "";
        fullPrompt = `${namePart}${detailsPart}Scene visual prompt details: ${prompt.trim()}`;
      }

      const w = isCustomDimensions ? customWidth : selectedRatio.width;
      const h = isCustomDimensions ? customHeight : selectedRatio.height;

      const payload = {
        prompt: fullPrompt,
        image_size: { width: w, height: h },
        num_inference_steps: steps,
        sync_mode: true,
        model,
        characterName, // for the filename in the worker
      };

      // Queue the job
      const res = await fetch("/api/jobs/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "image", payload }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to queue job.");
      }

      const jobId = data.jobId;

      // Listen for job completion via Supabase Realtime
      await new Promise((resolve, reject) => {
        const channel = supabase
          .channel(`job-${jobId}`)
          .on(
            "postgres_changes",
            {
              event: "UPDATE",
              schema: "public",
              table: "generation_jobs",
              filter: `id=eq.${jobId}`,
            },
            (payload) => {
              const newRecord = payload.new;
              if (newRecord.status === "completed") {
                setResultImage(newRecord.result_url);
                supabase.removeChannel(channel);
                resolve(true);
              } else if (newRecord.status === "failed") {
                supabase.removeChannel(channel);
                const errMsg = newRecord.payload?.error || "Generation failed in queue.";
                reject(new Error(errMsg));
              }
            }
          )
          .subscribe();
      });

      window.dispatchEvent(new Event("library-updated"));
      onBalanceUpdated();

    } catch (err: any) {
      console.error("[character-forge] Error during generation:", err);
      setError(err.message || "An unexpected error occurred during generation.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="glass-panel p-6 rounded-2xl flex flex-col gap-6 text-neutral-100 h-full max-h-[85vh] overflow-y-auto">
      <div>
        <h2 className="text-lg font-bold tracking-tight text-white flex items-center gap-2.5">
          <MaskIcon className="w-5 h-5 text-neutral-400" />
          Character Forge Studio
        </h2>
        <p className="text-[12px] text-neutral-500 mt-1.5">
          Create consistent visual characters and avatars using high-fidelity Flux models.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Generator Controls */}
        <form onSubmit={handleGenerate} className="flex flex-col gap-4">

          {/* Model selection */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] uppercase font-semibold tracking-[0.18em] text-neutral-600">
              Select Rendering Engine ({getCreditCost()} Credits)
            </label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full text-xs py-2.5 px-3 rounded-lg bg-white/[0.025] border border-white/[0.06] focus:border-white/20 focus:outline-none text-neutral-100 font-semibold cursor-pointer transition-colors"
            >
              {IMAGE_MODELS.map((m) => (
                <option key={m.id} value={m.endpoint} className="bg-neutral-900">
                  {m.name} — ({m.creditCost} Credits)
                </option>
              ))}
            </select>
          </div>

          {/* Character Identity Profile */}
          <div className="bg-white/[0.02] p-4 rounded-xl border border-white/[0.06] flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <DnaIcon className="w-4 h-4 text-neutral-400" />
              <span className="text-[11px] font-bold text-white">
                Consistent Character Profile (Optional)
              </span>
            </div>

            <div className="flex flex-col gap-1">
              <input
                type="text"
                placeholder="Character Name (e.g. John Doe, Cyberpunk Detective)"
                value={characterName}
                onChange={(e) => setCharacterName(e.target.value)}
                className="text-xs py-2 px-3 rounded-lg bg-white/[0.025] border border-white/[0.06] focus:border-white/20 focus:outline-none text-neutral-100 placeholder-neutral-700 transition-colors"
              />
            </div>

            <div className="flex flex-col gap-1">
              <textarea
                placeholder="Describe character visual features to keep them consistent across scenes (e.g. 'A 30-year old man with a short brown beard, cybernetic green glowing eye, wearing a worn beige trenchcoat')"
                value={characterDetails}
                onChange={(e) => setCharacterDetails(e.target.value)}
                rows={2}
                className="text-xs py-2 px-3 rounded-lg bg-white/[0.025] border border-white/[0.06] focus:border-white/20 focus:outline-none text-neutral-100 resize-none placeholder-neutral-700 transition-colors"
              />
            </div>
          </div>

          {/* Main prompt */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] uppercase font-semibold tracking-[0.18em] text-neutral-600">
              Visual Scene &amp; Action Prompt
            </label>
            <textarea
              placeholder="Describe the action and environment (e.g. 'standing under neon rain, holding a glowing tablet, looking directly at the camera, dynamic angle')"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              required
              className="w-full text-xs py-2.5 px-3.5 rounded-xl bg-white/[0.025] border border-white/[0.06] focus:border-white/20 focus:outline-none text-neutral-100 leading-relaxed placeholder-neutral-700 transition-colors"
            />
          </div>

          {/* Aspect Ratios */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[10px] uppercase font-semibold tracking-[0.18em] text-neutral-600">
                Aspect Ratio / Dimensions
              </label>
              <button
                type="button"
                onClick={() => setIsCustomDimensions(!isCustomDimensions)}
                className="text-[9px] font-bold text-neutral-400 hover:text-white cursor-pointer transition-colors"
              >
                {isCustomDimensions ? "Use Aspect Ratios" : "Enter Custom Dimensions"}
              </button>
            </div>

            {isCustomDimensions ? (
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center gap-2 bg-white/[0.025] p-2 rounded-xl border border-white/[0.06]">
                  <span className="text-[10px] text-neutral-500 font-bold">W:</span>
                  <input
                    type="number"
                    value={customWidth}
                    onChange={(e) => setCustomWidth(Math.max(256, parseInt(e.target.value) || 256))}
                    className="w-full text-xs bg-transparent focus:outline-none text-right font-bold text-neutral-200"
                  />
                  <span className="text-[10px] text-neutral-600">px</span>
                </div>
                <div className="flex items-center gap-2 bg-white/[0.025] p-2 rounded-xl border border-white/[0.06]">
                  <span className="text-[10px] text-neutral-500 font-bold">H:</span>
                  <input
                    type="number"
                    value={customHeight}
                    onChange={(e) => setCustomHeight(Math.max(256, parseInt(e.target.value) || 256))}
                    className="w-full text-xs bg-transparent focus:outline-none text-right font-bold text-neutral-200"
                  />
                  <span className="text-[10px] text-neutral-600">px</span>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-1.5">
                {ASPECT_RATIOS.map((ratio) => (
                  <button
                    key={ratio.ratio}
                    type="button"
                    onClick={() => setSelectedRatio(ratio)}
                    className={`py-2 px-1 rounded-lg text-[10px] font-bold border transition-all cursor-pointer ${
                      selectedRatio.ratio === ratio.ratio
                        ? "border-white/[0.14] bg-white/[0.08] text-white"
                        : "border-white/[0.06] bg-white/[0.025] text-neutral-500 hover:bg-white/[0.05] hover:text-neutral-300"
                    }`}
                  >
                    <div>{ratio.ratio}</div>
                    <div className="text-[8px] opacity-60 mt-0.5 font-normal">{ratio.width}×{ratio.height}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Inference Steps Slider */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] uppercase font-semibold tracking-[0.18em] text-neutral-600">
              Inference Steps / Details ({steps})
            </label>
            <input
              type="range"
              min={10}
              max={50}
              step={1}
              value={steps}
              onChange={(e) => setSteps(parseInt(e.target.value))}
              className="w-full py-2 accent-white cursor-pointer"
              style={{ ["--value" as any]: `${((steps - 10) / 40) * 100}%` }}
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-[11px] text-red-400 font-medium">
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4M12 17h.01M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /></svg>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={generating}
            className="w-full py-3 mt-2 rounded-xl text-[11px] font-bold uppercase tracking-[0.18em] text-black bg-white hover:bg-neutral-200 active:scale-[0.98] shadow-lg transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {generating ? (
              <>
                <div className="w-3.5 h-3.5 rounded-full border-2 border-black/20 border-t-black animate-spin" />
                Forging Avatar…
              </>
            ) : (
              "Forge Character Avatar"
            )}
          </button>
        </form>

        {/* Output Area */}
        <div className="flex flex-col gap-4">
          <div className="text-[10px] uppercase font-semibold tracking-[0.18em] text-neutral-600">
            Forged Asset Preview
          </div>

          <div className="relative w-full aspect-square rounded-2xl bg-black/40 border border-white/[0.06] overflow-hidden flex items-center justify-center shadow-inner">
            {generating ? (
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 rounded-full border-2 border-white/10 border-t-white/80 animate-spin" />
                <p className="text-[11px] text-neutral-500 animate-pulse font-bold tracking-wide">Drawing character…</p>
              </div>
            ) : resultImage ? (
              <div className="w-full h-full relative group">
                <img
                  src={resultImage}
                  alt="Forged character output"
                  className="w-full h-full object-cover"
                />

                {onUseAsReference && (
                  <div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center p-4">
                    <button
                      onClick={() => onUseAsReference(resultImage)}
                      className="flex items-center gap-2 py-2.5 px-5 bg-white hover:bg-neutral-200 text-[11px] font-bold text-black rounded-xl shadow-lg active:scale-95 transition-all cursor-pointer"
                    >
                      <FilmIcon className="w-3.5 h-3.5" />
                      Use as Video Reference
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center text-center p-6 gap-3">
                <div className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center">
                  <MaskIcon className="w-7 h-7 text-neutral-600" />
                </div>
                <p className="text-[12px] font-bold text-neutral-400">Forged Visualizer is Empty</p>
                <p className="text-[10px] text-neutral-600 max-w-[280px] leading-relaxed">
                  Provide character descriptions, visuals, dimensions and trigger model render to view your generated avatar.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
