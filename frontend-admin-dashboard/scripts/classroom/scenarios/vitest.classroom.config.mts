/**
 * Every Classroom frontend unit test: the panel, the phone page, the code they share,
 * the build scripts and the phone page's Pages Function.
 *
 *   node node_modules/vitest/vitest.mjs run --config scripts/classroom/scenarios/vitest.classroom.config.mts
 *
 * Separate from vite.config.ts, whose test.include lists route and service
 * folders only. src/routes/settings/-components/ClassroomPanels runs there.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export default defineConfig({
    root: ROOT,
    esbuild: { jsx: 'automatic' },
    resolve: { alias: { '@': path.join(ROOT, 'src') } },
    test: {
        globals: true,
        environment: 'happy-dom',
        setupFiles: ['.vitest/setup.ts', 'src/panel/device/testLocalStorage.ts'],
        include: [
            'src/panel/**/*.test.{ts,tsx}',
            'src/classroom-phone/**/*.test.{ts,tsx}',
            'src/classroom-shared/**/*.test.{ts,tsx}',
            'scripts/panel/**/*.test.ts',
            'scripts/classroom/**/*.test.ts',
        ],
    },
});
