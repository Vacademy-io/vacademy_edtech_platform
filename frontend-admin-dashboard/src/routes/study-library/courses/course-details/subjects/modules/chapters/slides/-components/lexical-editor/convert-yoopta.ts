import { createEditor } from 'lexical';
import i18n from '@/i18n';
import { editorNodes, editorTheme, onEditorError } from './editor-config';
import { importDocHtml, exportDocHtml } from './serialization';

/** Namespace holding this module's user-visible copy (see studyLibraryConvertYoopta.json).
 *  Read via the i18next singleton, not useTranslation(): this file runs pure
 *  functions with no React context (see the ConvertToLexicalDialog caller). */
const NS = 'studyLibraryConvertYoopta';

/**
 * Opt-in "convert to new editor" pre-flight for an existing Yoopta document.
 *
 * Runs the Yoopta HTML through the Lexical import → export round-trip in a
 * detached (headless) editor and diffs the result against the source to decide
 * whether the conversion is lossless. If it is, the caller persists the
 * round-tripped (marker-bearing) HTML so the slide re-routes to Lexical.
 *
 * The round-trip is the same code path a real save takes, so "clean here" ==
 * "clean when the user later edits + saves in Lexical".
 */

export interface ConversionAnalysis {
    /** The Lexical round-tripped HTML (marker-wrapped) to persist on convert. */
    convertedHtml: string;
    /** True when no hard data loss was detected (blocks, media, or text). */
    safe: boolean;
    /** Custom block types / structural elements present in the source but
     *  dropped by the round-trip (hard loss). */
    lostBlocks: string[];
    /** Media URLs (img/video/iframe/audio src, link href, pdf url) present in
     *  the source but missing after the round-trip (hard loss). */
    lostMedia: string[];
    /** True when the visible non-block text changed (hard loss). */
    textChanged: boolean;
    /** Soft notes: inline styling (colour, alignment, size) the new editor may
     *  not carry over. Not blocking — cosmetic. */
    formattingWarnings: string[];
}

/** Subtrees opaque to the plain-text / formatting comparison — their fidelity
 *  is covered by block counts, not visible text, which differs by design
 *  between the two editors' static fallback bodies. `dl` and `pre` are Yoopta's
 *  callout and code shapes on the SOURCE side; their converted counterparts
 *  carry data-yoopta-type / <pre>, so both sides must be excluded symmetrically. */
const CUSTOM_BLOCK_SELECTOR = '[data-yoopta-type],div.mermaid,pre,dl';

/** Yoopta checkbox text markers (`[x] `/`[ ] `) — editor syntax, not content;
 *  stripped before the word comparison so a converted checklist (marker gone)
 *  doesn't read as text loss vs the source. */
const CHECK_MARKER_RE = /\[[xX ]\]/g;

function parse(html: string): Document {
    return new DOMParser().parseFromString(html || '', 'text/html');
}

/** Count structural blocks by kind (custom type, mermaid, table, media). */
function blockCounts(doc: Document): Map<string, number> {
    const counts = new Map<string, number>();
    const bump = (k: string) => counts.set(k, (counts.get(k) ?? 0) + 1);
    doc.querySelectorAll('[data-yoopta-type]').forEach((el) =>
        bump(`type:${el.getAttribute('data-yoopta-type') || 'unknown'}`)
    );
    // Yoopta callouts serialize as <dl>; converted ones are
    // data-yoopta-type="callout" (counted above). Align them so a dropped
    // callout is caught.
    doc.querySelectorAll('dl').forEach(() => bump('type:callout'));
    doc.querySelectorAll('div.mermaid').forEach(() => bump('mermaid'));
    doc.querySelectorAll('table').forEach(() => bump('table'));
    doc.querySelectorAll('img[src]').forEach((el) => {
        const src = el.getAttribute('src');
        if (src && src !== 'null' && src !== 'undefined') bump('img');
    });
    doc.querySelectorAll('video, iframe').forEach(() => bump('media-embed'));
    return counts;
}

/** Collect the media/link URLs that carry real content (must survive). */
function mediaUrls(doc: Document): Set<string> {
    const urls = new Set<string>();
    const add = (u: string | null) => {
        if (u && u !== 'null' && u !== 'undefined' && !u.startsWith('data:')) urls.add(u.trim());
    };
    doc.querySelectorAll('img').forEach((el) => add(el.getAttribute('src')));
    doc.querySelectorAll('video').forEach((el) => {
        add(el.getAttribute('src'));
        el.querySelectorAll('source').forEach((s) => add(s.getAttribute('src')));
    });
    doc.querySelectorAll('audio').forEach((el) => add(el.getAttribute('src')));
    doc.querySelectorAll('iframe').forEach((el) => add(el.getAttribute('src')));
    doc.querySelectorAll('a[href]').forEach((el) => add(el.getAttribute('href')));
    doc.querySelectorAll('[data-pdf-url]').forEach((el) => add(el.getAttribute('data-pdf-url')));
    return urls;
}

/** Word multiset of the visible text OUTSIDE custom-block subtrees.
 *
 *  A boundary space is injected at every block edge first, because
 *  `textContent` concatenates block text with NO separator — so the two
 *  editors' differing inter-block whitespace (Yoopta pretty-prints with
 *  newlines; Lexical emits compact HTML) would otherwise make identical text
 *  look different (`"A B"` vs `"AB"`). Custom blocks are excluded because the
 *  two editors emit different static fallback bodies for the same payload. */
const BLOCK_TAGS =
    'p,div,h1,h2,h3,h4,h5,h6,li,tr,td,th,blockquote,pre,summary,figure,figcaption,section,article,header,footer,ul,ol,table';

function nonBlockWordCounts(doc: Document): Map<string, number> {
    const clone = doc.body.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(CUSTOM_BLOCK_SELECTOR).forEach((el) => el.remove());
    // Line breaks and block edges become explicit spaces so words never fuse.
    clone.querySelectorAll('br').forEach((br) => br.replaceWith(' '));
    clone.querySelectorAll(BLOCK_TAGS).forEach((el) => el.append(' '));
    const counts = new Map<string, number>();
    const text = (clone.textContent || '').replace(CHECK_MARKER_RE, ' ');
    for (const word of text.split(/\s+/)) {
        if (word) counts.set(word, (counts.get(word) ?? 0) + 1);
    }
    return counts;
}

/** Detect inline styling in the source (outside custom blocks) that the new
 *  editor's default nodes may not preserve. */
function formattingWarnings(sourceDoc: Document, convertedDoc: Document): string[] {
    const warnings: string[] = [];
    const strip = (doc: Document) => {
        const clone = doc.body.cloneNode(true) as HTMLElement;
        clone.querySelectorAll(CUSTOM_BLOCK_SELECTOR).forEach((el) => el.remove());
        return clone;
    };
    const src = strip(sourceDoc);
    const conv = strip(convertedDoc);
    const srcHtml = src.innerHTML;
    const convHtml = conv.innerHTML;

    const checks: Array<[RegExp, string]> = [
        [/(?:^|[;"\s])color\s*:/i, i18n.t(`${NS}:formatting.textColour`)],
        [/background(?:-color)?\s*:/i, i18n.t(`${NS}:formatting.backgroundColour`)],
        [/text-align\s*:\s*(?:center|right|justify)/i, i18n.t(`${NS}:formatting.textAlignment`)],
        [/font-size\s*:/i, i18n.t(`${NS}:formatting.customFontSizes`)],
    ];
    for (const [re, label] of checks) {
        if (re.test(srcHtml) && !re.test(convHtml)) warnings.push(label);
    }
    // Inline marks that Lexical does preserve are fine; only flag if the source
    // had them and the conversion dropped them entirely.
    const hasMark = (h: string) => /<(mark|u|s|strike)\b/i.test(h);
    if (hasMark(srcHtml) && !hasMark(convHtml))
        warnings.push(i18n.t(`${NS}:formatting.highlightUnderlineStrikethrough`));
    return warnings;
}

/** Run the round-trip and diff. Pure/among the browser (uses DOMParser +
 *  document); safe to call client-side without mounting anything. */
export function analyzeConversion(sourceHtml: string): ConversionAnalysis {
    // Headless editor with the full custom-node registry so importDOM matchers
    // and exportDOM run exactly as in the live editor.
    const editor = createEditor({
        namespace: 'yoopta-convert-check',
        nodes: editorNodes,
        theme: editorTheme,
        onError: onEditorError,
    });

    let convertedHtml = '';
    try {
        importDocHtml(editor, sourceHtml);
        convertedHtml = exportDocHtml(editor);
    } catch (e) {
        console.error('[Lexical] conversion round-trip failed:', e);
        return {
            convertedHtml: '',
            safe: false,
            lostBlocks: [i18n.t(`${NS}:conversionFailed`)],
            lostMedia: [],
            textChanged: false,
            formattingWarnings: [],
        };
    }

    const srcDoc = parse(sourceHtml);
    const convDoc = parse(convertedHtml);

    // Block loss
    const before = blockCounts(srcDoc);
    const after = blockCounts(convDoc);
    const lostBlocks: string[] = [];
    before.forEach((count, key) => {
        if ((after.get(key) ?? 0) < count) {
            lostBlocks.push(key.startsWith('type:') ? key.slice(5) : key);
        }
    });

    // Media loss
    const beforeUrls = mediaUrls(srcDoc);
    const afterUrls = mediaUrls(convDoc);
    const lostMedia: string[] = [];
    beforeUrls.forEach((u) => {
        if (!afterUrls.has(u)) lostMedia.push(u);
    });

    // Text loss (outside custom blocks): flag only when the source has words
    // the conversion actually dropped — added words / reflow don't count as
    // loss, and boundary-aware counting ignores inter-block whitespace diffs.
    const srcWords = nonBlockWordCounts(srcDoc);
    const convWords = nonBlockWordCounts(convDoc);
    let textChanged = false;
    srcWords.forEach((count, word) => {
        if ((convWords.get(word) ?? 0) < count) textChanged = true;
    });

    const safe = lostBlocks.length === 0 && lostMedia.length === 0 && !textChanged;

    return {
        convertedHtml,
        safe,
        lostBlocks,
        lostMedia,
        textChanged,
        formattingWarnings: formattingWarnings(srcDoc, convDoc),
    };
}

/**
 * For freshly-created content (docx/doc uploads): return the Lexical-routed
 * (marker-bearing) HTML when the round-trip is lossless, else null so the
 * caller keeps the original HTML on the legacy editor. Uploads should open in
 * the new editor by default, but never at the cost of silently dropping a
 * table / image / block the uploaded document actually had.
 */
export function docHtmlToLexicalIfSafe(sourceHtml: string): string | null {
    if (!sourceHtml || !sourceHtml.trim()) return null;
    try {
        const a = analyzeConversion(sourceHtml);
        return a.safe && a.convertedHtml ? a.convertedHtml : null;
    } catch (e) {
        console.error('[Lexical] upload→lexical pre-flight failed:', e);
        return null;
    }
}
