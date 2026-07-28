"use client";

import { useEffect, useRef, useState, useMemo, useCallback, type KeyboardEvent, type ChangeEvent, type CSSProperties } from "react";
import { getAllTimezones, tzLabel, tzOffsetMinutes } from "@/lib/timezones";

interface TimezoneSelectProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  maxHeight?: number;
  searchMode?: "startsWith" | "includes";
}

/* ── Inline style objects ── */
const S: Record<string, CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    width: "100%",
    maxWidth: "100%",
    position: "relative",
  },
  label: {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--muted, #6b7280)",
    textTransform: "uppercase",
    letterSpacing: "0.4px",
    cursor: "pointer",
  },
  trigger: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    padding: "9px 12px",
    borderRadius: 8,
    border: "1px solid var(--line, #d1d5db)",
    background: "#fff",
    fontSize: 13,
    color: "#111",
    cursor: "pointer",
    transition: "border-color 0.15s, box-shadow 0.15s",
    textAlign: "left" as const,
    fontFamily: "inherit",
  },
  triggerDisabled: {
    color: "#9ca3af",
    cursor: "not-allowed",
  },
  value: {
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  arrow: {
    marginLeft: 8,
    fontSize: 10,
    color: "#6b7280",
    flexShrink: 0,
  },
  dropdown: {
    position: "absolute",
    top: "calc(100% + 4px)",
    left: 0,
    right: 0,
    background: "#fff",
    border: "1px solid var(--line, #d1d5db)",
    borderRadius: 8,
    boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
    zIndex: 50,
    overflow: "hidden",
  },
  searchWrap: {
    padding: "8px 8px 4px",
    borderBottom: "1px solid var(--line, #e5e7eb)",
  },
  searchInput: {
    width: "100%",
    padding: "7px 10px",
    border: "1px solid var(--line, #d1d5db)",
    borderRadius: 6,
    fontSize: 13,
    color: "#111",
    background: "#fafafa",
    outline: "none",
    transition: "border-color 0.15s, box-shadow 0.15s",
    fontFamily: "inherit",
    boxSizing: "border-box" as const,
  },
  list: {
    overflowY: "auto",
  },
  option: {
    padding: "7px 12px",
    fontSize: 12.5,
    color: "#111",
    cursor: "pointer",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  optionHover: {
    background: "#f3f4f6",
  },
  optionSelected: {
    background: "#f0f4ff",
    color: "#1e3a8a",
    fontWeight: 500,
  },
  empty: {
    padding: 12,
    fontSize: 13,
    color: "#9ca3af",
    textAlign: "center" as const,
  },
};

export function TimezoneSelect({
  value,
  onChange,
  label = "Timezone",
  placeholder = "Search timezones…",
  disabled = false,
  className = "",
  maxHeight = 180,
  searchMode = "includes",
}: TimezoneSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const allTimezones = useMemo(() => {
    return getAllTimezones().slice().sort((a, b) => {
      const diff = tzOffsetMinutes(a) - tzOffsetMinutes(b);
      return diff !== 0 ? diff : a.localeCompare(b);
    });
  }, []);

  const filteredTimezones = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allTimezones;
    if (searchMode === "startsWith") {
      return allTimezones.filter(
        (tz) => tz.toLowerCase().startsWith(q) || tzLabel(tz).toLowerCase().startsWith(q)
      );
    }
    return allTimezones.filter(
      (tz) => tz.toLowerCase().includes(q) || tzLabel(tz).toLowerCase().includes(q)
    );
  }, [allTimezones, search, searchMode]);

  const selectedLabel = useMemo(() => tzLabel(value), [value]);

  /* close on outside click */
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearch("");
        setHighlightedIndex(-1);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  /* focus search input & scroll to selected when opened */
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 0);
      const idx = filteredTimezones.findIndex((tz) => tz === value);
      setTimeout(() => setHighlightedIndex(idx >= 0 ? idx : 0), 0);
    } else {
      setTimeout(() => {
        setHighlightedIndex(-1);
        setSearch("");
      }, 0);
    }
  }, [isOpen, filteredTimezones, value]);

  /* scroll highlighted option into view */
  const scrollHighlightedIntoView = useCallback(() => {
    if (highlightedIndex < 0 || !listRef.current) return;
    const option = listRef.current.children[highlightedIndex] as HTMLElement;
    if (option) option.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex]);

  useEffect(() => {
    scrollHighlightedIntoView();
  }, [highlightedIndex, scrollHighlightedIntoView]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setHighlightedIndex((i) => Math.min(i + 1, filteredTimezones.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setHighlightedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (highlightedIndex >= 0 && filteredTimezones[highlightedIndex]) {
            onChange(filteredTimezones[highlightedIndex]);
            setIsOpen(false);
          }
          break;
        case "Escape":
          e.preventDefault();
          setIsOpen(false);
          break;
        case "Tab":
          setIsOpen(false);
          break;
        default:
          break;
      }
    },
    [filteredTimezones, highlightedIndex, onChange]
  );

  const handleSearchChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
    setHighlightedIndex(0);
  }, []);

  const handleOptionClick = useCallback(
    (tz: string) => {
      onChange(tz);
      setIsOpen(false);
      setSearch("");
    },
    [onChange]
  );

  const toggleOpen = useCallback(() => {
    if (!disabled) {
      setIsOpen((prev) => !prev);
    }
  }, [disabled]);

  return (
    <div className={className} style={S.root} ref={containerRef}>
      {label && (
        <label style={S.label} onClick={toggleOpen}>
          {label}
        </label>
      )}

      {/* Trigger — shows the currently selected timezone */}
      <button
        type="button"
        style={{
          ...S.trigger,
          ...(disabled ? S.triggerDisabled : {}),
        }}
        onClick={toggleOpen}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span style={S.value}>{selectedLabel || "Select timezone…"}</span>
        <span style={S.arrow} aria-hidden="true">
          {isOpen ? "▲" : "▼"}
        </span>
      </button>

      {/* Dropdown — opens below with a search bar at the top */}
      {isOpen && (
        <div style={S.dropdown}>
          <div style={S.searchWrap}>
            <input
              ref={searchInputRef}
              type="text"
              style={S.searchInput}
              value={search}
              onChange={handleSearchChange}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div
            ref={listRef}
            role="listbox"
            style={{ ...S.list, maxHeight }}
          >
            {filteredTimezones.length === 0 ? (
              <div style={S.empty}>No timezones match &ldquo;{search}&rdquo;</div>
            ) : (
              filteredTimezones.map((tz, idx) => {
                const isSelected = tz === value;
                const isHighlighted = idx === highlightedIndex;
                return (
                  <div
                    key={tz}
                    role="option"
                    aria-selected={isSelected}
                    style={{
                      ...S.option,
                      ...(isHighlighted ? S.optionHover : {}),
                      ...(isSelected ? S.optionSelected : {}),
                    }}
                    onClick={() => handleOptionClick(tz)}
                    onMouseEnter={() => setHighlightedIndex(idx)}
                  >
                    {tzLabel(tz)}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}