/**
 * postcss-panel-legacy — make modern CSS survive Chrome 66 (Android 9 WebView).
 *
 * Dependency-free PostCSS 8 plugin used by vite.panel.config.ts (twice: in the
 * CSS pipeline and again on the final minified assets, so esbuild's minifier
 * can never re-merge what this split).
 *
 * 1. Logical properties -> physical (LTR assumed): margin/padding-inline(-start/-end),
 *    margin/padding-block(-start/-end), inset-inline/-block(-start/-end),
 *    border-inline-start/end(-width/-style/-color), and `inset` -> top/right/bottom/left.
 * 2. UNWRAPS :is(X) / :where(X) to X (owner decision 4; specificity of :where
 *    rises — accepted). `a:where(b, c)` becomes `ab, ac`; a complex argument
 *    such as `.x:is(.dark *)` becomes `.dark .x`.
 * 3. Splits rule selector lists that mix selectors Chrome 66 rejects
 *    (:focus-visible, :has(, ::file-selector-button, ::marker, ...) with ones it
 *    accepts, so one bad selector no longer drops the whole rule.
 */

const UNSUPPORTED_SELECTOR =
    /:focus-visible|:has\(|::file-selector-button|::marker|:dir\(|:user-invalid|:user-valid|:popover-open|:modal\b|:is\(|:where\(/;

/** Split on top-level occurrences of `sep` (outside (), [] and quotes). */
export function splitTopLevel(input, sep) {
    const out = [];
    let depthParen = 0;
    let depthBracket = 0;
    let quote = null;
    let start = 0;
    for (let i = 0; i < input.length; i++) {
        const ch = input[i];
        if (quote) {
            if (ch === '\\') i++;
            else if (ch === quote) quote = null;
            continue;
        }
        if (ch === '"' || ch === "'") quote = ch;
        else if (ch === '\\') i++;
        else if (ch === '(') depthParen++;
        else if (ch === ')') depthParen--;
        else if (ch === '[') depthBracket++;
        else if (ch === ']') depthBracket--;
        else if (ch === sep && depthParen === 0 && depthBracket === 0) {
            out.push(input.slice(start, i));
            start = i + 1;
        }
    }
    out.push(input.slice(start));
    return out;
}

/** Split CSS values on top-level whitespace (keeps `calc(a + b)` together). */
function splitValues(value) {
    const out = [];
    let depth = 0;
    let cur = '';
    for (const ch of value.trim()) {
        if (ch === '(') depth++;
        if (ch === ')') depth--;
        if (/\s/.test(ch) && depth === 0) {
            if (cur) out.push(cur);
            cur = '';
        } else {
            cur += ch;
        }
    }
    if (cur) out.push(cur);
    return out;
}

/** Index of the matching `)` for the `(` at openIndex. */
function matchParen(s, openIndex) {
    let depth = 0;
    let quote = null;
    for (let i = openIndex; i < s.length; i++) {
        const ch = s[i];
        if (quote) {
            if (ch === '\\') i++;
            else if (ch === quote) quote = null;
            continue;
        }
        if (ch === '"' || ch === "'") quote = ch;
        else if (ch === '\\') i++;
        else if (ch === '(') depth++;
        else if (ch === ')') {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

/** First top-level `:is(` / `:where(` (not inside :not() etc.). */
function findWrapper(s) {
    let depthParen = 0;
    let depthBracket = 0;
    let quote = null;
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (quote) {
            if (ch === '\\') i++;
            else if (ch === quote) quote = null;
            continue;
        }
        if (ch === '"' || ch === "'") quote = ch;
        else if (ch === '\\') i++;
        else if (ch === '[') depthBracket++;
        else if (ch === ']') depthBracket--;
        else if (ch === '(') depthParen++;
        else if (ch === ')') depthParen--;
        else if (ch === ':' && depthParen === 0 && depthBracket === 0) {
            const m = /^:(is|where|-webkit-any|matches)\(/.exec(s.slice(i));
            if (m) return { start: i, open: i + m[0].length - 1 };
        }
    }
    return null;
}

const COMBINATOR = /[\s>+~]/;

/** Is there a top-level combinator in this selector? */
function hasCombinator(s) {
    const t = s.trim();
    let depthParen = 0;
    let depthBracket = 0;
    for (let i = 0; i < t.length; i++) {
        const ch = t[i];
        if (ch === '\\') {
            i++;
            continue;
        }
        if (ch === '(') depthParen++;
        else if (ch === ')') depthParen--;
        else if (ch === '[') depthBracket++;
        else if (ch === ']') depthBracket--;
        else if (depthParen === 0 && depthBracket === 0 && COMBINATOR.test(ch)) return true;
    }
    return false;
}

/** Split `a b > c` into [ancestorPart(with trailing combinator), lastCompound]. */
function splitLastCompound(s) {
    const t = s.trim();
    let depthParen = 0;
    let depthBracket = 0;
    let lastBoundary = -1;
    for (let i = 0; i < t.length; i++) {
        const ch = t[i];
        if (ch === '\\') {
            i++;
            continue;
        }
        if (ch === '(') depthParen++;
        else if (ch === ')') depthParen--;
        else if (ch === '[') depthBracket++;
        else if (ch === ']') depthBracket--;
        else if (depthParen === 0 && depthBracket === 0 && COMBINATOR.test(ch)) lastBoundary = i;
    }
    if (lastBoundary < 0) return ['', t];
    return [t.slice(0, lastBoundary + 1), t.slice(lastBoundary + 1)];
}

const TYPE_SELECTOR = /^(?:[a-zA-Z][\w-]*|\*)/;

/** Merge compound `inner` into the outer compound before/after parts. */
function mergeCompound(before, inner, after) {
    let innerType = '';
    let innerRest = inner.trim();
    const typeMatch = TYPE_SELECTOR.exec(innerRest);
    if (typeMatch) {
        innerType = typeMatch[0] === '*' ? '' : typeMatch[0];
        innerRest = innerRest.slice(typeMatch[0].length);
    }
    let merged;
    if (innerType && !TYPE_SELECTOR.test(before)) merged = innerType + before + innerRest + after;
    else merged = before + innerType + innerRest + after;
    return merged || '*';
}

/**
 * Expand every top-level :is()/:where() in one selector. Returns a list of
 * selectors (an argument list of N items yields N selectors).
 */
export function unwrapSelector(selector) {
    const found = findWrapper(selector);
    if (!found) return [selector];
    const close = matchParen(selector, found.open);
    if (close < 0) return [selector];
    const inner = selector.slice(found.open + 1, close);
    const args = splitTopLevel(inner, ',')
        .map((a) => a.trim())
        .filter(Boolean);

    // Boundaries of the compound selector that contains the pseudo.
    let compoundStart = found.start;
    {
        let depthParen = 0;
        let depthBracket = 0;
        for (let i = found.start - 1; i >= 0; i--) {
            const ch = selector[i];
            if (ch === ')') depthParen++;
            else if (ch === '(') depthParen--;
            else if (ch === ']') depthBracket++;
            else if (ch === '[') depthBracket--;
            if (depthParen === 0 && depthBracket === 0 && COMBINATOR.test(ch) && selector[i - 1] !== '\\') {
                break;
            }
            compoundStart = i;
        }
    }
    let compoundEnd = close + 1;
    {
        let depthParen = 0;
        let depthBracket = 0;
        for (let i = close + 1; i < selector.length; i++) {
            const ch = selector[i];
            if (ch === '\\') {
                i++;
                compoundEnd = i + 1;
                continue;
            }
            if (ch === '(') depthParen++;
            else if (ch === ')') depthParen--;
            else if (ch === '[') depthBracket++;
            else if (ch === ']') depthBracket--;
            if (depthParen === 0 && depthBracket === 0 && COMBINATOR.test(ch)) break;
            compoundEnd = i + 1;
        }
    }
    const prefix = selector.slice(0, compoundStart);
    const before = selector.slice(compoundStart, found.start);
    const after = selector.slice(close + 1, compoundEnd);
    const suffix = selector.slice(compoundEnd);

    const results = [];
    for (const arg of args) {
        let expanded;
        if (!hasCombinator(arg)) {
            expanded = prefix + mergeCompound(before, arg, after) + suffix;
        } else {
            // `P A:is(B C) S` ~ `B P A&C S` (approximation when P is non-empty:
            // B must then be an ancestor of P too — true for html/body-level
            // classes such as `.dark`, which is the case Tailwind generates).
            const [ancestors, last] = splitLastCompound(arg);
            const core = mergeCompound(before, last, after);
            expanded = prefix ? `${ancestors.trimEnd()} ${prefix}${core}${suffix}` : ancestors + core + suffix;
        }
        for (const next of unwrapSelector(expanded)) results.push(next);
    }
    return results.length ? results : [selector];
}

const LOGICAL = {
    'margin-inline-start': ['margin-left'],
    'margin-inline-end': ['margin-right'],
    'margin-block-start': ['margin-top'],
    'margin-block-end': ['margin-bottom'],
    'padding-inline-start': ['padding-left'],
    'padding-inline-end': ['padding-right'],
    'padding-block-start': ['padding-top'],
    'padding-block-end': ['padding-bottom'],
    'inset-inline-start': ['left'],
    'inset-inline-end': ['right'],
    'inset-block-start': ['top'],
    'inset-block-end': ['bottom'],
    'border-inline-start': ['border-left'],
    'border-inline-end': ['border-right'],
    'border-inline-start-width': ['border-left-width'],
    'border-inline-end-width': ['border-right-width'],
    'border-inline-start-color': ['border-left-color'],
    'border-inline-end-color': ['border-right-color'],
    'border-inline-start-style': ['border-left-style'],
    'border-inline-end-style': ['border-right-style'],
    'border-block-start': ['border-top'],
    'border-block-end': ['border-bottom'],
};
const LOGICAL_PAIRS = {
    'margin-inline': ['margin-left', 'margin-right'],
    'margin-block': ['margin-top', 'margin-bottom'],
    'padding-inline': ['padding-left', 'padding-right'],
    'padding-block': ['padding-top', 'padding-bottom'],
    'inset-inline': ['left', 'right'],
    'inset-block': ['top', 'bottom'],
};

function convertDeclaration(decl) {
    const prop = decl.prop.toLowerCase();
    if (LOGICAL[prop]) {
        decl.cloneBefore({ prop: LOGICAL[prop][0] });
        decl.remove();
        return;
    }
    if (LOGICAL_PAIRS[prop]) {
        const values = splitValues(decl.value);
        const [a, b] = LOGICAL_PAIRS[prop];
        const first = values[0] ?? decl.value;
        const second = values[1] ?? first;
        decl.cloneBefore({ prop: a, value: first });
        decl.cloneBefore({ prop: b, value: second });
        decl.remove();
        return;
    }
    if (prop === 'inset') {
        const v = splitValues(decl.value);
        const top = v[0] ?? decl.value;
        const right = v[1] ?? top;
        const bottom = v[2] ?? top;
        const left = v[3] ?? right;
        decl.cloneBefore({ prop: 'top', value: top });
        decl.cloneBefore({ prop: 'right', value: right });
        decl.cloneBefore({ prop: 'bottom', value: bottom });
        decl.cloneBefore({ prop: 'left', value: left });
        decl.remove();
    }
}

function processRule(rule) {
    // Keyframe selectors (from/to/50%) are not selectors.
    const parent = rule.parent;
    if (parent && parent.type === 'atrule' && /keyframes$/i.test(parent.name)) return;
    const selectors = splitTopLevel(rule.selector, ',')
        .map((s) => s.trim())
        .filter(Boolean);
    const expanded = [];
    const seen = new Set();
    for (const sel of selectors) {
        for (const next of unwrapSelector(sel)) {
            if (!seen.has(next)) {
                seen.add(next);
                expanded.push(next);
            }
        }
    }
    const bad = expanded.filter((s) => UNSUPPORTED_SELECTOR.test(s));
    const good = expanded.filter((s) => !UNSUPPORTED_SELECTOR.test(s));
    if (bad.length && good.length) {
        rule.cloneAfter({ selector: bad.join(',') });
        rule.selector = good.join(',');
    } else {
        rule.selector = expanded.join(',');
    }
}

const panelLegacyCss = () => ({
    postcssPlugin: 'postcss-panel-legacy',
    Declaration(decl) {
        convertDeclaration(decl);
    },
    Rule(rule) {
        processRule(rule);
    },
});
panelLegacyCss.postcss = true;

export default panelLegacyCss;
