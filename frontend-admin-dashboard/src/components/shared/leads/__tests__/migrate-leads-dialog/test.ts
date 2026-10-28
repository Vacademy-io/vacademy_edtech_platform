import { describe, expect, it } from 'vitest';
import { buildTargetListOptions } from '../../migrate-leads-dialog';

const DEFAULTS = [
    { value: 'Facebook', label: 'Facebook' },
    { value: 'Google Ads', label: 'Google Ads' },
];

describe('buildTargetListOptions', () => {
    it('shows each list with its source and lets either be searched', () => {
        expect(
            buildTargetListOptions(
                [{ id: 'a', name: 'Chhattisgarh_PGDAM', campaignType: 'Walk-In' }],
                DEFAULTS
            )
        ).toEqual([
            {
                value: 'a',
                label: 'Chhattisgarh_PGDAM · Walk-In',
                keywords: ['Chhattisgarh_PGDAM', 'Walk-In'],
            },
        ]);
    });

    it('uses the translated label for a default type, whatever its saved case or spacing', () => {
        const [fb, ga] = buildTargetListOptions(
            [
                { id: 'a', name: 'Meta MH', campaignType: 'FACEBOOK' },
                { id: 'b', name: 'Search', campaignType: 'googleads' },
            ],
            DEFAULTS
        );
        expect(fb!.label).toBe('Meta MH · Facebook');
        expect(ga!.label).toBe('Search · Google Ads');
    });

    it('shows just the name when a list has no source', () => {
        const [opt] = buildTargetListOptions(
            [{ id: 'a', name: 'Walk-ins', campaignType: '  ' }],
            DEFAULTS
        );
        expect(opt).toEqual({ value: 'a', label: 'Walk-ins', keywords: ['Walk-ins'] });
    });

    it('keeps identical labels apart so the search list does not merge them', () => {
        const labels = buildTargetListOptions(
            [
                { id: 'a', name: 'City list', campaignType: 'Facebook' },
                { id: 'b', name: 'City list', campaignType: 'FACEBOOK' },
            ],
            DEFAULTS
        ).map((o) => o.label);
        expect(labels).toEqual(['City list · Facebook', 'City list · Facebook (2)']);
    });
});
