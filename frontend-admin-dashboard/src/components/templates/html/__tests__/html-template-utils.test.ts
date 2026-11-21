import { describe, expect, it } from 'vitest';
import type { MessageTemplate } from '@/types/message-template-types';
import {
    THEME_COLOR_TOKEN,
    describeSelector,
    extractTemplateColors,
    extractVariables,
    isRawHtmlTemplate,
    normalizeHex,
    replaceTemplateColor,
    toPreviewHtml,
} from '../html-template-utils';

const template = (overrides: Partial<MessageTemplate>): MessageTemplate => ({
    id: 't1',
    name: 'Invoice',
    type: 'INVOICE',
    content: '<html><body>{{invoice_number}}</body></html>',
    variables: [],
    isDefault: false,
    createdAt: '',
    updatedAt: '',
    ...overrides,
});

const HTML = `<html><head><style>
    .bill-to-section { background-color: {{theme_color}}; color: #ffffff; }
    .items-table thead { background-color: #f78f1e; color: #FFF; }
    .footer-bar { background-color: {{theme_color}}; color: #ffffff; }
</style></head><body><p style="color:#f78f1e">Tom &#39;s &#128512; invoice</p></body></html>`;

describe('isRawHtmlTemplate', () => {
    it('is true only for an invoice template written as HTML with no builder design', () => {
        expect(isRawHtmlTemplate(template({}))).toBe(true);
        expect(isRawHtmlTemplate(template({ type: 'INVOICE_EMAIL' }))).toBe(true);
        expect(isRawHtmlTemplate(template({ mjml: '{"type":"page"}' }))).toBe(false);
        expect(isRawHtmlTemplate(template({}), '{"type":"page"}')).toBe(false);
        expect(isRawHtmlTemplate(template({ type: 'EMAIL' }))).toBe(false);
        expect(isRawHtmlTemplate(template({ content: '{"type":"page"}' }))).toBe(false);
        expect(isRawHtmlTemplate(null)).toBe(false);
    });
});

describe('extractTemplateColors', () => {
    it('lists each colour once, theme colour first, with the sections that use it', () => {
        const colors = extractTemplateColors(HTML);
        expect(colors[0]).toEqual({
            value: THEME_COLOR_TOKEN,
            count: 2,
            usedIn: ['.bill-to-section', '.footer-bar'],
        });
        const white = colors.find((c) => c.value === '#FFFFFF');
        expect(white?.count).toBe(3);
        const orange = colors.find((c) => c.value === '#F78F1E');
        expect(orange?.usedIn).toEqual(['.items-table thead', 'inline']);
    });

    it('does not mistake character references for colours', () => {
        const values = extractTemplateColors(HTML).map((c) => c.value);
        expect(values).not.toContain('#128512');
        expect(values).not.toContain('#39');
    });
});

describe('replaceTemplateColor', () => {
    it('changes every spelling of a colour and leaves the rest alone', () => {
        const out = replaceTemplateColor(HTML, '#FFFFFF', '#000000');
        expect(out).not.toMatch(/#fff\b/i);
        expect(out).not.toMatch(/#ffffff/i);
        expect(out.match(/#000000/g)?.length).toBe(3);
        expect(out).toContain('#f78f1e');
        expect(out).toContain('&#128512;');
    });

    it('can turn the theme colour placeholder into a fixed colour', () => {
        const out = replaceTemplateColor(HTML, THEME_COLOR_TOKEN, '#F5EAC9');
        expect(out).not.toContain(THEME_COLOR_TOKEN);
        expect(out.match(/#F5EAC9/g)?.length).toBe(2);
    });

    it('ignores anything that is not a full #RRGGBB colour', () => {
        expect(replaceTemplateColor(HTML, '#FFFFFF', '#12')).toBe(HTML);
    });
});

describe('preview and helpers', () => {
    it('shows conditional rows and the theme colour the PDF would print', () => {
        const html =
            '<style>.a{color:{{theme_color}}}</style>{{#if tax_registration_number}}<p>Tax: {{tax_registration_number}}</p>{{/if}}';
        expect(toPreviewHtml(html)).toBe(
            '<style>.a{color:#124a34}</style><p>Tax: {{tax_registration_number}}</p>'
        );
    });

    it('extracts placeholders once each, ignoring the conditional markers', () => {
        expect(extractVariables('{{a_b}} {{#if a_b}}{{c}}{{/if}} {{a_b}}')).toEqual([
            '{{a_b}}',
            '{{c}}',
        ]);
    });

    it('normalises and describes', () => {
        expect(normalizeHex('#abc')).toBe('#AABBCC');
        expect(describeSelector('.bill-to-section h2, .x')).toBe('bill to section h2');
        expect(describeSelector('inline')).toBe('inline');
    });
});
