/**
 * Vacademy Classroom: the phone page (dist/classroom.html + dist/classroom-assets).
 *
 * Runs after the main build and writes next to it, so it must not empty dist/ or
 * copy public/ again. Standalone on purpose, like vite.panel.config.ts: the main
 * config is a mode function that brings the router generator, manualChunks and
 * admin plugins.
 *
 *   node scripts/classroom/build-classroom-page.mjs                 # build + budget
 *   node node_modules/vite/bin/vite.js -c vite.classroom.config.ts  # dev, on /classroom
 */
import react from '@vitejs/plugin-react-swc';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import path from 'path';
import fs from 'fs';
import { defineConfig, type Plugin } from 'vite';

const ROOT = __dirname;
const TOKEN_MARKER = '/* classroom-tokens */';

/** A static tag in classroom.html would be followed by the main config's dev pre-scan. */
function classroomEntryScript(): Plugin {
    return {
        name: 'classroom-entry-script',
        transformIndexHtml: {
            order: 'pre',
            handler() {
                return [
                    {
                        tag: 'script',
                        attrs: { type: 'module', src: '/src/classroom-phone/main.tsx' },
                        injectTo: 'head',
                    },
                ];
            },
        },
    };
}

/**
 * The design tokens live in src/index.css, next to imports and globals far too big
 * for this page. Copying the two token blocks at build time means they cannot drift.
 * If the marker or the block goes missing the build fails, rather than shipping a
 * page with no colours.
 */
function classroomTokens(): Plugin {
    return {
        name: 'classroom-tokens',
        enforce: 'pre',
        transform(code, id) {
            if (!id.split('?')[0]!.endsWith('/src/classroom-phone/phone.css')) return null;
            if (!code.includes(TOKEN_MARKER)) this.error('[classroom] phone.css lost its marker');
            const source = fs.readFileSync(path.resolve(ROOT, 'src/index.css'), 'utf8');
            const block = /@layer base \{\s*:root \{[\s\S]*?\n\}/.exec(source)?.[0];
            if (!block || !block.includes('--primary-500') || !block.includes('.dark')) {
                this.error('[classroom] token block not found in src/index.css');
            }
            return { code: code.replace(TOKEN_MARKER, block!), map: null };
        },
    };
}

export default defineConfig({
    root: ROOT,
    publicDir: false,
    // Its own dev cache, so running this never invalidates the main app's.
    cacheDir: 'node_modules/.vite-classroom',
    resolve: { alias: { '@': path.resolve(ROOT, 'src') } },
    plugins: [react(), classroomEntryScript(), classroomTokens()],
    css: {
        postcss: {
            plugins: [
                tailwindcss({ config: path.resolve(ROOT, 'tailwind.classroom.config.mjs') }),
                autoprefixer(),
            ],
        },
    },
    server: { port: 5199, host: true, open: false },
    build: {
        outDir: path.resolve(ROOT, process.env.CLASSROOM_OUT_DIR || 'dist'),
        emptyOutDir: false,
        assetsDir: 'classroom-assets',
        target: 'es2020',
        sourcemap: false,
        modulePreload: { polyfill: false },
        reportCompressedSize: false,
        rollupOptions: {
            input: path.resolve(ROOT, 'classroom.html'),
        },
    },
    optimizeDeps: { entries: ['src/classroom-phone/main.tsx'] },
});
