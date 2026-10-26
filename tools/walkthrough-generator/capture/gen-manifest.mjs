/**
 * gen-manifest — joins flows-auto.json with the bulk-capture report to produce a
 * single generation manifest the HTML-generation stage consumes. Offline.
 *
 * Emits out/gen-manifest.json:
 *   {
 *     screens: [ { urlKey, url, route, tab, screenshot, captured,
 *                  representative: <slug>, slugs:[...all flows on this screen] } ],
 *     flows:   [ { slug, side, title, route, tab, url, screenshot, prompt, captured } ]
 *   }
 * - screens[] drives the CHEAP strategy: one video per unique screen (~43).
 * - flows[]  drives the FULL strategy: one task-specific video per flow (~345),
 *   each grounded by its screen screenshot + its own filled prompt.
 *
 * Run: node capture/gen-manifest.mjs
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeToUrl } from './route-map.mjs';
import { loadEnv, TOOL_ROOT } from './env.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const env = loadEnv();
const BASE = (env.VACADEMY_BASE_URL || 'https://dash.vacademy.io').replace(/\/+$/, '');

const flowsAuto = JSON.parse(readFileSync(join(here, 'flows-auto.json'), 'utf8'));
const reportPath = join(TOOL_ROOT, 'screenshots', 'bulk-capture-report.json');
const captured = existsSync(reportPath)
    ? new Map(JSON.parse(readFileSync(reportPath, 'utf8')).flows.map((r) => [r.slug, r.captured]))
    : new Map();

const promptPath = (slug) => join(TOOL_ROOT, 'out', 'prompts', `${slug}.md`);
const shotPath = (slug) => join(TOOL_ROOT, 'screenshots', slug, '01-landing.png');
const rel = (p) => p.replace(repoRoot + '\\', '').replace(repoRoot + '/', '').replace(/\\/g, '/');

const screensByUrl = new Map();
const flows = [];
for (const f of flowsAuto) {
    if (f.side !== 'admin') continue; // learner side needs the learner app (separate base)
    const url = routeToUrl(BASE, f.route, f.tab);
    const isCaptured = captured.get(f.slug) === true;
    const entry = {
        slug: f.slug, side: f.side, title: f.title, route: f.route, tab: f.tab, url,
        screenshot: rel(shotPath(f.slug)), prompt: rel(promptPath(f.slug)), captured: isCaptured,
    };
    flows.push(entry);
    if (!screensByUrl.has(url)) {
        screensByUrl.set(url, {
            urlKey: url.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 80),
            url, route: f.route, tab: f.tab,
            screenshot: rel(join(TOOL_ROOT, 'screenshots', '_by-url', url.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 80) + '.png')),
            captured: isCaptured, representative: f.slug, slugs: [],
        });
    }
    screensByUrl.get(url).slugs.push(f.slug);
}

const screens = [...screensByUrl.values()];
const outDir = join(TOOL_ROOT, 'out');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'gen-manifest.json'), JSON.stringify({ base: BASE, screens, flows }, null, 2));

console.log(`gen-manifest: ${flows.length} admin flows across ${screens.length} unique screens`);
console.log(`captured screens: ${screens.filter((s) => s.captured).length}/${screens.length}`);
console.log(`captured flows:   ${flows.filter((f) => f.captured).length}/${flows.length}`);
console.log(`→ out/gen-manifest.json`);
