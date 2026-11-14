import React, { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * "Load more courses" + "Showing 9 of 24" (feature 'cards'; Figma courses
 * node 1:401). Replaces the numbered pagination only for a section with
 * render.pagination.mode "loadMore". Texts arrive in the visitor's language.
 *
 * A click reveals the next batch in place (no scroll jump) and moves focus
 * to the first newly revealed card's CTA (the editorial card), else the first
 * focusable element of that card (the original card), else the count line —
 * so focus never falls back to <body> when the button disappears. The button
 * disappears once every card is shown; the count line stays.
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Where focus goes after a batch: the new card's CTA, else its first focusable element. */
export const loadMoreFocusTarget = (grid: HTMLElement | null | undefined, from: number): HTMLElement | null => {
  if (!grid) return null;
  const cta = grid.querySelector<HTMLElement>(`[data-card-index="${from}"] [data-card-cta]`);
  if (cta) return cta;
  const card = grid.children.item(from);
  if (!(card instanceof HTMLElement)) return null;
  return card.matches(FOCUSABLE) ? card : card.querySelector<HTMLElement>(FOCUSABLE);
};

// Figma: 182 x 53 secondary button, 15/23 text, 8 px radius.
const BUTTON_CLASS =
  "inline-flex h-[53px] w-full max-w-xs items-center justify-center rounded-lg border bg-catalogue-bg-elevated px-7 text-[15px] font-normal leading-[23px] text-palette-text transition-colors hover:bg-palette-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2 sm:w-auto"; // design-lint-ignore: Figma 53px button, 15/23 text

export interface LoadMorePaginationProps {
  shown: number;
  total: number;
  onLoadMore: () => void;
  /** Button text (visitor language). */
  label: string;
  /** "Showing 9 of 24" (visitor language). */
  countText: string;
  /** The grid the cards render in (focus target lookup). */
  gridRef?: React.RefObject<HTMLElement | null>;
  /** Section-authored border colour (hex); default the palette muted2 ink at 80%. */
  borderColor?: string;
}

export const LoadMorePagination: React.FC<LoadMorePaginationProps> = ({
  shown,
  total,
  onLoadMore,
  label,
  countText,
  gridRef,
  borderColor,
}) => {
  const focusFrom = useRef<number | null>(null);
  const countRef = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    const from = focusFrom.current;
    if (from === null || shown <= from) return;
    focusFrom.current = null;
    const target = loadMoreFocusTarget(gridRef?.current, from) ?? countRef.current;
    target?.focus({ preventScroll: true });
  }, [shown, gridRef]);

  if (total <= 0) return null;
  return (
    <div className="flex flex-col items-center gap-2" data-load-more="">
      {shown < total && (
        <button
          type="button"
          onClick={() => {
            focusFrom.current = shown;
            onLoadMore();
          }}
          className={cn(BUTTON_CLASS, !borderColor && "border-palette-muted2/80")}
          style={borderColor ? { borderColor } : undefined} // design-lint-ignore: section-authored border colour
        >
          {label}
        </button>
      )}
      {/* Not a live region: it changes on every search keystroke and filter
          change (the results header already announces those, debounced);
          after Load more, focus lands on the first new card instead. */}
      <p ref={countRef} tabIndex={-1} className="text-xs leading-4 text-palette-muted focus:outline-none">
        {countText}
      </p>
    </div>
  );
};

export default LoadMorePagination;
