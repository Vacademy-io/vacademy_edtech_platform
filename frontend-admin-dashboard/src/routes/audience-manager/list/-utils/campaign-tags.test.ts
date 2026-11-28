import { describe, expect, it } from 'vitest';
import { normalizeTagKey, orderedTagEntries, rowsFromTags, tagsFromRows } from './campaign-tags';

describe('normalizeTagKey', () => {
    it('matches the backend spelling', () => {
        expect(normalizeTagKey('  Lead Source ')).toBe('lead_source');
        expect(normalizeTagKey('lead-source')).toBe('lead_source');
        expect(normalizeTagKey('State')).toBe('state');
    });
});

describe('rowsFromTags / tagsFromRows', () => {
    it('always shows the suggested rows first and round-trips saved tags', () => {
        const rows = rowsFromTags({ state: 'Goa', batch: '2026' });
        expect(rows.map((r) => r.key)).toEqual(['state', 'course', 'channel', 'batch']);
        expect(tagsFromRows(rows)).toEqual({ tags: { state: 'Goa', batch: '2026' } });
    });

    it('drops blank values and normalises custom keys', () => {
        const rows = rowsFromTags({});
        rows.push({ id: 'x', key: 'Lead Source', value: ' Google ', suggested: false });
        expect(tagsFromRows(rows)).toEqual({ tags: { lead_source: 'Google' } });
    });

    it('reports an invalid or repeated key', () => {
        const bad = [{ id: 'x', key: 'state!', value: 'Goa', suggested: false }];
        expect(tagsFromRows(bad).error?.code).toBe('invalidKey');
        const dup = [
            ...rowsFromTags({ state: 'Goa' }),
            { id: 'y', key: 'State', value: 'Kerala', suggested: false },
        ];
        expect(tagsFromRows(dup).error?.code).toBe('duplicateKey');
    });
});

describe('orderedTagEntries', () => {
    it('puts suggested keys first, then the rest alphabetically', () => {
        expect(orderedTagEntries({ batch: '1', channel: 'WhatsApp', state: 'Goa' })).toEqual([
            ['state', 'Goa'],
            ['channel', 'WhatsApp'],
            ['batch', '1'],
        ]);
    });
});
