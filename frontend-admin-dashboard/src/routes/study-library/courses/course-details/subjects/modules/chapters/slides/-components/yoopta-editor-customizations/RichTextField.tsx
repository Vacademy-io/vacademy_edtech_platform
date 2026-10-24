import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { getPublicUrl, UploadFileInS3 } from '@/services/upload_file';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';

// Shared rich-text editor for Yoopta custom blocks (quiz, tabbed content, …).
// A lightweight controlled contentEditable with its own compact toolbar
// (B / I / U / bullet / numbered / link / image). It renders dependably inside
// the Slate/Yoopta document (unlike a full nested editor), commits on input +
// blur, isolates its native key/input events so the outer editor can't swallow
// Backspace/Delete, and never lets a stale value wipe what's being typed.

const C = {
    accent: '#4338ca', // design-lint-ignore: shared rich-text chrome — inline style required
    accentSoft: '#eef2ff', // design-lint-ignore: shared rich-text chrome — inline style required
    muted: '#666666', // design-lint-ignore: shared rich-text chrome — inline style required
    border: '#dddddd', // design-lint-ignore: shared rich-text chrome — inline style required
    surface: '#fafafa', // design-lint-ignore: shared rich-text chrome — inline style required
    white: '#ffffff', // design-lint-ignore: shared rich-text chrome — inline style required
};

/** Upload an image to S3 and return its public URL. Returns null on failure. */
async function uploadImage(file: File): Promise<string | null> {
    try {
        const accessToken = getTokenFromCookie(TokenKey.accessToken);
        const data = getTokenDecodedData(accessToken);
        const INSTITUTE_ID = (data && Object.keys(data.authorities)[0]) || undefined;
        const userId = data?.sub || 'unknown-user';
        const fileId = await UploadFileInS3(file, () => {}, userId, INSTITUTE_ID, 'STUDENTS', true);
        if (!fileId) return null;
        const url = await getPublicUrl(fileId);
        return url || null;
    } catch (e) {
        console.error('[RichText] image upload failed', e);
        return null;
    }
}

// Treat blank / "<p><br></p>" / nbsp-only / formatting-only content as empty,
// but never embedded media (image/video/etc.).
export const isRichTextEmpty = (html?: string): boolean => {
    if (!html) return true;
    if (/<(img|iframe|video|audio)\b/i.test(html)) return false;
    return (
        html.replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').trim() === ''
    );
};

// Escape a JSON string for safe embedding in an HTML attribute (& first), so the
// stored rich-text HTML round-trips losslessly through getAttribute on reload.
export const escapeRichTextAttr = (s: string): string =>
    s
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

// Store a block's JSON payload as base64 inside a data-* attribute. Base64 uses
// only [A-Za-z0-9+/=], so the document-wide HTML sanitizers (stripAwsQueryParams,
// empty-img, data-meta strippers in formatHTMLString) can NEVER match — and thus
// can never truncate/corrupt the JSON. This was the root cause of vanishing
// quiz/tab content when an S3 image (…amazonaws.com?X-Amz-Signature=…) lived
// inside the rich text: the strip-aws regex ate across the encoded JSON quotes
// and broke JSON.parse on reload, resetting the block to empty defaults.
// Strip expired S3 signatures from any amazonaws URL inside a block's data
// BEFORE base64-encoding it. Inner-block images are uploaded via getPublicUrl,
// which returns a 1-day SIGNED URL (…amazonaws.com?X-Amz-Signature=…&X-Amz-Expires=…).
// Because the payload is base64, the document-wide stripAwsQueryParamsFromUrls
// can't reach it, so without this the image would 404 once the signature
// expires. The bucket objects are public-read, so the query-less URL is the
// permanent one. The regex is bounded by whitespace/quote/angle so it can only
// ever trim a single URL's query — never run into surrounding content.
const stripAwsSignaturesDeep = (value: unknown): unknown => {
    if (typeof value === 'string') {
        return /amazonaws\.com/i.test(value)
            ? value.replace(
                  /(https?:\/\/[^\s"'<>]*amazonaws\.com[^\s"'<>?]*)\?[^\s"'<>]*/gi,
                  '$1'
              )
            : value;
    }
    if (Array.isArray(value)) return value.map(stripAwsSignaturesDeep);
    if (value && typeof value === 'object') {
        const source = value as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(source)) out[key] = stripAwsSignaturesDeep(source[key]);
        return out;
    }
    return value;
};

export const encodeBlockData = (obj: unknown): string => {
    try {
        return btoa(unescape(encodeURIComponent(JSON.stringify(stripAwsSignaturesDeep(obj)))));
    } catch (e) {
        console.error('[BlockData] encode failed', e);
        return '';
    }
};

// Decode a data-* payload written by encodeBlockData. Backward compatible: older
// slides stored raw/escaped JSON (which getAttribute returns starting with { or
// [), so we parse that directly; newer slides store base64 (no leading brace).
export function decodeBlockData<T>(raw: string | null | undefined, fallback: T): T {
    if (raw == null) return fallback;
    const s = String(raw).trim();
    if (!s) return fallback;
    // Legacy uncoded JSON (getAttribute already entity-decoded it).
    if (s[0] === '{' || s[0] === '[') {
        try {
            return JSON.parse(s) as T;
        } catch {
            return fallback;
        }
    }
    // New base64 payload.
    try {
        return JSON.parse(decodeURIComponent(escape(atob(s)))) as T;
    } catch {
        // Last resort: maybe it really was JSON that didn't start with a brace.
        try {
            return JSON.parse(s) as T;
        } catch {
            return fallback;
        }
    }
}

const placeCaretAtEnd = (el: HTMLElement) => {
    try {
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
    } catch {
        /* noop */
    }
};

const safeLinkHref = (raw: string): string | null => {
    const url = raw.trim();
    if (!url) return null;
    if (/^(https?:\/\/|mailto:|tel:|\/|#)/i.test(url)) return url;
    if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(url)) return `https://${url}`;
    return null;
};

// Inject (and keep up to date) the shared field styles: placeholder, focus ring,
// and list markers re-enabled past Tailwind's `list-style: none` preflight reset.
export function ensureRichTextStyles() {
    if (typeof document === 'undefined') return;
    const css = `
        .rich-text-field:empty:before { content: attr(data-placeholder); color: ${C.muted}; pointer-events: none; }
        .rich-text-box:focus-within { border-color: ${C.accent} !important; box-shadow: 0 0 0 1px ${C.accent}; }
        .rich-text-field img, .rich-text-html img { max-width: 100%; height: auto; border-radius: 4px; display: block; margin-left: auto; margin-right: auto; }
        /* Cap image height while EDITING so a tall image doesn't blow the field
           up to full size (which makes the page awkward to scroll). The stored /
           preview / learner output is unaffected — it uses the img's own inline
           max-width and renders at natural height. */
        .rich-text-field img { max-height: 360px; object-fit: contain; }
        .rich-text-field p, .rich-text-field div, .rich-text-html p, .rich-text-html div { margin: 0; }
        .rich-text-field ul, .rich-text-html ul { list-style: disc outside !important; margin: 4px 0; padding-left: 26px; }
        .rich-text-field ol, .rich-text-html ol { list-style: decimal outside !important; margin: 4px 0; padding-left: 26px; }
        .rich-text-field li, .rich-text-html li { display: list-item !important; margin: 2px 0; }
        .rich-text-field a, .rich-text-html a { color: ${C.accent}; text-decoration: underline; }
    `;
    let style = document.getElementById('rich-text-field-styles') as HTMLStyleElement | null;
    if (!style) {
        style = document.createElement('style');
        style.id = 'rich-text-field-styles';
        document.head.appendChild(style);
    }
    if (style.textContent !== css) style.textContent = css;
}

/** Renders stored rich-text HTML (preview / read-only states). */
export function RichTextHtml({ html, style }: { html: string; style?: React.CSSProperties }) {
    return (
        <div
            className="rich-text-html"
            style={style}
            dangerouslySetInnerHTML={{ __html: html || '' }}
        />
    );
}

export function RichTextField({
    value,
    onChange,
    placeholder,
    minHeight,
}: {
    value: string;
    onChange: (html: string) => void;
    placeholder?: string;
    minHeight?: number;
}) {
    const { t } = useTranslation('studyLibraryRichTextField');
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        ensureRichTextStyles();
    }, []);

    // Sync DOM only on an EXTERNAL value change (never our own keystrokes) so the
    // caret never jumps.
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        if (el.innerHTML === (value || '')) return;
        // While this field is focused, the contentEditable DOM is the source of
        // truth — NEVER overwrite it from `value`. `value` is derived from the DOM
        // via onInput, and the browser's innerHTML serialization of nodes like
        // <img> (attribute order/quotes, `&` → `&amp;` in the S3 URL) rarely
        // matches the stored string byte-for-byte, so re-assigning innerHTML on
        // each commit round-trip would re-create the <img> and re-download it —
        // a visible flicker. External changes (deserialize / programmatic) only
        // arrive while the field isn't focused, so syncing then is enough.
        if (document.activeElement === el) return;
        el.innerHTML = value || '';
    }, [value]);

    // Stop the outer Slate editor's NATIVE beforeinput/keydown from swallowing
    // Backspace/Delete inside this nested contentEditable. (Not `input`, so the
    // change is still captured.)
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const stopNative = (e: Event) => e.stopPropagation();
        el.addEventListener('beforeinput', stopNative);
        el.addEventListener('keydown', stopNative);
        el.addEventListener('keyup', stopNative);
        return () => {
            el.removeEventListener('beforeinput', stopNative);
            el.removeEventListener('keydown', stopNative);
            el.removeEventListener('keyup', stopNative);
        };
    }, []);

    const fire = () => {
        if (ref.current) onChange(ref.current.innerHTML);
    };

    const exec = (command: string, val?: string) => {
        const el = ref.current;
        if (!el) return;
        el.focus();
        document.execCommand(command, false, val);
        fire();
    };

    const insertLink = () => {
        const el = ref.current;
        if (!el) return;
        const raw = window.prompt(t('toolbar.linkPrompt'));
        if (!raw) return;
        const href = safeLinkHref(raw);
        if (!href) return;
        el.focus();
        document.execCommand('createLink', false, href);
        fire();
    };

    const insertImage = () => {
        const el = ref.current;
        if (!el) return;
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) return;
            const url = await uploadImage(file);
            const node = ref.current;
            if (!url || !node) return;
            node.focus();
            placeCaretAtEnd(node);
            document.execCommand(
                'insertHTML',
                false,
                // Centralised image styling: block-level, CENTERED, width-bounded.
                // Inline so it travels with the HTML to the learner and applies in
                // EVERY block (flashcard, tabs, columns, accordion, quiz) the same way.
                `<img src="${url.replace(/"/g, '&quot;')}" alt="" style="display:block; margin:10px auto; max-width:100%; height:auto;" />`
            );
            // A trailing image leaves no caret position after it — add an empty
            // line and move the caret into it so you can type below the image.
            const line = document.createElement('div');
            line.appendChild(document.createElement('br'));
            node.appendChild(line);
            try {
                const range = document.createRange();
                range.setStart(line, 0);
                range.collapse(true);
                const sel = window.getSelection();
                sel?.removeAllRanges();
                sel?.addRange(range);
            } catch {
                /* noop */
            }
            fire();
        };
        input.click();
    };

    const stop = (e: React.SyntheticEvent) => e.stopPropagation();

    const tbBtn = (
        label: string,
        onClick: () => void,
        title: string,
        extra?: React.CSSProperties
    ) => (
        <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onClick}
            title={title}
            style={{
                minWidth: '26px',
                height: '24px',
                padding: '0 6px',
                fontSize: '13px',
                border: 'none',
                borderRadius: '4px',
                backgroundColor: 'transparent',
                color: C.muted,
                cursor: 'pointer',
                ...extra,
            }}
            onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.backgroundColor = C.accentSoft;
            }}
            onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent';
            }}
        >
            {label}
        </button>
    );

    return (
        <div
            className="rich-text-box"
            style={{
                border: `1px solid ${C.border}`,
                borderRadius: '6px',
                overflow: 'hidden',
                backgroundColor: C.white,
            }}
        >
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '1px',
                    flexWrap: 'wrap',
                    padding: '3px 4px',
                    borderBottom: `1px solid ${C.border}`,
                    backgroundColor: C.surface,
                }}
            >
                {tbBtn('B', () => exec('bold'), t('toolbar.bold'), { fontWeight: 700 })}
                {tbBtn('I', () => exec('italic'), t('toolbar.italic'), { fontStyle: 'italic' })}
                {tbBtn('U', () => exec('underline'), t('toolbar.underline'), { textDecoration: 'underline' })}
                {tbBtn('•', () => exec('insertUnorderedList'), t('toolbar.bulletList'))}
                {tbBtn('1.', () => exec('insertOrderedList'), t('toolbar.numberedList'))}
                {tbBtn('🔗', insertLink, t('toolbar.insertLink'))}
                {tbBtn('🖼', insertImage, t('toolbar.insertImage'))}
            </div>

            <div
                ref={ref}
                contentEditable
                suppressContentEditableWarning
                className="rich-text-field"
                data-placeholder={placeholder || ''}
                onInput={fire}
                onBlur={fire}
                onKeyDown={stop}
                onKeyUp={stop}
                onMouseDown={stop}
                onPaste={stop}
                onCut={stop}
                onCopy={stop}
                onDrop={stop}
                style={{
                    minHeight: minHeight ? `${minHeight}px` : '40px',
                    padding: '8px 10px',
                    fontSize: '14px',
                    lineHeight: 1.5,
                    outline: 'none',
                    overflowWrap: 'anywhere',
                }}
            />
        </div>
    );
}
