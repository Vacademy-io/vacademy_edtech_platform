import { describe, expect, it } from 'vitest';
import { filterBySource, isApiSourced } from './assessment-source';

const rows = [
    { id: 'a', source: 'API' },
    { id: 'b', source: null },
    { id: 'c', source: 'AI_RECORDING' },
    { id: 'd' },
    { id: 'e', source: 'api ' },
];

describe('isApiSourced', () => {
    it('is true only for the API source, case- and space-insensitive', () => {
        expect(isApiSourced('API')).toBe(true);
        expect(isApiSourced(' api ')).toBe(true);
        expect(isApiSourced(null)).toBe(false);
        expect(isApiSourced(undefined)).toBe(false);
        expect(isApiSourced('AI_RECORDING')).toBe(false);
        expect(isApiSourced('')).toBe(false);
    });
});

describe('filterBySource', () => {
    it('returns every row when nothing or both are selected', () => {
        expect(filterBySource(rows, [])).toBe(rows);
        expect(filterBySource(rows, ['API', 'DASHBOARD'])).toBe(rows);
    });

    it('keeps only API rows for API', () => {
        expect(filterBySource(rows, ['API']).map((r) => r.id)).toEqual(['a', 'e']);
    });

    it('treats null, missing and internal sources as Dashboard', () => {
        expect(filterBySource(rows, ['DASHBOARD']).map((r) => r.id)).toEqual(['b', 'c', 'd']);
    });

    it('ignores unknown selections (old payloads) and shows all', () => {
        expect(filterBySource(rows, ['SOMETHING'])).toBe(rows);
    });
});
