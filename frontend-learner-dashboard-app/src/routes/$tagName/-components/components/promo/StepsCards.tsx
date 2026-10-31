import React from "react";
import { cn } from "@/lib/utils";
import type { StepsCardsProps } from "../../../-types/site-chrome-types";

/**
 * stepsProcess variant "cards": a centred heading over one row of numbered
 * cards (Figma "How paths work" 73:564). No connectors, no shadow. Text is
 * already in the visitor's language; author colours are inline, the rest
 * palette classes.
 */

const SECTION_PAD = "py-14 lg:py-[88px]"; // design-lint-ignore: Figma band padding 88px
const HEADING = "text-center text-[26px] font-bold leading-[34px] lg:text-[32px] lg:leading-[38px]"; // design-lint-ignore: Figma heading 32/38
const CARD = "flex flex-col items-start gap-3 rounded-[20px] border border-palette-border bg-palette-canvas p-7"; // design-lint-ignore: Figma card radius 20
const TITLE = "text-[19px] font-bold leading-[26px] text-palette-text"; // design-lint-ignore: Figma step title 19/26
const TEXT = "text-[15px] leading-6 text-palette-body"; // design-lint-ignore: Figma step text 15/24

/** Entrance stagger order (the motion layer reads --stagger-i), as the other step layouts set it. */
const staggerStyle = (i: number) => ({ "--stagger-i": i }) as React.CSSProperties;

const GRID_COLUMNS: Record<number, string> = {
  1: "md:grid-cols-1",
  2: "md:grid-cols-2",
  3: "md:grid-cols-3",
  4: "md:grid-cols-2 lg:grid-cols-4",
};

export const StepsCards: React.FC<StepsCardsProps> = ({
  headerText,
  subheading,
  backgroundColor,
  textColor,
  accentColor,
  steps = [],
}) => {
  const list = Array.isArray(steps) ? steps.filter(Boolean) : [];
  return (
    <section
      data-steps-cards=""
      className={cn("w-full", SECTION_PAD, !backgroundColor && "bg-palette-sand")}
      style={backgroundColor ? { backgroundColor } : undefined}
    >
      <div className="catalogue-shell flex flex-col items-center gap-8 lg:gap-10">
        {(headerText || subheading) && (
          <div className="flex flex-col items-center gap-3">
            {headerText && (
              <h2 className={cn(HEADING, !textColor && "text-palette-text")} style={textColor ? { color: textColor } : undefined}>
                {headerText}
              </h2>
            )}
            {subheading && <p className="max-w-2xl text-center text-base text-palette-body">{subheading}</p>}
          </div>
        )}
        <div className={cn("grid w-full gap-4 md:gap-6", GRID_COLUMNS[Math.min(list.length, 4)] ?? GRID_COLUMNS[3])}>
          {list.map((step, i) => (
            <article key={i} data-stagger-item style={staggerStyle(i)} className={CARD}>
              <span
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-full text-base font-bold leading-5 text-white",
                  !accentColor && "bg-palette-primary",
                )}
                style={accentColor ? { backgroundColor: accentColor } : undefined}
              >
                {step.number || i + 1}
              </span>
              {step.title && <h3 className={TITLE}>{step.title}</h3>}
              {step.description && <p className={TEXT}>{step.description}</p>}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
};

export default StepsCards;
