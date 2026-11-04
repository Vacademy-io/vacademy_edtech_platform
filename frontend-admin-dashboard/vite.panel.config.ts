/**
 * Vacademy Classroom — panel bundle build (dist-panel/).
 *
 * Standalone on purpose: it does NOT import or merge vite.config.ts (a mode
 * function that drags in TanStackRouterVite, manualChunks and the admin
 * plugins). Target is Chrome 66 = the frozen Android 9 AOSP WebView.
 *
 *   node scripts/panel/build-panel.mjs        # build + verify
 *   node node_modules/vite/bin/vite.js -c vite.panel.config.ts   # dev (desktop Chrome / API 33 only)
 */
import react from '@vitejs/plugin-react-swc';
import svgr from 'vite-plugin-svgr';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import postcss from 'postcss';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { defineConfig, type Plugin } from 'vite';
import panelLegacyCss from './scripts/panel/postcss-panel-legacy.mjs';

const ROOT = __dirname;
const SRC = path.resolve(ROOT, 'src');
const PANEL_SRC = path.resolve(SRC, 'panel');
const OUT_DIR = path.resolve(ROOT, 'dist-panel');
const MANIFEST_DIR = path.resolve(ROOT, 'node_modules/.cache/panel');
const TARGET = 'chrome66';

// core-js is NOT hoisted (only node_modules/.pnpm/core-js@3.44.0). Resolve it
// explicitly and fail loudly if the store changes under us.
const CORE_JS = [
    path.resolve(ROOT, 'node_modules/core-js'),
    path.resolve(ROOT, 'node_modules/.pnpm/core-js@3.44.0/node_modules/core-js'),
].find((dir) => fs.existsSync(path.join(dir, 'package.json')));
if (!CORE_JS) throw new Error('[panel] core-js@3.44.0 not found in node_modules or the pnpm store');
const coreJsVersion = JSON.parse(fs.readFileSync(path.join(CORE_JS, 'package.json'), 'utf8')).version;
if (coreJsVersion !== '3.44.0') {
    throw new Error(`[panel] expected core-js 3.44.0 at ${CORE_JS}, found ${coreJsVersion}`);
}

const STUB_MERMAID = path.resolve(PANEL_SRC, 'stubs/mermaid-to-excalidraw.ts');

// Resolved-path redirects (an alias is not enough: facultyAccessUtils.ts imports
// './axiosInstance' relatively).
const REDIRECTS: Record<string, string> = {
    [path.resolve(SRC, 'lib/auth/axiosInstance.ts')]: path.resolve(PANEL_SRC, 'lib/api.ts'),
    [path.resolve(SRC, 'lib/amplitude.ts')]: path.resolve(PANEL_SRC, 'stubs/amplitude.ts'),
    [path.resolve(SRC, 'components/common/excalidraw/packages/excalidraw/fonts/Xiaolai/index.ts')]:
        path.resolve(PANEL_SRC, 'stubs/xiaolai-fonts.ts'),
    // Font subsetting = a 725 KB gz wasm chunk + a {type:"module"} worker (Chrome 80);
    // only exportToSvg reaches it. The stub inlines the whole font instead.
    [path.resolve(SRC, 'components/common/excalidraw/packages/excalidraw/subset/subset-main.ts')]:
        path.resolve(PANEL_SRC, 'whiteboard/stubs/excalidraw-subset-main.ts'),
};

function gitSha(): string {
    try {
        return execSync('git rev-parse --short HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
            .toString()
            .trim();
    } catch {
        return 'unknown';
    }
}

const PANEL_BUILD = {
    version: JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version as string,
    gitSha: gitSha(),
    builtAt: new Date().toISOString(),
    target: TARGET,
};

function stripQuery(id: string): string {
    const q = id.indexOf('?');
    return q >= 0 ? id.slice(0, q) : id;
}

function panelRedirects(): Plugin {
    return {
        name: 'panel-redirects',
        enforce: 'pre',
        async resolveId(source, importer, options) {
            if (source === '@excalidraw/mermaid-to-excalidraw') return STUB_MERMAID;
            if (!importer || source.startsWith('\0')) return null;
            // core-js entry points, scoped to panel importers only: core-js@2.6.12 also
            // lives in the store and a global alias would silently remap its consumers.
            const coreJs = /^core-js\/(.*)$/.exec(source);
            if (coreJs && stripQuery(importer).startsWith(PANEL_SRC + path.sep)) {
                return this.resolve(path.join(CORE_JS!, coreJs[1]!), importer, {
                    ...options,
                    skipSelf: true,
                });
            }
            const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
            if (!resolved) return null;
            return REDIRECTS[path.normalize(stripQuery(resolved.id))] ?? null;
        },
        // package.json declares `sideEffects: ["*.css", …, "**/init.*"]`, which makes every
        // src module side-effect free — Rollup then DROPS side-effect-only imports such as
        // `import './polyfills'` (all of core-js vanished in the first build). Panel modules
        // are few and small, so treat them all as side-effectful.
        transform(_code, id) {
            if (stripQuery(id).startsWith(PANEL_SRC + path.sep)) {
                return { code: _code, map: null, moduleSideEffects: true };
            }
            return null;
        },
    };
}

/**
 * V8 6.6 (Chrome 66) lacks \p{Extended_Pictographic} (ES2019): the regex literal in the
 * fork's textWrapping.ts is an early SyntaxError that kills the whole shared Excalidraw
 * chunk (whiteboard AND Volt slides). Build it at runtime when supported, else fall
 * back to \p{Emoji_Presentation} plus the common text-presentation pictograph ranges.
 */
const EP_LITERAL = '/[\\p{Extended_Pictographic}\\p{Emoji_Presentation}]/u';
const EP_GUARDED =
    '(function(){try{return new RegExp("[\\\\p{Extended_Pictographic}\\\\p{Emoji_Presentation}]","u")}catch(e){return /[\\p{Emoji_Presentation}\\u{00A9}\\u{00AE}\\u{203C}\\u{2049}\\u{2122}\\u{2139}\\u{2194}-\\u{21AA}\\u{231A}-\\u{23FF}\\u{24C2}\\u{25AA}-\\u{27BF}\\u{2934}\\u{2935}\\u{2B05}-\\u{2B55}\\u{3030}\\u{303D}\\u{3297}\\u{3299}\\u{1F000}-\\u{1FAFF}]/u}})()';
function panelLegacyRegex(): Plugin {
    return {
        name: 'panel-legacy-regex',
        enforce: 'pre',
        transform(code, id) {
            if (!stripQuery(id).endsWith('/packages/excalidraw/element/textWrapping.ts')) return null;
            if (code.indexOf(EP_LITERAL) < 0) {
                this.error('[panel] textWrapping.ts: Extended_Pictographic literal not found');
            }
            return { code: code.replace(EP_LITERAL, EP_GUARDED), map: null };
        },
    };
}

/** Deck/video player namespaces, emitted from public/locales (publicDir is off: public/ is 46 MB). */
function panelLocales(): Plugin {
    const LANGS = ['en', 'hi'];
    const NAMESPACES = ['studyLibraryDeckPlayer', 'fileVideoPlayer'];
    return {
        name: 'panel-locales',
        apply: 'build',
        generateBundle() {
            for (const lng of LANGS) {
                for (const ns of NAMESPACES) {
                    const file = path.resolve(ROOT, 'public/locales', lng, `${ns}.json`);
                    if (!fs.existsSync(file)) {
                        this.warn(`[panel] locale file missing: ${file}`);
                        continue;
                    }
                    this.emitFile({
                        type: 'asset',
                        fileName: `locales/${lng}/${ns}.json`,
                        source: fs.readFileSync(file, 'utf8'),
                    });
                }
            }
        },
    };
}

/**
 * Re-run the legacy CSS pass on the FINAL (minified) CSS assets, so esbuild's
 * CSS minifier can never re-merge selectors the PostCSS step split apart.
 */
function panelFinalCss(): Plugin {
    return {
        name: 'panel-final-css',
        apply: 'build',
        enforce: 'post',
        async generateBundle(_options, bundle) {
            for (const file of Object.values(bundle)) {
                if (file.type !== 'asset' || !file.fileName.endsWith('.css')) continue;
                const source =
                    typeof file.source === 'string'
                        ? file.source
                        : Buffer.from(file.source).toString('utf8');
                const result = await postcss([panelLegacyCss()]).process(source, {
                    from: undefined,
                });
                file.source = result.css;
            }
        },
    };
}

/**
 * Inject the module entry into panel.html. It is not a static tag in panel.html because the
 * MAIN vite.config.ts has no optimizeDeps.entries, so its dev pre-scan globs **\/*.html and
 * would follow a static /src/panel/main.tsx into core-js specifiers only this config resolves
 * (review finding REG-1). 'pre' tags are still bundled by Vite's build-html plugin.
 */
function panelEntryScript(): Plugin {
    return {
        name: 'panel-entry-script',
        transformIndexHtml: {
            order: 'pre',
            handler(html) {
                if (/<script[^>]+src=["']\/src\/panel\/main\.tsx["']/.test(html)) return html;
                return [
                    {
                        tag: 'script',
                        attrs: { type: 'module', src: '/src/panel/main.tsx' },
                        injectTo: 'body',
                    },
                ];
            },
        },
    };
}

/** Capacitor serves only index.html (WebViewLocalServer.java:62,402). */
function panelHtmlToIndex(): Plugin {
    return {
        name: 'panel-html-to-index',
        apply: 'build',
        closeBundle() {
            const from = path.join(OUT_DIR, 'panel.html');
            const to = path.join(OUT_DIR, 'index.html');
            if (!fs.existsSync(from)) {
                if (fs.existsSync(to)) return; // already renamed (watch rebuild)
                throw new Error('[panel] dist-panel/panel.html was not emitted');
            }
            fs.renameSync(from, to);
        },
    };
}

/** {chunkFileName: moduleId[]} OUTSIDE dist-panel, read by verify-panel-dist.mjs. */
function panelModuleManifest(fileName: string): Plugin {
    return {
        name: `panel-module-manifest:${fileName}`,
        apply: 'build',
        generateBundle(_options, bundle) {
            const manifest: Record<string, string[]> = {};
            for (const chunk of Object.values(bundle)) {
                if (chunk.type !== 'chunk') continue;
                manifest[chunk.fileName] = Object.keys(chunk.modules).map((id) =>
                    id.startsWith(ROOT) ? path.relative(ROOT, id) : id
                );
            }
            fs.mkdirSync(MANIFEST_DIR, { recursive: true });
            const target = path.join(MANIFEST_DIR, fileName);
            // Worker builds run once per worker: merge instead of overwrite.
            let existing: Record<string, string[]> = {};
            if (fileName !== 'modules.json' && fs.existsSync(target)) {
                try {
                    existing = JSON.parse(fs.readFileSync(target, 'utf8'));
                } catch {
                    existing = {};
                }
            }
            fs.writeFileSync(target, JSON.stringify({ ...existing, ...manifest }, null, 1));
        },
    };
}

/** Start every build with a fresh worker manifest. */
function panelResetWorkerManifest(): Plugin {
    return {
        name: 'panel-reset-worker-manifest',
        apply: 'build',
        buildStart() {
            const target = path.join(MANIFEST_DIR, 'modules.workers.json');
            if (fs.existsSync(target)) fs.unlinkSync(target);
        },
    };
}

export default defineConfig({
    root: ROOT,
    base: './',
    publicDir: false,
    plugins: [
        panelResetWorkerManifest(),
        panelLegacyRegex(),
        panelRedirects(),
        react(),
        svgr({ include: '**/*.svg' }),
        panelEntryScript(),
        panelLocales(),
        panelFinalCss(),
        panelHtmlToIndex(),
        panelModuleManifest('modules.json'),
    ],
    define: {
        __VERSION__: JSON.stringify('0.16.11'),
        __PANEL_BUILD__: JSON.stringify(PANEL_BUILD),
    },
    resolve: {
        alias: [
            { find: /^pdfjs-dist$/, replacement: 'pdfjs-dist/legacy/build/pdf.js' },
            { find: '@', replacement: SRC },
            // The six @excalidraw aliases, verbatim from vite.config.ts.
            {
                find: /^@excalidraw\/excalidraw$/,
                replacement: path.resolve(
                    ROOT,
                    './src/components/common/excalidraw/packages/excalidraw/index.tsx'
                ),
            },
            {
                find: /^@excalidraw\/excalidraw\/(.*)/,
                replacement: path.resolve(
                    ROOT,
                    './src/components/common/excalidraw/packages/excalidraw/$1'
                ),
            },
            {
                find: /^@excalidraw\/utils$/,
                replacement: path.resolve(
                    ROOT,
                    './src/components/common/excalidraw/packages/utils/index.ts'
                ),
            },
            {
                find: /^@excalidraw\/utils\/(.*)/,
                replacement: path.resolve(ROOT, './src/components/common/excalidraw/packages/utils/$1'),
            },
            {
                find: /^@excalidraw\/math$/,
                replacement: path.resolve(
                    ROOT,
                    './src/components/common/excalidraw/packages/math/index.ts'
                ),
            },
            {
                find: /^@excalidraw\/math\/(.*)/,
                replacement: path.resolve(ROOT, './src/components/common/excalidraw/packages/math/$1'),
            },
        ],
    },
    css: {
        postcss: {
            plugins: [
                tailwindcss({ config: path.resolve(ROOT, 'tailwind.panel.config.mjs') }),
                autoprefixer({ overrideBrowserslist: ['chrome >= 66'] }),
                panelLegacyCss(),
            ],
        },
    },
    esbuild: {
        target: TARGET,
    },
    optimizeDeps: {
        esbuildOptions: {
            target: TARGET,
        },
    },
    assetsInclude: ['**/*.wasm'],
    worker: {
        // Chrome 66 has no module workers.
        format: 'iife',
        plugins: () => [panelModuleManifest('modules.workers.json')],
        rollupOptions: {
            output: {
                // Workers get no page polyfills; pdfjs' UMD wrapper reads bare `globalThis`
                // (Chrome 71) before its own core-js runs (owner decision 3).
                banner: 'if(typeof globalThis==="undefined"){self.globalThis=self;}',
            },
        },
    },
    build: {
        outDir: OUT_DIR,
        emptyOutDir: true,
        target: [TARGET],
        cssTarget: [TARGET],
        minify: 'esbuild',
        sourcemap: false,
        assetsInlineLimit: 0,
        reportCompressedSize: false,
        chunkSizeWarningLimit: 3000,
        rollupOptions: {
            input: { panel: path.resolve(ROOT, 'panel.html') },
            output: {
                manualChunks(id) {
                    if (
                        id.includes('/core-js@3.44.0/') ||
                        id.includes('/node_modules/core-js/') ||
                        id.includes('commonjsHelpers') ||
                        id === path.resolve(PANEL_SRC, 'polyfills.ts')
                    ) {
                        return 'panel-polyfills';
                    }
                    return undefined;
                },
            },
        },
    },
    server: {
        host: '127.0.0.1',
        port: 8766,
        strictPort: true,
    },
});
