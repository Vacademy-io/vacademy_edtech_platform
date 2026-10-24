import { useEffect, useRef } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { sanitizeRichHtml } from '@/lib/sanitize-html';

interface RichContentRendererProps {
    html: string;
    className?: string;
}

/**
 * Renders HTML content with KaTeX math support.
 * Handles Tiptap's math-inline/math-display spans with data-latex attributes.
 */
export const RichContentRenderer = ({ html, className = '' }: RichContentRendererProps) => {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!containerRef.current) return;

        // Re-render Tiptap math nodes that have data-latex attributes
        const mathSpans = containerRef.current.querySelectorAll(
            'span.math-inline[data-latex], span.math-display[data-latex], div.math-display[data-latex]'
        );

        mathSpans.forEach((span) => {
            const latex = span.getAttribute('data-latex');
            if (!latex) return;

            const isDisplay = span.classList.contains('math-display');
            try {
                katex.render(latex, span as HTMLElement, {
                    throwOnError: false,
                    displayMode: isDisplay,
                });
            } catch {
                // Keep original content on failure
            }
        });

        // Also handle any .katex-error spans that don't have data-latex parent
        const errorSpans = containerRef.current.querySelectorAll('.katex-error');
        errorSpans.forEach((span) => {
            // Skip if already re-rendered by parent math-inline
            if (span.closest('[data-latex]')) return;

            const title = span.getAttribute('title') || '';
            // Try to extract LaTeX from the title attribute (format: "ParseError: KaTeX parse error: ... at position ... : \latex\here")
            const latexMatch = title.match(/[\\{]/);
            if (latexMatch) {
                const latex = title.substring(title.indexOf(latexMatch[0]));
                try {
                    katex.render(latex, span as HTMLElement, {
                        throwOnError: false,
                        displayMode: false,
                    });
                } catch {
                    // Keep original
                }
            }
        });
    }, [html]);

    return (
        <div
            ref={containerRef}
            className={className}
            dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(html) }}
        />
    );
};
