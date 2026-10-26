import {
  DocumentLoadEvent,
  PageChangeEvent,
  Viewer,
  SpecialZoomLevel,
} from "@react-pdf-viewer/core";
import { Worker } from "@react-pdf-viewer/core";

import { defaultLayoutPlugin } from "@react-pdf-viewer/default-layout";
import { pageNavigationPlugin } from "@react-pdf-viewer/page-navigation";
import { fullScreenPlugin } from "@react-pdf-viewer/full-screen";
import type {
  ToolbarProps,
  ToolbarSlot,
  TransformToolbarSlot,
} from "@react-pdf-viewer/toolbar";
import { Capacitor } from '@capacitor/core'; // Import Capacitor

import "@react-pdf-viewer/core/lib/styles/index.css";
import "@react-pdf-viewer/default-layout/lib/styles/index.css";
import "@react-pdf-viewer/page-navigation/lib/styles/index.css";
import "@react-pdf-viewer/full-screen/lib/styles/index.css";
import "./pdf-viewer-toolbar.css";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSlideDownloadPermission } from "@/hooks/useSlideDownloadPermission";
import { SlideDownloadTypeKey } from "@/constants/slide-download-permission";

export interface PdfViewerComponentRef {
  jumpToPage: (pageIndex: number) => void;
}

export const PdfViewerComponent = forwardRef<PdfViewerComponentRef, {
  pdfUrl: string;
  handleDocumentLoad: (e: DocumentLoadEvent) => void;
  handlePageChange: (e: PageChangeEvent) => void;
  initialPage?: number;
}>(({
  pdfUrl,
  handleDocumentLoad,
  handlePageChange,
  initialPage = 0
}, ref) => {
  const { t } = useTranslation("libraryCommonB");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerHeight, setContainerHeight] = useState<string | undefined>(undefined);

  // Whether this user's role is allowed to download / print the PDF
  // (admin-configured per role; defaults to today's behavior — Download and
  // Print stay hidden for learners).
  const { canDownload, canPrintPdf, isResolved } = useSlideDownloadPermission();
  const allowDownload = canDownload(SlideDownloadTypeKey.DOCUMENT_PDF);
  // Print inherits the download permission unless explicitly configured.
  const allowPrint = canPrintPdf();

  // Platform check
  const isIOS = Capacitor.getPlatform() === 'ios';

  const pageNavigationPluginInstance = pageNavigationPlugin();
  const { jumpToPage } = pageNavigationPluginInstance;

  // Fit the page to width on entering/exiting fullscreen so it fills the
  // (much wider) fullscreen viewport instead of keeping its load-time scale
  // and leaving large empty side margins. defaultLayoutPlugin doesn't expose
  // its internal full-screen plugin, so we run our own (with the zoom
  // callback) and route the toolbar's fullscreen button to it (transform below).
  const fullScreenPluginInstance = fullScreenPlugin({
    onEnterFullScreen: (zoom) => zoom(SpecialZoomLevel.PageWidth),
    onExitFullScreen: (zoom) => zoom(SpecialZoomLevel.PageWidth),
  });
  const { EnterFullScreenButton } = fullScreenPluginInstance;

  useImperativeHandle(ref, () => ({
    jumpToPage: (pageIndex: number) => {
      jumpToPage(pageIndex);
    },
  }), [jumpToPage]);

  const transform: TransformToolbarSlot = (slot: ToolbarSlot) => ({
    ...slot,
    Open: () => <></>,
    SwitchSelectionModeMenuItem: () => <></>,
    // Use our fullscreen button (configured to fit page width on enter/exit)
    // instead of the default-layout's internal one, which we can't configure.
    EnterFullScreen: () => <EnterFullScreenButton />,
    // Download / Print are shown only when the institute allows this role to
    // download / print PDFs; otherwise those toolbar entries are hidden.
    // When allowed, the marker keeps the toolbar button visible on phones too
    // (pdf-viewer-toolbar.css); the ⋮ menu entries stay as a fallback.
    ...(allowDownload
      ? {
          Download: () => (
            <span data-pdf-toolbar-show className="contents">
              <slot.Download />
            </span>
          ),
        }
      : {
          Download: () => <></>,
          DownloadMenuItem: () => <></>,
        }),
    ...(allowPrint
      ? {
          Print: () => (
            <span data-pdf-toolbar-show className="contents">
              <slot.Print />
            </span>
          ),
        }
      : {
          Print: () => <></>,
          PrintMenuItem: () => <></>,
        }),
  });
  
  const renderToolbar = (
    Toolbar: (props: ToolbarProps) => React.ReactElement
  ) => (
    <div className="sticky top-0 z-10 bg-white">
      <Toolbar>{renderDefaultToolbar(transform)}</Toolbar>
    </div>
  );
  
  const defaultLayoutPluginInstance = defaultLayoutPlugin({
    renderToolbar,
  });
  
  const { renderDefaultToolbar } =
    defaultLayoutPluginInstance.toolbarPluginInstance;

  // Compute dynamic height for all mobile devices (iOS & Android) to handle URL bars/safe areas
  useEffect(() => {
    const computeHeight = () => {
      const w = window.innerWidth;
      const vh = window.innerHeight;
      
      let headerHeight = 60; 
      let bottomNavHeight = 0;
      
      if (w < 640) {
        headerHeight = 50;
        bottomNavHeight = 60; 
      } else if (w < 1024) {
        headerHeight = 70;
      } else {
        headerHeight = 80;
      }
      
      const totalOffset = headerHeight + bottomNavHeight + 10;
      const h = Math.max(300, vh - totalOffset);
      setContainerHeight(`${h}px`);
    };

    computeHeight();
    window.addEventListener("resize", computeHeight);
    window.addEventListener("orientationchange", computeHeight);
    
    // ResizeObserver is safe on modern browsers (Chrome/Safari/Edge)
    const resizeObserver = new ResizeObserver(computeHeight);
    resizeObserver.observe(document.body);
    
    return () => {
      window.removeEventListener("resize", computeHeight);
      window.removeEventListener("orientationchange", computeHeight);
      resizeObserver.disconnect();
    };
  }, []);

  // react-pdf-viewer aligns toolbar popovers (e.g. the ⋮ "More actions" menu)
  // to their button without checking bounds, so on phones the menu runs past
  // the left edge and this container's overflow-x-hidden clips its labels.
  // When a popover opens outside the visible area, nudge it back inside.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const MARGIN = 8;

    const keepInside = (body: HTMLElement) => {
      if (!body.isConnected) return;
      const fullScreenEl = document.fullscreenElement;
      const boundsEl =
        fullScreenEl && fullScreenEl.contains(body) ? fullScreenEl : container;
      const bounds = boundsEl.getBoundingClientRect();
      const rect = body.getBoundingClientRect();
      let shift = 0;
      if (rect.left < bounds.left + MARGIN) {
        shift = bounds.left + MARGIN - rect.left;
      } else if (rect.right > bounds.right - MARGIN) {
        shift = bounds.right - MARGIN - rect.right;
      }
      if (!shift) return;
      body.style.left = `${(parseFloat(body.style.left) || 0) + shift}px`;
      // The arrow no longer points at the button once the popover is moved
      const arrow = body.querySelector<HTMLElement>(
        ".rpv-core__popover-body-arrow"
      );
      if (arrow) arrow.style.display = "none";
    };

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (
            node instanceof HTMLElement &&
            node.classList.contains("rpv-core__popover-body")
          ) {
            // The library positions it in a layout effect, which has run by
            // now; re-check next frame in case layout was still settling.
            keepInside(node);
            requestAnimationFrame(() => keepInside(node));
          }
        });
      }
    });
    observer.observe(container, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return (
    <Worker workerUrl="/pdfjs/3.11.174/pdf.worker.min.js">
      <div
        ref={containerRef}
        className="w-full max-w-full mx-0 px-0 overflow-y-scroll overflow-x-hidden custom-scrollbar"
        style={{
          height: containerHeight || "100%",
          minHeight: "300px",
          // Critical for mobile scrolling:
          touchAction: "pan-y", 
          WebkitOverflowScrolling: "touch",
          // 'contain' stops the bounce on iOS (iOS 16+) and Chrome Android
          // It is safe for Windows/Desktop (simply ignored or prevents pull-refresh)
          overscrollBehavior: "contain", 
          position: "relative",
        }}
      >
        {/* Wait for the download/print permission to resolve before mounting the
            viewer — its toolbar is built once and won't rebuild, so mounting
            early would bake in the default and ignore an admin "enable". */}
        {isResolved ? (
          <Viewer
            fileUrl={pdfUrl}
            onDocumentLoad={handleDocumentLoad}
            onPageChange={handlePageChange}
            plugins={[
              defaultLayoutPluginInstance,
              pageNavigationPluginInstance,
              fullScreenPluginInstance,
            ]}
            defaultScale={SpecialZoomLevel.PageWidth}
            initialPage={initialPage}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm text-neutral-400">
            {t("pdfViewer.loading")}
          </div>
        )}
      </div>
    </Worker>
  );
});