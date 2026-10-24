/// <reference types="vitest" />
import react from '@vitejs/plugin-react-swc';
import path from 'path';
import fs from 'fs';
import { defineConfig, loadEnv } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import svgr from 'vite-plugin-svgr';
// import { VitePWA } from 'vite-plugin-pwa';
import flowbiteReact from 'flowbite-react/plugin/vite';
import { visualizer } from 'rollup-plugin-visualizer';

// https://vitejs.dev/config https://vitest.dev/config
export default defineConfig(({ mode }) => {
    // Load ALL env vars (including non-VITE_ ones like SLACK_BOT_TOKEN) for use
    // inside this config file only. Non-VITE_ vars are NEVER exposed to client code.
    const env = loadEnv(mode, process.cwd(), '');

    return {
        plugins: [
            react(),
            tsconfigPaths(),
            TanStackRouterVite(),
            // Temporarily disabled PWA plugin due to build error
            // VitePWA({
            //     registerType: 'autoUpdate',
            //     devOptions: {
            //         enabled: false,
            //     },
            //     includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'],
            //     manifest: {
            //         name: 'Admin Dashboard',
            //         short_name: 'Admin',
            //         description: 'Admin Dashboard Application',
            //         theme_color: '#ffffff',
            //         icons: [
            //             {
            //                 src: 'pwa-192x192.png',
            //                 sizes: '192x192',
            //                 type: 'image/png',
            //             },
            //             {
            //                 src: 'pwa-512x512.png',
            //                 sizes: '512x512',
            //                 type: 'image/png',
            //             },
            //         ],
            //     },
            //     workbox: {
            //         maximumFileSizeToCacheInBytes: 30 * 1024 * 1024, // 30MB
            //         globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,woff}'],
            //         runtimeCaching: [
            //             {
            //                 urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            //                 handler: 'CacheFirst',
            //                 options: {
            //                     cacheName: 'google-fonts-cache',
            //                     expiration: {
            //                         maxEntries: 10,
            //                         maxAgeSeconds: 60 * 60 * 24 * 365, // <== 365 days
            //                     },
            //                     cacheableResponse: {
            //                         statuses: [0, 200],
            //                     },
            //                 },
            //             },
            //         ],
            //     },
            // }),
            svgr({ include: '**/*.svg' }),
            // Emit one merged catalog per locale (locales/_merged/<lng>.json)
            // alongside the per-namespace files public/ already copies over.
            // src/i18n.ts fetches the merged file once and first render waits
            // for it — killing the load race where components (useMemo with []
            // deps, react-query fetchers capturing t() output) rendered before
            // their namespace arrived and froze raw keys permanently. Build-time
            // only: dev serves public/locales/* per-namespace and the backend
            // falls back to that automatically.
            {
                name: 'merged-locale-catalogs',
                apply: 'build' as const,
                generateBundle() {
                    const localesRoot = path.resolve(__dirname, 'public/locales');
                    if (!fs.existsSync(localesRoot)) return;
                    for (const lng of fs.readdirSync(localesRoot)) {
                        const dir = path.join(localesRoot, lng);
                        if (!fs.statSync(dir).isDirectory()) continue;
                        const merged: Record<string, unknown> = {};
                        for (const file of fs.readdirSync(dir)) {
                            if (!file.endsWith('.json')) continue;
                            merged[file.replace(/\.json$/, '')] = JSON.parse(
                                fs.readFileSync(path.join(dir, file), 'utf8')
                            );
                        }
                        this.emitFile({
                            type: 'asset',
                            fileName: `locales/_merged/${lng}.json`,
                            source: JSON.stringify(merged),
                        });
                    }
                },
            },
            // flowbiteReact(),
            // Replace CORS-blocked easy-email default images with local SVG placeholders.
            // Each preset thumbnail (IMAGE_08–IMAGE_71) maps to a unique wireframe SVG.
            {
                name: 'easy-email-placeholder-images',
                transform(code: string, id: string) {
                    if (
                        !id.includes('node_modules') ||
                        !code.includes('easy-email-m-ryan.vercel.app')
                    )
                        return;
                    // UUID prefix → local SVG path (67 preset thumbnails + 5 block defaults)
                    const urlMap: Record<string, string> = {
                        '06ca521d': '/email-editor/presets/preset-59.png',
                        e22f78f2: '/email-editor/presets/attr-panel-1.png',
                        '3e952a6e': '/email-editor/presets/attr-panel-2.png',
                        Fi_vI4vy: '/email-editor/presets/attr-panel-3.png',
                        '0046b247': '/email-editor/presets/preset-8.png',
                        be34fb18: '/email-editor/presets/preset-9.png',
                        '6a1e6292': '/email-editor/presets/preset-10.png',
                        '39b25f35': '/email-editor/presets/preset-11.png',
                        eaa83007: '/email-editor/presets/preset-12.png',
                        '9dec87bb': '/email-editor/presets/preset-13.png',
                        d285da5e: '/email-editor/presets/preset-14.png',
                        f69f48af: '/email-editor/presets/preset-15.png',
                        '9cce6b16': '/email-editor/presets/preset-16.png',
                        d9795c1d: '/email-editor/presets/preset-17.png',
                        '82f6f893': '/email-editor/presets/preset-18.png',
                        f1ece227: '/email-editor/presets/preset-19.png',
                        '585b48f6': '/email-editor/presets/preset-20.png',
                        '9755d667': '/email-editor/presets/preset-21.png',
                        '7487ce49': '/email-editor/presets/preset-22.png',
                        c3463b9e: '/email-editor/presets/preset-23.png',
                        '1f45e84a': '/email-editor/presets/preset-24.png',
                        '6b8b234e': '/email-editor/presets/preset-25.png',
                        aa50c2c9: '/email-editor/presets/preset-26.png',
                        '9e935e54': '/email-editor/presets/preset-27.png',
                        '799564d8': '/email-editor/presets/preset-28.png',
                        af34a548: '/email-editor/presets/preset-29.png',
                        '84014a93': '/email-editor/presets/preset-30.png',
                        dd1584fb: '/email-editor/presets/preset-31.png',
                        '76e3d8e2': '/email-editor/presets/preset-32.png',
                        '898b791e': '/email-editor/presets/preset-33.png',
                        '49662d27': '/email-editor/presets/preset-34.png',
                        d2905fb1: '/email-editor/presets/preset-35.png',
                        '9c3e9949': '/email-editor/presets/preset-36.png',
                        '1865e3a6': '/email-editor/presets/preset-37.png',
                        '2a6d82e2': '/email-editor/presets/preset-38.png',
                        '9f97bda2': '/email-editor/presets/preset-39.png',
                        b8f00c77: '/email-editor/presets/preset-40.png',
                        '5fc6be85': '/email-editor/presets/preset-41.png',
                        f6c9c054: '/email-editor/presets/preset-42.png',
                        '80e108b0': '/email-editor/presets/preset-43.png',
                        '14b9e878': '/email-editor/presets/preset-44.png',
                        b42f3cd8: '/email-editor/presets/preset-45.png',
                        e737972a: '/email-editor/presets/preset-46.png',
                        '0e3ae071': '/email-editor/presets/preset-47.png',
                        '0ec46619': '/email-editor/presets/preset-48.png',
                        '01830aec': '/email-editor/presets/preset-49.png',
                        '9f1cee25': '/email-editor/presets/preset-50.png',
                        e138143f: '/email-editor/presets/preset-51.png',
                        ac75b655: '/email-editor/presets/preset-52.png',
                        '3c505a1b': '/email-editor/presets/preset-53.png',
                        '7f98eeec': '/email-editor/presets/preset-54.png',
                        a7f5ae44: '/email-editor/presets/preset-55.png',
                        efdeeced: '/email-editor/presets/preset-56.png',
                        '425c6017': '/email-editor/presets/preset-57.png',
                        '858ea699': '/email-editor/presets/preset-58.png',
                        '199eacfa': '/email-editor/presets/preset-60.png',
                        f43b67dc: '/email-editor/presets/preset-61.png',
                        '318e911c': '/email-editor/presets/preset-62.png',
                        ed70ddb1: '/email-editor/presets/preset-63.png',
                        fb7dd6fa: '/email-editor/presets/preset-64.png',
                        '7bf8c363': '/email-editor/presets/preset-65.png',
                        '0330a1e9': '/email-editor/presets/preset-66.png',
                        a7deb6bc: '/email-editor/presets/preset-67.png',
                        '52c50319': '/email-editor/presets/preset-68.png',
                        '9994cef3': '/email-editor/presets/preset-69.png',
                        e5dd7a7e: '/email-editor/presets/preset-70.png',
                        '53277265': '/email-editor/presets/preset-71.png',
                    };
                    let result = code;
                    // Replace each known URL by matching UUID prefix
                    for (const [prefix, localPath] of Object.entries(urlMap)) {
                        const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        const re = new RegExp(
                            'https://easy-email-m-ryan\\.vercel\\.app/images/' +
                                escaped +
                                '[^"\'\\s)]*',
                            'g'
                        );
                        result = result.replace(re, localPath);
                    }
                    // Catch any remaining URLs → generic placeholder
                    result = result.replace(
                        /https:\/\/easy-email-m-ryan\.vercel\.app\/images\/[^"'\s)]+/g,
                        '/email-editor/placeholder-image.png'
                    );
                    // Base URL (href links)
                    result = result.replace(/https:\/\/easy-email-m-ryan\.vercel\.app\//g, '/');
                    if (result !== code) {
                        return { code: result, map: null };
                    }
                },
            },
            // Bundle analyzer — OPT-IN ONLY (`ANALYZE=true pnpm build`).
            //
            // This used to run on every build, including Cloudflare Pages. It
            // gzip(level 9) + brotli(quality 11, the slowest setting) compresses
            // EVERY module in the graph — ~17,900 of them — after Rollup is
            // otherwise finished. That was several minutes of pure CPU on every
            // deploy, and it emitted a 10 MB dist/stats.html that got published
            // (exposing the full source-tree layout) and re-uploaded every time.
            //
            // Run it locally when you actually want to look at the treemap.
            ...(process.env.ANALYZE
                ? [
                      visualizer({
                          filename: 'dist/stats.html',
                          open: false,
                          gzipSize: true,
                          brotliSize: true,
                          template: 'treemap', // 'sunburst', 'network', 'treemap'
                      }),
                  ]
                : []),
        ],
        // plugins: [react(), tsconfigPaths(), svgr({ include: "**/*.svg" })],

        build: {
            rollupOptions: {
                external: (id) => {
                    // Handle problematic dependencies
                    if (id.includes('woff2-wasm')) return true;
                    // Don't externalize pyodide - it needs to be bundled
                    if (id.includes('pyodide')) return false;
                    return false;
                },
                onLog(level, log, handler) {
                    // Suppress circular dependency warnings for known safe cases
                    if (log.code === 'CIRCULAR_DEPENDENCY' && log.message?.includes('pako')) return;
                    handler(level, log);
                },
                output: {
                    // Inline the CJS interop helper into every chunk that needs it
                    // instead of sharing one helper across chunks. Sharing was the
                    // root cause of "Cannot access 'w' before initialization":
                    // Rollup put `getDefaultExportFromCjs` in chart-vendor and made
                    // react-vendor import it back, creating chart-vendor ↔
                    // react-vendor circular chunk dep, leaving React (`w`) in TDZ
                    // when chart-vendor evaluated first.
                    interop: 'esModule',
                    manualChunks(id) {
                        if (id.includes('node_modules')) {
                            // Core React
                            if (id.includes('/react/') || id.includes('/react-dom/'))
                                return 'react-vendor';

                            // Routing & State
                            if (
                                id.includes('/react-router-dom/') ||
                                id.includes('/@tanstack/react-router/') ||
                                id.includes('/zustand/')
                            )
                                return 'routing-vendor';

                            // PDF Tools (heavy)
                            if (
                                id.includes('/jspdf/') ||
                                id.includes('/html2canvas/') ||
                                id.includes('/pdf-lib/') ||
                                id.includes('/pdfjs-dist/') ||
                                id.includes('/@react-pdf-viewer/') ||
                                id.includes('/react-pdf/') ||
                                id.includes('/@react-pdf/') ||
                                id.includes('/pdfkit/') ||
                                id.includes('/@pdfme/')
                            )
                                return 'pdf-tools-vendor';

                            // UI Components
                            if (id.includes('/@radix-ui/react-')) return 'ui-vendor';

                            // Utility Libraries
                            if (
                                id.includes('/lodash/') ||
                                id.includes('/date-fns/') ||
                                id.includes('/axios/') ||
                                id.includes('/clsx/') ||
                                id.includes('/class-variance-authority/')
                            )
                                return 'utils-vendor';

                            // Heavy Libraries - Excalidraw (whiteboard/slides)
                            if (
                                id.includes('/@excalidraw/') ||
                                id.includes('/roughjs/') ||
                                id.includes('/perfect-freehand/')
                            )
                                return 'excalidraw-vendor';

                            // Audio - Howler (sound effect scheduler for AI videos)
                            if (id.includes('/howler/')) return 'audio-vendor';

                            // Heavy Libraries - GrapesJS (email editor)
                            if (id.includes('/grapesjs/')) return 'grapes-vendor';

                            // Heavy Libraries - Mermaid/ELK/ReactFlow (diagrams)
                            if (
                                id.includes('/mermaid/') ||
                                id.includes('/elkjs/') ||
                                id.includes('/dagre/') ||
                                id.includes('/reactflow/') ||
                                id.includes('/@reactflow/')
                            )
                                return 'diagram-vendor';

                            // Heavy Libraries - Rich Text Editors (jQuery + MathQuill must load together)
                            if (
                                id.includes('/quill/') ||
                                id.includes('/react-quill/') ||
                                id.includes('/jquery/') ||
                                id.includes('/mathquill/') ||
                                id.includes('/mathquill4quill/')
                            )
                                return 'quill-vendor';
                            if (id.includes('/@tiptap/')) return 'tiptap-vendor';
                            if (id.includes('/@yoopta/')) return 'yoopta-vendor';
                            if (id.includes('/@lexical/') || id.includes('/node_modules/lexical/'))
                                return 'lexical-vendor';

                            // Heavy Libraries - Monaco Editor (code)
                            if (id.includes('/@monaco-editor/') || id.includes('/monaco-editor/'))
                                return 'monaco-vendor';

                            // d3 must be in its own chunk so recharts can import it as a
                            // fully-initialized module; bundling them together causes TDZ crashes
                            // ("Cannot access 'X' before initialization") in minified prod builds.
                            // NOTE: recharts imports d3 from `victory-vendor/d3-*`, NOT directly,
                            // so victory-vendor MUST be matched here too.
                            if (
                                id.includes('/d3-') ||
                                id.includes('/d3/') ||
                                id.includes('/victory-vendor/') ||
                                id.includes('/internmap/') ||
                                id.includes('/delaunator/') ||
                                id.includes('/robust-predicates/')
                            )
                                return 'd3-vendor';

                            // NOTE: recharts is intentionally NOT manually chunked.
                            // Manually chunking recharts caused circular chunk deps
                            // (chart-vendor ↔ react-vendor) that triggered TDZ
                            // "Cannot access 'w' before initialization" where 'w'
                            // was React. Letting Rollup auto-chunk recharts avoids
                            // this entirely.

                            // Heavy Libraries - Canvas/Fabric
                            if (id.includes('/fabric/')) return 'fabric-vendor';

                            // Heavy Libraries - Presentations
                            if (id.includes('/reveal.js/') || id.includes('/pptxgenjs/'))
                                return 'presentation-vendor';

                            // Heavy Libraries - Firebase
                            if (id.includes('/firebase/') || id.includes('/@firebase/'))
                                return 'firebase-vendor';

                            // Heavy Libraries - Math rendering
                            if (id.includes('/katex/')) return 'katex-vendor';

                            // Consolidated Icons (all icon libraries)
                            if (
                                id.includes('/phosphor-react/') ||
                                id.includes('/@phosphor-icons/') ||
                                id.includes('/lucide-react/') ||
                                id.includes('/react-icons/')
                            )
                                return 'icons-vendor';

                            // TanStack Query
                            if (id.includes('/@tanstack/react-query')) return 'query-vendor';

                            // Flowbite UI
                            if (id.includes('/flowbite/') || id.includes('/flowbite-react/'))
                                return 'flowbite-vendor';

                            // Animation libraries
                            if (id.includes('/framer-motion/')) return 'motion-vendor';

                            // Other heavy deps
                            if (id.includes('/pyodide/')) return 'pyodide-vendor';
                            if (id.includes('/papaparse/')) return 'csv-vendor';
                            if (id.includes('/mammoth/')) return 'docx-vendor';
                            if (id.includes('/socket.io/')) return 'socket-vendor';
                            if (id.includes('/intro.js/')) return 'intro-vendor';
                            if (id.includes('/prismjs/')) return 'prism-vendor';
                            if (id.includes('/@dnd-kit/')) return 'dnd-vendor';
                            if (id.includes('/reactflow/')) return 'flow-vendor';
                            if (id.includes('/@sentry/')) return 'sentry-vendor';
                            if (id.includes('/i18next/') || id.includes('/react-i18next/'))
                                return 'i18n-vendor';
                            if (id.includes('/@amplitude/')) return 'amplitude-vendor';
                        }
                    },
                },
                onwarn: (warning, warn) => {
                    warn(warning);
                },
                // Reduce parallel operations to save memory.
                // Measured 2026-07-28: raising this to 8 made the build *slower*
                // (1m25s vs 1m15s) — the build is CPU-bound in transform/render,
                // not blocked on file I/O. Leave at 2; it costs nothing.
                maxParallelFileOps: 2,
            },
            target: 'esnext',
            minify: 'esbuild', // Use esbuild instead of terser for faster, less memory-intensive builds
            chunkSizeWarningLimit: 1000,
            assetsInlineLimit: 0, // Disable asset inlining to prevent issues
            sourcemap: false, // Disable sourcemaps in production to save memory
            reportCompressedSize: false, // Skip compressed size reporting to save memory
            // Worker-specific options are configured at the top-level `worker` field if needed
        },
        define: {
            __VERSION__: JSON.stringify('0.16.11'),
        },
        resolve: {
            alias: [
                { find: '@', replacement: path.resolve(__dirname, './src') },
                {
                    find: /^@excalidraw\/excalidraw$/,
                    replacement: path.resolve(
                        __dirname,
                        './src/components/common/excalidraw/packages/excalidraw/index.tsx'
                    ),
                },
                {
                    find: /^@excalidraw\/excalidraw\/(.*)/,
                    replacement: path.resolve(
                        __dirname,
                        './src/components/common/excalidraw/packages/excalidraw/$1'
                    ),
                },
                {
                    find: /^@excalidraw\/utils$/,
                    replacement: path.resolve(
                        __dirname,
                        './src/components/common/excalidraw/packages/utils/index.ts'
                    ),
                },
                {
                    find: /^@excalidraw\/utils\/(.*)/,
                    replacement: path.resolve(
                        __dirname,
                        './src/components/common/excalidraw/packages/utils/$1'
                    ),
                },
                {
                    find: /^@excalidraw\/math$/,
                    replacement: path.resolve(
                        __dirname,
                        './src/components/common/excalidraw/packages/math/index.ts'
                    ),
                },
                {
                    find: /^@excalidraw\/math\/(.*)/,
                    replacement: path.resolve(
                        __dirname,
                        './src/components/common/excalidraw/packages/math/$1'
                    ),
                },
            ],
        },
        assetsInclude: ['**/*.wasm'],
        test: {
            globals: true,
            environment: 'happy-dom',
            setupFiles: '.vitest/setup',
            // `**/test.{ts,tsx}` came in with the vendored excalidraw setup and
            // matches only files named literally `test.ts`, so no `*.test.ts`
            // in this repo has ever run. Route- and service-local tests are
            // added explicitly rather than by widening to `src/**/*.test.*`,
            // which would sweep in excalidraw's vendored suite (it lives under
            // src/components/common/excalidraw) and its own harness.
            include: [
                '**/test.{ts,tsx}',
                'src/routes/**/*.test.{ts,tsx}',
                'src/services/**/*.test.{ts,tsx}',
                'src/constants/**/*.test.{ts,tsx}',
                'src/lib/**/*.test.{ts,tsx}',
                'src/i18n/**/*.test.{ts,tsx}',
                'src/components/templates/**/*.test.{ts,tsx}',
                'src/components/common/layout-container/sidebar/**/*.test.{ts,tsx}',
                'src/components/shared/whatsapp/**/*.test.{ts,tsx}',
                'src/components/common/study-library/add-course/**/*.test.{ts,tsx}',
                'src/components/common/payments/**/*.test.{ts,tsx}',
            ],
        },
        server: {
            headers: {
                'Cross-Origin-Embedder-Policy': 'credentialless',
                'Cross-Origin-Opener-Policy': 'same-origin',
                'Cross-Origin-Resource-Policy': 'cross-origin',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
                'Access-Control-Allow-Headers': 'X-Requested-With, content-type, Authorization',
                'Content-Security-Policy':
                    "default-src * 'unsafe-inline' 'unsafe-eval' data: blob: wasm:; worker-src * blob:; frame-src *; frame-ancestors 'self' https://www.youtube.com https://youtube.com https://*.youtube.com;",
            },
            proxy: {
                // --- Local backend microservices ---------------------------------
                // Active only when VITE_BACKEND_URL points at this dev origin (see
                // .env.development.local). Each service runs on its own port and
                // serves its own "/<name>-service/..." path prefix, so NO rewrite is
                // needed. When VITE_BACKEND_URL is the default staging URL these
                // routes are never hit (requests go straight to the absolute host).
                // ai-service is a Python/FastAPI app run via uvicorn on :8077.
                '/auth-service': { target: 'http://localhost:8071', changeOrigin: true },
                '/admin-core-service': { target: 'http://localhost:8072', changeOrigin: true },
                '/community-service': { target: 'http://localhost:8073', changeOrigin: true },
                '/assessment-service': { target: 'http://localhost:8074', changeOrigin: true },
                '/media-service': { target: 'http://localhost:8075', changeOrigin: true },
                '/notification-service': { target: 'http://localhost:8076', changeOrigin: true },
                '/ai-service': { target: 'http://localhost:8077', changeOrigin: true },
                '/youtube': {
                    target: 'https://www.youtube.com',
                    changeOrigin: true,
                    rewrite: (path) => path.replace(/^\/youtube/, ''),
                    secure: false,
                    headers: {
                        'Access-Control-Allow-Origin': '*',
                    },
                },
                // Slack Web API proxy. Token injected server-side from SLACK_BOT_TOKEN
                // in .env.local — never reaches the browser. Mirror of
                // functions/slack-api/[[path]].js used in production on Cloudflare Pages.
                '/slack-api': {
                    target: 'https://slack.com/api',
                    changeOrigin: true,
                    rewrite: (path) => path.replace(/^\/slack-api/, ''),
                    secure: true,
                    configure: (proxy) => {
                        proxy.on('proxyReq', (proxyReq) => {
                            const token = env.SLACK_BOT_TOKEN;
                            if (token) {
                                proxyReq.setHeader('Authorization', `Bearer ${token}`);
                            }
                        });
                    },
                },
                // Slack file upload host — pre-signed URL carries its own auth.
                // We proxy only to bypass browser CORS. No token injection.
                '/slack-files': {
                    target: 'https://files.slack.com',
                    changeOrigin: true,
                    rewrite: (path) => path.replace(/^\/slack-files/, ''),
                    secure: true,
                },
            },
            cors: true,
            hmr: {
                protocol: 'ws',
                host: 'localhost',
            },
        },
        optimizeDeps: {
            exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util', 'pyodide'],
            include: [
                'react',
                'react-dom',
                'react-router-dom',
                'axios',
                'lodash',
                'date-fns',
                'pako',
                '@tanstack/react-router',
                '@tanstack/router-devtools',
                // easy-email editor deps — pin for deterministic CSS order
                'easy-email-core',
                'easy-email-editor',
                'react-final-form',
                'mjml-browser',
                // recharts has internal circular deps that only break in minified prod builds;
                // pre-bundling with esbuild resolves the TDZ "Cannot access before initialization" crash
                'recharts',
            ],
            esbuildOptions: {
                target: 'esnext',
                supported: {
                    bigint: true,
                },
            },
            force: true, // Force re-optimization to fix dependency issues
        },
    };
});
