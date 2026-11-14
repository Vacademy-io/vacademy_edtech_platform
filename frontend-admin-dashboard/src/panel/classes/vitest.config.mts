/**
 * Unit tests for the panel's class screens.
 *
 *   node node_modules/vitest/vitest.mjs run --config src/panel/classes/vitest.config.mts
 */
import { defineConfig } from 'vitest/config';

const ROOT = new URL('../../../', import.meta.url).pathname;

export default defineConfig({
    root: ROOT,
    esbuild: { jsx: 'automatic' },
    resolve: { alias: { '@': `${ROOT}src` } },
    test: {
        globals: true,
        environment: 'happy-dom',
        setupFiles: ['.vitest/setup.ts', 'src/panel/device/testLocalStorage.ts'],
        include: ['src/panel/classes/**/*.test.{ts,tsx}'],
    },
});
