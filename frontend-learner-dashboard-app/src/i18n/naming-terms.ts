/**
 * Institute naming settings applied to the translation catalogs themselves.
 * Mirrors the admin app's src/i18n/naming-terms.ts — keep the two in sync.
 *
 * getTerminology() only reaches strings whose call site threads the term in as
 * a placeholder ("View {{course}}"). Catalog strings that spell the word out
 * ("Course", "Chapter", "Instructor") kept the system wording after an
 * institute renamed the term, so the English catalog TEMPLATES are rewritten
 * as they load instead:
 *
 *   applyNamingTerms()    — called by the i18n backend on every catalog
 *   reapplyNamingTerms()  — re-derives every loaded catalog from its pristine
 *                           copy when the naming settings change
 *
 * Why templates and not t() output: interpolated values never pass through
 * here, so a course literally named "Intro Course" or a learner's name is never
 * rewritten — only the product's own wording is.
 *
 * Scope, deliberately narrow:
 *  - English catalogs only, and only when English is where the institute's
 *    words live (content source locale 'en', or an explicit `locales.en`
 *    override) — the same rule resolveLocalizedTerm() uses.
 *  - Only terms whose words mean nothing else in this UI. Subject, Session,
 *    Level, Module, Slide, Batch, Admin and Package are excluded on purpose.
 *  - A term is rewritten only once the institute has actually renamed it. The
 *    admin app saves its OWN defaults ("Teacher", "Live Session") into the same
 *    blob, so those count as "not renamed" here too — otherwise every institute
 *    that ever pressed Save in Naming Settings would see "Instructor" → "Teacher".
 */
import type { i18n as I18n } from "i18next";
import {
  NAMING_SETTINGS_KEY,
  type LocalizedNamingSettings,
} from "@/types/naming-settings";
import { NAMING_SETTINGS_UPDATED_EVENT } from "@/components/common/layout-container/sidebar/utils";
import { DEFAULT_LOCALE, normalizeLocale } from "@/i18n/locales";
import {
  getLanguageSetting,
  LANGUAGE_SETTING_STORAGE_KEY,
} from "@/services/language-settings";

/** i18next event emitted after a rewrite; bound in i18n.ts so useTranslation re-renders. */
export const NAMING_TERMS_CHANGED_EVENT = "namingTermsChanged";

/** The only catalog language rewritten — see "Scope" above. */
const REWRITTEN_LOCALE = "en";

/** terms: the system defaults getTerminology() falls back to — never rewritten. */
const EXCLUDED_NAMESPACES = new Set(["terms"]);

type TermSpec = {
  /** Naming-settings key, as read by getTerminology(). */
  key: string;
  /** Learner + admin SystemTerms values — a saved value equal to one of these is not a rename. */
  systemDefaults: string[];
  /** English words the catalogs use for the term (singular / plural). */
  singular: string[];
  plural: string[];
};

// Compound terms first: when CourseCreator itself is renamed, "Course Creator"
// must match as a whole before "Course" gets a chance to.
const TERM_SPECS: TermSpec[] = [
  {
    key: "CourseCreator",
    systemDefaults: ["Course Creator"],
    singular: ["Course Creator"],
    plural: ["Course Creators"],
  },
  {
    key: "AssessmentCreator",
    systemDefaults: ["Assessment Creator"],
    singular: ["Assessment Creator"],
    plural: ["Assessment Creators"],
  },
  { key: "Course", systemDefaults: ["Course"], singular: ["Course"], plural: ["Courses"] },
  { key: "Chapter", systemDefaults: ["Chapter"], singular: ["Chapter"], plural: ["Chapters"] },
  {
    key: "LiveSession",
    systemDefaults: ["Live Class", "Live Session"],
    singular: ["Live Class", "Live Session"],
    plural: ["Live Classes", "Live Sessions"],
  },
  {
    key: "Teacher",
    systemDefaults: ["Instructor", "Teacher"],
    singular: ["Instructor", "Teacher"],
    plural: ["Instructors", "Teachers"],
  },
  {
    key: "Evaluator",
    systemDefaults: ["Evaluator"],
    singular: ["Evaluator"],
    plural: ["Evaluators"],
  },
  {
    key: "Learner",
    systemDefaults: ["Learner"],
    singular: ["Learner", "Student"],
    plural: ["Learners", "Students"],
  },
];

type Catalog = Record<string, unknown>;

type Rules = {
  /** Stable identity of the replacement table; '' when there is nothing to replace. */
  signature: string;
  pattern: RegExp | null;
  /** Lower-cased system word → institute word. */
  targets: Map<string, string>;
};

const NO_RULES: Rules = { signature: "", pattern: null, targets: new Map() };

// Same fallback as getTerminologyPlural() in sidebar/utils.ts.
const naivePluralize = (word: string): string => {
  if (
    word.endsWith("s") ||
    word.endsWith("x") ||
    word.endsWith("z") ||
    word.endsWith("ch") ||
    word.endsWith("sh")
  ) {
    return `${word}es`;
  }
  if (word.endsWith("y") && !/[aeiou]y$/i.test(word)) {
    return `${word.slice(0, -1)}ies`;
  }
  return `${word}s`;
};

const readNamingSettings = (): LocalizedNamingSettings[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(NAMING_SETTINGS_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const readContentSourceLocale = (): string => {
  try {
    return normalizeLocale(
      getLanguageSetting()?.content_source_locale ?? DEFAULT_LOCALE
    );
  } catch {
    return DEFAULT_LOCALE;
  }
};

/** The institute's English singular/plural for a term, or null when it is not renamed. */
const resolveEnglishTerm = (
  settings: LocalizedNamingSettings[],
  spec: TermSpec,
  sourceIsEnglish: boolean
): { singular: string; plural: string } | null => {
  const setting = settings.find((item) => item.key === spec.key);
  const override = setting?.locales?.[REWRITTEN_LOCALE];
  let singular = override?.customValue?.trim();
  let plural = override?.customPluralValue?.trim();
  if (!singular && sourceIsEnglish) {
    singular = setting?.customValue?.trim();
    // Same precedence as getTerminologyPlural(): the raw backend's separate
    // `<key>_plural` entry, then the merged customPluralValue.
    plural =
      settings.find((item) => item.key === `${spec.key}_plural`)?.customValue?.trim() ||
      setting?.customPluralValue?.trim();
  }
  if (!singular || spec.systemDefaults.includes(singular)) return null;
  return { singular, plural: plural || naivePluralize(singular) };
};

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const readStorage = (key: string): string => {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
};

let cachedRules: { key: string; rules: Rules } | null = null;

// Called once per loaded namespace (~1,600 at admin boot): reuse the table
// for as long as the two storage entries it is derived from are unchanged.
const buildRules = (lng: string): Rules => {
  if (lng !== REWRITTEN_LOCALE) return NO_RULES;
  const key = `${readStorage(NAMING_SETTINGS_KEY)}\u0000${readStorage(LANGUAGE_SETTING_STORAGE_KEY)}`;
  if (cachedRules?.key !== key) cachedRules = { key, rules: computeRules() };
  return cachedRules.rules;
};

const computeRules = (): Rules => {
  const settings = readNamingSettings();
  if (settings.length === 0) return NO_RULES;
  const sourceIsEnglish = readContentSourceLocale() === REWRITTEN_LOCALE;

  const targets = new Map<string, string>();
  for (const spec of TERM_SPECS) {
    const term = resolveEnglishTerm(settings, spec, sourceIsEnglish);
    if (!term) continue;
    for (const word of spec.singular) targets.set(word.toLowerCase(), term.singular);
    for (const word of spec.plural) targets.set(word.toLowerCase(), term.plural);
  }
  if (targets.size === 0) return NO_RULES;

  // Longest first: "courses" before "course", "course creator" before "course".
  const words = [...targets.keys()].sort((a, b) => b.length - a.length);
  const alternation = words
    .map((word) => escapeRegExp(word).replace(/ /g, "\\s+"))
    .join("|");
  // Group 1: the character before the word — captured rather than a
  // lookbehind, which older Safari/WebKit (native app webviews) cannot parse.
  // Groups 2+3: an optional "a"/"an" article, re-chosen for the new word.
  // Group 4: the word. isIdentifierLike() then vetoes slugs, emails, etc.
  const pattern = new RegExp(
    `(^|[^\\p{L}\\p{N}_])(?:(an?)(\\s+))?(${alternation})(?=$|[^\\p{L}\\p{N}_])`,
    "giu"
  );
  return {
    signature: JSON.stringify(words.map((word) => [word, targets.get(word)])),
    pattern,
    targets,
  };
};

/** Lower-cases ordinary Capitalised words; acronyms and camelCase ("NEET", "eLearning") keep their casing. */
const lowerCaseWords = (value: string): string =>
  value.replace(/\p{L}[\p{L}\p{N}'’]*/gu, (word) =>
    /^\p{Lu}\p{Ll}*$/u.test(word) ? word.toLowerCase() : word
  );

/** Carries the matched word's casing (COURSE / course / Course) over to the replacement. */
const matchCase = (source: string, target: string): string => {
  if (source === source.toUpperCase() && source !== source.toLowerCase()) {
    return target.toUpperCase();
  }
  const first = source.charAt(0);
  if (first === first.toLowerCase()) return lowerCaseWords(target);
  return target;
};

const startsWithVowelSound = (word: string): boolean => {
  if (/^(hour|honest|honou?r|heir)/i.test(word)) return true;
  if (/^(uni|use|usu|uti|ure|one|once|eu)/i.test(word)) return false;
  return /^[aeiou]/i.test(word);
};

const matchArticle = (article: string, nextWord: string): string => {
  const replacement = startsWithVowelSound(nextWord) ? "an" : "a";
  if (article === article.toUpperCase() && article.length > 1) {
    return replacement.toUpperCase();
  }
  if (article.charAt(0) === article.charAt(0).toUpperCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
};

// Interpolations, nested $t() calls, markup tags and URLs are protected verbatim.
const PROTECTED_SEGMENT =
  /(\{\{[^}]*\}\}|\$t\([^)]*\)|<\/?[A-Za-z0-9]+(?:\s[^<>]*)?\/?>|(?:https?:\/\/|www\.)[^\s"'<>)]+)/;

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/**
 * True when the matched word is part of an identifier rather than prose:
 * "#courses", "{course}", "student@example.com", "course.name", "?course=",
 * a path like "/courses", a lower-case slug like "learner-progress", or a role
 * code like "Grants STUDENT role" / a bare "TEACHER" label.
 * Prose joins still rename: "lead/student", "Course/Session", "Chapter-wise",
 * and all-caps headings: "LEARNER HISTORY", "LIVE CLASS REPORT".
 */
const isIdentifierLike = (
  word: string,
  segment: string,
  before: string,
  beforeThat: string,
  after: string,
  afterThat: string
): boolean => {
  if ("#@$%{[<=?&.".includes(before) && before !== "") return true;
  if ("@}]>%=".includes(after) && after !== "") return true;
  if (after === "." && LETTER_OR_DIGIT.test(afterThat)) return true;
  if (before === "/" && !LETTER_OR_DIGIT.test(beforeThat)) return true;
  if (!/\s/.test(word) && word === word.toUpperCase()) {
    const rest = segment.replace(word, " ");
    return /\p{Ll}/u.test(rest) || !/\p{Lu}{2,}/u.test(rest);
  }
  const isLowerCase = word === word.toLowerCase();
  return isLowerCase && (before === "-" || after === "-");
};

/** Rewrites one catalog string. Exported for tests. */
export const rewriteTemplate = (value: string, rules: Rules): string => {
  const { pattern, targets } = rules;
  if (!pattern) return value;
  return value
    .split(PROTECTED_SEGMENT)
    .map((segment, index) => {
      // split() with a capture group alternates text / protected segment.
      if (index % 2 === 1) return segment;
      return segment.replace(
        pattern,
        (
          match: string,
          prefix: string,
          article: string | undefined,
          gap: string | undefined,
          word: string,
          offset: number,
          whole: string
        ) => {
          const target = targets.get(word.toLowerCase().replace(/\s+/g, " "));
          const end = offset + match.length;
          if (
            !target ||
            isIdentifierLike(
              word,
              whole,
              article ? "" : prefix,
              article ? "" : whole.charAt(offset - 1),
              whole.charAt(end),
              whole.charAt(end + 1)
            )
          ) {
            return match;
          }
          const replaced = matchCase(word, target);
          const articlePart = article
            ? matchArticle(article, replaced) + (gap ?? "")
            : "";
          return `${prefix}${articlePart}${replaced}`;
        }
      );
    })
    .join("");
};

const rewriteValue = (value: unknown, rules: Rules): unknown => {
  if (typeof value === "string") return rewriteTemplate(value, rules);
  if (Array.isArray(value)) return value.map((item) => rewriteValue(item, rules));
  if (value && typeof value === "object") {
    const out: Catalog = {};
    for (const [key, child] of Object.entries(value as Catalog)) {
      out[key] = rewriteValue(child, rules);
    }
    return out;
  }
  return value;
};

type LoadedCatalog = { lng: string; ns: string; data: Catalog; signature: string };

/** Every catalog as it was loaded, keyed `${lng}|${ns}` — the source for every rewrite. */
const loadedCatalogs = new Map<string, LoadedCatalog>();

const isRewritable = (lng: string, ns: string, data: unknown): data is Catalog =>
  lng === REWRITTEN_LOCALE &&
  !EXCLUDED_NAMESPACES.has(ns) &&
  !!data &&
  typeof data === "object" &&
  !Array.isArray(data);

/**
 * Returns the catalog with the institute's terms applied (the input itself when
 * there is nothing to apply). The input is never mutated — it is kept as the
 * pristine copy that later rewrites start from.
 */
export const applyNamingTerms = <T>(lng: string, ns: string, data: T): T => {
  if (!isRewritable(lng, ns, data)) return data;
  const rules = buildRules(lng);
  loadedCatalogs.set(`${lng}|${ns}`, { lng, ns, data, signature: rules.signature });
  return rules.pattern ? (rewriteValue(data, rules) as T) : data;
};

/**
 * Re-derives every loaded catalog whose replacement table changed, then emits
 * NAMING_TERMS_CHANGED_EVENT so mounted useTranslation() consumers re-render.
 * A no-op when nothing changed, so it is safe to call on every settings event.
 */
export const reapplyNamingTerms = (i18n: I18n): void => {
  const rulesByLocale = new Map<string, Rules>();
  let changed = false;
  for (const entry of loadedCatalogs.values()) {
    let rules = rulesByLocale.get(entry.lng);
    if (!rules) {
      rules = buildRules(entry.lng);
      rulesByLocale.set(entry.lng, rules);
    }
    if (entry.signature === rules.signature) continue;
    entry.signature = rules.signature;
    const next = rules.pattern
      ? (rewriteValue(entry.data, rules) as Catalog)
      : entry.data;
    i18n.addResourceBundle(entry.lng, entry.ns, next, false, true);
    changed = true;
  }
  if (changed) i18n.emit(NAMING_TERMS_CHANGED_EVENT);
};

let syncInstalled = false;

/** Keeps the catalogs in step with naming-settings changes (this tab and others). */
export const installNamingTermsSync = (i18n: I18n): void => {
  if (syncInstalled || typeof window === "undefined") return;
  syncInstalled = true;
  const reapply = () => reapplyNamingTerms(i18n);
  window.addEventListener(NAMING_SETTINGS_UPDATED_EVENT, reapply);
  window.addEventListener("storage", (event) => {
    if (
      event.key === null ||
      event.key === NAMING_SETTINGS_KEY ||
      event.key === LANGUAGE_SETTING_STORAGE_KEY
    ) {
      reapply();
    }
  });
};

/** Test-only: forget every loaded catalog. */
export const resetNamingTermsForTests = (): void => {
  loadedCatalogs.clear();
};

/** Test-only: build the replacement table for a locale from current storage. */
export const buildNamingRulesForTests = buildRules;
