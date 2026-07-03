// ============================================================================
// DiipMynd — Workstation Parent Layout Container (v3.1  ·  Obsidian Night)
//
// Pure monochrome black. Collapsible sidebar. Inline SVG icon set.
// Adds:
//   - Cmd+K / Ctrl+K command palette
//   - Cursor-following spotlight on the main canvas
//   - Theme locked to dark (props dropped from signature)
// ============================================================================

"use client";

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { SafeUser } from "@/lib/auth";
import StoryboardStudio from "./StoryboardStudio";
import BRollStudio from "./BRollStudio";
import CharacterForge from "./CharacterForge";
import VoiceLab from "./VoiceLab";
import LiveAvatarStream from "./LiveAvatarStream";
import TimelineAssembler from "./TimelineAssembler";
import LibraryPanel from "./LibraryPanel";
import TopUpModal from "./TopUpModal";
import ComingSoon from "./ComingSoon";
import AdminPanel from "./AdminPanel";
import CommandPalette, { type CommandAction } from "./CommandPalette";
import TermsAndKycModal from "./TermsAndKycModal";

import type { LibraryAsset } from "@/lib/library";

interface WorkstationLayoutProps {
  user: SafeUser;
  onLogout: () => void;
  onBalanceUpdated: () => void;
}

// ── Inline SVG icon set (lucide-style, monochrome via currentColor) ───────
type IconProps = { className?: string };

const ScriptIcon   = ({ className = "w-4 h-4" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6z" />
    <path d="M14 3v4h4" />
    <path d="M8 13h8M8 17h6M8 9h3" />
  </svg>
);
const FilmIcon     = ({ className = "w-4 h-4" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M7 3v18M17 3v18M3 7.5h4M3 12h4M3 16.5h4M17 7.5h4M17 12h4M17 16.5h4" />
  </svg>
);
const MaskIcon     = ({ className = "w-4 h-4" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 5c4-1 12-1 16 0 0 8-3 14-8 14S4 13 4 5z" />
    <circle cx="9" cy="10" r="1" fill="currentColor" />
    <circle cx="15" cy="10" r="1" fill="currentColor" />
    <path d="M9 15c1.5 1 4.5 1 6 0" />
  </svg>
);
const WaveIcon     = ({ className = "w-4 h-4" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12h2M6 8v8M10 4v16M14 7v10M18 9v6M22 12h-2" />
  </svg>
);
const VideoIcon    = ({ className = "w-4 h-4" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="6" width="14" height="12" rx="2" />
    <path d="M16 10l6-4v12l-6-4z" />
  </svg>
);
const LayersIcon   = ({ className = "w-4 h-4" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2 2 7l10 5 10-5z" />
    <path d="m2 12 10 5 10-5M2 17l10 5 10-5" />
  </svg>
);
const FolderIcon   = ({ className = "w-4 h-4" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2z" />
  </svg>
);
const ShieldIcon   = ({ className = "w-4 h-4" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2 4 5v6c0 5 3.5 9 8 11 4.5-2 8-6 8-11V5z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);
const DatabaseIcon = ({ className = "w-4 h-4" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
    <ellipse cx="12" cy="5" rx="9" ry="3" />
    <path d="M3 5v6c0 1.66 4 3 9 3s9-1.34 9-3V5M3 11v6c0 1.66 4 3 9 3s9-1.34 9-3v-6" />
  </svg>
);
const LogoutIcon   = ({ className = "w-4 h-4" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5M21 12H9" />
  </svg>
);
const PlusIcon     = ({ className = "w-3.5 h-3.5" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5v14M5 12h14" />
  </svg>
);
const BoltIcon     = ({ className = "w-5 h-5" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <path d="M13 2 3 14h9l-1 8 10-12h-9z" />
  </svg>
);
const ChevronLeft  = ({ className = "w-4 h-4" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="m15 18-6-6 6-6" />
  </svg>
);
const SearchIcon   = ({ className = "w-4 h-4" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);
const CommandIcon  = ({ className = "w-3 h-3" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z" />
  </svg>
);
const WalletIcon   = ({ className = "w-4 h-4" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7" />
    <circle cx="16" cy="13" r="1" fill="currentColor" />
  </svg>
);

// ── Asset-type icons (for palette asset rows) ──
const AssetImageIcon  = ({ className = "w-4 h-4" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="9" cy="9" r="2" />
    <path d="m21 15-3.5-3.5a2 2 0 0 0-2.8 0L6 20" />
  </svg>
);
const AssetVideoIcon  = ({ className = "w-4 h-4" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="6" width="14" height="12" rx="2" />
    <path d="M16 10l6-4v12l-6-4z" />
  </svg>
);
const AssetAudioIcon  = ({ className = "w-4 h-4" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="16" r="3" />
  </svg>
);
const AssetScriptIcon = ({ className = "w-4 h-4" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
    <path d="M14 3v6h6" />
    <path d="M8 13h8M8 17h6" />
  </svg>
);

// ── Nav configuration ──────────────────────────────────────────────────────
type TabId = "storyboard" | "broll" | "character" | "voice" | "stream" | "timeline" | "library" | "billing";

interface NavItem {
  id: TabId;
  label: string;
  shortLabel: string;
  icon: React.FC<IconProps>;
  hint?: string;
  badge?: string;
  group: "create" | "produce" | "manage";
  iconColor: string;       // active icon color (Tailwind text-* class)
  iconHover: string;       // group-hover icon color (Tailwind class)
  locked?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { id: "storyboard", label: "Script & Story",      shortLabel: "Script",      icon: ScriptIcon,  hint: "1", group: "create",  iconColor: "text-amber-300",    iconHover: "group-hover:text-amber-300/80", locked: true },
  { id: "broll",      label: "B-Roll Studio",       shortLabel: "B-Roll",      icon: FilmIcon,    hint: "2", group: "create",  iconColor: "text-rose-300",     iconHover: "group-hover:text-rose-300/80", locked: true },
  { id: "character",  label: "Character Forge",     shortLabel: "Character",   icon: MaskIcon,    hint: "3", group: "create",  iconColor: "text-violet-300",   iconHover: "group-hover:text-violet-300/80", locked: true },
  { id: "voice",      label: "AI Voice Lab",        shortLabel: "Voice Lab",   icon: WaveIcon,    hint: "4", group: "produce", iconColor: "text-cyan-300",     iconHover: "group-hover:text-cyan-300/80", locked: true },
  { id: "stream",     label: "Live Mask & Stream",  shortLabel: "Live Stream", icon: VideoIcon,   hint: "5", badge: "LIVE", group: "produce", iconColor: "text-red-300", iconHover: "group-hover:text-red-300/80" },
  { id: "timeline",   label: "Timeline Assembler",  shortLabel: "Timeline",    icon: LayersIcon,  hint: "6", group: "produce", iconColor: "text-blue-300",    iconHover: "group-hover:text-blue-300/80", locked: true },
  { id: "library",    label: "Workspace Library",   shortLabel: "Library",     icon: FolderIcon,  hint: "7", group: "manage",  iconColor: "text-emerald-300",  iconHover: "group-hover:text-emerald-300/80" },
];

const NAV_GROUPS: { id: NavItem["group"]; label: string }[] = [
  { id: "create",  label: "Create" },
  { id: "produce", label: "Produce" },
  { id: "manage",  label: "Manage" },
];

export default function WorkstationLayout({
  user,
  onLogout,
  onBalanceUpdated,
}: WorkstationLayoutProps) {
  const [activeTab, setActiveTab] = useState<TabId>("stream");

  // ── Collapsible sidebar state ──
  const [isCollapsed, setIsCollapsed] = useState(false);
  useEffect(() => {
    const saved = localStorage.getItem("dm-sidebar-collapsed");
    if (saved === "true") setIsCollapsed(true);
  }, []);
  useEffect(() => {
    localStorage.setItem("dm-sidebar-collapsed", String(isCollapsed));
  }, [isCollapsed]);

  // ── Command palette state ──
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);

  // Shared pipeline references
  const [referenceImageUrl, setReferenceImageUrl] = useState<string | null>(null);
  const [timelineAsset, setTimelineAsset] = useState<any | null>(null);

  // Drawer and TopUp states
  const [isLibraryDrawerOpen, setIsLibraryDrawerOpen] = useState(false);
  const [isTopUpOpen, setIsTopUpOpen] = useState(false);
  const [isAdminPanelOpen, setIsAdminPanelOpen] = useState(false);
  const [isKycForceOpen, setIsKycForceOpen] = useState(false);

  // ── Library assets for command palette search ──
  // Fetched on mount and refreshed whenever any studio dispatches the
  // 'library-updated' window event (after generating/saving/deleting assets).
  const [libraryAssets, setLibraryAssets] = useState<LibraryAsset[]>([]);
  useEffect(() => {
    const fetchAssets = async () => {
      try {
        const res = await fetch("/api/library");
        const data = await res.json();
        if (data.assets) setLibraryAssets(data.assets);
      } catch (err) {
        console.error("[workstation] Failed to fetch library assets for palette:", err);
      }
    };
    fetchAssets();
    window.addEventListener("library-updated", fetchAssets);
    return () => window.removeEventListener("library-updated", fetchAssets);
  }, []);

  // ── Spotlight cursor ──
  // Track cursor position via CSS variables on documentElement — no React
  // re-renders, smooth 60fps tracking. Activates only when pointer is fine
  // (skip on touch devices to avoid jitter).
  const spotlightRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Skip on touch / coarse pointers
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(pointer: fine)");
    if (!mq.matches) return;

    const doc = document.documentElement;
    doc.style.setProperty("--spotlight-active", "1");

    let raf = 0;
    const onMove = (e: MouseEvent) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        doc.style.setProperty("--mx", `${e.clientX}px`);
        doc.style.setProperty("--my", `${e.clientY}px`);
        raf = 0;
      });
    };

    window.addEventListener("mousemove", onMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
      doc.style.setProperty("--spotlight-active", "0");
    };
  }, []);

  // ── Cmd+K / Ctrl+K handler ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsPaletteOpen((v) => !v);
      }
      // Number-key shortcuts for the first 7 studios (1–7)
      if (!e.metaKey && !e.ctrlKey && !e.altKey && /^[1-7]$/.test(e.key)) {
        const target = document.activeElement as HTMLElement | null;
        const tag = (target?.tagName ?? "").toLowerCase();
        if (tag === "input" || tag === "textarea" || target?.isContentEditable) return;
        const idx = parseInt(e.key, 10) - 1;
        if (NAV_ITEMS[idx]) {
          setActiveTab(NAV_ITEMS[idx].id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleNavigateToTab = (tab: string, context?: any) => {
    if (tab === "voice" && context?.text) setActiveTab("voice");
  };

  const handleUseAsReference = (url: string) => {
    setReferenceImageUrl(url);
    setActiveTab("broll");
    setIsLibraryDrawerOpen(false);
  };

  const handleAddToTimeline = (asset: any) => {
    setTimelineAsset(asset);
    setActiveTab("timeline");
    setIsLibraryDrawerOpen(false);
  };

  // Build the user initials for the avatar circle
  const initials = (user.email ?? "?")
    .split("@")[0]
    .split(/[.\-_]/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("") || "?";

  const activeNavLabel = NAV_ITEMS.find((t) => t.id === activeTab)?.label ?? "Studio";

  // ── Build command palette actions ──
  const paletteActions = useMemo<CommandAction[]>(() => {
    const studioActions: CommandAction[] = NAV_ITEMS.map((tab) => ({
      id: `nav-${tab.id}`,
      label: tab.label,
      subtitle: `Open ${tab.shortLabel} studio`,
      keywords: `${tab.group} ${tab.shortLabel} studio`,
      group: "studios",
      shortcut: tab.hint,
      icon: <tab.icon className="w-4 h-4" />,
      onSelect: () => setActiveTab(tab.id),
    }));

    const quickActions: CommandAction[] = [
      {
        id: "action-toggle-sidebar",
        label: isCollapsed ? "Expand sidebar" : "Collapse sidebar",
        subtitle: "Toggle the navigation rail width",
        keywords: "sidebar collapse expand nav rail",
        group: "actions",
        shortcut: "⌘ B",
        icon: <ChevronLeft className="w-4 h-4" />,
        onSelect: () => setIsCollapsed((v) => !v),
      },
      {
        id: "action-open-storage",
        label: "Open workspace storage",
        subtitle: "Slide-out library drawer",
        keywords: "library storage drawer assets files",
        group: "actions",
        icon: <DatabaseIcon className="w-4 h-4" />,
        onSelect: () => setIsLibraryDrawerOpen(true),
      },
      {
        id: "action-top-up",
        label: "Top up credits",
        subtitle: `Currently ${user.credits.toLocaleString()} cr available`,
        keywords: "buy credits payment billing fund balance",
        group: "actions",
        icon: <WalletIcon className="w-4 h-4" />,
        onSelect: () => setIsTopUpOpen(true),
      },
      ...(user.isAdmin ? [{
        id: "action-admin",
        label: "Open admin panel",
        subtitle: "User management & system controls",
        keywords: "admin shield manage users system",
        group: "actions",
        icon: <ShieldIcon className="w-4 h-4" />,
        onSelect: () => setIsAdminPanelOpen(true),
      }] as CommandAction[] : []),
    ];

    // ── Asset actions — built from the live library ──
    // Each asset becomes a searchable row. Image/video assets show a thumbnail;
    // audio/script assets show a type icon. Selecting an asset jumps to the
    // relevant studio with the asset preloaded.
    const assetIconForType = (type: string) => {
      if (type === "image") return <AssetImageIcon className="w-4 h-4 text-emerald-300" />;
      if (type === "video") return <AssetVideoIcon className="w-4 h-4 text-rose-300" />;
      if (type === "audio") return <AssetAudioIcon className="w-4 h-4 text-violet-300" />;
      return <AssetScriptIcon className="w-4 h-4 text-amber-300" />;
    };

    const assetActions: CommandAction[] = libraryAssets.slice(0, 100).map((asset) => ({
      id: `asset-${asset.id}`,
      label: asset.name,
      subtitle: `${asset.type} · ${asset.model || "unknown model"} · ${new Date(asset.created_at).toLocaleDateString()}`,
      keywords: `${asset.type} ${asset.name} ${asset.prompt || ""} ${asset.model || ""}`,
      group: "assets" as const,
      icon: assetIconForType(asset.type),
      // Show thumbnail for image/video assets; icon for audio/script
      thumbnail: (asset.type === "image" || asset.type === "video") ? asset.url : undefined,
      onSelect: () => {
        // Route the asset to the appropriate studio based on type
        if (asset.type === "image") {
          handleUseAsReference(asset.url);
        } else if (asset.type === "video" || asset.type === "audio") {
          handleAddToTimeline(asset);
        } else {
          // Script assets — just open the library tab
          setActiveTab("library");
        }
      },
    }));

    const accountActions: CommandAction[] = [
      {
        id: "account-logout",
        label: "Sign out",
        subtitle: user.email,
        keywords: "logout signout exit quit",
        group: "account",
        icon: <LogoutIcon className="w-4 h-4" />,
        onSelect: onLogout,
      },
    ];

    return [...studioActions, ...quickActions, ...assetActions, ...accountActions];
  }, [isCollapsed, user.credits, user.email, user.isAdmin, onLogout, libraryAssets]);

  return (
    <div className="relative flex w-full min-h-screen text-neutral-100 overflow-hidden font-sans vignette">
      {/* Ambient night layer */}
      <div className="aurora-bg" />

      {/* Cursor spotlight — pure CSS, follows --mx / --my */}
      <div ref={spotlightRef} className="spotlight-layer" />

      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside
        className={`sidebar-shell boot-slide-right relative z-20 shrink-0 flex flex-col select-none border-r border-white/[0.05] bg-[rgba(3,3,4,0.7)] backdrop-blur-2xl ${
          isCollapsed ? "collapsed" : ""
        }`}
      >
        {/* Logo + collapse toggle */}
        <div className="boot-logo flex items-center justify-between gap-2 px-4 h-[64px] border-b border-white/[0.05] shrink-0">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="relative shrink-0">
              <div className="absolute inset-0 rounded-lg bg-white/10 blur-md opacity-50 animate-glow" />
              <div className="relative w-9 h-9 rounded-lg bg-gradient-to-br from-white/15 to-white/5 border border-white/10 flex items-center justify-center shadow-lg">
                <BoltIcon className="w-[18px] h-[18px] text-white" />
              </div>
            </div>
            <div className={`sidebar-label flex flex-col leading-none ${isCollapsed ? "opacity-0" : ""}`}>
              <span className="font-display font-bold text-[15px] tracking-tight text-white">
                DiipMynd
              </span>
              <span className="text-[9px] uppercase tracking-[0.2em] text-neutral-600 font-semibold mt-1">
                Workstation v1.0
              </span>
            </div>
          </div>

          {/* Collapse toggle — only visible when expanded */}
          <button
            onClick={() => setIsCollapsed(true)}
            title="Collapse sidebar"
            className="shrink-0 p-1.5 rounded-lg text-neutral-600 hover:text-white hover:bg-white/5 transition-all"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>

        {/* Command / Search pill — expanded only — opens the palette */}
        {!isCollapsed && (
          <div className="boot-fade-up boot-d-2 px-3 pt-4 pb-2">
            <button
              onClick={() => setIsPaletteOpen(true)}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg bg-white/[0.025] hover:bg-white/[0.05] border border-white/[0.06] hover:border-white/10 text-neutral-500 hover:text-neutral-300 transition-all group"
            >
              <SearchIcon className="w-3.5 h-3.5" />
              <span className="text-xs font-medium flex-1 text-left">Search studios…</span>
              <span className="flex items-center gap-0.5 text-[10px] text-neutral-600">
                <CommandIcon className="w-2.5 h-2.5" />
                <span>K</span>
              </span>
            </button>
          </div>
        )}

        {/* Collapsed-mode search trigger (icon button) */}
        {isCollapsed && (
          <div className="boot-fade-up boot-d-2 px-3 pt-3 pb-1 flex justify-center">
            <button
              onClick={() => setIsPaletteOpen(true)}
              title="Search (Cmd+K)"
              className="w-9 h-9 rounded-lg bg-white/[0.025] hover:bg-white/[0.05] border border-white/[0.06] text-neutral-500 hover:text-neutral-300 transition-all flex items-center justify-center sidebar-tooltip-target"
            >
              <SearchIcon className="w-4 h-4" />
              <span className="sidebar-tooltip">Search · Cmd+K</span>
            </button>
          </div>
        )}

        {/* Nav items — grouped (staggered boot entrance) */}
        <nav className="stagger flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-4">
          {NAV_GROUPS.map((group) => {
            const items = NAV_ITEMS.filter((i) => i.group === group.id);
            return (
              <div key={group.id} className="flex flex-col gap-0.5">
                {!isCollapsed && (
                  <span className="text-eyebrow px-2.5 mb-1.5">{group.label}</span>
                )}
                {isCollapsed && (
                  <div className="h-px mx-2 mb-1.5 bg-white/[0.06]" />
                )}
                {items.map((tab) => {
                  const isActive = activeTab === tab.id;
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      id={`btn-nav-${tab.id}`}
                      onClick={() => setActiveTab(tab.id)}
                      title={isCollapsed ? tab.label : undefined}
                      className={`nav-item group relative flex items-center gap-3 px-3 py-2.5 rounded-[10px] text-[13px] font-medium transition-all ${
                        isActive
                          ? "text-white"
                          : "text-neutral-500 hover:text-neutral-200 hover:bg-white/[0.03]"
                      } ${tab.locked && !isActive ? "opacity-45 hover:opacity-75" : ""}`}
                    >
                      {/* Active pill + left bar */}
                      {isActive && <span className="nav-pill-indicator" />}
                      {isActive && <span className="nav-active-bar" />}

                      <Icon
                        className={`relative z-10 w-[18px] h-[18px] shrink-0 transition-colors ${
                          isActive ? tab.iconColor : `text-neutral-500 ${tab.iconHover}`
                        }`}
                      />

                      {/* Label — collapses smoothly */}
                      <span className={`sidebar-label relative z-10 flex-1 text-left ${isCollapsed ? "opacity-0" : ""}`}>
                        {tab.label}
                      </span>

                      {/* Badge (e.g. LIVE) — green glowing dot */}
                      {tab.badge && !isCollapsed && (
                        <span className="relative z-10 flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider text-white bg-white/10 border border-white/10">
                          <span className="live-dot animate-blink" />
                          {tab.badge}
                        </span>
                      )}

                      {/* Soon badge for locked items */}
                      {tab.locked && !isCollapsed && (
                        <span className="relative z-10 px-1.5 py-0.5 rounded text-[8px] font-bold tracking-wider text-amber-300 bg-amber-500/10 border border-amber-500/20">
                          SOON
                        </span>
                      )}

                      {/* Kbd hint — expanded only */}
                      {tab.hint && !isCollapsed && (
                        <span
                          className={`kbd relative z-10 transition-opacity ${
                            isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                          }`}
                        >
                          {tab.hint}
                        </span>
                      )}

                      {/* Collapsed tooltip */}
                      {isCollapsed && (
                        <span className="sidebar-tooltip">{tab.label}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>

        {/* Footer — Credits + User */}
        <div className="boot-fade-up boot-d-6 shrink-0 border-t border-white/[0.05] p-3 flex flex-col gap-2.5">
          {/* Expand button — only when collapsed */}
          {isCollapsed && (
            <button
              onClick={() => setIsCollapsed(false)}
              title="Expand sidebar"
              className="flex items-center justify-center py-2 rounded-lg text-neutral-600 hover:text-white hover:bg-white/5 transition-all"
            >
              <ChevronLeft className="w-4 h-4 rotate-180" />
            </button>
          )}

          {/* Credit balance card — shine hover effect */}
          <button
            onClick={() => setIsTopUpOpen(true)}
            title={isCollapsed ? `${user.credits} credits` : undefined}
            className="fx-hover-shine-card group relative w-full !min-h-0 sidebar-tooltip-target"
          >
            {/* Violet gradient inner layer */}
            <span className="fx-hover-shine-card-inner !text-sm !font-bold !shadow-lg" />
            {/* Content on top of the gradient (z-2 sits above the shine z-1) */}
            <span
              className={`relative z-[2] flex items-center justify-between gap-2 w-full ${
                isCollapsed ? "p-2 justify-center" : "p-2.5"
              }`}
            >
              <div className={`flex items-center gap-2 ${isCollapsed ? "" : "flex-col items-start gap-0"}`}>
                {isCollapsed ? (
                  <div className="w-6 h-6 rounded-md bg-white/15 flex items-center justify-center">
                    <WalletIcon className="w-3.5 h-3.5 text-white" />
                  </div>
                ) : (
                  <div className="flex flex-col gap-0.5 text-left">
                    <span className="text-[9px] uppercase tracking-[0.18em] text-white/60 font-semibold">
                      Credits Balance
                    </span>
                    <span className="text-sm font-bold text-white tabular-nums tracking-tight">
                      {user.credits.toLocaleString()} <span className="text-white/60 font-medium text-xs">cr</span>
                    </span>
                  </div>
                )}
              </div>

              {!isCollapsed && (
                <span className="flex items-center gap-1 text-[11px] py-1 px-2.5 rounded-md bg-white text-black font-bold shadow-md shrink-0">
                  <PlusIcon className="w-3 h-3" />
                  Top Up
                </span>
              )}

              {isCollapsed && (
                <span className="sidebar-tooltip">
                  {user.credits.toLocaleString()} credits · Top Up
                </span>
              )}
            </span>
          </button>

          {/* User profile row */}
          <div className={`flex items-center ${isCollapsed ? "flex-col gap-2" : "items-center justify-between gap-2"} px-1`}>
            <div className={`flex items-center gap-2.5 overflow-hidden ${isCollapsed ? "flex-col" : ""}`}>
              <div className="relative w-9 h-9 shrink-0 rounded-full bg-gradient-to-br from-white/20 via-white/10 to-white/5 border border-white/10 flex items-center justify-center text-[11px] font-bold text-white shadow-md sidebar-tooltip-target">
                {initials}
                <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-[#030304]" style={{ boxShadow: "0 0 8px rgba(34,197,94,0.7)" }} />
                {isCollapsed && (
                  <span className="sidebar-tooltip">{user.email}</span>
                )}
              </div>
              {!isCollapsed && (
                <div className="flex flex-col gap-0.5 overflow-hidden">
                  <span
                    className="text-[11px] font-semibold text-neutral-200 truncate max-w-[120px]"
                    title={user.email}
                  >
                    {user.email}
                  </span>
                  <span className="text-[9px] uppercase tracking-[0.16em] text-neutral-600 font-semibold">
                    {user.isAdmin ? "Administrator" : "Creator Tier"}
                  </span>
                </div>
              )}
            </div>

            {!isCollapsed && (
              <button
                onClick={onLogout}
                title="Sign Out"
                className="p-2 rounded-lg bg-white/[0.025] hover:bg-red-500/10 border border-white/[0.06] hover:border-red-500/30 text-neutral-500 hover:text-red-400 transition-all cursor-pointer shrink-0"
              >
                <LogoutIcon className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* ── Main View Container ──────────────────────────────────────────── */}
      <main className="boot-fade relative z-10 flex-1 flex flex-col max-h-screen overflow-y-auto">
        {/* Top Header — sticky glass */}
        <header className="boot-fade-up boot-d-3 sticky top-0 z-30 flex justify-between items-center px-6 md:px-8 h-[64px] bg-[rgba(3,3,4,0.7)] backdrop-blur-2xl border-b border-white/[0.05] hairline-top">
          {/* Breadcrumb + status */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-[12px]">
              <span className="text-neutral-600 font-medium uppercase tracking-wider text-[11px]">Dashboard</span>
              <span className="text-neutral-800">/</span>
              <span className="text-neutral-100 font-semibold">{activeNavLabel}</span>
            </div>
            <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/[0.06]">
              <span className="status-dot" />
              <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">Online</span>
            </div>
          </div>

          {/* Header actions */}
          <div className="flex items-center gap-2">
            {/* Command palette trigger */}
            <button
              onClick={() => setIsPaletteOpen(true)}
              title="Open command palette (Cmd+K)"
              className="btn-ghost flex items-center gap-2 px-3 py-2 text-xs font-semibold"
            >
              <SearchIcon className="w-3.5 h-3.5 text-neutral-300" />
              <span className="hidden sm:inline">Search</span>
              <span className="flex items-center gap-0.5 text-[10px] text-neutral-600 ml-1">
                <CommandIcon className="w-2.5 h-2.5" />
                <span>K</span>
              </span>
            </button>

            {user.kycStatus === "skipped" && (
              <button
                onClick={() => setIsKycForceOpen(true)}
                className="px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-semibold flex items-center gap-1.5 hover:bg-amber-500/20 active:scale-95 transition-all cursor-pointer shadow-md"
                title="Your identity is unverified. Click here to verify identity now (no credits will be awarded)."
              >
                <span>⚠️</span>
                <span>Verify Account</span>
              </button>
            )}

            {user.isAdmin && (
              <button
                id="btn-admin-panel"
                onClick={() => setIsAdminPanelOpen(true)}
                className="btn-ghost text-xs font-semibold flex items-center gap-2 px-3 py-2"
              >
                <ShieldIcon className="w-3.5 h-3.5 text-amber-300" />
                <span className="hidden sm:inline">Admin</span>
              </button>
            )}

            <button
              onClick={() => setIsLibraryDrawerOpen(true)}
              className="btn-ghost text-xs font-semibold flex items-center gap-2 px-3 py-2"
            >
              <DatabaseIcon className="w-3.5 h-3.5 text-cyan-300" />
              <span className="hidden sm:inline">Storage</span>
            </button>

          </div>
        </header>

        {/* Dynamic Panel Switcher */}
        <div className="boot-fade boot-d-4 flex-1 px-6 md:px-8 py-6">
          <div key={activeTab} className="animate-fade-in-up h-full">
            {activeTab === "storyboard" && (
              <ComingSoon feature="Script & Story" />
            )}

            {activeTab === "broll" && (
              <ComingSoon feature="B-Roll Studio" />
            )}

            {activeTab === "character" && (
              <ComingSoon feature="Character Forge" />
            )}

            {activeTab === "voice" && (
              <ComingSoon feature="AI Voice Lab" />
            )}

            {activeTab === "stream" && (
              <LiveAvatarStream
                user={user}
                onLogout={onLogout}
                onBalanceUpdated={onBalanceUpdated}
              />
            )}

            {activeTab === "timeline" && (
              <ComingSoon feature="Timeline Assembler" />
            )}

            {activeTab === "library" && (
              <div className="glass-panel p-6 rounded-2xl">
                <LibraryPanel
                  onUseAsReference={handleUseAsReference}
                  onAddToTimeline={handleAddToTimeline}
                />
              </div>
            )}
          </div>
        </div>
      </main>

      {/* ── Slide-out Right Library Drawer ────────────────────────────────── */}
      {isLibraryDrawerOpen && (
        <>
          <div
            onClick={() => setIsLibraryDrawerOpen(false)}
            className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm animate-fade-in"
          />
          <div className="fixed inset-y-0 right-0 w-[440px] max-w-[90vw] z-50 animate-slideLeft">
            <div className="h-full bg-[rgba(6,6,8,0.9)] backdrop-blur-2xl border-l border-white/[0.08] shadow-2xl">
              <LibraryPanel
                compact
                onClose={() => setIsLibraryDrawerOpen(false)}
                onUseAsReference={handleUseAsReference}
                onAddToTimeline={handleAddToTimeline}
              />
            </div>
          </div>
        </>
      )}

      {/* Command Palette */}
      <CommandPalette
        open={isPaletteOpen}
        actions={paletteActions}
        onClose={() => setIsPaletteOpen(false)}
      />

      {/* Billing Top Up modal overlay */}
      {isTopUpOpen && (
        <TopUpModal
          userEmail={user.email}
          onClose={() => setIsTopUpOpen(false)}
          onBalanceUpdated={onBalanceUpdated}
        />
      )}

      {/* Admin Panel modal overlay */}
      {isAdminPanelOpen && (
        <AdminPanel
          currentUserId={user.id}
          onClose={() => setIsAdminPanelOpen(false)}
          onBalanceUpdated={onBalanceUpdated}
        />
      )}
      {/* KYC / Terms Gate Lockscreen Overlay */}
      {(!user.termsAcceptedAt || user.kycStatus === "none") && (
        <TermsAndKycModal
          userEmail={user.email}
          onClose={onBalanceUpdated}
          onBalanceUpdated={onBalanceUpdated}
          initialStep={!user.termsAcceptedAt ? "terms" : "kyc"}
        />
      )}

      {/* KYC Verification manual trigger */}
      {isKycForceOpen && (
        <TermsAndKycModal
          userEmail={user.email}
          onClose={() => setIsKycForceOpen(false)}
          onBalanceUpdated={onBalanceUpdated}
          initialStep="kyc"
          forfeitedCreditsWarningOnly={true}
        />
      )}
    </div>
  );
}
