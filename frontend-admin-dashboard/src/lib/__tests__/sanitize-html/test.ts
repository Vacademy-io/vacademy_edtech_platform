// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import katex from 'katex';
import { sanitizeRichHtml } from '@/lib/sanitize-html';

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html').body;

describe('sanitizeRichHtml', () => {
    it('strips script, event handlers and javascript: URLs', () => {
        const out = sanitizeRichHtml(
            '<p>Q1</p><img src="x" onerror="alert(1)"><script>alert(2)</script>' +
                '<a href="javascript:alert(3)">link</a><svg onload="alert(4)"></svg>'
        );
        expect(out).not.toMatch(/onerror|onload|<script|javascript:/i);
        expect(out).toContain('<p>Q1</p>');
    });

    it('drops form controls and fixed positioning (fake login overlays)', () => {
        const out = sanitizeRichHtml(
            '<div style="position: fixed; inset: 0; color: red">Session expired' +
                '<form action="https://evil.example"><input type="password" name="p">' +
                '<select><option>a</option></select><textarea>t</textarea>' +
                '<button>Log in</button></form></div>'
        );
        expect(out).not.toMatch(/<(form|input|button|textarea|select|option)\b|evil\.example/i);
        expect(out).not.toMatch(/position/i);
        expect(out).toMatch(/color: red/);
        expect(out).toContain('Session expired');
    });

    it('forces rel=noopener on links that set a target', () => {
        const out = parse(
            sanitizeRichHtml(
                '<a href="https://example.com" target="_blank">l</a><a href="/x">m</a>'
            )
        );
        const [withTarget, plain] = Array.from(out.querySelectorAll('a'));
        expect(withTarget?.getAttribute('target')).toBe('_blank');
        expect(withTarget?.getAttribute('rel')).toBe('noopener noreferrer');
        expect(plain?.hasAttribute('rel')).toBe(false);
    });

    it('returns an empty string for empty input', () => {
        expect(sanitizeRichHtml('')).toBe('');
        expect(sanitizeRichHtml(null)).toBe('');
        expect(sanitizeRichHtml(undefined)).toBe('');
    });

    it('keeps what the editor emits: tables, lists, images, media, styles, links', () => {
        const html =
            '<p style="text-align: center"><span style="color: #ff0000">red</span></p>' +
            '<ol><li>one</li></ol>' +
            '<table><tbody><tr><td colspan="2">cell</td></tr></tbody></table>' +
            '<img src="https://cdn.example.com/a.png" alt="fig" width="200">' +
            '<audio controls="" src="https://cdn.example.com/a.mp3"></audio>' +
            '<a href="https://example.com" target="_blank" rel="noopener noreferrer">l</a>';
        expect(parse(sanitizeRichHtml(html)).innerHTML).toBe(parse(html).innerHTML);
    });

    it('keeps TipTap math nodes and their pre-rendered KaTeX', () => {
        const latex = '\\frac{a}{b}^2';
        const html = `<p><span class="math-inline" data-latex="${latex}">${katex.renderToString(
            latex,
            { throwOnError: false }
        )}</span></p>`;
        const out = parse(sanitizeRichHtml(html));
        const original = parse(html);

        expect(out.querySelector('span.math-inline')?.getAttribute('data-latex')).toBe(latex);
        // The visible KaTeX tree is untouched.
        expect(out.querySelector('.katex-html')?.outerHTML).toBe(
            original.querySelector('.katex-html')?.outerHTML
        );
        // MathML survives; the LaTeX annotation is dropped, not leaked as text.
        expect(out.querySelector('math')).not.toBeNull();
        expect(out.querySelector('.katex-mathml')?.textContent).not.toContain('\\frac');
    });
});
