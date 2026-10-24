/**
 * SessionFilter — A fully reusable date-range filter component.
 *
 * Features:
 * - Single "Filter" button that displays the active filter label.
 * - Dropdown panel with pill-style preset options (1 Day, 3 Days, 7 Days, 15 Days).
 * - Custom date range picker with Start Date and End Date inputs.
 * - "Clear Filter" text button shown only when a filter is active.
 * - Smooth open/close animation, outside-click detection.
 * - Fully responsive on mobile, tablet, and desktop.
 * - Date display format: DD/MM/YYYY everywhere.
 *
 * Usage:
 *   <SessionFilter onFilterChange={({ filterType, startDate, endDate }) => { ... }} />
 */

import React, { useState, useRef, useEffect, useCallback } from "react";
import { FunnelSimple, CaretDown, Calendar } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    getTerminologyPlural,
} from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";

// ─── Types ───────────────────────────────────────────────────────────────────

/** Preset filter identifier */
export type FilterPreset = "none" | "1day" | "3days" | "7days" | "15days" | "custom";

/** Data returned to the parent via onFilterChange */
export interface FilterChangePayload {
    /** Which preset is active ("none" means cleared) */
    filterType: FilterPreset;
    /** ISO date string YYYY-MM-DD (empty when cleared) */
    startDate: string;
    /** ISO date string YYYY-MM-DD (empty when cleared) */
    endDate: string;
}

/** Props accepted by the SessionFilter component */
export interface SessionFilterProps {
    /** Called whenever the filter selection changes */
    onFilterChange: (payload: FilterChangePayload) => void;
    /** Initial preset to select on mount (default: "none") */
    defaultFilter?: FilterPreset;
    /** Horizontal alignment of the dropdown relative to the button */
    alignment?: "left" | "right";
    /** Extra CSS classes on the wrapper */
    className?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Convert a Date object to YYYY-MM-DD string */
const toISO = (d: Date): string => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
};

/** Convert YYYY-MM-DD → DD/MM/YYYY for display */
const toDisplay = (iso: string): string => {
    if (!iso) return "";
    const [y, m, d] = iso.split("-");
    if (!y || !m || !d) return iso;
    return `${d}/${m}/${y}`;
};

/** Map of preset keys to number of days in the future */
const PRESET_DAYS: Record<string, number> = {
    "1day": 1,
    "3days": 3,
    "7days": 7,
    "15days": 15,
};

/** Translation keys for each preset's human-readable label */
const PRESET_LABEL_KEYS: Record<string, string> = {
    "1day": "sessionFilter.presets.oneDay",
    "3days": "sessionFilter.presets.threeDays",
    "7days": "sessionFilter.presets.sevenDays",
    "15days": "sessionFilter.presets.fifteenDays",
};

// ─── Component ───────────────────────────────────────────────────────────────

export function SessionFilter({
    onFilterChange,
    defaultFilter = "none",
    alignment = "right",
    className = "",
}: SessionFilterProps) {
    const { t } = useTranslation("layoutCommonA");
    const presetLabel = (key: string): string =>
        PRESET_LABEL_KEYS[key] ? t(PRESET_LABEL_KEYS[key]) : "";
    // Internal state
    const [preset, setPreset] = useState<FilterPreset>(defaultFilter);
    const [startDate, setStartDate] = useState("");
    const [endDate, setEndDate] = useState("");
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    // ── Close on outside click ──────────────────────────────────────────────
    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [open]);

    // ── Apply a default preset on mount if provided ─────────────────────────
    useEffect(() => {
        if (defaultFilter !== "none" && defaultFilter !== "custom") {
            applyPreset(defaultFilter, true);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Notify parent ───────────────────────────────────────────────────────
    const notify = useCallback(
        (type: FilterPreset, start: string, end: string) => {
            onFilterChange({ filterType: type, startDate: start, endDate: end });
        },
        [onFilterChange],
    );

    // ── Apply a preset filter ───────────────────────────────────────────────
    const applyPreset = (p: FilterPreset, silent = false) => {
        setPreset(p);

        if (p === "none") {
            setStartDate("");
            setEndDate("");
            setOpen(false);
            if (!silent) notify("none", "", "");
            return;
        }

        if (p === "custom") {
            // Keep the dropdown open so the user can pick dates
            return;
        }

        // Calculate date range for numeric presets
        const today = new Date();
        const days = PRESET_DAYS[p] ?? 7;
        const end = new Date(today);
        end.setDate(today.getDate() + days);

        const isoStart = toISO(today);
        const isoEnd = toISO(end);
        setStartDate(isoStart);
        setEndDate(isoEnd);
        setOpen(false);
        if (!silent) notify(p, isoStart, isoEnd);
    };

    // ── Clear all filters ───────────────────────────────────────────────────
    const clearAll = () => {
        setPreset("none");
        setStartDate("");
        setEndDate("");
        setOpen(false);
        notify("none", "", "");
    };

    // ── Derive display label ────────────────────────────────────────────────
    const label = (): string => {
        if (preset === "custom") {
            if (startDate && endDate) return `${toDisplay(startDate)} - ${toDisplay(endDate)}`;
            if (startDate) return t("sessionFilter.fromDate", { date: toDisplay(startDate) });
            if (endDate) return t("sessionFilter.untilDate", { date: toDisplay(endDate) });
            return t("sessionFilter.custom");
        }
        return presetLabel(preset);
    };

    const isActive = preset !== "none";
    const todayISO = toISO(new Date());

    // ── Render ──────────────────────────────────────────────────────────────
    return (
        <div className={`relative ${className}`} ref={ref}>
            {/* ── Trigger row ─────────────────────────────────────────────────── */}
            <div className="flex items-center gap-2">
                {/* Clear Filter — only when active */}
                {isActive && (
                    <button
                        onClick={clearAll}
                        className="text-caption font-medium text-neutral-500 dark:text-neutral-400 hover:text-red-500 dark:hover:text-red-400 transition-colors whitespace-nowrap"
                    >
                        {t("sessionFilter.clearFilter")}
                    </button>
                )}

                {/* Filter button */}
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setOpen((v) => !v)}
                    className={`h-8 ps-2.5 pe-2 text-body font-medium rounded-lg transition-all duration-200 gap-1.5 ${isActive
                            ? "border-primary-200 bg-primary-50 text-primary-500 shadow-sm hover:bg-primary-100"
                            : "border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800"
                        }`}
                >
                    <FunnelSimple size={14} weight={isActive ? "fill" : "regular"} />
                    <span>{isActive ? label() : t("sessionFilter.filter")}</span>
                    <CaretDown
                        size={11}
                        className={`transition-transform duration-300 ease-out ${open ? "rotate-180" : ""}`}
                    />
                </Button>
            </div>

            {/* ── Dropdown panel ──────────────────────────────────────────────── */}
            <div
                className={`absolute z-30 mt-2 w-[calc(100vw-2rem)] sm:w-80 origin-top-${alignment} transition-all duration-250 ease-out ${alignment === "left" ? "start-0" : "end-0" /* design-lint-ignore: viewport math */
                    } ${open
                        ? "opacity-100 scale-100 translate-y-0 pointer-events-auto"
                        : "opacity-0 scale-95 -translate-y-1 pointer-events-none"
                    }`}
            >
                <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl shadow-lg shadow-black/8 dark:shadow-black/30 overflow-hidden">
                    {/* ── Preset pills ─────────────────────────────────────────── */}
                    <div className="p-3 pb-2.5 space-y-2">
                        <p className="text-3xs font-bold uppercase tracking-wide-08 text-neutral-400 dark:text-neutral-500 px-0.5">
                            {t("sessionFilter.showSessionsInNext", {
                                sessions: getTerminologyPlural(ContentTerms.Session, SystemTerms.Session),
                            })}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                            {(["1day", "3days", "7days", "15days"] as FilterPreset[]).map((key) => (
                                <button
                                    key={key}
                                    onClick={() => applyPreset(key)}
                                    className={`px-3 py-1.5 rounded-lg text-body font-medium border transition-all duration-150 whitespace-nowrap ${preset === key
                                            ? "bg-primary-500 text-white border-primary-500 shadow-sm"
                                            : "bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 border-neutral-200 dark:border-neutral-600 hover:border-primary-300 hover:text-primary-500"
                                        }`}
                                >
                                    {presetLabel(key)}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* ── Custom range toggle ──────────────────────────────────── */}
                    <div className="px-3 pb-3">
                        <button
                            onClick={() => applyPreset("custom")}
                            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-body font-medium border transition-all duration-150 ${preset === "custom"
                                    ? "bg-primary-50 text-primary-500 border-primary-200"
                                    : "bg-white dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 border-neutral-200 dark:border-neutral-600 hover:border-primary-300 hover:text-primary-500"
                                }`}
                        >
                            <div className="flex items-center gap-2">
                                <Calendar size={14} />
                                <span>{t("sessionFilter.customRange")}</span>
                            </div>
                            <CaretDown
                                size={11}
                                className={`transition-transform duration-300 ${preset === "custom" ? "rotate-180" : ""}`}
                            />
                        </button>

                        {/* ── Date pickers (animated reveal) ─────────────────────── */}
                        <div
                            className={`overflow-hidden transition-all duration-300 ease-out ${preset === "custom"
                                    ? "max-h-reg-180 opacity-100 mt-2"
                                    : "max-h-0 opacity-0 mt-0"
                                }`}
                        >
                            <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-1">
                                    <label className="block text-3xs font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500 px-0.5">
                                        {t("sessionFilter.fromLabel")}
                                    </label>
                                    <Input
                                        type="date"
                                        value={startDate}
                                        min={todayISO}
                                        onChange={(e) => setStartDate(e.target.value)}
                                        className="w-full text-xs h-8 rounded-lg text-neutral-700 dark:text-neutral-200"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="block text-3xs font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500 px-0.5">
                                        {t("sessionFilter.toLabel")}
                                    </label>
                                    <Input
                                        type="date"
                                        value={endDate}
                                        min={startDate || todayISO}
                                        onChange={(e) => setEndDate(e.target.value)}
                                        className="w-full text-xs h-8 rounded-lg text-neutral-700 dark:text-neutral-200"
                                    />
                                </div>
                            </div>
                            {startDate && endDate && (
                                <Button
                                    size="sm"
                                    className="w-full h-7 text-xs mt-2 rounded-lg bg-primary-500 hover:bg-primary-400 text-white shadow-sm"
                                    onClick={() => {
                                        setOpen(false);
                                        notify("custom", startDate, endDate);
                                    }}
                                >
                                    {t("sessionFilter.applyRange")}
                                </Button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default SessionFilter;
