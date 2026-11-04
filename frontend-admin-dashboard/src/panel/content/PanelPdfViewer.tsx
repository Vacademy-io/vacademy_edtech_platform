/**
 * PDF lesson on @react-pdf-viewer/core 3.12 + pdfjs-dist 3.11 LEGACY
 * (vite.panel.config.ts aliases 'pdfjs-dist' to legacy/build/pdf.js).
 *
 * - Worker: our own classic worker (./pdf.worker.ts?worker&url), never
 *   PDF_WORKER_URL (urls.ts: unpkg, modern build) — owner decision 3.
 * - isEvalSupported:false (CVE-2024-4367 class) via transformGetDocumentParams.
 * - Only the page-navigation + zoom plugins (their functions, not their UI):
 *   a big 10-foot toolbar instead of default-layout's search/print/thumbnails.
 * - PageDown/PageUp/arrow keys turn pages (classroom presenter clickers).
 *
 * Not reused: simple-pdf-viewer.tsx (unpkg worker + default layout),
 * pdf-viewer.tsx (route import), react-pdf, services/pdf-page-count.ts.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ArrowsOutLineHorizontal,
    CaretLeft,
    CaretRight,
    FrameCorners,
    MagnifyingGlassMinus,
    MagnifyingGlassPlus,
} from '@phosphor-icons/react';
import {
    SpecialZoomLevel,
    Viewer,
    Worker,
    type DocumentLoadEvent,
    type PageChangeEvent,
    type ViewerProps,
    type ZoomEvent,
} from '@react-pdf-viewer/core';
import { pageNavigationPlugin } from '@react-pdf-viewer/page-navigation';
import { zoomPlugin } from '@react-pdf-viewer/zoom';
import '@react-pdf-viewer/core/lib/styles/index.css';
import { MyButton } from '@/components/design-system/button';
import { PanelError, PanelLoading } from '../components/PanelScreenState';
import pdfWorkerUrl from './pdf.worker.ts?worker&url';
import { patchNullTransfer } from './pdfWorker/postMessageShim';
import { installCanvasGetTransform } from './canvasTransformShim';

// pdf.js posts `postMessage(message, null)`; Chrome < 70 throws on a null
// transfer list. Normalise it on the page side before any PDF opens.
if (typeof window.Worker !== 'undefined') patchNullTransfer(window.Worker.prototype);
if (typeof window.MessagePort !== 'undefined') patchNullTransfer(window.MessagePort.prototype);
// pdf.js paints with ctx.getTransform() (Chrome 68+): pages stay white on 66 without it.
installCanvasGetTransform();

const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const ZOOM_STEP = 1.25;

type GetDocumentParams = Parameters<NonNullable<ViewerProps['transformGetDocumentParams']>>[0];

/**
 * pdf.js must never compile font programs with eval/new Function, and must not
 * assume OffscreenCanvas (Chrome 69+): its default is "on unless Node".
 */
function withoutEval(options: GetDocumentParams): GetDocumentParams {
    return Object.assign({}, options, {
        isEvalSupported: false,
        isOffscreenCanvasSupported: typeof OffscreenCanvas !== 'undefined',
    });
}

export interface PanelPdfViewerProps {
    url: string;
    /** Re-resolves the signed URL (the link may have expired). */
    onRetry: () => void;
}

export default function PanelPdfViewer({ url, onRetry }: PanelPdfViewerProps) {
    const { t } = useTranslation('content');
    const navigation = pageNavigationPlugin({ enableShortcuts: false });
    const zoom = zoomPlugin({ enableShortcuts: false });
    const [page, setPage] = useState(0);
    const [pages, setPages] = useState(0);
    const [scale, setScale] = useState(1);

    const { jumpToNextPage, jumpToPreviousPage } = navigation;
    const { zoomTo } = zoom;

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (
                event.key === 'PageDown' ||
                event.key === 'ArrowRight' ||
                event.key === 'ArrowDown'
            ) {
                event.preventDefault();
                jumpToNextPage();
            } else if (
                event.key === 'PageUp' ||
                event.key === 'ArrowLeft' ||
                event.key === 'ArrowUp'
            ) {
                event.preventDefault();
                jumpToPreviousPage();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [jumpToNextPage, jumpToPreviousPage]);

    const zoomBy = (factor: number) => {
        const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * factor));
        zoomTo(next);
    };

    return (
        <div className="flex size-full flex-col bg-neutral-100">
            <div className="relative min-h-0 flex-1">
                <div className="absolute inset-0">
                    <Worker workerUrl={pdfWorkerUrl}>
                        <Viewer
                            fileUrl={url}
                            plugins={[navigation, zoom]}
                            defaultScale={SpecialZoomLevel.PageFit}
                            transformGetDocumentParams={withoutEval}
                            onDocumentLoad={(event: DocumentLoadEvent) => {
                                setPages(event.doc.numPages);
                                setPage(0);
                            }}
                            onPageChange={(event: PageChangeEvent) => setPage(event.currentPage)}
                            onZoom={(event: ZoomEvent) => setScale(event.scale)}
                            renderLoader={(percent: number) => (
                                <PanelLoading
                                    label={t('pdf.loading', { percent: Math.round(percent) })}
                                />
                            )}
                            renderError={(error) => (
                                <PanelError
                                    title={t('pdf.errorTitle')}
                                    description={t('pdf.errorBody')}
                                    detail={error.message}
                                    onRetry={onRetry}
                                />
                            )}
                        />
                    </Worker>
                </div>
            </div>

            <div className="flex shrink-0 items-center justify-center space-x-4 border-t border-border bg-card px-6 py-3">
                <MyButton
                    buttonType="secondary"
                    layoutVariant="icon"
                    scale="large"
                    className="size-16"
                    aria-label={t('pdf.previousPage')}
                    disable={pages === 0 || page <= 0}
                    onClick={() => jumpToPreviousPage()}
                >
                    <CaretLeft size={32} />
                </MyButton>
                <span className="min-w-40 text-center text-h3 tabular-nums text-neutral-700">
                    {pages > 0 ? t('pdf.page', { current: page + 1, total: pages }) : ''}
                </span>
                <MyButton
                    buttonType="secondary"
                    layoutVariant="icon"
                    scale="large"
                    className="size-16"
                    aria-label={t('pdf.nextPage')}
                    disable={pages === 0 || page >= pages - 1}
                    onClick={() => jumpToNextPage()}
                >
                    <CaretRight size={32} />
                </MyButton>

                <span className="h-10 w-px bg-border" aria-hidden />

                <MyButton
                    buttonType="secondary"
                    layoutVariant="icon"
                    scale="large"
                    className="size-16"
                    aria-label={t('pdf.zoomOut')}
                    disable={pages === 0 || scale <= MIN_SCALE}
                    onClick={() => zoomBy(1 / ZOOM_STEP)}
                >
                    <MagnifyingGlassMinus size={32} />
                </MyButton>
                <MyButton
                    buttonType="secondary"
                    layoutVariant="icon"
                    scale="large"
                    className="size-16"
                    aria-label={t('pdf.zoomIn')}
                    disable={pages === 0 || scale >= MAX_SCALE}
                    onClick={() => zoomBy(ZOOM_STEP)}
                >
                    <MagnifyingGlassPlus size={32} />
                </MyButton>
                <MyButton
                    buttonType="secondary"
                    scale="large"
                    className="h-16 px-6"
                    aria-label={t('pdf.fitPage')}
                    disable={pages === 0}
                    onClick={() => zoomTo(SpecialZoomLevel.PageFit)}
                >
                    <span className="flex items-center space-x-2">
                        <FrameCorners size={28} aria-hidden />
                        <span className="hidden xl:inline">{t('pdf.fitPage')}</span>
                    </span>
                </MyButton>
                <MyButton
                    buttonType="secondary"
                    scale="large"
                    className="h-16 px-6"
                    aria-label={t('pdf.fitWidth')}
                    disable={pages === 0}
                    onClick={() => zoomTo(SpecialZoomLevel.PageWidth)}
                >
                    <span className="flex items-center space-x-2">
                        <ArrowsOutLineHorizontal size={28} aria-hidden />
                        <span className="hidden xl:inline">{t('pdf.fitWidth')}</span>
                    </span>
                </MyButton>
            </div>
        </div>
    );
}
