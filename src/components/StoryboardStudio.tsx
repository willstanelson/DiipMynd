// ============================================================================
// DiipMynd — Storyboard Studio  ·  Obsidian Night
// Split-screen workflow. Segment scripts into scenes, generate visual prompts,
// and trigger immediate character or video generations for specific scenes.
// ============================================================================

"use client";

import React, { useState } from "react";
import { SafeUser } from "@/lib/auth";
import { fal } from "@fal-ai/client";
import { IMAGE_MODELS, VIDEO_MODELS } from "@/lib/packages";

interface StoryboardStudioProps {
  user: SafeUser;
  onBalanceUpdated: () => void;
  onNavigateToTab: (tab: string, context?: any) => void;
}

interface Scene {
  number: number;
  scriptText: string;
  visualPrompt: string;
  mediaUrl: string | null;
  mediaType: "image" | "video" | null;
  generating: boolean;
}

const DEFAULT_SCRIPT =
`Scene 1: A mysterious figure standing in the rain under a flickering neon billboard. They look around nervously.

Scene 2: Close up on a high-tech smart tablet in their hand, displaying a flashing red message: "CONNECTION COMPROMISED".

Scene 3: The figure quickly pulls up their coat collar, slips into a dark alleyway, and disappears into the shadows.`;

// ── Inline SVG icons ──
type IconProps = { className?: string };
const ScriptIcon = ({ className = "w-5 h-5" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6z" />
    <path d="M14 3v4h4" /><path d="M8 13h8M8 17h6M8 9h3" />
  </svg>
);
const SparklesIcon = ({ className = "w-3 h-3" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" />
  </svg>
);
const MicIcon = ({ className = "w-3 h-3" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0M12 17v4" />
  </svg>
);
const ImageIcon = ({ className = "w-3 h-3" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.5-3.5a2 2 0 0 0-2.8 0L6 20" />
  </svg>
);
const FilmIcon = ({ className = "w-3 h-3" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M7 3v18M17 3v18M3 7.5h4M3 12h4M3 16.5h4M17 7.5h4M17 12h4M17 16.5h4" />
  </svg>
);
const AlertIcon = ({ className = "w-3 h-3" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 9v4M12 17h.01M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
  </svg>
);

export default function StoryboardStudio({
  user,
  onBalanceUpdated,
  onNavigateToTab,
}: StoryboardStudioProps) {
  const [script, setScript] = useState(DEFAULT_SCRIPT);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [optimizingIndex, setOptimizingIndex] = useState<number | null>(null);

  const [selectedImageModel, setSelectedImageModel] = useState(IMAGE_MODELS[0].endpoint);
  const [selectedVideoModel, setSelectedVideoModel] = useState(VIDEO_MODELS[0].endpoint);

  const handleParseScenes = () => {
    setError(null);
    if (!script.trim()) {
      setError("Please write or paste a script first.");
      return;
    }

    const blocks = script
      .split(/\n\s*\n/)
      .map((block) => block.trim())
      .filter((block) => block.length > 0);

    const parsedScenes: Scene[] = blocks.map((block, idx) => {
      const cleanedText = block.replace(/^scene\s*\d+\s*:\s*/i, "");
      const visualDraft = cleanedText.length > 120
        ? cleanedText.substring(0, 120) + "..."
        : cleanedText;

      return {
        number: idx + 1,
        scriptText: block,
        visualPrompt: `A cinematic shot of: ${visualDraft}, photorealistic, cyber aesthetics, detailed, 8k resolution`,
        mediaUrl: null,
        mediaType: null,
        generating: false,
      };
    });

    setScenes(parsedScenes);
  };

  const optimizePrompt = async (index: number) => {
    const scene = scenes[index];
    if (!scene) return;

    setOptimizingIndex(index);
    try {
      await new Promise((resolve) => setTimeout(resolve, 800));

      const rawText = scene.scriptText.replace(/^scene\s*\d+\s*:\s*/i, "");
      const cinematicStyles = [
        "shot on anamorphic lens, depth of field, high contrast, dramatic dark cyberpunk mood, cyberpunk lighting, octane render, realism",
        "extreme close up macro shot, detailed textures, soft studio rim lighting, moody atmosphere, 35mm film grain, hyperrealistic",
        "wide angle camera shot, epic scale, smoke and fog overlays, volumetric light rays, photorealistic Unreal Engine 5 render",
      ];

      const chosenStyle = cinematicStyles[index % cinematicStyles.length];
      const optimized = `Cinematic scene, ${rawText}. ${chosenStyle}, --ar 16:9 --v 6.0`;

      setScenes((prev) =>
        prev.map((s, idx) => (idx === index ? { ...s, visualPrompt: optimized } : s))
      );
    } catch (err) {
      console.error("[storyboard-optimize] Prompt optimization failed:", err);
    } finally {
      setOptimizingIndex(null);
    }
  };

  const generateMedia = async (index: number, type: "image" | "video") => {
    const scene = scenes[index];
    if (!scene) return;

    setScenes((prev) =>
      prev.map((s, idx) => (idx === index ? { ...s, generating: true } : s))
    );

    const model = type === "image" ? selectedImageModel : selectedVideoModel;
    const modelConfig = type === "image"
      ? IMAGE_MODELS.find((m) => m.endpoint === selectedImageModel)
      : VIDEO_MODELS.find((m) => m.endpoint === selectedVideoModel);

    const cost = modelConfig ? modelConfig.creditCost : (type === "image" ? 5 : 30);

    try {
      console.log(`[storyboard-media] Generating ${type} for scene ${scene.number} via ${model}...`);
      let generatedUrl = "";

      if (type === "image") {
        const result: any = await fal.run(model, {
          input: {
            prompt: scene.visualPrompt,
            image_size: { width: 1024, height: 576 },
            sync_mode: true,
          },
        });
        generatedUrl = result?.images?.[0]?.url;
      } else {
        if (model === "runway-gen4.5") {
          console.log("[storyboard-media] Generating direct Runway Gen 4.5 video...");
          const runwayRes = await fetch("/api/runway", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              promptText: scene.visualPrompt,
              ratio: "16:9",
              duration: 5,
            }),
          });
          const runwayData = await runwayRes.json();
          if (!runwayRes.ok) {
            throw new Error(runwayData.error || "Runway generation failed.");
          }
          generatedUrl = runwayData.url;
        } else {
          const result: any = await fal.run(model, {
            input: {
              prompt: scene.visualPrompt,
              duration: 5,
              sync_mode: true,
            },
          });
          generatedUrl = result?.video?.url || result?.videos?.[0]?.url || result?.url;
        }
      }

      if (!generatedUrl) {
        throw new Error("Generation API succeeded but returned no media URL.");
      }

      onBalanceUpdated();

      console.log("[storyboard-media] Localizing media to cloud/Telegram storage...");
      const downloadRes = await fetch("/api/library/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: generatedUrl,
          name: `scene_${scene.number}_${type === "image" ? "image.png" : "video.mp4"}`,
        }),
      });

      const downloadData = await downloadRes.json();
      if (!downloadRes.ok) {
        throw new Error(downloadData.error || "Workstation storage cache failed.");
      }

      const persistentUrl = downloadData.url;

      await fetch("/api/library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          name: `Scene ${scene.number}: ${scene.scriptText.substring(0, 20)}...`,
          url: persistentUrl,
          model,
          prompt: scene.scriptText,
          telegramChatId: downloadData.telegramChatId,
          telegramMessageId: downloadData.telegramMessageId,
        }),
      });

      setScenes((prev) =>
        prev.map((s, idx) =>
          idx === index
            ? { ...s, mediaUrl: persistentUrl, mediaType: type, generating: false }
            : s
        )
      );

      window.dispatchEvent(new Event("library-updated"));

    } catch (err: any) {
      console.error("[storyboard-generation] Generation error:", err);
      alert(`Scene ${scene.number} Generation failed: ` + err.message);

      setScenes((prev) =>
        prev.map((s, idx) => (idx === index ? { ...s, generating: false } : s))
      );
    }
  };

  return (
    <div className="glass-panel p-6 rounded-2xl flex flex-col gap-6 text-neutral-100 h-full max-h-[85vh] overflow-y-auto">
      {/* Title Header with Model Selectors */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/[0.06] pb-4">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-white flex items-center gap-2.5">
            <ScriptIcon className="w-5 h-5 text-neutral-400" />
            Script &amp; Storyboard Studio
          </h2>
          <p className="text-[12px] text-neutral-500 mt-1.5">
            Draft scripts, slice them into sequential scenes, and batch render B-Roll or character slides instantly.
          </p>
        </div>

        {/* Global Model Selectors */}
        <div className="flex items-center gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-[9px] uppercase font-semibold text-neutral-600 tracking-[0.18em]">Image Model</span>
            <select
              value={selectedImageModel}
              onChange={(e) => setSelectedImageModel(e.target.value)}
              className="bg-white/[0.025] border border-white/[0.06] rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-neutral-200 focus:outline-none cursor-pointer focus:border-white/20 transition-colors"
            >
              {IMAGE_MODELS.map((m) => (
                <option key={m.id} value={m.endpoint} className="bg-neutral-900">
                  {m.name} ({m.creditCost}c)
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-[9px] uppercase font-semibold text-neutral-600 tracking-[0.18em]">Video Model</span>
            <select
              value={selectedVideoModel}
              onChange={(e) => setSelectedVideoModel(e.target.value)}
              className="bg-white/[0.025] border border-white/[0.06] rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-neutral-200 focus:outline-none cursor-pointer focus:border-white/20 transition-colors"
            >
              {VIDEO_MODELS.map((m) => (
                <option key={m.id} value={m.endpoint} className="bg-neutral-900">
                  {m.name} ({m.creditCost}c)
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch flex-1">
        {/* Left pane: Script editor */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          <div className="text-[10px] uppercase font-semibold tracking-[0.18em] text-neutral-600">
            Scriptwriter Editor
          </div>
          <div className="flex-1 flex flex-col gap-3">
            <textarea
              value={script}
              onChange={(e) => setScript(e.target.value)}
              placeholder="Type your story script here. Separate scenes with double line breaks..."
              className="w-full flex-grow text-xs font-mono p-4 rounded-xl bg-white/[0.025] border border-white/[0.06] focus:border-white/20 focus:outline-none leading-relaxed text-neutral-200 resize-none min-h-[300px] transition-colors placeholder-neutral-700"
            />
            {error && (
              <div className="flex items-center gap-2 text-[11px] text-red-400 font-medium">
                <AlertIcon className="w-3 h-3" />
                {error}
              </div>
            )}

            <button
              onClick={handleParseScenes}
              className="w-full py-3 rounded-xl bg-white text-black text-[11px] font-bold uppercase tracking-[0.18em] hover:bg-neutral-200 active:scale-[0.98] shadow-lg transition-all cursor-pointer"
            >
              Parse Script to Storyboard Scenes
            </button>
          </div>
        </div>

        {/* Right pane: Storyboard Breakdown */}
        <div className="lg:col-span-7 flex flex-col gap-4">
          <div className="text-[10px] uppercase font-semibold tracking-[0.18em] text-neutral-600">
            Storyboard Breakdown
          </div>

          <div className="flex-grow overflow-y-auto max-h-[60vh] border border-white/[0.06] bg-black/20 p-4 rounded-xl flex flex-col gap-4">
            {scenes.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center py-20">
                <div className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center mb-4">
                  <ScriptIcon className="w-7 h-7 text-neutral-600" />
                </div>
                <p className="text-[12px] font-bold text-neutral-400">Storyboard Visualizer is Empty</p>
                <p className="text-[10px] text-neutral-600 mt-1.5 max-w-[280px] leading-relaxed">
                  Enter your video script in the editor and click &ldquo;Parse Script&rdquo; to segment it into scene prompts.
                </p>
              </div>
            ) : (
              scenes.map((scene, idx) => {
                const imgCost = IMAGE_MODELS.find((m) => m.endpoint === selectedImageModel)?.creditCost || 5;
                const vidCost = VIDEO_MODELS.find((m) => m.endpoint === selectedVideoModel)?.creditCost || 30;

                return (
                  <div
                    key={scene.number}
                    className="bg-white/[0.025] border border-white/[0.06] hover:border-white/[0.1] p-4 rounded-xl flex flex-col gap-3 transition-colors"
                  >
                    {/* Scene Row Header */}
                    <div className="flex items-center justify-between border-b border-white/[0.06] pb-2">
                      <span className="text-[11px] font-bold text-white tracking-wide">
                        Scene {scene.number}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => optimizePrompt(idx)}
                          disabled={optimizingIndex !== null}
                          className="flex items-center gap-1 text-[9px] font-semibold text-neutral-400 hover:text-white bg-white/[0.04] px-2 py-1 rounded border border-white/[0.06] cursor-pointer disabled:opacity-50 transition-colors"
                        >
                          <SparklesIcon className="w-2.5 h-2.5" />
                          {optimizingIndex === idx ? "Refining…" : "Optimize Prompt"}
                        </button>
                        <button
                          onClick={() => onNavigateToTab("voice", { text: scene.scriptText })}
                          className="flex items-center gap-1 text-[9px] font-semibold text-neutral-400 hover:text-white cursor-pointer transition-colors"
                        >
                          <MicIcon className="w-2.5 h-2.5" />
                          Send to Voice
                        </button>
                      </div>
                    </div>

                    {/* Scene Body grid */}
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                      {/* Script description */}
                      <div className="md:col-span-8 flex flex-col gap-3">
                        <p className="text-[11px] text-neutral-200 font-medium leading-relaxed">
                          {scene.scriptText}
                        </p>

                        <div className="flex flex-col gap-1">
                          <span className="text-[9px] uppercase font-semibold text-neutral-600 tracking-wider">
                            Visual Scene Prompt
                          </span>
                          <textarea
                            value={scene.visualPrompt}
                            onChange={(e) => {
                              const val = e.target.value;
                              setScenes((prev) =>
                                prev.map((s, i) => (i === idx ? { ...s, visualPrompt: val } : s))
                              );
                            }}
                            className="w-full text-[11px] p-2 rounded-lg bg-white/[0.025] border border-white/[0.06] focus:outline-none focus:border-white/20 text-neutral-300 transition-colors"
                            rows={2}
                          />
                        </div>

                        {/* Scene Action controls */}
                        <div className="flex items-center gap-2 mt-1">
                          <button
                            onClick={() => generateMedia(idx, "image")}
                            disabled={scene.generating}
                            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.08] hover:border-white/[0.14] text-[10px] font-bold text-neutral-300 hover:text-white disabled:opacity-50 cursor-pointer transition-all"
                          >
                            <ImageIcon className="w-3 h-3" />
                            Gen Image ({imgCost}cr)
                          </button>
                          <button
                            onClick={() => generateMedia(idx, "video")}
                            disabled={scene.generating}
                            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.08] hover:border-white/[0.14] text-[10px] font-bold text-neutral-300 hover:text-white disabled:opacity-50 cursor-pointer transition-all"
                          >
                            <FilmIcon className="w-3 h-3" />
                            Gen Video ({vidCost}cr)
                          </button>
                        </div>
                      </div>

                      {/* Media Thumbnail preview column */}
                      <div className="md:col-span-4 bg-black/40 rounded-xl overflow-hidden flex items-center justify-center aspect-video md:aspect-square relative border border-white/[0.06] p-2">
                        {scene.generating ? (
                          <div className="flex flex-col items-center gap-2">
                            <div className="w-5 h-5 rounded-full border border-white/10 border-t-white/80 animate-spin" />
                            <span className="text-[9px] text-neutral-600 animate-pulse">Rendering…</span>
                          </div>
                        ) : scene.mediaUrl ? (
                          scene.mediaType === "image" ? (
                            <img
                              src={scene.mediaUrl}
                              alt={`Scene ${scene.number} rendering`}
                              className="w-full h-full object-cover rounded-lg"
                            />
                          ) : (
                            <video
                              src={scene.mediaUrl}
                              muted
                              playsInline
                              className="w-full h-full object-cover rounded-lg"
                              onMouseOver={(e) => e.currentTarget.play()}
                              onMouseOut={(e) => e.currentTarget.pause()}
                            />
                          )
                        ) : (
                          <div className="text-neutral-700 text-[10px] text-center font-semibold">
                            <div>No Media</div>
                            <div className="text-[8px] opacity-75 mt-0.5 font-normal">Generate on left</div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
