// ============================================================================
// DiipMynd — CommandPalette (Cmd+K)
//
// Pure-monochrome command palette with:
//   - Fuzzy-weighted search (label > subtitle > keywords)
//   - Arrow / enter / escape keyboard navigation
//   - Sectioned groups (Recent / Studios / Actions / Account)
//   - localStorage-tracked recents (max 5)
//   - Auto-focus + scroll-to-active behavior
//   - Backdrop click + Escape to close
//
// All actions are passed in by the parent — this component is dumb/stateless
// except for query + selection state.
// ============================================================================

"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";

// ── Types ──────────────────────────────────────────────────────────────────
export interface CommandAction {
  id: string;
  label: string;
  subtitle?: string;
  keywords?: string;
  group: "recent" | "studios" | "actions" | "assets" | "account";
  shortcut?: string;          // e.g. "1", "⌘ B"
  icon?: React.ReactNode;     // 16x16 SVG node
  thumbnail?: string;         // URL — if present, shows instead of icon (for asset rows)
  onSelect: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  actions: CommandAction[];
  onClose: () => void;
}

const RECENTS_KEY = "dm-cmdk-recents";
const MAX_RECENTS = 5;

// ── Fuzzy match ─────────────────────────────────────────────────────────────
// Returns a score (lower = better match) or -1 if no match.
// Matches against label, subtitle, and keywords. Boosts prefix matches.
function fuzzyScore(query: string, action: CommandAction): number {
  if (!query) return 0;
  const q = query.toLowerCase().trim();
  if (!q) return 0;

  const label = action.label.toLowerCase();
  const sub   = (action.subtitle ?? "").toLowerCase();
  const kw    = (action.keywords ?? "").toLowerCase();

  // Direct substring match on label — strongest signal
  if (label.includes(q)) {
    const idx = label.indexOf(q);
    return idx === 0 ? 0 : 1 + idx * 0.01;  // prefix is best
  }
  // Subtitle match
  if (sub.includes(q)) return 5;
  // Keyword match
  if (kw.includes(q)) return 8;

  // Subsequence match (fuzzy) on label
  let qi = 0;
  let gaps = 0;
  for (let li = 0; li < label.length && qi < q.length; li++) {
    if (label[li] === q[qi]) {
      qi++;
    } else {
      gaps++;
    }
  }
  if (qi === q.length) return 10 + gaps;
  return -1;
}

// ── Recents helpers ─────────────────────────────────────────────────────────
function loadRecents(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string").slice(0, MAX_RECENTS) : [];
  } catch {
    return [];
  }
}

function saveRecent(id: string) {
  if (typeof window === "undefined") return;
  try {
    const current = loadRecents();
    const next = [id, ...current.filter((x) => x !== id)].slice(0, MAX_RECENTS);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* noop */
  }
}

// ── Group labels ────────────────────────────────────────────────────────────
const GROUP_LABELS: Record<CommandAction["group"], string> = {
  recent:  "Recent",
  studios: "Studios",
  actions: "Quick Actions",
  assets:  "Workspace Assets",
  account: "Account",
};
const GROUP_ORDER: CommandAction["group"][] = ["recent", "studios", "actions", "assets", "account"];

// ── Component ───────────────────────────────────────────────────────────────
export default function CommandPalette({ open, actions, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [recents, setRecents] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const activeRowRef = useRef<HTMLDivElement>(null);

  // Load recents on open
  useEffect(() => {
    if (open) {
      setRecents(loadRecents());
      setQuery("");
      setActiveIndex(0);
    }
  }, [open]);

  // Auto-focus the input when opened
  useEffect(() => {
    if (open && inputRef.current) {
      // small delay so the mount animation has time to lay out
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Reset selection when query changes
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // ── Build filtered + grouped list ────────────────────────────────────────
  const filtered = useMemo(() => {
    // If query is empty, surface recents first (only those that exist in actions)
    if (!query.trim()) {
      const recentActions = recents
        .map((id) => actions.find((a) => a.id === id))
        .filter(Boolean) as CommandAction[];
      const rest = actions.filter((a) => !recents.includes(a.id));
      // Tag recent actions with group: "recent" for display purposes
      return [
        ...recentActions.map((a) => ({ ...a, group: "recent" as const })),
        ...rest,
      ];
    }
    // Filter by fuzzy score
    return actions
      .map((a) => ({ action: a, score: fuzzyScore(query, a) }))
      .filter((x) => x.score >= 0)
      .sort((a, b) => a.score - b.score)
      .map((x) => x.action);
  }, [actions, query, recents]);

  // Group filtered actions, preserving order
  const grouped = useMemo(() => {
    const map = new Map<CommandAction["group"], CommandAction[]>();
    for (const a of filtered) {
      if (!map.has(a.group)) map.set(a.group, []);
      map.get(a.group)!.push(a);
    }
    return GROUP_ORDER
      .map((g) => ({ group: g, items: map.get(g) ?? [] }))
      .filter((x) => x.items.length > 0);
  }, [filtered]);

  // Flat index → action lookup for keyboard nav
  const flatActions = grouped.flatMap((g) => g.items);

  // ── Execute an action ─────────────────────────────────────────────────────
  const executeAction = useCallback((action: CommandAction) => {
    saveRecent(action.id);
    action.onSelect();
    onClose();
  }, [onClose]);

  // ── Keyboard handler ──────────────────────────────────────────────────────
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => Math.min(prev + 1, flatActions.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const action = flatActions[activeIndex];
      if (action) executeAction(action);
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      setActiveIndex(flatActions.length - 1);
      return;
    }
  }, [flatActions, activeIndex, executeAction, onClose]);

  // ── Scroll active row into view ───────────────────────────────────────────
  useEffect(() => {
    if (activeRowRef.current) {
      activeRowRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [activeIndex]);

  // ── Backdrop click handler ────────────────────────────────────────────────
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  if (!open) return null;

  // Compute flat-index offset for each group so we know which row is "active"
  let runningIndex = 0;

  return (
    <>
      {/* Backdrop */}
      <div
        className="cmdk-backdrop"
        onClick={handleBackdropClick}
        aria-hidden="true"
      />

      {/* Shell */}
      <div
        className="cmdk-shell"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={handleKeyDown}
      >
        {/* Input row */}
        <div className="cmdk-input-row">
          <SearchIcon className="w-4 h-4 text-neutral-600" />
          <input
            ref={inputRef}
            className="cmdk-input"
            placeholder="Search studios, actions, or jump to…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
          <span className="kbd">ESC</span>
          {/* Subtle asset-count hint when assets are present */}
          {actions.some((a) => a.group === "assets") && (
            <span className="text-[10px] text-neutral-700 font-medium ml-2 hidden sm:inline">
              {actions.filter((a) => a.group === "assets").length} assets indexed
            </span>
          )}
        </div>

        {/* List */}
        <div ref={listRef} className="cmdk-list">
          {flatActions.length === 0 ? (
            <div className="cmdk-empty">
              No results for &ldquo;{query}&rdquo;
            </div>
          ) : (
            grouped.map(({ group, items }) => {
              const groupStart = runningIndex;
              runningIndex += items.length;
              return (
                <div key={group}>
                  <div className="cmdk-group-label">{GROUP_LABELS[group]}</div>
                  {items.map((action, i) => {
                    const flatIdx = groupStart + i;
                    const isActive = flatIdx === activeIndex;
                    return (
                      <div
                        key={action.id}
                        ref={isActive ? activeRowRef : null}
                        className="cmdk-row"
                        data-active={isActive}
                        onMouseMove={() => setActiveIndex(flatIdx)}
                        onClick={() => executeAction(action)}
                      >
                        {action.thumbnail ? (
                          <img
                            src={action.thumbnail}
                            alt=""
                            className="cmdk-row-thumbnail"
                            loading="lazy"
                          />
                        ) : (
                          <div className="cmdk-row-icon">
                            {action.icon ?? <DotIcon className="w-3 h-3" />}
                          </div>
                        )}
                        <div className="cmdk-row-label">
                          <span className="cmdk-row-title">{action.label}</span>
                          {action.subtitle && (
                            <span className="cmdk-row-sub">{action.subtitle}</span>
                          )}
                        </div>
                        {action.shortcut && (
                          <span className="cmdk-row-kbd">{action.shortcut}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="cmdk-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd>navigate</span>
          <span><kbd>↵</kbd>select</span>
          <span><kbd>esc</kbd>close</span>
          <span className="ml-auto opacity-50">DiipMynd · Cmd+K</span>
        </div>
      </div>
    </>
  );
}

// ── Inline icons ────────────────────────────────────────────────────────────
function SearchIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}
function DotIcon({ className = "w-3 h-3" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
