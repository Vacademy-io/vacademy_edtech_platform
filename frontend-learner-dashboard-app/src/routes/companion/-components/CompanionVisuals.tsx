import type { ReactNode } from "react";
import { BookOpenText, Check } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { accentAlpha, accentOf, type MasteryTone } from "./companion-utils";

const RING_SIZE = {
  xs: "size-7",
  sm: "size-9",
  md: "size-14",
  lg: "size-20",
} as const;

const TONE_STROKE: Record<MasteryTone, string> = {
  none: "stroke-primary-500",
  low: "stroke-warning-500",
  mid: "stroke-primary-500",
  high: "stroke-success-500",
};

/**
 * Circular progress ring. SVG so it reads at a glance at any size; the dash
 * offset transitions, so progress visibly fills when it changes.
 */
export function ProgressRingMini({
  percent,
  size = "sm",
  tone = "none",
  complete = false,
  children,
  className,
}: {
  percent: number;
  size?: keyof typeof RING_SIZE;
  tone?: MasteryTone;
  complete?: boolean;
  children?: ReactNode;
  className?: string;
}) {
  const radius = 15;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, percent));
  const offset = circumference - (clamped / 100) * circumference;
  const stroke = complete ? "stroke-success-500" : TONE_STROKE[tone];

  return (
    <span className={cn("relative inline-flex shrink-0", RING_SIZE[size], className)}>
      <svg viewBox="0 0 36 36" className="size-full -rotate-90" aria-hidden>
        <circle
          cx="18"
          cy="18"
          r={radius}
          fill="none"
          strokeWidth="3.5"
          className="stroke-neutral-200 dark:stroke-neutral-700"
        />
        {clamped > 0 && (
          <circle
            cx="18"
            cy="18"
            r={radius}
            fill="none"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className={cn(stroke, "transition-all duration-700 ease-out")}
          />
        )}
      </svg>
      <span className="absolute inset-0 flex items-center justify-center">
        {complete && !children ? (
          <Check weight="bold" className="size-1/2 text-success-600" />
        ) : (
          children
        )}
      </span>
    </span>
  );
}

const AVATAR_SIZE = {
  sm: "size-10 text-xl",
  md: "size-12 text-2xl",
  lg: "size-16 text-3xl",
} as const;

/**
 * The companion's face: its emoji on a wash of its own accent colour. The
 * accent is admin-chosen per companion, so it is applied inline (a dynamic,
 * user-generated value); without one the institute's primary tokens are used.
 */
export function CompanionAvatar({
  emoji,
  accent,
  size = "md",
  className,
}: {
  emoji?: string | null;
  accent?: string | null;
  size?: keyof typeof AVATAR_SIZE;
  className?: string;
}) {
  const color = accentOf(accent);
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 select-none items-center justify-center rounded-2xl ring-1 ring-inset",
        !color && "bg-primary-100 ring-primary-200",
        color && "ring-black/5",
        AVATAR_SIZE[size],
        className,
      )}
      // Per-companion accent colour (dynamic value from the admin).
      style={color ? { backgroundColor: accentAlpha(color, "29") } : undefined}
    >
      {emoji || "📘"}
    </span>
  );
}

/** "📖 NCERT Biology, p. 112-113" — where on the page this came from. */
export function CitationChip({ label, className }: { label: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-xs font-medium text-neutral-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
        className,
      )}
    >
      <BookOpenText className="size-3.5 shrink-0 text-primary-500" weight="duotone" aria-hidden />
      <span className="truncate">{label}</span>
    </span>
  );
}

/** Thin progress bar in the institute's primary colour. */
export function ProgressBar({ percent, className }: { percent: number; className?: string }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div
      className={cn("h-2 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800", className)}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full bg-primary-500 transition-all duration-700 ease-out"
        // Width is the live progress value.
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
