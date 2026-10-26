/**
 * build-all — runs build-video over every captured flow (any dir under
 * screenshots/flows/ that has a manifest.json). The "all in one go" HTML pass.
 *
 * Usage: node capture/build-all.mjs
 */
import { readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { TOOL_ROOT } from './env.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const flowsRoot = join(TOOL_ROOT, 'screenshots', 'flows');
const builder = join(here, 'build-video.mjs');

const dirs = readdirSync(flowsRoot)
    .filter((d) => { const p = join(flowsRoot, d); return statSync(p).isDirectory() && existsSync(join(p, 'manifest.json')); });

console.log(`building ${dirs.length} walkthrough(s)…\n`);
let ok = 0, fail = 0;
for (const d of dirs) {
    try {
        execFileSync(process.execPath, [builder, d], { stdio: 'pipe' });
        ok += 1;
    } catch (e) {
        fail += 1;
        console.log(`  ! build failed: ${d} :: ${(e.stderr || e.message || '').toString().split('\n')[0]}`);
    }
}
console.log(`\nbuilt ${ok}/${dirs.length} (${fail} failed) -> walkthroughs/`);
