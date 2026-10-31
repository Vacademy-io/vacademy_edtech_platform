import { CheckCircle, CircleDashed } from "@phosphor-icons/react";
import { ecn, outcomeClasses, skinClasses } from "../engagement-tone";

/**
 * What still stands between the learner and the task's button (D27): a reading's
 * "Reached the end" and "Keep reading · 0:09", a game's "Keep playing · 0:05".
 *
 * A `role="status"` region, so a gate turning done is announced once; the
 * countdown text itself is `aria-hidden` per tick and summarised in `srLabel`,
 * so a screen reader isn't read a new number every second.
 */

export interface GateItem {
  id: string;
  done: boolean;
  /** Visible label, e.g. "Keep reading · 0:09". */
  label: string;
  /** Stable screen-reader text (no ticking numbers). Defaults to `label`. */
  srLabel?: string;
}

/** "0:09" / "1:05" from milliseconds, rounding up so it never shows 0:00 while pending. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function GateChecklist({ items, className }: { items: GateItem[]; className?: string }) {
  if (items.length === 0) return null;
  return (
    <ul role="status" className={ecn("flex flex-wrap items-center gap-x-4 gap-y-1", className)}>
      {items.map((item) => (
        <li key={item.id} className="flex min-w-0 items-center gap-1.5">
          {item.done ? (
            <CheckCircle
              aria-hidden
              weight="fill"
              className={ecn("size-4 shrink-0", outcomeClasses("correct", "ink"))}
            />
          ) : (
            <CircleDashed aria-hidden weight="bold" className={ecn("size-4 shrink-0", skinClasses("mutedInk"))} />
          )}
          <span
            aria-hidden={item.srLabel ? true : undefined}
            className={ecn(
              "text-caption tabular-nums",
              item.done ? ecn("font-medium", skinClasses("ink")) : skinClasses("mutedInk")
            )}
          >
            {item.label}
          </span>
          {item.srLabel && <span className="sr-only">{item.srLabel}</span>}
        </li>
      ))}
    </ul>
  );
}
