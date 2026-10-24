import { forwardRef, memo, useImperativeHandle, useRef, useEffect, useState, useMemo, useCallback } from "react";
import { renderAsync } from "docx-preview";
import { HtmlSlideIframe } from "./html-slide-iframe";
import TurndownService from "turndown";
import ReactMarkdown from "react-markdown";
import { DocumentWithMermaid } from "./DocumentWithMermaid";
import { useTranslation } from "react-i18next";

// Helper to strip expired query params from public AWS S3 URLs
// Example: https://...amazonaws.com/.../image.jpg?X-Amz-Algorithm=... -> https://...amazonaws.com/.../image.jpg
//
// Handles two inputs: a bare doc/PDF URL, and a full HTML body. The previous
// version ran a blunt `…amazonaws\.com[^"'()<>\s]*\?…` scan over the WHOLE HTML;
// when a signed S3 URL sat inside a data-* block (quiz/tabs, where the JSON
// quotes are entity-encoded), it over-matched and deleted everything from the
// "?" — truncating the rendered slide. We now bound the HTML case to real
// src/href/poster attribute values (the quote stops the match), so it can never
// run into surrounding content, while still stripping a bare URL fully.
const stripAwsQueryParamsFromUrls = (input: string): string => {
  if (!input) return input;
  const dropQuery = (url: string): string => {
    if (!/amazonaws\.com/i.test(url)) return url;
    const q = url.indexOf("?");
    return q === -1 ? url : url.slice(0, q);
  };
  // Bare single URL (doc/PDF viewer) — strip its whole query string.
  if (!/[<>]/.test(input) && /^\s*https?:\/\//i.test(input)) {
    return dropQuery(input.trim());
  }
  // HTML — only touch real URL attributes, bounded by their own quote.
  return input.replace(
    /(\b(?:src|href|poster)\s*=\s*)(["'])([^"']*)\2/gi,
    (_m: string, prefix: string, quote: string, url: string): string =>
      `${prefix}${quote}${dropQuery(url)}${quote}`
  );
};

export interface DocViewerComponentRef {
  jumpToPage: (pageIndex: number) => void;
}

type DocViewerComponentProps = {
  docUrl: string;
  handleDocumentLoad: () => void;
  handlePageChange: (page: number) => void;
  initialPage?: number;
  isHtml?: boolean;
  // Creative HTML document (type 'HTML'): render the raw HTML in a sandboxed
  // iframe so its CSS/JS animations run and it stays isolated from the app.
  creativeHtml?: boolean;
  // Interactive-result reporting from a creative HTML slide (quiz/game).
  onSlideProgress?: (percent: number) => void;
  onSlideComplete?: (result: import("./html-slide-iframe").SlideResult) => void;
  // Slide id: lets a creative HTML lesson save its own state via SCORM.
  scormSlideId?: string;
};

const DocViewerComponentInner = forwardRef<DocViewerComponentRef, DocViewerComponentProps>(({
  docUrl,
  handleDocumentLoad,
  handlePageChange,
  //initialPage = 0,
  isHtml = false,
  creativeHtml = false,
  onSlideProgress,
  onSlideComplete,
  scormSlideId
}, ref) => {
  const { t } = useTranslation("studyContent");
  const containerRef = useRef<HTMLDivElement>(null);
  const totalPagesRef = useRef<number>(0);
  const [markdownContent, setMarkdownContent] = useState<string>("");
  const [htmlContent, setHtmlContent] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const handleDocumentLoadRef = useRef(handleDocumentLoad);
  const handlePageChangeRef = useRef(handlePageChange);

  // Keep latest handleDocumentLoad without re-triggering loads
  useEffect(() => {
    handleDocumentLoadRef.current = handleDocumentLoad;
  }, [handleDocumentLoad]);
  useEffect(() => {
    handlePageChangeRef.current = handlePageChange;
  }, [handlePageChange]);

  // Memoize the docUrl to prevent unnecessary re-renders
  const stableDocUrl = useMemo(() => docUrl, [docUrl]);

  // Initialize Turndown service for HTML to Markdown conversion
  const turndownService = useMemo(() => new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    fence: '```',
    emDelimiter: '_',
    strongDelimiter: '**',
    linkStyle: 'inlined',
    linkReferenceStyle: 'full'
  }), []);

  // Track scroll position and calculate current page
  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const scrollHeight = container.scrollHeight;
    const scrollTop = container.scrollTop;

    // Calculate current page based on scroll position
    const pageHeight = scrollHeight / totalPagesRef.current;
    const currentPage = Math.floor(scrollTop / pageHeight) + 1;

    handlePageChangeRef.current?.(currentPage);
  }, []);

  // Add scroll event listener
  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      container.addEventListener('scroll', handleScroll);
    }
    return () => {
      if (container) {
        container.removeEventListener('scroll', handleScroll);
      }
    };
  }, [handleScroll]);

  // Expose jumpToPage function through ref
  useImperativeHandle(ref, () => ({
    jumpToPage: (pageIndex: number) => {
      if (containerRef.current) {
        const container = containerRef.current;
        const pageHeight = container.scrollHeight / totalPagesRef.current;
        container.scrollTo({
          top: (pageIndex - 1) * pageHeight,
          behavior: 'smooth'
        });
      }
    },
  }), []);

  // Render DOCX or HTML
  const loadDocument = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      if (isHtml) {
        // If the HTML contains embedded content like iframes/videos, render as raw HTML
        const containsEmbedded = /<(iframe|video|audio|embed|object)/i.test(stableDocUrl);
        if (containsEmbedded) {
          try {
            const parser = new DOMParser();
            // Sanitize AWS S3 URLs before parsing as a defensive step
            const sanitizedHtmlInput = stripAwsQueryParamsFromUrls(stableDocUrl);
            const parsed = parser.parseFromString(sanitizedHtmlInput, 'text/html');

            // Convert <video> tags with YouTube URLs to proper <iframe> embeds
            const videoNodes = Array.from(parsed.getElementsByTagName('video'));
            videoNodes.forEach((node) => {
              const src = node.getAttribute('src') || '';
              const ytMatch = src.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([^?&#]+)/);
              if (ytMatch) {
                const iframe = parsed.createElement('iframe');
                iframe.setAttribute('src', `https://www.youtube.com/embed/${ytMatch[1]}`);
                iframe.setAttribute('width', node.getAttribute('width') || '650');
                iframe.setAttribute('height', node.getAttribute('height') || '400');
                iframe.setAttribute('frameborder', '0');
                iframe.setAttribute('allowfullscreen', 'true');
                iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture');
                if (node.parentElement && node.parentElement.tagName === 'DIV') {
                  node.parentElement.replaceChild(iframe, node);
                } else {
                  node.replaceWith(iframe);
                }
              }
            });

            // Fix Google Slides/Docs iframe URLs from /edit to /embed
            const allIframes = Array.from(parsed.getElementsByTagName('iframe'));
            allIframes.forEach((node) => {
              const src = node.getAttribute('src') || '';
              if (src.includes('docs.google.com/presentation') && src.includes('/edit')) {
                node.setAttribute('src', src.replace(/\/edit[^"]*/, '/embed?start=false&loop=false&delayms=3000'));
              }
              node.setAttribute('allowfullscreen', 'true');
              node.setAttribute('allow', 'fullscreen; popups; popups-to-escape-sandbox');
            });

            // Make embeds responsive
            const iframeNodes = Array.from(parsed.getElementsByTagName('iframe'));
            iframeNodes.forEach((node) => {
              const widthAttr = Number.parseInt(node.getAttribute('width') || '0', 10);
              const heightAttr = Number.parseInt(node.getAttribute('height') || '0', 10);
              const ratio = widthAttr > 0 && heightAttr > 0 ? heightAttr / widthAttr : 9 / 16;

              const wrapper = parsed.createElement('div');
              wrapper.className = 'responsive-iframe';
              // Fallback inline style to preserve ratio even if CSS fails
              wrapper.setAttribute('style', `position:relative;width:100%;padding-top:${Math.min(Math.max(ratio * 100, 40), 100)}%;`);

              const clone = node.cloneNode(true) as HTMLIFrameElement;
              clone.removeAttribute('width');
              clone.removeAttribute('height');
              clone.setAttribute('loading', 'lazy');
              clone.setAttribute('style', 'position:absolute;top:0;left:0;width:100%;height:100%;border:0;');

              wrapper.appendChild(clone);
              node.replaceWith(wrapper);
            });

            const bodyHtml = parsed.body ? parsed.body.innerHTML : sanitizedHtmlInput;
            // Final pass to ensure any URLs serialized from DOM are clean
            const sanitizedBodyHtml = stripAwsQueryParamsFromUrls(bodyHtml);
            setHtmlContent(sanitizedBodyHtml);
            setMarkdownContent("");
          } catch {
            // If parsing fails, fallback to direct assignment
            const sanitized = stripAwsQueryParamsFromUrls(stableDocUrl);
            setHtmlContent(sanitized);
            setMarkdownContent("");
          }
        } else {
          try {
            // Keep HTML as-is for mermaid rendering (DocumentWithMermaid will handle it)
            const sanitized = stripAwsQueryParamsFromUrls(stableDocUrl);
            // Keep HTML for mermaid rendering - DocumentWithMermaid will detect and render mermaid
            setHtmlContent(sanitized);
            // Also convert to markdown for fallback/display
            const markdown = turndownService.turndown(sanitized);
            setMarkdownContent(markdown);
          } catch {
            // Fallback to plain text if conversion fails
            const tempDiv = document.createElement('div');
            const sanitized = stripAwsQueryParamsFromUrls(stableDocUrl);
            setHtmlContent(sanitized);
            tempDiv.innerHTML = sanitized;
            const fallbackContent = tempDiv.textContent || stableDocUrl;
            setMarkdownContent(fallbackContent);
          }
        }
      } else {
        // For DOCX content, fetch and render using docx-preview
        const sanitizedUrl = stripAwsQueryParamsFromUrls(stableDocUrl);
        const response = await fetch(sanitizedUrl);
        
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        
        const blob = await response.blob();
        const arrayBuffer = await blob.arrayBuffer();
        
        // Wait for container to be available for DOCX rendering
        let attempts = 0;
        while (!containerRef.current && attempts < 10) {
          await new Promise(resolve => setTimeout(resolve, 100));
          attempts++;
        }
        
        if (containerRef.current) {
          await renderAsync(arrayBuffer, containerRef.current, undefined, {
            className: "docx-viewer",
            inWrapper: true,
            ignoreWidth: false,
            ignoreHeight: false,
            ignoreFonts: false,
            breakPages: true,
            useBase64URL: true,
          });
        } else {
          throw new Error('Container ref not available after waiting');
        }
      }

      // Calculate total pages after rendering
      if (containerRef.current) {
        const container = containerRef.current;
        const contentHeight = container.scrollHeight;
        const viewportHeight = container.clientHeight;
        totalPagesRef.current = Math.ceil(contentHeight / viewportHeight);
      }

      // Notify load completion (stable ref avoids effect loops)
      handleDocumentLoadRef.current?.();
      
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }, [stableDocUrl, isHtml, turndownService]);

  // Load document when component mounts - simplified approach
  useEffect(() => {
    loadDocument();
  }, [loadDocument]);

  if (error) {
    return (
      <div className="flex h-reg-600 items-center justify-center bg-gradient-to-br from-danger-50 to-danger-100 rounded-2xl border border-red-200 shadow-lg">
        <div className="text-center p-8 max-w-md">
          <div className="w-16 h-16 mx-auto mb-4 bg-red-100 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-red-900 mb-2">{t("docViewer.loadErrorTitle")}</h3>
          <p className="text-red-700 text-sm leading-relaxed mb-4">{t("docViewer.loadErrorBody")}</p>
          <div className="bg-red-50 border border-red-200 rounded-lg p-3">
            <p className="text-xs text-red-600 font-mono break-words">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-reg-600 items-center justify-center bg-gradient-to-br from-info-50 to-indigo-100 rounded-2xl border border-blue-200 shadow-lg">
        <div className="text-center p-8">
          <div className="relative w-16 h-16 mx-auto mb-6">
            <div className="absolute inset-0 border-4 border-blue-200 rounded-full animate-pulse"></div>
            <div className="absolute inset-0 border-4 border-blue-600 rounded-full animate-spin border-t-transparent"></div>
            <div className="absolute inset-2 bg-blue-50 rounded-full flex items-center justify-center">
              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
          </div>
          <h3 className="text-xl font-semibold text-blue-900 mb-2">{t("docViewer.processingTitle")}</h3>
          <p className="text-blue-700">{t("docViewer.processingBody")}</p>
          <div className="mt-4 w-32 h-1 bg-blue-200 rounded-full mx-auto overflow-hidden">
            <div className="h-full bg-gradient-to-r from-info-500 to-indigo-600 rounded-full animate-pulse"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="min-h-screen-40 sm:min-h-screen-50 lg:min-h-screen-60 max-h-[calc(100vh-120px)] sm:max-h-[calc(100vh-140px)] lg:max-h-[calc(100vh-170px)] overflow-auto bg-white rounded-lg sm:rounded-xl lg:rounded-2xl border border-gray-200 shadow-lg hover:shadow-xl transition-shadow duration-300"> {/* design-lint-ignore: viewport math */}
      {creativeHtml ? (
        <HtmlSlideIframe
          html={stableDocUrl}
          onLoad={() => handleDocumentLoadRef.current?.()}
          onProgress={onSlideProgress}
          onComplete={onSlideComplete}
          scormSlideId={scormSlideId}
        />
      ) : isHtml ? (
        <div className="p-4 sm:p-6 lg:p-8 xl:p-12 markdown-content">
          {/* Always use htmlContent if it exists (even if markdownContent also exists) for mermaid support */}
          {/* Text documents read at a centered, generous measure (max-w-5xl,
              ~1024px) so they fill the wide learner viewer instead of leaving
              large side gutters. DOCX below keeps its own page width and
              players are separate components, so only this HTML/markdown
              branch is constrained. */}
          {htmlContent ? (
            <div className="doc-fs-fill prose prose-sm sm:prose-base lg:prose-lg prose-gray mx-auto max-w-5xl">
              <DocumentWithMermaid htmlContent={htmlContent} />
            </div>
          ) : markdownContent ? (
            <div className="doc-fs-fill prose prose-sm sm:prose-base lg:prose-lg prose-gray mx-auto max-w-5xl">
              <ReactMarkdown 
                components={{
                  // Enhanced heading styles with better typography
                  h1: ({children}) => (
                    <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold mb-4 sm:mb-6 lg:mb-8 text-gray-900 border-b-2 border-gradient-to-r from-info-500 to-indigo-600 pb-2 sm:pb-3 lg:pb-4 leading-tight">
                      {children}
                    </h1>
                  ),
                  h2: ({children}) => (
                    <h2 className="text-xl sm:text-2xl lg:text-3xl font-semibold mb-3 sm:mb-4 lg:mb-6 text-gray-900 mt-6 sm:mt-8 lg:mt-12 first:mt-0 leading-tight">
                      {children}
                    </h2>
                  ),
                  h3: ({children}) => (
                    <h3 className="text-lg sm:text-xl lg:text-2xl font-semibold mb-2 sm:mb-3 lg:mb-4 text-gray-900 mt-5 sm:mt-6 lg:mt-10 first:mt-0 leading-tight">
                      {children}
                    </h3>
                  ),
                  h4: ({children}) => (
                    <h4 className="text-xl font-semibold mb-3 text-gray-900 mt-8 first:mt-0 leading-tight">
                      {children}
                    </h4>
                  ),
                  h5: ({children}) => (
                    <h5 className="text-lg font-semibold mb-2 text-gray-900 mt-6 first:mt-0 leading-tight">
                      {children}
                    </h5>
                  ),
                  h6: ({children}) => (
                    <h6 className="text-base font-semibold mb-2 text-gray-900 mt-4 first:mt-0 leading-tight">
                      {children}
                    </h6>
                  ),
                  
                  // Enhanced paragraph styling
                  p: ({children}) => (
                    <p className="mb-6 text-gray-700 leading-relaxed text-lg">
                      {children}
                    </p>
                  ),
                  
                  // Better emphasis styling
                  strong: ({children}) => (
                    <strong className="font-semibold text-gray-900 bg-yellow-50 px-1 rounded">
                      {children}
                    </strong>
                  ),
                  em: ({children}) => (
                    <em className="italic text-gray-800 bg-blue-50 px-1 rounded">
                      {children}
                    </em>
                  ),
                  
                  // Enhanced list styling
                  ul: ({children}) => (
                    <ul className="list-none ps-0 mb-6 space-y-3">
                      {children}
                    </ul>
                  ),
                  ol: ({children}) => (
                    <ol className="list-none ps-0 mb-6 space-y-3 counter-reset-list">
                      {children}
                    </ol>
                  ),
                  li: (props) => {
                    const { children } = props as { children?: React.ReactNode };
                    const isOrdered = (props as { ordered?: boolean }).ordered;
                    return (
                      <li className={`relative ps-8 text-gray-700 text-lg leading-relaxed ${
                        isOrdered ? 'counter-increment-list' : ''
                      }`}>
                        <span className={`absolute start-0 top-0 flex items-center justify-center w-6 h-6 rounded-full text-sm font-medium ${
                          isOrdered 
                            ? 'bg-blue-100 text-blue-700 border-2 border-blue-200' 
                            : 'bg-indigo-100 text-indigo-700'
                        }`}>
                          {isOrdered ? (
                            <span className="counter-content"></span>
                          ) : (
                            <span className="w-2 h-2 bg-indigo-600 rounded-full"></span>
                          )}
                        </span>
                        {children}
                      </li>
                    );
                  },
                  
                  // Enhanced blockquote styling
                  blockquote: ({children}) => (
                    <blockquote className="relative border-s-4 border-blue-400 ps-6 py-4 my-8 bg-gradient-to-r from-info-50 to-indigo-50 rounded-e-lg shadow-sm">
                      <div className="absolute top-2 start-2 text-blue-300 opacity-50">
                        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h3.983v10h-9.983z"/>
                        </svg>
                      </div>
                      <div className="text-gray-800 font-medium italic">
                        {children}
                      </div>
                    </blockquote>
                  ),
                  
                  // Enhanced code styling
                  code: ({children, className}) => {
                    const isInline = !className;
                    if (isInline) {
                      return (
                        <code className="bg-gray-100 text-purple-700 px-2 py-1 rounded-md text-sm font-mono border border-gray-200 shadow-sm">
                          {children}
                        </code>
                      );
                    }
                    return (
                      <div className="relative my-6">
                        <div className="absolute top-0 start-0 end-0 h-8 bg-gray-800 rounded-t-lg flex items-center px-4">
                          <div className="flex space-x-2">
                            <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                            <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                            <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                          </div>
                        </div>
                        <code className="block bg-gray-900 text-gray-100 p-6 pt-12 rounded-lg overflow-x-auto font-mono text-sm leading-relaxed shadow-lg">
                          {children}
                        </code>
                      </div>
                    );
                  },
                  pre: ({children}) => <div className="mb-6">{children}</div>,
                  
                  // Enhanced link styling
                  a: ({href, children}) => (
                    <a 
                      href={href} 
                      className="text-blue-600 hover:text-blue-700 underline decoration-blue-300 hover:decoration-blue-500 transition-colors duration-200 font-medium"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {children}
                      <svg className="inline w-3 h-3 ms-1 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  ),
                  
                  // Enhanced table styling
                  table: ({children}) => (
                    <div className="overflow-x-auto mb-8 rounded-lg shadow-lg border border-gray-200">
                      <table className="min-w-full bg-white">
                        {children}
                      </table>
                    </div>
                  ),
                  thead: ({children}) => (
                    <thead className="bg-gradient-to-r from-gray-50 to-gray-100">
                      {children}
                    </thead>
                  ),
                  tbody: ({children}) => (
                    <tbody className="divide-y divide-gray-200">
                      {children}
                    </tbody>
                  ),
                  tr: ({children}) => (
                    <tr className="hover:bg-gray-50 transition-colors duration-150">
                      {children}
                    </tr>
                  ),
                  th: ({children}) => (
                    <th className="px-6 py-4 text-start text-sm font-semibold text-gray-900 uppercase tracking-wider border-b-2 border-gray-200">
                      {children}
                    </th>
                  ),
                  td: ({children}) => (
                    <td className="px-6 py-4 text-sm text-gray-700 border-b border-gray-100">
                      {children}
                    </td>
                  ),
                  
                  // Enhanced horizontal rule
                  hr: () => (
                    <hr className="my-12 border-0 h-px bg-gradient-to-r from-transparent via-gray-300 to-transparent" />
                  ),
                  
                  // Enhanced image styling
                  img: ({src, alt}) => (
                    <div className="my-8 text-center">
                      <img 
                        src={src} 
                        alt={alt} 
                        className="max-w-full h-auto rounded-xl shadow-lg border border-gray-200 hover:shadow-xl transition-shadow duration-300 mx-auto" 
                      />
                      {alt && (
                        <p className="mt-3 text-sm text-gray-500 italic">{alt}</p>
                      )}
                    </div>
                  )
                }}
              >
                {markdownContent}
              </ReactMarkdown>
            </div>
          ) : (
            <div className="text-center text-gray-500 py-16">
              <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-gray-700 mb-2">{t("docViewer.noContentTitle")}</h3>
              <p className="text-gray-500">{t("docViewer.noContentBody")}</p>
            </div>
          )}
          
          <style>{`
            .markdown-content {
              font-family: 'Figtree', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
              line-height: 1.7;
              color: #374151; /* design-lint-ignore: injected CSS string, cannot use Tailwind token */
            }
            
            /* Responsive embeds */
            .markdown-content iframe,
            .markdown-content video,
            .markdown-content embed,
            .markdown-content object {
              max-width: 100%;
              width: 100%;
              border: 0;
            }
            /* Images keep the per-image width the author set in the editor
               (the <img width=…> attribute — a resized logo stays small, a
               content image stays large) but never overflow the column and
               keep their aspect ratio when the screen is narrower than that
               width. Without this every image rendered at its raw saved width,
               so high-res logos looked as big as content images and overflowed
               on mobile. */
            .markdown-content img {
              max-width: 100%;
              height: auto;
            }
            .markdown-content .responsive-iframe { position: relative; width: 100%; }
            .markdown-content .responsive-iframe iframe { position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: 0; }
            
            .counter-reset-list {
              counter-reset: list-counter;
            }
            
            .counter-increment-list {
              counter-increment: list-counter;
            }
            
            .counter-content::before {
              content: counter(list-counter);
              font-size: 0.75rem;
              font-weight: 600;
            }
            
            /* Custom scrollbar for better UX */
            .markdown-content *::-webkit-scrollbar {
              width: 6px;
              height: 6px;
            }
            
            .markdown-content *::-webkit-scrollbar-track {
              background: #f1f5f9; /* design-lint-ignore: injected CSS string, cannot use Tailwind token */
              border-radius: 3px;
            }

            .markdown-content *::-webkit-scrollbar-thumb {
              background: #cbd5e1; /* design-lint-ignore: injected CSS string, cannot use Tailwind token */
              border-radius: 3px;
            }

            .markdown-content *::-webkit-scrollbar-thumb:hover {
              background: #94a3b8; /* design-lint-ignore: injected CSS string, cannot use Tailwind token */
            }
          `}</style>
        </div>
      ) : (
        // For DOCX files, the content is rendered directly into the container
        <div className="docx-content">
          <style>{`
            .docx-content .docx-viewer {
              padding: 2rem;
              font-family: 'Figtree', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
              line-height: 1.6;
              color: #374151; /* design-lint-ignore: injected CSS string, cannot use Tailwind token */
            }

            .docx-content .docx-viewer h1,
            .docx-content .docx-viewer h2,
            .docx-content .docx-viewer h3,
            .docx-content .docx-viewer h4,
            .docx-content .docx-viewer h5,
            .docx-content .docx-viewer h6 {
              color: #1f2937; /* design-lint-ignore: injected CSS string, cannot use Tailwind token */
              font-weight: 600;
              margin-top: 1.5rem;
              margin-bottom: 1rem;
            }
            
            .docx-content .docx-viewer p {
              margin-bottom: 1rem;
              line-height: 1.7;
            }
          `}</style>
        </div>
      )}
    </div>
  );
});

export const DocViewerComponent = memo(DocViewerComponentInner, (prev, next) => {
  return prev.docUrl === next.docUrl && prev.isHtml === next.isHtml;
}); 
