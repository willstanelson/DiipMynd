// ============================================================================
// DiipMynd — ConnectionStatus Component
// Visual indicator showing the current WebRTC connection state.
// ============================================================================

"use client";

import type { ConnectionState } from "@/types";

interface ConnectionStatusProps {
  state: ConnectionState;
  retryCount?: number;
}

/** Maps each connection state to a colour class and human-readable label. */
const STATE_CONFIG: Record<ConnectionState, { color: string; label: string; pulse: boolean }> = {
  idle:                 { color: "bg-slate-500",   label: "Idle",              pulse: false },
  "requesting-token":   { color: "bg-amber-400",   label: "Authenticating…",   pulse: true  },
  "initializing-camera":{ color: "bg-amber-400",   label: "Starting Camera…",  pulse: true  },
  connecting:           { color: "bg-cyan-400",     label: "Connecting…",       pulse: true  },
  connected:            { color: "bg-emerald-400",  label: "Live",              pulse: false },
  reconnecting:         { color: "bg-orange-400",   label: "Reconnecting…",     pulse: true  },
  disconnected:         { color: "bg-slate-500",    label: "Disconnected",      pulse: false },
  error:                { color: "bg-rose-500",     label: "Error",             pulse: false },
};

export default function ConnectionStatus({ state, retryCount }: ConnectionStatusProps) {
  const config = STATE_CONFIG[state];

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 backdrop-blur-sm border border-white/10">
      {/* Animated dot */}
      <span className="relative flex h-2.5 w-2.5">
        {config.pulse && (
          <span
            className={`absolute inline-flex h-full w-full rounded-full ${config.color} opacity-75 animate-ping`}
          />
        )}
        <span
          className={`relative inline-flex h-2.5 w-2.5 rounded-full ${config.color}`}
        />
      </span>

      {/* Label */}
      <span className="text-xs font-medium text-white/80 tracking-wide">
        {config.label}
        {state === "reconnecting" && retryCount !== undefined && (
          <span className="text-white/50 ml-1">(attempt {retryCount})</span>
        )}
      </span>
    </div>
  );
}
