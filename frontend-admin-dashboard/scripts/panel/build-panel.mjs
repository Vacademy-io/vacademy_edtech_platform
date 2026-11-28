#!/usr/bin/env node
/**
 * Build the Vacademy Classroom panel bundle and gate it.
 *
 *   node scripts/panel/build-panel.mjs            # vite build -c vite.panel.config.ts + verify
 *   node scripts/panel/build-panel.mjs --no-verify
 *
 * Independent of pnpm/npx: calls the local Vite binary with the current node.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function run(args, label) {
    const started = Date.now();
    const result = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    if (result.status !== 0) {
        console.error(`\n[build-panel] ${label} FAILED (exit ${result.status ?? result.signal}) after ${seconds}s`);
        process.exit(result.status || 1);
    }
    console.log(`[build-panel] ${label} OK in ${seconds}s`);
}

run(
    [
        '--max-old-space-size=6144',
        'node_modules/vite/bin/vite.js',
        'build',
        '-c',
        'vite.panel.config.ts',
    ],
    'vite build'
);
if (!process.argv.includes('--no-verify')) {
    run(['scripts/panel/verify-panel-dist.mjs'], 'verify-panel-dist');
}
