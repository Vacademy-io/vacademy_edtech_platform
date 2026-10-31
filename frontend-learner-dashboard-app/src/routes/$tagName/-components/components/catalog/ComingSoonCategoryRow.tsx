import React from "react";
import { BellSimple } from "@phosphor-icons/react";
import { openComingSoonForm } from "../../../-utils/coming-soon";
import { ColumnSectionHeader } from "./ColumnSectionHeader";
import { distinctParts, type ComingSoonItem, type ResolvedComingSoonSection } from "./catalog-column-sections";
import type { CatalogSlotContext } from "./slots/catalog-slot-types";

/*
 * Figma "Courses" 1:405 (coming_soon.tsx): cards 199×210 in a 12px-gap row;
 * cream fill, 1px dashed border, radius 14, padding 16, 10px gaps; eyebrow
 * 10/14 bold tracking 1.1px; names 15/21 bold; the button 32px tall, white,
 * 1px accent border, radius 8, 12/16 bold primary text.
 */
const CARD =
  "flex min-h-[210px] flex-col gap-2.5 rounded-[14px] border border-dashed border-palette-border bg-palette-cream p-4"; // design-lint-ignore: Figma 210px card, radius 14
const EYEBROW = "m-0 whitespace-pre-wrap text-[10px] leading-[14px] font-bold uppercase tracking-[1.1px] text-palette-muted2"; // design-lint-ignore: Figma 10/14, tracking 1.1px
const NAME = "m-0 flex flex-col text-[15px] leading-[21px] font-bold text-palette-muted2"; // design-lint-ignore: Figma 15/21
const NOTIFY =
  "mt-auto inline-flex h-8 items-center gap-2 self-start rounded-[8px] border border-palette-accent bg-catalogue-bg-elevated px-3 text-xs font-bold text-palette-primary transition-colors hover:border-palette-primary hover:bg-palette-cream focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"; // design-lint-ignore: Figma radius 8

export interface ComingSoonCategoryRowProps {
  section: ResolvedComingSoonSection;
  headingId: string;
  /** comingSoonItems(...) — non-empty. */
  items: ComingSoonItem[];
  ctx: CatalogSlotContext;
}

/** "Coming soon": folder-library categories flagged coming soon; "Notify me" opens the category's audience form. */
export const ComingSoonCategoryRow: React.FC<ComingSoonCategoryRowProps> = ({ section, headingId, items, ctx }) => {
  const { t, siteT } = ctx;
  const notifyLabel = section.notifyLabel || t("comingSoon.notifyMe", "Notify me");
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3.5" data-column-section={section.id}>
      <ColumnSectionHeader
        headingId={headingId}
        title={section.title || t("catalogSections.comingSoonTitle", "Coming soon")}
        subtitle={section.subtitle}
        subtitleTone="muted"
      />
      <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 xl:grid-cols-4">
        {items.map(({ category, stream }) => {
          const eyebrow = distinctParts(siteT(stream.title), siteT(stream.subtitle)).join("  ·  ");
          const [primaryName, secondName] = distinctParts(siteT(category.title), siteT(category.subtitle));
          const formName = siteT(category.subtitle || category.title);
          return (
            <li key={`${stream.slug}/${category.slug}`} className={CARD}>
              {eyebrow ? <p className={EYEBROW}>{eyebrow}</p> : null}
              <p className={NAME}>
                <span>{primaryName}</span>
                {secondName ? <span>{secondName}</span> : null}
              </p>
              <button
                type="button"
                className={NOTIFY}
                aria-label={`${notifyLabel}: ${primaryName}`}
                onClick={() =>
                  openComingSoonForm(
                    { enabled: true, audienceId: category.audienceId || undefined },
                    t("comingSoon.notifyTitle", { title: formName, defaultValue: "Get notified when {{title}} launches" }),
                  )
                }
              >
                <BellSimple
                  size={13}
                  weight="fill"
                  aria-hidden="true"
                  className="text-palette-gold"
                  style={section.iconColor ? { color: section.iconColor } : undefined}
                />
                {notifyLabel}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
};
