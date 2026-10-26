import { describe, it, expect } from 'vitest';
import { normalizeStudentFilters } from '../normalizeStudentFilters';

describe('normalizeStudentFilters', () => {
    it('converts the UI singular `type` into the `types` array the backend reads', () => {
        const out = normalizeStudentFilters({ type: 'ABANDONED_CART' });
        expect(out.types).toEqual(['ABANDONED_CART']);
    });

    it('never sends `type` — the backend DTO has no such field, Jackson would drop it', () => {
        const out = normalizeStudentFilters({ type: 'ABANDONED_CART' });
        expect('type' in out).toBe(false);
    });

    it('leaves an explicitly supplied `types` array alone', () => {
        const out = normalizeStudentFilters({
            type: 'ABANDONED_CART',
            types: ['PACKAGE_SESSION', 'PAYMENT_FAILED'],
        });
        expect(out.types).toEqual(['PACKAGE_SESSION', 'PAYMENT_FAILED']);
        expect('type' in out).toBe(false);
    });

    it('adds no `types` key when no learner type is selected', () => {
        const out = normalizeStudentFilters({ statuses: ['ACTIVE'] });
        expect(out.types).toBeUndefined();
        expect(out.statuses).toEqual(['ACTIVE']);
    });

    it('treats an empty `types` array as "not set" and falls back to `type`', () => {
        const out = normalizeStudentFilters({ type: 'ABANDONED_CART', types: [] });
        expect(out.types).toEqual(['ABANDONED_CART']);
    });

    it('passes every other filter through untouched', () => {
        const filters = {
            name: 'asha',
            statuses: ['ACTIVE'],
            destination_package_session_ids: ['ps-1'],
            package_session_ids: [],
            type: 'ABANDONED_CART',
        };
        const out = normalizeStudentFilters(filters);
        expect(out.name).toBe('asha');
        expect(out.destination_package_session_ids).toEqual(['ps-1']);
        expect(out.package_session_ids).toEqual([]);
    });

    it('does not mutate the caller’s object', () => {
        const filters = { type: 'ABANDONED_CART' };
        normalizeStudentFilters(filters);
        expect(filters).toEqual({ type: 'ABANDONED_CART' });
    });
});
