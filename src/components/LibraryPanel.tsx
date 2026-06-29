// ============================================================================
// DiipMynd — Workspace Library Panel / Drawer Component
//
// Shows a grid of all generated media clips, images, voices, and scripts.
// Provides searching, type-filtering, downloads, deletions, and integrations.
// Updates automatically on the custom 'library-updated' window event.
// ============================================================================

"use client";

import React, { useState, useEffect, useCallback } from "react";
import { LibraryAsset } from "@/lib/library";

interface LibraryPanelProps {
  compact?: boolean;
  onClose?: () => void; // Used if rendered as a drawer
  onUseAsReference?: (url: string) => void;
  onAddToTimeline?: (asset: LibraryAsset) => void;
}

export default function LibraryPanel({
  compact = false,
  onClose,
  onUseAsReference,
  onAddToTimeline,
}: LibraryPanelProps) {
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeFilter, setActiveFilter] = useState<"all" | "video" | "image" | "audio" | "script">("all");
  const [previewAsset, setPreviewAsset] = useState<LibraryAsset | null>(null);

  // Fetch assets from API
  const fetchLibrary = useCallback(async () => {
    try {
      const res = await fetch("/api/library");
      const data = await res.json();
      if (data.assets) {
        setAssets(data.assets);
      }
    } catch (err) {
      console.error("[library-panel] Failed to fetch assets:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Listen for library updates from other components
  useEffect(() => {
    fetchLibrary();
    window.addEventListener("library-updated", fetchLibrary);
    return () => {
      window.removeEventListener("library-updated", fetchLibrary);
    };
  }, [fetchLibrary]);

  // Handle asset deletion
  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this asset?")) return;

    try {
      const res = await fetch(`/api/library?id=${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setAssets((prev) => prev.filter((a) => a.id !== id));
        if (previewAsset?.id === id) setPreviewAsset(null);
        // Dispatch event to sync other views
        window.dispatchEvent(new Event("library-updated"));
      } else {
        const data = await res.json();
        alert(data.error || "Failed to delete asset.");
      }
    } catch (err) {
      console.error("[library-panel] Delete request error:", err);
    }
  };

  // Trigger browser download
  const handleDownload = async (asset: LibraryAsset, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const res = await fetch(asset.url);
      const blob = await res.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = asset.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      // Fallback: open link in new tab
      window.open(asset.url, "_blank");
    }
  };

  // Filter & Search Logic
  const filteredAssets = assets.filter((asset) => {
    const matchesFilter = activeFilter === "all" || asset.type === activeFilter;
    const matchesSearch =
      asset.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (asset.prompt && asset.prompt.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (asset.model && asset.model.toLowerCase().includes(searchTerm.toLowerCase()));
    return matchesFilter && matchesSearch;
  });

  return (
    <div className={`flex flex-col h-full text-slate-100 ${compact ? "" : "p-6"}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-xl font-extrabold tracking-wide text-slate-100 flex items-center gap-2">
            📂 {compact ? "Workspace Storage" : "DiipMynd Workspace Library"}
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Store and retrieve all your generated content creators assets.
          </p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col gap-3 mb-5">
        <input
          type="text"
          placeholder="Search assets by name, prompt, or model..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full text-sm py-2 px-3 rounded-xl bg-slate-900 border border-slate-800 focus:border-indigo-500 focus:outline-none transition-colors"
        />

        <div className="flex flex-wrap gap-1 bg-slate-950 p-1 rounded-xl border border-slate-900">
          {(["all", "video", "image", "audio", "script"] as const).map((type) => (
            <button
              key={type}
              onClick={() => setActiveFilter(type)}
              className={`flex-1 text-center py-1.5 px-2 rounded-lg text-xs font-bold capitalize transition-all cursor-pointer ${
                activeFilter === type
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      {/* Main Grid */}
      <div className="flex-1 overflow-y-auto pr-1">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-10 gap-3">
            <div className="w-8 h-8 rounded-full border-2 border-indigo-600/20 border-t-indigo-600 animate-spin" />
            <p className="text-xs text-slate-500">Loading library assets...</p>
          </div>
        ) : filteredAssets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center border border-dashed border-slate-800 rounded-2xl p-4 bg-slate-900/10">
            <span className="text-3xl mb-2">📁</span>
            <p className="text-xs text-slate-400 font-semibold">No assets found</p>
            <p className="text-[10px] text-slate-600 mt-1 max-w-[200px]">
              Generated media from other studios will automatically show up here.
            </p>
          </div>
        ) : (
          <div className={`grid gap-3 ${compact ? "grid-cols-1" : "grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"}`}>
            {filteredAssets.map((asset) => (
              <div
                key={asset.id}
                onClick={() => setPreviewAsset(asset)}
                className="group relative cursor-pointer border border-slate-800 hover:border-indigo-500/50 bg-slate-900/40 rounded-xl overflow-hidden p-2 transition-all flex flex-col gap-2 hover:bg-slate-900/60"
              >
                {/* Media Preview Thumbnail */}
                <div className="w-full aspect-video bg-slate-950 rounded-lg overflow-hidden flex items-center justify-center relative">
                  {asset.type === "image" && (
                    <img src={asset.url} alt={asset.name} className="w-full h-full object-cover" />
                  )}
                  {asset.type === "video" && (
                    <video src={asset.url} muted playsInline className="w-full h-full object-cover" />
                  )}
                  {asset.type === "audio" && (
                    <div className="text-2xl animate-float">🔊</div>
                  )}
                  {asset.type === "script" && (
                    <div className="text-2xl">📝</div>
                  )}

                  {/* Asset Type Tag */}
                  <span className="absolute bottom-1 right-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-950/80 text-indigo-400 capitalize border border-slate-850">
                    {asset.type}
                  </span>
                </div>

                {/* Info */}
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-bold text-slate-200 truncate pr-14" title={asset.name}>
                    {asset.name}
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {new Date(asset.created_at).toLocaleDateString()}
                  </span>
                </div>

                {/* Floating Quick Action Row */}
                <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 flex items-center gap-1.5 transition-opacity bg-slate-950/70 p-1 rounded-lg backdrop-blur-sm">
                  {/* Download */}
                  <button
                    onClick={(e) => handleDownload(asset, e)}
                    title="Download"
                    className="p-1 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800 cursor-pointer"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                  </button>
                  {/* Delete */}
                  <button
                    onClick={(e) => handleDelete(asset.id, e)}
                    title="Delete"
                    className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-slate-800 cursor-pointer"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Asset Preview Modal Overlay */}
      {previewAsset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl p-5 flex flex-col gap-4 animate-scaleUp">
            
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-100 truncate max-w-[400px]">
                  {previewAsset.name}
                </h3>
                <span className="text-[10px] text-slate-500 uppercase font-semibold">
                  {previewAsset.type} asset • {previewAsset.model || "Unknown Model"}
                </span>
              </div>
              <button
                onClick={() => setPreviewAsset(null)}
                className="text-slate-400 hover:text-slate-200 p-1"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Media Canvas Area */}
            <div className="w-full min-h-[240px] max-h-[380px] bg-slate-950 rounded-xl overflow-hidden flex items-center justify-center border border-slate-800/80">
              {previewAsset.type === "image" && (
                <img src={previewAsset.url} alt={previewAsset.name} className="max-w-full max-h-[380px] object-contain" />
              )}
              {previewAsset.type === "video" && (
                <video src={previewAsset.url} controls autoPlay loop className="max-w-full max-h-[380px] object-contain" />
              )}
              {previewAsset.type === "audio" && (
                <div className="flex flex-col items-center gap-3 p-6">
                  <div className="text-5xl animate-pulse">🎙️</div>
                  <audio src={previewAsset.url} controls autoPlay className="w-[300px]" />
                </div>
              )}
              {previewAsset.type === "script" && (
                <div className="w-full max-h-[300px] overflow-y-auto p-4 text-xs font-mono bg-slate-950 text-slate-300 leading-relaxed whitespace-pre-wrap">
                  {previewAsset.prompt || "No prompt details."}
                </div>
              )}
            </div>

            {/* Prompt details (images/videos) */}
            {previewAsset.type !== "script" && previewAsset.prompt && (
              <div className="bg-slate-950 p-3 rounded-lg border border-slate-850 flex flex-col gap-1">
                <span className="text-[9px] uppercase tracking-wider text-slate-500 font-bold">
                  Visual Prompt Details:
                </span>
                <p className="text-xs text-slate-300 italic max-h-[70px] overflow-y-auto leading-relaxed">
                  "{previewAsset.prompt}"
                </p>
              </div>
            )}

            {/* Action Bar */}
            <div className="flex items-center justify-end gap-2 border-t border-slate-800 pt-3">
              {previewAsset.type === "image" && onUseAsReference && (
                <button
                  onClick={() => {
                    onUseAsReference(previewAsset.url);
                    setPreviewAsset(null);
                  }}
                  className="px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-xs font-bold text-white transition-all cursor-pointer"
                >
                  🎭 Use as Reference Image
                </button>
              )}

              {(previewAsset.type === "video" || previewAsset.type === "audio") && onAddToTimeline && (
                <button
                  onClick={() => {
                    onAddToTimeline(previewAsset);
                    setPreviewAsset(null);
                  }}
                  className="px-3 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-xs font-bold text-white transition-all cursor-pointer"
                >
                  🎞️ Add to Timeline
                </button>
              )}

              <button
                onClick={(e) => handleDownload(previewAsset, e)}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 transition-all cursor-pointer"
              >
                📥 Download
              </button>

              <button
                onClick={(e) => handleDelete(previewAsset.id, e)}
                className="px-3 py-1.5 rounded-xl bg-red-950/30 hover:bg-red-900/40 text-xs font-bold text-red-400 border border-red-900/30 transition-all cursor-pointer"
              >
                🗑️ Delete Asset
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
