#!/usr/bin/env node
/**
 * Builds the Classroom phone page into dist/ after the main build, and checks its
 * size. Chained from the "build" script in package.json rather than "postbuild",
 * because whether a post script runs under pnpm depends on pnpm settings.
 *
 *   BUILD_CLASSROOM_PAGE=1  build; a build error or going over budget exits 1
 *   CF_PAGES set            build; the same problems only warn, the exit is always 0
 *   neither                 skip, so mobile and OTA bundles carry nothing
 *
 * CF_PAGES wins when both are set. The phone page must never be able to fail an
 * admin deploy: without dist/classroom.html, /classroom falls through to the
 * admin app and everything else is unaffected.
 *
 * CLASSROOM_BUDGET_GZ_KB overrides the budget, and CLASSROOM_OUT_DIR the output
 * directory, for tests of this script.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_DIR = path.resolve(APP_ROOT, process.env.CLASSROOM_OUT_DIR || 'dist');
const BUDGET_KB = Number(process.env.CLASSROOM_BUDGET_GZ_KB) || 120;
const BUILD_TIMEOUT_MS = 5 * 60 * 1000;

const onCloudflare = Boolean(process.env.CF_PAGES);
const forced = process.env.BUILD_CLASSROOM_PAGE === '1';

/** Measures the files that belong to the page: the HTML plus everything in classroom-assets. */
function measure() {
    const files = [path.join(OUT_DIR, 'classroom.html')];
    const assets = path.join(OUT_DIR, 'classroom-assets');
    if (fs.existsSync(assets)) {
        for (const name of fs.readdirSync(assets)) files.push(path.join(assets, name));
    }
    return files.map((file) => {
        const body = fs.readFileSync(file);
        return {
            name: path.relative(OUT_DIR, file),
            raw: body.length,
            gz: gzipSync(body, { level: 9 }).length,
        };
    });
}

function build() {
    // A rebuild would otherwise leave the previous hashed files behind and inflate the total.
    fs.rmSync(path.join(OUT_DIR, 'classroom-assets'), { recursive: true, force: true });
    fs.rmSync(path.join(OUT_DIR, 'classroom.html'), { force: true });

    const result = spawnSync(
        process.execPath,
        [
            '--max-old-space-size=2048',
            'node_modules/vite/bin/vite.js',
            'build',
            '-c',
            'vite.classroom.config.ts',
        ],
        { cwd: APP_ROOT, stdio: 'inherit', timeout: BUILD_TIMEOUT_MS }
    );
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(`vite build exited with ${result.status ?? result.signal}`);
    }

    const files = measure();
    const totalGz = files.reduce((sum, file) => sum + file.gz, 0);
    for (const file of files) {
        console.log(
            `[classroom] ${file.name}: ${(file.raw / 1024).toFixed(1)} KB, ${(file.gz / 1024).toFixed(1)} KB gz`
        );
    }
    console.log(
        `[classroom] total ${(totalGz / 1024).toFixed(1)} KB gz, budget ${BUDGET_KB} KB gz`
    );
    if (totalGz > BUDGET_KB * 1024) {
        throw new Error(
            `page is ${(totalGz / 1024).toFixed(1)} KB gz, over the ${BUDGET_KB} KB gz budget`
        );
    }
}

if (!onCloudflare && !forced) {
    console.log('[classroom] phone page skipped (set BUILD_CLASSROOM_PAGE=1 to build it)');
    process.exit(0);
}

try {
    build();
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (onCloudflare) {
        console.warn(`[classroom] WARNING: ${message}. The admin deploy continues.`);
        process.exit(0);
    }
    console.error(`[classroom] FAILED: ${message}`);
    process.exit(1);
}
