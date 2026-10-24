import React from "react";
import { cn } from "@/lib/utils";
import { CatalogueLink } from "../../CatalogueLink";
import type { CtaBandButtonConfig, CtaBannerBandProps } from "../../../-types/site-chrome-types";
import { PhoneMockup } from "./PhoneMockup";
import { AppStoreBadges, resolveAppStoreLinks } from "./AppStoreBadges";

/**
 * ctaBanner variant "band": a full-width band with an optional eyebrow, a
 * heading, a subheading and up to two buttons, or (with `mockup`) the app
 * banner with a phone. Exact values of the design:
 *   dark help band (Figma 1:435 / 73:582), light institutions band (73:525),
 *   app banner (73:545).
 * Text arrives already in the visitor's language (localizeComponentProps).
 * Author colours (background, text, subheading, eyebrow) are inline; the rest
 * uses palette classes.
 */

/** True when a #rgb / #rrggbb colour is dark enough to need light text. */
export const isDarkHex = (hex?: string): boolean => {
  const raw = (hex || "").trim().replace(/^#/, "");
  const full = /^[0-9a-f]{3}$/i.test(raw) ? raw.replace(/./g, (c) => c + c) : raw;
  if (!/^[0-9a-f]{6}$/i.test(full)) return false;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.55;
};

const BUTTON_BASE = "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[8px] px-7 py-3.5 text-[15px] font-normal leading-[23px] transition-colors duration-200 max-sm:flex-1"; // design-lint-ignore: Figma button radius 8, 15/23

/** Button looks of the design. Unknown / absent = primary. */
export const CTA_BAND_BUTTON_CLASSES: Record<string, string> = {
  primary: "bg-palette-primary text-white hover:bg-palette-primary/90",
  olive: "bg-palette-olive text-white hover:bg-palette-olive/90",
  "outline-light": "border border-palette-sand text-palette-sand hover:bg-palette-sand/10",
  "outline-dark": "border border-palette-outline bg-catalogue-bg-elevated text-palette-text hover:bg-palette-cream",
};

export const ctaBandButtonClass = (style: unknown): string =>
  `${BUTTON_BASE} ${CTA_BAND_BUTTON_CLASSES[typeof style === "string" && style in CTA_BAND_BUTTON_CLASSES ? style : "primary"]}`;

const dispatchOpenAudienceForm = (audienceId: string, title?: string) =>
  window.dispatchEvent(new CustomEvent("openAudienceForm", { detail: { audienceId, title } }));

export const CtaBandButton: React.FC<{ button: CtaBandButtonConfig; className?: string }> = ({ button, className }) => {
  const text = button.text || "";
  const content = (
    <>
      {text}
      {button.icon === "arrow" && (
        <span aria-hidden="true" className="rtl:-scale-x-100">
          →
        </span>
      )}
    </>
  );
  const classes = cn(ctaBandButtonClass(button.style), className);
  const audienceId = (button.audienceId || "").trim();
  if (button.action === "openForm" && audienceId) {
    return (
      <button
        type="button"
        onClick={() => dispatchOpenAudienceForm(audienceId, button.formTitle || text)}
        className={classes}
      >
        {content}
      </button>
    );
  }
  return (
    <CatalogueLink to={button.target || "#"} className={classes}>
      {content}
    </CatalogueLink>
  );
};

const EYEBROW = "text-xs font-bold uppercase leading-4 tracking-[1.1px]"; // design-lint-ignore: Figma eyebrow 12/16, tracking 1.1px
const EYEBROW_APP = "text-xs font-bold uppercase leading-4 tracking-[1.3px]"; // design-lint-ignore: Figma app eyebrow tracking 1.3px
const HEADING = "text-2xl font-bold lg:text-[28px] lg:leading-9"; // design-lint-ignore: Figma heading 28/36
const HEADING_APP = "text-[22px] font-bold leading-tight lg:text-[26px] lg:leading-[34px]"; // design-lint-ignore: Figma app heading 26/34
const SUB_MD = "text-[15px] leading-[22px]"; // design-lint-ignore: Figma help band subheading 15/22
const SUB_LG = "text-base leading-[26px]"; // design-lint-ignore: Figma institutions subheading 16/26
const SUB_APP = "text-[15px] leading-[23px]"; // design-lint-ignore: Figma app subheading 15/23
const TEXT_COLUMN = "flex min-w-0 max-w-[700px] flex-col"; // design-lint-ignore: Figma text column 700px
const APP_ROW = "flex flex-col items-start gap-6 md:flex-row md:items-center md:gap-12 lg:px-[50px]"; // design-lint-ignore: Figma app banner inner 50px
const PAD_MD = "py-12 lg:py-16";
const PAD_LG = "py-14 lg:py-[72px]"; // design-lint-ignore: Figma institutions band 72px
const PAD_APP = "pb-12 pt-10 md:pt-[50px] lg:pb-[85px]"; // design-lint-ignore: Figma app banner 50 / 85px

export const CtaBand: React.FC<CtaBannerBandProps> = ({
  bandSize,
  eyebrow,
  eyebrowColor,
  heading,
  subheading,
  subheadingColor,
  backgroundColor,
  textColor,
  button,
  secondaryButton,
  mockup,
  appLinks,
}) => {
  // No author colour = the dark ink fallback below (bg-palette-text), so light text.
  const dark = backgroundColor ? isDarkHex(backgroundColor) : true;
  const large = bandSize === "lg";
  const app = !!mockup && (mockup.kind ?? "phone") === "phone";
  const buttons = [button, secondaryButton].filter((b): b is CtaBandButtonConfig => !!b && b.enabled !== false && !!b.text);

  const eyebrowEl = eyebrow ? (
    <p
      className={cn(app ? EYEBROW_APP : EYEBROW, !eyebrowColor && (dark ? "text-palette-accent-on-dark" : "text-palette-gold"))}
      style={eyebrowColor ? { color: eyebrowColor } : undefined}
    >
      {eyebrow}
    </p>
  ) : null;
  const headingEl = heading ? (
    <h2
      className={cn(app ? HEADING_APP : HEADING, !textColor && (dark ? "text-white" : "text-palette-text"))}
      style={textColor ? { color: textColor } : undefined}
    >
      {heading}
    </h2>
  ) : null;
  const subEl = subheading ? (
    <p
      className={cn(app ? SUB_APP : large ? SUB_LG : SUB_MD, !subheadingColor && (dark ? "text-palette-body-on-dark" : "text-palette-body"))}
      style={subheadingColor ? { color: subheadingColor } : undefined}
    >
      {subheading}
    </p>
  ) : null;
  const storeLinks = resolveAppStoreLinks(appLinks);
  const buttonRow = storeLinks ? (
    <AppStoreBadges links={storeLinks} className={cn("w-full sm:w-auto sm:shrink-0", app && "md:self-center")} />
  ) : buttons.length ? (
    <div className={cn("flex w-full flex-wrap items-start sm:w-auto sm:shrink-0", large ? "gap-3" : "gap-3.5", app && "md:self-center")}>
      {buttons.map((b, i) => (
        <CtaBandButton key={i} button={b} />
      ))}
    </div>
  ) : null;

  return (
    <section
      data-cta-band={app ? "app" : large ? "lg" : "md"}
      className={cn("w-full", app ? PAD_APP : large ? PAD_LG : PAD_MD, !backgroundColor && "bg-palette-text")}
      style={backgroundColor ? { backgroundColor } : undefined}
    >
      <div className="catalogue-shell">
        {app ? (
          <div className={APP_ROW}>
            <PhoneMockup image={mockup?.image} alt={mockup?.alt} className="hidden md:block" />
            <div className={cn(TEXT_COLUMN, "flex-1 gap-2.5 md:pb-10")}>
              {eyebrowEl}
              {headingEl}
              {subEl}
            </div>
            {buttonRow}
          </div>
        ) : (
          <div className="flex flex-col items-start gap-6 lg:flex-row lg:items-center lg:justify-between lg:gap-10">
            <div className={cn(TEXT_COLUMN, large || eyebrow ? "gap-2.5" : "gap-2")}>
              {eyebrowEl}
              {headingEl}
              {subEl}
            </div>
            {buttonRow}
          </div>
        )}
      </div>
    </section>
  );
};

export default CtaBand;
