import React, { useEffect, useState } from "react";
import { CheckCircle } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { getPublicUrlWithoutLogin } from "@/services/upload_file";
import { useSiteNavigate } from "../../-utils/catalogue-route-search";
import { hexToHslChannels } from "../../-utils/catalogue-palette";
import { Breadcrumb, type BreadcrumbItem } from "./catalog/Breadcrumb";

/**
 * heroSection variant "editorial" (opt-in: `variant: "editorial"`), the
 * Learning Paths hero of the Brahm Varchas design (Figma 73:357):
 *
 *   Home / Learning Paths                      ┌──────────────┐
 *   ── LEARNING PATHS                          │              │
 *   Not sure where to start?                   │ illustration │
 *   Follow a path.            ← accent line    │  (unframed)  │
 *   lead paragraph                             │              │
 *   ✓ bullet  ✓ bullet  ✓ bullet               └──────────────┘
 *   [Primary]  [Outline]
 *
 * Full-bleed band, content in the site's `.catalogue-shell` (1152 px when the
 * site sets theme.contentMaxWidth). Colours come from the site palette
 * (text-palette-*), which falls back to catalogue tokens on any other site.
 * Every string arrives already in the visitor's language: breadcrumb labels,
 * titleAccent and checklist are text keys, localized by JsonRenderer.
 */

export interface HeroEditorialButton {
  text: string;
  action?: string;
  target?: string;
  audienceId?: string;
  variant?: "primary" | "secondary";
}

export interface HeroEditorialProps {
  backgroundColor?: string;
  eyebrow?: { text: string; style?: string };
  /** "Home / Learning Paths": earlier items with a route are links, the last is the current page. */
  breadcrumb?: BreadcrumbItem[];
  /** Width of the media column in px at ≥1024 (default 500, 200–800). */
  mediaWidth?: number;
  /** Border of the outline (secondary) button, hex (default: the palette's strong border). */
  outlineColor?: string;
  left?: {
    title?: string;
    /** Second title line, on its own line in the palette accent colour. */
    titleAccent?: string;
    /** HTML lead paragraph (shown in full, no "View more" clamp). */
    description?: string;
    /** Check bullets under the lead. */
    checklist?: string[];
    buttons?: HeroEditorialButton[];
  };
  right?: {
    image?: string;
    alt?: string;
    /**
     * The image's width / height ("1660/1460" or 1.14). Reserves its box
     * before the image loads, so the page does not shift (CLS).
     */
    aspectRatio?: number | string;
  };
}

// Exact Figma values (node 73:357). Arbitrary values live only on these lines.
const C = {
  section: "w-full overflow-hidden py-12 lg:py-[72px]", // design-lint-ignore: Figma hero 72px padding
  grid: "catalogue-shell grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_var(--hero-media-w)] lg:gap-14", // design-lint-ignore: Figma text column + fixed media column
  crumb: "text-[13px] leading-5 text-palette-muted", // design-lint-ignore: Figma 13px breadcrumb
  eyebrowText: "text-xs font-normal uppercase leading-4 tracking-[1.1px] text-palette-gold", // design-lint-ignore: Figma 1.1px tracking
  title: "text-[length:clamp(2.25rem,3vw_+_1rem,3.25rem)] font-bold leading-[1.15] text-palette-text lg:text-[52px] lg:leading-[60px]", // design-lint-ignore: Figma 52/60 headline
  lead: "w-full text-lg leading-[29px] text-palette-body [&_p]:m-0", // design-lint-ignore: Figma 18/29 lead
  button: "inline-flex items-center justify-center rounded-lg px-7 py-3.5 text-[15px] font-normal leading-[23px] no-underline transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-palette-primary/40", // design-lint-ignore: Figma 15/23 button label
  outline: "border border-[hsl(var(--hero-outline,var(--palette-border-strong,var(--catalogue-border-strong))))] bg-catalogue-bg-elevated text-palette-text hover:border-palette-primary", // design-lint-ignore: authored outline colour var
  media: "block h-auto w-full max-w-[var(--hero-media-w)] justify-self-center lg:justify-self-end", // design-lint-ignore: media column width var
};

export const resolveMediaWidth = (raw: unknown): number => {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 200 && n <= 800 ? Math.round(n) : 500;
};

/** An authored aspect ratio ("1660/1460", "1660 / 1460", 1.14) as a CSS value; null when absent or out of range. */
export const resolveAspectRatio = (raw: unknown): string | null => {
  let w: number;
  let h = 1;
  if (typeof raw === "number") w = raw;
  else if (typeof raw === "string" && raw.trim()) {
    const parts = raw.split("/").map((p) => Number(p.trim()));
    if (parts.length > 2 || parts.some((n) => !Number.isFinite(n))) return null;
    [w, h = 1] = parts;
  } else return null;
  if (!(w > 0) || !(h > 0)) return null;
  const ratio = w / h;
  return ratio >= 0.2 && ratio <= 5 ? `${w} / ${h}` : null;
};

/** An http(s) URL or site path as is; anything else is a media id resolved to a public URL. */
const useResolvedImage = (src: string | undefined): string => {
  const raw = (src || "").trim();
  const direct = !raw || /^(https?:)?\/\//i.test(raw) || raw.startsWith("/") || raw.startsWith("data:");
  const [resolved, setResolved] = useState(direct ? raw : "");
  useEffect(() => {
    if (direct) {
      setResolved(raw);
      return;
    }
    let live = true;
    getPublicUrlWithoutLogin(raw)
      .then((url) => live && setResolved(url || ""))
      .catch(() => live && setResolved(""));
    return () => {
      live = false;
    };
  }, [raw, direct]);
  return resolved;
};

/** The default hero's button behaviour: in-page anchor scroll, site navigation, audience form, lead form. */
export const runHeroButtonAction = (
  button: HeroEditorialButton,
  navigate: (target: string) => unknown,
): void => {
  if (button.action === "navigate" && button.target) {
    // A bare "#anchor" is an in-page jump: scroll to it when the element is
    // on the page, else navigate (a real route still routes).
    const target = button.target.trim();
    if (target.startsWith("#")) {
      const el = document.getElementById(target.slice(1));
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
    }
    void navigate(target);
  } else if (button.action === "openForm" && (button.audienceId || "").trim()) {
    window.dispatchEvent(
      new CustomEvent("openAudienceForm", {
        detail: { audienceId: (button.audienceId || "").trim(), title: button.text },
      }),
    );
  } else if (button.action === "openLeadCollection") {
    window.dispatchEvent(new CustomEvent("openLeadCollection", { detail: { source: "heroSection" } }));
  }
};

export const HeroEditorial: React.FC<HeroEditorialProps> = ({
  backgroundColor,
  eyebrow,
  breadcrumb,
  mediaWidth,
  outlineColor,
  left,
  right,
}) => {
  const siteNavigate = useSiteNavigate();
  const image = useResolvedImage(right?.image);
  const ratio = right?.image ? resolveAspectRatio(right.aspectRatio) : null;

  const onButton = (button: HeroEditorialButton) => runHeroButtonAction(button, siteNavigate);

  const title = (left?.title || "").trim();
  const accent = (left?.titleAccent || "").trim();
  const checklist = (left?.checklist || []).filter((s) => typeof s === "string" && s.trim());
  const buttons = (left?.buttons || []).filter((b) => b?.text?.trim()).slice(0, 3);
  const outline = hexToHslChannels(outlineColor);

  const sectionStyle = {
    // Admin-authored band colour (free-form) and layout vars.
    ...(backgroundColor ? { backgroundColor } : {}),
    "--hero-media-w": `${resolveMediaWidth(mediaWidth)}px`,
    ...(outline ? { "--hero-outline": outline } : {}),
  } as React.CSSProperties;

  return (
    <section
      data-hero-variant="editorial"
      className={cn(C.section, !backgroundColor && "bg-palette-cream")}
      style={sectionStyle}
    >
      <div className={C.grid}>
        <div className="flex min-w-0 flex-col items-start gap-5">
          <Breadcrumb
            items={breadcrumb}
            className={C.crumb}
            currentClassName="text-palette-muted"
            linkClassName="hover:text-palette-text"
          />
          {eyebrow?.text?.trim() && (
            <p className="flex items-center gap-3">
              <span aria-hidden="true" className="h-px w-6 shrink-0 bg-palette-accent" />
              <span className={C.eyebrowText}>{eyebrow.text}</span>
            </p>
          )}
          {(title || accent) && (
            <h1 className={C.title}>
              {title}
              {accent && <span className="block text-palette-accent">{accent}</span>}
            </h1>
          )}
          {left?.description?.trim() && (
            <div className={C.lead} dangerouslySetInnerHTML={{ __html: left.description }} />
          )}
          {checklist.length > 0 && (
            <ul className="flex flex-wrap gap-x-6 gap-y-2 pt-1">
              {checklist.map((item, i) => (
                <li key={`${i}-${item}`} className="flex items-center gap-2 text-sm font-bold text-palette-text">
                  <CheckCircle size={18} weight="fill" className="shrink-0 text-palette-olive" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          )}
          {buttons.length > 0 && (
            <div className="flex flex-wrap gap-4 pt-2">
              {buttons.map((b, i) => (
                <button
                  key={`${i}-${b.text}`}
                  type="button"
                  onClick={() => onButton(b)}
                  className={cn(
                    C.button,
                    (b.variant ?? (i === 0 ? "primary" : "secondary")) === "primary"
                      ? "bg-palette-primary text-white hover:bg-palette-primary/90"
                      : C.outline,
                  )}
                >
                  {b.text}
                </button>
              ))}
            </div>
          )}
        </div>
        {ratio ? (
          // The box is there before the image (no layout shift while it loads).
          <div className={C.media} style={{ aspectRatio: ratio }} data-hero-media="">
            {image && (
              <img
                src={image}
                alt={right?.alt || ""}
                className="block h-full w-full object-contain"
                fetchPriority="high"
                decoding="async"
              />
            )}
          </div>
        ) : (
          image && (
            <img src={image} alt={right?.alt || ""} className={C.media} fetchPriority="high" decoding="async" />
          )
        )}
      </div>
    </section>
  );
};

export default HeroEditorial;
