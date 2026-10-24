import React from "react";
import { CatalogueLink } from "../../CatalogueLink";
import { cn } from "@/lib/utils";
import { splitScriptRuns, type ResolvedSidebarPromo } from "./catalog-sidebar-config";
import { AppStoreBadges } from "../promo/AppStoreBadges";

/**
 * The dark app promo card under the editorial filter card
 * (courseCatalog.filterSidebar.promo, Figma courses node 1:247 "App CTA").
 * Only rendered when the promo is enabled; every visible string is authored
 * (already localized by localizeComponentProps).
 *
 * Colours: the site palette (text → card, accent → phone frame + eyebrow,
 * olive → button, cream / border / primary → the drawn screen) unless the
 * author picks hex colours.
 */

// Exact Figma geometry (280 × 432 card, 104 × 188 phone) — no token scale for these.
const CARD = "flex w-full flex-col items-center gap-3.5 rounded-[18px] px-[22px] py-6 text-center"; // design-lint-ignore: Figma 18px radius, 22px padding
const EYEBROW = "text-[11px] font-bold uppercase leading-4 tracking-[1.3px]"; // design-lint-ignore: Figma 11px / 1.3px tracking
const TITLE = "text-[19px] font-bold leading-[25px]"; // design-lint-ignore: Figma 19px / 25px
const BODY = "text-[13px] leading-5"; // design-lint-ignore: Figma 13px / 20px
const BUTTON =
  "flex w-full items-center justify-center gap-2 rounded-[8px] px-[22px] py-3 text-[15px] font-normal leading-[22px] transition hover:brightness-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-palette-text"; // design-lint-ignore: Figma 8px radius, 15px / 22px label
const PHONE = "relative h-[188px] w-[104px] shrink-0 overflow-hidden rounded-[18px] border-2 border-palette-accent bg-white/[0.07]"; // design-lint-ignore: Figma phone 104 × 188, body = card + 7% white
const NOTCH = "absolute start-[35px] top-[6px] h-[5px] w-[30px] rounded-[3px] bg-palette-accent"; // design-lint-ignore: Figma notch
const SCREEN = "absolute start-[4px] top-[18px] h-[160px] w-[92px] overflow-hidden rounded-[12px] bg-palette-cream"; // design-lint-ignore: Figma screen
const PHOTO = "absolute start-[6px] top-[8px] h-[52px] w-[80px] rounded-[8px] bg-palette-sand object-cover"; // design-lint-ignore: Figma screen photo
const BAR = "absolute start-[6px] h-[5px] rounded-[3px]"; // design-lint-ignore: Figma screen bars
const BAR_TITLE = "top-[66px] w-[70px] bg-palette-text/80"; // design-lint-ignore: Figma bar
const BAR_LINE_1 = "top-[80px] w-[50px] bg-palette-muted/40"; // design-lint-ignore: Figma bar
const BAR_LINE_2 = "top-[92px] w-[60px] bg-palette-muted/40"; // design-lint-ignore: Figma bar
const BAR_TRACK = "top-[110px] w-[80px] bg-palette-border"; // design-lint-ignore: Figma progress track
const BAR_FILL = "top-[110px] w-[48px] bg-palette-olive"; // design-lint-ignore: Figma progress fill
const SCREEN_BUTTON = "absolute start-[6px] top-[128px] h-[18px] w-[80px] rounded-[6px] bg-palette-primary"; // design-lint-ignore: Figma screen button
const ILLUSTRATION = "block h-auto w-[104px]"; // design-lint-ignore: Figma phone width

/** The drawn phone of the Figma (frame, notch, a photo, text bars, progress, button). */
const PhoneMock: React.FC<{ screenImage: string | null }> = ({ screenImage }) => (
  <div className={PHONE} aria-hidden="true" data-promo-phone="">
    <div className={NOTCH} />
    <div className={SCREEN}>
      {screenImage ? (
        <img src={screenImage} alt="" loading="lazy" className={PHOTO} />
      ) : (
        <div className={PHOTO} />
      )}
      <div className={cn(BAR, BAR_TITLE)} />
      <div className={cn(BAR, BAR_LINE_1)} />
      <div className={cn(BAR, BAR_LINE_2)} />
      <div className={cn(BAR, BAR_TRACK)} />
      <div className={cn(BAR, BAR_FILL)} />
      <div className={SCREEN_BUTTON} />
    </div>
  </div>
);

/** Letter-spacing on Latin runs only (tracking breaks Devanagari's headline). */
const trackedText = (value: string) =>
  splitScriptRuns(value).map((run, i) =>
    run.devanagari ? (
      <span key={i} className="tracking-normal">
        {run.text}
      </span>
    ) : (
      <React.Fragment key={i}>{run.text}</React.Fragment>
    ),
  );

export const SidebarPromoCard: React.FC<{ promo: ResolvedSidebarPromo; className?: string }> = ({
  promo,
  className,
}) => {
  const color = (value: string | null): React.CSSProperties | undefined => (value ? { color: value } : undefined);
  return (
    <aside
      aria-label={promo.title || promo.eyebrow || undefined}
      className={cn(CARD, !promo.backgroundColor && "bg-palette-text", className)}
      style={promo.backgroundColor ? { backgroundColor: promo.backgroundColor } : undefined}
    >
      {promo.image ? (
        <img
          src={promo.image}
          alt={promo.imageAlt}
          width={104}
          height={188}
          loading="lazy"
          className={ILLUSTRATION}
        />
      ) : (
        <PhoneMock screenImage={promo.screenImage} />
      )}
      {(promo.eyebrow || promo.title || promo.text) && (
        <div className="flex w-full flex-col items-center gap-2 break-words">
          {promo.eyebrow && (
            <p className={cn(EYEBROW, !promo.eyebrowColor && "text-palette-accent")} style={color(promo.eyebrowColor)}>
              {trackedText(promo.eyebrow)}
            </p>
          )}
          {promo.title && (
            <h3 className={cn(TITLE, "w-full", !promo.titleColor && "text-white")} style={color(promo.titleColor)}>
              {promo.title}
            </h3>
          )}
          {promo.text && (
            <p className={cn(BODY, "w-full", !promo.textColor && "text-white/80")} style={color(promo.textColor)}>
              {promo.text}
            </p>
          )}
        </div>
      )}
      {promo.appLinks ? (
        <AppStoreBadges links={promo.appLinks} stacked />
      ) : promo.buttonTarget && (
        <CatalogueLink
          to={promo.buttonTarget}
          target={promo.openInNewTab ? "_blank" : undefined}
          rel={promo.openInNewTab ? "noopener noreferrer" : undefined}
          className={cn(
            BUTTON,
            !promo.buttonColor && "bg-palette-olive",
            !promo.buttonTextColor && "text-white",
          )}
          style={
            promo.buttonColor || promo.buttonTextColor
              ? {
                  ...(promo.buttonColor ? { backgroundColor: promo.buttonColor } : {}),
                  ...(promo.buttonTextColor ? { color: promo.buttonTextColor } : {}),
                }
              : undefined
          }
        >
          <span>{promo.buttonText}</span>
          <span aria-hidden="true" className="inline-block rtl:-scale-x-100">
            →
          </span>
        </CatalogueLink>
      )}
    </aside>
  );
};
