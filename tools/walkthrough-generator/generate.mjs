/**
 * Walkthrough prompt generator (Stage 1 — fully offline / side-effect-free).
 *
 * Reads the onboarding-guide CSVs in /docs and, for every task, writes:
 *   out/prompts/<slug>.md   — the master walkthrough prompt with the two
 *                             bracketed fields filled in for this task
 *   out/flows/<slug>.json   — the parsed step list (used later by the capture
 *                             stage to know which steps to screenshot)
 *   out/index.json          — machine-readable list of all tasks
 *   out/INDEX.md            — human-readable checklist of all tasks
 *
 * This script ONLY reads local CSV files and writes local files. It never
 * touches the app, the backend, the network, or any institute/user.
 *
 * Usage:  node tools/walkthrough-generator/generate.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from './csv.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const docsDir = join(repoRoot, 'docs');
const outDir = join(here, 'out');

// CSV sources. Columns are normalised positionally:
//   [0]=group  [1]=title  [2]=flow  [3]=priority  [4]=description
const SOURCES = [
    { file: 'onboarding-guide-admin.csv', side: 'admin', kind: 'feature' },
    { file: 'onboarding-guide-admin-flows.csv', side: 'admin', kind: 'flow' },
    { file: 'onboarding-guide-learner.csv', side: 'learner', kind: 'feature' },
    { file: 'onboarding-guide-learner-flows.csv', side: 'learner', kind: 'flow' },
];

const masterPrompt = readFileSync(join(here, 'master-prompt.md'), 'utf8');

function kebab(s) {
    return String(s || '')
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64);
}

const usedSlugs = new Set();
function uniqueSlug(base) {
    let slug = base || 'task';
    let n = 2;
    while (usedSlugs.has(slug)) slug = `${base}-${n++}`;
    usedSlugs.add(slug);
    return slug;
}

// ── Parse all sources into a flat task list ────────────────────────────────
const tasks = [];
for (const src of SOURCES) {
    const path = join(docsDir, src.file);
    if (!existsSync(path)) {
        console.warn(`! skipping missing CSV: ${src.file}`);
        continue;
    }
    const rows = parseCsv(readFileSync(path, 'utf8'));
    const dataRows = rows.slice(1); // drop header
    for (const row of dataRows) {
        const title = (row[1] || '').trim();
        if (!title) continue; // a task must have a title
        const group = (row[0] || '').trim();
        const flow = (row[2] || '').trim();
        const priority = (row[3] || '').trim();
        const description = (row[4] || '').trim();
        const steps = flow
            .split('>')
            .map((s) => s.trim())
            .filter(Boolean);
        const slug = uniqueSlug(`${src.side}-${kebab(title)}`);
        tasks.push({
            slug,
            side: src.side,
            kind: src.kind,
            source: src.file,
            group,
            title,
            flow,
            steps,
            priority,
            description,
        });
    }
}

// ── Write outputs ──────────────────────────────────────────────────────────
// Fresh output each run so removed tasks don't linger.
if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
mkdirSync(join(outDir, 'prompts'), { recursive: true });
mkdirSync(join(outDir, 'flows'), { recursive: true });

for (const t of tasks) {
    // The "describe the flow" field: title + description + the step path, so the
    // LLM has full context alongside the screenshots.
    const stepText = t.steps.length ? ` Steps: ${t.steps.join(' → ')}.` : '';
    const flowField = `"${t.title}" (${t.side} side)${t.description ? ` — ${t.description}` : ''}${stepText}`;

    const filled = masterPrompt
        .split('{{FLOW}}')
        .join(flowField)
        .split('{{ROUTE_HINT}}')
        .join(t.slug);

    writeFileSync(join(outDir, 'prompts', `${t.slug}.md`), filled, 'utf8');
    writeFileSync(join(outDir, 'flows', `${t.slug}.json`), JSON.stringify(t, null, 2), 'utf8');
}

writeFileSync(join(outDir, 'index.json'), JSON.stringify(tasks, null, 2), 'utf8');

const bySide = (s) => tasks.filter((t) => t.side === s).length;
const indexMd = [
    '# Walkthrough tasks',
    '',
    `Total: **${tasks.length}**  (admin: ${bySide('admin')}, learner: ${bySide('learner')})`,
    '',
    'Per task: `prompts/<slug>.md` (paste into Claude with the screenshots) + `flows/<slug>.json` (step list for capture) + `screenshots/<slug>/` (filled by the capture stage).',
    '',
    '| # | Side | Title | Slug | Steps |',
    '|---|---|---|---|---|',
    ...tasks.map(
        (t, i) =>
            `| ${i + 1} | ${t.side} | ${t.title.replace(/\|/g, '\\|')} | \`${t.slug}\` | ${
                t.steps.join(' › ').replace(/\|/g, '\\|') || '(single screen)'
            } |`
    ),
    '',
].join('\n');
writeFileSync(join(outDir, 'INDEX.md'), indexMd, 'utf8');

console.log(`✓ Generated ${tasks.length} tasks`);
console.log(`  admin:   ${bySide('admin')}`);
console.log(`  learner: ${bySide('learner')}`);
console.log(`  output:  ${outDir}`);
