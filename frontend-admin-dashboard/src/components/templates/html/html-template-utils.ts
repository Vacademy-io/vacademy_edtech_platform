import type { MessageTemplate } from '@/types/message-template-types';

/** Placeholder the backend fills with the institute's theme colour when it renders an invoice. */
export const THEME_COLOR_TOKEN = '{{theme_color}}';

/** What the backend currently puts in {{theme_color}}, so the preview matches the PDF. */
export const THEME_COLOR_DEFAULT = '#124a34';

const INVOICE_TYPES: MessageTemplate['type'][] = ['INVOICE', 'INVOICE_EMAIL'];

/**
 * An invoice template written as plain HTML rather than in the drag-and-drop builder: no saved
 * builder design (`mjml`) and content that is markup. The builder cannot open these: it shows a
 * blank page, and saving that page would replace the template, so they get the HTML editor.
 */
export function isRawHtmlTemplate(
    template: MessageTemplate | null,
    legacyBuilderDesign?: string | null
): boolean {
    if (!template || !INVOICE_TYPES.includes(template.type)) return false;
    if (template.mjml || legacyBuilderDesign) return false;
    return typeof template.content === 'string' && template.content.trim().startsWith('<');
}

/** `#abc` / `#AABBCC` → `#AABBCC`. */
export function normalizeHex(hex: string): string {
    const body = hex.replace('#', '');
    const full =
        body.length === 3
            ? body
                  .split('')
                  .map((c) => c + c)
                  .join('')
            : body;
    return `#${full.toUpperCase()}`;
}

// A colour literal (group 2), with the character before it in group 1: not the numeric character
// reference in "&#128512;", which also starts with '#' followed by digits, and not part of a longer
// word. Written without a lookbehind, which older Safari cannot parse at all.
const HEX_COLOR = /(^|[^&\w])(#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3}))(?![0-9a-zA-Z])/g;

export interface TemplateColor {
    /** Normalised `#RRGGBB`, or {@link THEME_COLOR_TOKEN} for the institute theme colour. */
    value: string;
    /** How many times it appears in the template. */
    count: number;
    /** CSS selectors (or "inline") that use it, so the admin can tell which section it paints. */
    usedIn: string[];
}

/** Every distinct colour in the template, most used first, the theme colour token first of all. */
export function extractTemplateColors(html: string): TemplateColor[] {
    const colors = new Map<string, TemplateColor>();
    const add = (value: string, where: string) => {
        const entry = colors.get(value) ?? { value, count: 0, usedIn: [] };
        entry.count += 1;
        if (where && !entry.usedIn.includes(where)) entry.usedIn.push(where);
        colors.set(value, entry);
    };

    // Colours inside <style> rules are attributed to their selector. Placeholders are swapped for
    // brace-free markers first, because "{{theme_color}}" inside a rule would end it early.
    const styleBlocks = html.match(/<style[^>]*>[\s\S]*?<\/style>/gi) ?? [];
    for (const block of styleBlocks) {
        const css = block.replace(/\{\{([^{}]*)\}\}/g, '⟦$1⟧');
        for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
            const selector = (rule[1] ?? '')
                .replace(/<style[^>]*>/i, '')
                .replace(/\s+/g, ' ')
                .trim();
            const body = rule[2] ?? '';
            for (const m of body.matchAll(HEX_COLOR)) add(normalizeHex(m[2] ?? ''), selector);
            const themeHits = body.split('⟦theme_color⟧').length - 1;
            for (let i = 0; i < themeHits; i++) add(THEME_COLOR_TOKEN, selector);
        }
    }

    // Everything outside <style> (inline style attributes) counts as "inline".
    const outside = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    for (const m of outside.matchAll(HEX_COLOR)) add(normalizeHex(m[2] ?? ''), 'inline');
    const inlineTheme = outside.split(THEME_COLOR_TOKEN).length - 1;
    for (let i = 0; i < inlineTheme; i++) add(THEME_COLOR_TOKEN, 'inline');

    return [...colors.values()].sort((a, b) => {
        if (a.value === THEME_COLOR_TOKEN) return -1;
        if (b.value === THEME_COLOR_TOKEN) return 1;
        return b.count - a.count;
    });
}

/** Replaces every occurrence of one colour (any spelling of it, or the theme token) with `to`. */
export function replaceTemplateColor(html: string, from: string, to: string): string {
    if (!/^#[0-9a-fA-F]{6}$/.test(to)) return html;
    if (from === THEME_COLOR_TOKEN) return html.split(THEME_COLOR_TOKEN).join(to);
    const target = normalizeHex(from);
    return html.replace(HEX_COLOR, (match, prefix: string, color: string) =>
        normalizeHex(color) === target ? `${prefix}${to}` : match
    );
}

/**
 * What the editor's preview iframe shows: the theme colour as the PDF would print it, and the
 * `{{#if key}}` / `{{/if}}` markers removed so conditional rows show instead of template syntax.
 * Other placeholders stay visible, so the admin can see where each value lands.
 */
export function toPreviewHtml(html: string): string {
    return html
        .split(THEME_COLOR_TOKEN)
        .join(THEME_COLOR_DEFAULT)
        .replace(/\{\{#if\s+[a-zA-Z0-9_]+\s*\}\}/g, '')
        .replace(/\{\{\/if\}\}/g, '');
}

/** The `{{placeholder}}` tokens a template uses, as the template APIs store them. */
export function extractVariables(html: string): string[] {
    return [...new Set(html.match(/\{\{[a-z_][a-z0-9_]*\}\}/g) ?? [])];
}

/** Readable label for a CSS selector: ".bill-to-section h2" → "bill to section h2". */
export function describeSelector(selector: string): string {
    if (selector === 'inline') return selector;
    return selector.split(',')[0]!.replace(/[.#]/g, '').replace(/[-_]/g, ' ').trim();
}
