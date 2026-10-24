#!/usr/bin/env node
/**
 * Vacademy translation-catalog integrity checker.
 *
 * Validates the src/locales/ trees of both frontend apps against the English
 * reference catalog:
 *
 *   - every locale file must parse as JSON                       → error
 *   - non-en locale missing keys present in en                   → warn
 *   - non-en locale carrying keys that don't exist in en         → warn
 *   - {{interpolation}} variables differing from the en string   → error
 *   - a namespace referenced in code but absent from en/         → error
 *
 * Missing keys/extra keys are warnings (i18next falls back to en; stale keys
 * are dead weight), but a placeholder mismatch breaks rendering at runtime,
 * so it fails the run.
 *
 * PLURALS: i18next JSON-v4 suffixes (key_one/key_other/…) are matched per
 * locale against CLDR via Intl.PluralRules, not against en's key set. English
 * has two categories; Arabic has six. So ar/auth.json legitimately carries
 * resendIn_zero/_two/_few/_many that en never will — comparing key sets
 * literally would flag those as junk AND, worse, stay silent when Arabic is
 * genuinely *missing* a form it needs. Each locale is therefore checked
 * against its own required categories.
 *
 * Supported layouts (per app, auto-detected):
 *   src/locales/<locale>/<namespace>.json   (namespaced)
 *   src/locales/<locale>.json               (flat)
 *
 * Usage:  node scripts/check-catalogs.mjs
 * Exit codes: 0 = clean or nothing to check, 1 = errors found.
 * Apps whose catalogs don't exist yet are skipped with a message.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APPS = ['frontend-admin-dashboard', 'frontend-learner-dashboard-app'];
const REFERENCE = 'en';

let errors = 0;
let warnings = 0;

function error(msg) {
  errors++;
  console.error(`  [error] ${msg}`);
}

function warn(msg) {
  warnings++;
  console.log(`  [warn]  ${msg}`);
}

/** Flatten nested JSON into dot-path → string/primitive leaves. */
function flatten(obj, prefix = '', out = {}) {
  for (const [key, value] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object') {
      flatten(value, p, out);
    } else {
      out[p] = value;
    }
  }
  return out;
}

const PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'];

/** Split "resendIn_few" → { base: 'resendIn', category: 'few' }; null if not suffixed. */
function parsePluralKey(key) {
  const i = key.lastIndexOf('_');
  if (i <= 0) return null;
  const category = key.slice(i + 1);
  if (!PLURAL_CATEGORIES.includes(category)) return null;
  return { base: key.slice(0, i), category };
}

/**
 * Plural families in the reference catalog, base → Set(categories).
 * i18next JSON-v4 always emits `_other`, so requiring it as the marker keeps a
 * non-plural key that merely ends in "_one" from being mistaken for a family.
 */
function pluralFamilies(keys) {
  const seen = new Map();
  for (const key of Object.keys(keys)) {
    const p = parsePluralKey(key);
    if (p) (seen.get(p.base) ?? seen.set(p.base, new Set()).get(p.base)).add(p.category);
  }
  for (const [base, cats] of seen) if (!cats.has('other')) seen.delete(base);
  return seen;
}

/** CLDR categories a locale actually needs (en → one/other; ar → all six). */
function requiredCategories(locale) {
  try {
    return new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
  } catch {
    return ['one', 'other'];
  }
}

/** Extract {{variable}} names from an i18next string, sorted for comparison. */
function placeholders(str) {
  if (typeof str !== 'string') return [];
  const names = [];
  const re = /\{\{\s*([^}]*?)\s*\}\}/g;
  let m;
  while ((m = re.exec(str)) !== null) names.push(m[1]);
  return names.sort();
}

/** A placeholder mismatch breaks rendering at runtime, so it errors, not warns. */
function comparePlaceholders(app, nsLabel, locale, key, enValue, locValue) {
  const want = placeholders(enValue);
  const got = placeholders(locValue);
  if (want.join('\u0000') !== got.join('\u0000')) {
    error(
      `${app}: ${nsLabel} key "${key}" placeholder mismatch — ` +
        `en has [${want.join(', ')}], ${locale} has [${got.join(', ')}]`
    );
  }
}

function readJson(file, rel) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    error(`${rel}: does not parse as JSON (${err.message})`);
    return null;
  }
}

/**
 * Where an app keeps its catalogs. `public/locales` is checked first: the
 * admin app serves them as static files (fetched at runtime) rather than
 * bundling them, to keep ~3,200 JSON files out of the Rollup graph. Apps that
 * still import them from `src/locales` keep working unchanged.
 * Returns the locale root relative to the repo, or null if the app has neither.
 */
function localeRoot(app) {
  for (const dir of ['public', 'src']) {
    if (fs.existsSync(path.join(REPO_ROOT, app, dir, 'locales'))) {
      return `${dir}/locales`;
    }
  }
  return null;
}

/**
 * Discover catalogs for one app. Returns { locale: { namespace: flatKeys } }
 * or null when the app has no locales tree yet.
 */
function loadApp(app) {
  const root = localeRoot(app);
  if (root === null) return null;
  const base = path.join(REPO_ROOT, app, ...root.split('/'));

  const catalogs = {}; // locale -> namespace -> flat map
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const locale = entry.name;
      for (const f of fs.readdirSync(path.join(base, locale))) {
        if (!f.endsWith('.json')) continue;
        const rel = `${app}/${root}/${locale}/${f}`;
        const json = readJson(path.join(base, locale, f), rel);
        if (json === null) continue;
        (catalogs[locale] ??= {})[f] = flatten(json);
      }
    } else if (entry.name.endsWith('.json')) {
      const locale = entry.name.replace(/\.json$/, '');
      const rel = `${app}/${root}/${entry.name}`;
      const json = readJson(path.join(base, entry.name), rel);
      if (json === null) continue;
      (catalogs[locale] ??= {})['<flat>'] = flatten(json);
    }
  }
  return catalogs;
}

function checkApp(app) {
  const root = localeRoot(app);
  const catalogs = loadApp(app);
  if (catalogs === null) {
    console.log(`check-catalogs: ${app} has no public/locales or src/locales — skipping.`);
    return;
  }
  const locales = Object.keys(catalogs);
  if (locales.length === 0) {
    console.log(`check-catalogs: ${app}/${root}/ is empty — skipping.`);
    return;
  }
  console.log(`check-catalogs: ${app} (${locales.sort().join(', ')})`);

  const en = catalogs[REFERENCE];
  if (!en) {
    error(`${app}: no "${REFERENCE}" reference catalog found in ${root}/`);
    return;
  }

  for (const locale of locales) {
    if (locale === REFERENCE) continue;
    for (const [ns, enKeys] of Object.entries(en)) {
      const nsLabel = ns === '<flat>' ? locale : `${locale}/${ns}`;
      const locKeys = catalogs[locale][ns];
      if (!locKeys) {
        warn(`${app}: ${nsLabel} missing entirely (present in ${REFERENCE})`);
        continue;
      }
      const families = pluralFamilies(enKeys);
      const needed = requiredCategories(locale);

      // Non-plural keys: straight comparison against en.
      for (const key of Object.keys(enKeys)) {
        const p = parsePluralKey(key);
        if (p && families.has(p.base)) continue; // handled per-family below
        if (!(key in locKeys)) {
          warn(`${app}: ${nsLabel} missing key "${key}"`);
          continue;
        }
        comparePlaceholders(app, nsLabel, locale, key, enKeys[key], locKeys[key]);
      }

      // Plural families: a locale owes exactly the categories CLDR gives it,
      // so these are checked against Intl.PluralRules, never against en's keys.
      for (const [base, enCats] of families) {
        // Vars the caller is known to supply for this family = every var en
        // mentions in ANY of its forms. Deliberately not just `_other`:
        // en itself varies them per form (e.g. "{{count}} {{course}}" in _one
        // vs "{{count}} {{courses}}" in _other).
        const supplied = new Set(
          [...enCats].flatMap((c) => placeholders(enKeys[`${base}_${c}`] ?? ''))
        );
        for (const category of needed) {
          const key = `${base}_${category}`;
          if (!(key in locKeys)) {
            warn(
              `${app}: ${nsLabel} missing plural form "${key}" ` +
                `(${locale} requires ${needed.join('/')})`
            );
            continue;
          }
          // A form may legitimately use FEWER vars than en — languages often
          // drop the numeral in the zero/one cases ("nothing selected", "تم
          // اختيار {{course}} واحد"). What breaks rendering is the reverse: a
          // var nobody passes, which interpolates to empty. So flag only vars
          // en never supplies anywhere in the family.
          const unknown = placeholders(locKeys[key]).filter((v) => !supplied.has(v));
          if (unknown.length) {
            error(
              `${app}: ${nsLabel} key "${key}" uses placeholder(s) ` +
                `[${unknown.join(', ')}] that en never supplies ` +
                `(en supplies [${[...supplied].sort().join(', ')}]) — ` +
                `these render empty at runtime`
            );
          }
        }
        for (const category of enCats) {
          if (!needed.includes(category) && `${base}_${category}` in locKeys) {
            warn(
              `${app}: ${nsLabel} carries plural form "${base}_${category}", ` +
                `which ${locale} never selects — dead weight`
            );
          }
        }
      }

      for (const key of Object.keys(locKeys)) {
        if (key in enKeys) continue;
        const p = parsePluralKey(key);
        // A CLDR form this locale legitimately needs is not an extra key.
        if (p && families.has(p.base) && needed.includes(p.category)) continue;
        warn(`${app}: ${nsLabel} extra key "${key}" (not in ${REFERENCE})`);
      }
    }
    // Namespaces the locale has but en doesn't.
    for (const ns of Object.keys(catalogs[locale])) {
      if (!(ns in en)) {
        const nsLabel = ns === '<flat>' ? locale : `${locale}/${ns}`;
        warn(`${app}: ${nsLabel} has no ${REFERENCE} counterpart`);
      }
    }
  }
}

/**
 * A component can reference a namespace that has no catalog at all — i18next
 * then silently echoes the raw key ("catalog.tab.all") to users, which shipped
 * to production once (commit 8b7c7dfb5 referenced "study" with no study.json).
 * Comparing locales against each other cannot catch that, so scan the source
 * for namespace references and assert each one has an en catalog.
 */
function checkReferencedNamespaces(app) {
  const srcDir = path.join(REPO_ROOT, app, 'src');
  const localesDir = path.join(srcDir, 'locales', REFERENCE);
  if (!fs.existsSync(srcDir) || !fs.existsSync(localesDir)) return;

  const known = new Set(
    fs.readdirSync(localesDir).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''))
  );

  // useTranslation('ns') | useTranslation(['a','b']) | t('ns:key') | i18n.t('ns:key')
  const useNs = /useTranslation\(\s*(\[[^\])]*\]|['"`][^'"`]+['"`])/g;
  const prefixNs = /\bi18n(?:ext)?\.t\(\s*['"`]([A-Za-z0-9_-]+):/g;
  const found = new Map(); // ns -> first file that referenced it

  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === 'locales' || e.name === 'excalidraw') continue;
        walk(full);
      } else if (/\.(ts|tsx)$/.test(e.name)) {
        const text = fs.readFileSync(full, 'utf8');
        const rel = path.relative(path.join(REPO_ROOT, app), full);
        let m;
        while ((m = useNs.exec(text)) !== null) {
          for (const raw of m[1].match(/['"`]([^'"`]+)['"`]/g) ?? []) {
            const ns = raw.slice(1, -1);
            if (ns && !found.has(ns)) found.set(ns, rel);
          }
        }
        while ((m = prefixNs.exec(text)) !== null) {
          if (!found.has(m[1])) found.set(m[1], rel);
        }
      }
    }
  };
  walk(srcDir);

  for (const [ns, file] of found) {
    if (!known.has(ns)) {
      error(
        `${app}: namespace "${ns}" is referenced (${file}) but ${REFERENCE}/${ns}.json ` +
          `does not exist — i18next will render raw keys to users`
      );
    }
  }
}

for (const app of APPS) {
  checkApp(app);
  checkReferencedNamespaces(app);
}

console.log(`check-catalogs: ${errors} error(s), ${warnings} warning(s).`);
process.exit(errors > 0 ? 1 : 0);
