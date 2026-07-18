// ============================================================================
// DiipMynd — LiveAvatarStream Component  ·  Obsidian Night
//
// Hybrid WebRTC lifecycle manager for Decart + Fal.ai Smart Router pipeline.
//
// LIFECYCLE OVERVIEW:
// ┌─────────────────────────────────────────────────────────────────────┐
// │ 1. SMART ROUTER    — Probe providers → pick optimal backend        │
// │ 2. CAMERA SETUP    — getUserMedia with model-specific constraints  │
// │ 3. CONNECTION       — Decart SDK or Fal.ai manual WebRTC          │
// │ 4. STREAM PIPING    — onRemoteStream → <video> element            │
// │ 5. TEARDOWN         — disconnect() + stop media tracks on unmount  │
// └─────────────────────────────────────────────────────────────────────┘
// ============================================================================

"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  createDecartClient,
  models,
  type RealTimeClient,
} from "@decartai/sdk";
import { fal } from "@fal-ai/client";
import type {
  ConnectionState,
  StreamError,
  DecartAuthResponse,
  Provider,
  ProviderPreference,
} from "@/types";
import { selectProvider, getProviderConfig } from "@/lib/smartRouter";

fal.config({
  proxyUrl: "/api/fal/proxy",
});

import ConnectionStatus from "./ConnectionStatus";
import PromptInput from "./PromptInput";
import ReferenceImageUpload from "./ReferenceImageUpload";
import DiagnosticsOverlay, { type DiagnosticsStats } from "./DiagnosticsOverlay";
import { SafeUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase/client";
import AdminPanel from "./AdminPanel";
import TopUpModal from "./TopUpModal";

// ── Constants ──────────────────────────────────────────────────────────────
const MAX_RECONNECT_ATTEMPTS = 5;
const BASE_RECONNECT_DELAY_MS = 2000;

const DEFAULT_PROMPT =
  "Preserve the person exactly as they are. No changes to face, body, clothing, or background. Natural lighting, photorealistic. Do not add, remove, or modify any body parts.";

const IMAGE_TRANSFORM_PROMPT =
  "Transform the person to look exactly like the person in the reference image. Match their face, hairstyle, skin tone, and overall appearance as closely as possible while preserving the user's expressions and head movements. Do not add extra limbs or body parts.";

interface LiveAvatarStreamProps {
  user: SafeUser;
  onLogout: () => void;
  onBalanceUpdated: () => void;
}

// ── Inline SVG icons (monochrome) ──────────────────────────────────────────
type IconProps = { className?: string };

const PlayIcon = ({ className = "w-4 h-4" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor"><path d="M6 4.5v15l13-7.5z" /></svg>
);
const StopIcon = ({ className = "w-4 h-4" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1.5" /></svg>
);
const MicIcon = ({ className = "w-4 h-4" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M5 10a7 7 0 0 0 14 0M12 17v4M8 21h8" />
  </svg>
);
const MicOffIcon = ({ className = "w-4 h-4" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 9v-4a3 3 0 0 1 6 0v4M5 10a7 7 0 0 0 11 5M12 17v4M8 21h8" />
    <path d="m3 3 18 18" />
  </svg>
);
const PopOutIcon = ({ className = "w-4 h-4" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4M14 4h6m0 0v6m0-6L10 14" />
  </svg>
);
const VideoCamIcon = ({ className = "w-7 h-7" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="6" width="14" height="12" rx="2" />
    <path d="M16 10l6-4v12l-6-4z" />
  </svg>
);
const PiPIcon = ({ className = "w-6 h-6" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
  </svg>
);
const BoltMiniIcon = ({ className = "w-3 h-3" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 3 14h9l-1 8 10-12h-9z" /></svg>
);
const GlobeIcon = ({ className = "w-3 h-3" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
  </svg>
);
const ShuffleIcon = ({ className = "w-3 h-3" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
  </svg>
);
const CardIcon = ({ className = "w-3.5 h-3.5" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="5" width="20" height="14" rx="2" />
    <path d="M2 10h20" />
  </svg>
);
const CheckIcon = ({ className = "w-2.5 h-2.5" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);
const AlertIcon = ({ className = "w-3 h-3" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 9v4M12 17h.01M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
  </svg>
);
const CloseIcon = ({ className = "w-3 h-3" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);
const formatTime = (totalSeconds: number | null): string => {
  if (totalSeconds === null) return "--:--";
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  const pad = (n: number) => String(n).padStart(2, "0");

  if (hrs > 0) {
    return `${hrs}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(mins)}:${pad(secs)}`;
};

export default function LiveAvatarStream({ user, onLogout, onBalanceUpdated }: LiveAvatarStreamProps) {
  // ── State ──────────────────────────────────────────────────────────────
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [error, setError] = useState<StreamError | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [currentPrompt, setCurrentPrompt] = useState(DEFAULT_PROMPT);
  const [diagnosticsStats, setDiagnosticsStats] = useState<DiagnosticsStats | null>(null);
  const [isPoppedOut, setIsPoppedOut] = useState(false);
  const [isPiPSupported, setIsPiPSupported] = useState(false);
  const [isMicEnabled, setIsMicEnabled] = useState(false);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [hasLocalStream, setHasLocalStream] = useState(false);

  // Custom balance and admin states
  const [credits, setCredits] = useState(user.credits);
  const [isAdminPanelOpen, setIsAdminPanelOpen] = useState(false);
  const [isTopUpOpen, setIsTopUpOpen] = useState(false);



  // ── Smart Router State ───────────────────────────────────────────────
  const [providerPreference, setProviderPreference] = useState<ProviderPreference>("auto");
  const [activeProvider, setActiveProvider] = useState<Provider | null>(null);
  const [routingReason, setRoutingReason] = useState<string>("");
  const [showPaymentSuccess, setShowPaymentSuccess] = useState(false);
  const [showPaymentFailed, setShowPaymentFailed] = useState(false);
  const [paymentErrorMessage, setPaymentErrorMessage] = useState("");
  const [isEnding, setIsEnding] = useState(false);
  const [countdownSeconds, setCountdownSeconds] = useState<number | null>(null);

  // ── Refs ───────────────────────────────────────────────────────────────
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const realtimeClientRef = useRef<RealTimeClient | null>(null);
  const falRealtimeConnectionRef = useRef<any>(null);
  const falPeerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const referenceImageUrlRef = useRef<string>("");
  const localStreamRef = useRef<MediaStream | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const streamIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef(true);
  const intentionalDisconnectRef = useRef(false);
  const currentPromptRef = useRef(DEFAULT_PROMPT);
  const referenceImageRef = useRef<File | null>(null);
  const creditsRef = useRef(user.credits);
  const activeProviderRef = useRef<Provider | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const sessionExpiryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isStartingSessionRef = useRef(false);

  // ── Session archival recording (operator-only, not user-facing) ────────
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingSessionIdRef = useRef<string | null>(null);
  const recordingChunkIndexRef = useRef(0);
  const recordingSegmentTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setCredits(user.credits);
  }, [user.credits]);

  useEffect(() => {
    creditsRef.current = credits;
  }, [credits]);

  useEffect(() => {
    activeProviderRef.current = activeProvider;
  }, [activeProvider]);



  useEffect(() => {
    if (typeof window !== "undefined") {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get("payment") === "success") {
        setShowPaymentSuccess(true);
        const newUrl = window.location.pathname;
        window.history.replaceState({}, document.title, newUrl);
        const timer = setTimeout(() => setShowPaymentSuccess(false), 6000);
        return () => clearTimeout(timer);
      }
    }
  }, []);

  // ── Cleanup helpers ────────────────────────────────────────────────────
  const stopLocalStream = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
    setHasLocalStream(false);
  }, []);

  // ── Session archival recording (operator-only) ─────────────────────────
  // Silently archives the transformed WebRTC output to the Telegram backend
  // in rolling segments, for the operator's own review/download. This is
  // intentionally NOT wired into the workspace library — no library_assets
  // row is created and no URL is ever returned to the client.
  const RECORDING_SEGMENT_MS = 5 * 60 * 1000; // rotate every 5 min so each archived file stays small and independently playable

  const uploadRecordingSegment = useCallback(
    async (blob: Blob, sessionId: string, chunkIndex: number, mimeType: string) => {
      const extension = mimeType.includes("webm") ? "webm" : "mp4";
      const form = new FormData();
      form.append("file", blob, `segment_${chunkIndex}.${extension}`);
      form.append("sessionId", sessionId);
      form.append("chunkIndex", String(chunkIndex));

      const res = await fetch("/api/stream/record", { method: "POST", body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Archive upload failed (${res.status})`);
      }
    },
    []
  );

  const startRecordingSegment = useCallback(
    (stream: MediaStream) => {
      if (!stream || stream.getTracks().length === 0) return;

      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
        ? "video/webm;codecs=vp9,opus"
        : MediaRecorder.isTypeSupported("video/webm")
          ? "video/webm"
          : "";
      if (!mimeType) {
        console.warn("[recorder] No supported MediaRecorder mimeType; skipping archival for this session.");
        return;
      }

      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(stream, {
          mimeType,
          videoBitsPerSecond: 700_000,
          audioBitsPerSecond: 64_000,
        });
      } catch (err) {
        console.error("[recorder] Failed to create MediaRecorder:", err);
        return;
      }

      const segmentChunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) segmentChunks.push(e.data);
      };
      recorder.onstop = () => {
        const sessionId = recordingSessionIdRef.current;
        const chunkIndex = recordingChunkIndexRef.current++;
        const blob = new Blob(segmentChunks, { type: mimeType });
        if (sessionId && blob.size > 0) {
          uploadRecordingSegment(blob, sessionId, chunkIndex, mimeType).catch((err) => {
            console.error("[recorder] Segment archival upload failed:", err);
          });
        }
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
    },
    [uploadRecordingSegment]
  );

  const rotateRecordingSegment = useCallback(
    (stream: MediaStream) => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop(); // flushes the finished segment via onstop → upload
      }
      startRecordingSegment(stream);
    },
    [startRecordingSegment]
  );

  const beginSessionRecording = useCallback(
    (stream: MediaStream) => {
      const sessionId = activeSessionIdRef.current;
      if (!sessionId) return;

      // Only start recording once the stream actually has a video track.
      // If it doesn't yet, listen for the native browser "addtrack" event on
      // this exact stream object — this fires regardless of how many times
      // (or how few) the Decart/Fal callback itself is invoked.
      if (stream.getVideoTracks().length === 0) {
        console.log("[recorder] No video track yet — waiting for addtrack event on this stream.");
        const onAddTrack = () => {
          if (stream.getVideoTracks().length > 0) {
            stream.removeEventListener("addtrack", onAddTrack);
            beginSessionRecording(stream);
          }
        };
        stream.addEventListener("addtrack", onAddTrack);
        return;
      }

      // Guard against double-start (e.g. reconnect firing onRemoteStream/ontrack twice,
      // or both the addtrack listener AND a re-invoked SDK callback firing)
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") return;

      recordingSessionIdRef.current = sessionId;
      recordingChunkIndexRef.current = 0;
      startRecordingSegment(stream);

      if (recordingSegmentTimerRef.current) clearInterval(recordingSegmentTimerRef.current);
      recordingSegmentTimerRef.current = setInterval(() => rotateRecordingSegment(stream), RECORDING_SEGMENT_MS);
    },
    [startRecordingSegment, rotateRecordingSegment]
  );

  const stopSessionRecording = useCallback(() => {
    if (recordingSegmentTimerRef.current) {
      clearInterval(recordingSegmentTimerRef.current);
      recordingSegmentTimerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop(); // flushes the final (possibly partial) segment
    }
    mediaRecorderRef.current = null;
  }, []);

  const disconnectRealtime = useCallback(() => {
    intentionalDisconnectRef.current = true;

    if (realtimeClientRef.current) {
      try {
        realtimeClientRef.current.disconnect();
      } catch (err) {
        console.warn("[DiipMynd] Error disconnecting Decart client:", err);
      }
      realtimeClientRef.current = null;
    }

    if (falRealtimeConnectionRef.current) {
      try {
        falRealtimeConnectionRef.current.close();
      } catch (err) {
        console.warn("[DiipMynd] Error closing Fal connection:", err);
      }
      falRealtimeConnectionRef.current = null;
    }
    if (falPeerConnectionRef.current) {
      try {
        falPeerConnectionRef.current.close();
      } catch (err) {
        console.warn("[DiipMynd] Error closing peer connection:", err);
      }
      falPeerConnectionRef.current = null;
    }
  }, []);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  // ── Camera initialization ────────────────────────────────────────────
  const initCamera = useCallback(async (provider: Provider): Promise<MediaStream> => {
    setConnectionState("initializing-camera");

    const config = getProviderConfig(provider);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: isMicEnabled,
        video: {
          frameRate: { exact: config.fps },
          width: { exact: config.width },
          height: { exact: config.height },
        },
      });

      localStreamRef.current = stream;
      setHasLocalStream(true);
      return stream;
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "OverconstrainedError") {
        console.warn("[DiipMynd] Exact camera constraints failed, falling back to ideal constraints");
        const fallbackStream = await navigator.mediaDevices.getUserMedia({
          audio: isMicEnabled,
          video: {
            frameRate: config.fps,
            width: { ideal: config.width },
            height: { ideal: config.height },
          },
        });
        localStreamRef.current = fallbackStream;
        setHasLocalStream(true);
        return fallbackStream;
      }

      if (err instanceof DOMException) {
        if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
          throw Object.assign(new Error("Camera permission was denied."), {
            code: "CAMERA_DENIED" as const,
          });
        }
        if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
          throw Object.assign(new Error("No camera found on this device."), {
            code: "CAMERA_NOT_FOUND" as const,
          });
        }
      }
      throw err;
    }
  }, [isMicEnabled]);

  // ── Reconnection logic with exponential backoff ───────────────────────
  const scheduleReconnect = useCallback(
    (startSessionFn: () => Promise<void>) => {
      if (intentionalDisconnectRef.current) return;

      setRetryCount((prev) => {
        const attempt = prev + 1;
        if (attempt > MAX_RECONNECT_ATTEMPTS) {
          setConnectionState("disconnected");
          setError({
            code: "CONNECTION_FAILED",
            message: `Connection lost after ${MAX_RECONNECT_ATTEMPTS} retries. Please check your network and try again.`,
          });
          return prev;
        }

        const delay = BASE_RECONNECT_DELAY_MS * Math.pow(2, attempt - 1);
        setConnectionState("reconnecting");
        console.log(`[DiipMynd] Scheduling reconnect attempt ${attempt} in ${delay}ms`);

        clearReconnectTimer();
        reconnectTimerRef.current = setTimeout(() => {
          if (isMountedRef.current && !intentionalDisconnectRef.current) {
            startSessionFn();
          }
        }, delay);

        return attempt;
      });
    },
    [clearReconnectTimer]
  );

  // ── Stop session handler ──────────────────────────────────────────────
  const handleStop = useCallback(() => {
    intentionalDisconnectRef.current = true;
    clearReconnectTimer();
    disconnectRealtime();
    stopSessionRecording();
    setCountdownSeconds(null);

    if (sessionExpiryTimeoutRef.current) {
      clearTimeout(sessionExpiryTimeoutRef.current);
      sessionExpiryTimeoutRef.current = null;
    }

    const sessionId = activeSessionIdRef.current;
    if (sessionId) {
      activeSessionIdRef.current = null;
      setIsEnding(true);
      fetch("/api/stream/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      }).then(() => {
        onBalanceUpdated();
      }).catch((err) => {
        console.error("[stream-end] Failed to gracefully close stream session:", err);
      }).finally(() => {
        setIsEnding(false);
      });
    }

    if (streamIntervalRef.current) {
      clearInterval(streamIntervalRef.current);
      streamIntervalRef.current = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }

    stopLocalStream();
    setConnectionState("disconnected");
    setRetryCount(0);
    setDiagnosticsStats(null);
    setIsMicMuted(false);
    setActiveProvider(null);
    setRoutingReason("");

    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
  }, [clearReconnectTimer, disconnectRealtime, stopLocalStream, onBalanceUpdated, stopSessionRecording]);

  // ── Connection Established Billing & Timer Rebase ─────────────────────
  const handleConnectionConnected = useCallback(async () => {
    setConnectionState("connected");
    setRetryCount(0);

    const sessionId = activeSessionIdRef.current;
    if (!sessionId) return;

    try {
      console.log(`[DiipMynd] Signaling stream connection established for session ${sessionId}...`);
      const res = await fetch("/api/stream/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.reservationExpiresAt && !user.isAdmin) {
          const timeToExpiry = data.reservationExpiresAt - Date.now();
          console.log(`[DiipMynd] Billing rebased. Expiry extended by ${timeToExpiry}ms.`);

          // Re-calculate countdown seconds
          const initialSeconds = Math.max(0, Math.floor(timeToExpiry / 1000));
          setCountdownSeconds(initialSeconds);

          // Re-arm the proactive timeout timer
          if (sessionExpiryTimeoutRef.current) {
            clearTimeout(sessionExpiryTimeoutRef.current);
          }
          sessionExpiryTimeoutRef.current = setTimeout(() => {
            console.log("[DiipMynd] Rebased credit expiry timer reached, stopping stream");
            handleStop();
            setError({
              code: "INSUFFICIENT_CREDITS" as any,
              message: "Stream session ended (credit reservation expired).",
            });
          }, Math.max(0, timeToExpiry));
        }
      } else {
        console.warn("[DiipMynd] Failed to notify server of connection status:", res.status);
      }
    } catch (err) {
      console.error("[DiipMynd] Error notifying connection signal:", err);
    }
  }, [user.isAdmin, handleStop]);

  // ── Decart SDK Connection Flow ────────────────────────────────────────
  const connectToDecart = useCallback(
    async (stream: MediaStream, decartToken: string, startSessionFn: () => Promise<void>) => {
      if (!isMountedRef.current || intentionalDisconnectRef.current) return;

      setConnectionState("connecting");
      intentionalDisconnectRef.current = false;

      const client = createDecartClient({ apiKey: decartToken });
      const model = models.realtime("lucy-2.5");

      const initialPrompt = referenceImageRef.current
        ? (currentPromptRef.current === DEFAULT_PROMPT ? IMAGE_TRANSFORM_PROMPT : currentPromptRef.current)
        : currentPromptRef.current;

      const initialState: Record<string, unknown> = {
        prompt: { text: initialPrompt, enhance: false },
      };

      if (referenceImageRef.current) {
        initialState.image = referenceImageRef.current;
      }

      const realtimeClient = await client.realtime.connect(stream, {
        model,
        onRemoteStream: (transformedStream: MediaStream) => {
          console.log("[DiipMynd] Decart remote stream received");
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = transformedStream;
          }
          beginSessionRecording(transformedStream);
        },
        initialState,
      });

      realtimeClientRef.current = realtimeClient;

      realtimeClient.on("connectionChange", (state: string) => {
        if (!isMountedRef.current) return;
        console.log("[DiipMynd] Decart connection state:", state);
        switch (state) {
          case "connected":
          case "generating":
            handleConnectionConnected();
            break;
          case "connecting":
            setConnectionState("connecting");
            break;
          case "reconnecting":
            setConnectionState("reconnecting");
            break;
          case "disconnected":
            if (!intentionalDisconnectRef.current) {
              scheduleReconnect(startSessionFn);
            }
            break;
        }
      });

      handleConnectionConnected();
    },
    [scheduleReconnect, beginSessionRecording, handleConnectionConnected]
  );

  // ── Fal.ai Manual WebRTC Connection Flow ──────────────────────────────
  const connectToFal = useCallback(
    async (stream: MediaStream, startSessionFn: () => Promise<void>) => {
      setConnectionState("connecting");
      intentionalDisconnectRef.current = false;

      const falModelName = "decart/lucy2-vton/realtime";

      let referenceImageUrl = "";
      if (referenceImageRef.current) {
        try {
          referenceImageUrl = await fal.storage.upload(referenceImageRef.current);
          referenceImageUrlRef.current = referenceImageUrl;
          console.log("[DiipMynd] Reference image uploaded to Fal:", referenceImageUrl);
        } catch (err) {
          console.error("[DiipMynd] Failed to upload reference image to Fal:", err);
        }
      } else {
        referenceImageUrlRef.current = "";
      }

      const initialPrompt = referenceImageUrl
        ? (currentPromptRef.current === DEFAULT_PROMPT ? IMAGE_TRANSFORM_PROMPT : currentPromptRef.current)
        : currentPromptRef.current;

      const connection = fal.realtime.connect(falModelName, {
        connectionKey: `session-${Date.now()}`,
        throttleInterval: 0,
        onResult: async (result: any) => {
          console.log("[DiipMynd] Fal realtime message:", result);
          if (result.type === "iceservers" || result.iceServers) {
            const iceServers = result.iceservers || result.iceServers;
            const pc = new RTCPeerConnection({ iceServers });
            falPeerConnectionRef.current = pc;

            pc.ontrack = (e) => {
              console.log("[DiipMynd] Remote track received:", e.streams);
              if (remoteVideoRef.current && e.streams[0]) {
                remoteVideoRef.current.srcObject = e.streams[0];
              }
              if (e.streams[0]) {
                beginSessionRecording(e.streams[0]);
              }
            };

            pc.onicecandidate = (e) => {
              if (e.candidate) {
                connection.send({
                  type: "candidate",
                  candidate: e.candidate.toJSON(),
                });
              }
            };

            pc.onconnectionstatechange = () => {
              if (!pc || !isMountedRef.current) return;
              console.log("[DiipMynd] PeerConnection state:", pc.connectionState);
              switch (pc.connectionState) {
                case "connected":
                  handleConnectionConnected();
                  break;
                case "connecting":
                  setConnectionState("connecting");
                  break;
                case "failed":
                case "disconnected":
                  if (!intentionalDisconnectRef.current) {
                    scheduleReconnect(startSessionFn);
                  }
                  break;
              }
            };

            stream.getTracks().forEach((track) => pc.addTrack(track, stream));

            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            const payload: any = {
              type: "offer",
              sdp: offer.sdp,
              prompt: initialPrompt,
            };
            if (referenceImageUrl) {
              payload.reference_image_url = referenceImageUrl;
            }
            connection.send(payload);
          } else if (result.type === "answer" || result.sdp) {
            const pc = falPeerConnectionRef.current;
            if (pc) {
              await pc.setRemoteDescription(
                new RTCSessionDescription({
                  type: "answer",
                  sdp: result.sdp,
                })
              );
            }
          } else if (result.type === "candidate" && result.candidate) {
            const pc = falPeerConnectionRef.current;
            if (pc) {
              await pc.addIceCandidate(new RTCIceCandidate(result.candidate));
            }
          }
        },
        onError: (err) => {
          console.error("[DiipMynd] Fal realtime connection error:", err);
          setError({
            code: "UNKNOWN",
            message: err.message || "Fal.ai stream connection error",
          });
          setConnectionState("error");
        },
      });

      falRealtimeConnectionRef.current = connection;
    },
    [scheduleReconnect, beginSessionRecording, handleConnectionConnected]
  );



  // ── Main Session Orchestrator (Smart Router entry point) ──────────────
  const startSession = useCallback(async () => {
    if (isStartingSessionRef.current) {
      console.warn("[DiipMynd] startSession already in progress, ignoring duplicate call.");
      return;
    }
    isStartingSessionRef.current = true;

    if (!user.isAdmin && creditsRef.current <= 0) {
      setError({
        code: "INSUFFICIENT_CREDITS" as any,
        message: "You have 0 credits. Please fund your account to start transformation.",
      });
      isStartingSessionRef.current = false;
      return;
    }

    setError(null);
    setDiagnosticsStats(null);
    intentionalDisconnectRef.current = false;

    try {
      const { provider, reason } = await selectProvider(providerPreference);
      setActiveProvider(provider);
      setRoutingReason(reason);
      activeProviderRef.current = provider;
      console.log(`[DiipMynd] Smart Router selected: ${provider} (${reason})`);

      setConnectionState("requesting-token");

      // End previous active session if we are reconnecting
      const oldSessionId = activeSessionIdRef.current;
      if (oldSessionId) {
        console.log(`[DiipMynd] Ending previous active session ${oldSessionId} before starting a new one`);
        activeSessionIdRef.current = null;
        try {
          await fetch("/api/stream/end", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId: oldSessionId }),
          });
          // Wait briefly for the DB transaction/release to commit
          await new Promise((resolve) => setTimeout(resolve, 1000));
        } catch (err) {
          console.warn("[DiipMynd] Failed to end previous session client-side:", err);
        }
      }

      let startRes = await fetch("/api/stream/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });

      // Parse the error body ONCE and reuse it. Never call startRes.json() twice
      // on the same Response object — a Response body can only be consumed once,
      // and doing so throws "body stream already read", which masks the real
      // server error (e.g. "Insufficient credits. Minimum 30 credits required.").
      let startErrData: { error?: string } | null = null;

      if (!startRes.ok) {
        const errBody = await startRes.json().catch(() => ({}));
        startErrData = errBody;
        const errMsg = errBody.error || "";

        // If constraint violation / race occurs (or temporary 500 error), retry once
        if (
          errMsg.includes("one_active_stream_per_user") ||
          errMsg.includes("active stream") ||
          errMsg.includes("duplicate key") ||
          startRes.status === 409 ||
          startRes.status === 500
        ) {
          console.warn("[DiipMynd] Conflict or server error detected on start session, retrying in 2 seconds...");
          setConnectionState("reconnecting");
          await new Promise((resolve) => setTimeout(resolve, 2000));

          startRes = await fetch("/api/stream/start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ provider }),
          });
          // Fresh response — read its body once too.
          startErrData = startRes.ok ? null : await startRes.json().catch(() => ({}));
        }
      }

      if (!startRes.ok) {
        throw new Error(
          (startErrData && startErrData.error) || "Failed to start session on the server."
        );
      }

      const startData = await startRes.json();

      activeSessionIdRef.current = startData.sessionId;

      // Proactively schedule session expiry timer based on startData.reservationExpiresAt
      if (startData.reservationExpiresAt && !user.isAdmin) {
        const timeToExpiry = startData.reservationExpiresAt - Date.now();
        console.log(`[DiipMynd] Proactively scheduling session end in ${timeToExpiry}ms based on credit reservation`);

        const initialSeconds = Math.max(0, Math.floor(timeToExpiry / 1000));
        setCountdownSeconds(initialSeconds);

        if (sessionExpiryTimeoutRef.current) {
          clearTimeout(sessionExpiryTimeoutRef.current);
        }
        sessionExpiryTimeoutRef.current = setTimeout(() => {
          console.log("[DiipMynd] Proactive credit expiry timer reached, stopping stream");
          handleStop();
          setError({
            code: "INSUFFICIENT_CREDITS" as any,
            message: "Stream session ended (credit reservation expired).",
          });
        }, Math.max(0, timeToExpiry));
      }

      const stream = localStreamRef.current || (await initCamera(provider));
      if (!isMountedRef.current || intentionalDisconnectRef.current) return;

      if (realtimeClientRef.current) {
        try { realtimeClientRef.current.disconnect(); } catch { }
        realtimeClientRef.current = null;
      }
      if (falRealtimeConnectionRef.current) {
        try { falRealtimeConnectionRef.current.close(); } catch { }
        falRealtimeConnectionRef.current = null;
      }
      if (falPeerConnectionRef.current) {
        try { falPeerConnectionRef.current.close(); } catch { }
        falPeerConnectionRef.current = null;
      }

      if (intentionalDisconnectRef.current) return;

      if (provider === "decart") {
        await connectToDecart(stream, startData.decartToken, startSession);
      } else {
        await connectToFal(stream, startSession);
      }
    } catch (err: unknown) {
      if (!isMountedRef.current || intentionalDisconnectRef.current) return;

      const streamError: StreamError = {
        code: "UNKNOWN",
        message: err instanceof Error ? err.message : "An unexpected error occurred.",
      };

      if (err && typeof err === "object" && "code" in err) {
        const typedErr = err as { code: string };
        if (typedErr.code === "CAMERA_DENIED" || typedErr.code === "CAMERA_NOT_FOUND") {
          streamError.code = typedErr.code;
        }
      }

      setError(streamError);
      setConnectionState("error");
    } finally {
      isStartingSessionRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initCamera, connectToDecart, connectToFal, providerPreference]);

  // ── Teardown on unmount ────────────────────────────────────────────────
  useEffect(() => {
    isMountedRef.current = true;
    const remoteVideo = remoteVideoRef.current;

    return () => {
      isMountedRef.current = false;
      intentionalDisconnectRef.current = true;
      clearReconnectTimer();
      disconnectRealtime();
      stopSessionRecording();
      stopLocalStream();

      if (streamIntervalRef.current) {
        clearInterval(streamIntervalRef.current);
      }
      if (remoteVideo) {
        remoteVideo.srcObject = null;
      }
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }
    };
  }, [clearReconnectTimer, disconnectRealtime, stopLocalStream, stopSessionRecording]);

  // ── Prompt updates pushed to the active session ───────────────────────
  const handlePromptChange = useCallback(async (prompt: string) => {
    setCurrentPrompt(prompt);
    currentPromptRef.current = prompt;

    if (realtimeClientRef.current) {
      try {
        if (referenceImageRef.current) {
          realtimeClientRef.current.set({
            prompt,
            enhance: false,
            image: referenceImageRef.current,
          });
        } else {
          realtimeClientRef.current.setPrompt(prompt);
        }
      } catch (err) {
        console.error("[DiipMynd] Failed to update Decart prompt:", err);
      }
    }

    if (falRealtimeConnectionRef.current) {
      const payload: any = { prompt };
      if (referenceImageUrlRef.current) {
        payload.reference_image_url = referenceImageUrlRef.current;
      }
      falRealtimeConnectionRef.current.send(payload);
    }
  }, []);

  // ── Reference image updates pushed to the active session ──────────────
  const handleImageChange = useCallback(async (image: File | null) => {
    referenceImageRef.current = image;

    if (activeProviderRef.current === "decart") {
      if (realtimeClientRef.current) {
        try {
          if (image) {
            const prompt = currentPromptRef.current === DEFAULT_PROMPT ? IMAGE_TRANSFORM_PROMPT : currentPromptRef.current;
            realtimeClientRef.current.set({
              prompt,
              enhance: false,
              image,
            });
          } else {
            realtimeClientRef.current.set({
              prompt: currentPromptRef.current,
              enhance: false,
              image: null,
            });
          }
        } catch (err) {
          console.error("[DiipMynd] Failed to update Decart reference image:", err);
        }
      }
    } else {
      if (image) {
        try {
          const url = await fal.storage.upload(image);
          referenceImageUrlRef.current = url;
          if (falRealtimeConnectionRef.current) {
            const prompt = currentPromptRef.current === DEFAULT_PROMPT ? IMAGE_TRANSFORM_PROMPT : currentPromptRef.current;
            falRealtimeConnectionRef.current.send({
              prompt,
              reference_image_url: url,
            });
          }
        } catch (err) {
          console.error("[DiipMynd] Failed to upload image to Fal storage:", err);
        }
      } else {
        referenceImageUrlRef.current = "";
        if (falRealtimeConnectionRef.current) {
          falRealtimeConnectionRef.current.send({
            prompt: currentPromptRef.current,
            reference_image_url: "",
          });
        }
      }
    }
  }, []);

  const toggleMicMute = useCallback(() => {
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks();
      audioTracks.forEach((track) => {
        track.enabled = !track.enabled;
      });
    }
    setIsMicMuted((prev) => !prev);
  }, []);

  // ── Stop session and connection handlers (Moved up to avoid block-scoping compile errors) ──

  // ── Tab visibility / page unload handlers ─────────────────────────────
  useEffect(() => {
    let visibilityTimeout: ReturnType<typeof setTimeout> | null = null;

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        // Start 30s grace period to end session if user remains backgrounded
        visibilityTimeout = setTimeout(() => {
          if (activeSessionIdRef.current) {
            console.log("[DiipMynd] Ending stream due to persistent background tab");
            handleStop();
            setError({
              code: "INSUFFICIENT_CREDITS" as any,
              message: "Stream stopped after being in the background for more than 30 seconds."
            });
          }
        }, 30000);
      } else {
        // User came back, clear the grace period timeout
        if (visibilityTimeout) {
          clearTimeout(visibilityTimeout);
          visibilityTimeout = null;
        }
      }
    };

    const handlePageHide = () => {
      const sessionId = activeSessionIdRef.current;
      if (sessionId) {
        console.log("[DiipMynd] Tab hiding/unloading, sending best-effort beacon for session:", sessionId);
        const blob = new Blob([JSON.stringify({ sessionId })], { type: "application/json" });
        navigator.sendBeacon("/api/stream/end", blob);

        // Clean up client-side connections and camera
        disconnectRealtime();
        stopLocalStream();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
      if (visibilityTimeout) {
        clearTimeout(visibilityTimeout);
      }
    };
  }, [handleStop, disconnectRealtime, stopLocalStream]);

  // ── Credit Heartbeat ──────────────────────────────────────────────────
  useEffect(() => {
    if (connectionState === "connected") {
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }

      heartbeatIntervalRef.current = setInterval(async () => {
        try {
          const res = await fetch("/api/stream/keepalive", { method: "POST" });
          if (res.status !== 200) {
            handleStop();
            setError({
              code: "INSUFFICIENT_CREDITS" as any,
              message: res.status === 410
                ? "Stream session ended (timeout or out of credits)."
                : `Stream session ended (server returned status ${res.status}).`,
            });
          } else {
            const data = await res.json();
            if (data.reservationExpiresAt && !user.isAdmin) {
              const timeToExpiry = new Date(data.reservationExpiresAt).getTime() - Date.now();
              const secondsLeft = Math.max(0, Math.floor(timeToExpiry / 1000));
              setCountdownSeconds(secondsLeft);
            }
          }
        } catch (err) {
          console.error("[keepalive] Failed to send ping:", err);
        }
      }, 30000);
    } else {
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }
    }

    return () => {
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }
    };
  }, [connectionState, handleStop, user.isAdmin]);

  // ── Local Credit Countdown Ticker Timer ────────────────────────────────
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    if (connectionState === "connected") {
      timer = setInterval(() => {
        setCountdownSeconds((prev) => {
          if (prev === null) return null;
          if (prev <= 1) {
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      setCountdownSeconds(null);
    }

    return () => {
      if (timer) {
        clearInterval(timer);
      }
    };
  }, [connectionState]);

  // ── Retry handler for error states ────────────────────────────────────
  const handleRetry = useCallback(() => {
    setRetryCount(0);
    setError(null);
    intentionalDisconnectRef.current = false;
    stopLocalStream();
    disconnectRealtime();

    if (streamIntervalRef.current) {
      clearInterval(streamIntervalRef.current);
      streamIntervalRef.current = null;
    }
    startSession();
  }, [stopLocalStream, disconnectRealtime, startSession]);

  // ── Picture-in-Picture Support and Events ──────────────────────────────
  useEffect(() => {
    setIsPiPSupported(
      typeof window !== "undefined" &&
      typeof document !== "undefined" &&
      "pictureInPictureEnabled" in document &&
      document.pictureInPictureEnabled
    );

    const video = remoteVideoRef.current;
    if (!video) return;

    const handleEnterPiP = () => setIsPoppedOut(true);
    const handleLeavePiP = () => setIsPoppedOut(false);

    video.addEventListener("enterpictureinpicture", handleEnterPiP);
    video.addEventListener("leavepictureinpicture", handleLeavePiP);

    return () => {
      video.removeEventListener("enterpictureinpicture", handleEnterPiP);
      video.removeEventListener("leavepictureinpicture", handleLeavePiP);
    };
  }, []);

  // ── Payment Verification Hook ─────────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    const reference = params.get("reference") || params.get("trxref");

    if (reference) {
      const newUrl = window.location.pathname;
      window.history.replaceState({}, document.title, newUrl);

      const verifyRef = async () => {
        try {
          const res = await fetch("/api/credits/verify-payment", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reference }),
          });
          const data = await res.json();
          if (data.success) {
            setShowPaymentSuccess(true);
            onBalanceUpdated();
            setTimeout(() => setShowPaymentSuccess(false), 6000);
          } else {
            setPaymentErrorMessage(data.message || "Payment verification failed or transaction was canceled.");
            setShowPaymentFailed(true);
            setTimeout(() => setShowPaymentFailed(false), 7000);
          }
        } catch (err) {
          console.error("Failed to verify payment reference:", err);
          setPaymentErrorMessage("A network error occurred while verifying your payment.");
          setShowPaymentFailed(true);
          setTimeout(() => setShowPaymentFailed(false), 7000);
        }
      };

      verifyRef();
    }
  }, [onBalanceUpdated]);

  const handlePopOut = useCallback(async () => {
    if (remoteVideoRef.current) {
      try {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
        } else {
          await remoteVideoRef.current.requestPictureInPicture();
        }
      } catch (err) {
        console.error("[DiipMynd] Picture-in-Picture error:", err);
      }
    }
  }, []);

  // ── Determine UI state ────────────────────────────────────────────────
  const isConnected = connectionState === "connected";
  const isLoading = ["requesting-token", "initializing-camera", "connecting", "reconnecting"].includes(connectionState);
  const showStartButton = (connectionState === "idle" || connectionState === "disconnected") && !isEnding;

  useEffect(() => {
    if (hasLocalStream && localVideoRef.current && localStreamRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }
  }, [hasLocalStream]);

  const isSessionActive = isConnected || isLoading || isEnding;

  return (
    <div className="relative flex flex-col w-full max-w-6xl mx-auto gap-5">
      {/* ── Payment Success Toast (monochrome with emerald accent only) ──── */}
      {showPaymentSuccess && (
        <div className="fixed top-6 right-6 z-50 p-4 rounded-xl glass-panel-strong max-w-sm animate-fade-in">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 w-5 h-5 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center flex-shrink-0">
              <CheckIcon className="w-2.5 h-2.5 text-emerald-400" />
            </div>
            <div className="flex-1">
              <p className="text-[12px] font-bold text-white">Payment Successful</p>
              <p className="text-[10px] text-neutral-500 mt-0.5 leading-relaxed">
                Your credits have been added. You can now start transforming your live stream.
              </p>
            </div>
            <button
              onClick={() => setShowPaymentSuccess(false)}
              className="text-neutral-600 hover:text-white transition-colors ml-auto"
            >
              <CloseIcon className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}

      {/* ── Payment Failure Toast (monochrome with red accent only) ──────── */}
      {showPaymentFailed && (
        <div className="fixed top-6 right-6 z-50 p-4 rounded-xl glass-panel-strong max-w-sm animate-fade-in">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 w-5 h-5 rounded-full bg-red-500/15 border border-red-500/30 flex items-center justify-center flex-shrink-0">
              <AlertIcon className="w-3 h-3 text-red-400" />
            </div>
            <div className="flex-1">
              <p className="text-[12px] font-bold text-white">Payment Unsuccessful</p>
              <p className="text-[10px] text-neutral-500 mt-0.5 leading-relaxed">
                {paymentErrorMessage || "The payment checkout session was canceled or could not be completed."}
              </p>
            </div>
            <button
              onClick={() => setShowPaymentFailed(false)}
              className="text-neutral-600 hover:text-white transition-colors ml-auto"
            >
              <CloseIcon className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}

      {/* ── Header Bar — Stream Status ──────────────────────────────────── */}
      <div className="flex items-center justify-between w-full pb-3 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold text-neutral-600 uppercase tracking-[0.18em]">
            Stream Status
          </span>
        </div>
        <ConnectionStatus state={connectionState} retryCount={retryCount} />
      </div>

      {/* ── Active Provider Badge (monochrome) ─────────────────────────── */}
      {activeProvider && isConnected && (
        <div className="flex items-center gap-2 -mt-2">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wider uppercase bg-white/[0.06] text-neutral-200 border border-white/[0.1]">
            <span className="live-dot animate-blink" />
            {activeProvider === "decart" ? (
              <BoltMiniIcon className="w-3 h-3 text-amber-300" />
            ) : (
              <GlobeIcon className="w-3 h-3 text-cyan-300" />
            )}
            {activeProvider === "decart" ? "Decart" : "Fal.ai"}
          </div>
          {countdownSeconds !== null && !user.isAdmin && (
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wider uppercase bg-white/[0.06] text-amber-400 border border-white/[0.1]">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              Time Remaining: {formatTime(countdownSeconds)}
            </div>
          )}
          {routingReason && (
            <span className="text-[10px] text-neutral-600 font-medium">{routingReason}</span>
          )}
        </div>
      )}

      {/* ── Main Layout Grid ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-5 w-full items-start">
        {/* Left Column: Video Area, Original Camera, & Errors */}
        <div className="md:col-span-7 flex flex-col gap-4 w-full">
          {/* AI-transformed video container — glass panel with shine sweep on hover */}
          <div className="fx-hover-shine-card glass-panel relative w-full aspect-video !min-h-0 !cursor-default">
            {/* Remote (AI-transformed) video — fills the container */}
            <video
              ref={remoteVideoRef}
              id="video-output"
              autoPlay
              playsInline
              muted={false}
              className={`
                absolute inset-0 w-full h-full object-cover
                transition-opacity duration-700
                ${isConnected ? "opacity-100" : "opacity-0"}
              `}
            />

            {/* Loading overlay — page-flip book loader */}
            {isLoading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 z-10 bg-black/50 backdrop-blur-sm">
                <div className="fx-loader-book">
                  <div className="fx-loader-book-page" />
                  <div className="fx-loader-book-page" />
                  <div className="fx-loader-book-page" />
                  <div className="fx-loader-book-page" />
                </div>
                <p className="text-[13px] text-neutral-300 font-medium tracking-wide animate-pulse">
                  {connectionState === "requesting-token" && "Authenticating…"}
                  {connectionState === "initializing-camera" && "Starting camera…"}
                  {connectionState === "connecting" && "Establishing WebRTC connection…"}
                  {connectionState === "reconnecting" && `Reconnecting (attempt ${retryCount})…`}
                </p>
              </div>
            )}

            {/* Idle / disconnected placeholder */}
            {(connectionState === "idle" || connectionState === "disconnected") && !error && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 z-10 bg-black/40 backdrop-blur-sm">
                <div className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center shadow-md">
                  {isEnding ? (
                    <div className="relative w-7 h-7 flex items-center justify-center">
                      <div className="absolute inset-0 rounded-full border-2 border-red-500/10 border-t-red-500 animate-spin" />
                    </div>
                  ) : (
                    <VideoCamIcon className="w-7 h-7 text-red-300" />
                  )}
                </div>
                <p className="text-[13px] text-neutral-500 font-medium">
                  {isEnding ? "Stopping transformation..." : "Press Start to begin your transformation"}
                </p>
              </div>
            )}

            {/* Pop-out placeholder */}
            {isPoppedOut && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10 bg-black/90 backdrop-blur-sm">
                <div className="w-14 h-14 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center shadow-md animate-pulse">
                  <PiPIcon className="w-6 h-6 text-neutral-300" />
                </div>
                <div className="text-center">
                  <p className="text-[13px] text-white font-bold">Avatar Popped Out</p>
                  <p className="text-[11px] text-neutral-500 mt-1 max-w-xs">
                    AI stream is active in a floating picture-in-picture window.
                  </p>
                </div>
                <button
                  onClick={handlePopOut}
                  className="px-3.5 py-1.5 text-[11px] font-bold text-black bg-white hover:bg-neutral-200 rounded-lg shadow-md active:scale-95 transition-all cursor-pointer"
                >
                  Return to Page
                </button>
              </div>
            )}

            {/* Pop-Out Button */}
            {isConnected && !isPoppedOut && isPiPSupported && (
              <button
                onClick={handlePopOut}
                className="absolute top-4 right-4 p-2 rounded-xl bg-black/60 hover:bg-black/80 text-neutral-300 hover:text-white border border-white/[0.08] hover:border-white/[0.14] backdrop-blur-md active:scale-95 transition-all z-20 cursor-pointer shadow-md"
                title="Pop out video (Picture-in-Picture)"
              >
                <PopOutIcon className="w-4 h-4 text-cyan-300" />
              </button>
            )}

            {/* Diagnostics Overlay */}
            {!isPoppedOut && <DiagnosticsOverlay stats={diagnosticsStats} isConnected={isConnected} />}
          </div>

          {/* Original Camera Card — glass panel */}
          {hasLocalStream && (
            <div className="fx-hover-shine-card glass-panel !min-h-0 !cursor-default flex items-center gap-4 p-3.5">
              <div className="relative w-36 aspect-video rounded-lg overflow-hidden border border-white/[0.06] bg-black shadow-inner flex-shrink-0">
                <video
                  ref={localVideoRef}
                  id="video-local"
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                  style={{ transform: "scaleX(-1)" }}
                />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] text-neutral-200 font-bold tracking-wide">Your Camera Feed</p>
                <p className="text-[10px] text-neutral-600 mt-0.5 truncate leading-relaxed">
                  This original camera view is separated. Only the AI feed above can be popped out.
                </p>
              </div>
            </div>
          )}

          {/* Error Display — monochrome with red accent */}
          {error && (
            <div className="w-full p-4 rounded-xl glass-panel">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 w-5 h-5 rounded-full bg-red-500/15 border border-red-500/30 flex items-center justify-center flex-shrink-0">
                  <span className="text-red-400 text-[10px] font-bold">!</span>
                </div>
                <div className="flex-1">
                  <p className="text-[13px] text-neutral-100 font-bold">{error.message}</p>
                  {error.code === "CAMERA_DENIED" && (
                    <p className="text-[11px] text-neutral-500 mt-1 leading-relaxed">
                      Please allow camera access in your browser settings and try again.
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {(error.message.toLowerCase().includes("credit") || error.code === ("INSUFFICIENT_CREDITS" as any)) && (
                    <button
                      onClick={() => setIsTopUpOpen(true)}
                      className="px-3 py-1.5 text-[11px] font-bold text-black bg-white hover:bg-neutral-200 rounded-lg transition-all active:scale-95 cursor-pointer shadow-sm flex items-center gap-1.5"
                    >
                      <CardIcon className="w-3 h-3 text-amber-600" />
                      Get Credits
                    </button>
                  )}
                  <button
                    onClick={handleRetry}
                    className="px-3 py-1.5 text-[11px] font-bold text-neutral-200 bg-white/[0.05] hover:bg-white/[0.1] rounded-lg border border-white/[0.08] hover:border-white/[0.14] transition-colors cursor-pointer"
                  >
                    Retry
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Controls Panel — glass panel */}
        <div className="md:col-span-5 w-full flex flex-col gap-4 p-5 rounded-2xl glass-panel">
          {/* Provider Selector — monochrome segmented control */}

          <div className="flex flex-col gap-2">
            <label className="text-[10px] text-neutral-600 font-semibold tracking-[0.18em] uppercase">
              AI Provider
            </label>
            <div className="flex items-center gap-1.5 p-1 rounded-xl bg-white/[0.025] border border-white/[0.06]">
              {(["auto", "decart", "fal"] as ProviderPreference[]).map((pref) => {
                const isActive = providerPreference === pref;
                const Icon = pref === "auto" ? ShuffleIcon : pref === "decart" ? BoltMiniIcon : GlobeIcon;
                return (
                  <button
                    key={pref}
                    onClick={() => setProviderPreference(pref)}
                    disabled={isSessionActive}
                    className={`
                        flex-1 px-3 py-2 rounded-lg text-[11px] font-bold tracking-wide uppercase
                        transition-all duration-200 cursor-pointer flex items-center justify-center gap-1.5
                        ${isActive
                        ? "bg-white text-black shadow-md"
                        : "text-neutral-500 hover:text-neutral-200 hover:bg-white/[0.04]"
                      }
                        disabled:opacity-40 disabled:cursor-not-allowed
                      `}
                  >
                    <Icon className={`w-3 h-3 ${isActive ? "text-black" : pref === "auto" ? "text-violet-300" : pref === "decart" ? "text-amber-300" : "text-cyan-300"}`} />
                    {pref === "auto" ? "Auto" : pref === "decart" ? "Decart" : "Fal.ai"}
                  </button>
                );
              })}
            </div>
            {providerPreference === "auto" && !isSessionActive && (
              <p className="text-[10px] text-neutral-600 font-medium leading-relaxed">
                Smart Router probes latency and picks the fastest provider.
              </p>
            )}
          </div>


          {/* Prompt input */}
          <PromptInput
            onPromptChange={handlePromptChange}
            disabled={false}
          />

          {/* Reference image upload */}
          <ReferenceImageUpload
            onImageChange={handleImageChange}
            disabled={false}
          />

          {showStartButton && (
            <p className="text-[11px] text-white/40 text-center mb-2">
              Sessions may be recorded for quality and safety purposes.
            </p>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-3">
            {showStartButton && (
              <>
                <button
                  id="btn-start"
                  onClick={startSession}
                  className="
                    flex-1 py-3 rounded-xl font-bold text-[13px] tracking-wide
                    bg-white text-black shadow-lg
                    hover:bg-neutral-200 hover:shadow-xl hover:shadow-white/10
                    active:scale-[0.98] cursor-pointer
                    transition-all duration-200
                    flex items-center justify-center gap-2
                  "
                >
                  <PlayIcon className="w-4 h-4 text-emerald-600" />
                  Start Transformation
                </button>
                <button
                  onClick={() => setIsMicEnabled((prev) => !prev)}
                  className={`
                    p-3 rounded-xl border transition-all duration-200 active:scale-[0.98] cursor-pointer
                    ${isMicEnabled
                      ? "bg-white/[0.08] border-white/[0.14] text-white hover:bg-white/[0.12]"
                      : "bg-white/[0.025] border-white/[0.06] text-neutral-500 hover:bg-white/[0.05] hover:text-neutral-300"
                    }
                  `}
                  title={isMicEnabled ? "Microphone Enabled" : "Microphone Disabled"}
                >
                  {isMicEnabled ? <MicIcon className="w-4 h-4 text-blue-300" /> : <MicOffIcon className="w-4 h-4" />}
                </button>
              </>
            )}

            {(isConnected || isLoading) && (
              <>
                <button
                  id="btn-stop"
                  onClick={handleStop}
                  className="
                    flex-1 py-3 rounded-xl font-bold text-[13px] tracking-wide
                    bg-white/[0.05] border border-white/[0.08] text-neutral-200
                    hover:bg-white/[0.1] hover:border-white/[0.14] hover:text-white
                    active:scale-[0.98] cursor-pointer
                    transition-all duration-200
                    flex items-center justify-center gap-2
                  "
                >
                  <StopIcon className="w-4 h-4 text-red-400" />
                  Stop
                </button>
                {isMicEnabled && (
                  <button
                    onClick={toggleMicMute}
                    className={`
                      p-3 rounded-xl border transition-all duration-200 active:scale-[0.98] cursor-pointer
                      ${!isMicMuted
                        ? "bg-white/[0.08] border-white/[0.14] text-white hover:bg-white/[0.12]"
                        : "bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/15"
                      }
                    `}
                    title={isMicMuted ? "Unmute Mic" : "Mute Mic"}
                  >
                    {isMicMuted ? <MicOffIcon className="w-4 h-4" /> : <MicIcon className="w-4 h-4 text-blue-300" />}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Admin Panel Modal Overlay */}
      {isAdminPanelOpen && (
        <AdminPanel
          currentUserId={user.id}
          onClose={() => setIsAdminPanelOpen(false)}
          onBalanceUpdated={onBalanceUpdated}
        />
      )}

      {/* Top Up Modal Overlay */}
      {isTopUpOpen && (
        <TopUpModal
          userEmail={user.email}
          onClose={() => setIsTopUpOpen(false)}
          onBalanceUpdated={onBalanceUpdated}
        />
      )}
    </div>
  );
}
