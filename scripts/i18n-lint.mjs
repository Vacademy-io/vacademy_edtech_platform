#!/usr/bin/env node
/**
 * Vacademy i18n commit gate — added-lines-only guard.
 *
 * Inspects ONLY the lines being ADDED in the staged diff (git diff --cached
 * -U0), so existing/legacy code is never flagged — the codebase gets more
 * RTL/locale-safe one commit at a time. Flags:
 *
 *   (a) physical-direction Tailwind utilities (ml- mr- pl- pr-, left- right-,
 *       text-left, text-right, space-x-) — use logical utilities instead
 *       (ms- me- ps- pe- start- end- text-start text-end gap-x-) so RTL
 *       locales mirror for free. rtl: and ltr: prefixed classes are allowed
 *       (they are deliberate per-direction overrides).
 *   (b) locale-less .toLocaleString()/.toLocaleDateString()/
 *       .toLocaleTimeString() calls — these silently format in the
 *       browser's locale instead of the user's chosen locale. The same
 *       calls with an explicit `undefined` locale
 *       (.toLocaleDateString(undefined, {...})) are flagged too — identical
 *       browser-locale fallback.
 *   (c) literal 'Asia/Kolkata' — hardcoded timezone; use the user/institute
 *       timezone setting.
 *
 * Usage:
 *   node scripts/i18n-lint.mjs <file> [<file> ...]  # from .husky/pre-commit
 *   node scripts/i18n-lint.mjs                      # discovers staged files itself
 *
 * Exit codes: 0 = clean (or nothing staged), 2 = violations found.
 * Never crashes the hook: unexpected input/git failures exit 0 with a note.
 */

import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Same population the pre-commit hook feeds design-lint.mjs.
const FRONTEND_FILE = /^frontend-(admin-dashboard|learner-dashboard-app)\/src\/.*\.(tsx|ts|css)$/;

const RULES = [
  {
    id: 'physical-direction-utility',
    appliesTo: /\.(tsx|ts|css)$/,
    test: /(?<!\w)(?:ml|mr|pl|pr)-\d|(?<!\w)(?:left|right)-\d|(?<!\w)text-(?:left|right)(?![\w-])|(?<!\w)space-x-\d/g,
    hint(match) {
      const swaps = { ml: 'ms', mr: 'me', pl: 'ps', pr: 'pe' };
      let m;
      if ((m = match.match(/^(ml|mr|pl|pr)-(\d)/))) {
        return `use ${swaps[m[1]]}-* instead of ${m[1]}-* (logical property, auto-mirrors in RTL)`;
      }
      if ((m = match.match(/^(left|right)-(\d)/))) {
        return `use ${m[1] === 'left' ? 'start' : 'end'}-* instead of ${m[1]}-*`;
      }
      if (match.startsWith('text-')) {
        return `use ${match === 'text-left' ? 'text-start' : 'text-end'} instead of ${match}`;
      }
      return 'use gap-x-* on the flex/grid parent instead of space-x-* (or add rtl:space-x-reverse)';
    },
  },
  {
    id: 'locale-less-toLocale',
    appliesTo: /\.(tsx|ts)$/,
    test: /\.toLocale(?:Date|Time)?String\(\s*\)/g,
    hint(match) {
      const fn = match.slice(1, match.indexOf('('));
      return `pass the active locale explicitly, e.g. .${fn}(locale, { ... }) — no-arg calls format in the browser locale`;
    },
  },
  {
    // `.toLocaleDateString(undefined, { ... })` is the same browser-locale
    // fallback as the no-arg call, just spelled out — it slips past the rule
    // above because it has arguments.
    id: 'undefined-locale-toLocale',
    appliesTo: /\.(tsx|ts)$/,
    test: /\.toLocale(?:Date|Time)?String\(\s*undefined\s*[,)]/g,
    hint(match) {
      const fn = match.slice(1, match.indexOf('('));
      return `replace the undefined locale with the active one, e.g. .${fn}(locale, { ... }) — undefined means "browser locale"`;
    },
  },
  {
    id: 'hardcoded-asia-kolkata',
    appliesTo: /\.(tsx|ts)$/,
    test: /(['"`])Asia\/Kolkata\1/g,
    hint() {
      return "use the user/institute timezone setting instead of hardcoding 'Asia/Kolkata'";
    },
  },
];

// rtl:/ltr:-prefixed classes are deliberate direction overrides — allowed.
// Walk back to the start of the class token and look for the variant prefix.
function isDirectionVariant(line, matchIndex) {
  let start = matchIndex;
  while (start > 0 && !/[\s'"`{(,]/.test(line[start - 1])) start--;
  return /(?:^|:)(rtl|ltr):/.test(line.slice(start, matchIndex));
}

function git(args) {
  return execFileSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** Parse `git diff --cached -U0` output into { newLineNo, text } added lines. */
function addedLines(diffText) {
  const out = [];
  let lineNo = 0;
  for (const raw of diffText.split('\n')) {
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      lineNo = parseInt(hunk[1], 10);
      continue;
    }
    if (raw.startsWith('+') && !raw.startsWith('+++')) {
      out.push({ line: lineNo, text: raw.slice(1) });
      lineNo++;
    }
    // With -U0 there are no context lines; removed lines don't advance
    // new-file line numbers.
  }
  return out;
}

function scanFile(file) {
  let diff;
  try {
    diff = git(['diff', '--cached', '-U0', '--', file]);
  } catch {
    return []; // deleted/binary/odd input — never block the hook on it
  }
  const violations = [];
  for (const { line, text } of addedLines(diff)) {
    for (const rule of RULES) {
      if (!rule.appliesTo.test(file)) continue;
      const re = new RegExp(rule.test.source, rule.test.flags);
      let m;
      while ((m = re.exec(text)) !== null) {
        const allowed =
          rule.id === 'physical-direction-utility' && isDirectionVariant(text, m.index);
        if (!allowed) {
          violations.push({ file, line, id: rule.id, match: m[0], hint: rule.hint(m[0]) });
        }
        if (m.index === re.lastIndex) re.lastIndex++;
      }
    }
  }
  return violations;
}

function main() {
  let files = process.argv.slice(2).map((f) => f.replace(/\\/g, '/'));

  if (files.length === 0) {
    // Standalone mode: discover staged files the same way the hook does.
    try {
      files = git(['diff', '--cached', '--name-only', '--diff-filter=ACM'])
        .split('\n')
        .filter(Boolean);
    } catch {
      console.log('i18n-lint: not a git checkout or git unavailable — skipping.');
      process.exit(0);
    }
  }

  files = files.filter((f) => FRONTEND_FILE.test(f));
  if (files.length === 0) process.exit(0); // nothing staged that we police

  const all = [];
  for (const f of files) all.push(...scanFile(f));

  if (all.length === 0) {
    console.log('i18n-lint: clean ✓');
    process.exit(0);
  }

  const out = [];
  out.push('Vacademy i18n violations on ADDED lines (RTL/locale safety):');
  for (const v of all) {
    out.push(`  [error] ${v.file}:${v.line}  ${v.id}  "${v.match}"`);
    out.push(`         → ${v.hint}`);
  }
  out.push(`Summary: ${all.length} error(s). Only lines added in this commit are checked.`);
  process.stderr.write(out.join('\n') + '\n');
  process.exit(2);
}

try {
  main();
} catch (err) {
  // Guard rail: this gate must never crash a commit on unexpected input.
  console.error(`i18n-lint: internal error (${err.message}) — skipping check.`);
  process.exit(0);
}
