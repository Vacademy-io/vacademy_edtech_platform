/**
 * Institute renames reach the catalog strings that spell the term out
 * ("View Course" on the course cards) — see naming-terms.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import i18next from 'i18next';
import { StorageKey } from '@/constants/storage/storage';
import { LANGUAGE_SETTING_STORAGE_KEY } from '@/services/language-settings';
import {
    NAMING_TERMS_CHANGED_EVENT,
    applyNamingTerms,
    buildNamingRulesForTests,
    reapplyNamingTerms,
    resetNamingTermsForTests,
    rewriteTemplate,
} from './naming-terms';

// Agilore's live NAMING_SETTING (raw backend shape, 2026-09-29): Course, Chapter
// and Teacher renamed; Learner saved at its default.
const AGILORE = [
    { key: 'Course', customValue: 'Training Module', systemValue: 'Course' },
    { key: 'Course_plural', customValue: 'Training Module', systemValue: null },
    { key: 'Chapter', customValue: 'Sub Module', systemValue: null },
    { key: 'Chapter_plural', customValue: 'Sub Modules', systemValue: null },
    { key: 'Module', customValue: 'Modules', systemValue: null },
    { key: 'Subject', customValue: 'Subjects', systemValue: null },
    { key: 'Teacher', customValue: 'Facilitator', systemValue: 'Teacher' },
    { key: 'LiveSession', customValue: 'Live Session', systemValue: 'Live Session' },
    { key: 'Learner', customValue: 'Learner', systemValue: null },
    { key: 'Student', customValue: 'Learner', systemValue: 'Student' },
];

// Node >= 25 ships its own global localStorage — undefined unless started with
// --localstorage-file — and it shadows the DOM environment's. Give the module
// under test a working one.
if (!globalThis.localStorage) {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key: string) => store.get(key) ?? null,
            setItem: (key: string, value: string) => void store.set(key, String(value)),
            removeItem: (key: string) => void store.delete(key),
            clear: () => store.clear(),
        },
    });
}

const setNaming = (settings: unknown[]) =>
    localStorage.setItem(StorageKey.NAMING_SETTINGS, JSON.stringify(settings));

const rewrite = (value: string) => rewriteTemplate(value, buildNamingRulesForTests('en'));

beforeEach(() => {
    localStorage.clear();
    resetNamingTermsForTests();
});

describe('rewriteTemplate with a renamed institute', () => {
    beforeEach(() => setNaming(AGILORE));

    it('renames the course card button', () => {
        expect(rewrite('View Course')).toBe('View Training Module');
    });

    it('matches the casing of the word it replaces', () => {
        expect(rewrite('Select a course to continue')).toBe('Select a training module to continue');
        expect(rewrite('COURSE DETAILS')).toBe('TRAINING MODULE DETAILS');
        // A lone all-caps word in prose is a role/type code, not wording.
        expect(rewrite('Grants TEACHER role')).toBe('Grants TEACHER role');
        expect(rewrite('TEACHER')).toBe('TEACHER');
        // Admin plural follows getTerminologyPlural: customPluralValue, else naive.
        expect(rewrite('All Courses')).toBe('All Training Modules');
    });

    it('renames every renamed term, and only those', () => {
        expect(rewrite('Add Chapter')).toBe('Add Sub Module');
        expect(rewrite('Assign Teachers')).toBe('Assign Facilitators');
        expect(rewrite('Instructor notes')).toBe('Facilitator notes');
        // Learner is saved at its default — "Student"/"Learner" wording stays.
        expect(rewrite('Invite Students and Learners')).toBe('Invite Students and Learners');
        // Ambiguous words are never touched, whatever the settings say.
        expect(rewrite('Email Subject for this Module')).toBe('Email Subject for this Module');
    });

    it('fixes the article in front of the new word', () => {
        setNaming([{ key: 'Course', customValue: 'Internship' }]);
        expect(rewrite('Create a course')).toBe('Create an internship');
        expect(rewrite('A Course was archived')).toBe('An Internship was archived');
        setNaming([{ key: 'Evaluator', customValue: 'Reviewer' }]);
        expect(rewrite('Assign an evaluator')).toBe('Assign a reviewer');
    });

    it('never touches interpolations, nesting, markup or identifiers', () => {
        expect(rewrite('{{course}} Course')).toBe('{{course}} Training Module');
        expect(rewrite('$t(common:course) course')).toBe('$t(common:course) training module');
        expect(rewrite('<course>Course</course>')).toBe('<course>Training Module</course>');
        expect(rewrite('Open https://example.com/course now')).toBe(
            'Open https://example.com/course now'
        );
        expect(rewrite('course@example.com')).toBe('course@example.com');
        expect(rewrite('URL or #courses')).toBe('URL or #courses');
        expect(rewrite('course_id and course.name')).toBe('course_id and course.name');
        expect(rewrite('slug chapter-progress')).toBe('slug chapter-progress');
        expect(rewrite('Coursework and Recourse')).toBe('Coursework and Recourse');
    });

    it('still renames prose joins', () => {
        expect(rewrite('Filter by Course/Session')).toBe('Filter by Training Module/Session');
        expect(rewrite('Chapter-wise tests')).toBe('Sub Module-wise tests');
        expect(rewrite("the course's price.")).toBe("the training module's price.");
    });

    it('prefers a whole compound term when that term is itself renamed', () => {
        setNaming([
            { key: 'Course', customValue: 'Programme' },
            { key: 'CourseCreator', customValue: 'Author' },
        ]);
        expect(rewrite('Course Creator for this Course')).toBe('Author for this Programme');
        setNaming([{ key: 'Course', customValue: 'Programme' }]);
        expect(rewrite('Course Creator')).toBe('Programme Creator');
    });

    it('keeps a custom word that contains the system word stable', () => {
        setNaming([{ key: 'Course', customValue: 'Short Course' }]);
        expect(rewrite('View Course')).toBe('View Short Course');
    });
});

describe('applyNamingTerms', () => {
    it('returns the catalog untouched when nothing is renamed', () => {
        const catalog = { viewCourse: 'View Course' };
        expect(applyNamingTerms('en', 'authoredCourses', catalog)).toBe(catalog);
        setNaming([{ key: 'Course', customValue: 'Course', customPluralValue: 'Courses' }]);
        expect(applyNamingTerms('en', 'authoredCourses', catalog)).toBe(catalog);
    });

    it('leaves non-English catalogs and the reserved namespaces alone', () => {
        setNaming(AGILORE);
        const catalog = { viewCourse: 'View Course' };
        expect(applyNamingTerms('fr', 'authoredCourses', catalog)).toBe(catalog);
        expect(applyNamingTerms('en', 'terms', catalog)).toBe(catalog);
        expect(applyNamingTerms('en', 'settingsNaming', catalog)).toBe(catalog);
        expect(applyNamingTerms('en', 'sidebar', catalog)).toBe(catalog);
    });

    it('skips English when the institute writes its words in another language', () => {
        setNaming(AGILORE);
        localStorage.setItem(
            LANGUAGE_SETTING_STORAGE_KEY,
            JSON.stringify({ content_source_locale: 'hi' })
        );
        const catalog = { viewCourse: 'View Course' };
        expect(applyNamingTerms('en', 'authoredCourses', catalog)).toBe(catalog);
        // ...unless it recorded an explicit English word.
        setNaming([
            { key: 'Course', customValue: 'पाठ्यक्रम', locales: { en: { customValue: 'Track' } } },
        ]);
        expect(applyNamingTerms('en', 'authoredCourses', catalog)).toEqual({
            viewCourse: 'View Track',
        });
    });

    it('rewrites nested objects and arrays without mutating the input', () => {
        setNaming(AGILORE);
        const catalog = { card: { cta: 'View Course', tips: ['Open a course'] }, count: 3 };
        const out = applyNamingTerms('en', 'x', catalog);
        expect(out).toEqual({
            card: { cta: 'View Training Module', tips: ['Open a training module'] },
            count: 3,
        });
        expect(catalog.card.cta).toBe('View Course');
    });

    it('only changes wording in the real English catalogs — never placeholders', () => {
        setNaming(AGILORE);
        const dir = path.resolve(__dirname, '../../public/locales/en');
        const placeholders = (value: string) =>
            (value.match(/\{\{[^}]*\}\}|\$t\([^)]*\)|<[^>]*>/g) ?? []).join('|');
        let changed = 0;
        const walk = (before: unknown, after: unknown) => {
            if (typeof before === 'string') {
                expect(placeholders(after as string)).toBe(placeholders(before));
                if (after !== before) changed += 1;
                return;
            }
            if (before && typeof before === 'object') {
                for (const key of Object.keys(before)) {
                    walk(
                        (before as Record<string, unknown>)[key],
                        (after as Record<string, unknown>)[key]
                    );
                }
            }
        };
        let viewCourse = '';
        for (const file of fs.readdirSync(dir)) {
            if (!file.endsWith('.json')) continue;
            const ns = file.slice(0, -'.json'.length);
            const catalog = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
            const out = applyNamingTerms('en', ns, catalog) as Record<string, unknown>;
            walk(catalog, out);
            if (ns === 'authoredCourses') viewCourse = out.viewCourse as string;
        }
        expect(viewCourse).toBe('View Training Module');
        expect(changed).toBeGreaterThan(500);
    });
});

describe('reapplyNamingTerms', () => {
    const i18n = i18next.createInstance();

    beforeEach(async () => {
        await i18n.init({ lng: 'en', resources: {}, initImmediate: false });
    });
    afterEach(() => {
        i18n.removeResourceBundle('en', 'authoredCourses');
    });

    it('rewrites loaded catalogs when the settings change, and back again', () => {
        const pristine = { viewCourse: 'View Course' };
        i18n.addResourceBundle(
            'en',
            'authoredCourses',
            applyNamingTerms('en', 'authoredCourses', pristine)
        );
        expect(i18n.t('authoredCourses:viewCourse')).toBe('View Course');

        let emitted = 0;
        i18n.on(NAMING_TERMS_CHANGED_EVENT, () => (emitted += 1));

        setNaming(AGILORE);
        reapplyNamingTerms(i18n);
        expect(i18n.t('authoredCourses:viewCourse')).toBe('View Training Module');
        expect(emitted).toBe(1);

        // Same settings again: nothing to do, no re-render.
        reapplyNamingTerms(i18n);
        expect(emitted).toBe(1);

        // Institute switch to one with no renames restores the original wording.
        setNaming([]);
        reapplyNamingTerms(i18n);
        expect(i18n.t('authoredCourses:viewCourse')).toBe('View Course');
        expect(emitted).toBe(2);
    });
});
