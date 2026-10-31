import React from "react";
import { cn } from "@/lib/utils";

/*
 * Figma "Courses" 1:289 / 1:406: title Lato Bold 22/30 hex 1a1208, sub Lato Regular
 * 14/20 (hex 463d2d, or hex 7a6a4a for "Coming soon") 4px under it; a right-hand
 * link sits on the sub's baseline (items-end). Exact sizes need arbitrary values.
 */
export const COLUMN_SECTION_TITLE = "m-0 text-[22px] leading-[30px] font-bold text-palette-text"; // design-lint-ignore: Figma 22/30
export const COLUMN_SECTION_LINK =
  "inline-flex shrink-0 items-center gap-1.5 self-start text-[13px] leading-[18px] font-bold text-palette-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 rounded-sm sm:self-auto"; // design-lint-ignore: Figma 13/18

export interface ColumnSectionHeaderProps {
  /** id of the h2 (the section's aria-labelledby). */
  headingId: string;
  title: string;
  subtitle?: string;
  /** 'body' (hex 463d2d) or 'muted' (hex 7a6a4a, "Coming soon"). */
  subtitleTone?: "body" | "muted";
  /** Right-hand slot ("See all 7 free →"); drops under the sub on phones. */
  aside?: React.ReactNode;
}

/** The heading row shared by the results-column sections. */
export const ColumnSectionHeader: React.FC<ColumnSectionHeaderProps> = ({
  headingId,
  title,
  subtitle,
  subtitleTone = "body",
  aside,
}) => (
  <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
    <div className="flex min-w-0 flex-col gap-1">
      <h2 id={headingId} className={COLUMN_SECTION_TITLE}>
        {title}
      </h2>
      {subtitle ? (
        <p
          className={cn(
            "m-0 text-sm",
            subtitleTone === "muted" ? "text-palette-muted2" : "text-palette-body",
          )}
        >
          {subtitle}
        </p>
      ) : null}
    </div>
    {aside}
  </div>
);
