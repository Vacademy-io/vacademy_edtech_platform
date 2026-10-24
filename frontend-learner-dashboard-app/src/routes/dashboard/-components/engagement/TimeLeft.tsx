import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Clock } from "@phosphor-icons/react";
import { isUrgent, timeLeftLabel } from "./engagement-visuals";
import { ecn, skinClasses } from "./engagement-tone";
import { useServerClockSkew } from "./use-engagement-feed";

/**
 * Server "now" that re-renders every `intervalMs` while `enabled`, and re-syncs
 * when the tab becomes visible or focused (timers are throttled in the
 * background, which on mobile is most of the time). The skew comes from the
 * feed hook's shared server-time query, so every countdown on the page costs
 * one request in total, not one per row.
 */
function useTickingServerNow(enabled: boolean, intervalMs: number): number {
  const skew = useServerClockSkew();
  const [deviceNow, setDeviceNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) return;
    const sync = () => setDeviceNow(Date.now());
    sync();
    const timer = window.setInterval(sync, intervalMs);
    const onVisible = () => {
      if (!document.hidden) sync();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", sync);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", sync);
    };
  }, [enabled, intervalMs]);

  return deviceNow + skew;
}

export interface TimeLeftProps {
  /** ISO instant the task closes. Nothing renders when absent or invalid. */
  closesAt?: string | null;
  /**
   * What to show once the deadline has passed: "Closed" (default) or nothing.
   * A row past its close goes muted and reads "Closed" (D32).
   */
  whenPassed?: "closed" | "hide";
  /** Show the clock icon (default true). */
  showIcon?: boolean;
  className?: string;
}

/**
 * "4h 12m left", on the server clock (D32). Under 2 h it
 * turns urgent (warning ink; still readable without colour, because the words
 * carry the time).
 */
export function TimeLeft({
  closesAt,
  whenPassed = "closed",
  showIcon = true,
  className,
}: TimeLeftProps) {
  const { t } = useTranslation("dashboardEngagement");
  const end = closesAt ? new Date(closesAt).getTime() : NaN;
  const valid = Number.isFinite(end);
  // Tick every 30 s: minutes are the finest unit shown.
  const now = useTickingServerNow(valid, 30_000);
  if (!valid) return null;

  const label = timeLeftLabel(t, closesAt, now);
  if (!label) {
    if (whenPassed === "hide") return null;
    return (
      <span
        className={ecn(
          "inline-flex items-center gap-1 text-caption",
          skinClasses("mutedInk"),
          className
        )}
      >
        {showIcon && <Clock aria-hidden className="size-3.5 shrink-0" />}
        {t("time.closed")}
      </span>
    );
  }

  const urgent = isUrgent(closesAt, now);
  return (
    <time
      dateTime={closesAt ?? undefined}
      className={ecn(
        "inline-flex items-center gap-1 text-caption tabular-nums",
        urgent
          ? "font-medium text-warning-700 [.ui-play_&]:text-play-warn-soft-ink [.ui-cleaner-play_&]:text-cp-terracotta"
          : skinClasses("mutedInk"),
        className
      )}
    >
      {showIcon && (
        <Clock aria-hidden weight={urgent ? "bold" : "regular"} className="size-3.5 shrink-0" />
      )}
      {label}
    </time>
  );
}
