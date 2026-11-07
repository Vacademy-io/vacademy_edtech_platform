import React from 'react';
import { Viewer, Worker, SpecialZoomLevel } from '@react-pdf-viewer/core';
import { defaultLayoutPlugin } from '@react-pdf-viewer/default-layout';
import { fullScreenPlugin } from '@react-pdf-viewer/full-screen';
import { getFilePlugin } from '@react-pdf-viewer/get-file';
import type { DownloadMenuItemProps } from '@react-pdf-viewer/get-file';
import type {
    ToolbarSlot,
    ToolbarProps,
    TransformToolbarSlot,
} from '@react-pdf-viewer/toolbar';

import '@react-pdf-viewer/core/lib/styles/index.css';
import '@react-pdf-viewer/default-layout/lib/styles/index.css';
import '@react-pdf-viewer/full-screen/lib/styles/index.css';

// Self-hosted copy of pdfjs-dist@3.11.174's worker (public/pdfjs). Loading it from
// unpkg broke PDFs for learners whose school/ISP network or ad-blocker blocks that
// CDN ("Setting up fake worker failed"). Version is in the path because /*.js is
// cached for a year — bump the folder together with pdfjs-dist.
const PDF_WORKER_URL = '/pdfjs/3.11.174/pdf.worker.min.js';

// Evaluated-copy / submission PDFs are served from S3 signed URLs whose object
// keys carry no ".pdf" extension. react-pdf-viewer's default download derives
// the filename from that URL, so the saved file has no extension and won't open
// on the device. This viewer only ever renders PDFs, so force a ".pdf" name —
// replacing a mislabeled image extension rather than doubling it up
// (e.g. "answer.jpg" → "answer.pdf", not "answer.jpg.pdf").
const ensurePdfName = (name?: string): string => {
    const base = (name || 'document').trim() || 'document';
    if (/\.pdf$/i.test(base)) return base;
    const stripped = base.replace(
        /\.(jpe?g|png|gif|webp|bmp|svg|heic|heif|avif|tiff?)$/i,
        ''
    );
    return `${stripped}.pdf`;
};

interface SimplePDFViewerProps {
    pdfUrl: string;
    // Optional download filename. A ".pdf" extension is enforced regardless.
    fileName?: string;
}

const SimplePDFViewer: React.FC<SimplePDFViewerProps> = ({
    pdfUrl,
    fileName,
}) => {
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

    // Our own get-file instance so the download filename always ends in ".pdf".
    const getFilePluginInstance = getFilePlugin({
        fileNameGenerator: (file) => ensurePdfName(fileName || file.name),
    });
    const { DownloadButton, DownloadMenuItem } = getFilePluginInstance;

    const transform: TransformToolbarSlot = (slot: ToolbarSlot) => ({
        ...slot,
        // Use our fullscreen button (configured to fit page width on
        // enter/exit) instead of the default-layout's internal one.
        EnterFullScreen: () => <EnterFullScreenButton />,
        // Route both the toolbar button and the more-actions menu item to our
        // get-file instance so the forced ".pdf" filename applies everywhere.
        Download: () => <DownloadButton />,
        DownloadMenuItem: (props: DownloadMenuItemProps) => (
            <DownloadMenuItem onClick={props.onClick} />
        ),
    });

    const renderToolbar = (
        Toolbar: (props: ToolbarProps) => React.ReactElement
    ) => <Toolbar>{renderDefaultToolbar(transform)}</Toolbar>;

    const defaultLayoutPluginInstance = defaultLayoutPlugin({ renderToolbar });
    const { renderDefaultToolbar } =
        defaultLayoutPluginInstance.toolbarPluginInstance;

    return (
        <Worker workerUrl={PDF_WORKER_URL}>
            <div className="size-full">
                <Viewer
                    fileUrl={pdfUrl}
                    plugins={[
                        defaultLayoutPluginInstance,
                        fullScreenPluginInstance,
                        getFilePluginInstance,
                    ]}
                    defaultScale={SpecialZoomLevel.PageWidth}
                />
            </div>
        </Worker>
    );
};

export default SimplePDFViewer;
