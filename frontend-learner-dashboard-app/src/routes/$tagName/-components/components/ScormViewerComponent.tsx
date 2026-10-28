import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowSquareOut, ArrowsOut, BookOpenText } from "@phosphor-icons/react";
import { useMediaQuery } from "@/hooks/use-media-query";

/**
 * Catalogue `scormViewer` section — a SCORM package (a flip-book, an
 * interactive sample) played on the page the way a SCORM slide plays in a
 * course: inside our player wrapper, which carries the SCORM 1.2 / 2004 API.
 *
 * The launch URL is the `launch_url` admin-core returns for an uploaded
 * package (scorm/v1/upload). That wrapper starts its content once the host
 * sends `vacademy_scorm_init` (or by itself after a few seconds), so a public
 * page with no learner simply sends an empty init: nothing is tracked here.
 */
export interface ScormViewerProps {
  heading?: string;
  subheading?: string;
  /** Player wrapper URL of the uploaded package. */
  launchUrl?: string;
  /** Shown in the frame's bar. */
  title?: string;
  /** Frame height on tablets and desktops (any CSS length). */
  height?: string;
  /** Frame height on phones; the package's own viewer lays itself out inside. */
  mobileHeight?: string;
  showFullScreen?: boolean;
  /**
   * 'framed' (default): the package in a card with a title bar. 'book': no
   * card or bar, and the player's own controls (toolbar, page count, full
   * screen) hidden on the section's background — the pages read like a book
   * on the page. Needs a package uploaded with the current player wrapper.
   */
  appearance?: "framed" | "book";
  backgroundColor?: string;
  textColor?: string;
}

/** Props come from stored JSON, so nothing here may throw (see DocumentViewerComponent). */
const asString = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));

/** The first opaque background behind `el`, as RRGGBB (for the book look's backdrop). */
const backgroundHexBehind = (el: HTMLElement | null): string => {
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    const m = getComputedStyle(node).backgroundColor.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/);
    if (m && (m[4] === undefined || Number(m[4]) > 0.5)) {
      return [m[1], m[2], m[3]].map((v) => Math.round(Number(v)).toString(16).padStart(2, "0")).join("").toUpperCase();
    }
  }
  return "FFFFFF";
};

const hexOf = (value: unknown): string | null => {
  const m = asString(value).trim().match(/^#?([0-9a-fA-F]{6})$/);
  return m ? m[1]!.toUpperCase() : null;
};

const safeUrl = (raw: unknown): { href: string; origin: string } | null => {
  const value = asString(raw).trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return { href: url.href, origin: url.origin };
  } catch {
    return null;
  }
};

export const ScormViewerComponent: React.FC<ScormViewerProps> = ({
  heading,
  subheading,
  launchUrl,
  title,
  height = "75vh",
  mobileHeight = "70vh",
  showFullScreen = true,
  appearance = "framed",
  backgroundColor,
  textColor,
}) => {
  const { t } = useTranslation("coursePlayerA");
  const frameBoxRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  const isTablet = useMediaQuery("(min-width: 640px)");
  const isBook = appearance === "book";
  const sectionRef = useRef<HTMLElement>(null);
  // The book look paints the player on the colour behind the section; until
  // that is known the frame waits, so the package never flashes its own grey.
  const [bookBg, setBookBg] = useState<string | null>(() => hexOf(backgroundColor));
  useEffect(() => {
    if (!isBook || bookBg) return;
    setBookBg(backgroundHexBehind(sectionRef.current));
  }, [isBook, bookBg]);

  const target = safeUrl(launchUrl);
  const frameSrc = target && isBook ? `${target.href.split("#")[0]}#vchrome=none&vbg=${bookBg ?? "FFFFFF"}` : target?.href;
  const sectionTitle = asString(heading).trim();
  const subtitle = asString(subheading).trim();
  const barTitle = asString(title).trim() || sectionTitle || t("jsonRenderer.scormViewer.defaultTitle");

  // Start the package now instead of after the wrapper's fallback timer.
  const handleLoad = useCallback(() => {
    setLoaded(true);
    if (!target) return;
    try {
      iframeRef.current?.contentWindow?.postMessage({ type: "vacademy_scorm_init", cmiData: {} }, target.origin);
    } catch {
      /* the wrapper starts by itself */
    }
  }, [target]);

  // iOS Safari has no element fullscreen; there the package opens in its own tab.
  const openFullScreen = useCallback(() => {
    const box = frameBoxRef.current;
    if (box?.requestFullscreen) {
      box.requestFullscreen().catch(() => target && window.open(target.href, "_blank", "noopener,noreferrer"));
    } else if (target) {
      window.open(target.href, "_blank", "noopener,noreferrer");
    }
  }, [target]);

  const iconBtn =
    "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-catalogue-text-primary transition hover:bg-catalogue-interactive-hover";

  return (
    <section ref={sectionRef} className="catalogue-section" style={backgroundColor ? { backgroundColor } : undefined}>
      <div className="catalogue-shell">
        {(sectionTitle || subtitle) && (
          <div className="mb-6 text-center">
            {sectionTitle && (
              <h2 className="catalogue-h2 text-catalogue-text-primary" style={textColor ? { color: textColor } : undefined}>
                {sectionTitle}
              </h2>
            )}
            {subtitle && (
              <p className="mt-2 text-lg text-catalogue-text-secondary" style={textColor ? { color: textColor, opacity: 0.85 } : undefined}>
                {subtitle}
              </p>
            )}
          </div>
        )}
        {!target ? (
          <div className="flex items-center justify-center rounded-xl bg-catalogue-bg-muted py-10 text-sm text-catalogue-text-muted">
            {t("jsonRenderer.scormViewer.noPackage")}
          </div>
        ) : isBook ? (
          <>
            <div className="relative" style={{ height: isTablet ? height : mobileHeight }}>{/* design-lint-ignore: author-set frame heights from the page builder */}
              {bookBg && (
                <iframe
                  ref={iframeRef}
                  src={frameSrc}
                  title={barTitle}
                  onLoad={handleLoad}
                  loading="lazy"
                  allow="autoplay"
                  // The package runs on the media CDN's origin, never ours; it may
                  // not navigate the site away.
                  sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms"
                  className="absolute inset-0 size-full border-0"
                />
              )}
            </div>
            {!isTablet && (
              <p className="mt-2 text-center text-sm text-catalogue-text-muted">{t("jsonRenderer.scormViewer.swipeHint")}</p>
            )}
          </>
        ) : (
          <div className="overflow-hidden rounded-xl border border-catalogue-border bg-catalogue-bg-elevated shadow-lg">
            <div className="flex items-center gap-2 border-b border-catalogue-border px-3 py-1.5">
              <BookOpenText className="size-5 shrink-0 text-primary-500" aria-hidden="true" />
              <p className="min-w-0 flex-1 truncate text-sm font-medium text-catalogue-text-primary">{barTitle}</p>
              {showFullScreen && (
                <button
                  type="button"
                  onClick={openFullScreen}
                  className={iconBtn}
                  aria-label={t("jsonRenderer.scormViewer.fullScreen")}
                  title={t("jsonRenderer.scormViewer.fullScreen")}
                >
                  <ArrowsOut className="size-5" aria-hidden="true" />
                  <span className="hidden sm:inline">{t("jsonRenderer.scormViewer.fullScreen")}</span>
                </button>
              )}
              <a
                href={target.href}
                target="_blank"
                rel="noopener noreferrer"
                className={iconBtn}
                aria-label={t("jsonRenderer.scormViewer.openInNewTab")}
                title={t("jsonRenderer.scormViewer.openInNewTab")}
              >
                <ArrowSquareOut className="size-5" aria-hidden="true" />
              </a>
            </div>
            <div
              ref={frameBoxRef}
              className="relative bg-catalogue-bg-muted"
              style={{ height: isTablet ? height : mobileHeight }}// design-lint-ignore: author-set frame heights from the page builder
            >
              {!loaded && (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-catalogue-text-muted" role="status">
                  {t("jsonRenderer.scormViewer.loading")}
                </div>
              )}
              <iframe
                ref={iframeRef}
                src={target.href}
                title={barTitle}
                onLoad={handleLoad}
                loading="lazy"
                allow="fullscreen; autoplay"
                allowFullScreen
                // The package runs on the media CDN's origin, never ours; it may
                // not navigate the site away.
                sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms"
                className="absolute inset-0 size-full border-0"
              />
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

export default ScormViewerComponent;
