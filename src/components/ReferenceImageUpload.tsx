// ============================================================================
// DiipMynd — ReferenceImageUpload Component
// Drag-and-drop / click-to-upload for a reference image that the AI will
// use to guide the webcam transformation.
// ============================================================================

"use client";

import { useState, useRef, useCallback } from "react";

interface ReferenceImageUploadProps {
  /** Called with the File when a new image is selected, or null when cleared. */
  onImageChange: (image: File | null) => void;
  /** Whether the upload is interactive. */
  disabled?: boolean;
}

export default function ReferenceImageUpload({ onImageChange, disabled = false }: ReferenceImageUploadProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Process a selected file ────────────────────────────────────────────
  const handleFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith("image/")) return;

      setFileName(file.name);
      onImageChange(file);

      // Generate a local preview URL
      const reader = new FileReader();
      reader.onload = (e) => {
        setPreview(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    },
    [onImageChange]
  );

  // ── Clear the reference image ──────────────────────────────────────────
  const handleClear = useCallback(() => {
    setPreview(null);
    setFileName(null);
    onImageChange(null);
    if (inputRef.current) inputRef.current.value = "";
  }, [onImageChange]);

  // ── Click handler ──────────────────────────────────────────────────────
  const handleClick = () => {
    if (!disabled && inputRef.current) inputRef.current.click();
  };

  // ── File input change ──────────────────────────────────────────────────
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  // ── Drag & drop handlers ──────────────────────────────────────────────
  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!disabled) setIsDragging(true);
    },
    [disabled]
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      if (disabled) return;

      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    },
    [disabled, handleFile]
  );

  return (
    <div className="w-full space-y-2">
      {/* Label */}
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-white/50 tracking-wide uppercase">
          Reference Image
        </label>
        {preview && (
          <button
            onClick={handleClear}
            disabled={disabled}
            className="text-[10px] font-medium text-rose-400/70 hover:text-rose-400 transition-colors disabled:opacity-30"
          >
            ✕ Clear
          </button>
        )}
      </div>

      {preview ? (
        /* ── Preview state ──────────────────────────────────────────── */
        <div className="relative group">
          <div className="flex items-center gap-3 p-2.5 rounded-xl bg-white/5 border border-white/10">
            {/* Thumbnail */}
            <div className="relative w-14 h-14 rounded-lg overflow-hidden flex-shrink-0 border border-white/10">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={preview}
                alt="Reference"
                className="w-full h-full object-cover"
              />
              {/* Active glow */}
              <div className="absolute inset-0 ring-1 ring-inset ring-violet-500/30 rounded-lg" />
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <p className="text-xs text-white/70 font-medium truncate">
                {fileName}
              </p>
              <p className="text-[10px] text-violet-400/70 mt-0.5">
                Active reference — AI will match this look
              </p>
            </div>

            {/* Replace button */}
            <button
              onClick={handleClick}
              disabled={disabled}
              className="
                px-2.5 py-1.5 text-[10px] font-medium tracking-wide
                text-white/50 bg-white/5 hover:bg-white/10
                rounded-lg border border-white/10
                transition-colors disabled:opacity-30
              "
            >
              Replace
            </button>
          </div>
        </div>
      ) : (
        /* ── Upload drop zone ───────────────────────────────────────── */
        <div
          onClick={handleClick}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`
            flex flex-col items-center justify-center gap-2
            p-4 rounded-xl border border-dashed cursor-pointer
            transition-all duration-200
            ${disabled
              ? "opacity-30 cursor-not-allowed border-white/5 bg-transparent"
              : isDragging
                ? "border-violet-500/50 bg-violet-500/5 scale-[1.01]"
                : "border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]"
            }
          `}
        >
          {/* Upload icon */}
          <div className={`
            w-9 h-9 rounded-full flex items-center justify-center
            transition-colors duration-200
            ${isDragging ? "bg-violet-500/15" : "bg-white/5"}
          `}>
            <svg
              className={`w-4 h-4 transition-colors ${isDragging ? "text-violet-400" : "text-white/30"}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.41a2.25 2.25 0 013.182 0l2.909 2.91m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
            </svg>
          </div>

          <div className="text-center">
            <p className="text-xs text-white/40 font-medium">
              {isDragging ? "Drop image here" : "Drop an image or click to upload"}
            </p>
            <p className="text-[10px] text-white/20 mt-0.5">
              The AI will transform you to match this look
            </p>
          </div>
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={handleInputChange}
        className="hidden"
        id="reference-image-input"
      />
    </div>
  );
}
