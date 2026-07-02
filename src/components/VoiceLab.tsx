// ============================================================================
// DiipMynd — AI Voice Lab  ·  Obsidian Night
// Converts script text into narrations. Supports standard preset voices (Kokoro)
// and zero-shot voice cloning (F5-TTS, ElevenLabs/XTTS) using mic or file uploads.
// ============================================================================

"use client";

import React, { useState, useRef } from "react";
import { fal } from "@fal-ai/client";
import { SafeUser } from "@/lib/auth";
import { AUDIO_MODELS } from "@/lib/packages";

interface VoiceLabProps {
  user: SafeUser;
  onBalanceUpdated: () => void;
}

const PRESET_NARRATORS = [
  { name: "Adam (Male - Deep & Warm)", value: "af_bella" },
  { name: "Bella (Female - Clear & Narrative)", value: "af_bella" },
  { name: "Nicole (Female - Friendly & Conversational)", value: "af_nicole" },
  { name: "George (Male - Classic British)", value: "am_george" },
  { name: "Michael (Male - Cinematic Narrator)", value: "am_adam" },
];

// ── Inline SVG icons ──
type IconProps = { className?: string };
const WaveIcon = ({ className = "w-5 h-5" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12h2M6 8v8M10 4v16M14 7v10M18 9v6M22 12h-2" />
  </svg>
);
const MicIcon = ({ className = "w-4 h-4" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0M12 17v4" />
  </svg>
);
const UploadIcon = ({ className = "w-3.5 h-3.5" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
  </svg>
);
const AlertIcon = ({ className = "w-3 h-3" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 9v4M12 17h.01M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
  </svg>
);
const VolumeIcon = ({ className = "w-6 h-6" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 5 6 9H2v6h4l5 4V5z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14" />
  </svg>
);

export default function VoiceLab({ user, onBalanceUpdated }: VoiceLabProps) {
  const [model, setModel] = useState<string>(AUDIO_MODELS[0].endpoint);
  const [text, setText] = useState("");
  const [narrator, setNarrator] = useState(PRESET_NARRATORS[0].value);

  const [clonedAudioFile, setClonedAudioFile] = useState<File | null>(null);
  const [refText, setRefText] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [clonedAudioUrl, setClonedAudioUrl] = useState<string | null>(null);

  const [generating, setGenerating] = useState(false);
  const [resultAudio, setResultAudio] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const getCreditCost = () => {
    const matched = AUDIO_MODELS.find((m) => m.endpoint === model);
    return matched ? matched.creditCost : 10;
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/wav" });
        const audioFile = new File([audioBlob], "microphone_clone_sample.wav", { type: "audio/wav" });
        setClonedAudioFile(audioFile);
        setClonedAudioUrl(URL.createObjectURL(audioBlob));
        stream.getTracks().forEach((track) => track.stop());
      };

      setIsRecording(true);
      setRecordingDuration(0);
      mediaRecorder.start();

      timerRef.current = setInterval(() => {
        setRecordingDuration((prev) => {
          if (prev >= 10) {
            stopRecording();
            return 10;
          }
          return prev + 1;
        });
      }, 1000);

    } catch (err) {
      console.error("[voice-lab] Mic access denied:", err);
      setError("Microphone access was denied. Please allow permissions.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  const handleVoiceUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setClonedAudioFile(file);
      setClonedAudioUrl(URL.createObjectURL(file));
      setError(null);
    }
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) {
      setError("Please input the script text to narrate.");
      return;
    }

    setGenerating(true);
    setError(null);
    setResultAudio(null);

    try {
      let refAudioUrl = "";
      if (model !== "fal-ai/kokoro" && clonedAudioFile) {
        const formData = new FormData();
        formData.append("file", clonedAudioFile);

        const uploadRes = await fetch("/api/library/upload", {
          method: "POST",
          body: formData,
        });
        const uploadData = await uploadRes.json();
        if (!uploadRes.ok) throw new Error(uploadData.error || "Voice cloning upload failed.");
        refAudioUrl = uploadData.url;
      }

      let payload: any = { sync_mode: true };

      if (model === "fal-ai/kokoro") {
        payload.input = text.trim();
        payload.voice = narrator;
      } else if (model === "fal-ai/f5-tts") {
        payload.gen_text = text.trim();
        payload.ref_audio_url = refAudioUrl;
        payload.ref_text = refText.trim() || "Spoken reference voice sentence.";
      } else {
        payload.text = text.trim();
        payload.voice = refAudioUrl || "https://fal.media/files/monkey/qB16oX6P4n2t_mIeU8k_J.wav";
        payload.language = "en";
      }

      const result: any = await fal.run(model, { input: payload });
      onBalanceUpdated();

      const generatedUrl = result?.audio?.url || result?.url;
      if (!generatedUrl) {
        throw new Error("Fal.ai speech synthesis finished but returned no valid audio URL.");
      }

      const downloadRes = await fetch("/api/library/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: generatedUrl, name: `speech_narration.mp3` }),
      });

      const downloadData = await downloadRes.json();
      if (!downloadRes.ok) {
        throw new Error(downloadData.error || "Failed to download voiceover file.");
      }

      const persistentUrl = downloadData.url;

      await fetch("/api/library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "audio",
          name: `Voiceover: ${text.substring(0, 24)}...`,
          url: persistentUrl,
          model,
          prompt: text,
          telegramChatId: downloadData.telegramChatId,
          telegramMessageId: downloadData.telegramMessageId,
        }),
      });

      setResultAudio(persistentUrl);
      window.dispatchEvent(new Event("library-updated"));

    } catch (err: any) {
      console.error("[voice-lab] Speech synthesis failed:", err);
      setError(err.message || "An unexpected error occurred during TTS narration.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="glass-panel p-6 rounded-2xl flex flex-col gap-6 text-neutral-100 h-full max-h-[85vh] overflow-y-auto">
      <div>
        <h2 className="text-lg font-bold tracking-tight text-white flex items-center gap-2.5">
          <WaveIcon className="w-5 h-5 text-neutral-400" />
          AI Voice &amp; Narration Lab
        </h2>
        <p className="text-[12px] text-neutral-500 mt-1.5">
          Synthesize high-fidelity voiceover tracks or clone your voice to narrate visual storyboards.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Controls */}
        <form onSubmit={handleGenerate} className="flex flex-col gap-4">

          {/* Model selection */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] uppercase font-semibold tracking-[0.18em] text-neutral-600">
              Select Narration Engine ({getCreditCost()} Credits)
            </label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full text-xs py-2.5 px-3 rounded-lg bg-white/[0.025] border border-white/[0.06] focus:border-white/20 focus:outline-none text-neutral-100 font-semibold cursor-pointer transition-colors"
            >
              {AUDIO_MODELS.map((m) => (
                <option key={m.id} value={m.endpoint} className="bg-neutral-900">
                  {m.name} — ({m.creditCost} Credits)
                </option>
              ))}
            </select>
          </div>

          {/* Conditional Input fields */}
          {model === "fal-ai/kokoro" ? (
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] uppercase font-semibold tracking-[0.18em] text-neutral-600">
                Preset Voice Character
              </label>
              <select
                value={narrator}
                onChange={(e) => setNarrator(e.target.value)}
                className="w-full text-xs py-2.5 px-3 rounded-lg bg-white/[0.025] border border-white/[0.06] focus:border-white/20 focus:outline-none text-neutral-100 font-semibold cursor-pointer transition-colors"
              >
                {PRESET_NARRATORS.map((n) => (
                  <option key={n.value} value={n.value} className="bg-neutral-900">
                    {n.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            /* Voice Cloning panel */
            <div className="bg-white/[0.02] p-4 rounded-xl border border-white/[0.06] flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <MicIcon className="w-4 h-4 text-neutral-400" />
                <span className="text-[11px] font-bold text-white">Zero-Shot Voice Cloner</span>
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-[9px] uppercase font-semibold text-neutral-600 tracking-[0.18em]">
                  Option A: Record Reference Voice (3–10 Seconds)
                </span>

                <div className="flex items-center gap-3">
                  {isRecording ? (
                    <button
                      type="button"
                      onClick={stopRecording}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-500 hover:bg-red-600 text-white text-[11px] font-bold active:scale-95 transition-all cursor-pointer"
                    >
                      <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
                      Stop ({recordingDuration}s)
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={startRecording}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-white border border-white/[0.08] text-[11px] font-bold active:scale-95 transition-all cursor-pointer"
                    >
                      <MicIcon className="w-3.5 h-3.5" />
                      Record Mic
                    </button>
                  )}
                  {clonedAudioUrl && (
                    <audio src={clonedAudioUrl} controls className="h-8 max-w-[200px]" />
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-[9px] uppercase font-semibold text-neutral-600 tracking-[0.18em]">
                  Option B: Upload Reference Audio File (.wav / .mp3)
                </span>
                <label className="flex items-center gap-2 cursor-pointer">
                  <span className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-neutral-300 border border-white/[0.08] text-[11px] font-bold transition-all">
                    <UploadIcon className="w-3.5 h-3.5" />
                    Choose File
                  </span>
                  <input
                    type="file"
                    accept="audio/*"
                    onChange={handleVoiceUpload}
                    className="hidden"
                  />
                  {clonedAudioFile && (
                    <span className="text-[10px] text-neutral-500 truncate">{clonedAudioFile.name}</span>
                  )}
                </label>
              </div>

              {model === "fal-ai/f5-tts" && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-[9px] uppercase font-semibold tracking-[0.18em] text-neutral-600">
                    Transcript of reference voice (Required for F5-TTS)
                  </label>
                  <input
                    type="text"
                    required={model === "fal-ai/f5-tts"}
                    placeholder="Enter what was said in the reference audio clip…"
                    value={refText}
                    onChange={(e) => setRefText(e.target.value)}
                    className="text-xs py-2 px-3 rounded-lg bg-white/[0.025] border border-white/[0.06] focus:border-white/20 focus:outline-none text-neutral-100 placeholder-neutral-700 transition-colors"
                  />
                </div>
              )}
            </div>
          )}

          {/* Text script */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] uppercase font-semibold tracking-[0.18em] text-neutral-600">
              Text Script to Narrate
            </label>
            <textarea
              placeholder="Type or paste the scene narration text here (e.g. 'He looked around, pulling up his collar as the cold rain hit the pavement. The city didn't sleep, but it was quiet tonight.')"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              required
              className="w-full text-xs py-2.5 px-3.5 rounded-xl bg-white/[0.025] border border-white/[0.06] focus:border-white/20 focus:outline-none text-neutral-100 leading-relaxed placeholder-neutral-700 transition-colors"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-[11px] text-red-400 font-medium">
              <AlertIcon className="w-3 h-3" />
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
                Synthesizing Speech…
              </>
            ) : (
              "Generate Narration Track"
            )}
          </button>
        </form>

        {/* Results */}
        <div className="flex flex-col gap-4">
          <div className="text-[10px] uppercase font-semibold tracking-[0.18em] text-neutral-600">
            Preview Output
          </div>

          <div className="relative w-full rounded-2xl bg-black/40 border border-white/[0.06] p-6 flex items-center justify-center shadow-inner min-h-[160px]">
            {generating ? (
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 rounded-full border-2 border-white/10 border-t-white/80 animate-spin" />
                <p className="text-[11px] text-neutral-500 animate-pulse font-bold tracking-wide">Synthesizing audio track…</p>
              </div>
            ) : resultAudio ? (
              <div className="w-full flex flex-col items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-white/[0.06] border border-white/[0.1] flex items-center justify-center text-neutral-300">
                  <VolumeIcon className="w-5 h-5" />
                </div>
                <div className="text-center">
                  <p className="text-[12px] font-bold text-white">Narration Audio Generated</p>
                  <p className="text-[10px] text-neutral-500 mt-0.5">Click play to listen, or load it from timeline editor.</p>
                </div>
                <audio src={resultAudio} controls className="w-full max-w-sm mt-1" />
              </div>
            ) : (
              <div className="flex flex-col items-center text-center gap-3">
                <div className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center">
                  <WaveIcon className="w-7 h-7 text-neutral-600" />
                </div>
                <p className="text-[12px] font-bold text-neutral-400">Speech Synthesizer is Empty</p>
                <p className="text-[10px] text-neutral-600 max-w-[280px] leading-relaxed">
                  Enter your narration script, select/clone narrator voice properties, and compile narration audio track.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
