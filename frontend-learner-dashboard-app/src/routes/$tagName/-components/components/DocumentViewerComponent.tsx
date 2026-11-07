import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FitImage } from "@/components/common/fit-image/FitImage";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ArrowsOut, DownloadSimple, FilePdf, SpinnerGap, X } from "@phosphor-icons/react";
import type { DocumentViewerEngineLabels } from "./DocumentViewerEngine";

/**
 * Catalogue `documentViewer` section — a PDF (brochure, prospectus, book
 * catalogue) the visitor can read without leaving the site.
 *
 * Two displays:
 *  - `inline`: a viewer frame embedded in the page, with a Full-screen button.
 *  - `button`: a card with an optional cover and one button that opens the
 *    full-screen reader. This is the "Click to access" shape — the reason the
 *    section exists, since a CTA that links out to a Canva / Drive viewer
 *    hands the visitor to someone else's branding and load time.
 *
 * pdf.js only downloads when a viewer is actually mounted (see
 * DocumentViewerEngine), so `button` mode costs nothing until it is opened.
 */
const DocumentViewerEngine = React.lazy(() => import("./DocumentViewerEngine"));

export interface DocumentViewerProps {
  heading?: string;
  subheading?: string;
  /** Absolute URL of the PDF (uploaded through the editor or pasted). */
  documentUrl?: string;
  /** Suggested filename for Download; falls back to the URL's last segment. */
  fileName?: string;
  display?: "inline" | "button";
  buttonText?: string;
  /** Optional cover shown beside the button in `button` mode. */
  coverImage?: string;
  /** Inline frame height (any CSS length). */
  height?: string;
  showDownload?: boolean;
  backgroundColor?: string;
  textColor?: string;
}

/**
 * Props arrive from stored JSON, so nothing here may throw: the catalogue has no
 * error boundary and one bad value would blank the whole page.
 */
const asString = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));

const safeDecode = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s; // malformed % sequence — show it raw rather than crash
  }
};

const deriveFileName = (url: string, preferred?: unknown): string => {
  const base = asString(preferred).trim() || safeDecode(url.split("?")[0]?.split("/").pop() || "") || "document";
  return /\.pdf$/i.test(base) ? base : `${base}.pdf`;
};

/**
 * Cross-origin `<a download>` is ignored by browsers (the CDN is not the site
 * origin), so a real download has to go through a blob. If anything in that
 * path fails we fall back to opening the file in a new tab, which is still a
 * PDF the visitor can save.
 */
const downloadPdf = async (url: string, fileName: string) => {
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
};

const EngineFallback: React.FC<{ label: string; onDark?: boolean }> = ({ label, onDark }) => (
  <div className={`flex h-full min-h-48 flex-col items-center justify-center gap-3 text-sm ${onDark ? "text-white/80" : "text-catalogue-text-muted"}`} role="status">
    <SpinnerGap className="size-7 animate-spin" aria-hidden="true" />
    <span>{label}</span>
  </div>
);

export const DocumentViewerComponent: React.FC<DocumentViewerProps> = ({
  heading,
  subheading,
  documentUrl = "",
  fileName,
  display = "button",
  buttonText,
  coverImage,
  height = "70vh",
  showDownload = true,
  backgroundColor,
  textColor,
}) => {
  const { t } = useTranslation("coursePlayerA");
  const [open, setOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);

  const url = asString(documentUrl).trim();
  const resolvedFileName = useMemo(() => deriveFileName(url, fileName), [url, fileName]);
  const resolvedButtonText = asString(buttonText).trim() || t("jsonRenderer.documentViewer.open");
  const cover = asString(coverImage).trim();
  const title = asString(heading).trim();
  const subtitle = asString(subheading).trim();

  const labels = useMemo<DocumentViewerEngineLabels>(
    () => ({
      previousPage: t("jsonRenderer.documentViewer.previousPage"),
      nextPage: t("jsonRenderer.documentViewer.nextPage"),
      zoomIn: t("jsonRenderer.documentViewer.zoomIn"),
      zoomOut: t("jsonRenderer.documentViewer.zoomOut"),
      loading: t("jsonRenderer.documentViewer.loading"),
      loadFailed: t("jsonRenderer.documentViewer.loadFailed"),
      openInNewTab: t("jsonRenderer.documentViewer.openInNewTab"),
      pageOf: (current, total) => t("jsonRenderer.documentViewer.pageOf", { current, total }),
    }),
    [t],
  );

  // The overlay is `fixed`, so it must portal out of any transformed ancestor,
  // but it still needs the catalogue tokens + inline --primary-* vars, which
  // live on the [data-catalogue-theme] wrapper — same host the basket bar uses.
  useEffect(() => {
    const node = sectionRef.current;
    if (!node) return;
    setPortalHost((node.closest("[data-catalogue-theme]") as HTMLElement) || document.body);
  }, []);

  const openViewer = useCallback(() => {
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    setOpen(true);
  }, []);
  const closeViewer = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeViewer();
    };
    document.addEventListener("keydown", onKey);
    // Let the portal mount before grabbing focus.
    const focusTimer = window.setTimeout(() => closeBtnRef.current?.focus(), 0);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(focusTimer);
      restoreFocusRef.current?.focus?.();
    };
  }, [open, closeViewer]);

  const handleDownload = useCallback(async () => {
    if (!url || downloading) return;
    setDownloading(true);
    try {
      await downloadPdf(url, resolvedFileName);
    } finally {
      setDownloading(false);
    }
  }, [url, downloading, resolvedFileName]);

  const downloadLabel = t("jsonRenderer.documentViewer.download");
  const iconBtn = "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition disabled:opacity-50";

  const downloadButton = (onDark: boolean) =>
    showDownload && url ? (
      <button
        type="button"
        onClick={handleDownload}
        disabled={downloading}
        className={`${iconBtn} ${onDark ? "text-white hover:bg-white/15" : "text-catalogue-text-primary hover:bg-catalogue-interactive-hover"}`}
        aria-label={downloadLabel}
        title={downloadLabel}
      >
        {downloading ? <SpinnerGap className="size-5 animate-spin" aria-hidden="true" /> : <DownloadSimple className="size-5" aria-hidden="true" />}
        <span className="hidden sm:inline">{downloadLabel}</span>
      </button>
    ) : null;

  const overlay =
    open && url && portalHost
      ? createPortal(
          <div
            // z-70 is the top of the defined scale: above the z-60 basket bar and z-50 dialogs.
            className="fixed inset-0 z-70 flex flex-col bg-black/95"
            role="dialog"
            aria-modal="true"
            aria-label={title || resolvedFileName}
          >
            <div className="flex items-center gap-2 px-3 py-2 text-white sm:px-4">
              <FilePdf className="size-5 shrink-0 text-white/70" aria-hidden="true" />
              <p className="min-w-0 flex-1 truncate text-sm font-medium">{title || resolvedFileName}</p>
              {downloadButton(true)}
              <button
                ref={closeBtnRef}
                type="button"
                onClick={closeViewer}
                className={`${iconBtn} text-white hover:bg-white/15`}
                aria-label={t("jsonRenderer.documentViewer.close")}
              >
                <X className="size-5" aria-hidden="true" />
                <span className="hidden sm:inline">{t("jsonRenderer.documentViewer.close")}</span>
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <Suspense fallback={<EngineFallback label={labels.loading} onDark />}>
                <DocumentViewerEngine url={url} labels={labels} onDark className="h-full" />
              </Suspense>
            </div>
          </div>,
          portalHost,
        )
      : null;

  const headingBlock = (title || subtitle) && (
    <div className={`mb-6 ${display === "inline" ? "text-center" : ""}`}>
      {title && (
        <h2 className="catalogue-h2 text-catalogue-text-primary" style={textColor ? { color: textColor } : undefined}>
          {title}
        </h2>
      )}
      {subtitle && (
        <p className="mt-2 text-lg text-catalogue-text-secondary" style={textColor ? { color: textColor, opacity: 0.85 } : undefined}>
          {subtitle}
        </p>
      )}
    </div>
  );

  return (
    <section ref={sectionRef} className="catalogue-section" style={backgroundColor ? { backgroundColor } : undefined}>
      <div className="catalogue-shell">
        {!url ? (
          <>
            {headingBlock}
            <div className="flex items-center justify-center rounded-xl bg-catalogue-bg-muted py-10 text-sm text-catalogue-text-muted">
              {t("jsonRenderer.documentViewer.noDocument")}
            </div>
          </>
        ) : display === "inline" ? (
          <>
            {headingBlock}
            <div className="overflow-hidden rounded-xl border border-catalogue-border bg-catalogue-bg-elevated shadow-lg">
              <div className="flex items-center gap-2 border-b border-catalogue-border px-3 py-1.5">
                <FilePdf className="size-5 shrink-0 text-primary-500" aria-hidden="true" />
                <p className="min-w-0 flex-1 truncate text-sm font-medium text-catalogue-text-primary">{resolvedFileName}</p>
                {downloadButton(false)}
                <button
                  type="button"
                  onClick={openViewer}
                  className={`${iconBtn} text-catalogue-text-primary hover:bg-catalogue-interactive-hover`}
                  aria-label={t("jsonRenderer.documentViewer.fullScreen")}
                  title={t("jsonRenderer.documentViewer.fullScreen")}
                >
                  <ArrowsOut className="size-5" aria-hidden="true" />
                  <span className="hidden sm:inline">{t("jsonRenderer.documentViewer.fullScreen")}</span>
                </button>
              </div>
              <div className="bg-catalogue-bg-muted" style={{ height }}>{/* design-lint-ignore: author-set frame height from the page builder */}
                <Suspense fallback={<EngineFallback label={labels.loading} />}>
                  <DocumentViewerEngine url={url} labels={labels} className="h-full" />
                </Suspense>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-8">
            <div className="min-w-0 flex-1 basis-64">
              {headingBlock}
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={openViewer}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary-500 px-6 py-3 font-semibold text-white shadow-md transition hover:opacity-90"
                >
                  <FilePdf className="size-5" aria-hidden="true" />
                  {resolvedButtonText}
                </button>
                {downloadButton(false)}
              </div>
            </div>
            {cover && (
              <button
                type="button"
                onClick={openViewer}
                className="group relative w-full max-w-xs overflow-hidden rounded-xl border border-catalogue-border shadow-lg sm:w-64"
                aria-label={resolvedButtonText}
              >
                <FitImage src={cover} alt="" className="w-full transition group-hover:scale-105" style={{ aspectRatio: "4/3" }} />{/* design-lint-ignore: same 4:3 crop as ImageGallery */}
                <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition group-hover:bg-black/25">
                  <ArrowsOut className="size-8 text-white opacity-0 drop-shadow transition group-hover:opacity-100" aria-hidden="true" />
                </span>
              </button>
            )}
          </div>
        )}
      </div>
      {overlay}
    </section>
  );
};

export default DocumentViewerComponent;
