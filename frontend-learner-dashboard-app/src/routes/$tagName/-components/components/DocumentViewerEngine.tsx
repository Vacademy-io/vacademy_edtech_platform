import React, { useCallback, useRef } from "react";
import { ScrollMode, SpecialZoomLevel, Viewer, Worker } from "@react-pdf-viewer/core";
import { pageNavigationPlugin } from "@react-pdf-viewer/page-navigation";
import { zoomPlugin } from "@react-pdf-viewer/zoom";
import {
  ArrowSquareOut,
  CaretLeft,
  CaretRight,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  SpinnerGap,
} from "@phosphor-icons/react";

import "@react-pdf-viewer/core/lib/styles/index.css";

/**
 * The pdf.js half of the catalogue `documentViewer` section.
 *
 * Split out of DocumentViewerComponent and loaded with React.lazy so that
 * `@react-pdf-viewer/core` + pdfjs-dist (~1 MB) only download on a page that
 * actually shows a document — and, in button mode, only once the visitor opens
 * it. Everything a visitor can see before the chunk lands (section copy, the
 * open button, the overlay header with Close / Download) lives in the host.
 *
 * Same worker pin as simple-pdf-viewer.tsx: pdf.js refuses to start when the
 * API and worker versions differ, so this must track the installed pdfjs-dist.
 */
const PDF_WORKER_URL = "/pdfjs/3.11.174/pdf.worker.min.js";

const SWIPE_MIN_PX = 60;

export interface DocumentViewerEngineLabels {
  previousPage: string;
  nextPage: string;
  zoomIn: string;
  zoomOut: string;
  loading: string;
  loadFailed: string;
  openInNewTab: string;
  /** Rendered as "{current} / {total}" by the caller-provided formatter. */
  pageOf: (current: number, total: number) => string;
}

export interface DocumentViewerEngineProps {
  url: string;
  labels: DocumentViewerEngineLabels;
  /** Overlay sits on a dark scrim, so its controls invert. */
  onDark?: boolean;
  className?: string;
}

const DocumentViewerEngine: React.FC<DocumentViewerEngineProps> = ({ url, labels, onDark = false, className = "" }) => {
  // Plugin factories use hooks internally, so they run at the top level on
  // every render (not inside useMemo) — the library's contract.
  const navigation = pageNavigationPlugin();
  const zoom = zoomPlugin();
  const { CurrentPageLabel, jumpToNextPage, jumpToPreviousPage } = navigation;
  const { ZoomIn, ZoomOut } = zoom;

  // One page at a time with swipe / arrows — a catalogue reads like a
  // brochure, not like a scrolling report. Touch only flips when the page is
  // not itself horizontally scrollable (i.e. not zoomed in), otherwise a pan
  // across a zoomed page would also turn it.
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStart.current = t ? { x: t.clientX, y: t.clientY } : null;
  }, []);
  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const start = touchStart.current;
      touchStart.current = null;
      const t = e.changedTouches[0];
      if (!start || !t) return;
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      const pageBox = frameRef.current?.querySelector<HTMLElement>('[class*="rpv-core__inner-page-container"]');
      if (pageBox && pageBox.scrollWidth > pageBox.clientWidth + 2) return;
      if (dx < 0) jumpToNextPage();
      else jumpToPreviousPage();
    },
    [jumpToNextPage, jumpToPreviousPage],
  );

  const pillBtn = `inline-flex size-9 items-center justify-center rounded-full transition disabled:opacity-40 ${
    onDark ? "text-white hover:bg-white/15" : "text-catalogue-text-primary hover:bg-catalogue-interactive-hover"
  }`;

  return (
    <div
      ref={frameRef}
      className={`relative flex min-h-0 flex-col ${className}`}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      // Paint our own ground; the viewer's page-area grey would fight the
      // catalogue tokens in a light theme and the scrim in the overlay.
      style={{ ["--rpv-core__inner-page-background-color" as string]: "transparent" }} // design-lint-ignore: pdf-viewer CSS variable override
    >
      {/* Bottom padding keeps the floating pill off the page: PageFit measures
          the content box, so the page shrinks to sit above it. */}
      <div className="min-h-0 flex-1 pb-14">
        <Worker workerUrl={PDF_WORKER_URL}>
          <Viewer
            fileUrl={url}
            plugins={[navigation, zoom]}
            scrollMode={ScrollMode.Page}
            // Whole page always visible (inline frame or overlay); zoom is
            // the way in, not scrolling around a half-shown page.
            defaultScale={SpecialZoomLevel.PageFit}
            theme={onDark ? "dark" : "light"}
            renderLoader={(percent: number) => (
              <div className={`flex flex-col items-center gap-3 text-sm ${onDark ? "text-white/80" : "text-catalogue-text-muted"}`} role="status">
                <SpinnerGap className="size-7 animate-spin" aria-hidden="true" />
                <span>
                  {labels.loading}
                  {percent > 0 && percent < 100 ? ` ${Math.round(percent)}%` : ""}
                </span>
              </div>
            )}
            renderError={() => (
              <div className={`flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm ${onDark ? "text-white/85" : "text-catalogue-text-secondary"}`}>
                <p>{labels.loadFailed}</p>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`inline-flex items-center gap-1.5 font-semibold underline underline-offset-4 ${onDark ? "text-white" : "text-primary-500"}`}
                >
                  <ArrowSquareOut className="size-4" aria-hidden="true" />
                  {labels.openInNewTab}
                </a>
              </div>
            )}
          />
        </Worker>
      </div>

      {/* Floating page / zoom pill. Below the page rather than in the header so
          a thumb reaches it on a phone. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-3">
        <div
          className={`pointer-events-auto flex items-center gap-0.5 rounded-full px-1.5 py-1 shadow-lg backdrop-blur ${
            onDark ? "bg-black/60 text-white" : "border border-catalogue-border bg-catalogue-bg-elevated/95 text-catalogue-text-primary"
          }`}
        >
          <button type="button" className={pillBtn} onClick={jumpToPreviousPage} aria-label={labels.previousPage}>
            <CaretLeft className="size-5" aria-hidden="true" />
          </button>
          <CurrentPageLabel>
            {({ currentPage, numberOfPages }) => (
              <span className="min-w-14 select-none px-1 text-center text-sm font-medium tabular-nums" aria-live="polite">
                {labels.pageOf(currentPage + 1, numberOfPages)}
              </span>
            )}
          </CurrentPageLabel>
          <button type="button" className={pillBtn} onClick={jumpToNextPage} aria-label={labels.nextPage}>
            <CaretRight className="size-5" aria-hidden="true" />
          </button>
          <span className={`mx-1 h-5 w-px ${onDark ? "bg-white/25" : "bg-catalogue-border"}`} aria-hidden="true" />
          <ZoomOut>
            {({ onClick }) => (
              <button type="button" className={pillBtn} onClick={onClick} aria-label={labels.zoomOut}>
                <MagnifyingGlassMinus className="size-5" aria-hidden="true" />
              </button>
            )}
          </ZoomOut>
          <ZoomIn>
            {({ onClick }) => (
              <button type="button" className={pillBtn} onClick={onClick} aria-label={labels.zoomIn}>
                <MagnifyingGlassPlus className="size-5" aria-hidden="true" />
              </button>
            )}
          </ZoomIn>
        </div>
      </div>
    </div>
  );
};

export default DocumentViewerEngine;
