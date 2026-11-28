/**
 * Unit tests for the panel's device layer.
 *
 *   node node_modules/vitest/vitest.mjs run --config src/panel/device/vitest.config.mts
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
        include: ['src/panel/device/**/*.test.{ts,tsx}'],
    },
});
