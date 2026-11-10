import React, { useEffect, useRef, useState } from 'react';
import { sanitizeMermaidCode } from '@/utils/mermaidSanitizer';
import { initializeMermaid } from '@/utils/initializeMermaid';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { ArrowsOut, MagnifyingGlassPlus } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

// How far a diagram may be scaled ABOVE its natural size in the expanded view.
// Expanding should make a diagram comfortable to read, not stretch a two-node
// flow across a 1400px dialog until one node fills the screen.
const EXPANDED_MAX_ZOOM = 2;
// Ceiling for the expanded diagram's height so the whole thing stays on screen
// (dialog is 85vh, minus its padding and header allowance). A diagram taller
// than this keeps its natural size and scrolls instead.
const EXPANDED_MAX_HEIGHT_VH = 70;
const EXPANDED_MAX_HEIGHT = `${EXPANDED_MAX_HEIGHT_VH}vh`;

/** Authored height in px, read from the viewBox Mermaid emits. */
const readNaturalHeight = (svg: string): number => {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = svg;
    const viewBox = (tempDiv.querySelector('svg')?.getAttribute('viewBox') || '')
        .split(/[\s,]+/)
        .map(Number);
    return viewBox.length === 4 && viewBox[3]! > 0 ? viewBox[3]! : 0;
};

/**
 * Size a rendered Mermaid SVG for display.
 *
 * Mermaid (useMaxWidth: true) emits `width="100%"` plus an inline
 * `max-width: <natural width>px`; that cap is what stops a small two-node
 * flowchart from being stretched across the whole document. Overwriting it with
 * `max-width: 100%` scaled a ~130px diagram up to the full card width, which is
 * why a single node filled the slide.
 *
 * - 'inline': keep the natural cap, so the diagram renders at authored size and
 *   only ever shrinks on narrow screens.
 * - 'expanded': allow a bounded zoom (EXPANDED_MAX_ZOOM) and fit the dialog
 *   height where possible — but never below natural size. A tall flowchart
 *   therefore stays readable and scrolls, instead of being squeezed to fit and
 *   ending up smaller than it was in the card.
 *
 * Natural size comes from the viewBox, which Mermaid derives from the same
 * bbox + padding as its own max-width — so it matches Mermaid's cap exactly and
 * also gives us the height.
 */
const makeResponsiveSvg = (svg: string, mode: 'inline' | 'expanded'): string => {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = svg;
    const svgElement = tempDiv.querySelector('svg');
    if (!svgElement) return svg;

    const viewBox = (svgElement.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
    const hasViewBox = viewBox.length === 4 && viewBox[2]! > 0 && viewBox[3]! > 0;
    const naturalWidth = hasViewBox ? viewBox[2]! : parseFloat(svgElement.style.maxWidth) || 0;
    const naturalHeight = hasViewBox ? viewBox[3]! : 0;

    svgElement.removeAttribute('height');
    svgElement.removeAttribute('width');
    svgElement.style.width = '100%';
    svgElement.style.height = 'auto';

    if (mode === 'inline') {
        svgElement.style.maxWidth = naturalWidth > 0 ? `${naturalWidth}px` : '100%';
    } else {
        svgElement.style.maxWidth =
            naturalWidth > 0 ? `min(100%, ${naturalWidth * EXPANDED_MAX_ZOOM}px)` : '100%';
        // clamp(natural, fit-the-dialog, natural * zoom): fit when the diagram
        // can fit, cap the zoom when it's small, and hold natural size (scroll)
        // when it's too tall to fit — never scale it down.
        svgElement.style.maxHeight =
            naturalHeight > 0
                ? `clamp(${naturalHeight}px, ${EXPANDED_MAX_HEIGHT}, ${naturalHeight * EXPANDED_MAX_ZOOM}px)`
                : EXPANDED_MAX_HEIGHT;
    }

    return tempDiv.innerHTML;
};

interface MermaidDiagramProps {
    code: string;
    className?: string;
    id?: string;
}

export const MermaidDiagram: React.FC<MermaidDiagramProps> = ({
    code,
    className = '',
    id
}) => {
    const { t } = useTranslation('studyContent');
    const renderedCodeRef = useRef<string>('');
    const [hasError, setHasError] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string>('');
    const [svgHtml, setSvgHtml] = useState<string>('');
    // Same SVG, sized for the expanded dialog (see makeResponsiveSvg).
    const [svgHtmlExpanded, setSvgHtmlExpanded] = useState<string>('');
    // Authored height — tells us whether the expanded diagram will overflow the
    // dialog, i.e. whether the learner needs to scroll to see the rest of it.
    const [naturalHeight, setNaturalHeight] = useState(0);

    // Start loading mermaid (lazy chunk) as soon as a diagram mounts
    useEffect(() => {
        initializeMermaid().catch(() => undefined);
    }, []);

    // Render diagram when code changes
    useEffect(() => {
        if (!code || code.trim() === '') {
            return;
        }

        // Skip if code hasn't changed (prevents double rendering in React Strict Mode)
        const trimmedCode = code.trim();
        if (renderedCodeRef.current === trimmedCode && svgHtml) {
            return;
        }

        const renderDiagram = async () => {
            try {
                // Clean and sanitize code
                let cleanCode = code.trim();

                if (cleanCode.toLowerCase().startsWith('mermaid ')) {
                    cleanCode = cleanCode.substring(8).trim();
                }
                cleanCode = sanitizeMermaidCode(cleanCode);

                // Generate unique render ID - keeping format from valid HTML ID safe
                const renderId = `mermaid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

                // Render diagram (mermaid is a lazy chunk; this resolves once loaded + initialized)
                const mermaid = await initializeMermaid();
                const result = await mermaid.render(renderId, cleanCode);

                if (result && result.svg) {
                    renderedCodeRef.current = trimmedCode;

                    setSvgHtml(makeResponsiveSvg(result.svg, 'inline'));
                    setSvgHtmlExpanded(makeResponsiveSvg(result.svg, 'expanded'));
                    setNaturalHeight(readNaturalHeight(result.svg));

                    setHasError(false);
                    setErrorMessage(''); // Clear any previous error message
                } else {
                    throw new Error('mermaid.render() did not return SVG');
                }
            } catch (error) {
                console.error('Error rendering mermaid diagram:', error);
                // The component will render null if hasError is true
                setSvgHtml(''); // Clear SVG on error
                setSvgHtmlExpanded('');
                setNaturalHeight(0);
                setHasError(true);
                setErrorMessage(error instanceof Error ? error.message : 'Unknown error');

                // Clean up any orphaned mermaid error elements from the DOM
                document.querySelectorAll('[id^="dmermaid-"]').forEach((el) => el.remove());
            }
        };

        renderDiagram();
    }, [code]);

    if (hasError) {
        // Never delete content: if the code isn't valid Mermaid (e.g. a code
        // block misclassified as a diagram), show it as plain code instead.
        return (
            <pre className="overflow-x-auto whitespace-pre rounded-md bg-neutral-100 p-3 text-sm">
                <code>{code}</code>
            </pre>
        );
    }

    if (!svgHtml) {
        // Optional: Loading skeleton could go here
        return null;
    }

    // The expanded diagram holds its natural height once it passes the fit
    // ceiling (see makeResponsiveSvg), so that's exactly when it scrolls.
    const willOverflow =
        naturalHeight > 0 &&
        typeof window !== 'undefined' &&
        naturalHeight > (window.innerHeight * EXPANDED_MAX_HEIGHT_VH) / 100;

    return (
        <Dialog>
            <DialogTrigger asChild>
                <div
                    className={cn(
                        "mermaid-diagram-container relative group cursor-pointer border rounded-lg bg-white overflow-hidden hover:shadow-md transition-all duration-200",
                        className
                    )}
                    style={{
                        margin: '20px 0',
                    }}
                >
                    {/* Simplified View Container */}
                    <div
                        className="flex justify-center p-4 max-h-reg-300 overflow-hidden opacity-90 group-hover:opacity-100 transition-opacity"
                        dangerouslySetInnerHTML={{ __html: svgHtml }}
                    />

                    {/* Gradient Fade at bottom to indicate there's more */}
                    <div className="absolute bottom-0 start-0 end-0 h-16 bg-gradient-to-t from-white to-transparent pointer-events-none" />

                    {/* Pop-out / Zoom Overlay Options */}
                    <div className="absolute top-2 end-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                        <div className="bg-white/90 backdrop-blur-sm p-1.5 rounded-md shadow-sm border border-gray-200 text-gray-500 hover:text-primary-600">
                            <ArrowsOut size={18} />
                        </div>
                    </div>

                    <div className="absolute inset-x-0 bottom-3 flex justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
                        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white/90 backdrop-blur-md rounded-full shadow-sm border border-gray-200 text-xs font-medium text-gray-600">
                            <MagnifyingGlassPlus size={14} />
                            <span>{t("mermaid.clickToExpand")}</span>
                        </div>
                    </div>
                </div>
            </DialogTrigger>

            <DialogContent className="max-w-vw-90 h-screen-85 p-0 gap-0 overflow-hidden flex flex-col bg-slate-50 border-none outline-none">
                {/* The diagram is sized to fit this box (see makeResponsiveSvg),
                    so it's fully visible on open; overflow-auto is only a safety
                    net for an unusually tall diagram. */}
                <div className="flex-1 overflow-auto p-8 min-h-0">
                    <div className="min-h-full w-full flex flex-col items-center justify-center">
                        <div
                            className="w-full flex justify-center"
                            dangerouslySetInnerHTML={{ __html: svgHtmlExpanded || svgHtml }}
                        />
                    </div>
                </div>
                {/* Only when the diagram really is taller than the dialog — a
                    scroll hint on a diagram that already fits is just noise. */}
                {willOverflow && (
                    <div className="p-3 border-t bg-white flex justify-end text-xs text-muted-foreground">
                        {t('mermaid.scrollForMore')}
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
};
