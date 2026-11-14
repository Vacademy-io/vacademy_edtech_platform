import katex from 'katex';

/**
 * AI-generated (and LaTeX-pasted) question content stores math as plain text with
 * dollar/bracket delimiters — `$$[Co(NH_3)_3Cl_3]$$`, `$Ma_3b_3$`, `\(x^2\)`.
 *
 * The rich-text editor only renders math it can recognise as `.math-inline` /
 * `.math-block` markup, so anything still carrying delimiters is shown verbatim.
 * This converts those spans into that markup, pre-rendered with KaTeX so that
 * consumers which simply dump the HTML also show real math.
 */

// A `$…$` body must look like math before we touch it. The delimiters already
// have to hug non-space characters, which rules out most currency prose
// ("$5 and $10 each"); on top of that we want either a LaTeX marker or a short,
// word-bearing fragment such as `b = Cl`, never a bare amount like `5-`.
const LATEX_SIGNAL = /[\\^_{}]/;
const SHORT_MATH_FRAGMENT = /^(?=.{1,30}$).*[a-zA-Z].*$/s;
// A coordinate pair or a bare arithmetic expression — `$(2,0)$`, `$2+2$` — is
// maths too, letters or not; a price never comes bracketed or with an operator.
const NUMERIC_EXPRESSION = /^[([].*[)\]]$|[=+×÷<>≤≥]/;

const looksLikeMath = (body: string) =>
    LATEX_SIGNAL.test(body) || SHORT_MATH_FRAGMENT.test(body) || NUMERIC_EXPRESSION.test(body);

// Only these constructs are worth centring as display math; short chemistry /
// symbol fragments read better inline even when authored with `$$`.
const DISPLAY_HINT = /\\(frac|dfrac|tfrac|int|iint|oint|sum|prod|lim|begin|substack)|\\\\/;

// $$…$$ | \[…\] | $…$ (no space just inside) | \(…\)
const DELIMITED = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\$(\S|\S[^$\n]*\S)\$|\\\(([\s\S]+?)\\\)/g;

const SKIP_TAGS = new Set(['CODE', 'PRE', 'SCRIPT', 'STYLE', 'TEXTAREA']);

/**
 * Drops unmatched closing braces and closes unmatched opening ones. Some stored
 * content has lost a brace along the way (`[Co(en)_2Cl_2]^+}`); without this
 * KaTeX renders the whole formula as a red parse error instead of the intended
 * superscript.
 */
function balanceBraces(tex: string): string {
    let depth = 0;
    let out = '';
    for (let i = 0; i < tex.length; i++) {
        const ch = tex[i];
        // `\{` / `\}` are literal braces (`\left\{ … \right.`), and `\\` is a
        // row break whose second backslash must not escape the next brace.
        if (ch === '\\') {
            out += ch + (tex[i + 1] ?? '');
            i++;
            continue;
        }
        if (ch === '{') {
            depth++;
        } else if (ch === '}') {
            if (depth === 0) continue; // unmatched closer — drop it
            depth--;
        }
        out += ch;
    }
    return out + '}'.repeat(depth);
}

function collectTextNodes(node: Node, out: Text[]): void {
    node.childNodes.forEach((child) => {
        if (child.nodeType === 3) {
            out.push(child as Text);
            return;
        }
        if (child.nodeType !== 1) return;
        const el = child as Element;
        if (SKIP_TAGS.has(el.tagName)) return;
        if (el.classList.contains('math-inline') || el.classList.contains('math-block')) return;
        collectTextNodes(el, out);
    });
}

function createMathNode(doc: Document, latex: string, displayMode: boolean): HTMLElement {
    const el = doc.createElement(displayMode ? 'div' : 'span');
    el.className = displayMode ? 'math-block' : 'math-inline';
    el.setAttribute('data-latex', latex);
    try {
        el.innerHTML = katex.renderToString(latex, { throwOnError: false, displayMode });
    } catch {
        el.textContent = latex;
    }
    return el;
}

/**
 * Rewrites delimited LaTeX inside an HTML string into editor math nodes.
 * Returns the input untouched when there is nothing to convert.
 */
export function renderLatexDelimiters(html: string | null | undefined): string {
    if (!html) return html ?? '';
    if (!html.includes('$') && !html.includes('\\(') && !html.includes('\\[')) return html;

    const doc = new DOMParser().parseFromString(html, 'text/html');
    // An editor math node always carries `data-latex`. A `.math-block` without
    // it and without a rendered formula is a plain wrapper around `$$…$$`
    // text — the paper converter's own markup — so it is read like any other
    // text, not skipped (and later dropped as an empty formula).
    doc.querySelectorAll('.math-block:not([data-latex]), .math-inline:not([data-latex])').forEach(
        (el) => {
            if (el.querySelector('.katex')) return;
            el.classList.remove('math-block', 'math-inline');
            if (!el.classList.length) el.removeAttribute('class');
        }
    );
    const textNodes: Text[] = [];
    collectTextNodes(doc.body, textNodes);

    let changed = false;

    textNodes.forEach((textNode) => {
        const text = textNode.nodeValue ?? '';
        if (!text.includes('$') && !text.includes('\\(') && !text.includes('\\[')) return;

        DELIMITED.lastIndex = 0;
        const fragment = doc.createDocumentFragment();
        let lastIndex = 0;
        let match: RegExpExecArray | null;

        while ((match = DELIMITED.exec(text)) !== null) {
            const [full, dollarBlock, bracketBlock, dollarInline, parenInline] = match;
            const body = (dollarBlock ?? bracketBlock ?? dollarInline ?? parenInline ?? '').trim();
            const isBlockDelimiter = dollarBlock !== undefined || bracketBlock !== undefined;

            // `$…$` / `\(…\)` only count as math when the body actually looks like it.
            if (!body || (!isBlockDelimiter && !looksLikeMath(body))) continue;

            if (match.index > lastIndex) {
                fragment.appendChild(doc.createTextNode(text.slice(lastIndex, match.index)));
            }
            const displayMode =
                isBlockDelimiter &&
                DISPLAY_HINT.test(body) &&
                (textNode.parentElement?.textContent ?? '').trim() === full.trim();
            fragment.appendChild(createMathNode(doc, balanceBraces(body), displayMode));
            lastIndex = match.index + full.length;
            changed = true;
        }

        if (lastIndex === 0) return;
        if (lastIndex < text.length) {
            fragment.appendChild(doc.createTextNode(text.slice(lastIndex)));
        }
        textNode.replaceWith(fragment);
    });

    return changed ? doc.body.innerHTML : html;
}
