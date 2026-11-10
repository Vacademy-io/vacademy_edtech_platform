import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

/**
 * LIVE NOW, only while a class is actually live (now between its start and its
 * last entry time). `onLive` is the white chip on the rose live card; `solid`
 * is the rose chip for a white ground.
 *
 * OWNER DEFAULT (unconfirmed): solid rose "LIVE NOW" only while live; a later
 * class gets <CalendarChip /> and never the word "live".
 */
export function LiveChip({ tone = "onLive", className }: { tone?: "onLive" | "solid"; className?: string }) {
  const { t } = useTranslation("funCommon");
  return (
    <span className={cn("fun-chip", tone === "solid" ? "fun-chip--live-solid" : "fun-chip--live", className)}>
      <span className="fun-chip__dot" aria-hidden="true" />
      {t("liveNow")}
    </span>
  );
}

/** A class later on: white chip with a calendar. The caller formats the time ("TODAY 5:00 PM"). */
export function CalendarChip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("fun-chip fun-chip--calendar", className)}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="5" width="18" height="16" rx="3" />
        <path d="M3 10 H21 M8 3 V7 M16 3 V7" />
      </svg>
      {children}
    </span>
  );
}

/** NEW: the first course a new learner is offered. Ink on the highlight yellow. */
export function NewChip({ className }: { className?: string }) {
  const { t } = useTranslation("funCommon");
  return <span className={cn("fun-chip fun-chip--new", className)}>{t("new")}</span>;
}
