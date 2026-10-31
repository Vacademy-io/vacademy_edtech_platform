import { describe, expect, it } from 'vitest';
import {
    buildCampaignTypeFilterOptions,
    filterByCampaignTypes,
    resolveLeadAudienceIds,
} from './campaign-types';

const defaults = [
    { value: 'Website', label: 'Website' },
    { value: 'Facebook', label: 'Facebook' },
];

describe('buildCampaignTypeFilterOptions', () => {
    it('keeps defaults first and ignores saved values that only differ in case', () => {
        const options = buildCampaignTypeFilterOptions(defaults, ['WEBSITE', 'FACEBOOK']);
        expect(options).toEqual(defaults);
    });

    it('appends custom saved types once, sorted, skipping blanks', () => {
        const options = buildCampaignTypeFilterOptions(defaults, [
            'ZOHO FORM',
            ' ',
            null,
            undefined,
            'MANUAL',
            'zoho form',
        ]);
        expect(options.map((o) => o.value)).toEqual(['Website', 'Facebook', 'MANUAL', 'ZOHO FORM']);
    });
});

describe('filterByCampaignTypes', () => {
    const campaigns = [
        { id: 'a', campaignType: 'GOOGLE ADS' },
        { id: 'b', campaignType: 'WEBSITE' },
        { id: 'c', campaignType: 'WEBSITE - Test' },
        { id: 'd', campaignType: undefined },
        { id: 'e', campaignType: ' facebook ' },
    ];

    it('keeps every campaign when no type is selected', () => {
        expect(filterByCampaignTypes(campaigns, [])).toBe(campaigns);
    });

    it('matches the whole type ignoring case and spaces, not a substring', () => {
        expect(filterByCampaignTypes(campaigns, ['Website']).map((c) => c.id)).toEqual(['b']);
        expect(
            filterByCampaignTypes(campaigns, ['Google Ads', 'Facebook']).map((c) => c.id)
        ).toEqual(['a', 'e']);
    });

    it('returns nothing when no campaign has the selected type', () => {
        expect(filterByCampaignTypes(campaigns, ['Instagram'])).toEqual([]);
    });
});

describe('resolveLeadAudienceIds', () => {
    const audiences = [
        { id: 'g1', campaignType: 'GOOGLE ADS' },
        { id: 'g2', campaignType: 'Google Ads' },
        { id: 'w1', campaignType: 'WEBSITE' },
    ];

    it('returns the picked ids untouched when no type is picked', () => {
        const picked = ['w1', 'zz'];
        expect(resolveLeadAudienceIds(picked, [], audiences)).toBe(picked);
        const none: string[] = [];
        expect(resolveLeadAudienceIds(none, [], audiences)).toBe(none);
    });

    it('uses every audience of the type when no audience is picked', () => {
        expect(resolveLeadAudienceIds([], ['Google Ads'], audiences)).toEqual(['g1', 'g2']);
    });

    it('keeps only picks of the type', () => {
        expect(resolveLeadAudienceIds(['g2', 'w1'], ['Google Ads'], audiences)).toEqual(['g2']);
    });

    it('returns null, never [], when nothing qualifies', () => {
        expect(resolveLeadAudienceIds([], ['Instagram'], audiences)).toBeNull();
        expect(resolveLeadAudienceIds(['w1'], ['Google Ads'], audiences)).toBeNull();
        expect(resolveLeadAudienceIds([], ['Website'], [])).toBeNull();
    });
});
