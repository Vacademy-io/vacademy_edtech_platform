// vite.config.ts
import { defineConfig, type Plugin } from "vite";
// SWC, not Babel: same JSX/Fast-Refresh output, and the transform phase of a
// production build (the longest phase for this app's ~1,500 source files) runs
// several times faster. No Babel plugins were configured, so nothing is lost.
import viteReact from "@vitejs/plugin-react-swc";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import path from "path";
import svgr from "vite-plugin-svgr";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "fs";

/**
 * @spatius/avatarkit (premium teacher avatar) loads its Emscripten core at
 * runtime from `/assets/avatar_core_wasm-<hash>.wasm`, resolved from the
 * bundled glue's import.meta.url. Vite does not know about that file, so the
 * lesson stayed on "Loading your teacher…" with a 404. The SDK's own Vite
 * plugin does this copy too, but it also overwrites dist/_headers, which
 * carries our Cloudflare Pages header rules, so this is a copy-only version.
 */
const avatarkitWasm = () => {
    let root = "";
    return {
        name: "avatarkit-wasm-copy",
        configResolved(config: { root: string }) {
            root = config.root;
        },
        closeBundle() {
            const src = path.join(root, "node_modules/@spatius/avatarkit/dist");
            if (!existsSync(src)) {
                console.warn("[avatarkit] package not installed; teacher avatar will not load");
                return;
            }
            const out = path.join(root, "dist/assets");
            mkdirSync(out, { recursive: true });
            for (const f of readdirSync(src)) {
                if (f.startsWith("avatar_core_wasm") && f.endsWith(".wasm")) {
                    copyFileSync(path.join(src, f), path.join(out, f));
                    console.log(`[avatarkit] copied ${f} to dist/assets`);
                }
            }
        },
    };
};

// Embedded JS bundle version, read from package.json at build time. The OTA
// check uses this as the "current bundle version" on a fresh install (before
// any OTA bundle is applied), so it compares JS-to-JS instead of falling back
// to the native app version — whose numbering space (1.0.x) differs from the
// OTA bundle scheme (2.2.x) and would make every published bundle look newer.
const pkgVersion: string = JSON.parse(
    readFileSync(path.resolve(__dirname, "package.json"), "utf-8"),
).version;

/**
 * Every @font-face we ship (the 20 KaTeX faces, mathquill's Symbola, …) lists the
 * same face three or four times — woff2 plus woff/ttf/eot/svg fallbacks for
 * browsers that died a decade ago. Vite emits every url() it sees, so the app
 * bundle carried ~3 MB of font files no target of ours can even select: Android
 * WebView, WKWebView, Electron and every browser we support pick woff2 first.
 * Rewrite each src list down to its woff2 entry (keeping any local() hints),
 * then drop the emitted fallback files that nothing references any more.
 * Only faces that HAVE a woff2 source are touched; a woff-only face keeps its
 * list. Build-only: dev serves node_modules CSS untouched.
 */
const splitTopLevel = (s: string, sep: string): string[] => {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === "(") depth++;
        else if (c === ")") depth--;
        else if (c === sep && depth === 0) {
            parts.push(s.slice(start, i));
            start = i + 1;
        }
    }
    parts.push(s.slice(start));
    return parts;
};

const isWoff2Source = (entry: string): boolean =>
    /format\(\s*["']?woff2["']?\s*\)/i.test(entry) ||
    /\.woff2(?:[?#][^)]*)?\s*\)/i.test(entry) ||
    /data:(?:font|application)\/(?:x-)?(?:font-)?woff2/i.test(entry);

const pruneFontFaceSrc = (css: string): string => {
    let out = "";
    let last = 0;
    const open = /@font-face\s*\{/gi;
    let m: RegExpExecArray | null;
    while ((m = open.exec(css))) {
        const bodyStart = m.index + m[0].length;
        let depth = 0;
        let j = bodyStart;
        for (; j < css.length; j++) {
            const c = css[j];
            if (c === "(") depth++;
            else if (c === ")") depth--;
            else if (c === "}" && depth === 0) break;
        }
        const body = css.slice(bodyStart, j);
        const decls = splitTopLevel(body, ";");
        const isSrc = (decl: string) => {
            const colon = decl.indexOf(":");
            return colon >= 0 && decl.slice(0, colon).trim().toLowerCase() === "src";
        };
        const srcEntries = (decl: string) => splitTopLevel(decl.slice(decl.indexOf(":") + 1), ",");
        // Untouched unless at least one src list offers woff2.
        const hasWoff2 = decls.some((d) => isSrc(d) && srcEntries(d).some(isWoff2Source));
        const rewritten = !hasWoff2
            ? body
            : decls
                  .map((decl) => {
                      if (!isSrc(decl)) return decl;
                      const entries = srcEntries(decl);
                      // The "src: url(x.eot);" line that precedes the real list is
                      // the IE9 hack — the woff2 list that follows supersedes it.
                      if (!entries.some(isWoff2Source)) return null;
                      const kept = entries.filter((e) => isWoff2Source(e) || /^\s*local\(/i.test(e));
                      return decl.slice(0, decl.indexOf(":") + 1) + kept.join(",");
                  })
                  .filter((d): d is string => d !== null)
                  .join(";");
        out += css.slice(last, bodyStart) + rewritten;
        last = j;
        open.lastIndex = j;
    }
    return out + css.slice(last);
};

const pruneFontFallbacks = (): Plugin => ({
    name: "prune-font-fallbacks",
    apply: "build",
    generateBundle(_options, bundle) {
        let cssRewritten = 0;
        for (const [fileName, out] of Object.entries(bundle)) {
            if (out.type !== "asset" || !fileName.endsWith(".css")) continue;
            const css = typeof out.source === "string" ? out.source : Buffer.from(out.source).toString("utf8");
            const pruned = pruneFontFaceSrc(css);
            if (pruned !== css) {
                out.source = pruned;
                cssRewritten++;
            }
        }
        // Anything still mentioned by name in a chunk or a text asset stays; the
        // rest of the eot/ttf/woff/svg files were only ever reachable through the
        // src entries just removed.
        const referenced = new Set<string>();
        for (const out of Object.values(bundle)) {
            const text = out.type === "chunk" ? out.code : typeof out.source === "string" ? out.source : null;
            if (!text) continue;
            for (const hit of text.matchAll(/[\w.-]+\.(?:eot|ttf|woff2?|svg|otf)\b/gi)) referenced.add(hit[0]);
        }
        let dropped = 0;
        let droppedBytes = 0;
        for (const [fileName, out] of Object.entries(bundle)) {
            const base = fileName.slice(fileName.lastIndexOf("/") + 1);
            if (out.type !== "asset" || !/\.(?:eot|ttf|woff|svg)$/i.test(base) || referenced.has(base)) continue;
            droppedBytes += typeof out.source === "string" ? out.source.length : out.source.byteLength;
            dropped++;
            delete bundle[fileName];
        }
        console.log(
            `[prune-font-fallbacks] rewrote ${cssRewritten} stylesheet(s), dropped ${dropped} fallback font file(s) (${(droppedBytes / 1024 / 1024).toFixed(1)} MB)`,
        );
    },
});

/**
 * Opt-in chunk report (`ANALYZE=1 pnpm build`): writes dist/chunk-report.txt
 * listing every chunk with its rendered size and the modules inside it, biggest
 * first. No dependency, no sourcemaps — Rollup already knows each module's
 * rendered length. Use it to see what a "vendor" chunk really carries before
 * reaching for manualChunks.
 */
const chunkReport = (): Plugin => ({
    name: "chunk-report",
    apply: "build",
    generateBundle(_options, bundle) {
        if (!process.env.ANALYZE) return;
        const lines: string[] = [];
        const chunks = Object.values(bundle)
            .filter((o): o is Extract<typeof o, { type: "chunk" }> => o.type === "chunk")
            .sort((a, b) => b.code.length - a.code.length);
        for (const chunk of chunks) {
            lines.push(`\n=== ${chunk.fileName}  ${(chunk.code.length / 1024).toFixed(0)} KB  (${Object.keys(chunk.modules).length} modules)`);
            const mods = Object.entries(chunk.modules)
                .map(([id, m]) => [id.replace(/^.*node_modules\//, "~/").replace(/^.*\/frontend-learner-dashboard-app\//, ""), m.renderedLength] as const)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 40);
            for (const [id, len] of mods) lines.push(`${String((len / 1024).toFixed(1)).padStart(9)} KB  ${id}`);
        }
        this.emitFile({ type: "asset", fileName: "chunk-report.txt", source: lines.join("\n") });
    },
});

// https://vitejs.dev/config/
export default defineConfig({
    define: {
        __APP_VERSION__: JSON.stringify(pkgVersion),
        // Mac App Store build flag. Read from process.env at config time —
        // Vite does NOT put process.env vars into import.meta.env (it only
        // loads .env* files, and this project has none), so an env-var-only
        // approach silently compiles to `false`. Build with
        // VITE_MAC_APP_STORE=true to turn on reader mode for the MAS package.
        __MAC_APP_STORE__: JSON.stringify(process.env.VITE_MAC_APP_STORE === "true"),
        // Which white-label flavor an Electron build is. Same trap as above: the
        // build scripts export VITE_ELECTRON_APP_ID, but with no .env* files that
        // never reaches import.meta.env — it read back as `undefined`, so every
        // desktop flavor fell through to the "io.vacademy.student.app" default and
        // resolved SSDC Horizon's domain. Empty string on web/mobile, where the
        // appId comes from Capacitor instead.
        __ELECTRON_APP_ID__: JSON.stringify(process.env.VITE_ELECTRON_APP_ID || ""),
    },
    plugins: [
        TanStackRouterVite(),
        viteReact(),
        avatarkitWasm(),
        pruneFontFallbacks(),
        chunkReport(),
        svgr({
            include: "**/*.svg",
            exclude: [
                "**/ssdc-logo*.svg",
                "**/ssdc_logo.svg",
                "**/registration-logo.svg"
            ]
        }),
    ],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    server: {
        host: true,
        port: 8100,
        // Dev-only: allow ngrok tunnels so a phone on mobile data can reach the
        // local backends through this dev server's /-service proxies.
        allowedHosts: ['.ngrok-free.dev', '.ngrok-free.app'],
        headers: {
            'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
        },
        // --- Local backend microservices -------------------------------------
        // Active only when VITE_BACKEND_URL points at this dev origin (see
        // .env.development.local). Each service runs on its own port and serves
        // its own "/<name>-service/..." path prefix, so NO rewrite is needed.
        // When VITE_BACKEND_URL is the default staging URL these routes are
        // never hit. ai-service is a Python/FastAPI app run via uvicorn on :8077.
        proxy: {
            '/auth-service': { target: 'http://localhost:8071', changeOrigin: true },
            '/admin-core-service': { target: 'http://localhost:8072', changeOrigin: true },
            '/community-service': { target: 'http://localhost:8073', changeOrigin: true },
            '/assessment-service': { target: 'http://localhost:8074', changeOrigin: true },
            '/media-service': { target: 'http://localhost:8075', changeOrigin: true },
            '/notification-service': { target: 'http://localhost:8076', changeOrigin: true },
            '/ai-service': { target: 'http://localhost:8077', changeOrigin: true },
        },
    },
    esbuild: {
        // Strip noisy console.* from PRODUCTION bundles only — minify drops these
        // pure-annotated unused calls; dev serve (no minify) keeps them.
        // console.warn / console.error are intentionally preserved.
        pure: ['console.log', 'console.info', 'console.debug'],
    },
    build: {
        // Optimize build for memory usage
        chunkSizeWarningLimit: 1000,
        // Disable source maps for smaller builds
        sourcemap: false,
        rollupOptions: {
            output: {
                // Cloudflare Pages serves /assets with immutable caching, and we
                // have shipped builds where a bundle KEPT its filename while its
                // content changed — browsers then hold the stale bundle forever
                // (no refresh helps). Stamp the deploy commit into every filename
                // so each deploy gets fresh URLs. CF_PAGES_COMMIT_SHA is set by
                // Cloudflare Pages; local builds are unaffected.
                entryFileNames: `assets/[name]-[hash]${process.env.CF_PAGES_COMMIT_SHA ? '-' + process.env.CF_PAGES_COMMIT_SHA.slice(0, 8) : ''}.js`,
                chunkFileNames: `assets/[name]-[hash]${process.env.CF_PAGES_COMMIT_SHA ? '-' + process.env.CF_PAGES_COMMIT_SHA.slice(0, 8) : ''}.js`,
                assetFileNames: `assets/[name]-[hash]${process.env.CF_PAGES_COMMIT_SHA ? '-' + process.env.CF_PAGES_COMMIT_SHA.slice(0, 8) : ''}[extname]`,
                // Conservative chunking strategy - only split truly independent heavy libs
                manualChunks: (id) => {

                    // Firebase - can be safely split as it's dynamically imported
                    if (id.includes('firebase/') || id.includes('@firebase/')) {
                        return 'firebase';
                    }

                    // Excalidraw - huge, must be separate for lazy loading
                    if (id.includes('@excalidraw/')) {
                        return 'excalidraw';
                    }

                    // Monaco Editor - large, for code editor feature
                    if (id.includes('@monaco-editor/') || id.includes('monaco-editor')) {
                        return 'monaco-editor';
                    }

                    // PDF Viewer - large, for PDF viewing feature  
                    if (id.includes('@react-pdf-viewer/')) {
                        return 'pdf-viewer';
                    }


                    // Pyodide - Python runtime, for code execution
                    if (id.includes('pyodide')) {
                        return 'pyodide';
                    }

                    // Quill editor - rich text editing.
                    // IMPORTANT: only match Quill *node_modules* — never src
                    // paths. The src/components/quill/* files transitively
                    // import axios (via use-file-upload → upload_file), and a
                    // bare `id.includes('quill')` was hoisting axios into the
                    // quill chunk, making *every* axios call drag in Quill +
                    // mathquill + jquery and triggering a circular-init
                    // ("Cannot access 'B' before initialization") on app load.
                    // jquery must live in this chunk too — mathquill reads
                    // window.jQuery at module-eval time, and the import order
                    // in MainViewQuillEditor.jsx only holds within one chunk.
                    if (
                        id.includes('node_modules/react-quill-new') ||
                        id.includes('node_modules/quill/') ||
                        id.includes('node_modules/quill-delta') ||
                        id.includes('node_modules/mathquill4quill') ||
                        id.includes('node_modules/@edtr-io/mathquill') ||
                        id.includes('node_modules/jquery')
                    ) {
                        return 'quill-editor';
                    }

                    // KaTeX - math rendering
                    if (id.includes('katex')) {
                        return 'katex';
                    }

                    // Charts libraries - for dashboard
                    if (id.includes('recharts') ||
                        id.includes('@nivo/') ||
                        id.includes('@visx/')) {
                        return 'charts';
                    }

                    // Huge Icon Libraries - Need to be split
                    if (id.includes('react-icons')) {
                        return 'react-icons';
                    }
                    if (id.includes('@phosphor-icons') || id.includes('phosphor-react')) {
                        return 'phosphor-icons';
                    }
                    if (id.includes('@tabler/icons-react')) {
                        return 'tabler-icons';
                    }

                    // Large Data Processing Libraries
                    if (id.includes('country-state-city')) {
                        return 'country-state-city';
                    }
                    if (id.includes('xlsx')) {
                        return 'excel-processor';
                    }
                    if (id.includes('mermaid')) {
                        return 'mermaid';
                    }
                    if (id.includes('lottie-react')) {
                        return 'lottie';
                    }
                    if (id.includes('framer-motion')) {
                        return 'framer-motion';
                    }

                    // Don't split React, Radix, or other core UI libs - keep them together
                    // This prevents forwardRef and other React primitive issues
                },
            },
        },
    },
    // Optimize dependency pre-bundling
    optimizeDeps: {
        include: [
            'react',
            'react-dom',
            '@tanstack/react-router',
            '@tanstack/react-query',
            'zustand',
            'axios',
            'clsx',
            'tailwind-merge',
        ],
        exclude: [
            '@excalidraw/excalidraw',
            'pyodide',
        ],
    },
});
