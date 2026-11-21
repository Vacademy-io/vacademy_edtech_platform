/**
 * Shared reading of a message template's `{{…}}` placeholders.
 *
 * Meta approves WhatsApp templates with POSITIONAL placeholders — the approved body literally says
 * `Dear {{1}}` — and the human name for each one lives in `bodyVariableNames` at that index. An
 * admin picking a template out of a list learns nothing from `{{1}}`, so every preview surface
 * reads the body through here instead of printing `bodyText` raw.
 *
 * The placeholder pattern is deliberately identical to the one the send path interpolates
 * (`{{word}}`, no inner spaces). A looser pattern here would preview substitutions that the send
 * would not actually make.
 */

const PLACEHOLDER_SOURCE = '\\{\\{(\\w+)\\}\\}';

export interface TemplateTextContext {
    /** `bodyVariableNames` from the template — index 0 names `{{1}}`. */
    variableNames?: string[];
    /** Resolved values, keyed by variable name and/or by the raw token. */
    values?: Record<string, string>;
}

export type TemplatePart =
    | { kind: 'text'; text: string }
    | { kind: 'variable'; token: string; name: string; value?: string };

/** `"1"` → `"name"` when the template carries semantic names; otherwise the token itself. */
export function variableNameFor(token: string, variableNames?: string[]): string {
    const position = Number(token);
    if (Number.isInteger(position) && position > 0) {
        const name = variableNames?.[position - 1];
        if (name) return name;
    }
    return token;
}

/** Split a template body into literal runs and placeholders, each resolved where possible. */
export function splitTemplateText(
    text: string | undefined | null,
    context: TemplateTextContext = {}
): TemplatePart[] {
    if (!text) return [];
    const { variableNames, values } = context;
    const parts: TemplatePart[] = [];
    // A fresh regex per call — a shared /g regex carries `lastIndex` between calls and would skip
    // the first placeholder on every other body.
    const pattern = new RegExp(PLACEHOLDER_SOURCE, 'g');
    let cursor = 0;
    let match: RegExpExecArray | null = pattern.exec(text);
    while (match !== null) {
        if (match.index > cursor) {
            parts.push({ kind: 'text', text: text.slice(cursor, match.index) });
        }
        const token = match[1] ?? '';
        const name = variableNameFor(token, variableNames);
        parts.push({ kind: 'variable', token, name, value: values?.[name] ?? values?.[token] });
        cursor = match.index + match[0].length;
        match = pattern.exec(text);
    }
    if (cursor < text.length) parts.push({ kind: 'text', text: text.slice(cursor) });
    return parts;
}

/**
 * The body as one readable string: resolved values where they exist, `[name]` where they don't.
 * For one-line contexts (list rows, summaries) that cannot render chips.
 */
export function humanizeTemplateText(
    text: string | undefined | null,
    context: TemplateTextContext = {}
): string {
    return splitTemplateText(text, context)
        .map((part) => {
            if (part.kind === 'text') return part.text;
            return part.value?.trim() ? part.value : `[${part.name}]`;
        })
        .join('');
}

const ENTITIES: Record<string, string> = {
    '&nbsp;': ' ',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
};

/**
 * Flatten template content down to plain text for a list row.
 *
 * Email templates carry HTML, so the tags come out and their entities are decoded — an admin
 * scanning the list should read “Dear Priya”, not `Dear&nbsp;Priya`. Line breaks survive (collapsed
 * to at most one blank line) because a WhatsApp body's paragraphs are most of its shape.
 */
export function flattenTemplateBody(raw: string | undefined | null): string {
    if (!raw) return '';
    return raw
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
        .replace(/<[^>]*>/g, ' ')
        .replace(
            /&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;|&apos;/g,
            (entity) => ENTITIES[entity] ?? entity
        )
        .replace(/[ \t]+/g, ' ')
        .split('\n')
        .map((line) => line.trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

const UPLOAD_KEY_PREFIX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i;

/**
 * The file name a media URL points at, as WhatsApp will show it on a document bubble.
 *
 * Uploads are stored as `<uuid>-<original name>`, so the uuid comes off; query strings and hashes
 * are not part of the name. Empty when the URL carries no usable name — the caller shows its
 * generic "Document" label then.
 */
export function mediaFileName(url: string | undefined | null): string {
    if (!url) return '';
    let path = url.split('#')[0] ?? '';
    path = path.split('?')[0] ?? '';
    let segment = path.slice(path.lastIndexOf('/') + 1);
    try {
        // Form-decoding would turn a literal '+' into a space; shield it first.
        segment = decodeURIComponent(segment.replace(/\+/g, '%2B'));
    } catch {
        // Malformed escape: keep the raw segment.
    }
    segment = segment.slice(segment.lastIndexOf('/') + 1);
    return segment.replace(UPLOAD_KEY_PREFIX, '').trim();
}
