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
        <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 tracking-wide uppercase">
          Reference Image
        </label>
        {preview && (
          <button
            onClick={handleClear}
            disabled={disabled}
            className="text-[10px] font-bold text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 transition-colors disabled:opacity-30 cursor-pointer"
          >
            ✕ Clear
          </button>
        )}
      </div>

      {preview ? (
        /* ── Preview state ──────────────────────────────────────────── */
        <div className="relative group">
          <div className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 transition-colors duration-200">
            {/* Thumbnail */}
            <div className="relative w-14 h-14 rounded-lg overflow-hidden flex-shrink-0 border border-slate-200 dark:border-slate-800">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={preview}
                alt="Reference"
                className="w-full h-full object-cover"
              />
              {/* Active glow */}
              <div className="absolute inset-0 ring-1 ring-inset ring-indigo-600/30 rounded-lg" />
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <p className="text-xs text-slate-700 dark:text-slate-300 font-bold truncate">
                {fileName}
              </p>
              <p className="text-[10px] text-indigo-600 dark:text-indigo-400 font-semibold mt-0.5">
                Active reference — AI will match this look
              </p>
            </div>

            {/* Replace button */}
            <button
              onClick={handleClick}
              disabled={disabled}
              className="
                px-2.5 py-1.5 text-[10px] font-bold tracking-wide
                text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-950 hover:bg-slate-50 dark:hover:bg-slate-900
                rounded-lg border border-slate-200 dark:border-slate-800 hover:border-slate-350 dark:hover:border-slate-700
                transition-all duration-200 disabled:opacity-30 cursor-pointer
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
              ? "opacity-30 cursor-not-allowed border-slate-100 dark:border-slate-900 bg-transparent"
              : isDragging
                ? "border-indigo-500/50 bg-indigo-50/20 dark:bg-indigo-950/20 scale-[1.01]"
                : "border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-950/40 hover:border-slate-350 dark:hover:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-900"
            }
          `}
        >
          {/* Upload icon */}
          <div className={`
            w-9 h-9 rounded-full flex items-center justify-center
            transition-colors duration-200
            ${isDragging ? "bg-indigo-100 dark:bg-indigo-950/40" : "bg-slate-100 dark:bg-slate-900"}
          `}>
            <svg
              className={`w-4 h-4 transition-colors ${isDragging ? "text-indigo-600 dark:text-indigo-400" : "text-slate-400 dark:text-slate-500"}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.41a2.25 2.25 0 013.182 0l2.909 2.91m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
            </svg>
          </div>

          <div className="text-center">
            <p className="text-xs text-slate-500 dark:text-slate-400 font-semibold">
              {isDragging ? "Drop image here" : "Drop an image or click to upload"}
            </p>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
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
