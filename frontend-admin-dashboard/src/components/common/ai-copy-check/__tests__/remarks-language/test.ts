import { describe, expect, it } from 'vitest';
import { normalizeRemarksLanguage } from '@/types/assessment-settings';

describe('remarks language setting', () => {
    it('is AUTO for anything missing or unknown', () => {
        expect(normalizeRemarksLanguage(undefined)).toBe('AUTO');
        expect(normalizeRemarksLanguage(null)).toBe('AUTO');
        expect(normalizeRemarksLanguage('hindi')).toBe('AUTO');
        expect(normalizeRemarksLanguage('AUTO')).toBe('AUTO');
    });

    it('keeps ENGLISH', () => {
        expect(normalizeRemarksLanguage('ENGLISH')).toBe('ENGLISH');
    });
});
