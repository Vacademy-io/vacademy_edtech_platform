import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MermaidDiagram } from './MermaidDiagram';
import { extractMermaidDiagrams, MermaidDiagramInfo } from '../utils/mermaidExtractor';

interface DocumentWithMermaidProps {
    /**
     * HTML content that may contain mermaid diagrams
     */
    htmlContent: string;
    /**
     * Optional className for the container
     */
    className?: string;
    /**
     * Whether to allow editing (if true, uses TipTapEditor)
     */
    editable?: boolean;
    /**
     * Callback when content changes (only used if editable is true)
     */
    onChange?: (html: string) => void;
}

/**
 * DocumentWithMermaid component renders HTML content with embedded mermaid diagrams
 * 
 * This component:
 * 1. Extracts mermaid diagrams from the HTML
 * 2. Renders the HTML content
 * 3. Replaces mermaid placeholders with actual MermaidDiagram components
 */
export const DocumentWithMermaid: React.FC<DocumentWithMermaidProps> = ({
    htmlContent,
    className = '',
    editable = false,
    onChange,
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [diagrams, setDiagrams] = useState<MermaidDiagramInfo[]>([]);
    const [processedHtml, setProcessedHtml] = useState<string>('');

    useEffect(() => {
        if (!htmlContent) {
            setProcessedHtml('');
            setDiagrams([]);
            return;
        }

        // Extract mermaid diagrams from the HTML
        const { cleanedHtml, diagrams: extractedDiagrams } = extractMermaidDiagrams(htmlContent);
        setProcessedHtml(cleanedHtml);
        setDiagrams(extractedDiagrams);
    }, [htmlContent]);

    // Render mermaid diagrams in place of placeholders
    useEffect(() => {
        if (!containerRef.current || diagrams.length === 0) {
            return;
        }

        const placeholders = containerRef.current.querySelectorAll('.mermaid-placeholder');
        
        placeholders.forEach((placeholder) => {
            const diagramId = placeholder.getAttribute('data-mermaid-id');
            const encodedCode = placeholder.getAttribute('data-mermaid-code');
            
            if (diagramId && encodedCode) {
                const code = decodeURIComponent(encodedCode);
                const diagram = diagrams.find((d) => d.id === diagramId);
                
                if (diagram) {
                    // Create a wrapper div for React to render into
                    const wrapper = document.createElement('div');
                    wrapper.className = 'mermaid-diagram-wrapper';
                    wrapper.setAttribute('data-mermaid-id', diagramId);
                    
                    // Replace placeholder with wrapper
                    placeholder.parentNode?.replaceChild(wrapper, placeholder);
                }
            }
        });
    }, [diagrams, processedHtml]);

    // If editable, we need a different approach - TipTap doesn't support custom components
    // For now, we'll render as read-only with mermaid support
    // TODO: Create a TipTap extension for mermaid if editing is needed

    return (
        <div className={`document-with-mermaid ${className}`}>
            {/* Render the HTML content */}
            <div
                ref={containerRef}
                className="document-content"
                dangerouslySetInnerHTML={{ __html: processedHtml }}
            />
            
            {/* Render mermaid diagrams */}
            {diagrams.map((diagram) => {
                // Find the wrapper element for this diagram
                const wrapper = containerRef.current?.querySelector(
                    `[data-mermaid-id="${diagram.id}"]`
                );
                
                if (wrapper && wrapper.classList.contains('mermaid-diagram-wrapper')) {
                    // Render the diagram using React portal or direct rendering
                    return (
                        <React.Fragment key={diagram.id}>
                            {React.createElement(() => {
                                // This will be rendered into the wrapper
                                useEffect(() => {
                                    if (wrapper) {
                                        const container = document.createElement('div');
                                        wrapper.appendChild(container);
                                        
                                        // Use ReactDOM to render into the wrapper
                                        import('react-dom/client').then(({ createRoot }) => {
                                            const root = createRoot(container);
                                            root.render(<MermaidDiagram code={diagram.code} />);
                                        });
                                    }
                                }, []);
                                return null;
                            })}
                        </React.Fragment>
                    );
                }
                
                return null;
            })}
        </div>
    );
};

/**
 * Simpler version that splits content and renders mermaid separately
 * This is more reliable for rendering
 */
export const DocumentWithMermaidSimple: React.FC<DocumentWithMermaidProps> = ({
    htmlContent,
    className = '',
}) => {
    const { t } = useTranslation('studyLibraryDocumentWithMermaid');
    const [sections, setSections] = useState<Array<{ type: 'html' | 'mermaid'; content: string }>>([]);
    const [hasError, setHasError] = useState(false);

    useEffect(() => {
        if (!htmlContent) {
            setSections([]);
            setHasError(false);
            return;
        }

        try {
            const trimmedContent = htmlContent.trim();
            const newSections: Array<{ type: 'html' | 'mermaid'; content: string }> = [];
            
            // Check if content is ONLY plain text mermaid code (no HTML tags)
            // Only do this check if there are NO HTML tags at all
            if (!trimmedContent.includes('<') && !trimmedContent.includes('>')) {
                // Plain text - check if it's mermaid
                // Use regex to match "mermaid" followed by any whitespace (space, newline, tab, etc.)
                const lowerTrimmed = trimmedContent.toLowerCase();
                const mermaidPrefixMatch = lowerTrimmed.match(/^mermaid\s+/);
                const hasMermaidSyntax = trimmedContent.includes('graph') || trimmedContent.includes('flowchart');
                
                if (mermaidPrefixMatch && hasMermaidSyntax) {
                    // Extract mermaid code (remove "mermaid" prefix and any whitespace after it)
                    let mermaidCode = trimmedContent.replace(/^mermaid\s+/i, '').trim();
                    // Wrap mermaid in HTML structure (div.mermaid) so extractMermaidDiagrams can process it
                    // This ensures it's treated as HTML content with embedded mermaid
                    const wrappedHtml = `<div class="mermaid">${mermaidCode}</div>`;
                    // Process it through the HTML extraction path
                    const { cleanedHtml, diagrams } = extractMermaidDiagrams(wrappedHtml);
                    
                    // Use the same marker-based splitting approach as HTML content
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = cleanedHtml;
                    const placeholders = Array.from(tempDiv.querySelectorAll('.mermaid-placeholder'));
                    const markerMap = new Map<string, string>();
                    
                    placeholders.forEach((placeholder, idx) => {
                        const marker = `__MERMAID_MARKER_${idx}__`;
                        const diagramId = placeholder.getAttribute('data-mermaid-id');
                        const encodedCode = placeholder.getAttribute('data-mermaid-code');
                        
                        if (diagramId && encodedCode) {
                            const code = decodeURIComponent(encodedCode);
                            markerMap.set(marker, code);
                            const markerText = document.createTextNode(marker);
                            placeholder.parentNode?.replaceChild(markerText, placeholder);
                        }
                    });
                    
                    const modifiedHtml = tempDiv.innerHTML;
                    const parts = modifiedHtml.split(/(__MERMAID_MARKER_\d+__)/);
                    
                    parts.forEach((part) => {
                        if (part.startsWith('__MERMAID_MARKER_') && part.endsWith('__')) {
                            const code = markerMap.get(part);
                            if (code) {
                                newSections.push({ type: 'mermaid', content: code });
                            }
                        } else if (part.trim()) {
                            newSections.push({ type: 'html', content: part });
                        }
                    });
                    
                    // If no sections were created, add the mermaid diagram
                    if (newSections.length === 0) {
                        newSections.push({ type: 'mermaid', content: mermaidCode });
                    }
                    
                    setSections(newSections);
                    setHasError(false);
                    return;
                } else {
                    // Plain text but not mermaid - show as HTML
                    newSections.push({ type: 'html', content: `<p>${trimmedContent}</p>` });
                    setSections(newSections);
                    setHasError(false);
                    return;
                }
            }
            
            // If we have HTML content, process it to extract mermaid while preserving all HTML
            try {
                // Process as HTML content - extract mermaid but preserve all other content
                const { cleanedHtml, diagrams } = extractMermaidDiagrams(htmlContent);
                
                // If no diagrams found, just show the HTML as-is
                if (diagrams.length === 0) {
                    newSections.push({ type: 'html', content: cleanedHtml || htmlContent });
                    setSections(newSections);
                    setHasError(false);
                    return;
                }
                
                // Use a simpler approach: replace placeholders with unique markers, then split
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = cleanedHtml || htmlContent;
                
                // Find all placeholders and replace with markers
                const placeholders = Array.from(tempDiv.querySelectorAll('.mermaid-placeholder'));
                const markerMap = new Map<string, string>(); // marker -> mermaid code
                
                placeholders.forEach((placeholder, idx) => {
                    const marker = `__MERMAID_MARKER_${idx}__`;
                    const diagramId = placeholder.getAttribute('data-mermaid-id');
                    const encodedCode = placeholder.getAttribute('data-mermaid-code');
                    
                    if (diagramId && encodedCode) {
                        const code = decodeURIComponent(encodedCode);
                        markerMap.set(marker, code);
                        
                        // Replace placeholder with marker text node
                        const markerText = document.createTextNode(marker);
                        placeholder.parentNode?.replaceChild(markerText, placeholder);
                    }
                });
                
                // Get the modified HTML
                const modifiedHtml = tempDiv.innerHTML;
                
                // Split by markers - this preserves all HTML content between mermaid diagrams
                const parts = modifiedHtml.split(/(__MERMAID_MARKER_\d+__)/);
                
                parts.forEach((part) => {
                    if (part.startsWith('__MERMAID_MARKER_') && part.endsWith('__')) {
                        // This is a mermaid diagram marker
                        const code = markerMap.get(part);
                        if (code) {
                            newSections.push({ type: 'mermaid', content: code });
                        }
                    } else if (part.trim()) {
                        // This is HTML content - preserve it all
                        newSections.push({ type: 'html', content: part });
                    }
                });
                
                // If no sections were created, add the full HTML
                if (newSections.length === 0) {
                    newSections.push({ type: 'html', content: cleanedHtml || htmlContent });
                }
                
                setSections(newSections);
                setHasError(false);
            } catch (extractError) {
                console.error('Error extracting mermaid diagrams:', extractError);
                // If extraction fails, just show the HTML as-is
                newSections.push({ type: 'html', content: htmlContent });
                setSections(newSections);
                setHasError(false);
            }
        } catch (error) {
            console.error('Error processing content:', error);
            // On any error, just show the HTML content as-is
            setSections([{ type: 'html', content: htmlContent }]);
            setHasError(true);
        }
    }, [htmlContent]);

    // If no sections, show the original HTML content
    if (sections.length === 0 && htmlContent) {
        return (
            <div className={`document-with-mermaid-simple ${className}`} style={{ maxWidth: '100%', overflow: 'hidden' }}>
                <div 
                    className="document-html-section prose prose-sm max-w-none"
                    style={{ maxWidth: '100%', overflow: 'hidden', wordWrap: 'break-word' }}
                    dangerouslySetInnerHTML={{ __html: htmlContent }} 
                />
            </div>
        );
    }

    return (
        <div className={`document-with-mermaid-simple ${className}`} style={{ maxWidth: '100%', overflow: 'hidden' }}>
            <style>{`
                .document-with-mermaid-simple h1 {
                    font-size: 1.875rem;
                    font-weight: 700;
                    margin-top: 1.5rem;
                    margin-bottom: 1rem;
                    color: #1f2937;
                    line-height: 1.2;
                }
                .document-with-mermaid-simple h2 {
                    font-size: 1.5rem;
                    font-weight: 600;
                    margin-top: 1.25rem;
                    margin-bottom: 0.75rem;
                    color: #374151;
                    line-height: 1.3;
                }
                .document-with-mermaid-simple h3 {
                    font-size: 1.25rem;
                    font-weight: 600;
                    margin-top: 1rem;
                    margin-bottom: 0.5rem;
                    color: #4b5563;
                    line-height: 1.4;
                }
                .document-with-mermaid-simple p {
                    margin-top: 0.75rem;
                    margin-bottom: 0.75rem;
                    color: #374151;
                    line-height: 1.7;
                }
                .document-with-mermaid-simple ul, .document-with-mermaid-simple ol {
                    margin-top: 0.75rem;
                    margin-bottom: 0.75rem;
                    padding-left: 1.5rem;
                    color: #374151;
                }
                .document-with-mermaid-simple li {
                    margin-top: 0.5rem;
                    margin-bottom: 0.5rem;
                    line-height: 1.6;
                }
                .document-with-mermaid-simple strong {
                    font-weight: 600;
                    color: #1f2937;
                }
                .document-with-mermaid-simple em {
                    font-style: italic;
                }
                .document-with-mermaid-simple code {
                    background-color: #f3f4f6;
                    padding: 0.125rem 0.375rem;
                    border-radius: 0.25rem;
                    font-family: 'Courier New', Courier, monospace;
                    font-size: 0.875em;
                    color: #dc2626;
                }
                .document-with-mermaid-simple pre {
                    background-color: #1f2937;
                    color: #f9fafb;
                    padding: 1rem;
                    border-radius: 0.5rem;
                    overflow-x: auto;
                    margin: 1rem 0;
                }
                .document-with-mermaid-simple pre code {
                    background-color: transparent;
                    padding: 0;
                    color: inherit;
                }
                .document-with-mermaid-simple a {
                    color: #2563eb;
                    text-decoration: underline;
                }
                .document-with-mermaid-simple a:hover {
                    color: #1d4ed8;
                }
            `}</style>
            {sections.map((section, index) => {
                if (section.type === 'mermaid') {
                    return (
                        <div 
                            key={`mermaid-${index}`} 
                            style={{ 
                                maxWidth: '100%', 
                                width: '100%',
                                overflow: 'hidden', 
                                margin: '20px 0',
                                display: 'flex',
                                justifyContent: 'center',
                                alignItems: 'center'
                            }}
                        >
                            <div style={{ maxWidth: '100%', width: '100%' }}>
                                <React.Suspense fallback={<div style={{ padding: '20px', textAlign: 'center' }}>{t('loadingDiagram')}</div>}>
                                    <MermaidDiagram
                                        code={section.content}
                                        className="my-4"
                                    />
                                </React.Suspense>
                            </div>
                        </div>
                    );
                } else {
                    return (
                        <div
                            key={`html-${index}`}
                            className="document-html-section"
                            style={{ maxWidth: '100%', overflow: 'hidden', wordWrap: 'break-word' }}
                            dangerouslySetInnerHTML={{ __html: section.content }}
                        />
                    );
                }
            })}
        </div>
    );
};
