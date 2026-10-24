import { describe, expect, it } from 'vitest';
import {
    defaultResultTypeFor,
    defaultSubmissionTypeFor,
    isOpenEndedExamType,
    normalizeResultTypeFor,
} from './helper';

/**
 * A new assessment's result type is decided by its type. Only the manual
 * upload exam is teacher-checked; a Mock full of MCQs that silently became
 * MANUAL showed every learner "Upload Answer" instead of the questions.
 */
describe('defaultResultTypeFor', () => {
    it.each(['EXAM', 'MOCK', 'PRACTICE', 'SURVEY'])('%s grades itself', (type) => {
        expect(defaultResultTypeFor(type)).toBe('AUTO_AFTER_SUBMISSION');
        expect(defaultSubmissionTypeFor(type)).toBe('');
    });

    it('a manual upload exam is teacher-checked from a PDF', () => {
        expect(defaultResultTypeFor('MANUAL_UPLOAD_EXAM')).toBe('MANUAL');
        expect(defaultSubmissionTypeFor('MANUAL_UPLOAD_EXAM')).toBe('PDF');
    });

    it('an unknown type never becomes manual by accident', () => {
        expect(defaultResultTypeFor(undefined)).toBe('AUTO_AFTER_SUBMISSION');
    });
});

describe('normalizeResultTypeFor', () => {
    it('turns "after assessment end" into "after submission" for types that never end', () => {
        expect(normalizeResultTypeFor('MOCK', 'AUTO_AFTER_ASSESSMENT_END')).toBe(
            'AUTO_AFTER_SUBMISSION'
        );
        expect(normalizeResultTypeFor('PRACTICE', 'AUTO_AFTER_ASSESSMENT_END')).toBe(
            'AUTO_AFTER_SUBMISSION'
        );
    });

    it('leaves every other value alone', () => {
        expect(normalizeResultTypeFor('EXAM', 'AUTO_AFTER_ASSESSMENT_END')).toBe(
            'AUTO_AFTER_ASSESSMENT_END'
        );
        expect(normalizeResultTypeFor('MOCK', 'MANUAL')).toBe('MANUAL');
        expect(normalizeResultTypeFor('MOCK', 'NO_AUTO_RELEASE')).toBe('NO_AUTO_RELEASE');
    });

    it('knows which types are open-ended', () => {
        expect(isOpenEndedExamType('MOCK')).toBe(true);
        expect(isOpenEndedExamType('PRACTICE')).toBe(true);
        expect(isOpenEndedExamType('EXAM')).toBe(false);
        expect(isOpenEndedExamType('SURVEY')).toBe(false);
    });
});
