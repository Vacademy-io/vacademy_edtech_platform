import katex from 'katex';
import 'katex/dist/katex.min.css';

export function parseHtmlToString(html: string) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return doc.body.textContent || doc.body.innerText || '';
}

export function extractImagesFromHtml(html: string) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const images = Array.from(doc.body.querySelectorAll('img')).map((img) => img);
    return images;
}

/**
 * Processes an HTML string and extracts its content and images
 * @param htmlString The HTML string to process
 * @returns An array of content items (text or image)
 */
export function processHtmlString(html: string | undefined) {
    if (!html) return [{ type: 'text', content: '' }];

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const result: { type: string; content: string }[] = [];

    // Helper function to process nodes recursively
    /**
     * Extract a continuous LaTeX expression starting at position `start` in `text`.
     * Handles nested braces, subscripts, superscripts, and chained commands.
     * Returns the end index (exclusive) of the expression.
     */
    function extractLatexExpression(text: string, start: number): number {
        let i = start;
        while (i < text.length) {
            if (text[i] === '\\') {
                // Read command name
                let j = i + 1;
                while (j < text.length && /[a-zA-Z]/.test(text[j]!)) j++;
                if (j === i + 1) {
                    // Single-char command like \, or \{
                    j++;
                }
                i = j;
                // Read optional arguments in braces
                while (i < text.length && text[i] === '{') {
                    i = findClosingBrace(text, i);
                }
            } else if (text[i] === '_' || text[i] === '^') {
                i++;
                if (i < text.length && text[i] === '{') {
                    i = findClosingBrace(text, i);
                } else if (i < text.length) {
                    i++; // single char subscript/superscript
                }
            } else if (text[i] === '{') {
                i = findClosingBrace(text, i);
            } else {
                break;
            }
        }
        return i;
    }

    function findClosingBrace(text: string, start: number): number {
        let depth = 1;
        let i = start + 1;
        while (i < text.length && depth > 0) {
            if (text[i] === '{') depth++;
            else if (text[i] === '}') depth--;
            i++;
        }
        return i;
    }

    // Pattern to detect the START of a raw LaTeX command
    const LATEX_CMD_START =
        /\\(?:mathrm|mathbf|mathit|mathsf|mathtt|mathcal|mathbb|mathfrak|text|textbf|textit|frac|sqrt|overline|underline|vec|hat|bar|dot|ddot|tilde|widetilde|widehat|overleftarrow|overrightarrow|overbrace|underbrace|sum|prod|int|lim|log|ln|sin|cos|tan|cot|sec|csc|alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega|longrightarrow|rightarrow|leftarrow|Rightarrow|Leftarrow|times|div|pm|mp|cdot|leq|geq|neq|approx|equiv|subset|supset|cup|cap|infty|partial|nabla|forall|exists|neg|wedge|vee|oplus|otimes)[{_^ ]/g;

    function renderLatexSegment(tex: string) {
        try {
            const rendered = katex.renderToString(tex, {
                throwOnError: false,
                displayMode: false,
            });
            result.push({ type: 'formula', content: rendered });
        } catch {
            result.push({ type: 'text', content: tex });
        }
    }

    function pushDelimited(tex: string, displayMode: boolean, original: string) {
        try {
            result.push({
                type: 'formula',
                content: katex.renderToString(tex, { throwOnError: false, displayMode }),
            });
        } catch {
            result.push({ type: 'text', content: original });
        }
    }

    function processTextWithLatex(text: string) {
        // Split on every delimiter the generators use. `\(…\)` / `\[…\]` were
        // missing, so topic-generated papers exported the delimiters as literal
        // text ("\(\{(2,1),(2,2)\}\)") instead of a formula.
        const dollarParts = text.split(
            /(\$\$[^$]+\$\$|\$[^$]+\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\))/g
        );
        dollarParts.forEach((part) => {
            if (part.startsWith('$$') && part.endsWith('$$')) {
                pushDelimited(part.slice(2, -2), true, part);
            } else if (part.startsWith('\\[') && part.endsWith('\\]')) {
                pushDelimited(part.slice(2, -2), true, part);
            } else if (part.startsWith('\\(') && part.endsWith('\\)')) {
                pushDelimited(part.slice(2, -2), false, part);
            } else if (part.startsWith('$') && part.endsWith('$') && part.length > 1) {
                pushDelimited(part.slice(1, -1), false, part);
            } else if (part) {
                // Check for raw LaTeX commands (without $ delimiters)
                LATEX_CMD_START.lastIndex = 0;
                const firstMatch = LATEX_CMD_START.exec(part);
                if (firstMatch) {
                    LATEX_CMD_START.lastIndex = 0;
                    let lastIndex = 0;
                    let match: RegExpExecArray | null;
                    while ((match = LATEX_CMD_START.exec(part)) !== null) {
                        // Push text before the match
                        if (match.index > lastIndex) {
                            const before = part.slice(lastIndex, match.index);
                            if (before) result.push({ type: 'text', content: before });
                        }
                        // Extract full expression from the start of this command
                        const exprEnd = extractLatexExpression(part, match.index);
                        const fullExpr = part.slice(match.index, exprEnd);
                        renderLatexSegment(fullExpr);
                        lastIndex = exprEnd;
                        LATEX_CMD_START.lastIndex = exprEnd;
                    }
                    // Push remaining text after last match
                    if (lastIndex < part.length) {
                        const remaining = part.slice(lastIndex);
                        if (remaining) result.push({ type: 'text', content: remaining });
                    }
                    LATEX_CMD_START.lastIndex = 0;
                } else {
                    result.push({ type: 'text', content: part });
                }
            }
        });
    }

    function processNode(node: Node) {
        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent;
            if (text && text.trim()) {
                // Collapse internal whitespace but preserve a single leading/trailing space
                const processed = text.replace(/\s+/g, ' ');
                processTextWithLatex(processed);
            }
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            const element = node as Element;

            // Handle images
            if (element.tagName === 'IMG') {
                const src = element.getAttribute('src');
                if (src) {
                    result.push({ type: 'image', content: src });
                }
            }
            // Handle math-inline/math-display spans with data-latex attribute
            // (content inside is entity-encoded, so re-render from data-latex)
            else if (element.getAttribute('data-latex')) {
                const latexStr = element.getAttribute('data-latex')!;
                // The editor emits `math-block`; `math-display` is the older
                // spelling still present in some stored content.
                const isDisplay =
                    element.classList.contains('math-display') ||
                    element.classList.contains('math-block');
                try {
                    const rendered = katex.renderToString(latexStr, {
                        throwOnError: false,
                        displayMode: isDisplay,
                    });
                    result.push({ type: 'formula', content: rendered });
                } catch {
                    result.push({
                        type: 'formula',
                        content: element.outerHTML,
                    });
                }
            }
            // Handle KaTeX/math formula spans
            else if (
                element.classList.contains('ql-formula') ||
                element.querySelector('.katex, .katex-html, .katex-mathml')
            ) {
                // Preserve the entire formula HTML
                result.push({
                    type: 'formula',
                    content: element.outerHTML,
                });
            }
            // Handle <br> as a line break
            else if (element.tagName === 'BR') {
                result.push({ type: 'text', content: '<br/>' });
            }
            // Process children recursively for other elements
            else {
                const isBlock = [
                    'P',
                    'DIV',
                    'LI',
                    'H1',
                    'H2',
                    'H3',
                    'H4',
                    'H5',
                    'H6',
                    'BLOCKQUOTE',
                    'OL',
                    'UL',
                    'TR',
                ].includes(element.tagName);

                for (const child of Array.from(element.childNodes)) {
                    processNode(child);
                }

                // Add a line break after block-level elements
                if (isBlock) {
                    result.push({ type: 'text', content: '<br/>' });
                }
            }
        }
    }

    // Process all body children
    for (const child of Array.from(doc.body.childNodes)) {
        processNode(child);
    }

    return result;
}

export function makeid() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

    for (let i = 0; i < 5; i++)
        text += possible.charAt(Math.floor(Math.random() * possible.length));

    return text;
}

// Worker management
let imageWorker: Worker | null = null;
let nextRequestId = 0;
const pendingRequests = new Map<number, (value: string) => void>();

// Initialize the worker once
function getImageWorker() {
    if (!imageWorker && typeof Worker !== 'undefined') {
        try {
            imageWorker = new Worker(
                new URL('../../../../worker/image-worker.ts', import.meta.url),
                {
                    type: 'module',
                }
            );
            imageWorker.onmessage = (event) => {
                const { id, base64Url } = event.data;
                const resolve = pendingRequests.get(id);
                if (resolve) {
                    resolve(base64Url);
                    pendingRequests.delete(id);
                }
            };

            imageWorker.onerror = (error) => {
                console.error('Worker error:', error);
            };
        } catch (error) {
            console.error('Failed to create image worker:', error);
            imageWorker = null;
        }
    }
    return imageWorker;
}

// Add a cache for base64 conversions
const base64Cache = new Map<string, string>();

export async function getBase64FromUrl(url: string) {
    // Check cache first
    if (base64Cache.has(url)) {
        console.log('return from cachec');
        return base64Cache.get(url);
    }

    // Try to use the worker for all image conversions
    const worker = getImageWorker();

    if (worker) {
        try {
            const id = nextRequestId++;
            const workerPromise = new Promise<string>((resolve, reject) => {
                // Add a timeout to prevent hanging requests
                const timeoutId = setTimeout(() => {
                    pendingRequests.delete(id);
                    reject(new Error('Worker timeout'));
                }, 10000); // 10 seconds timeout

                pendingRequests.set(id, (result) => {
                    clearTimeout(timeoutId);
                    resolve(result);
                });

                worker.postMessage({ url, id });
            });

            // Wait for the worker to complete
            try {
                const result = await workerPromise;
                base64Cache.set(url, result);
                return result;
            } catch (error) {
                console.warn(`Worker failed for ${url}:`, error);
                // Fall through to the fallback implementation
            }
        } catch (error) {
            console.error('Worker communication failed:', error);
            // Fall through to the fallback implementation
        }
    }

    // Fallback implementation (original code)
    // Check if the URL is an SVG
    if (url.toLowerCase().endsWith('.svg')) {
        try {
            const requestOptions: RequestInit = {
                method: 'GET',
                mode: 'cors',
                cache: 'no-cache',
                credentials: 'same-origin',
                redirect: 'follow',
            };

            // Timeout to prevent hanging
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            requestOptions.signal = controller.signal;

            try {
                const response = await fetch(url, requestOptions);
                clearTimeout(timeoutId);

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
                }

                const svgText = await response.text();

                const base64 = btoa(unescape(encodeURIComponent(svgText)));
                const result = `data:image/svg+xml;base64,${base64}`;
                base64Cache.set(url, result);
                return result;
            } catch (error) {
                console.error(`Failed to convert SVG to base64: ${url}`, error);
                return url;
            }
        } catch (outerError) {
            return url;
        }
    }

    // Existing non-SVG image handling
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = `${url}?__v=${Date.now()}`;
    return new Promise((resolve) => {
        img.onload = function () {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx?.drawImage(img, 0, 0);
            const base64String = canvas.toDataURL('image/png');
            base64Cache.set(url, base64String);
            resolve(base64String);
        };
        img.onerror = function () {
            console.error(`Failed to load image: ${url}`);
            resolve(url);
        };
    });
}
