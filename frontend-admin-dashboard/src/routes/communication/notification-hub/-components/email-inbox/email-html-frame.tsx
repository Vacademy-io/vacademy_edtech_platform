import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DotsThree } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

/**
 * Where mail clients put the quoted chain of a reply. Hidden by default (Gmail's "trimmed
 * content"), shown again by the ••• toggle.
 */
const QUOTE_SELECTOR = [
    '.gmail_quote',
    'blockquote[type="cite"]',
    '#divRplyFwdMsg',
    '#divRplyFwdMsg ~ *',
    '#appendonsend ~ *',
    '.yahoo_quoted',
    '.moz-cite-prefix',
    '.moz-cite-prefix ~ blockquote',
].join(', ');

/** Elements an email must never get to use, even inside a script-less sandbox. */
const STRIP_SELECTOR =
    'script, noscript, base, meta[http-equiv], iframe, frame, frameset, object, embed, applet';

const MIN_HEIGHT = 48;

interface PreparedEmail {
    /** The sanitized document, serialized. */
    html: string;
    /** True when there is quoted content to trim AND something remains once it is trimmed. */
    canTrim: boolean;
}

/**
 * Parse with DOMParser (which never runs scripts), drop active / navigating elements, and note
 * whether trimming the quoted chain would leave any visible text.
 */
export function prepareEmail(raw: string): PreparedEmail {
    const doc = new DOMParser().parseFromString(raw || '', 'text/html');
    doc.querySelectorAll(STRIP_SELECTOR).forEach((el) => el.remove());
    doc.querySelectorAll('a[href]').forEach((a) => a.setAttribute('rel', 'noopener noreferrer'));

    let canTrim = false;
    if (doc.body?.querySelector(QUOTE_SELECTOR)) {
        const probe = doc.body.cloneNode(true) as HTMLElement;
        probe.querySelectorAll(QUOTE_SELECTOR).forEach((el) => el.remove());
        canTrim = (probe.textContent ?? '').trim().length > 0;
    }
    return { html: doc.documentElement.outerHTML, canTrim };
}

/**
 * The reading-pane look: the email's own layout at its natural size, images shrunk to fit,
 * links opening in a new tab. Named/rgb colours only — this string is CSS for the email
 * document, not app styling.
 */
function buildSrcDoc(prepared: PreparedEmail, trim: boolean): string {
    const style = `<style>
        html, body { margin: 0; padding: 0; background: white; }
        body {
            font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
            font-size: 14px;
            line-height: 1.5;
            color: rgb(32 33 36);
            overflow-x: auto;
            overflow-wrap: anywhere;
        }
        img { max-width: 100%; height: auto; }
        pre { white-space: pre-wrap; }
        a { color: rgb(26 115 232); }
        blockquote { margin: 0 0 0 0.8ex; border-left: 1px solid rgb(204 204 204); padding-left: 1ex; }
        ${trim ? `${QUOTE_SELECTOR} { display: none !important; }` : ''}
    </style>`;
    const head = `<meta charset="utf-8"><base target="_blank">${style}`;
    const html = prepared.html;
    if (/<head[\s>]/i.test(html))
        return `<!doctype html>${html.replace(/<head([^>]*)>/i, `<head$1>${head}`)}`;
    return `<!doctype html><html><head>${head}</head>${html}</html>`;
}

interface Props {
    html: string;
    title: string;
    className?: string;
}

/**
 * Renders an email's HTML in a sandboxed iframe sized to its content (no inner scrollbar).
 * The sandbox has no allow-scripts, so nothing in the email can run; allow-same-origin only
 * lets this component measure the document's height; links open in a new tab.
 */
export function EmailHtmlFrame({ html, title, className }: Props) {
    const { t } = useTranslation('communicationEmailThread');
    const frameRef = useRef<HTMLIFrameElement>(null);
    const [height, setHeight] = useState(MIN_HEIGHT);
    const [showTrimmed, setShowTrimmed] = useState(false);

    const prepared = useMemo(() => prepareEmail(html), [html]);
    const srcDoc = useMemo(
        () => buildSrcDoc(prepared, prepared.canTrim && !showTrimmed),
        [prepared, showTrimmed]
    );

    const measure = useCallback(() => {
        const doc = frameRef.current?.contentDocument;
        if (!doc?.documentElement) return;
        const next = Math.max(
            MIN_HEIGHT,
            doc.documentElement.scrollHeight,
            doc.body?.scrollHeight ?? 0
        );
        setHeight((prev) => (Math.abs(prev - next) > 1 ? next : prev));
    }, []);

    // Re-measure as late images and web fonts land, and when the pane is resized.
    useEffect(() => {
        const frame = frameRef.current;
        if (!frame) return;
        let observer: ResizeObserver | undefined;
        const onLoad = () => {
            measure();
            const doc = frame.contentDocument;
            if (!doc?.body) return;
            doc.querySelectorAll('img').forEach((img) => img.addEventListener('load', measure));
            observer?.disconnect();
            observer = new ResizeObserver(measure);
            observer.observe(doc.body);
        };
        frame.addEventListener('load', onLoad);
        // The srcdoc may already have loaded before this effect attached its listener.
        if (frame.contentDocument?.readyState === 'complete') onLoad();
        return () => {
            frame.removeEventListener('load', onLoad);
            observer?.disconnect();
        };
    }, [measure, srcDoc]);

    return (
        <div className={cn('min-w-0', className)}>
            <iframe
                ref={frameRef}
                title={title}
                srcDoc={srcDoc}
                sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
                className="block w-full border-0 bg-white"
                // Height follows the email's own content (measured above) — genuinely dynamic.
                style={{ height }}
            />
            {prepared.canTrim && (
                <button
                    type="button"
                    onClick={() => setShowTrimmed((v) => !v)}
                    className="mt-2 inline-flex h-4 items-center rounded-sm bg-neutral-200 px-1 text-neutral-600 hover:bg-neutral-300"
                    title={showTrimmed ? t('hideTrimmedContent') : t('showTrimmedContent')}
                    aria-label={showTrimmed ? t('hideTrimmedContent') : t('showTrimmedContent')}
                    aria-expanded={showTrimmed}
                >
                    <DotsThree size={16} weight="bold" />
                </button>
            )}
        </div>
    );
}
