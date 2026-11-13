import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { QuestionStatus } from "../question-status-colors";

/**
 * A console palette chip. The shape comes from tcs.css by status
 * (`tcs-chip--<status>`): grey square, red shield pointing down, green house
 * pointing up, purple circle, and the purple circle with a green tick for
 * an answered question marked for review. All shapes are our own CSS.
 */
export function ChipShape({
  status,
  size = "palette",
  children,
}: {
  status: QuestionStatus;
  size?: "palette" | "legend";
  children?: ReactNode;
}) {
  return (
    <span
      className={cn("tcs-chip", `tcs-chip--${status}`, `tcs-chip--${size}`)}
      data-status={status}
      aria-hidden="true"
    >
      <span className="tcs-chip__label">{children}</span>
      {status === "answered-marked" && (
        <span className="tcs-chip__tick">
          <svg viewBox="0 0 10 10" focusable="false">
            <path d="M2 5.2 4.2 7.3 8 2.8" />
          </svg>
        </span>
      )}
    </span>
  );
}

/** A clickable palette chip for one question. */
export function PaletteChip({
  status,
  label,
  ariaLabel,
  isCurrent,
  onClick,
}: {
  status: QuestionStatus;
  label: string;
  ariaLabel: string;
  isCurrent: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="tcs-chip-button"
      aria-label={ariaLabel}
      aria-current={isCurrent ? "step" : undefined}
      onClick={onClick}
    >
      <ChipShape status={status}>{label}</ChipShape>
    </button>
  );
}
