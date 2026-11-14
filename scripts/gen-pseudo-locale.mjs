#!/usr/bin/env node
/**
 * Vacademy pseudo-locale (en-XA) generator.
 *
 * Builds an en-XA catalog from each app's English catalogs so untranslated or
 * layout-fragile UI is obvious at a glance:
 *
 *   - letters are accent-folded            "Course"  → "Çóúrsé"
 *   - strings are expanded ~40% with '~'   (catches truncation/overflow)
 *   - wrapped in ⟦ ⟧                       (catches concatenated fragments
 *                                           and hardcoded strings — anything
 *                                           NOT wrapped never went through i18n)
 *   - {{placeholders}} are preserved untouched so interpolation still works
 *
 * en-XA is a DEV/STAGE-ONLY locale: never expose it in the production
 * language switcher. Regenerate after changing any en catalog.
 *
 * Supported layouts (per app, auto-detected — same as check-catalogs.mjs):
 *   src/locales/en/<namespace>.json  →  src/locales/en-XA/<namespace>.json
 *   src/locales/en.json              →  src/locales/en-XA.json
 *
 * Usage:  node scripts/gen-pseudo-locale.mjs
 * Idempotent; apps without en catalogs are skipped with a message.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APPS = ['frontend-admin-dashboard', 'frontend-learner-dashboard-app'];

const ACCENTS = {
  a: 'á', b: 'ƀ', c: 'ç', d: 'ð', e: 'é', f: 'ƒ', g: 'ĝ', h: 'ĥ', i: 'í',
  j: 'ĵ', k: 'ķ', l: 'ļ', m: 'ɱ', n: 'ñ', o: 'ó', p: 'þ', q: 'ǫ', r: 'ŕ',
  s: 'š', t: 'ţ', u: 'ú', v: 'ṽ', w: 'ŵ', x: 'ẋ', y: 'ý', z: 'ž',
  A: 'Á', B: 'Ɓ', C: 'Ç', D: 'Ð', E: 'É', F: 'Ƒ', G: 'Ĝ', H: 'Ĥ', I: 'Í',
  J: 'Ĵ', K: 'Ķ', L: 'Ļ', M: 'Ṁ', N: 'Ñ', O: 'Ó', P: 'Þ', Q: 'Ǫ', R: 'Ŕ',
  S: 'Š', T: 'Ţ', U: 'Ú', V: 'Ṽ', W: 'Ŵ', X: 'Ẋ', Y: 'Ý', Z: 'Ž',
};

const PLACEHOLDER = /(\{\{[^}]*\}\})/;

function pseudoize(str) {
  // Split on {{placeholders}} so they pass through byte-identical.
  const parts = str.split(PLACEHOLDER);
  let translatable = 0;
  const folded = parts
    .map((part, idx) => {
      if (idx % 2 === 1) return part; // odd indices are the captured placeholders
      translatable += part.length;
      return part.replace(/[a-zA-Z]/g, (ch) => ACCENTS[ch] ?? ch);
    })
    .join('');
  const padding = '~'.repeat(Math.max(1, Math.round(translatable * 0.4)));
  return `⟦${folded}${padding}⟧`; // ⟦ … ⟧
}

function pseudoizeTree(value) {
  if (typeof value === 'string') return pseudoize(value);
  if (Array.isArray(value)) return value.map(pseudoizeTree);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = pseudoizeTree(v);
    return out;
  }
  return value; // numbers, booleans, null pass through
}

/**
 * Apps keep catalogs in either public/locales (served statically, kept out of
 * the bundler's module graph) or src/locales (imported). Check public/ first;
 * fall back to src/ so either layout works. Mirrors check-catalogs.mjs.
 */
function localeBase(app) {
  for (const dir of ['public', 'src']) {
    const candidate = path.join(REPO_ROOT, app, dir, 'locales');
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.join(REPO_ROOT, app, 'src', 'locales'); // preserves prior not-found behaviour
}

function generateApp(app) {
  const base = localeBase(app);
  const enDir = path.join(base, 'en');
  const enFlat = path.join(base, 'en.json');

  if (fs.existsSync(enDir) && fs.statSync(enDir).isDirectory()) {
    const outDir = path.join(base, 'en-XA');
    fs.mkdirSync(outDir, { recursive: true });
    let count = 0;
    for (const f of fs.readdirSync(enDir)) {
      if (!f.endsWith('.json')) continue;
      const src = path.join(enDir, f);
      let json;
      try {
        json = JSON.parse(fs.readFileSync(src, 'utf8'));
      } catch (err) {
        console.error(`gen-pseudo-locale: ${app}/src/locales/en/${f} is invalid JSON (${err.message}) — skipped`);
        continue;
      }
      fs.writeFileSync(
        path.join(outDir, f),
        JSON.stringify(pseudoizeTree(json), null, 4) + '\n',
        'utf8'
      );
      count++;
    }
    console.log(`gen-pseudo-locale: ${app} → wrote ${count} namespace file(s) to src/locales/en-XA/`);
  } else if (fs.existsSync(enFlat)) {
    let json;
    try {
      json = JSON.parse(fs.readFileSync(enFlat, 'utf8'));
    } catch (err) {
      console.error(`gen-pseudo-locale: ${app}/src/locales/en.json is invalid JSON (${err.message}) — skipped`);
      return;
    }
    fs.writeFileSync(
      path.join(base, 'en-XA.json'),
      JSON.stringify(pseudoizeTree(json), null, 4) + '\n',
      'utf8'
    );
    console.log(`gen-pseudo-locale: ${app} → wrote src/locales/en-XA.json`);
  } else {
    console.log(`gen-pseudo-locale: ${app} has no en catalog yet — skipping.`);
  }
}

for (const app of APPS) generateApp(app);
