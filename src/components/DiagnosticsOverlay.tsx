// ============================================================================
// DiipMynd — DiagnosticsOverlay Component
//
// Toggleable real-time WebRTC stats overlay. Helps distinguish between
// Decart server-side issues vs local network/hardware issues.
// ============================================================================

"use client";

import { useState, useCallback } from "react";

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
    case "none": return "text-emerald-600 font-semibold";
    case "bandwidth": return "text-amber-600 font-semibold";
    case "cpu": return "text-rose-600 font-semibold";
    default: return "text-slate-400";
  }
}

function lossRate(lost: number, received: number): string {
  if (received === 0) return "0%";
  return `${((lost / (lost + received)) * 100).toFixed(2)}%`;
}

export default function DiagnosticsOverlay({ stats, isConnected }: DiagnosticsOverlayProps) {
  const [isOpen, setIsOpen] = useState(false);
  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);

  if (!isConnected) return null;

  return (
    <>
      {/* ── Toggle Button ─────────────────────────────────────────────── */}
      <button
        id="btn-diagnostics"
        onClick={toggle}
        className={`
          absolute top-3 left-3 z-30
          w-8 h-8 rounded-lg flex items-center justify-center
          text-xs font-bold tracking-wide
          transition-all duration-200 cursor-pointer
          ${isOpen
            ? "bg-indigo-100 text-indigo-700 border border-indigo-200"
            : "bg-white/80 text-slate-500 border border-slate-200 hover:text-slate-700 hover:bg-white"
          }
          backdrop-blur-sm shadow-sm
        `}
        title="Toggle diagnostics"
      >
        📊
      </button>

      {/* ── Stats Panel ───────────────────────────────────────────────── */}
      {isOpen && (
        <div className="absolute top-12 left-3 z-30 w-72 p-3.5 rounded-xl bg-white/95 backdrop-blur-md border border-slate-200 text-[11px] font-mono text-slate-600 space-y-2.5 shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-100 pb-1.5 mb-1">
            <span className="text-xs font-bold text-slate-800 tracking-wide">WebRTC Diagnostics</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${stats ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
              {stats ? "LIVE" : "WAITING"}
            </span>
          </div>

          {stats ? (
            <>
              {/* ── Inbound Video ──────────────────────────────────────── */}
              {stats.video && (
                <div className="space-y-1">
                  <div className="text-[9px] font-extrabold text-teal-600 uppercase tracking-wider">▼ Inbound Video</div>
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
                <div className="space-y-1 border-t border-slate-100 pt-2">
                  <div className="text-[9px] font-extrabold text-pink-600 uppercase tracking-wider">▲ Outbound Video</div>
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
              <div className="space-y-1 border-t border-slate-100 pt-2">
                <div className="text-[9px] font-extrabold text-indigo-600 uppercase tracking-wider">⬡ Connection</div>
                <Row label="RTT" value={formatMs(stats.connection.currentRoundTripTime)} warn={stats.connection.currentRoundTripTime !== null && stats.connection.currentRoundTripTime > 0.15} />
                <Row label="Avail. Bandwidth" value={stats.connection.availableOutgoingBitrate !== null ? formatBitrate(stats.connection.availableOutgoingBitrate) : "—"} />
              </div>
            </>
          ) : (
            <p className="text-slate-400 text-center py-4">Waiting for stats…</p>
          )}
        </div>
      )}
    </>
  );
}

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
    <div className="flex justify-between items-center py-0.5">
      <span className="text-slate-400">{label}</span>
      <span className={className || (warn ? "text-amber-600 font-bold" : "text-slate-800")}>
        {value}
      </span>
    </div>
  );
}
