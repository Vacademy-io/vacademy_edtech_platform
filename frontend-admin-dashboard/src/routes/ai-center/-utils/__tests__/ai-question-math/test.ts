import { describe, it, expect } from 'vitest';
import { convertSVGsToBase64 } from '../../helper';
import { processHtmlString } from '@/components/common/export-offline/utils/utils';

// processHtmlString also emits the `<br/>` it inserts between block elements;
// only the substantive parts matter here.
const meaningful = (html: string) =>
    processHtmlString(html).filter(
        (p) => p.type !== 'text' || (p.content.trim() !== '' && p.content.trim() !== '<br/>')
    );

// convertSVGsToBase64 takes the caller's `t` only for image alt text.
const t = ((key: string) => key) as unknown as Parameters<typeof convertSVGsToBase64>[1];

const latexOf = (html: string) =>
    Array.from(
        new DOMParser().parseFromString(html, 'text/html').querySelectorAll('[data-latex]')
    ).map((el) => el.getAttribute('data-latex'));

// The content below is what the topic generator actually stores — `\(…\)`
// delimiters, which the AI-center preview used to print verbatim because its
// hand-rolled converter only knew about `$…$`.
describe('AI question content — maths in the preview', () => {
    it('converts the \\(…\\) options from the Functions and Logarithms paper', () => {
        const out = convertSVGsToBase64(String.raw`\(\{(2,1),(2,2),(2,3),(2,4)\}\)`, t);
        expect(latexOf(out)).toEqual([String.raw`\{(2,1),(2,2),(2,3),(2,4)\}`]);
        expect(out).toContain('katex');
        expect(out).not.toContain('\\(');
    });

    it('converts \\(…\\) spans embedded in a sentence', () => {
        const out = convertSVGsToBase64(
            String.raw`If \(X=\{a,b,c\}\) and \(Y=\{\alpha,\beta\}\), which subset of \(X \times Y\) is a function?`,
            t
        );
        expect(latexOf(out)).toEqual([
            String.raw`X=\{a,b,c\}`,
            String.raw`Y=\{\alpha,\beta\}`,
            String.raw`X \times Y`,
        ]);
    });

    it('still converts $…$ content', () => {
        expect(
            latexOf(convertSVGsToBase64('The function $f(x) = x^{-2} + x^{-3}$ is:', t))
        ).toEqual(['f(x) = x^{-2} + x^{-3}']);
    });

    // Content that has been through the editor can arrive with the KaTeX markup
    // escaped into visible text; `data-latex` is the source of truth, so the node
    // is rebuilt rather than shown as markup.
    it('rebuilds a math node whose KaTeX markup was escaped into text', () => {
        const out = convertSVGsToBase64(
            '<span class="math-inline" data-latex="x^2">&lt;span class="katex"&gt;junk&lt;/span&gt;</span>',
            t
        );
        expect(out).not.toContain('&lt;span');
        expect(out).toContain('katex');
        expect(latexOf(out)).toEqual(['x^2']);
    });

    it('drops a math node that carries no latex instead of rendering empty maths', () => {
        expect(convertSVGsToBase64('<div class="math-block" data-latex=""></div>', t)).toBe('');
    });
});

describe('AI question content — maths in the PDF export', () => {
    it('renders \\(…\\) as a formula instead of printing the delimiters', () => {
        const parts = meaningful(String.raw`<p>Find x if \(\log_{0.2}(x-1)\) holds.</p>`);
        expect(parts.map((p) => p.type)).toEqual(['text', 'formula', 'text']);
        expect(parts[1]!.content).toContain('katex');
        expect(parts.map((p) => p.content).join('')).not.toContain('\\(');
    });

    it('renders \\[…\\] as display maths', () => {
        const parts = meaningful(String.raw`<p>\[x^2 + 1\]</p>`);
        expect(parts.map((p) => p.type)).toEqual(['formula']);
        expect(parts[0]!.content).toContain('katex-display');
    });

    it('renders a math node from its data-latex, in display mode for math-block', () => {
        const parts = meaningful('<div class="math-block" data-latex="x^2"></div>');
        expect(parts.map((p) => p.type)).toEqual(['formula']);
        expect(parts[0]!.content).toContain('katex-display');
    });
});
