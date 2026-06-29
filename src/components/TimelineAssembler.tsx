// ============================================================================
// DiipMynd — Timeline Assembler  ·  Obsidian Night
// Multi-track video editing. Arrange generated clips alongside AI voiceover.
// Transcribes voiceovers using Whisper to burn-in styled kinetic subtitles.
// Uses a Canvas MediaRecorder to compile the preview into a downloadable MP4.
// ============================================================================

"use client";

import React, { useState, useEffect, useRef } from "react";
import { SafeUser } from "@/lib/auth";
import { fal } from "@fal-ai/client";
import { LibraryAsset } from "@/lib/library";

interface TimelineAssemblerProps {
  user: SafeUser;
  onBalanceUpdated: () => void;
  timelineAsset: LibraryAsset | null;
  clearTimelineAsset?: () => void;
}

interface VideoClip {
  id: string;
  asset: LibraryAsset;
  duration: number;
  startTime: number;
  endTime: number;
}

interface Subtitle {
  text: string;
  start: number;
  end: number;
}

// ── Inline SVG icons ──
type IconProps = { className?: string };
const LayersIcon = ({ className = "w-5 h-5" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2 2 7l10 5 10-5z" /><path d="m2 12 10 5 10-5M2 17l10 5 10-5" />
  </svg>
);
const PlayIcon = ({ className = "w-5 h-5" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
);
const PauseIcon = ({ className = "w-5 h-5" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
);
const DownloadIcon = ({ className = "w-3.5 h-3.5" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
  </svg>
);
const BoltMiniIcon = ({ className = "w-3 h-3" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 3 14h9l-1 8 10-12h-9z" /></svg>
);
const TrashIcon = ({ className = "w-3.5 h-3.5" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

export default function TimelineAssembler({
  user,
  onBalanceUpdated,
  timelineAsset,
  clearTimelineAsset,
}: TimelineAssemblerProps) {
  const [voiceover, setVoiceover] = useState<LibraryAsset | null>(null);
  const [videoClips, setVideoClips] = useState<VideoClip[]>([]);
  const [subtitles, setSubtitles] = useState<Subtitle[]>([]);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [compileProgress, setCompileProgress] = useState(0);
  const [exportUrl, setExportUrl] = useState<string | null>(null);

  const [captionColor, setCaptionColor] = useState("#FACC15");
  const [captionSize, setCaptionSize] = useState(24);
  const [uppercase, setUppercase] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRefsMap = useRef<{ [url: string]: HTMLVideoElement }>({});
  const animationFrameRef = useRef<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    if (timelineAsset) {
      if (timelineAsset.type === "audio") {
        setVoiceover(timelineAsset);
        setCurrentTime(0);
        if (audioRef.current) audioRef.current.currentTime = 0;
      } else if (timelineAsset.type === "video") {
        const clipDuration = 5;
        setVideoClips((prev) => {
          const startTime = prev.length > 0 ? prev[prev.length - 1].endTime : 0;
          return [
            ...prev,
            {
              id: Math.random().toString(),
              asset: timelineAsset,
              duration: clipDuration,
              startTime,
              endTime: startTime + clipDuration,
            },
          ];
        });
      }
      
      // Pin the asset so it doesn't get garbage collected
      fetch("/api/library", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: timelineAsset.id, pinned: true }),
      }).catch(err => console.error("Failed to pin asset:", err));

      if (clearTimelineAsset) clearTimelineAsset();
    }
  }, [timelineAsset, clearTimelineAsset]);

  useEffect(() => {
    let cumulative = 0;
    const adjustedClips = videoClips.map((clip) => {
      const start = cumulative;
      cumulative += clip.duration;
      return { ...clip, startTime: start, endTime: cumulative };
    });
    setVideoClips(adjustedClips);
    const voiceDuration = audioRef.current?.duration || 0;
    setDuration(Math.max(voiceDuration, cumulative));
  }, [videoClips, voiceover]);

  const handleAudioLoaded = () => {
    if (audioRef.current) {
      const voiceDuration = audioRef.current.duration;
      setDuration(Math.max(voiceDuration, videoClips.length > 0 ? videoClips[videoClips.length - 1].endTime : 0));
    }
  };

  const handleTranscribe = async () => {
    if (!voiceover) return;
    setTranscribing(true);
    setError(null);

    try {
      const deductRes = await fetch("/api/credits/deduct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskType: "whisper_transcription",
          description: "Subtitle voice track transcription (Whisper)",
        }),
      });

      const deductData = await deductRes.json();
      if (!deductRes.ok) {
        throw new Error(deductData.error || "Credit deduction failed.");
      }

      onBalanceUpdated();

      const result: any = await fal.run("fal-ai/whisper", {
        input: {
          audio_url: voiceover.url,
          task: "transcribe",
          chunk_level: "word",
        },
      });

      const chunks = result?.chunks || [];
      const parsedSubtitles: Subtitle[] = chunks.map((c: any) => {
        const start = Array.isArray(c.timestamp) ? c.timestamp[0] : c.start || 0;
        const end = Array.isArray(c.timestamp) ? c.timestamp[1] : c.end || start + 0.5;
        return { text: c.text || "", start, end };
      });

      setSubtitles(parsedSubtitles);
    } catch (err: any) {
      console.error("[timeline-transcribe] Transcription failed:", err);
      setError(err.message || "Failed to transcribe voice track.");
    } finally {
      setTranscribing(false);
    }
  };

  const togglePlay = () => {
    if (isPlaying) {
      setIsPlaying(false);
      if (audioRef.current) audioRef.current.pause();
      Object.values(videoRefsMap.current).forEach((v) => v.pause());
    } else {
      setIsPlaying(true);
      if (audioRef.current) {
        if (audioRef.current.currentTime >= duration) {
          audioRef.current.currentTime = 0;
          setCurrentTime(0);
        }
        audioRef.current.play().catch(() => {});
      }
    }
  };

  useEffect(() => {
    if (isPlaying) {
      const updateTime = () => {
        if (audioRef.current) {
          const cur = audioRef.current.currentTime;
          setCurrentTime(cur);
          if (cur >= duration) {
            setIsPlaying(false);
            if (audioRef.current) audioRef.current.pause();
          }
        }
        animationFrameRef.current = requestAnimationFrame(updateTime);
      };
      animationFrameRef.current = requestAnimationFrame(updateTime);
    } else {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    }
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [isPlaying, duration]);

  // Main Canvas Rendering Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const activeClip = videoClips.find(
      (clip) => currentTime >= clip.startTime && currentTime <= clip.endTime
    );

    ctx.fillStyle = "#030304";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (activeClip) {
      let videoEl = videoRefsMap.current[activeClip.asset.url];
      if (!videoEl) {
        videoEl = document.createElement("video");
        videoEl.src = activeClip.asset.url;
        videoEl.crossOrigin = "anonymous";
        videoEl.muted = true;
        videoEl.loop = true;
        videoEl.playsInline = true;
        videoRefsMap.current[activeClip.asset.url] = videoEl;
      }

      const relativeTime = currentTime - activeClip.startTime;
      if (isPlaying) {
        if (videoEl.paused) videoEl.play().catch(() => {});
        if (Math.abs(videoEl.currentTime - relativeTime) > 0.2) {
          videoEl.currentTime = relativeTime;
        }
      } else {
        videoEl.pause();
        videoEl.currentTime = relativeTime;
      }

      if (videoEl.readyState >= 2) {
        ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
      }
    }

    const activeSub = subtitles.find(
      (sub) => currentTime >= sub.start && currentTime <= sub.end
    );

    if (activeSub) {
      let subText = activeSub.text;
      if (uppercase) subText = subText.toUpperCase();

      ctx.font = `900 ${captionSize}px "Impact", "Arial Black", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const x = canvas.width / 2;
      const y = canvas.height * 0.8;

      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 6;
      ctx.strokeText(subText, x, y);

      ctx.fillStyle = captionColor;
      ctx.fillText(subText, x, y);
    }
  }, [currentTime, videoClips, subtitles, captionColor, captionSize, uppercase, isPlaying]);

  const handleExport = async () => {
    const canvas = canvasRef.current;
    if (!canvas || videoClips.length === 0) return;

    setCompiling(true);
    setCompileProgress(0);
    setExportUrl(null);
    recordedChunksRef.current = [];

    try {
      setCurrentTime(0);
      setIsPlaying(false);
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.pause();
      }

      const stream = canvas.captureStream(30);

      if (audioRef.current && (audioRef.current as any).captureStream) {
        const audioStream = (audioRef.current as any).captureStream();
        const audioTrack = audioStream.getAudioTracks()[0];
        if (audioTrack) stream.addTrack(audioTrack);
      }

      const recorder = new MediaRecorder(stream, {
        mimeType: "video/webm;codecs=vp9",
      });

      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const videoBlob = new Blob(recordedChunksRef.current, { type: "video/mp4" });
        const compiledUrl = URL.createObjectURL(videoBlob);
        setExportUrl(compiledUrl);
        setCompiling(false);
      };

      recorder.start();
      setIsPlaying(true);
      if (audioRef.current) audioRef.current.play().catch(() => {});

      const progressTimer = setInterval(() => {
        setCurrentTime((time) => {
          const prog = Math.min(100, Math.round((time / duration) * 100));
          setCompileProgress(prog);
          if (time >= duration) {
            clearInterval(progressTimer);
            recorder.stop();
            setIsPlaying(false);
            if (audioRef.current) audioRef.current.pause();
          }
          return time;
        });
      }, 100);

    } catch (err: any) {
      console.error("[timeline-export] Canvas recording compile failed:", err);
      setError("Export compilation failed: " + err.message);
      setCompiling(false);
    }
  };

  const handleClearTimeline = () => {
    setVoiceover(null);
    setVideoClips([]);
    setSubtitles([]);
    setCurrentTime(0);
    setExportUrl(null);
    if (audioRef.current) audioRef.current.src = "";
  };

  return (
    <div className="glass-panel p-6 rounded-2xl flex flex-col gap-5 text-neutral-100 h-full max-h-[85vh] overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-white flex items-center gap-2.5">
            <LayersIcon className="w-5 h-5 text-neutral-400" />
            Timeline Assembler
          </h2>
          <p className="text-[12px] text-neutral-500 mt-1.5">
            Sequence your video b-rolls, sync the voice narrative, and burn-in animated subtitle captions.
          </p>
        </div>
        <button
          onClick={handleClearTimeline}
          className="flex items-center gap-1.5 py-1.5 px-3 rounded-lg text-[11px] font-bold bg-white/[0.04] border border-white/[0.06] text-red-400 hover:bg-red-500/10 hover:border-red-500/30 cursor-pointer transition-all"
        >
          <TrashIcon className="w-3 h-3" />
          Clear
        </button>
      </div>

      {/* Main editor grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* Preview Player & Compile */}
        <div className="lg:col-span-6 flex flex-col gap-4">
          <div className="text-[10px] uppercase font-semibold tracking-[0.18em] text-neutral-600">
            Workstation Preview
          </div>

          <div className="relative aspect-video bg-black/40 border border-white/[0.06] rounded-2xl overflow-hidden shadow-2xl flex items-center justify-center">
            <canvas
              ref={canvasRef}
              width={1024}
              height={576}
              className="w-full h-full object-contain"
            />

            {!isPlaying && !compiling && (
              <div
                onClick={togglePlay}
                className="absolute inset-0 bg-black/30 flex items-center justify-center cursor-pointer hover:bg-black/50 transition-colors"
              >
                <div className="w-14 h-14 rounded-full bg-white flex items-center justify-center text-black shadow-xl hover:scale-105 transition-all">
                  <PlayIcon className="w-6 h-6 ml-0.5" />
                </div>
              </div>
            )}
          </div>

          {/* Player controls */}
          <div className="flex items-center justify-between bg-white/[0.025] p-3 rounded-xl border border-white/[0.06] gap-4">
            <button
              onClick={togglePlay}
              className="p-2 rounded-lg bg-white/[0.06] border border-white/[0.08] text-white hover:bg-white/[0.1] cursor-pointer transition-colors"
            >
              {isPlaying ? <PauseIcon className="w-5 h-5" /> : <PlayIcon className="w-5 h-5" />}
            </button>

            <div className="flex-grow flex items-center gap-2">
              <span className="text-[10px] font-mono text-neutral-500">{currentTime.toFixed(1)}s</span>
              <input
                type="range"
                min="0"
                max={duration || 1}
                step="0.1"
                value={currentTime}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setCurrentTime(val);
                  if (audioRef.current) audioRef.current.currentTime = val;
                }}
                className="custom-slider flex-grow"
                style={{ ["--value" as any]: `${duration ? (currentTime / duration) * 100 : 0}%` }}
              />
              <span className="text-[10px] font-mono text-neutral-500">{duration.toFixed(1)}s</span>
            </div>
          </div>
        </div>

        {/* Captions Style & Transcribe */}
        <div className="lg:col-span-6 flex flex-col gap-4 justify-between">
          <div className="flex flex-col gap-4">
            <div className="text-[10px] uppercase font-semibold tracking-[0.18em] text-neutral-600">
              Captions &amp; Burn-In Settings
            </div>

            {/* Captions styler card */}
            <div className="bg-white/[0.025] p-4 rounded-xl border border-white/[0.06] flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] text-neutral-600 font-semibold uppercase tracking-[0.18em]">
                    Text Highlight Color
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={captionColor}
                      onChange={(e) => setCaptionColor(e.target.value)}
                      className="w-8 h-8 rounded border-0 cursor-pointer bg-transparent"
                    />
                    <span className="text-xs font-mono text-neutral-300 font-bold">{captionColor}</span>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] text-neutral-600 font-semibold uppercase tracking-[0.18em]">
                    Text Case Formatting
                  </label>
                  <button
                    onClick={() => setUppercase(!uppercase)}
                    className="w-full py-1.5 px-3 rounded-lg text-[11px] font-bold bg-white/[0.04] border border-white/[0.06] text-neutral-200 hover:bg-white/[0.08] cursor-pointer transition-colors"
                  >
                    {uppercase ? "Force Uppercase" : "Normal Casing"}
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <div className="flex justify-between text-[9px] uppercase font-semibold text-neutral-600 tracking-wider">
                  <span>Font Size</span>
                  <span>{captionSize}px</span>
                </div>
                <input
                  type="range"
                  min="16"
                  max="48"
                  value={captionSize}
                  onChange={(e) => setCaptionSize(parseInt(e.target.value))}
                  className="custom-slider my-2"
                  style={{ ["--value" as any]: `${((captionSize - 16) / 32) * 100}%` }}
                />
              </div>
            </div>

            {/* Auto transcription tool */}
            <div className="bg-white/[0.02] p-4 rounded-xl border border-white/[0.06] flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-white">Timed Caption Subtitles</span>
                {voiceover && !transcribing && (
                  <button
                    onClick={handleTranscribe}
                    className="flex items-center gap-1 text-[9px] font-bold text-neutral-300 hover:text-white cursor-pointer transition-colors"
                  >
                    <BoltMiniIcon className="w-2.5 h-2.5" />
                    Auto Transcribe Voiceover
                  </button>
                )}
              </div>

              {transcribing ? (
                <div className="flex items-center gap-2 text-[11px] text-neutral-500 py-3 justify-center">
                  <div className="w-4 h-4 rounded-full border border-white/10 border-t-white/80 animate-spin" />
                  <span>Whisper AI is generating text timestamps…</span>
                </div>
              ) : subtitles.length > 0 ? (
                <div className="max-h-[100px] overflow-y-auto text-[11px] text-neutral-400 flex flex-col gap-1 border border-white/[0.06] p-2 rounded bg-black/30">
                  {subtitles.map((sub, idx) => (
                    <div key={idx} className="flex justify-between border-b border-white/[0.04] pb-1 last:border-0">
                      <span className="text-neutral-300">&ldquo;{sub.text}&rdquo;</span>
                      <span className="font-mono text-neutral-600">
                        {sub.start.toFixed(1)}s – {sub.end.toFixed(1)}s
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[10px] text-neutral-600 leading-relaxed text-center py-4">
                  {voiceover
                    ? "Voice track loaded! Click 'Auto Transcribe' above to burn-in styled subtitles."
                    : "Load a voiceover narrative into the timeline first to parse subtitles."}
                </p>
              )}
            </div>
          </div>

          {/* Export compiled output */}
          <div className="border-t border-white/[0.06] pt-4 flex flex-col gap-3">
            {compiling ? (
              <div className="bg-white/[0.025] p-4 rounded-xl border border-white/[0.08]">
                <div className="flex justify-between text-[11px] font-bold text-white mb-2">
                  <span>Compiling Final MP4 Video…</span>
                  <span>{compileProgress}%</span>
                </div>
                <div className="w-full bg-white/[0.06] h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-white h-full transition-all duration-100"
                    style={{ width: `${compileProgress}%` }}
                  />
                </div>
              </div>
            ) : exportUrl ? (
              <div className="flex items-center justify-between bg-white/[0.04] p-4 border border-white/[0.08] rounded-xl">
                <div>
                  <span className="text-[11px] font-bold text-white block">Compilation Complete</span>
                  <span className="text-[9px] text-neutral-500">Browser-compiled MP4 package ready.</span>
                </div>
                <a
                  href={exportUrl}
                  download="diipmynd_final_output.mp4"
                  className="flex items-center gap-1.5 py-2 px-4 rounded-xl bg-white text-black text-[11px] font-bold hover:bg-neutral-200 transition-all cursor-pointer shadow-lg"
                >
                  <DownloadIcon className="w-3.5 h-3.5" />
                  Download
                </a>
              </div>
            ) : (
              <button
                onClick={handleExport}
                disabled={videoClips.length === 0}
                className={`w-full py-3 rounded-xl text-[11px] font-bold uppercase tracking-[0.18em] transition-all cursor-pointer ${
                  videoClips.length === 0
                    ? "bg-white/[0.025] text-neutral-600 cursor-not-allowed border border-white/[0.06]"
                    : "bg-white text-black hover:bg-neutral-200 shadow-lg"
                }`}
              >
                Compile &amp; Render Final Video
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Interactive Timeline Tracks View */}
      <div className="border border-white/[0.06] bg-black/20 p-4 rounded-2xl flex flex-col gap-4 mt-2 select-none">
        <div className="flex items-center justify-between text-[10px] uppercase font-semibold text-neutral-600 tracking-[0.18em]">
          <span>Timeline Multi-track Channels</span>
          <span className="text-neutral-500">Drag/Drop clips to rearrange</span>
        </div>

        {/* Video Track Row */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <span className="w-20 text-[10px] font-bold text-neutral-500 tracking-wider">VIDEO</span>

            <div className="flex-1 min-h-[55px] bg-white/[0.02] rounded-xl p-2 border border-white/[0.06] flex items-center gap-2 overflow-x-auto relative timeline-track-bg">
              {videoClips.length === 0 ? (
                <span className="text-[10px] text-neutral-600 font-medium absolute inset-0 flex items-center justify-center">
                  Drag and add generated video B-rolls here from library
                </span>
              ) : (
                videoClips.map((clip) => (
                  <div
                    key={clip.id}
                    className="timeline-clip-video h-9 px-2 rounded-lg flex items-center justify-between gap-3 text-[10px] font-bold text-white border relative overflow-hidden flex-shrink-0"
                    style={{ width: `${clip.duration * 25}px`, minWidth: "120px" }}
                  >
                    <span className="truncate max-w-[80px]" title={clip.asset.name}>
                      {clip.asset.name}
                    </span>
                    <div className="flex items-center gap-1">
                      <span className="text-[8px] opacity-60 font-mono">{clip.duration}s</span>
                      <button
                        onClick={() => setVideoClips((prev) => prev.filter((c) => c.id !== clip.id))}
                        className="text-neutral-400 hover:text-red-400 font-bold text-xs transition-colors"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Audio Track Row */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <span className="w-20 text-[10px] font-bold text-neutral-500 tracking-wider">VOICEOVER</span>

            <div className="flex-1 min-h-[48px] bg-white/[0.02] rounded-xl p-2 border border-white/[0.06] flex items-center gap-2 relative timeline-track-bg">
              {voiceover ? (
                <div className="timeline-clip-audio h-8 px-3 rounded-lg flex items-center justify-between gap-3 text-[10px] font-bold text-white border flex-grow">
                  <span className="truncate max-w-[300px]">{voiceover.name}</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[8px] opacity-60">Voice Narration</span>
                    <button
                      onClick={() => setVoiceover(null)}
                      className="text-neutral-400 hover:text-red-400 font-bold text-xs transition-colors"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ) : (
                <span className="text-[10px] text-neutral-600 font-medium absolute inset-0 flex items-center justify-center">
                  Attach synthesized Voice Lab audio track from Library
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Hidden audio element for player sync */}
      {voiceover && (
        <audio
          ref={audioRef}
          src={voiceover.url}
          onLoadedMetadata={handleAudioLoaded}
          className="hidden"
        />
      )}
    </div>
  );
}
