// ============================================================================
// DiipMynd — DiagnosticsOverlay Component
//
// Toggleable real-time WebRTC stats overlay. Helps distinguish between
// Decart server-side issues vs local network/hardware issues.
//
// Stats are pushed from the parent via the `stats` prop (sourced from
// the SDK's `realtimeClient.on("stats", ...)` event).
// ============================================================================

"use client";

import { useState, useCallback } from "react";

// ── Types matching the SDK's WebRTCStats shape ──────────────────────────────
// We only declare the fields we actually display to avoid tight coupling.
export interface DiagnosticsStats {
  video: {
    framesPerSecond: number;
    frameWidth: number;
    frameHeight: number;
    packetsLost: number;
    packetsReceived: number;
    jitter: number;
    bitrate: number;
    freezeCount: number;
    totalFreezesDuration: number;
    framesDropped: number;
    framesDecoded: number;
    avgDecodeTimeMs: number | null;
    avgJitterBufferMs: number | null;
    decoderImplementation: string;
  } | null;
  outboundVideo: {
    qualityLimitationReason: string;
    framesPerSecond: number;
    frameWidth: number;
    frameHeight: number;
    bitrate: number;
    avgEncodeTimeMs: number | null;
  } | null;
  connection: {
    currentRoundTripTime: number | null;
    availableOutgoingBitrate: number | null;
  };
}

interface DiagnosticsOverlayProps {
  stats: DiagnosticsStats | null;
  isConnected: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function formatBitrate(bps: number): string {
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`;
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(0)} kbps`;
  return `${bps} bps`;
}

function formatMs(seconds: number | null): string {
  if (seconds === null) return "—";
  return `${(seconds * 1000).toFixed(0)} ms`;
}

function qualityColor(reason: string): string {
  switch (reason) {
    case "none": return "text-emerald-400";
    case "bandwidth": return "text-amber-400";
    case "cpu": return "text-rose-400";
    default: return "text-white/50";
  }
}

function lossRate(lost: number, received: number): string {
  if (received === 0) return "0%";
  return `${((lost / (lost + received)) * 100).toFixed(2)}%`;
}

export default function DiagnosticsOverlay({ stats, isConnected }: DiagnosticsOverlayProps) {
  const [isOpen, setIsOpen] = useState(false);

  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);

  // Don't render the toggle button if not connected
  if (!isConnected) return null;

  return (
    <>
      {/* ── Toggle Button (top-left of video area) ────────────────────── */}
      <button
        id="btn-diagnostics"
        onClick={toggle}
        className={`
          absolute top-3 left-3 z-30
          w-8 h-8 rounded-lg flex items-center justify-center
          text-xs font-bold tracking-wide
          transition-all duration-200
          ${isOpen
            ? "bg-violet-500/30 text-violet-300 border border-violet-500/50"
            : "bg-black/40 text-white/40 border border-white/10 hover:text-white/70 hover:bg-black/60"
          }
          backdrop-blur-sm
        `}
        title="Toggle diagnostics"
      >
        📊
      </button>

      {/* ── Stats Panel ───────────────────────────────────────────────── */}
      {isOpen && (
        <div className="absolute top-12 left-3 z-30 w-72 p-3 rounded-xl bg-black/80 backdrop-blur-md border border-white/10 text-[11px] font-mono text-white/70 space-y-2.5">
          <div className="flex items-center justify-between border-b border-white/10 pb-1.5 mb-1">
            <span className="text-xs font-semibold text-white/90 tracking-wide">WebRTC Diagnostics</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${stats ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400"}`}>
              {stats ? "LIVE" : "WAITING"}
            </span>
          </div>

          {stats ? (
            <>
              {/* ── Inbound Video ──────────────────────────────────────── */}
              {stats.video && (
                <div className="space-y-1">
                  <div className="text-[10px] font-semibold text-cyan-400/80 uppercase tracking-widest">▼ Inbound Video</div>
                  <Row label="FPS" value={`${stats.video.framesPerSecond}`} warn={stats.video.framesPerSecond < 20} />
                  <Row label="Resolution" value={`${stats.video.frameWidth}×${stats.video.frameHeight}`} />
                  <Row label="Bitrate" value={formatBitrate(stats.video.bitrate)} />
                  <Row label="Jitter" value={formatMs(stats.video.jitter)} warn={stats.video.jitter > 0.03} />
                  <Row label="Packet Loss" value={lossRate(stats.video.packetsLost, stats.video.packetsReceived)} warn={stats.video.packetsLost > 0} />
                  <Row label="Decode Time" value={stats.video.avgDecodeTimeMs !== null ? `${stats.video.avgDecodeTimeMs.toFixed(1)} ms` : "—"} />
                  <Row label="Jitter Buffer" value={stats.video.avgJitterBufferMs !== null ? `${stats.video.avgJitterBufferMs.toFixed(0)} ms` : "—"} />
                  <Row label="Freezes" value={`${stats.video.freezeCount} (${stats.video.totalFreezesDuration.toFixed(1)}s)`} warn={stats.video.freezeCount > 0} />
                  <Row label="Frames Dropped" value={`${stats.video.framesDropped}`} warn={stats.video.framesDropped > 10} />
                  <Row label="Decoder" value={stats.video.decoderImplementation} />
                </div>
              )}

              {/* ── Outbound Video ─────────────────────────────────────── */}
              {stats.outboundVideo && (
                <div className="space-y-1 border-t border-white/5 pt-2">
                  <div className="text-[10px] font-semibold text-fuchsia-400/80 uppercase tracking-widest">▲ Outbound Video</div>
                  <Row label="FPS" value={`${stats.outboundVideo.framesPerSecond}`} warn={stats.outboundVideo.framesPerSecond < 20} />
                  <Row label="Resolution" value={`${stats.outboundVideo.frameWidth}×${stats.outboundVideo.frameHeight}`} />
                  <Row label="Bitrate" value={formatBitrate(stats.outboundVideo.bitrate)} />
                  <Row label="Encode Time" value={stats.outboundVideo.avgEncodeTimeMs !== null ? `${stats.outboundVideo.avgEncodeTimeMs.toFixed(1)} ms` : "—"} />
                  <Row
                    label="Quality Limit"
                    value={stats.outboundVideo.qualityLimitationReason}
                    className={qualityColor(stats.outboundVideo.qualityLimitationReason)}
                    warn={stats.outboundVideo.qualityLimitationReason !== "none"}
                  />
                </div>
              )}

              {/* ── Connection ─────────────────────────────────────────── */}
              <div className="space-y-1 border-t border-white/5 pt-2">
                <div className="text-[10px] font-semibold text-violet-400/80 uppercase tracking-widest">⬡ Connection</div>
                <Row label="RTT" value={formatMs(stats.connection.currentRoundTripTime)} warn={stats.connection.currentRoundTripTime !== null && stats.connection.currentRoundTripTime > 0.15} />
                <Row label="Avail. Bandwidth" value={stats.connection.availableOutgoingBitrate !== null ? formatBitrate(stats.connection.availableOutgoingBitrate) : "—"} />
              </div>
            </>
          ) : (
            <p className="text-white/30 text-center py-4">Waiting for stats…</p>
          )}
        </div>
      )}
    </>
  );
}

// ── Stat Row Component ────────────────────────────────────────────────────
function Row({
  label,
  value,
  warn = false,
  className = "",
}: {
  label: string;
  value: string;
  warn?: boolean;
  className?: string;
}) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-white/40">{label}</span>
      <span className={className || (warn ? "text-amber-400" : "text-white/80")}>
        {value}
      </span>
    </div>
  );
}
