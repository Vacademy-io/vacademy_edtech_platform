import { describe, expect, it } from 'vitest';
import {
    showsResultReleaseSettings,
    defaultResultTypeFor,
    resultTypeForEdit,
} from './helper';

/**
 * A survey has no marks, so Step 1's "Result / evaluation type" section is
 * noise on one — and choosing MANUAL there would set evaluation_type=MANUAL,
 * which puts the learner player into PDF-upload mode.
 */
describe('showsResultReleaseSettings', () => {
    it('hides the result settings on a survey', () => {
        expect(showsResultReleaseSettings('SURVEY')).toBe(false);
    });

    it('keeps them for every type that is actually marked', () => {
        for (const type of ['EXAM', 'MOCK', 'PRACTICE', 'MANUAL_UPLOAD_EXAM']) {
            expect(showsResultReleaseSettings(type)).toBe(true);
        }
    });

    it('keeps them when the type is unknown — fail open, not silently hidden', () => {
        expect(showsResultReleaseSettings(undefined)).toBe(true);
    });

    it('leaves a hidden survey on a safe default, never MANUAL', () => {
        // MANUAL would flip evaluation_type and switch the player to PDF upload.
        expect(defaultResultTypeFor('SURVEY')).toBe('AUTO_AFTER_SUBMISSION');
    });
});

describe('resultTypeForEdit', () => {
    it('refuses to inherit a stored MANUAL on a survey', () => {
        // 147 prod surveys carry result_type=MANUAL. With the section hidden
        // there is no radio to correct it, and saving Step 1 would map MANUAL to
        // evaluation_type=MANUAL — putting the learner player in PDF mode.
        expect(resultTypeForEdit('SURVEY', 'MANUAL')).toBe('AUTO_AFTER_SUBMISSION');
    });

    it('ignores any stored value on a survey, not just MANUAL', () => {
        expect(resultTypeForEdit('SURVEY', 'AUTO_AFTER_ASSESSMENT_END')).toBe(
            'AUTO_AFTER_SUBMISSION'
        );
        expect(resultTypeForEdit('SURVEY', undefined)).toBe('AUTO_AFTER_SUBMISSION');
    });

    it('still honours a stored MANUAL where the admin can see and change it', () => {
        expect(resultTypeForEdit('EXAM', 'MANUAL')).toBe('MANUAL');
        expect(resultTypeForEdit('MANUAL_UPLOAD_EXAM', 'MANUAL')).toBe('MANUAL');
    });

    it('keeps the open-ended normalisation for mock and practice', () => {
        // "Auto after assessment end" never arrives on a test that never ends.
        expect(resultTypeForEdit('MOCK', 'AUTO_AFTER_ASSESSMENT_END')).toBe(
            'AUTO_AFTER_SUBMISSION'
        );
        expect(resultTypeForEdit('PRACTICE', 'AUTO_AFTER_ASSESSMENT_END')).toBe(
            'AUTO_AFTER_SUBMISSION'
        );
        expect(resultTypeForEdit('EXAM', 'AUTO_AFTER_ASSESSMENT_END')).toBe(
            'AUTO_AFTER_ASSESSMENT_END'
        );
    });

    it('falls back to the type default when nothing is stored', () => {
        expect(resultTypeForEdit('EXAM', undefined)).toBe('AUTO_AFTER_SUBMISSION');
        expect(resultTypeForEdit('MANUAL_UPLOAD_EXAM', undefined)).toBe('MANUAL');
    });
});
