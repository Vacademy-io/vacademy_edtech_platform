import React, { useEffect } from 'react';
import { Viewer, Worker, SpecialZoomLevel } from '@react-pdf-viewer/core';
import { defaultLayoutPlugin } from '@react-pdf-viewer/default-layout';
import { fullScreenPlugin } from '@react-pdf-viewer/full-screen';
import type { ToolbarSlot, ToolbarProps, TransformToolbarSlot } from '@react-pdf-viewer/toolbar';
import { PDF_WORKER_URL } from '@/constants/urls';

import '@react-pdf-viewer/core/lib/styles/index.css';
import '@react-pdf-viewer/default-layout/lib/styles/index.css';
import '@react-pdf-viewer/full-screen/lib/styles/index.css';

interface SimplePDFViewerProps {
    pdfUrl: string;
    /** 0-based page to open on (the Submission page jumps to a question's page). */
    initialPage?: number;
    /** 0-based page to move to while open, without reloading the document. */
    page?: number;
}

/**
 * Simple PDF Viewer component without route dependencies
 * Can be used anywhere in the application
 */
const SimplePDFViewer: React.FC<SimplePDFViewerProps> = ({ pdfUrl, initialPage, page }) => {
    // Fit the page to width when entering/exiting fullscreen so it fills the
    // (much wider) fullscreen viewport instead of keeping its load-time scale
    // and leaving large empty side margins. defaultLayoutPlugin doesn't expose
    // its internal full-screen plugin, so we run our own (with the zoom
    // callback) and route the toolbar's fullscreen button to it below.
    const fullScreenPluginInstance = fullScreenPlugin({
        onEnterFullScreen: (zoom) => zoom(SpecialZoomLevel.PageWidth),
        onExitFullScreen: (zoom) => zoom(SpecialZoomLevel.PageWidth),
    });
    const { EnterFullScreenButton } = fullScreenPluginInstance;

    const transform: TransformToolbarSlot = (slot: ToolbarSlot) => ({
        ...slot,
        // Use our fullscreen button (configured to fit page width on
        // enter/exit) instead of the default-layout's internal one.
        EnterFullScreen: () => <EnterFullScreenButton />,
    });

    const renderToolbar = (Toolbar: (props: ToolbarProps) => React.ReactElement) => (
        <Toolbar>{renderDefaultToolbar(transform)}</Toolbar>
    );

    const defaultLayoutPluginInstance = defaultLayoutPlugin({ renderToolbar });
    const { renderDefaultToolbar } = defaultLayoutPluginInstance.toolbarPluginInstance;
    const { jumpToPage } = defaultLayoutPluginInstance.toolbarPluginInstance.pageNavigationPluginInstance;

    useEffect(() => {
        if (page != null && page >= 0) jumpToPage(page);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [page]);

    return (
        <Worker workerUrl={PDF_WORKER_URL}>
            <div className="size-full">
                <Viewer
                    fileUrl={pdfUrl}
                    plugins={[defaultLayoutPluginInstance, fullScreenPluginInstance]}
                    defaultScale={SpecialZoomLevel.PageWidth}
                    initialPage={initialPage}
                />
            </div>
        </Worker>
    );
};

export default SimplePDFViewer;
