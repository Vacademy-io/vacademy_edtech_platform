import { describe, it, expect } from 'vitest';
import {
    UTM_UNTAGGED_SENTINEL,
    dimensionFromUtmFilterId,
    hasUtmSelection,
    readUtmSelection,
    toUtmFiltersPayload,
    utmFilterId,
    utmSelectionKey,
    utmValueLabel,
} from '@/components/shared/leads/utm-filter-encoding';

describe('campaign (UTM) filter encoding', () => {
    // The pages that keep filters in a columnFilters array (Contacts, Students)
    // carry the UTM selection under `utm:<dimension>` ids. Anything else in the
    // array must be ignored, and an unknown dimension must never be forwarded
    // to the API as a filter it does not understand.
    it('round-trips a selection through columnFilters ids', () => {
        expect(utmFilterId('source')).toBe('utm:source');
        expect(dimensionFromUtmFilterId('utm:campaign')).toBe('campaign');
        expect(dimensionFromUtmFilterId('utm:bogus')).toBeNull();
        expect(dimensionFromUtmFilterId('cf:abc')).toBeNull();

        const selection = readUtmSelection([
            { id: 'batch', value: [{ id: 'b1', label: 'Batch 1' }] },
            { id: 'utm:source', value: [{ id: 'facebook', label: 'facebook' }] },
            {
                id: 'utm:campaign',
                value: [
                    { id: 'diwali-2026', label: 'diwali-2026' },
                    { id: 'ganesh-2026', label: 'ganesh-2026' },
                ],
            },
            { id: 'utm:term', value: [] },
        ]);
        expect(selection).toEqual({
            source: ['facebook'],
            campaign: ['diwali-2026', 'ganesh-2026'],
        });
    });

    it('serialises to the snake_case request payload the backend reads', () => {
        expect(
            toUtmFiltersPayload({
                source: ['facebook', 'instagram'],
                medium: ['cpc'],
                campaign: ['diwali-2026'],
                content: ['banner-a'],
                term: ['jee'],
                source_type: ['ENROLL_INVITE'],
            })
        ).toEqual({
            sources: ['facebook', 'instagram'],
            mediums: ['cpc'],
            campaigns: ['diwali-2026'],
            contents: ['banner-a'],
            terms: ['jee'],
            source_types: ['ENROLL_INVITE'],
        });
    });

    // Sending `utm_filters: {}` is not "no filter" to a reader skimming a
    // request log, and spreading `undefined` keeps the payload identical to
    // what the page sent before this feature existed.
    it('is undefined when nothing is selected', () => {
        expect(toUtmFiltersPayload(undefined)).toBeUndefined();
        expect(toUtmFiltersPayload({})).toBeUndefined();
        expect(toUtmFiltersPayload({ source: [], campaign: [] })).toBeUndefined();
        expect(hasUtmSelection({ source: [] })).toBe(false);
        expect(hasUtmSelection({ source: ['x'] })).toBe(true);
    });

    // "No campaign" is the organic-vs-campaign question. It cannot coexist with
    // named values (a person is not both untagged and from facebook), so the
    // payload collapses to the flag alone and drops every value list.
    it('turns the untagged sentinel into untagged_only and drops the lists', () => {
        expect(
            toUtmFiltersPayload({
                source: [UTM_UNTAGGED_SENTINEL],
                campaign: ['diwali-2026'],
            })
        ).toEqual({ untagged_only: true });
        expect(utmValueLabel(UTM_UNTAGGED_SENTINEL, 'No campaign')).toBe('No campaign');
        expect(utmValueLabel('facebook', 'No campaign')).toBe('facebook');
    });

    // Query keys must not split on selection order — picking instagram then
    // facebook is the same page as facebook then instagram.
    it('builds an order-independent cache key', () => {
        expect(utmSelectionKey({ source: ['instagram', 'facebook'], campaign: ['x'] })).toBe(
            utmSelectionKey({ campaign: ['x'], source: ['facebook', 'instagram'] })
        );
        expect(utmSelectionKey({})).toBe('');
        expect(utmSelectionKey(undefined)).toBe('');
    });
});
