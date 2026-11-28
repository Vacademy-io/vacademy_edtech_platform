import { describe, expect, it, vi } from 'vitest';

// The hook module pulls in the axios instance and the institute-details service; only the
// pure helpers are under test here.
vi.mock('@/lib/auth/axiosInstance', () => ({ default: { post: vi.fn() } }));
vi.mock('@/services/student-list-section/getInstituteDetails', () => ({
    invalidateInstituteDetails: vi.fn(),
}));
vi.mock('@/lib/auth/instituteUtils', () => ({ getCurrentInstituteId: () => 'inst-1' }));

import {
    defaultDuplicateName,
    duplicateErrorMessage,
    DUPLICATE_NAME_MAX_LENGTH,
    normaliseDuplicateName,
} from './duplicate-course';

describe('defaultDuplicateName', () => {
    it('appends the copy suffix to the trimmed source name', () => {
        expect(defaultDuplicateName('  Accounts 101 ', '(Copy)')).toBe('Accounts 101 (Copy)');
    });

    it('falls back to the suffix alone for a missing name', () => {
        expect(defaultDuplicateName(undefined, '(Copy)')).toBe('(Copy)');
        expect(defaultDuplicateName('   ', '(Copy)')).toBe('(Copy)');
    });

    it('never exceeds the column size', () => {
        expect(defaultDuplicateName('x'.repeat(300), '(Copy)')).toHaveLength(
            DUPLICATE_NAME_MAX_LENGTH
        );
    });
});

describe('normaliseDuplicateName', () => {
    it('trims and caps the name, and keeps blank as blank for the server default', () => {
        expect(normaliseDuplicateName('  New name  ')).toBe('New name');
        expect(normaliseDuplicateName('   ')).toBe('');
        expect(normaliseDuplicateName('y'.repeat(400))).toHaveLength(DUPLICATE_NAME_MAX_LENGTH);
    });
});

describe('duplicateErrorMessage', () => {
    it('reads the VacademyException body (ex)', () => {
        expect(
            duplicateErrorMessage({
                response: { data: { ex: 'Course not found in this institute' } },
            })
        ).toBe('Course not found in this institute');
    });

    it('falls back to message, then a plain string body', () => {
        expect(duplicateErrorMessage({ response: { data: { message: 'Forbidden' } } })).toBe(
            'Forbidden'
        );
        expect(duplicateErrorMessage({ response: { data: 'Bad gateway' } })).toBe('Bad gateway');
    });

    it('returns undefined when there is nothing useful', () => {
        expect(duplicateErrorMessage(undefined)).toBeUndefined();
        expect(duplicateErrorMessage(new Error('Network Error'))).toBeUndefined();
        expect(duplicateErrorMessage({ response: { data: { ex: '  ' } } })).toBeUndefined();
    });
});
