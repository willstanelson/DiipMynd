// ============================================================================
// DiipMynd — B-Roll Studio  ·  Obsidian Night
// Powered by Fal.ai video models (Kling, Luma, Hunyuan Video, etc.).
// Supports Text-to-Video, Image-to-Video, and customizable aspect ratios.
// ============================================================================

"use client";

import React, { useState, useEffect } from "react";
import { fal } from "@fal-ai/client";
import { SafeUser } from "@/lib/auth";
import { VIDEO_MODELS } from "@/lib/packages";
import { supabase } from "@/lib/supabase/client";

interface BRollStudioProps {
  user: SafeUser;
  onBalanceUpdated: () => void;
  referenceImage: string | null;
  clearReferenceImage?: () => void;
}

const PRESET_RATIOS = [
  { label: "16:9 YouTube", width: 1024, height: 576, value: "16:9" },
  { label: "9:16 TikTok", width: 576, height: 1024, value: "9:16" },
  { label: "1:1 Square", width: 768, height: 768, value: "1:1" },
  { label: "2.39:1 Cinema", width: 1024, height: 428, value: "2.39:1" },
];

// ── Inline SVG icons ──
type IconProps = { className?: string };
const FilmIcon = ({ className = "w-5 h-5" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M7 3v18M17 3v18M3 7.5h4M3 12h4M3 16.5h4M17 7.5h4M17 12h4M17 16.5h4" />
  </svg>
);
const ImageIcon = ({ className = "w-4 h-4" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.5-3.5a2 2 0 0 0-2.8 0L6 20" />
  </svg>
);

export default function BRollStudio({
  user,
  onBalanceUpdated,
  referenceImage,
  clearReferenceImage,
}: BRollStudioProps) {
  const [model, setModel] = useState<string>(VIDEO_MODELS[0].endpoint);
  const [prompt, setPrompt] = useState("");
  const [activeImageRef, setActiveImageRef] = useState<string | null>(null);

  const [selectedRatio, setSelectedRatio] = useState(PRESET_RATIOS[0]);
  const [customWidth, setCustomWidth] = useState(1024);
  const [customHeight, setCustomHeight] = useState(576);
  const [isCustomDimensions, setIsCustomDimensions] = useState(false);

  const [duration, setDuration] = useState<"5" | "10">("5");
  const [motionLevel, setMotionLevel] = useState(5);
  const [generating, setGenerating] = useState(false);
  const [resultVideo, setResultVideo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (referenceImage) {
      setActiveImageRef(referenceImage);
    }
  }, [referenceImage]);

  const getCreditCost = () => {
    const matched = VIDEO_MODELS.find((m) => m.endpoint === model);
    return matched ? matched.creditCost : 30;
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) {
      setError("Please describe the scene to generate.");
      return;
    }

    setGenerating(true);
    setError(null);
    setResultVideo(null);

    try {
      const w = isCustomDimensions ? customWidth : selectedRatio.width;
      const h = isCustomDimensions ? customHeight : selectedRatio.height;
      const ratioValue = isCustomDimensions ? "custom" : selectedRatio.value;

      let payload: any = {
        prompt: prompt.trim(),
        sync_mode: true,
        model,
      };

      if (model.includes("kling")) {
        payload.duration = parseInt(duration);
        if (activeImageRef) payload.image_url = activeImageRef;
      } else if (model.includes("luma")) {
        payload.aspect_ratio = ratioValue === "custom" ? "16:9" : ratioValue;
        if (activeImageRef) payload.image_url = activeImageRef;
      } else if (model.includes("hunyuan")) {
        payload.width = w; payload.height = h;
        payload.num_frames = duration === "5" ? 85 : 120;
      } else if (model.includes("mochi")) {
        payload.width = w; payload.height = h;
      } else {
        payload.width = w; payload.height = h;
      }

      if (model === "runway-gen4.5") {
         payload = {
            promptText: prompt.trim(),
            promptImage: activeImageRef,
            ratio: isCustomDimensions ? `${w}:${h}` : selectedRatio.value,
            duration: parseInt(duration),
            model,
         };
      }

      // Queue the job
      const res = await fetch("/api/jobs/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "video", payload }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to queue job.");
      }

      const jobId = data.jobId;

      // Listen for job completion
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
                setResultVideo(newRecord.result_url);
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

      if (clearReferenceImage) clearReferenceImage();
      window.dispatchEvent(new Event("library-updated"));
      onBalanceUpdated();

    } catch (err: any) {
      console.error("[broll-studio] Generation error:", err);
      setError(err.message || "An unexpected error occurred during video generation.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="glass-panel p-6 rounded-2xl flex flex-col gap-6 text-neutral-100 h-full max-h-[85vh] overflow-y-auto">
      <div>
        <h2 className="text-lg font-bold tracking-tight text-white flex items-center gap-2.5">
          <FilmIcon className="w-5 h-5 text-neutral-400" />
          B-Roll Cinematic Studio
        </h2>
        <p className="text-[12px] text-neutral-500 mt-1.5">
          Generate realistic overlays, cinematic sequences, and action cuts with next-gen video generators.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Controls */}
        <form onSubmit={handleGenerate} className="flex flex-col gap-4">

          {/* Model selection */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] uppercase font-semibold tracking-[0.18em] text-neutral-600">
              Select Video Engine ({getCreditCost()} Credits)
            </label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full text-xs py-2.5 px-3 rounded-lg bg-white/[0.025] border border-white/[0.06] focus:border-white/20 focus:outline-none text-neutral-100 font-semibold cursor-pointer transition-colors"
            >
              {VIDEO_MODELS.map((m) => (
                <option key={m.id} value={m.endpoint} className="bg-neutral-900">
                  {m.name} — ({m.creditCost} Credits)
                </option>
              ))}
            </select>
          </div>

          {/* Reference Image */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[10px] uppercase font-semibold tracking-[0.18em] text-neutral-600">
                Reference Image (Image-to-Video)
              </label>
              {activeImageRef && (
                <button
                  type="button"
                  onClick={() => {
                    setActiveImageRef(null);
                    if (clearReferenceImage) clearReferenceImage();
                  }}
                  className="text-[9px] font-bold text-red-400 hover:text-red-300 cursor-pointer transition-colors"
                >
                  Clear Image
                </button>
              )}
            </div>

            {activeImageRef ? (
              <div className="flex items-center gap-3 p-3 bg-white/[0.025] rounded-xl border border-white/[0.06] relative">
                <img
                  src={activeImageRef}
                  alt="Reference thumbnail"
                  className="w-12 h-12 object-cover rounded-lg border border-white/[0.08]"
                />
                <div className="flex flex-col gap-0.5 overflow-hidden">
                  <span className="text-[11px] font-bold text-white">Image Loaded</span>
                  <span className="text-[9px] text-neutral-600 truncate max-w-[200px]">{activeImageRef}</span>
                </div>
                <div className="absolute right-3 text-[9px] bg-white/[0.06] text-neutral-400 p-1 px-2 rounded border border-white/[0.08] font-semibold">
                  Image-to-Video mode
                </div>
              </div>
            ) : (
              <div className="p-4 border border-dashed border-white/[0.08] rounded-xl bg-white/[0.015] text-center flex flex-col items-center justify-center">
                <p className="text-[10px] text-neutral-500 font-semibold">No reference image selected</p>
                <p className="text-[9px] text-neutral-700 mt-1 max-w-[260px] leading-relaxed">
                  To trigger Image-to-Video, click &ldquo;Use as Reference Image&rdquo; on any asset in the library drawer or character forge.
                </p>
              </div>
            )}
          </div>

          {/* Visual Prompt */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] uppercase font-semibold tracking-[0.18em] text-neutral-600">
              Visual Prompt Description
            </label>
            <textarea
              placeholder="Describe what happens in the video (e.g. 'A red sports car zooming past neon-lit skyscrapers, wheels spinning, steam rising from tires, slow motion panning shot')"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              required
              className="w-full text-xs py-2.5 px-3.5 rounded-xl bg-white/[0.025] border border-white/[0.06] focus:border-white/20 focus:outline-none text-neutral-100 leading-relaxed transition-colors placeholder-neutral-700"
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
                {PRESET_RATIOS.map((ratio) => (
                  <button
                    key={ratio.value}
                    type="button"
                    onClick={() => setSelectedRatio(ratio)}
                    className={`py-2 px-1 rounded-lg text-[10px] font-bold border transition-all cursor-pointer ${
                      selectedRatio.value === ratio.value
                        ? "border-white/[0.14] bg-white/[0.08] text-white"
                        : "border-white/[0.06] bg-white/[0.025] text-neutral-500 hover:bg-white/[0.05] hover:text-neutral-300"
                    }`}
                  >
                    <div>{ratio.value}</div>
                    <div className="text-[8px] opacity-60 mt-0.5 font-normal">{ratio.width}×{ratio.height}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Duration & Motion */}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] uppercase font-semibold tracking-[0.18em] text-neutral-600">
                Duration (Seconds)
              </label>
              <div className="flex gap-2">
                {(["5", "10"] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDuration(d)}
                    className={`flex-1 py-2 text-xs font-bold rounded-xl border transition-all cursor-pointer ${
                      duration === d
                        ? "border-white/[0.14] bg-white/[0.08] text-white"
                        : "border-white/[0.06] bg-white/[0.025] text-neutral-500 hover:bg-white/[0.05] hover:text-neutral-300"
                    }`}
                  >
                    {d}s
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] uppercase font-semibold tracking-[0.18em] text-neutral-600">
                Motion Level ({motionLevel})
              </label>
              <input
                type="range"
                min={1}
                max={10}
                value={motionLevel}
                onChange={(e) => setMotionLevel(parseInt(e.target.value))}
                className="w-full py-2 accent-white cursor-pointer"
                style={{ ["--value" as any]: `${(motionLevel / 10) * 100}%` }}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={generating}
            className="w-full py-3 mt-2 rounded-xl text-[11px] font-bold uppercase tracking-[0.18em] text-black bg-white hover:bg-neutral-200 active:scale-[0.98] shadow-lg transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {generating ? (
              <>
                <div className="w-3.5 h-3.5 rounded-full border-2 border-black/20 border-t-black animate-spin" />
                Generating Video…
              </>
            ) : (
              "Generate B-Roll Clip"
            )}
          </button>
        </form>

        {/* Results */}
        <div className="flex flex-col gap-4">
          <div className="text-[10px] uppercase font-semibold tracking-[0.18em] text-neutral-600">
            Preview Output
          </div>

          <div className="relative w-full aspect-video rounded-2xl bg-black/40 border border-white/[0.06] overflow-hidden flex items-center justify-center shadow-inner">
            {generating ? (
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 rounded-full border-2 border-white/10 border-t-white/80 animate-spin" />
                <p className="text-[11px] text-neutral-500 animate-pulse font-bold tracking-wide">Rendering video…</p>
              </div>
            ) : resultVideo ? (
              <video
                src={resultVideo}
                controls
                autoPlay
                loop
                playsInline
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="flex flex-col items-center text-center p-6 gap-3">
                <div className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center">
                  <FilmIcon className="w-7 h-7 text-neutral-600" />
                </div>
                <p className="text-[12px] font-bold text-neutral-400">Cinematic Visualizer is Empty</p>
                <p className="text-[10px] text-neutral-600 max-w-[280px] leading-relaxed">
                  Enter your prompt or load a reference image from character forge, select your camera properties, and render.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
