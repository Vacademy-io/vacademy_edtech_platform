import type { CourseLanguageOption, CourseLanguageSettings } from '../../-types/editor-types';

/**
 * Admin side of globalSettings.courseLanguages. The learner reads it with
 * -utils/course-variants.ts; the defaults and the level-name matching rule
 * below are copied from there on purpose — the settings card's "try a level
 * name" check must answer exactly what the live site will do. Keep the two
 * in step (learner: src/routes/$tagName/-utils/course-variants.ts).
 */

/** Same list, same order as the learner's DEFAULT_COURSE_LANGUAGES. */
export const DEFAULT_COURSE_LANGUAGES: CourseLanguageOption[] = [
    { code: 'en', label: 'English', chip: 'EN', match: ['english', 'eng'] },
    { code: 'hi', label: 'Hindi', chip: 'हिं', match: ['hindi', 'हिन्दी', 'हिंदी'] },
];

/** The languages the site actually uses: its own list, else the defaults (learner courseLanguagesOf). */
export const effectiveCourseLanguages = (settings: CourseLanguageSettings | null | undefined): CourseLanguageOption[] =>
    settings?.languages?.length ? settings.languages : DEFAULT_COURSE_LANGUAGES;

/** True while the site follows the built-in list (nothing of its own saved). */
export const usesDefaultLanguages = (settings: CourseLanguageSettings | null | undefined): boolean =>
    !settings?.languages?.length;

/** Same answer as the learner's /^[\x00-\x7F]*$/ test, without a control-character regex. */
const isAscii = (s: string) => [...s].every((c) => c.charCodeAt(0) < 128);

/**
 * The language a level name stands for — the learner's languageOfLevel():
 * ASCII words match as whole words ("eng" is not "engineering"), other
 * scripts match anywhere; the first language that matches wins.
 */
export const languageOfLevel = (
    levelName: string | null | undefined,
    languages: CourseLanguageOption[]
): CourseLanguageOption | null => {
    const name = (levelName || '').toLowerCase();
    if (!name.trim()) return null;
    for (const lang of languages) {
        const tokens = [...(lang.match || []), lang.label, lang.code]
            .filter(Boolean)
            .map((t) => t.toLowerCase().trim());
        for (const token of tokens) {
            if (!token) continue;
            if (isAscii(token)) {
                const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                if (new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(name)) return lang;
            } else if (name.includes(token)) {
                return lang;
            }
        }
    }
    return null;
};

/** A language code is a short URL-safe token (?language=hi): lowercase letters, digits, dashes. */
export const sanitizeLanguageCode = (raw: string): string =>
    raw
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '')
        .slice(0, 12);

/** "hindi, हिन्दी ,, Hindi" → ['hindi', 'हिन्दी'] (trimmed, empty and repeated words dropped). */
export const parseMatchWords = (text: string): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const part of text.split(',')) {
        const word = part.trim();
        const key = word.toLowerCase();
        if (!word || seen.has(key)) continue;
        seen.add(key);
        out.push(word);
    }
    return out;
};

/** Problems that would make the language list misbehave on the site; [] when it is sound. */
export const courseLanguageIssues = (languages: CourseLanguageOption[]): string[] => {
    const issues: string[] = [];
    const seen = new Set<string>();
    languages.forEach((l, i) => {
        const row = `Language ${i + 1}`;
        const code = (l.code || '').trim();
        if (!code) issues.push(`${row} needs a code (for example “hi”).`);
        else if (seen.has(code)) issues.push(`The code “${code}” is used twice — each language needs its own.`);
        if (code) seen.add(code);
        if (!(l.label || '').trim()) issues.push(`${row} needs a name (for example “Hindi”).`);
    });
    return issues;
};

/* ── list edits (each returns a new array) ───────────────────────────── */

export const updateLanguageAt = (
    languages: CourseLanguageOption[],
    index: number,
    patch: Partial<CourseLanguageOption>
): CourseLanguageOption[] => languages.map((l, i) => (i === index ? { ...l, ...patch } : l));

export const removeLanguageAt = (languages: CourseLanguageOption[], index: number): CourseLanguageOption[] =>
    languages.filter((_, i) => i !== index);

export const moveLanguage = (languages: CourseLanguageOption[], index: number, direction: -1 | 1): CourseLanguageOption[] => {
    const to = index + direction;
    if (index < 0 || to < 0 || index >= languages.length || to >= languages.length) return languages;
    const next = [...languages];
    [next[index], next[to]] = [next[to]!, next[index]!];
    return next;
};

export const blankLanguage = (): CourseLanguageOption => ({ code: '', label: '', chip: '', match: [] });
