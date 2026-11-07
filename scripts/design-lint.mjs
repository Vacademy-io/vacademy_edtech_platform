#!/usr/bin/env node
/**
 * Vacademy design-system lint — deterministic checker for UI drift.
 *
 * Flags violations of docs/design-system (raw hex, arbitrary Tailwind values,
 * inline styles, banned icon libraries, learner primary-600..950 no-op classes,
 * raw palette hues) in React/CSS files.
 *
 * Usage:
 *   node scripts/design-lint.mjs <file|dir> [<file|dir> ...]   # CLI / CI / lint-staged
 *   node scripts/design-lint.mjs --hook                        # reads Claude Code hook JSON from stdin
 *
 * Exit codes: 0 = clean, 2 = violations found (non-zero fails CI/lint-staged and
 * feeds the message back to Claude when used as a PostToolUse hook).
 *
 * Source of truth: frontend-admin-dashboard/docs/design-system/*
 */

import fs from 'node:fs';
import path from 'node:path';

const SCANNABLE = /\.(tsx|ts|css)$/;
// Only police files inside a frontend app's src/ (skip configs, tests dirs, node_modules, etc.)
const IN_APP_SRC = /[\\/](frontend-admin-dashboard|frontend-learner-dashboard-app)[\\/]src[\\/]/;
const SKIP_DIR = /[\\/](node_modules|dist|build|\.storybook|coverage|\.turbo)[\\/]/;

// Arbitrary-VALUE class prefixes (property utilities). Deliberately excludes arbitrary
// VARIANTS like data-[...], aria-[...], group-[...], peer-[...], has-[...], supports-[...]
// and [&_...] selectors, which are legitimate.
const ARBITRARY_PREFIXES = [
  'bg', 'text', 'fill', 'stroke', 'border', 'ring', 'outline', 'shadow',
  'from', 'via', 'to', 'p', 'px', 'py', 'pt', 'pb', 'pl', 'pr',
  'm', 'mx', 'my', 'mt', 'mb', 'ml', 'mr', 'w', 'h',
  'min-w', 'max-w', 'min-h', 'max-h', 'gap', 'gap-x', 'gap-y',
  'space-x', 'space-y', 'rounded', 'z', 'inset', 'top', 'left', 'right', 'bottom',
  'size', 'leading', 'tracking', 'opacity',
];

const RULES = [
  {
    id: 'arbitrary-tailwind-value',
    severity: 'error',
    test: /(?<![\w-])(?:bg|text|fill|stroke|border|ring|outline|shadow|from|via|to|px|py|pt|pb|pl|pr|p|mx|my|mt|mb|ml|mr|m|min-w|max-w|min-h|max-h|w|h|gap-x|gap-y|gap|space-x|space-y|rounded|z|inset|top|left|right|bottom|size|leading|tracking|opacity)-\[[^\]]+\]/g,
    appliesTo: /\.(tsx|ts)$/,
    msg: 'Arbitrary Tailwind value — use a design token (see docs/design-system/01-foundations.md).',
  },
  {
    id: 'raw-hex-color',
    severity: 'error',
    test: /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g,
    appliesTo: /\.(tsx|ts)$/,
    msg: 'Raw hex color — use a color token like text-danger-600 / bg-primary-500.',
  },
  {
    id: 'inline-style',
    severity: 'warn',
    test: /style=\{\{/g,
    appliesTo: /\.(tsx)$/,
    msg: 'Inline style — use Tailwind tokens. Only allowed for genuinely dynamic/user-generated values (isolate + comment).',
  },
  {
    id: 'banned-icon-library',
    severity: 'error',
    test: /from\s+['"](lucide-react|react-icons[^'"]*|phosphor-react)['"]/g,
    appliesTo: /\.(tsx|ts)$/,
    msg: "Banned icon library — use '@phosphor-icons/react' only (see docs/design-system/06-governance.md).",
  },
  {
    id: 'catalogue-raw-gray',
    severity: 'warn',
    // Raw gray/white chrome in catalogue renderers blocks themes + dark mode
    // from reaching the content. Intentional whites (over author-colored
    // surfaces) can stay — annotate the line with design-lint-ignore.
    test: /(?<![\w/-])(?:text|bg|border|divide)-gray-\d{2,3}\b|(?<![\w/-])bg-white(?![/\w-])/g,
    appliesTo: /frontend-learner-dashboard-app[\\/]src[\\/]routes[\\/]\$tagName[\\/].*\.tsx$/,
    msg: 'Catalogue renderer: prefer catalogue tokens (text-catalogue-text-*, bg-catalogue-bg*, border-catalogue-border*) so institute themes & dark mode apply.',
  },
  {
    id: 'learner-primary-out-of-scale',
    severity: 'error',
    // The learner tailwind.config.js defines primary 50..500 ONLY, so
    // primary-600..950 compile to nothing (a silent no-op). An ERROR in the
    // engagement code, which is clean; a warning elsewhere, where ~300 legacy
    // uses exist and a whole-file error would block unrelated commits.
    test: /(?<![\w-])(?:bg|text|border(?:-[xytrbse])?|ring(?:-offset)?|from|via|to|fill|stroke|outline|divide|shadow|accent|caret|decoration|placeholder)-primary-(?:600|700|800|900|950)(?!\d)/g,
    appliesTo: /frontend-learner-dashboard-app[\\/]src[\\/]routes[\\/](?:engagement|dashboard[\\/]-components[\\/]engagement)[\\/].*\.(tsx|ts)$/,
    msg: 'Learner primary scale is 50..500 only — primary-600..950 compile to nothing. Use primary-500 (strongest), or a semantic token (text-foreground, text-neutral-*).',
  },
  {
    id: 'learner-primary-out-of-scale-legacy',
    severity: 'warn',
    test: /(?<![\w-])(?:bg|text|border(?:-[xytrbse])?|ring(?:-offset)?|from|via|to|fill|stroke|outline|divide|shadow|accent|caret|decoration|placeholder)-primary-(?:600|700|800|900|950)(?!\d)/g,
    appliesTo: /frontend-learner-dashboard-app[\\/]src[\\/](?!routes[\\/](?:engagement|dashboard[\\/]-components[\\/]engagement)[\\/]).*\.(tsx|ts)$/,
    msg: 'Learner primary scale is 50..500 only — primary-600..950 compile to nothing.',
  },
  {
    id: 'raw-palette-family',
    severity: 'warn',
    // Raw Tailwind palette hues bypass the institute theme (primary/secondary/
    // tertiary) and the semantic scales (success/warning/danger/info), and
    // their dark-mode pairing must be hand-maintained. Keep them for genuinely
    // categorical color (chart series, subject tags) and annotate with
    // design-lint-ignore; otherwise use a token.
    test: /(?<![\w-])(?:bg|text|border(?:-[xytrbse])?|ring(?:-offset)?|from|via|to|fill|stroke|outline|divide|shadow|accent|caret|decoration|placeholder)-(?:sky|violet|amber|teal|emerald|rose|orange|indigo|fuchsia|cyan|pink)-(?:50|[1-9]00|950)(?!\d)/g,
    appliesTo: /\.(tsx|ts)$/,
    msg: 'Raw palette hue — prefer theme tokens (primary-*, secondary-*) or semantic scales (success-*, warning-*, danger-*, info-*). Categorical use: annotate with design-lint-ignore.',
  },
  {
    id: 'arbitrary-grid-template',
    severity: 'warn',
    // grid-cols-[...] / grid-rows-[...] are not in ARBITRARY_PREFIXES, so a
    // hand-tuned track list slipped through. Warn only: a few layouts
    // (tables with a fixed first column) genuinely need one.
    test: /(?<![\w-])grid-(?:cols|rows)-\[[^\]]+\]/g,
    appliesTo: /\.(tsx|ts)$/,
    msg: 'Arbitrary grid template — prefer grid-cols-N / flex, or a named layout; annotate with design-lint-ignore if the track list is essential.',
  },
];

// Lines we never flag for hex (token definitions / dynamic editor values opt-out).
const IGNORE_LINE = /(eslint-disable|design-lint-ignore|--[a-z0-9-]+:\s)/i;

function scanFile(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const lines = text.split(/\r?\n/);
  const violations = [];
  for (const rule of RULES) {
    if (!rule.appliesTo.test(file)) continue;
    lines.forEach((line, i) => {
      if (IGNORE_LINE.test(line)) return;
      const re = new RegExp(rule.test.source, rule.test.flags);
      let m;
      while ((m = re.exec(line)) !== null) {
        violations.push({
          file,
          line: i + 1,
          col: m.index + 1,
          id: rule.id,
          severity: rule.severity,
          match: m[0].slice(0, 60),
          msg: rule.msg,
        });
        if (m.index === re.lastIndex) re.lastIndex++;
      }
    });
  }
  return violations;
}

function walk(target, out) {
  let stat;
  try {
    stat = fs.statSync(target);
  } catch {
    return;
  }
  if (stat.isDirectory()) {
    if (SKIP_DIR.test(target + path.sep)) return;
    for (const entry of fs.readdirSync(target)) walk(path.join(target, entry), out);
  } else if (SCANNABLE.test(target) && !SKIP_DIR.test(target)) {
    out.push(target);
  }
}

function collectTargets(paths) {
  const files = [];
  for (const p of paths) walk(path.resolve(p), files);
  // Only police app source files.
  return files.filter((f) => IN_APP_SRC.test(f));
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const args = process.argv.slice(2);
  let targets = [];

  if (args.includes('--hook')) {
    // Claude Code PostToolUse payload arrives as JSON on stdin.
    try {
      const payload = JSON.parse((await readStdin()) || '{}');
      const fp = payload?.tool_input?.file_path;
      if (fp) targets = [fp];
    } catch {
      process.exit(0); // never block on malformed hook input
    }
    if (targets.length === 0) process.exit(0);
  } else {
    targets = args.length ? args : ['frontend-admin-dashboard/src', 'frontend-learner-dashboard-app/src'];
  }

  const files = collectTargets(targets);
  const all = [];
  for (const f of files) all.push(...scanFile(f));

  const errors = all.filter((v) => v.severity === 'error');
  const warns = all.filter((v) => v.severity === 'warn');

  if (all.length === 0) {
    if (!args.includes('--hook')) console.log('design-lint: clean ✓');
    process.exit(0);
  }

  const out = [];
  out.push('Vacademy design-system violations (see docs/design-system/):');
  for (const v of all) {
    const rel = path.relative(process.cwd(), v.file);
    out.push(`  [${v.severity}] ${rel}:${v.line}:${v.col}  ${v.id}  "${v.match}"`);
    out.push(`         → ${v.msg}`);
  }
  out.push(`Summary: ${errors.length} error(s), ${warns.length} warning(s).`);
  const report = out.join('\n');

  // Set exitCode instead of calling process.exit(): exit() does not wait for a
  // large report to drain into a pipe (`| grep`, CI log capture), so the
  // report used to be silently truncated at ~64 KB.
  if (errors.length > 0) {
    process.stderr.write(report + '\n');
    process.exitCode = 2; // fails CI/lint-staged; surfaces feedback to Claude via hook
  } else {
    process.stdout.write(report + '\n');
    process.exitCode = 0; // warnings only — don't block
  }
}

main();
