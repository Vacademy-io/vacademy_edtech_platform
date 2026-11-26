import { describe, expect, it } from 'vitest';
import type { CertificateTestOption } from '../../-services/course-certificates';
import {
    criteriaDraftError,
    criteriaDraftFrom,
    criteriaPayloadFrom,
    groupTestsByModule,
    testsCountedByRule,
    toggleId,
} from './certificate-criteria-utils';

const test = (
    slideId: string,
    type: 'QUIZ' | 'ASSESSMENT',
    moduleId: string,
    chapterId: string,
    status = 'PUBLISHED'
): CertificateTestOption => ({
    slide_id: slideId,
    title: slideId,
    type,
    status,
    subject_id: null,
    subject_name: null,
    module_id: moduleId,
    module_name: `Module ${moduleId}`,
    chapter_id: chapterId,
    chapter_name: `Chapter ${chapterId}`,
    own_pass_percent: null,
    assessment_id: type === 'ASSESSMENT' ? `asmt-${slideId}` : null,
});

describe('criteriaDraftFrom / criteriaPayloadFrom', () => {
    it('defaults to progress only and saves null for it', () => {
        const draft = criteriaDraftFrom(null);
        expect(draft.mode).toBe('PROGRESS');
        expect(draft.passPercent).toBe(60);
        expect(draft.testTypes).toEqual(['QUIZ', 'ASSESSMENT']);
        expect(criteriaPayloadFrom(draft)).toBeNull();
    });

    it('drops custom picks when the scope is the whole course', () => {
        const draft = criteriaDraftFrom({
            mode: 'SCORE',
            testScope: 'ALL',
            moduleIds: ['m1'],
            passRule: 'AT_LEAST',
            minTestsToPass: 3,
        });
        const payload = criteriaPayloadFrom(draft);
        expect(payload?.moduleIds).toEqual([]);
        expect(payload?.minTestsToPass).toBe(3);
    });

    it('only sends minTestsToPass for an at-least rule', () => {
        const payload = criteriaPayloadFrom(
            criteriaDraftFrom({ mode: 'SCORE', passRule: 'ALL', minTestsToPass: 4 })
        );
        expect(payload?.minTestsToPass).toBeNull();
    });
});

describe('criteriaDraftError', () => {
    it('needs at least one pick for a custom scope', () => {
        const draft = criteriaDraftFrom({ mode: 'SCORE', testScope: 'CUSTOM' });
        expect(criteriaDraftError(draft)).toBe('pickTests');
        expect(criteriaDraftError({ ...draft, chapterIds: ['c1'] })).toBeNull();
    });

    it('needs a test type whenever a module or chapter is picked, even with single tests too', () => {
        const draft = {
            ...criteriaDraftFrom({ mode: 'SCORE', testScope: 'CUSTOM' }),
            moduleIds: ['m1'],
            slideIds: ['s1'],
            testTypes: [],
        };
        expect(criteriaDraftError(draft)).toBe('pickType');
    });

    it('needs a test type unless specific tests are picked', () => {
        const draft = { ...criteriaDraftFrom({ mode: 'SCORE' }), testTypes: [] };
        expect(criteriaDraftError(draft)).toBe('pickType');
        expect(criteriaDraftError({ ...draft, testScope: 'CUSTOM', slideIds: ['s1'] })).toBeNull();
    });
});

describe('testsCountedByRule', () => {
    const tests = [
        test('q-m1', 'QUIZ', 'm1', 'c1'),
        test('a-m1', 'ASSESSMENT', 'm1', 'c1'),
        test('q-draft', 'QUIZ', 'm1', 'c1', 'DRAFT'),
        test('a-m2', 'ASSESSMENT', 'm2', 'c2', 'UNSYNC'),
        test('q-m3', 'QUIZ', 'm3', 'c3'),
    ];

    it('counts every live test of the chosen types for the whole course', () => {
        const draft = { ...criteriaDraftFrom({ mode: 'SCORE' }), testTypes: ['QUIZ' as const] };
        expect(testsCountedByRule(draft, tests).map((t) => t.slide_id)).toEqual(['q-m1', 'q-m3']);
    });

    it('expands modules and chapters by type and always keeps picked tests', () => {
        const draft = {
            ...criteriaDraftFrom({ mode: 'SCORE', testScope: 'CUSTOM' }),
            moduleIds: ['m1'],
            slideIds: ['a-m2'],
            testTypes: ['QUIZ' as const],
        };
        expect(testsCountedByRule(draft, tests).map((t) => t.slide_id)).toEqual(['q-m1', 'a-m2']);
    });
});

describe('groupTestsByModule', () => {
    it('keeps course order and nests chapters under modules', () => {
        const groups = groupTestsByModule([
            test('q1', 'QUIZ', 'm1', 'c1'),
            test('q2', 'QUIZ', 'm1', 'c2'),
            test('q3', 'QUIZ', 'm2', 'c3'),
        ]);
        expect(groups.map((g) => g.moduleId)).toEqual(['m1', 'm2']);
        expect(groups[0]?.chapters.map((c) => c.chapterId)).toEqual(['c1', 'c2']);
    });
});

describe('toggleId', () => {
    it('adds once and removes', () => {
        expect(toggleId(['a'], 'a', true)).toEqual(['a']);
        expect(toggleId(['a'], 'b', true)).toEqual(['a', 'b']);
        expect(toggleId(['a', 'b'], 'a', false)).toEqual(['b']);
    });
});
