import { describe, expect, it } from 'vitest';
import { decideStudentMapping } from '../../StudentMappingPicker';
import { normalizeStudentMapping } from '@/types/assessment-settings';

describe('student mapping setting', () => {
    it('defaults to asking for anything missing or unknown', () => {
        expect(normalizeStudentMapping(undefined)).toBe('ASK');
        expect(normalizeStudentMapping(null)).toBe('ASK');
        expect(normalizeStudentMapping('always')).toBe('ASK');
        expect(normalizeStudentMapping('MAP')).toBe('MAP');
        expect(normalizeStudentMapping('CHECK_ONLY')).toBe('CHECK_ONLY');
    });

    it('ASK opens the popup', () => {
        expect(decideStudentMapping('ASK', true)).toEqual({ ask: true });
        expect(decideStudentMapping('ASK', false)).toEqual({ ask: true });
    });

    it('MAP sends straight to matching when the test has students', () => {
        expect(decideStudentMapping('MAP', true)).toEqual({ ask: false, mapStudents: true });
    });

    it('MAP on a test with no students asks instead of matching copies to nobody', () => {
        expect(decideStudentMapping('MAP', false)).toEqual({ ask: true });
    });

    it('CHECK_ONLY never matches, students or not', () => {
        expect(decideStudentMapping('CHECK_ONLY', true)).toEqual({
            ask: false,
            mapStudents: false,
        });
        expect(decideStudentMapping('CHECK_ONLY', false)).toEqual({
            ask: false,
            mapStudents: false,
        });
    });
});
