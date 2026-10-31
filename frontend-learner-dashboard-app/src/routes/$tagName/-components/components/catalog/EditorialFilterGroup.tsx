import React, { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { fillCount, splitScriptRuns } from "./catalog-sidebar-config";

/**
 * One section of the EDITORIAL filter sidebar (courseCatalog.filterSidebar
 * variant 'editorial', Figma courses node 1:141 "Filter / PRICE" …): an
 * uppercase olive heading with a −/+ fold toggle, 18px checkboxes, label,
 * right-aligned count, greyed zero-count rows and an optional show-more link.
 * Used only by the sidebar feature's slots — the default sidebar keeps
 * DiscoveryFilterGroup / FilterSection.
 *
 * Colours: site palette classes (text / muted / muted2 / primary / gold /
 * border-strong), plus two hex colours the palette lacks, set by the author
 * as CSS variables on the group (--fs-divider, --fs-box).
 */

// Exact Figma values the token scale lacks (12px heading with 1.1px tracking,
// 18px box with a 1.2px border, 4px box radius, 12/18 show-more link).
const HEADING_TEXT = "text-xs leading-4 tracking-[1.1px]"; // design-lint-ignore: Figma 12px / 1.1px tracking
const BOX = "relative flex size-[18px] shrink-0 items-center justify-center border-[1.2px] bg-white transition-colors"; // design-lint-ignore: Figma 18px box, 1.2px border
const BOX_SQUARE = "rounded-[4px]"; // design-lint-ignore: Figma 4px radius
const BOX_AUTHORED = "border-[color:var(--fs-box)]"; // design-lint-ignore: author-picked checkbox colour
const DIVIDER_AUTHORED = "border-[color:var(--fs-divider)]"; // design-lint-ignore: author-picked divider colour
const LINK_TEXT = "text-xs leading-[18px]"; // design-lint-ignore: Figma 12px / 18px link

export interface EditorialFilterOption {
  value: string;
  label: React.ReactNode;
  /** Live count; undefined = no count column. */
  count?: number;
  /** Greyed and not selectable (zero-count and not selected). */
  disabled?: boolean;
}

export interface EditorialFilterGroupProps {
  id: string;
  title: string;
  options: EditorialFilterOption[];
  selected: string[];
  onToggle: (value: string) => void;
  /** 'single' = round indicators (radio semantics: one choice). Default 'multi'. */
  mode?: "multi" | "single";
  /** Single mode: a "no choice" row (radio price filter). */
  anyLabel?: string;
  onClear?: () => void;
  collapsible?: boolean;
  /** Rows before the show-more link; undefined = all. */
  visibleCount?: number;
  /** Show-more text ('{count}' = number of options); default "+ Show more". */
  showAllLabel?: string;
  showLessLabel?: string;
  /** No divider above (first group in the phone sheet). */
  flushTop?: boolean;
  /** Author colours (hex, already validated). */
  dividerColor?: string | null;
  boxColor?: string | null;
  /** A custom body instead of option rows (the legacy min / max price inputs). */
  children?: React.ReactNode;
}

export const EditorialFilterGroup: React.FC<EditorialFilterGroupProps> = ({
  id,
  title,
  options,
  selected,
  onToggle,
  mode = "multi",
  anyLabel,
  onClear,
  collapsible = true,
  visibleCount,
  showAllLabel,
  showLessLabel,
  flushTop = false,
  dividerColor,
  boxColor,
  children,
}) => {
  const { t } = useTranslation("coursePlayerB");
  const listId = useId();
  const name = useId();
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState(false);
  if (!options.length && children === undefined) return null;

  const limit = visibleCount && visibleCount < options.length ? visibleCount : null;
  // A selected option never hides behind "show more".
  const shown =
    limit === null || expanded
      ? options
      : options.filter((o, i) => i < limit || selected.includes(o.value));
  const hiddenCount = options.length - shown.length;

  const vars: Record<string, string> = {};
  if (dividerColor) vars["--fs-divider"] = dividerColor;
  if (boxColor) vars["--fs-box"] = boxColor;

  const heading = (
    <span className={cn("min-w-0 whitespace-pre-wrap uppercase", HEADING_TEXT)}>
      {splitScriptRuns(title).map((run, i) =>
        run.devanagari ? (
          <span key={i} className="normal-case tracking-normal">
            {run.text}
          </span>
        ) : (
          <React.Fragment key={i}>{run.text}</React.Fragment>
        ),
      )}
    </span>
  );

  const row = (
    key: string,
    label: React.ReactNode,
    checked: boolean,
    onChange: () => void,
    count?: number,
    disabled?: boolean,
  ) => (
    <label
      key={key}
      className={cn(
        "group flex w-full items-center gap-2.5 py-1.5",
        disabled ? "cursor-not-allowed" : "cursor-pointer",
      )}
    >
      <input
        type={mode === "single" ? "radio" : "checkbox"}
        name={mode === "single" ? name : undefined}
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
      <span
        aria-hidden="true"
        className={cn(
          BOX,
          mode === "single" ? "rounded-full" : BOX_SQUARE,
          "peer-focus-visible:ring-2 peer-focus-visible:ring-primary-400 peer-focus-visible:ring-offset-2",
          checked
            ? "border-palette-primary bg-palette-primary"
            : cn(boxColor ? BOX_AUTHORED : "border-palette-muted2", !disabled && "group-hover:border-palette-primary"),
        )}
      >
        {checked &&
          (mode === "single" ? (
            <span className="size-2 rounded-full bg-white" />
          ) : (
            <Check size={12} weight="bold" className="text-white" />
          ))}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 break-words text-sm",
          disabled ? "text-palette-muted2" : "text-palette-text",
        )}
      >
        {label}
      </span>
      {count !== undefined && (
        <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-palette-muted">{count}</span>
      )}
    </label>
  );

  return (
    <section
      className={cn(
        "flex flex-col gap-0.5 pb-3.5 pt-4",
        !flushTop && "border-t",
        !flushTop && (dividerColor ? DIVIDER_AUTHORED : "border-palette-border"),
      )}
      style={Object.keys(vars).length ? (vars as React.CSSProperties) : undefined}
      data-filter-group={id}
    >
      {collapsible ? (
        <h3 className="m-0">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((v) => !v)}
            className="flex w-full items-start justify-between gap-3 rounded-catalogue-xs pb-1.5 text-start font-bold text-palette-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
          >
            {heading}
            <span aria-hidden="true" className="shrink-0 text-sm leading-4">
              {open ? "−" : "+"}
            </span>
          </button>
        </h3>
      ) : (
        <h3 className="m-0 flex w-full pb-1.5 font-bold text-palette-muted">{heading}</h3>
      )}
      {/* Always mounted (hidden when folded) so aria-controls names a real element;
          the display class follows `open` too, as `flex` would beat the [hidden] rule. */}
      <div
        id={listId}
        hidden={!open}
        className={cn("flex-col gap-0.5", open ? "flex" : "hidden")}
        role={children === undefined && mode === "single" ? "radiogroup" : "group"}
        aria-label={title}
      >
        {children !== undefined ? (
          children
        ) : (
          <>
            {mode === "single" && anyLabel && row("__any__", anyLabel, selected.length === 0, () => onClear?.())}
            {shown.map((o) =>
              row(
                o.value,
                o.label,
                selected.includes(o.value),
                () => onToggle(o.value),
                o.count,
                o.disabled && !selected.includes(o.value),
              ),
            )}
          </>
        )}
      </div>
      {open && children === undefined && limit !== null && (hiddenCount > 0 || expanded) && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((v) => !v)}
          className={cn(
            "self-start rounded-catalogue-xs font-bold text-palette-gold hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400",
            LINK_TEXT,
          )}
        >
          {expanded
            ? showLessLabel || t("catalogSidebar.showLess", "− Show less")
            : fillCount(showAllLabel || t("catalogSidebar.showMore", "+ Show more"), options.length)}
        </button>
      )}
    </section>
  );
};
