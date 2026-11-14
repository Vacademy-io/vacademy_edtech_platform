import { describe, it, expect } from 'vitest';
import { renderLatexDelimiters } from '@/lib/latex-delimiters';

const latexOf = (html: string) =>
    Array.from(
        new DOMParser().parseFromString(html, 'text/html').querySelectorAll('[data-latex]')
    ).map((el) => `${el.className}:${el.getAttribute('data-latex')}`);

describe('renderLatexDelimiters', () => {
    it('converts the option formulas from the JEE paper', () => {
        const out = renderLatexDelimiters('$$[Co(en)_2Cl_2]^+}$$');
        expect(latexOf(out)).toEqual(['math-inline:[Co(en)_2Cl_2]^+']); // stray brace dropped
        expect(out).toContain('katex');
        expect(out).not.toContain('$$');
    });

    it('keeps well-formed braces', () => {
        expect(latexOf(renderLatexDelimiters('$$[Co(en)_3]^{3+}$$'))).toEqual([
            'math-inline:[Co(en)_3]^{3+}',
        ]);
    });

    it('converts inline math inside a sentence', () => {
        const out = renderLatexDelimiters(
            '<p>Among the given options, only $Co(NH_3)_3Cl_3$ fits this general formula ($a = NH_3$, $b = Cl$).</p>'
        );
        expect(latexOf(out)).toEqual([
            'math-inline:Co(NH_3)_3Cl_3',
            'math-inline:a = NH_3',
            'math-inline:b = Cl',
        ]);
        expect(out).toContain('Among the given options, only');
    });

    it('centres real display equations that stand alone', () => {
        expect(
            latexOf(renderLatexDelimiters('<p>$$\\int_0^1 x^2 dx = \\frac{1}{3}$$</p>'))
        ).toEqual(['math-block:\\int_0^1 x^2 dx = \\frac{1}{3}']);
    });

    it('converts a coordinate pair or a bare arithmetic expression', () => {
        // SN Class 9 maths, Q18: "If $(2,0)$ is a solution …" stayed as source.
        const point = renderLatexDelimiters(
            '<p>If $(2,0)$ is a solution of $2x+3y=k$, find k.</p>'
        );
        expect(point).toContain('data-latex="(2,0)"');
        expect(point).toContain('data-latex="2x+3y=k"');
        expect(point).not.toContain('$');
        expect(renderLatexDelimiters('<p>So $2+2$ is four.</p>')).toContain('data-latex="2+2"');
    });

    it('leaves prices and plain prose alone', () => {
        const money = '<p>Plans cost $5 and $10 per month.</p>';
        expect(renderLatexDelimiters(money)).toBe(money);
        const range = '<p>Budget $5-$10 per learner.</p>';
        expect(renderLatexDelimiters(range)).toBe(range);
        const sentence = '<p>Pay $99 today, then $199 later.</p>';
        expect(renderLatexDelimiters(sentence)).toBe(sentence);
        const prose = '<p>Which organelle is the powerhouse of the cell?</p>';
        expect(renderLatexDelimiters(prose)).toBe(prose);
    });

    it('leaves code blocks and already-converted math alone', () => {
        const code = '<pre><code>const price = `$${x_1}`;</code></pre>';
        expect(renderLatexDelimiters(code)).toBe(code);
        const already = '<span class="math-inline" data-latex="x^2">x^2</span>';
        expect(renderLatexDelimiters(already)).toBe(already);
    });

    it('handles \\( \\) and \\[ \\] delimiters', () => {
        expect(
            latexOf(renderLatexDelimiters('<p>Given \\(x^2 + y^2 = r^2\\) find r.</p>'))
        ).toEqual(['math-inline:x^2 + y^2 = r^2']);
    });

    it('passes through empty / null content', () => {
        expect(renderLatexDelimiters('')).toBe('');
        expect(renderLatexDelimiters(null)).toBe('');
    });

    it('leaves escaped braces alone (\\left\\{ … \\right.)', () => {
        const tex = String.raw`g(x)=\left\{\begin{array}{ll}k \sqrt{x+1}, & 0 \leq x \leq 3 \\ mx+2, & 3<x \leq 5\end{array}\right.`;
        // As stored by the paper converter: "<" inside the formula is "&lt;".
        const out = renderLatexDelimiters(
            `<p>If the function, $${tex.replace('<', '&lt;')}$ is differentiable</p>`
        );
        expect(latexOf(out)).toEqual([`math-inline:${tex}`]);
        expect(out).not.toContain('katex-error');
    });

    // The question-paper converter wraps display maths as
    // `<div class="math-block">$$ … $$</div>` — the editor's class, but with no
    // data-latex. It used to be skipped here and then dropped as an empty formula.
    it('renders a converter math-block wrapper instead of skipping it', () => {
        const body = String.raw`\begin{aligned}
& \text { So, } 52 m+42 f=50(m+f) \\
& \Rightarrow m=4 f
\end{aligned}`;
        const out = renderLatexDelimiters(`<p>Sum of ages</p><div class="math-block">$$
${body}
$$</div><p>Let the total be 100.</p>`);
        expect(latexOf(out)).toEqual([`math-block:${body}`]);
        expect(out).not.toContain('$$');
        expect(out).not.toContain('katex-error');
        expect(out).toContain('Let the total be 100.');
    });

    it('keeps an editor math node (it has data-latex) as it is', () => {
        const html = '<div class="math-block" data-latex="x^2"><span class="katex">x2</span></div>';
        expect(renderLatexDelimiters(`<p>$y$</p>${html}`)).toContain(html);
    });

    it('keeps a math-block that already holds a rendered formula', () => {
        const html = '<div class="math-block"><span class="katex">$x$</span></div>';
        expect(renderLatexDelimiters(`<p>$y$</p>${html}`)).toContain(html);
    });
});
