import React, { useEffect, useId, useState } from "react";
import { FitImage } from "@/components/common/fit-image/FitImage";
import { useTranslation } from "react-i18next";
import { BookOpen } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { getPublicUrlWithoutLogin } from "@/services/upload_file";
import { ComingSoonRibbon } from "../ComingSoonRibbon";
import type { EditorialCardView } from "./catalog-card-view";

/**
 * The EDITORIAL course card (feature 'cards'; Figma "Course Card", courses
 * node 1:390). Presentational: everything it shows comes from the view model
 * (catalog-card-view.ts → buildEditorialCardView), already in the visitor's
 * language. Rendered only for a section with render.cardStyle "editorial"
 * (and by courseShowcase with cardStyle "editorial").
 *
 * Colours are the opt-in site palette classes (text-palette-*, bg-palette-*),
 * which fall back to the catalogue tokens on a site without a palette; the
 * three Figma colours the palette has no name for can be set per section
 * (render.card.colors) and are applied inline.
 *
 * The whole card opens the course (mouse); the CTA is the keyboard target
 * (plus "View details" when a coming-soon CTA opens the notify form).
 * The article is named by its title, and the CTA ("View course") is described
 * by it, so a list of identical CTAs still says which course each opens.
 */

// Exact Figma values (264 x 369 card, 18 px radius, 150 px image band).
const CARD_CLASS =
  "flex h-full min-w-0 cursor-pointer flex-col overflow-hidden rounded-[18px] border border-palette-border bg-catalogue-bg-elevated text-start shadow-[0px_4px_16px_0px_rgba(26,20,5,0.06)] transition-shadow duration-200 hover:shadow-[0px_10px_28px_-6px_rgba(26,20,5,0.16)]"; // design-lint-ignore: Figma card radius + shadow
const IMAGE_BAND_CLASS = "relative flex aspect-[264/150] w-full shrink-0 items-start gap-2 overflow-hidden px-3 pt-3"; // design-lint-ignore: Figma 264x150 image band
const PILL_CLASS =
  "relative inline-flex shrink-0 items-center whitespace-nowrap rounded-xl px-2.5 py-1 text-[11px] font-bold leading-[14px]"; // design-lint-ignore: Figma 11/14 pill
const STREAM_LABEL_CLASS =
  "min-w-0 truncate text-[10px] font-bold uppercase leading-[14px] tracking-[0.11em] text-palette-gold"; // design-lint-ignore: Figma 10/14 eyebrow, 1.1px tracking
const TITLE_CLASS = "line-clamp-3 text-base font-bold leading-[22px] text-palette-text"; // design-lint-ignore: Figma 16/22 title
const DESCRIPTION_CLASS = "line-clamp-2 text-xs leading-[18px] text-palette-muted"; // design-lint-ignore: Figma 12/18 description
const CHIP_CLASS =
  "inline-flex items-center rounded-md border border-palette-border bg-palette-cream px-[7px] py-0.5 text-[10px] leading-[14px] text-palette-muted"; // design-lint-ignore: Figma 10/14 chip, 7px padding
const OTHER_TITLE_CLASS = "text-[11px] leading-4 text-palette-muted"; // design-lint-ignore: Figma 11/16
const PRICE_CLASS = "whitespace-nowrap text-[17px] leading-[22px]"; // design-lint-ignore: Figma 17/22 price

export interface EditorialCourseCardProps {
  view: EditorialCardView;
  /** Opens the course (card click, and the CTA unless onCta handles it). */
  onOpen: () => void;
  /** The CTA; default onOpen. Coming soon: opens the notify form. */
  onCta?: () => void;
  /** Index in its list (data attribute; the load-more focus target). */
  index?: number;
  className?: string;
}

/** Resolves a media id (or passes a URL through) — the band falls back to the placeholder on failure. */
const CardImage: React.FC<{ image: string | null; fit: "cover" | "contain"; title: string }> = ({
  image,
  fit,
  title,
}) => {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(!image);

  useEffect(() => {
    let alive = true;
    setUrl("");
    setFailed(!image);
    if (!image) return;
    getPublicUrlWithoutLogin(image)
      .then((u) => {
        if (!alive) return;
        if (u) setUrl(u);
        else setFailed(true);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [image]);

  if (failed) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-palette-cream" aria-hidden="true">
        <BookOpen size={44} weight="duotone" className="text-palette-accent" />
      </div>
    );
  }
  if (!url) return <div className="catalogue-skeleton-shimmer absolute inset-0 rounded-none" aria-hidden="true" />;
  return (
    <FitImage
      src={url}
      alt={title}
      loading="lazy"
      onError={() => setFailed(true)}
      // The authored "contain" keeps its cream surface; the default fills the
      // band, or fits an image that filling would cut too much.
      fit={fit === "contain" ? "contain" : undefined}
      className={cn("absolute inset-0 h-full w-full", fit === "contain" && "bg-palette-cream")}
    />
  );
};

export const EditorialCourseCard: React.FC<EditorialCourseCardProps> = ({
  view,
  onOpen,
  onCta,
  index,
  className,
}) => {
  const { t } = useTranslation("coursePlayerB");
  const languageNames = view.languages.map((l) => l.label).join(", ");
  const showStream = !!view.stream && (!!view.stream.label || !!view.stream.imageUrl);
  const titleId = useId();

  return (
    <article
      className={cn(CARD_CLASS, className)}
      onClick={onOpen}
      data-editorial-card=""
      data-card-index={index}
      aria-labelledby={titleId}
    >
      {/* ── Image band: Free pill (start), format pill or coming-soon ribbon (end) ── */}
      <div className={IMAGE_BAND_CLASS}>
        <CardImage image={view.image} fit={view.imageFit} title={view.title} />
        {view.freePill && (
          <span className={cn(PILL_CLASS, "bg-palette-olive text-white")}>{view.freePill}</span>
        )}
        {view.comingSoon ? (
          <ComingSoonRibbon info={view.comingSoon} className="relative ms-auto" />
        ) : (
          view.formatPill && (
            <span className={cn(PILL_CLASS, "ms-auto bg-palette-canvas/95 text-palette-text")}>
              {view.formatPill}
            </span>
          )
        )}
      </div>

      {/* ── Body ── */}
      <div className="flex min-w-0 flex-col gap-2 px-4 pb-4 pt-3.5">
        {showStream && view.stream && (
          <div className="flex h-6 min-w-0 items-center gap-2">
            {view.stream.imageUrl && (
              <img
                src={view.stream.imageUrl}
                alt=""
                aria-hidden="true"
                loading="lazy"
                className="h-6 w-6 shrink-0 rounded-full object-cover"
                style={view.stream.accentColor ? { backgroundColor: view.stream.accentColor } : undefined} // design-lint-ignore: folder accent colour (authored data)
              />
            )}
            {view.stream.label && <span className={STREAM_LABEL_CLASS}>{view.stream.label}</span>}
          </div>
        )}

        <h3 id={titleId} className={TITLE_CLASS}>
          {view.title}
        </h3>

        {view.description && <p className={DESCRIPTION_CLASS}>{view.description}</p>}

        {(view.languages.length > 0 || view.otherTitle) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Screen readers get one real sentence (not a label on a display:contents
                wrapper, which some engines drop); the chips are its visual form. */}
            {view.languages.length > 0 && (
              <>
                <span className="sr-only">
                  {t("courseCatalog.availableIn", {
                    languages: languageNames,
                    defaultValue: "Available in {{languages}}",
                  })}
                </span>
                {view.languages.map((l) => (
                  <span
                    key={l.code}
                    aria-hidden="true"
                    className={cn(CHIP_CLASS, l.active ? "font-bold" : "font-normal")}
                  >
                    {l.label}
                  </span>
                ))}
              </>
            )}
            {view.otherTitle && <span className={OTHER_TITLE_CLASS}>{view.otherTitle}</span>}
          </div>
        )}

        <div
          className={cn("h-px w-full shrink-0", !view.colors.divider && "bg-palette-border/80")}
          style={view.colors.divider ? { backgroundColor: view.colors.divider } : undefined} // design-lint-ignore: section-authored divider colour
          aria-hidden="true"
        />

        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 font-bold">
          {view.price ? (
            view.price.tone === "status" ? (
              <span className="text-xs font-bold text-palette-primary">{view.price.text}</span>
            ) : (
              <span
                className={cn(
                  PRICE_CLASS,
                  view.price.tone === "free"
                    ? !view.colors.freePrice && "text-palette-muted"
                    : "text-palette-text",
                )}
                style={
                  view.price.tone === "free" && view.colors.freePrice
                    ? { color: view.colors.freePrice } // design-lint-ignore: section-authored free-price colour
                    : undefined
                }
              >
                {view.price.text}
              </span>
            )
          ) : (
            <span />
          )}
          <button
            type="button"
            data-card-cta=""
            aria-describedby={titleId}
            onClick={(e) => {
              e.stopPropagation();
              (onCta ?? onOpen)();
            }}
            className="group/cta -my-2 inline-flex items-center gap-1.5 rounded-sm py-2 text-xs font-bold leading-4 text-palette-primary underline-offset-[3px] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2" // design-lint-ignore: Figma 3px underline offset
          >
            <span>{view.ctaLabel}</span>
            <span
              aria-hidden="true"
              className="inline-block transition-transform duration-150 group-hover/cta:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover/cta:-translate-x-0.5"
            >
              →
            </span>
          </button>
        </div>
        {/* A notify-me CTA opens the form, so keep a keyboard path to the
            details page the card click leads to (as the legacy card does). */}
        {view.comingSoon?.audienceId && onCta && (
          <button
            type="button"
            data-card-details=""
            aria-describedby={titleId}
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
            className="-my-1 self-start rounded-sm py-1 text-xs leading-4 text-palette-muted underline underline-offset-[3px] hover:text-palette-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2" // design-lint-ignore: Figma 3px underline offset
          >
            {t("comingSoon.viewDetails", "View details")}
          </button>
        )}
      </div>
    </article>
  );
};

/** One loading card in the editorial shape. */
export const EditorialCardSkeleton: React.FC = () => (
  <div className={cn(CARD_CLASS, "cursor-default")} aria-hidden="true">
    <div className={cn(IMAGE_BAND_CLASS, "catalogue-skeleton-shimmer rounded-none")} />
    <div className="flex flex-col gap-2 px-4 pb-4 pt-3.5">
      <div className="catalogue-skeleton-shimmer h-3.5 w-1/2" />
      <div className="catalogue-skeleton-shimmer h-4 w-4/5" />
      <div className="catalogue-skeleton-shimmer h-3 w-full" />
      <div className="catalogue-skeleton-shimmer h-5 w-1/3" />
    </div>
  </div>
);

export default EditorialCourseCard;
