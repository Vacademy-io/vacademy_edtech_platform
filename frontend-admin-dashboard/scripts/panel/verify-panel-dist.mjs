#!/usr/bin/env node
/**
 * verify-panel-dist — ES-floor, API, CSS, CDN, module-graph, size and
 * floor-consistency gate for dist-panel/ (the Vacademy Classroom bundle,
 * Chrome 66 = Android 9 AOSP WebView).
 *
 *   node scripts/panel/verify-panel-dist.mjs        # exit 1 on any FAIL
 *
 * Checks PANEL_OUT_DIR when set (as vite.panel.config.ts writes there), else dist-panel/.
 * A lab build sets PANEL_LAB_BUILD=1 to turn check 8 into INFO; that is refused for
 * dist-panel/ itself, which is what cap sync ships.
 *
 * Checks
 *  1. Every .js parses with acorn 8.15.0 at ecmaVersion 2020 (module; workers
 *     may be classic scripts) and has zero `?.` / `??` / bigint tokens and no
 *     `export * as ns` (Chrome 72).
 *  2. Polyfillable APIs (INFO in page chunks, which get panel-polyfills + the
 *     pre-flight Promise shims) — but FAIL in WORKER chunks (no page polyfills)
 *     unless pdfWorker/init.ts is in the chunk (manifest + markers) AND the API
 *     is in WORKER_SHIMMED; a pdf worker without init.ts FAILs. Non-polyfillable APIs FAIL
 *     unless scripts/panel/api-allowlist.json lists them with a reason.
 *  3. CSS: no `inset` / logical properties, no selector list still mixing
 *     :focus-visible/:is/:where/:has with plain selectors; INFO for flex/grid
 *     gap, clamp/min/max, aspect-ratio and friends (owner decision 9: report,
 *     don't block; screenshot-check on api28).
 *  4. No CDN URLs (unpkg, cdnjs, jsdelivr, esm.sh, zoom, YouTube iframe_api)
 *     unless allowlisted.
 *  5. Module graph (node_modules/.cache/panel/modules*.json written by the
 *     build): forbidden modules, incl. any core-js promise module (owner
 *     decision 2: core-js replaces window.Promise at V8 66).
 *  6. Gzip budgets.
 *  7. index.html (not panel.html) with relative asset URLs; MIN=66 in
 *     index.html == PANEL_MIN_CHROME == mobile-flavors.json minWebViewMajor;
 *     panel.en/hi.json key parity.
 *  8. Release: no chunk carries the Phase 0 login (login-root) or a backend URL on a
 *     loopback or private address (scripts/panel/release-guard.mjs).
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { findReleaseProblems } from './release-guard.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RELEASE_DIST = path.join(ROOT, 'dist-panel');
const DIST = process.env.PANEL_OUT_DIR ? path.resolve(process.env.PANEL_OUT_DIR) : RELEASE_DIST;
const LAB_BUILD = process.env.PANEL_LAB_BUILD === '1';
const MANIFEST_DIR = path.join(ROOT, 'node_modules/.cache/panel');
const require = createRequire(import.meta.url);
const acorn = require(path.join(ROOT, 'node_modules/.pnpm/acorn@8.15.0/node_modules/acorn'));
const postcss = require(path.join(ROOT, 'node_modules/postcss'));

const MIN = 66;
const KB = 1024;
const BUDGET = {
    initialJs: 300 * KB,
    initialJsTarget: 220 * KB,
    initialCss: 60 * KB,
    lazyChunk: 450 * KB,
    pdfChunk: 350 * KB,
    worker: 900 * KB,
    totalRaw: 20 * 1024 * KB,
};

const results = [];
const add = (status, check, file, detail) => results.push({ status, check, file, detail });
const fail = (check, file, detail) => add('FAIL', check, file, detail);
const warn = (check, file, detail) => add('WARN', check, file, detail);
const info = (check, file, detail) => add('INFO', check, file, detail);
const ok = (check, file, detail) => add('OK', check, file, detail);

// ------------------------------------------------------------------ setup ---

if (!fs.existsSync(DIST)) {
    console.error(`[verify-panel] ${DIST} does not exist. Run node scripts/panel/build-panel.mjs`);
    process.exit(1);
}

function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else out.push(full);
    }
    return out;
}
const files = walk(DIST);
const rel = (file) => path.relative(DIST, file).split(path.sep).join('/');
const jsFiles = files.filter((f) => f.endsWith('.js'));
const cssFiles = files.filter((f) => f.endsWith('.css'));

function readJson(file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return fallback;
    }
}
const pageManifest = readJson(path.join(MANIFEST_DIR, 'modules.json'), null);
const workerManifest = readJson(path.join(MANIFEST_DIR, 'modules.workers.json'), {});
const allowlist = readJson(path.join(ROOT, 'scripts/panel/api-allowlist.json'), { entries: [] });
const allowEntries = (allowlist.entries || []).map((entry) => ({ ...entry, used: false }));

// A worker chunk: listed in the worker manifest, or emitted with the globalThis banner.
const workerNames = new Set(Object.keys(workerManifest).map((name) => path.basename(name)));
const sources = new Map(jsFiles.map((f) => [f, fs.readFileSync(f, 'utf8')]));
const isWorker = (file) =>
    workerNames.has(path.basename(file)) ||
    sources.get(file).startsWith('if(typeof globalThis==="undefined"){self.globalThis=self;}');

function allowed(api, file, content) {
    const name = rel(file);
    for (const entry of allowEntries) {
        if (entry.api !== api) continue;
        if (entry.chunkPattern && !new RegExp(entry.chunkPattern).test(name)) continue;
        if (entry.contentPattern && !new RegExp(entry.contentPattern).test(content)) continue;
        if (!entry.chunkPattern && !entry.contentPattern) continue;
        entry.used = true;
        return entry;
    }
    return null;
}

// --------------------------------------------------------- 1. ES floor ---

for (const file of jsFiles) {
    const src = sources.get(file);
    const worker = isWorker(file);
    let parsedAs = null;
    let error = null;
    for (const sourceType of worker ? ['module', 'script'] : ['module']) {
        try {
            acorn.parse(src, { ecmaVersion: 2020, sourceType });
            parsedAs = sourceType;
            break;
        } catch (e) {
            error = e;
        }
    }
    if (!parsedAs) {
        const loc = error?.loc ? `${error.loc.line}:${error.loc.column}` : '?';
        const near = error?.pos != null ? src.slice(Math.max(0, error.pos - 60), error.pos + 40) : '';
        fail('es2020-parse', rel(file), `${error?.message} @${loc} …${near.replace(/\s+/g, ' ')}…`);
        continue;
    }
    // ES2020 itself allows ?. ?? and bigint: Chrome 66 does not.
    let optChain = 0;
    let nullish = 0;
    let bigint = 0;
    let exportStarAs = 0;
    const regexFails = [];
    const regexStrings = [];
    const tt = acorn.tokTypes;
    const recent = [];
    try {
        for (const token of acorn.tokenizer(src, {
            ecmaVersion: 2020,
            sourceType: parsedAs,
        })) {
            if (token.type === tt.questionDot) optChain++;
            else if (token.type === tt.coalesce) nullish++;
            else if (token.type === tt.num && typeof token.value === 'bigint') bigint++;
            else if (token.type === tt.regexp && /\\[pP]\{/.test(token.value.pattern)) {
                // ES2020 parsing accepts ES2019 property names (\p{Extended_Pictographic});
                // V8 6.6 only knows the ES2018 set. An unknown name in a literal is an
                // early SyntaxError that kills the whole chunk.
                try {
                    acorn.parse(`/${token.value.pattern}/${token.value.flags}`, { ecmaVersion: 2018 });
                } catch (e) {
                    regexFails.push(`/${token.value.pattern.slice(0, 60)}/${token.value.flags}: ${e.message}`);
                }
            } else if (token.type === tt.string && /\\[pP]\{/.test(token.value)) {
                // A RegExp built at runtime from a string throws when constructed instead;
                // fine only behind a try/catch (read it).
                try {
                    acorn.parse(`/${token.value}/u`, { ecmaVersion: 2018 });
                } catch (e) {
                    regexStrings.push(token.value.slice(0, 60));
                }
            }
            recent.push(token);
            if (recent.length > 3) recent.shift();
            if (
                recent.length === 3 &&
                recent[0].type === tt._export &&
                recent[1].type === tt.star &&
                recent[2].type === tt.name &&
                recent[2].value === 'as'
            ) {
                exportStarAs++;
            }
        }
    } catch (e) {
        fail('tokenize', rel(file), e.message);
        continue;
    }
    for (const detail of regexFails) fail('regexp-es2018', rel(file), detail);
    for (const detail of regexStrings) {
        info('regexp-runtime-es2019', rel(file), `RegExp source string "${detail}" needs ES2019+ (must be built inside try/catch)`);
    }
    if (optChain || nullish || bigint || exportStarAs) {
        fail(
            'chrome66-syntax',
            rel(file),
            `?.=${optChain} ??=${nullish} bigint=${bigint} export*as=${exportStarAs}`
        );
    } else {
        ok('es2020-parse', rel(file), `${parsedAs}${worker ? ' (worker)' : ''}`);
    }
}

// ------------------------------------------------------------- 2. APIs ---

const POLYFILLED = {
    'String#replaceAll': /\.replaceAll\(/g,
    structuredClone: /\bstructuredClone\(/g,
    'Object.hasOwn': /Object\.hasOwn\(/g,
    'Object.fromEntries': /Object\.fromEntries\(/g,
    'Array#findLast': /\.findLast(?:Index)?\(/g,
    'Array#toSorted/toReversed/toSpliced': /\.to(?:Sorted|Reversed|Spliced)\(/g,
    'Promise.allSettled': /Promise\.allSettled\(/g,
    'Promise.any': /Promise\.any\(/g,
    'Promise.withResolvers': /Promise\.withResolvers\(/g,
    globalThis: /\bglobalThis\b/g,
    queueMicrotask: /\bqueueMicrotask\(/g,
    '.at()': /\.at\(/g,
    '.flat()': /\.flat\(/g,
    flatMap: /\.flatMap\(/g,
    'Object.groupBy': /Object\.groupBy\(/g,
    'Map.groupBy': /Map\.groupBy\(/g,
    matchAll: /\.matchAll\(/g,
    AggregateError: /\bAggregateError\b/g,
};
const NOT_POLYFILLED = {
    'crypto.randomUUID': /\.randomUUID\b/g,
    'Intl.Segmenter': /Intl\.Segmenter\b/g,
    'Intl.RelativeTimeFormat': /Intl\.RelativeTimeFormat\b/g,
    'Intl.ListFormat': /Intl\.ListFormat\b/g,
    'Intl.DisplayNames': /Intl\.DisplayNames\b/g,
    WeakRef: /new WeakRef\(/g,
    FinalizationRegistry: /\bnew FinalizationRegistry\(/g,
    'navigator.wakeLock': /navigator\.wakeLock\b/g,
    'canvas.roundRect': /\.roundRect\(/g,
    'module worker': /type\s*:\s*["']module["']/g,
    'AbortSignal.timeout/any': /AbortSignal\.(?:timeout|any)\(/g,
    replaceChildren: /\.replaceChildren\(/g,
    toggleAttribute: /\.toggleAttribute\(/g,
    'ResizeObserverEntry.borderBoxSize': /\.borderBoxSize\b/g,
    'Array.fromAsync': /Array\.fromAsync\(/g,
    'Set methods': /\.(?:symmetricDifference|isSubsetOf|isSupersetOf|isDisjointFrom)\(/g,
    'Iterator helpers': /\bIterator\.(?:from|prototype)\b/g,
    'URL.canParse': /URL\.canParse\(/g,
    OffscreenCanvas: /\bnew OffscreenCanvas\(/g,
};
const count = (re, src) => (src.match(re) || []).length;

// APIs that src/panel/content/pdfWorker/init.ts installs in the pdf worker (owner decision 3:
// the worker bundle must be self-sufficient). KEEP IN SYNC with init.ts. Coverage is NOT
// inferred from '__core-js_shared__': pdfjs-dist's legacy worker bundles its own small
// core-js@3.32.2 (ArrayBuffer.transfer etc.) that provides none of these (finding OE-2).
const WORKER_SHIMMED = new Set([
    '.at()',
    'String#replaceAll',
    '.flat()',
    'flatMap',
    'Object.fromEntries',
    'Promise.allSettled',
    'globalThis',
]);
const PDF_WORKER_INIT_MODULE = 'src/panel/content/pdfWorker/init.ts';
const PDF_WORKER_MARKERS = ['__panelPdfWorkerInit', '__panelNullTransfer'];
function workerModules(file) {
    const base = path.basename(file);
    const key = Object.keys(workerManifest).find((k) => path.basename(k) === base);
    return key ? workerManifest[key] || [] : [];
}
const isPdfWorker = (file) =>
    /^pdf\.worker/.test(path.basename(file)) ||
    workerModules(file).some((m) => m.indexOf('pdfjs-dist') >= 0 && /pdf\.worker\.js/.test(m));

for (const file of jsFiles) {
    const src = sources.get(file);
    const name = rel(file);
    const worker = isWorker(file);
    let hasInit = false;
    if (worker && isPdfWorker(file)) {
        const inManifest = workerModules(file).some((m) => m.endsWith(PDF_WORKER_INIT_MODULE));
        const missingMarkers = PDF_WORKER_MARKERS.filter((m) => src.indexOf(m) < 0);
        hasInit = inManifest && missingMarkers.length === 0;
        if (hasInit) ok('worker-init', name, `${PDF_WORKER_INIT_MODULE} present (${PDF_WORKER_MARKERS.join(', ')})`);
        else {
            fail(
                'worker-init',
                name,
                `pdfWorker/init.ts shim missing from worker chunk (manifest: ${inManifest ? 'yes' : 'NO'}; markers missing: ${missingMarkers.join(', ') || 'none'})`
            );
        }
    }
    const hits = [];
    for (const [api, re] of Object.entries(POLYFILLED)) {
        const n = count(re, src);
        if (!n) continue;
        if (!worker) {
            hits.push(`${api}×${n}`);
            continue;
        }
        if (api === 'globalThis') continue; // the worker banner defines it
        if (hasInit && WORKER_SHIMMED.has(api)) {
            info('worker-api', name, `${api}×${n} (shimmed by pdfWorker/init.ts)`);
        } else if (allowed(api, file, src)) {
            info('worker-api', name, `${api}×${n} allowlisted`);
        } else {
            fail('worker-api', name, `${api}×${n}: workers get NO page polyfills`);
        }
    }
    if (hits.length) info('polyfilled-api', name, hits.join(' '));
    for (const [api, re] of Object.entries(NOT_POLYFILLED)) {
        const n = count(re, src);
        if (!n) continue;
        const entry = allowed(api, file, src);
        if (entry) info('api-allowlisted', name, `${api}×${n}: ${entry.reason}`);
        else fail('unpolyfillable-api', name, `${api}×${n} (add a guarded-use entry to api-allowlist.json after reading it)`);
    }
    const whereInJs = count(/:where\(/g, src);
    if (whereInJs) info('js-injected-css', name, `:where( ×${whereInJs} in JS strings (runtime CSS is not post-processed)`);
}

// -------------------------------------------------------------- 3. CSS ---

const BAD_SELECTOR = /:focus-visible|:is\(|:where\(|:has\(|::file-selector-button|::marker/;
const LOGICAL_PROP =
    /^(?:inset|inset-inline(?:-start|-end)?|inset-block(?:-start|-end)?|margin-inline(?:-start|-end)?|margin-block(?:-start|-end)?|padding-inline(?:-start|-end)?|padding-block(?:-start|-end)?)$/i;

function splitSelectors(selector) {
    const out = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < selector.length; i++) {
        const ch = selector[i];
        if (ch === '\\') i++;
        else if (ch === '(' || ch === '[') depth++;
        else if (ch === ')' || ch === ']') depth--;
        else if (ch === ',' && depth === 0) {
            out.push(selector.slice(start, i).trim());
            start = i + 1;
        }
    }
    out.push(selector.slice(start).trim());
    return out.filter(Boolean);
}

for (const file of cssFiles) {
    const name = rel(file);
    const css = fs.readFileSync(file, 'utf8');
    let root;
    try {
        root = postcss.parse(css);
    } catch (e) {
        fail('css-parse', name, e.message);
        continue;
    }
    const logical = new Map();
    let mixed = 0;
    const mixedExamples = [];
    let wholeDropped = 0;
    const tally = { gap: 0, clamp: 0, minmax: 0, aspectRatio: 0, dvh: 0, backdrop: 0, container: 0, colorMix: 0 };
    root.walkDecls((decl) => {
        if (LOGICAL_PROP.test(decl.prop)) logical.set(decl.prop, (logical.get(decl.prop) || 0) + 1);
        if (/^(?:gap|row-gap|column-gap)$/.test(decl.prop)) tally.gap++;
        if (/\bclamp\(/.test(decl.value)) tally.clamp++;
        if (/(?:^|[^\w-])(?:min|max)\(/.test(decl.value)) tally.minmax++;
        if (decl.prop === 'aspect-ratio') tally.aspectRatio++;
        if (/\d(?:dvh|svh|lvh|dvw)\b/.test(decl.value)) tally.dvh++;
        if (/backdrop-filter/.test(decl.prop)) tally.backdrop++;
        if (/color-mix\(|oklch\(/.test(decl.value)) tally.colorMix++;
    });
    root.walkAtRules('container', () => {
        tally.container++;
    });
    root.walkRules((rule) => {
        const parent = rule.parent;
        if (parent && parent.type === 'atrule' && /keyframes$/i.test(parent.name)) return;
        const selectors = splitSelectors(rule.selector);
        const bad = selectors.filter((s) => BAD_SELECTOR.test(s));
        if (bad.length && bad.length < selectors.length) {
            mixed++;
            if (mixedExamples.length < 3) mixedExamples.push(rule.selector.slice(0, 120));
        } else if (bad.length) {
            wholeDropped++;
        }
    });
    if (logical.size) {
        fail('css-logical', name, Array.from(logical).map(([p, n]) => `${p}×${n}`).join(' '));
    } else {
        ok('css-logical', name, 'no inset / logical properties');
    }
    if (mixed) fail('css-mixed-selectors', name, `${mixed} rules, e.g. ${mixedExamples.join(' | ')}`);
    else ok('css-mixed-selectors', name, 'none');
    info(
        'css-chrome66-ignored',
        name,
        `rules dropped on 66 (only :focus-visible/:has/… selectors): ${wholeDropped}; gap decls: ${tally.gap} (flex gap is Chrome 84); clamp(): ${tally.clamp}; min()/max(): ${tally.minmax}; aspect-ratio: ${tally.aspectRatio}; dvh: ${tally.dvh}; backdrop-filter: ${tally.backdrop}; @container: ${tally.container}; color-mix/oklch: ${tally.colorMix}`
    );
}

// -------------------------------------------------------------- 4. CDN ---

const CDN = {
    'unpkg.com': /unpkg\.com/g,
    'cdnjs.cloudflare.com': /cdnjs\.cloudflare\.com/g,
    'cdn.jsdelivr.net': /cdn\.jsdelivr\.net/g,
    'esm.sh': /esm\.sh\//g,
    'esm.run': /esm\.run\//g,
    'source.zoom.us': /source\.zoom\.us/g,
    'youtube iframe_api': /youtube\.com\/iframe_api/g,
};
for (const file of files.filter((f) => /\.(?:js|css|html)$/.test(f))) {
    const src = sources.get(file) ?? fs.readFileSync(file, 'utf8');
    for (const [host, re] of Object.entries(CDN)) {
        const n = count(re, src);
        if (!n) continue;
        const entry = allowed(`cdn:${host}`, file, src);
        if (entry) info('cdn-allowlisted', rel(file), `${host}×${n}: ${entry.reason}`);
        else fail('cdn-url', rel(file), `${host}×${n}`);
    }
}

// ------------------------------------------------------------ 5. Graph ---

const ROUTE_ALLOW = [
    /src\/routes\/study-library\/courses\/course-details\/subjects\/modules\/chapters\/slides\/-components\/deck-player\.tsx$/,
    /src\/routes\/study-library\/courses\/course-details\/subjects\/modules\/chapters\/slides\/-components\/file-video-player\.tsx$/,
];
const FORBIDDEN = [
    ['routeTree.gen', /routeTree\.gen/],
    ['src/routes/**', /(?:^|\/)src\/routes\//],
    ['@tanstack/react-router', /@tanstack[+/](?:react-)?router/],
    ['@sentry', /@sentry/],
    ['@amplitude', /@amplitude/],
    ['mermaid/elkjs/cytoscape', /node_modules\/.*(?:mermaid|elkjs|cytoscape)/],
    ['@ffmpeg', /@ffmpeg/],
    ['assemblyai', /assemblyai/],
    ['firebase', /node_modules\/.*firebase/],
    ['@capgo', /@capgo/],
    ['privacy-screen', /privacy-screen/],
    ['@capacitor/status-bar', /@capacitor[+/]status-bar/],
    ['react-pdf', /node_modules\/.*react-pdf\//],
    ['pdfjs-dist@4', /pdfjs-dist@4/],
    ['lib/auth/axiosInstance.ts', /src\/lib\/auth\/axiosInstance\.ts/],
    ['src/index.tsx', /(?:^|\/)src\/index\.tsx$/],
    ['src/i18n.ts', /(?:^|\/)src\/i18n\.ts$/],
    ['slide-material', /slide-material/],
    ['SlideEditorComponent', /SlideEditorComponent/],
    ['QuizSlides.tsx', /QuizSlides\.tsx/],
    ['RichTextEditor', /RichTextEditor/],
    ['tiptap', /tiptap/],
    ['core-js promise (decision 2)', /core-js@3\.44\.0\/node_modules\/core-js\/(?:modules\/es\.promise|internals\/promise-)/],
    ['core-js@2', /core-js@2\./],
];

if (!pageManifest) {
    fail('module-graph', 'modules.json', `missing ${path.join(MANIFEST_DIR, 'modules.json')} (run the build)`);
} else {
    const graphs = [
        ['page', pageManifest],
        ['worker', workerManifest],
    ];
    let total = 0;
    const hits = new Map();
    for (const [kind, manifest] of graphs) {
        for (const [chunk, ids] of Object.entries(manifest)) {
            for (const rawId of ids) {
                total++;
                const id = rawId.replace(/^\0/, '').split('?')[0];
                if (ROUTE_ALLOW.some((re) => re.test(id))) continue;
                for (const [label, re] of FORBIDDEN) {
                    if (!re.test(id)) continue;
                    const key = `${label}`;
                    const list = hits.get(key) || [];
                    if (list.length < 4) list.push(`${kind}:${chunk} ← ${id}`);
                    hits.set(key, list);
                }
            }
        }
    }
    if (hits.size) {
        for (const [label, list] of hits) fail('forbidden-module', label, list.join(' ; '));
    } else {
        ok('module-graph', 'modules.json', `${total} module ids, no forbidden modules`);
    }
    // Polyfill chunk must exist and hold core-js.
    const polyChunk = Object.keys(pageManifest).find((name) => /panel-polyfills/.test(name));
    if (!polyChunk) fail('polyfill-chunk', 'panel-polyfills', 'no panel-polyfills chunk emitted');
    else ok('polyfill-chunk', polyChunk, `${pageManifest[polyChunk].length} modules`);
}

// ------------------------------------------------------------ 6. Sizes ---

const gz = (file) => zlib.gzipSync(fs.readFileSync(file), { level: 9 }).length;
const fmt = (bytes) => `${(bytes / KB).toFixed(1)} KB`;
const indexHtmlPath = path.join(DIST, 'index.html');
const indexHtml = fs.existsSync(indexHtmlPath) ? fs.readFileSync(indexHtmlPath, 'utf8') : '';

const initialJs = new Set();
const initialCss = new Set();
for (const m of indexHtml.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)) initialJs.add(m[1]);
for (const m of indexHtml.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g)) initialJs.add(m[1]);
for (const m of indexHtml.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)) {
    if (!/^https?:/.test(m[1])) initialCss.add(m[1]);
}
const toFile = (url) => path.join(DIST, url.replace(/^\.\//, ''));

const sizeRows = [];
let initialJsGz = 0;
for (const url of initialJs) {
    const file = toFile(url);
    if (!fs.existsSync(file)) {
        fail('initial-asset', url, 'referenced by index.html but missing');
        continue;
    }
    const size = gz(file);
    initialJsGz += size;
    sizeRows.push(['initial-js', rel(file), size]);
}
let initialCssGz = 0;
for (const url of initialCss) {
    const file = toFile(url);
    if (!fs.existsSync(file)) {
        fail('initial-asset', url, 'referenced by index.html but missing');
        continue;
    }
    const size = gz(file);
    initialCssGz += size;
    sizeRows.push(['initial-css', rel(file), size]);
}
if (!initialJs.size) fail('budget-initial-js', 'index.html', 'no module script found');
else if (initialJsGz > BUDGET.initialJs) fail('budget-initial-js', '(sum)', `${fmt(initialJsGz)} > ${fmt(BUDGET.initialJs)}`);
else if (initialJsGz > BUDGET.initialJsTarget) warn('budget-initial-js', '(sum)', `${fmt(initialJsGz)} (target ≤ ${fmt(BUDGET.initialJsTarget)})`);
else ok('budget-initial-js', '(sum)', fmt(initialJsGz));
if (initialCssGz > BUDGET.initialCss) fail('budget-initial-css', '(sum)', `${fmt(initialCssGz)} > ${fmt(BUDGET.initialCss)}`);
else ok('budget-initial-css', '(sum)', fmt(initialCssGz));

const initialFiles = new Set([...initialJs].map((url) => path.normalize(toFile(url))));
const pdfChunkNames = new Set(
    pageManifest
        ? Object.entries(pageManifest)
              .filter(([, ids]) => ids.some((id) => /pdfjs-dist\/legacy\/build\/pdf\.js$/.test(id)))
              .map(([name]) => path.basename(name))
        : []
);
for (const file of jsFiles) {
    if (initialFiles.has(path.normalize(file))) continue;
    const size = gz(file);
    const name = rel(file);
    if (isWorker(file)) {
        sizeRows.push(['worker', name, size]);
        if (size > BUDGET.worker) fail('budget-worker', name, `${fmt(size)} > ${fmt(BUDGET.worker)}`);
    } else if (pdfChunkNames.has(path.basename(file))) {
        sizeRows.push(['lazy-pdf', name, size]);
        if (size > BUDGET.pdfChunk) fail('budget-pdf', name, `${fmt(size)} > ${fmt(BUDGET.pdfChunk)}`);
    } else {
        sizeRows.push(['lazy-js', name, size]);
        if (size > BUDGET.lazyChunk) fail('budget-lazy', name, `${fmt(size)} > ${fmt(BUDGET.lazyChunk)}`);
    }
}
const totalRaw = files.reduce((sum, file) => sum + fs.statSync(file).size, 0);
if (totalRaw > BUDGET.totalRaw) fail('budget-total-raw', 'dist-panel', `${fmt(totalRaw)} > ${fmt(BUDGET.totalRaw)}`);
else ok('budget-total-raw', 'dist-panel', `${(totalRaw / KB / KB).toFixed(2)} MB in ${files.length} files`);

// --------------------------------------------------- 7. Entry + floor ---

if (!fs.existsSync(indexHtmlPath)) fail('entry', 'index.html', 'dist-panel/index.html missing');
else ok('entry', 'index.html', 'present');
if (fs.existsSync(path.join(DIST, 'panel.html'))) fail('entry', 'panel.html', 'must be renamed to index.html');
if (/(?:src|href)="\/(?!\/)/.test(indexHtml)) fail('relative-urls', 'index.html', 'absolute /… asset URL found (base must be ./)');
else ok('relative-urls', 'index.html', 'relative');

const htmlMin = /var MIN = (\d+);/.exec(indexHtml)?.[1];
const configTs = fs.readFileSync(path.join(ROOT, 'src/panel/config.ts'), 'utf8');
const configMin = /export const PANEL_MIN_CHROME = (\d+);/.exec(configTs)?.[1];
const flavorsFile = path.join(ROOT, 'android/app/mobile-flavors.json');
let flavorMin = null;
if (fs.existsSync(flavorsFile)) {
    const flavors = readJson(flavorsFile, {});
    const classroom = flavors['vacademy-classroom'];
    if (classroom && classroom.minWebViewMajor !== undefined) flavorMin = String(classroom.minWebViewMajor);
}
const floors = [`index.html=${htmlMin}`, `config.ts=${configMin}`, `mobile-flavors.json=${flavorMin ?? 'n/a'}`];
if (htmlMin !== String(MIN) || configMin !== String(MIN) || (flavorMin !== null && flavorMin !== String(MIN))) {
    fail('min-chrome', 'floor', `expected ${MIN}: ${floors.join(' ')}`);
} else {
    ok('min-chrome', 'floor', floors.join(' '));
    if (flavorMin === null) info('min-chrome', 'mobile-flavors.json', 'no vacademy-classroom entry yet (native workstream)');
}

// i18n parity for the panel namespace.
function flatKeys(obj, prefix = '') {
    return Object.entries(obj).flatMap(([key, value]) =>
        value && typeof value === 'object' ? flatKeys(value, `${prefix}${key}.`) : [`${prefix}${key}`]
    );
}
const en = new Set(flatKeys(readJson(path.join(ROOT, 'src/panel/i18n/panel.en.json'), {})));
const hi = new Set(flatKeys(readJson(path.join(ROOT, 'src/panel/i18n/panel.hi.json'), {})));
const onlyEn = [...en].filter((k) => !hi.has(k));
const onlyHi = [...hi].filter((k) => !en.has(k));
if (onlyEn.length || onlyHi.length) fail('i18n-parity', 'panel.{en,hi}.json', `en-only: ${onlyEn.join(',')} hi-only: ${onlyHi.join(',')}`);
else ok('i18n-parity', 'panel.{en,hi}.json', `${en.size} keys`);

// --------------------------------------------------------- 8. Release ---

const labOptOut = LAB_BUILD && path.resolve(DIST) !== path.resolve(RELEASE_DIST);
if (LAB_BUILD && !labOptOut) {
    fail('release-lab-flag', 'dist-panel', 'PANEL_LAB_BUILD=1 needs PANEL_OUT_DIR outside dist-panel');
}
let releaseProblems = 0;
for (const file of files.filter((f) => /\.(?:js|html)$/.test(f))) {
    const src = sources.get(file) ?? fs.readFileSync(file, 'utf8');
    for (const problem of findReleaseProblems(src)) {
        releaseProblems++;
        if (labOptOut) info(`release-${problem.kind}`, rel(file), `lab build: ${problem.detail}`);
        else fail(`release-${problem.kind}`, rel(file), problem.detail);
    }
}
if (!releaseProblems) ok('release', path.basename(DIST), 'no login-root, no private backend URL');
else if (labOptOut) info('release', DIST, 'PANEL_LAB_BUILD=1: release checks reported only. Never ship this build.');

for (const entry of allowEntries) {
    if (!entry.used) info('allowlist-unused', entry.api, entry.reason.slice(0, 90));
}

// ----------------------------------------------------------- report ---

sizeRows.sort((a, b) => b[2] - a[2]);
console.log('\nSizes (gzip -9)');
for (const [kind, name, size] of sizeRows) console.log(`  ${kind.padEnd(12)} ${fmt(size).padStart(10)}  ${name}`);
console.log(`  initial JS ${fmt(initialJsGz)} · initial CSS ${fmt(initialCssGz)} · total raw ${(totalRaw / KB / KB).toFixed(2)} MB`);

const verbose = process.argv.includes('--verbose');
console.log('\nChecks');
for (const row of results) {
    if (row.status === 'OK' && !verbose) continue;
    console.log(`  ${row.status.padEnd(5)} ${row.check.padEnd(22)} ${String(row.file).padEnd(36)} ${row.detail ?? ''}`);
}
const counts = results.reduce((acc, row) => ((acc[row.status] = (acc[row.status] || 0) + 1), acc), {});
console.log(`\n${counts.OK || 0} OK · ${counts.INFO || 0} INFO · ${counts.WARN || 0} WARN · ${counts.FAIL || 0} FAIL`);
process.exit(counts.FAIL ? 1 : 0);
