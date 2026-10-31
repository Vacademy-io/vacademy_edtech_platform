#!/usr/bin/env node
/**
 * Catalogue style-engine / CSS sync checker.
 *
 * The admin page-builder and the learner renderer each carry a copy of the
 * shared catalogue style engine + catalogue CSS (separate Vite apps, no
 * shared package). This script fails when the copies drift.
 *
 * Usage:
 *   node scripts/check-style-engine-sync.mjs          # check (CI / pre-commit)
 *   node scripts/check-style-engine-sync.mjs --fix    # copy newest → other side
 *
 * Exit codes: 0 = in sync, 2 = drift found (or fixed with --fix, still 0).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEARNER = path.join(ROOT, 'frontend-learner-dashboard-app');
const ADMIN = path.join(ROOT, 'frontend-admin-dashboard');

/** [learner path, admin path] pairs that must stay byte-identical. */
const SYNC_PAIRS = [
    [
        path.join(LEARNER, 'src/routes/$tagName/-utils/catalogue-style-engine.ts'),
        path.join(ADMIN, 'src/routes/manage-pages/-utils/style-engine.ts'),
    ],
    [
        path.join(LEARNER, 'src/styles/catalogue-tokens.css'),
        path.join(ADMIN, 'src/styles/catalogue-tokens.css'),
    ],
    [
        path.join(LEARNER, 'src/styles/catalogue-themes.css'),
        path.join(ADMIN, 'src/styles/catalogue-themes.css'),
    ],
    [
        path.join(LEARNER, 'src/styles/catalogue-animations.css'),
        path.join(ADMIN, 'src/styles/catalogue-animations.css'),
    ],
    [
        path.join(LEARNER, 'src/routes/$tagName/-utils/catalogue-fonts.ts'),
        path.join(ADMIN, 'src/routes/manage-pages/-utils/catalogue-fonts.ts'),
    ],
    [
        path.join(LEARNER, 'src/routes/$tagName/-utils/catalogue-decorations.tsx'),
        path.join(ADMIN, 'src/routes/manage-pages/-utils/catalogue-decorations.tsx'),
    ],
    [
        path.join(LEARNER, 'src/routes/$tagName/-utils/catalogue-html.ts'),
        path.join(ADMIN, 'src/routes/manage-pages/-utils/catalogue-html.ts'),
    ],
    [
        path.join(LEARNER, 'src/routes/$tagName/-utils/catalogue-i18n.ts'),
        path.join(ADMIN, 'src/routes/manage-pages/-utils/catalogue-i18n.ts'),
    ],
];

const fix = process.argv.includes('--fix');
let drifted = 0;

for (const [a, b] of SYNC_PAIRS) {
    const aExists = fs.existsSync(a);
    const bExists = fs.existsSync(b);
    const rel = (p) => path.relative(ROOT, p);

    if (!aExists && !bExists) continue; // pair not introduced yet
    if (!aExists || !bExists) {
        drifted++;
        if (fix) {
            const src = aExists ? a : b;
            const dst = aExists ? b : a;
            fs.mkdirSync(path.dirname(dst), { recursive: true });
            fs.copyFileSync(src, dst);
            console.log(`fixed (created): ${rel(dst)}  ←  ${rel(src)}`);
        } else {
            console.error(`MISSING COPY: ${rel(aExists ? b : a)} (source: ${rel(aExists ? a : b)})`);
        }
        continue;
    }

    const aBuf = fs.readFileSync(a);
    const bBuf = fs.readFileSync(b);
    if (!aBuf.equals(bBuf)) {
        drifted++;
        if (fix) {
            // Newest mtime wins.
            const aNewer = fs.statSync(a).mtimeMs >= fs.statSync(b).mtimeMs;
            const src = aNewer ? a : b;
            const dst = aNewer ? b : a;
            fs.copyFileSync(src, dst);
            console.log(`fixed (synced): ${rel(dst)}  ←  ${rel(src)}`);
        } else {
            console.error(`DRIFT: ${rel(a)}  ≠  ${rel(b)}`);
        }
    }
}

if (drifted === 0) {
    console.log('style-engine sync: clean ✓');
    process.exit(0);
}
if (fix) {
    console.log(`style-engine sync: ${drifted} pair(s) fixed ✓`);
    process.exit(0);
}
console.error(
    `\nstyle-engine sync: ${drifted} pair(s) drifted.` +
    `\nRun: node scripts/check-style-engine-sync.mjs --fix`,
);
process.exit(2);
