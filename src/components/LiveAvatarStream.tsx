// ============================================================================
// DiipMynd — LiveAvatarStream Component
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
import AdminPanel from "./AdminPanel";
import TopUpModal from "./TopUpModal";

// ── Constants ──────────────────────────────────────────────────────────────
const MAX_RECONNECT_ATTEMPTS = 5;
const BASE_RECONNECT_DELAY_MS = 2000;

// Default prompt: highly specific to prevent hallucinations.
// Vague prompts like "keep the person as they are" give the model too much
// creative freedom, causing it to generate phantom limbs and style drift.
const DEFAULT_PROMPT =
  "Preserve the person exactly as they are. No changes to face, body, clothing, or background. Natural lighting, photorealistic. Do not add, remove, or modify any body parts.";

// When a reference image is active, this prompt guides the AI to match it
const IMAGE_TRANSFORM_PROMPT =
  "Transform the person to look exactly like the person in the reference image. Match their face, hairstyle, skin tone, and overall appearance as closely as possible while preserving the user's expressions and head movements. Do not add extra limbs or body parts.";

interface LiveAvatarStreamProps {
  user: SafeUser;
  onLogout: () => void;
  onBalanceUpdated: () => void;
  theme: "light" | "dark";
  toggleTheme: () => void;
}

export default function LiveAvatarStream({ user, onLogout, onBalanceUpdated, theme, toggleTheme }: LiveAvatarStreamProps) {
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

  // Hybrid local accelerator states
  const [hasLocalAccelerator, setHasLocalAccelerator] = useState(false);
  const [useLocalMode, setUseLocalMode] = useState(false);
  const [localResolution, setLocalResolution] = useState(512);

  // ── Smart Router State ───────────────────────────────────────────────
  const [providerPreference, setProviderPreference] = useState<ProviderPreference>("auto");
  const [activeProvider, setActiveProvider] = useState<Provider | null>(null);
  const [routingReason, setRoutingReason] = useState<string>("");
  const [showPaymentSuccess, setShowPaymentSuccess] = useState(false);
  const [showPaymentFailed, setShowPaymentFailed] = useState(false);
  const [paymentErrorMessage, setPaymentErrorMessage] = useState("");

  // ── Refs ───────────────────────────────────────────────────────────────
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  // Decart SDK refs
  const realtimeClientRef = useRef<RealTimeClient | null>(null);
  // Fal.ai manual WebRTC refs
  const falRealtimeConnectionRef = useRef<any>(null);
  const falPeerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const referenceImageUrlRef = useRef<string>("");
  const localStreamRef = useRef<MediaStream | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localWsRef = useRef<WebSocket | null>(null);
  const streamIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef(true);
  // Guard against the reconnect loop: track whether WE initiated the disconnect
  const intentionalDisconnectRef = useRef(false);
  // Store the latest prompt in a ref so the connect callback always has the latest value
  const currentPromptRef = useRef(DEFAULT_PROMPT);
  // Track the active reference image for the AI transformation
  const referenceImageRef = useRef<File | null>(null);
  const creditsRef = useRef(user.credits);
  // Track which provider is active in refs for use in callbacks
  const activeProviderRef = useRef<Provider | null>(null);

  // Keep creditsRef and credits state synchronized with user prop
  useEffect(() => {
    setCredits(user.credits);
  }, [user.credits]);

  useEffect(() => {
    creditsRef.current = credits;
  }, [credits]);

  // Keep activeProviderRef in sync
  useEffect(() => {
    activeProviderRef.current = activeProvider;
  }, [activeProvider]);

  // Check local companion status on mount and periodically
  const checkLocalAccelerator = async () => {
    try {
      const res = await fetch("http://localhost:8000/status");
      const data = await res.json();
      if (data.status === "ready") {
        setHasLocalAccelerator(true);
        if (data.recommended_resolution) {
          setLocalResolution(data.recommended_resolution);
        }
      } else {
        setHasLocalAccelerator(false);
      }
    } catch {
      setHasLocalAccelerator(false);
    }
  };

  useEffect(() => {
    checkLocalAccelerator();
    const interval = setInterval(checkLocalAccelerator, 3000);
    return () => clearInterval(interval);
  }, []);

  // Detect Paystack checkout success redirect parameter
  useEffect(() => {
    if (typeof window !== "undefined") {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get("payment") === "success") {
        setShowPaymentSuccess(true);
        // Clear the query parameters from the URL history
        const newUrl = window.location.pathname;
        window.history.replaceState({}, document.title, newUrl);
        // Auto-dismiss the toast after 6 seconds
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

  const disconnectRealtime = useCallback(() => {
    intentionalDisconnectRef.current = true; // prevent reconnect loop

    // Decart SDK cleanup
    if (realtimeClientRef.current) {
      try {
        realtimeClientRef.current.disconnect();
      } catch (err) {
        console.warn("[DiipMynd] Error disconnecting Decart client:", err);
      }
      realtimeClientRef.current = null;
    }

    // Fal.ai cleanup
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
      // If exact constraints fail, fall back to ideal
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
      // Don't reconnect if we intentionally disconnected
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

        // Exponential backoff: 2s, 4s, 8s, 16s, 32s
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

  // ── Decart SDK Connection Flow ────────────────────────────────────────
  const connectToDecart = useCallback(
    async (stream: MediaStream, startSessionFn: () => Promise<void>) => {
      setConnectionState("requesting-token");

      // 1. Fetch ephemeral token from our backend
      const tokenRes = await fetch("/api/decart-auth", { method: "POST" });
      if (!tokenRes.ok) {
        const body = await tokenRes.json().catch(() => ({ error: "Unknown server error" }));
        throw new Error(body.error || `Token endpoint returned ${tokenRes.status}`);
      }
      const tokenData: DecartAuthResponse = await tokenRes.json();

      if (!isMountedRef.current || intentionalDisconnectRef.current) return;

      setConnectionState("connecting");
      intentionalDisconnectRef.current = false;

      // 2. Initialize the Decart client with the ephemeral token
      const client = createDecartClient({ apiKey: tokenData.apiKey });
      const model = models.realtime("lucy-2.1");

      // 3. Determine initial state with prompt and optional reference image
      const initialPrompt = referenceImageRef.current
        ? (currentPromptRef.current === DEFAULT_PROMPT ? IMAGE_TRANSFORM_PROMPT : currentPromptRef.current)
        : currentPromptRef.current;

      const initialState: Record<string, unknown> = {
        prompt: { text: initialPrompt, enhance: false },
      };

      if (referenceImageRef.current) {
        initialState.image = referenceImageRef.current;
      }

      // 4. Connect — the SDK manages WebRTC internally
      const realtimeClient = await client.realtime.connect(stream, {
        model,
        onRemoteStream: (transformedStream: MediaStream) => {
          console.log("[DiipMynd] Decart remote stream received");
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = transformedStream;
          }
        },
        initialState,
      });

      realtimeClientRef.current = realtimeClient;

      // 5. Listen for connection state changes
      realtimeClient.on("connectionChange", (state: string) => {
        if (!isMountedRef.current) return;
        console.log("[DiipMynd] Decart connection state:", state);
        switch (state) {
          case "connected":
          case "generating":
            setConnectionState("connected");
            setRetryCount(0);
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

      // If we're already connected at this point, set state
      setConnectionState("connected");
      setRetryCount(0);
    },
    [scheduleReconnect]
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
                  setConnectionState("connected");
                  setRetryCount(0);
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
    [scheduleReconnect]
  );

  // ── Local Session Orchestrator ─────────────────────────────────────────
  const startLocalSession = useCallback(async () => {
    setError(null);
    setDiagnosticsStats(null);
    intentionalDisconnectRef.current = false;

    try {
      setConnectionState("initializing-camera");
      const stream = localStreamRef.current || (await initCamera("decart"));
      if (!isMountedRef.current || intentionalDisconnectRef.current) return;

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      setConnectionState("connecting");

      const ws = new WebSocket("ws://localhost:8000/stream");
      ws.binaryType = "blob";

      const canvas = document.createElement("canvas");
      canvas.width = localResolution;
      canvas.height = localResolution;
      const ctx = canvas.getContext("2d");

      // Offscreen canvas for rendering swapped frames to stream into video
      const renderCanvas = document.createElement("canvas");
      renderCanvas.width = localResolution;
      renderCanvas.height = localResolution;
      const renderCtx = renderCanvas.getContext("2d");

      if (remoteVideoRef.current) {
        // Capture stream from render canvas at 30 fps
        const canvasStream = (renderCanvas as any).captureStream 
          ? (renderCanvas as any).captureStream(30) 
          : (renderCanvas as any).mozCaptureStream(30);
        remoteVideoRef.current.srcObject = canvasStream;
        remoteVideoRef.current.play().catch(() => {});
      }

      // request-response (ping-pong) frame sending to prevent websocket queue congestion
      const sendNextFrame = () => {
        const video = localVideoRef.current;
        if (video && ctx && ws.readyState === WebSocket.OPEN) {
          const videoWidth = video.videoWidth;
          const videoHeight = video.videoHeight;
          if (videoWidth && videoHeight) {
            // Center-crop video to square 1:1 aspect ratio to avoid squishing
            const size = Math.min(videoWidth, videoHeight);
            const sx = (videoWidth - size) / 2;
            const sy = (videoHeight - size) / 2;
            ctx.drawImage(video, sx, sy, size, size, 0, 0, canvas.width, canvas.height);
          } else {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          }
          
          canvas.toBlob(
            (blob) => {
              if (blob && ws.readyState === WebSocket.OPEN) {
                ws.send(blob);
              }
            },
            "image/jpeg",
            0.85
          );
        }
      };

      ws.onopen = () => {
        if (!isMountedRef.current || intentionalDisconnectRef.current) {
          ws.close();
          return;
        }
        setConnectionState("connected");
        setRetryCount(0);

        // Upload reference image if one exists
        if (referenceImageRef.current) {
          handleImageChange(referenceImageRef.current);
        }

        // Kick off the frame loop
        sendNextFrame();
      };

      ws.onmessage = async (event) => {
        if (!isMountedRef.current) return;
        const blob = event.data;
        const url = URL.createObjectURL(blob);

        const img = new Image();
        img.onload = () => {
          if (renderCtx) {
            renderCtx.drawImage(img, 0, 0, renderCanvas.width, renderCanvas.height);
          }
          URL.revokeObjectURL(url);

          // Trigger next frame request inside onload to keep the frame loop synchronized
          if (!intentionalDisconnectRef.current && ws.readyState === WebSocket.OPEN) {
            requestAnimationFrame(sendNextFrame);
          }
        };
        img.src = url;
      };

      ws.onerror = (err) => {
        console.error("[companion] WebSocket error:", err);
      };

      ws.onclose = () => {
        if (streamIntervalRef.current) {
          clearInterval(streamIntervalRef.current);
          streamIntervalRef.current = null;
        }
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = null;
        }
        if (!intentionalDisconnectRef.current && isMountedRef.current) {
          setConnectionState("disconnected");
          setError({
            code: "CONNECTION_FAILED",
            message: "Lost connection to local DiipMynd GPU engine.",
          });
        }
      };

      localWsRef.current = ws;
    } catch (err: unknown) {
      if (!isMountedRef.current || intentionalDisconnectRef.current) return;
      setError({
        code: "UNKNOWN",
        message: err instanceof Error ? err.message : "Failed to connect to local accelerator.",
      });
      setConnectionState("error");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initCamera]);

  // ── Main Session Orchestrator (Smart Router entry point) ──────────────
  const startSession = useCallback(async () => {
    // Check credits for non-admin users before starting any session
    if (!user.isAdmin && creditsRef.current <= 0) {
      setError({
        code: "INSUFFICIENT_CREDITS" as any,
        message: "You have 0 credits. Please fund your account to start transformation.",
      });
      return;
    }

    // Local mode bypasses cloud providers entirely
    if (useLocalMode) {
      setActiveProvider(null);
      setRoutingReason("Local GPU Engine");
      await startLocalSession();
      return;
    }

    setError(null);
    setDiagnosticsStats(null);
    intentionalDisconnectRef.current = false;

    try {
      // ── Step 1: Smart Router — select the optimal provider ─────────
      const { provider, reason } = await selectProvider(providerPreference);
      setActiveProvider(provider);
      setRoutingReason(reason);
      activeProviderRef.current = provider;
      console.log(`[DiipMynd] Smart Router selected: ${provider} (${reason})`);

      // ── Step 2: Get camera stream (reuse if already active) ────────
      const stream = localStreamRef.current || (await initCamera(provider));
      if (!isMountedRef.current || intentionalDisconnectRef.current) return;

      // ── Step 3: Cleanup any stale connections ──────────────────────
      if (realtimeClientRef.current) {
        try { realtimeClientRef.current.disconnect(); } catch {}
        realtimeClientRef.current = null;
      }
      if (falRealtimeConnectionRef.current) {
        try { falRealtimeConnectionRef.current.close(); } catch {}
        falRealtimeConnectionRef.current = null;
      }
      if (falPeerConnectionRef.current) {
        try { falPeerConnectionRef.current.close(); } catch {}
        falPeerConnectionRef.current = null;
      }

      // Final check before the most expensive operation
      if (intentionalDisconnectRef.current) return;

      // ── Step 4: Connect to the selected provider ───────────────────
      if (provider === "decart") {
        await connectToDecart(stream, startSession);
      } else {
        await connectToFal(stream, startSession);
      }
    } catch (err: unknown) {
      // Don't show errors if user deliberately stopped during an inflight request
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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initCamera, connectToDecart, connectToFal, useLocalMode, startLocalSession, providerPreference]);

  // ── Teardown on unmount ────────────────────────────────────────────────
  useEffect(() => {
    isMountedRef.current = true;
    const remoteVideo = remoteVideoRef.current;

    return () => {
      isMountedRef.current = false;
      intentionalDisconnectRef.current = true;
      clearReconnectTimer();
      disconnectRealtime();
      stopLocalStream();
      if (localWsRef.current) {
        localWsRef.current.close();
      }
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
  }, [clearReconnectTimer, disconnectRealtime, stopLocalStream]);

  // ── Prompt updates pushed to the active session ───────────────────────
  const handlePromptChange = useCallback(async (prompt: string) => {
    setCurrentPrompt(prompt);
    currentPromptRef.current = prompt;

    // Decart SDK path
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

    // Fal.ai path
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

    if (useLocalMode) {
      // Local companion path
      if (image) {
        const formData = new FormData();
        formData.append("file", image);
        try {
          const res = await fetch("http://localhost:8000/upload-face", {
            method: "POST",
            body: formData,
          });
          const data = await res.json();
          if (data.error) {
            console.error("[DiipMynd] Upload face error:", data.error);
          } else {
            console.log("[DiipMynd] Reference face uploaded successfully to local engine");
          }
        } catch (err) {
          console.error("[DiipMynd] Failed to upload face to local engine:", err);
        }
      }
    } else if (activeProviderRef.current === "decart") {
      // Decart SDK path — use set() with the image file directly
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
      // Fal.ai path — upload to Fal storage then send URL
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
  }, [useLocalMode]);

  // Trigger local face upload if we toggle to local mode with an existing image
  useEffect(() => {
    if (useLocalMode && referenceImageRef.current) {
      handleImageChange(referenceImageRef.current);
    }
  }, [useLocalMode, handleImageChange]);

  const toggleMicMute = useCallback(() => {
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks();
      audioTracks.forEach((track) => {
        track.enabled = !track.enabled;
      });
    }
    setIsMicMuted((prev) => !prev);
  }, []);

  // ── Stop session handler ──────────────────────────────────────────────
  const handleStop = useCallback(() => {
    intentionalDisconnectRef.current = true;
    clearReconnectTimer();
    disconnectRealtime();

    if (localWsRef.current) {
      localWsRef.current.close();
      localWsRef.current = null;
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

    // Clear heartbeat interval
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
  }, [clearReconnectTimer, disconnectRealtime, stopLocalStream]);

  // ── Credit Heartbeat ──────────────────────────────────────────────────
  useEffect(() => {
    if (connectionState === "connected") {
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }
      
      heartbeatIntervalRef.current = setInterval(async () => {
        try {
          const res = await fetch("/api/credits/heartbeat", { method: "POST" });
          const data = await res.json();
          if (data.success) {
            setCredits(data.credits);
            onBalanceUpdated();
          } else {
            // Out of credits!
            handleStop();
            setError({
              code: "INSUFFICIENT_CREDITS" as any,
              message: data.error || "You have run out of credits. Please fund your account.",
            });
          }
        } catch (err) {
          console.error("[heartbeat] Failed to send heartbeat:", err);
        }
      }, 10000); // 10 seconds
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
  }, [connectionState, onBalanceUpdated, handleStop]);

  // ── Retry handler for error states ────────────────────────────────────
  const handleRetry = useCallback(() => {
    setRetryCount(0);
    setError(null);
    intentionalDisconnectRef.current = false;
    stopLocalStream();
    disconnectRealtime();
    if (localWsRef.current) {
      localWsRef.current.close();
      localWsRef.current = null;
    }
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
      // Clear URL parameters immediately so page refreshes don't re-trigger verification
      const newUrl = window.location.pathname;
      window.history.replaceState({}, document.title, newUrl);

      const verifyRef = async () => {
        try {
          const res = await fetch(`/api/credits/verify-payment?reference=${encodeURIComponent(reference)}`);
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
  const showStartButton = connectionState === "idle" || connectionState === "disconnected";

  // Bind srcObject when the local video element mounts (after hasLocalStream triggers render)
  useEffect(() => {
    if (hasLocalStream && localVideoRef.current && localStreamRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }
  }, [hasLocalStream]);

  // Provider preference is disabled while a session is active
  const isSessionActive = isConnected || isLoading;

  return (
    <div className="relative flex flex-col w-full max-w-6xl mx-auto gap-6">
      {/* ── Payment Success Toast ────────────────────────────────────── */}
      {showPaymentSuccess && (
        <div className="fixed top-6 right-6 z-50 p-4 rounded-2xl bg-emerald-50 border border-emerald-100 text-emerald-800 shadow-lg backdrop-blur-md max-w-sm animate-fadeIn">
          <div className="flex items-start gap-3">
            <div className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
              <span className="text-emerald-600 text-xs font-bold">✓</span>
            </div>
            <div className="flex-1">
              <p className="text-xs font-bold text-slate-900">Payment Successful!</p>
              <p className="text-[10px] text-slate-600 mt-0.5 leading-relaxed">
                Your credits have been added successfully. You can now start transforming your live stream!
              </p>
            </div>
            <button
              onClick={() => setShowPaymentSuccess(false)}
              className="text-slate-400 hover:text-slate-600 text-xs cursor-pointer ml-auto"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* ── Payment Failure Toast ────────────────────────────────────── */}
      {showPaymentFailed && (
        <div className="fixed top-6 right-6 z-50 p-4 rounded-2xl bg-rose-50 border border-rose-100 text-rose-800 shadow-lg backdrop-blur-md max-w-sm animate-fadeIn">
          <div className="flex items-start gap-3">
            <div className="w-5 h-5 rounded-full bg-rose-100 flex items-center justify-center flex-shrink-0">
              <span className="text-rose-600 text-xs font-bold">!</span>
            </div>
            <div className="flex-1">
              <p className="text-xs font-bold text-slate-900">Payment Unsuccessful</p>
              <p className="text-[10px] text-slate-600 mt-0.5 leading-relaxed">
                {paymentErrorMessage || "The payment checkout session was canceled or could not be completed."}
              </p>
            </div>
            <button
              onClick={() => setShowPaymentFailed(false)}
              className="text-slate-400 hover:text-slate-600 text-xs cursor-pointer ml-auto"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* ── Header Bar ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between w-full">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
            DiipMynd
          </h1>
          <span className="text-xs text-slate-400 dark:text-slate-555 dark:text-slate-500 font-semibold tracking-wider uppercase">
            Real-time AI
          </span>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl px-4 py-2 text-xs shadow-sm transition-colors duration-200">
            <div className="flex flex-col text-right">
              <span className="text-slate-500 dark:text-slate-400 font-medium truncate max-w-[150px]" title={user.email}>{user.email}</span>
              <span className="text-indigo-600 dark:text-indigo-400 font-extrabold tabular-nums">{credits} credits</span>
            </div>
            <button
              onClick={() => setIsTopUpOpen(true)}
              className="px-2.5 py-1 text-[10px] font-bold text-emerald-700 bg-emerald-100 hover:bg-emerald-200 dark:text-emerald-355 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/50 rounded-lg transition-colors cursor-pointer"
            >
              💳 Top Up
            </button>
            {user.isAdmin && (
              <button
                onClick={() => setIsAdminPanelOpen(true)}
                className="px-2.5 py-1 text-[10px] font-bold text-indigo-700 bg-indigo-100 hover:bg-indigo-200 dark:text-indigo-355 dark:bg-indigo-950/40 dark:hover:bg-indigo-900/50 rounded-lg transition-colors cursor-pointer"
              >
                🛡️ Dev Admin
              </button>
            )}
            {/* Theme Toggle Button */}
            <button
              onClick={toggleTheme}
              className="p-1 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 transition-colors cursor-pointer"
              title={theme === "light" ? "Switch to Dark Mode" : "Switch to Light Mode"}
            >
              {theme === "light" ? "🌙" : "☀️"}
            </button>
            {/* Log Out Button */}
            <button
              onClick={onLogout}
              className="p-1 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 transition-colors cursor-pointer"
              title="Log Out"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
          {hasLocalAccelerator ? (
            <button
              onClick={() => setUseLocalMode((prev) => !prev)}
              disabled={connectionState === "connected" || connectionState === "connecting" || connectionState === "reconnecting"}
              className={`
                px-3 py-1.5 rounded-xl text-[10px] font-bold tracking-wider uppercase transition-all duration-200 cursor-pointer
                ${useLocalMode
                  ? "bg-indigo-100 text-indigo-700 border border-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-300 dark:border-indigo-900 hover:bg-indigo-200 dark:hover:bg-indigo-900/60"
                  : "bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-800 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"}
                disabled:opacity-50 disabled:cursor-not-allowed
              `}
            >
              {useLocalMode ? "🚀 Local DiipMynd ON" : "☁️ Use Local DiipMynd"}
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-slate-500 dark:text-slate-400 font-semibold tracking-wider uppercase bg-slate-100/50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 rounded-xl px-2.5 py-1">
                ☁️ Cloud Only (No Local DiipMynd)
              </span>
              <a
                href="https://github.com/willstanelson/DiipMynd/releases/latest"
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 rounded-xl text-[10px] font-bold tracking-wider uppercase bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900/50 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 transition-all cursor-pointer"
                title="Download DiipMynd local GPU engine installer"
              >
                📥 Download Desktop App
              </a>
            </div>
          )}
          <ConnectionStatus state={connectionState} retryCount={retryCount} />
        </div>
      </div>

      {/* ── Active Provider Badge ─────────────────────────────────────── */}
      {activeProvider && isConnected && (
        <div className="flex items-center gap-2 -mt-3">
          <div className={`
            inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold tracking-wider uppercase
            ${activeProvider === "decart"
              ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
              : "bg-amber-100 text-amber-800 border border-amber-200"}
          `}>
            <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${
              activeProvider === "decart" ? "bg-emerald-500" : "bg-amber-500"
            }`} />
            {activeProvider === "decart" ? "⚡ Decart" : "🌐 Fal.ai"}
          </div>
          {routingReason && (
            <span className="text-[9px] text-slate-400 font-medium">{routingReason}</span>
          )}
        </div>
      )}

      {/* ── Main Layout Grid ────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 w-full items-start">
        {/* Left Column: Video Area, Original Camera, & Errors */}
        <div className="md:col-span-7 flex flex-col gap-4 w-full">
          <div className="relative w-full aspect-video rounded-2xl overflow-hidden bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-md transition-colors duration-200">
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

            {/* Loading overlay */}
            {isLoading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 z-10 bg-slate-50/50 dark:bg-slate-950/50 backdrop-blur-sm transition-colors duration-200">
                <div className="relative w-20 h-20">
                  <div className="absolute inset-0 rounded-full border-2 border-indigo-500/30 animate-ping" />
                  <div className="absolute inset-2 rounded-full border-2 border-teal-400/40 animate-ping animation-delay-200" />
                  <div className="absolute inset-4 rounded-full border-2 border-pink-400/50 animate-pulse" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-3 h-3 rounded-full bg-indigo-500 animate-pulse" />
                  </div>
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-300 font-medium tracking-wide animate-pulse">
                  {connectionState === "requesting-token" && "Authenticating…"}
                  {connectionState === "initializing-camera" && "Starting camera…"}
                  {connectionState === "connecting" && "Establishing WebRTC connection…"}
                  {connectionState === "reconnecting" && `Reconnecting (attempt ${retryCount})…`}
                </p>
              </div>
            )}

            {/* Idle / disconnected placeholder */}
            {(connectionState === "idle" || connectionState === "disconnected") && !error && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 z-10 bg-slate-50/40 dark:bg-slate-950/40 transition-colors duration-200">
                <div className="w-16 h-16 rounded-full bg-indigo-55 dark:bg-indigo-950/40 bg-indigo-50 flex items-center justify-center border border-indigo-100 dark:border-indigo-900/50 shadow-sm">
                  <svg className="w-7 h-7 text-indigo-400 dark:text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
                  </svg>
                </div>
                <p className="text-sm text-slate-400 dark:text-slate-500 font-medium">Press Start to begin your transformation</p>
              </div>
            )}

            {/* Pop-out placeholder */}
            {isPoppedOut && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm transition-colors duration-200">
                <div className="w-14 h-14 rounded-full bg-indigo-50 dark:bg-indigo-950/40 flex items-center justify-center border border-indigo-100 dark:border-indigo-900/50 shadow-sm animate-pulse">
                  <svg className="w-6 h-6 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                  </svg>
                </div>
                <div className="text-center">
                  <p className="text-sm text-slate-800 dark:text-slate-200 font-bold">Avatar Popped Out</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">AI stream is active in a floating picture-in-picture window.</p>
                </div>
                <button
                  onClick={handlePopOut}
                  className="px-3.5 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg shadow-md active:scale-95 transition-all cursor-pointer"
                >
                  Return to Page
                </button>
              </div>
            )}

            {/* Pop-Out Button */}
            {isConnected && !isPoppedOut && isPiPSupported && (
              <button
                onClick={handlePopOut}
                className="absolute top-4 right-4 p-2 rounded-xl bg-white/80 dark:bg-slate-900/80 hover:bg-white dark:hover:bg-slate-855 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-455 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 border border-slate-200 dark:border-slate-800 backdrop-blur-sm active:scale-95 transition-all z-20 cursor-pointer shadow-sm"
                title="Pop out video (Picture-in-Picture)"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </button>
            )}

            {/* ── Diagnostics Overlay (inside video area) ───────────────── */}
            {!isPoppedOut && <DiagnosticsOverlay stats={diagnosticsStats} isConnected={isConnected} />}
          </div>

          {/* ── Original Camera Card (Separated from AI Video) ─────────── */}
          {hasLocalStream && (
            <div className="flex items-center gap-4 p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm transition-colors duration-200">
              <div className="relative w-36 aspect-video rounded-lg overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 shadow-inner flex-shrink-0 transition-colors duration-200">
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
                <p className="text-xs text-slate-800 dark:text-slate-200 font-bold tracking-wide">Your Camera Feed</p>
                <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 truncate md:normal-case leading-relaxed">
                  This original camera view is separated. Only the AI feed above can be popped out.
                </p>
              </div>
            </div>
          )}

          {/* ── Error Display ───────────────────────────────────────────── */}
          {error && (
            <div className="w-full p-4 rounded-xl bg-rose-50 dark:bg-rose-955 dark:bg-rose-950/30 border border-rose-100 dark:border-rose-900/40 shadow-sm transition-colors duration-200">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 w-5 h-5 rounded-full bg-rose-100 dark:bg-rose-900/50 flex items-center justify-center flex-shrink-0">
                  <span className="text-rose-600 dark:text-rose-300 text-xs font-extrabold">!</span>
                </div>
                <div className="flex-1">
                  <p className="text-sm text-rose-800 dark:text-rose-200 font-bold">{error.message}</p>
                  {error.code === "CAMERA_DENIED" && (
                    <p className="text-xs text-rose-600/70 dark:text-rose-400/60 mt-1 leading-relaxed">
                      Please allow camera access in your browser settings and try again.
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {(error.message.toLowerCase().includes("credit") || error.code === ("INSUFFICIENT_CREDITS" as any)) && (
                    <button
                      onClick={() => setIsTopUpOpen(true)}
                      className="px-3 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-all active:scale-95 cursor-pointer shadow-sm"
                    >
                      💳 Get Credits
                    </button>
                  )}
                  <button
                    onClick={handleRetry}
                    className="px-3 py-1.5 text-xs font-bold text-rose-700 dark:text-rose-300 bg-rose-100 dark:bg-rose-950 hover:bg-rose-200 dark:hover:bg-rose-900 rounded-lg border border-rose-200 dark:border-rose-800 transition-colors cursor-pointer"
                  >
                    Retry
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Controls Panel */}
        <div className="md:col-span-5 w-full flex flex-col gap-4 p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm transition-colors duration-200">
          {/* ── Provider Selector (Smart Router) ─────────────────────── */}
          {!useLocalMode && (
            <div className="flex flex-col gap-2">
              <label className="text-[10px] text-slate-500 dark:text-slate-400 font-extrabold tracking-widest uppercase">
                AI Provider
              </label>
              <div className="flex items-center gap-1.5">
                {(["auto", "decart", "fal"] as ProviderPreference[]).map((pref) => (
                  <button
                    key={pref}
                    onClick={() => setProviderPreference(pref)}
                    disabled={isSessionActive}
                    className={`
                      flex-1 px-3 py-2 rounded-xl text-[11px] font-bold tracking-wide uppercase
                      transition-all duration-200 cursor-pointer
                      ${providerPreference === pref
                        ? pref === "auto"
                          ? "bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-900/50 shadow-sm font-extrabold"
                          : pref === "decart"
                            ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900/50 shadow-sm font-extrabold"
                            : "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-900/50 shadow-sm font-extrabold"
                        : "bg-slate-50 dark:bg-slate-950 text-slate-400 dark:text-slate-500 border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-900 hover:text-slate-600 dark:hover:text-slate-300"
                      }
                      disabled:opacity-40 disabled:cursor-not-allowed
                    `}
                  >
                    {pref === "auto" ? "🔀 Auto" : pref === "decart" ? "⚡ Decart" : "🌐 Fal.ai"}
                  </button>
                ))}
              </div>
              {providerPreference === "auto" && !isSessionActive && (
                <p className="text-[9px] text-slate-400 dark:text-slate-500 font-medium leading-relaxed">
                  Smart Router will probe latency and pick the fastest provider.
                </p>
              )}
            </div>
          )}

          {/* Prompt input — enabled even before connection so user can set it first */}
          <PromptInput
            onPromptChange={handlePromptChange}
            disabled={false}
          />

          {/* Reference image upload */}
          <ReferenceImageUpload
            onImageChange={handleImageChange}
            disabled={false}
          />

          {/* Action buttons */}
          <div className="flex items-center gap-3">
            {showStartButton && (
              <>
                <button
                  id="btn-start"
                  onClick={startSession}
                  className="
                    flex-1 py-3 rounded-xl font-bold text-sm tracking-wide
                    bg-indigo-600 text-white shadow-md shadow-indigo-600/10 dark:shadow-none
                    hover:shadow-lg hover:shadow-indigo-600/15 hover:bg-indigo-500
                    active:scale-[0.98] cursor-pointer
                    transition-all duration-200
                  "
                >
                  ▶ Start Transformation
                </button>
                <button
                  onClick={() => setIsMicEnabled((prev) => !prev)}
                  className={`
                    p-3 rounded-xl border font-semibold text-sm transition-all duration-200 active:scale-[0.98] cursor-pointer
                    ${isMicEnabled
                      ? "bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-900/50 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900"
                      : "bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-855 dark:hover:bg-slate-900 hover:text-slate-600 dark:hover:text-slate-400"}
                  `}
                  title={isMicEnabled ? "Microphone Enabled" : "Microphone Disabled"}
                >
                  {isMicEnabled ? "🎙️" : "🎙️ (Muted)"}
                </button>
              </>
            )}

            {(isConnected || isLoading) && (
              <>
                <button
                  id="btn-stop"
                  onClick={handleStop}
                  className="
                    flex-1 py-3 rounded-xl font-bold text-sm tracking-wide
                    bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300
                    hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100
                    active:scale-[0.98] cursor-pointer
                    transition-all duration-200
                  "
                >
                  ■ Stop
                </button>
                {isMicEnabled && (
                  <button
                    onClick={toggleMicMute}
                    className={`
                      p-3 rounded-xl border font-semibold text-sm transition-all duration-200 active:scale-[0.98] cursor-pointer
                      ${!isMicMuted
                        ? "bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-900/50 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900"
                        : "bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900/40 text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/50"}
                    `}
                    title={isMicMuted ? "Unmute Mic" : "Mute Mic"}
                  >
                    {isMicMuted ? "🔇" : "🎙️"}
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
