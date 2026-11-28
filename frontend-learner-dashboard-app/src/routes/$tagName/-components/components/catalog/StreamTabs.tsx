import React, { useRef } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useSiteT } from "../../../-utils/catalogue-locale";
import type { StreamLabelMode } from "./catalog-config";
import { nextTabIndex, streamTabId, streamTabText, type CatalogStream } from "./catalog-streams";

/**
 * "All courses · शिक्षा · कला …" — the Courses page's stream tabs. Sticky
 * under the fixed site header (h-16 / md:h-20) when `sticky`, and a single
 * horizontally scrolling row on small screens. Folder titles are live data,
 * so they go through the site dictionary at display time.
 *
 * ARIA tabs with manual activation: only the selected tab is in the Tab
 * order, arrow keys / Home / End move between tabs, Enter or Space selects
 * (selecting pushes a history entry, so it never happens on a mere arrow
 * press). `controlsId` is the id of the tab panel below.
 */
export const StreamTabs: React.FC<{
  streams: CatalogStream[];
  active: string | null;
  allLabel: string;
  labelMode: StreamLabelMode;
  sticky: boolean;
  onSelect: (slug: string | null) => void;
  controlsId?: string;
}> = ({ streams, active, allLabel, labelMode, sticky, onSelect, controlsId }) => {
  const { t } = useTranslation("coursePlayerB");
  const siteT = useSiteT();
  const listRef = useRef<HTMLDivElement | null>(null);
  if (!streams.length) return null;

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const list = listRef.current;
    if (!list) return;
    const tabs = Array.from(list.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const rtl = getComputedStyle(list).direction === "rtl";
    const next = nextTabIndex(e.key, tabs.indexOf(e.currentTarget), tabs.length, rtl);
    if (next === null) return;
    e.preventDefault();
    tabs[next]?.focus();
  };

  const tab = (key: string, slug: string | null, primary: string, secondary: string, comingSoon: boolean) => {
    const selected = active === slug;
    return (
      <button
        key={key}
        id={controlsId ? streamTabId(controlsId, slug) : undefined}
        type="button"
        role="tab"
        aria-selected={selected}
        aria-controls={controlsId}
        tabIndex={selected ? 0 : -1}
        onClick={() => onSelect(slug)}
        onKeyDown={onKeyDown}
        className={cn(
          "catalogue-tap flex shrink-0 snap-start flex-col items-start justify-center rounded-catalogue-full border px-4 py-1.5 text-start transition-colors",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400",
          selected
            ? "border-primary-500 bg-primary-500 text-white"
            : "border-catalogue-border bg-catalogue-bg-elevated text-catalogue-text-secondary hover:border-catalogue-border-strong hover:text-catalogue-text-primary",
        )}
      >
        <span className="flex items-center gap-1.5 whitespace-nowrap text-sm font-semibold leading-tight">
          {primary}
          {comingSoon && (
            <span
              className={cn(
                "rounded-catalogue-full px-1.5 py-px text-3xs font-semibold uppercase tracking-wide",
                selected ? "bg-white/20 text-white" : "bg-primary-50 text-primary-500",
              )}
            >
              {t("courseCatalog.streamSoon", "Soon")}
            </span>
          )}
        </span>
        {secondary && (
          <span
            className={cn(
              "whitespace-nowrap text-3xs font-medium uppercase tracking-wide-08",
              selected ? "text-white/80" : "text-catalogue-text-muted",
            )}
          >
            {secondary}
          </span>
        )}
      </button>
    );
  };

  return (
    <div
      className={cn(
        "-mx-4 mb-5 border-b border-catalogue-border-subtle bg-catalogue-bg-subtle px-4 py-2.5 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8",
        sticky && "sticky top-16 z-20 md:top-20",
      )}
    >
      <div
        ref={listRef}
        role="tablist"
        aria-orientation="horizontal"
        aria-label={t("courseCatalog.streamsAriaLabel", "Streams")}
        className="catalogue-no-scrollbar flex snap-x gap-2 overflow-x-auto"
      >
        {tab("__all__", null, allLabel || t("courseCatalog.allCourses", "All courses"), "", false)}
        {streams.map((s) => {
          const text = streamTabText(
            { title: siteT(s.title), subtitle: siteT(s.subtitle), slug: s.slug },
            labelMode,
          );
          return tab(s.id, s.slug, text.primary, text.secondary, s.comingSoon);
        })}
      </div>
    </div>
  );
};
