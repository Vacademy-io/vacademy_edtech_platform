/**
 * auto-spec — reads the onboarding CSVs, resolves each flow to a real route, and
 * writes capture/flows-auto.json (one entry per task). Offline; no app contact.
 * Run: node capture/auto-spec.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from '../csv.mjs';
import { resolveRoute } from './route-map.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const docsDir = join(repoRoot, 'docs');
const outFile = join(here, 'flows-auto.json');

const SOURCES = [
    { file: 'onboarding-guide-admin.csv', side: 'admin' },
    { file: 'onboarding-guide-admin-flows.csv', side: 'admin' },
    { file: 'onboarding-guide-learner.csv', side: 'learner' },
    { file: 'onboarding-guide-learner-flows.csv', side: 'learner' },
];

const kebab = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
const used = new Set();
const uniq = (b) => { let s = b || 'task', i = 2; while (used.has(s)) s = `${b}-${i++}`; used.add(s); return s; };

const flows = [];
let fallback = 0;
for (const src of SOURCES) {
    const p = join(docsDir, src.file);
    if (!existsSync(p)) continue;
    const rows = parseCsv(readFileSync(p, 'utf8')).slice(1);
    for (const row of rows) {
        const title = (row[1] || '').trim();
        if (!title) continue;
        const flow = (row[2] || '').trim();
        const description = (row[4] || '').trim();
        // learner-side flows live in a different app; for now route admin-side only,
        // learner flows are tagged so capture can skip/route them separately.
        const { route, tab } = resolveRoute(`${flow} ${title}`);
        if (route === '/dashboard' && !/dashboard|navigate|home/i.test(`${flow} ${title}`)) fallback++;
        flows.push({
            slug: uniq(`${src.side}-${kebab(title)}`),
            side: src.side,
            title,
            flow,
            description,
            route,
            tab: tab || null,
        });
    }
}

writeFileSync(outFile, JSON.stringify(flows, null, 2));

// report
const byRoute = {};
for (const f of flows) byRoute[f.route] = (byRoute[f.route] || 0) + 1;
console.log(`Resolved ${flows.length} flows → ${outFile}`);
console.log(`Admin: ${flows.filter((f) => f.side === 'admin').length} | Learner: ${flows.filter((f) => f.side === 'learner').length}`);
console.log(`Unmapped (fell back to /dashboard): ${fallback}`);
console.log('Top routes:');
Object.entries(byRoute).sort((a, b) => b[1] - a[1]).slice(0, 20).forEach(([r, c]) => console.log(`  ${c.toString().padStart(3)}  ${r}`));
