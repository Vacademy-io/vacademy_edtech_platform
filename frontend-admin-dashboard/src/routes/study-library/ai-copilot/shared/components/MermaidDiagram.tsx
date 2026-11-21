import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import mermaid from 'mermaid';
import { useTranslation } from 'react-i18next';
import { sanitizeMermaidCode } from '../utils/mermaidSanitizer';

// Use a window flag so all mermaid instances coordinate.
// Always re-initialize if suppressErrorRendering wasn't applied yet.
const initializeMermaid = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    if (w.__mermaidSuppressErrorsApplied) return;
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mermaid.initialize as any)({
            startOnLoad: false,
            theme: 'default',
            securityLevel: 'loose',
            suppressErrorRendering: true,
            flowchart: {
                useMaxWidth: true,
                htmlLabels: true,
                curve: 'basis',
            },
        });
        w.__mermaidSuppressErrorsApplied = true;
        w.__mermaidInitialized = true;
    } catch (error) {
        console.error('Error initializing mermaid:', error);
    }
};

// Apply immediately at module load so it's set before any render() call
try { initializeMermaid(); } catch (_) { /* silent */ }
interface MermaidDiagramProps {
    code: string;
    className?: string;
    id?: string;
}

/** Portal-based zoom modal — renders at document.body so it's never clipped */
function MermaidZoomModal({ svg, onClose }: { svg: string; onClose: () => void }) {
    const { t } = useTranslation('studyLibraryMermaidDiagram');
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handler);
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', handler);
            document.body.style.overflow = '';
        };
    }, [onClose]);

    return ReactDOM.createPortal(
        <div
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: 99999,
                background: 'rgba(0, 0, 0, 0.82)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'zoom-out',
                backdropFilter: 'blur(6px)',
                WebkitBackdropFilter: 'blur(6px)',
            }}
            onClick={onClose}
        >
            {/* Close button */}
            <button
                onClick={(e) => { e.stopPropagation(); onClose(); }}
                style={{
                    position: 'absolute',
                    top: '20px',
                    right: '24px',
                    background: 'rgba(255,255,255,0.18)',
                    border: '1px solid rgba(255,255,255,0.35)',
                    borderRadius: '50%',
                    width: '40px',
                    height: '40px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    color: '#fff',
                    fontSize: '20px',
                    lineHeight: 1,
                    backdropFilter: 'blur(4px)',
                    zIndex: 100000,
                }}
                title={t('closeEsc')}
            >
                ✕
            </button>

            {/* Diagram card */}
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    background: '#ffffff',
                    borderRadius: '16px',
                    padding: '40px',
                    minWidth: '60vw',
                    maxWidth: '92vw',
                    maxHeight: '88vh',
                    overflow: 'auto',
                    boxShadow: '0 32px 80px rgba(0,0,0,0.5)',
                    cursor: 'default',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                }}
            >
                <div
                    dangerouslySetInnerHTML={{ __html: svg }}
                    style={{ width: '100%', display: 'flex', justifyContent: 'center' }}
                />
                <style>{`
                    .mermaid-zoom-modal-inner svg {
                        width: 100% !important;
                        height: auto !important;
                        max-width: 100% !important;
                    }
                `}</style>
            </div>
        </div>,
        document.body
    );
}

/**
 * MermaidDiagram component:
 * - Silently swallows syntax errors (nothing shown on screen)
 * - Click-to-zoom modal via React portal (full-screen, never clipped)
 * - Natural SVG sizing, centered
 */
export const MermaidDiagram: React.FC<MermaidDiagramProps> = ({
    code,
    className = '',
    id,
}) => {
    const { t } = useTranslation('studyLibraryMermaidDiagram');
    const diagramIdRef = useRef<string>(
        id || `mermaid-${Math.random().toString(36).substr(2, 9)}`
    );
    const renderedCodeRef = useRef<string>('');
    const [svgContent, setSvgContent] = useState<string>('');
    const [isZoomed, setIsZoomed] = useState(false);

    useEffect(() => {
        try {
            initializeMermaid();
        } catch (_) {
            // silent
        }
    }, []);

    useEffect(() => {
        if (!code || code.trim() === '') return;
        if (renderedCodeRef.current === code.trim()) return;

        const renderDiagram = async () => {
            try {
                let cleanCode = code.trim();

                if (cleanCode.toLowerCase().startsWith('mermaid ')) {
                    cleanCode = cleanCode.substring(8).trim();
                }
                if (!cleanCode) return;

                cleanCode = sanitizeMermaidCode(cleanCode);

                try {
                    initializeMermaid();
                } catch (_) {
                    return;
                }

                const renderId = `mermaid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

                try {
                    const result = await mermaid.render(renderId, cleanCode);
                    if (result && result.svg) {
                        setSvgContent(result.svg);
                        renderedCodeRef.current = cleanCode;
                    }
                } catch (_renderError) {
                    // Silently swallow render errors — show nothing
                    console.warn('[MermaidDiagram] Render failed (hidden from UI):', _renderError);
                    setSvgContent('');
                }
            } catch (_) {
                setSvgContent('');
            }
        };

        renderDiagram();
    }, [code]);

    if (!svgContent) {
        return null; // Show nothing on error or while loading
    }

    return (
        <>
            {/* Inline diagram — click to zoom */}
            <div
                className={`mermaid-diagram-container ${className}`}
                style={{
                    margin: '20px 0',
                    padding: '16px',
                    backgroundColor: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    cursor: 'zoom-in',
                    position: 'relative',
                    overflow: 'hidden',
                    maxWidth: '100%',
                }}
                onClick={() => setIsZoomed(true)}
                title={t('clickToZoom')}
            >
                {/* Zoom hint badge */}
                <div
                    style={{
                        position: 'absolute',
                        top: '8px',
                        right: '8px',
                        background: 'rgba(0,0,0,0.45)',
                        color: '#fff',
                        fontSize: '11px',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        pointerEvents: 'none',
                        opacity: 0.85,
                        letterSpacing: '0.02em',
                    }}
                >
                    🔍 {t('clickToZoom')}
                </div>

                <div
                    dangerouslySetInnerHTML={{ __html: svgContent }}
                    style={{
                        maxWidth: '100%',
                        overflow: 'hidden',
                        display: 'flex',
                        justifyContent: 'center',
                    }}
                />

                <style>{`
                    .mermaid-diagram-container svg {
                        max-width: 100% !important;
                        height: auto !important;
                        display: block;
                    }
                `}</style>
            </div>

            {/* Portal-based zoom modal */}
            {isZoomed && (
                <MermaidZoomModal svg={svgContent} onClose={() => setIsZoomed(false)} />
            )}
        </>
    );
};
