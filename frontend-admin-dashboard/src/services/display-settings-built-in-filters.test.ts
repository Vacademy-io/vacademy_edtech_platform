import { describe, expect, it } from 'vitest';
import { mergeDisplayWithDefaults } from './display-settings';
import {
    ADMIN_DISPLAY_SETTINGS_KEY,
    listBuiltInFiltersFor,
    type DisplaySettingsData,
} from '@/types/display-settings';

/**
 * The built-in filter switches ("Manage filters" → Built-in filters) are stored on the ADMIN
 * blob as listBuiltInFilterControls. Every load and save runs the blob through
 * mergeDisplayWithDefaults, so the merge has to keep them, or a switch turned off comes back on.
 */
describe('built-in filter switches survive the display-settings merge', () => {
    it('keeps the saved switches for every surface', () => {
        const saved: Partial<DisplaySettingsData> = {
            listBuiltInFilterControls: {
                STUDENTS: { hidden: ['city'] },
                LEADS: { hidden: ['counsellor', 'audience'] },
            },
        };

        const merged = mergeDisplayWithDefaults(saved, ADMIN_DISPLAY_SETTINGS_KEY);

        expect(merged.listBuiltInFilterControls).toEqual(saved.listBuiltInFilterControls);
    });

    it('leaves them absent when nothing was saved, so every filter shows', () => {
        const merged = mergeDisplayWithDefaults({}, ADMIN_DISPLAY_SETTINGS_KEY);

        expect(merged.listBuiltInFilterControls?.STUDENTS?.hidden ?? []).toEqual([]);
    });
});

describe('which built-in filters each list offers', () => {
    it('adds City and Region on the learner list only', () => {
        expect(listBuiltInFiltersFor('STUDENTS')).toEqual([
            'counsellor',
            'campaignType',
            'audience',
            'city',
            'region',
        ]);
        expect(listBuiltInFiltersFor('LEADS')).toEqual(['counsellor', 'campaignType', 'audience']);
        expect(listBuiltInFiltersFor('CONTACTS')).toEqual([
            'counsellor',
            'campaignType',
            'audience',
        ]);
    });
});
