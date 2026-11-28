import { describe, expect, it } from 'vitest';
import {
    DEFAULT_COURSE_LANGUAGES,
    courseLanguageIssues,
    effectiveCourseLanguages,
    languageOfLevel,
    moveLanguage,
    parseMatchWords,
    removeLanguageAt,
    sanitizeLanguageCode,
    updateLanguageAt,
    usesDefaultLanguages,
} from './course-languages';

describe('defaults (same semantics as the learner course-variants.ts)', () => {
    it('falls back to English / Hindi until the site saves its own list', () => {
        expect(effectiveCourseLanguages(undefined)).toBe(DEFAULT_COURSE_LANGUAGES);
        expect(effectiveCourseLanguages({ enabled: true, languages: [] })).toBe(DEFAULT_COURSE_LANGUAGES);
        expect(usesDefaultLanguages({ enabled: true })).toBe(true);
        const own = [{ code: 'ta', label: 'Tamil' }];
        expect(effectiveCourseLanguages({ languages: own })).toBe(own);
        expect(usesDefaultLanguages({ languages: own })).toBe(false);
        expect(DEFAULT_COURSE_LANGUAGES.map((l) => [l.code, l.chip])).toEqual([
            ['en', 'EN'],
            ['hi', 'हिं'],
        ]);
    });
});

describe('languageOfLevel', () => {
    it('reads the language out of a level name', () => {
        expect(languageOfLevel('Hindi', DEFAULT_COURSE_LANGUAGES)?.code).toBe('hi');
        expect(languageOfLevel('Beginner Hindi', DEFAULT_COURSE_LANGUAGES)?.code).toBe('hi');
        expect(languageOfLevel('hindi - batch 2', DEFAULT_COURSE_LANGUAGES)?.code).toBe('hi');
        expect(languageOfLevel('हिन्दी माध्यम', DEFAULT_COURSE_LANGUAGES)?.code).toBe('hi');
        expect(languageOfLevel('Advanced English', DEFAULT_COURSE_LANGUAGES)?.code).toBe('en');
    });

    it('matches ASCII words whole, so "eng" is not "engineering"', () => {
        expect(languageOfLevel('Engineering basics', DEFAULT_COURSE_LANGUAGES)).toBeNull();
        expect(languageOfLevel('ENG level 1', DEFAULT_COURSE_LANGUAGES)?.code).toBe('en');
    });

    it('lets the first matching language win, and matches name and code too', () => {
        const langs = [
            { code: 'mr', label: 'Marathi', match: [] },
            { code: 'hi', label: 'Hindi', match: ['hindi'] },
        ];
        expect(languageOfLevel('Marathi + Hindi', langs)?.code).toBe('mr');
        expect(languageOfLevel('Level MR', langs)?.code).toBe('mr');
        expect(languageOfLevel('', langs)).toBeNull();
        expect(languageOfLevel(null, langs)).toBeNull();
    });

    it('escapes regex characters in match words', () => {
        expect(languageOfLevel('c++ track', [{ code: 'x', label: 'X', match: ['c++'] }])?.code).toBe('x');
    });
});

describe('editing helpers', () => {
    it('cleans codes and match words', () => {
        expect(sanitizeLanguageCode(' Hi_IN! ')).toBe('hiin');
        expect(sanitizeLanguageCode('pt-BR')).toBe('pt-br');
        expect(parseMatchWords('hindi, हिन्दी ,, Hindi , hin ')).toEqual(['hindi', 'हिन्दी', 'hin']);
    });

    it('flags missing codes, missing names and duplicate codes', () => {
        expect(courseLanguageIssues(DEFAULT_COURSE_LANGUAGES)).toEqual([]);
        const issues = courseLanguageIssues([
            { code: 'hi', label: 'Hindi' },
            { code: 'hi', label: '' },
            { code: '', label: 'Tamil' },
        ]);
        expect(issues).toHaveLength(3);
        expect(issues.join(' ')).toMatch(/used twice/);
        expect(issues.join(' ')).toMatch(/needs a name/);
        expect(issues.join(' ')).toMatch(/needs a code/);
    });

    it('updates, removes and moves without mutating', () => {
        const list = DEFAULT_COURSE_LANGUAGES;
        expect(updateLanguageAt(list, 1, { chip: 'HI' })[1]?.chip).toBe('HI');
        expect(list[1]?.chip).toBe('हिं');
        expect(removeLanguageAt(list, 0).map((l) => l.code)).toEqual(['hi']);
        expect(moveLanguage(list, 1, -1).map((l) => l.code)).toEqual(['hi', 'en']);
        expect(moveLanguage(list, 0, -1)).toBe(list);
        expect(moveLanguage(list, 1, 1)).toBe(list);
    });
});
