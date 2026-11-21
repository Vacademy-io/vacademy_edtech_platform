import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Viewer, SpecialZoomLevel } from '@react-pdf-viewer/core';
import { Worker } from '@react-pdf-viewer/core';
import '@react-pdf-viewer/core/lib/styles/index.css';
import type { ToolbarProps, ToolbarSlot, TransformToolbarSlot } from '@react-pdf-viewer/toolbar';
import { defaultLayoutPlugin } from '@react-pdf-viewer/default-layout';
import { pageNavigationPlugin } from '@react-pdf-viewer/page-navigation';
import { fullScreenPlugin } from '@react-pdf-viewer/full-screen';
import { useMediaNavigationStore } from '../-stores/media-navigation-store';
import { toast } from 'sonner';
import { useSlideDownloadAccess } from '@/hooks/useSlideDownloadAccess';

// Style imports
import '@react-pdf-viewer/core/lib/styles/index.css';
import '@react-pdf-viewer/default-layout/lib/styles/index.css';
import '@react-pdf-viewer/full-screen/lib/styles/index.css';
import { PDF_WORKER_URL } from '@/constants/urls';
import { FilePdf } from '@phosphor-icons/react';
import { Route } from '..';

interface PDFViewerProps {
    pdfUrl: string;
}

const PDFViewer: React.FC<PDFViewerProps> = ({ pdfUrl }) => {
    const { t } = useTranslation('studyLibraryPdfViewer');
    const searchParams = Route.useSearch();
    const { pdfPageNumber, clearPdfPageNumber } = useMediaNavigationStore();

    const pageNavigationPluginInstance = pageNavigationPlugin();
    const { jumpToPage } = pageNavigationPluginInstance;

    // Per-role enforcement: hide Download/Print for roles an admin has blocked
    // (admins keep them by default). We must wait for `isResolved` before
    // mounting the Viewer — its toolbar is built once at mount and won't rebuild
    // when the transform changes, so mounting before the setting loads would
    // bake in the default-allow value and never hide the buttons for a blocked
    // role (e.g. a teacher).
    const { canDownload, canPrintPdf, isResolved } = useSlideDownloadAccess();
    const allowDownload = canDownload('DOCUMENT_PDF');
    // Print inherits the download permission unless explicitly configured.
    const allowPrint = canPrintPdf();

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

    const transform: TransformToolbarSlot = (slot: ToolbarSlot) => ({
        ...slot,
        Open: () => <></>,
        // Use our fullscreen button (configured to fit page width on enter/exit)
        // instead of the default-layout's internal one, which we can't configure.
        EnterFullScreen: () => <EnterFullScreenButton />,
        ...(allowDownload ? {} : { Download: () => <></>, DownloadMenuItem: () => <></> }),
        ...(allowPrint ? {} : { Print: () => <></>, PrintMenuItem: () => <></> }),
    });

    const renderToolbar = (Toolbar: (props: ToolbarProps) => React.ReactElement) => (
        <Toolbar>{renderDefaultToolbar(transform)}</Toolbar>
    );

    const defaultLayoutPluginInstance = defaultLayoutPlugin({
        renderToolbar,
    });
    const { renderDefaultToolbar } = defaultLayoutPluginInstance.toolbarPluginInstance;

    // Handle initial page navigation from URL params
    useEffect(() => {
        if (searchParams.currentPage) {
            try {
                // Convert 1-based page number to 0-based index
                const pageIndex = Number(searchParams.currentPage) - 1;
                jumpToPage(pageIndex);
            } catch (error) {
                console.error('Error jumping to initial page:', error);
                toast.error(t('failedToNavigateInitial'));
            }
        }
    }, [searchParams.currentPage, jumpToPage]);

    // Handle page navigation when pdfPageNumber changes
    useEffect(() => {
        if (pdfPageNumber !== null) {
            try {
                // Convert 1-based page number to 0-based index
                const pageIndex = pdfPageNumber - 1;
                jumpToPage(pageIndex);
                clearPdfPageNumber();
                toast.success(t('navigatedToPage', { page: pdfPageNumber }));
            } catch (error) {
                console.error('Error jumping to page:', error);
                toast.error(t('failedToNavigate'));
                clearPdfPageNumber();
            }
        }
    }, [pdfPageNumber, clearPdfPageNumber, jumpToPage]);

    // An empty/blank URL makes @react-pdf-viewer hand pdf.js a source with no
    // .data/.range/.url, which throws "Invalid parameter object: need either
    // .data, .range or .url". This happens when a PDF slide has no uploaded file
    // yet (empty document_slide.data → getPublicUrl returns ''). Show a clean
    // empty state instead of letting the viewer crash.
    if (!pdfUrl?.trim()) {
        return (
            <div className="flex size-full flex-col items-center justify-center gap-2 text-center">
                <FilePdf size={40} className="text-neutral-300" />
                <p className="text-sm text-neutral-500">{t('noPdfUploaded')}</p>
            </div>
        );
    }

    return (
        <Worker workerUrl={PDF_WORKER_URL}>
            <div className="size-full">
                {isResolved ? (
                    <Viewer
                        fileUrl={pdfUrl}
                        defaultScale={SpecialZoomLevel.PageWidth}
                        plugins={[
                            defaultLayoutPluginInstance,
                            pageNavigationPluginInstance,
                            fullScreenPluginInstance,
                        ]}
                    />
                ) : (
                    <div className="flex size-full items-center justify-center text-sm text-neutral-400">
                        {t('loadingEllipsis')}
                    </div>
                )}
            </div>
        </Worker>
    );
};

export default PDFViewer;
