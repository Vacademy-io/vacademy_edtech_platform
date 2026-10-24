import { describe, expect, it } from 'vitest';
import {
    extractLeadSettingData,
    followUpStatusFilter,
    mergeLeadSettings,
    LEAD_SETTINGS_DEFAULTS,
} from '@/hooks/use-lead-settings';

// The endpoint answers with the SettingDto itself: { key, name, data }.
const settingDtoResponse = {
    key: 'LEAD_SETTING',
    name: 'Lead Settings',
    data: {
        enabled: true,
        showScoreInStudentsTable: false,
        labels: { tier: 'Interest Level', leadStatus: 'Action Label' },
    },
};

describe('extractLeadSettingData', () => {
    it('reads the config the real endpoint returns (response.data.data)', () => {
        const data = extractLeadSettingData(settingDtoResponse);
        expect(data?.labels).toEqual({ tier: 'Interest Level', leadStatus: 'Action Label' });
        expect(data?.showScoreInStudentsTable).toBe(false);
    });

    it('still reads a wrapped {[key]: {data}} payload', () => {
        const wrapped = { data: { LEAD_SETTING: { data: { labels: { tier: 'Heat' } } } } };
        expect(extractLeadSettingData(wrapped)?.labels).toEqual({ tier: 'Heat' });
    });

    it('returns undefined for an empty or malformed body', () => {
        expect(extractLeadSettingData(undefined)).toBeUndefined();
        expect(extractLeadSettingData(null)).toBeUndefined();
        expect(extractLeadSettingData({})).toBeUndefined();
        expect(extractLeadSettingData({ data: null })).toBeUndefined();
        expect(extractLeadSettingData('nope')).toBeUndefined();
    });
});

describe('mergeLeadSettings', () => {
    it('keeps the saved values and fills the rest from defaults', () => {
        const merged = mergeLeadSettings(extractLeadSettingData(settingDtoResponse));
        expect(merged.labels).toEqual({ tier: 'Interest Level', leadStatus: 'Action Label' });
        expect(merged.showScoreInStudentsTable).toBe(false);
        // untouched keys fall back
        expect(merged.showScoreInEnquiryTable).toBe(LEAD_SETTINGS_DEFAULTS.showScoreInEnquiryTable);
        expect(merged.recencyDecayDays).toBe(LEAD_SETTINGS_DEFAULTS.recencyDecayDays);
    });

    it('a partially-saved nested group cannot drop sibling keys', () => {
        const merged = mergeLeadSettings({ scoringWeights: { recency: 40 } as never });
        expect(merged.scoringWeights.recency).toBe(40);
        expect(merged.scoringWeights.engagement).toBe(
            LEAD_SETTINGS_DEFAULTS.scoringWeights.engagement
        );
    });

    it('falls back to defaults when nothing is saved', () => {
        expect(mergeLeadSettings(undefined)).toEqual(LEAD_SETTINGS_DEFAULTS);
    });

    it('hides converted leads from All leads only when the institute opted in', () => {
        // Institutes that never saved the flag keep seeing converted leads.
        expect(mergeLeadSettings(extractLeadSettingData(settingDtoResponse))).toMatchObject({
            hideConvertedInAllLeads: false,
        });
        expect(mergeLeadSettings({ hideConvertedInAllLeads: true }).hideConvertedInAllLeads).toBe(
            true
        );
    });
});

describe('follow-up fields config', () => {
    it('is off with empty lists for an institute that has never configured it', () => {
        expect(mergeLeadSettings({}).followUpFields).toEqual({
            enabled: false,
            studentResponses: [],
            followUpModes: [],
            nextActions: [],
            interestLevels: [],
            notesRequired: false,
            fieldsRequired: false,
            // Behaviour switches: all off, so nothing changes until an institute opts in.
            keepPopupsOpen: false,
            showHistory: false,
            allowEditing: false,
            reportExports: false,
        });
    });

    it('keeps the saved lists and fills in any the institute left out', () => {
        const merged = mergeLeadSettings({
            followUpFields: { enabled: true, studentResponses: ['Interested'] },
        } as unknown as Partial<typeof LEAD_SETTINGS_DEFAULTS>);
        expect(merged.followUpFields.enabled).toBe(true);
        expect(merged.followUpFields.studentResponses).toEqual(['Interested']);
        // Not saved → still an empty list, not undefined: the form maps over these.
        expect(merged.followUpFields.followUpModes).toEqual([]);
        expect(merged.followUpFields.nextActions).toEqual([]);
    });
});

describe('follow-up fields config survives a hand-edited setting_json', () => {
    // This subtree is written straight into institutes.setting_json when an
    // institute is onboarded, so the parse has to tolerate anything.
    const cases: [string, unknown][] = [
        ['null lists', { enabled: true, studentResponses: null, followUpModes: null }],
        ['a string where a list belongs', { enabled: true, nextActions: 'Call Back' }],
        ['enabled as the string "true"', { enabled: 'true', studentResponses: ['A'] }],
        ['the whole block null', null],
    ];
    it.each(cases)('does not throw on %s', (_label, followUpFields) => {
        const merged = mergeLeadSettings({
            followUpFields,
        } as unknown as Partial<typeof LEAD_SETTINGS_DEFAULTS>);
        expect(Array.isArray(merged.followUpFields.studentResponses)).toBe(true);
        expect(Array.isArray(merged.followUpFields.followUpModes)).toBe(true);
        expect(Array.isArray(merged.followUpFields.nextActions)).toBe(true);
        expect(typeof merged.followUpFields.enabled).toBe('boolean');
    });

    it('drops non-string entries rather than rendering them', () => {
        const merged = mergeLeadSettings({
            followUpFields: { enabled: true, studentResponses: ['Call Back', 42, null, 'Busy'] },
        } as unknown as Partial<typeof LEAD_SETTINGS_DEFAULTS>);
        expect(merged.followUpFields.studentResponses).toEqual(['Call Back', 'Busy']);
    });

    it('only a real boolean true turns the block on', () => {
        const merged = mergeLeadSettings({
            followUpFields: { enabled: 'true', studentResponses: ['A'] },
        } as unknown as Partial<typeof LEAD_SETTINGS_DEFAULTS>);
        expect(merged.followUpFields.enabled).toBe(false);
    });
});

describe('notesRequired', () => {
    it('is off by default — the note has always been optional', () => {
        expect(mergeLeadSettings({}).followUpFields.notesRequired).toBe(false);
        expect(LEAD_SETTINGS_DEFAULTS.followUpFields.notesRequired).toBe(false);
    });

    it('is independent of the dropdowns — a note can be required without them', () => {
        const merged = mergeLeadSettings({
            followUpFields: { enabled: false, notesRequired: true },
        } as unknown as Partial<typeof LEAD_SETTINGS_DEFAULTS>);
        expect(merged.followUpFields.enabled).toBe(false);
        expect(merged.followUpFields.notesRequired).toBe(true);
    });

    it('only a real boolean true makes it mandatory', () => {
        // A hand-written "true" must not quietly start blocking counsellors.
        const merged = mergeLeadSettings({
            followUpFields: { notesRequired: 'true' },
        } as unknown as Partial<typeof LEAD_SETTINGS_DEFAULTS>);
        expect(merged.followUpFields.notesRequired).toBe(false);
    });
});

describe('lead lookup config', () => {
    it('is off and shares nothing for an institute that never configured it', () => {
        const { leadLookup } = mergeLeadSettings({});
        expect(leadLookup.enabled).toBe(false);
        expect(Object.values(leadLookup.fields).every((v) => v === false)).toBe(true);
        expect(leadLookup.courseFieldId).toBe('');
    });

    it('survives a hand-written setting_json', () => {
        // Written straight into institutes.setting_json during onboarding — a
        // missing fields object must not make every fields.name read throw.
        const { leadLookup } = mergeLeadSettings({
            leadLookup: { enabled: true },
        } as unknown as Partial<typeof LEAD_SETTINGS_DEFAULTS>);
        expect(leadLookup.fields.name).toBe(false);
        expect(leadLookup.fields.counsellor).toBe(false);
        expect(leadLookup.courseFieldId).toBe('');
        expect(leadLookup.branchFieldId).toBe('');
    });

    it('reads the branch and enquired-by switches and the branch field id', () => {
        const { leadLookup } = mergeLeadSettings({
            leadLookup: {
                enabled: true,
                fields: { branch: true, enquiredBy: true },
                branchFieldId: 'field-branch',
            },
        } as unknown as Partial<typeof LEAD_SETTINGS_DEFAULTS>);
        expect(leadLookup.fields.branch).toBe(true);
        expect(leadLookup.fields.enquiredBy).toBe(true);
        expect(leadLookup.branchFieldId).toBe('field-branch');
    });

    it('only a real boolean true shares a field', () => {
        const { leadLookup } = mergeLeadSettings({
            leadLookup: { enabled: 'true', fields: { name: 'true', counsellor: true } },
        } as unknown as Partial<typeof LEAD_SETTINGS_DEFAULTS>);
        expect(leadLookup.enabled).toBe(false);
        expect(leadLookup.fields.name).toBe(false);
        expect(leadLookup.fields.counsellor).toBe(true);
    });
});

describe('fieldsRequired', () => {
    it('is off by default — the dropdowns shipped optional', () => {
        expect(mergeLeadSettings({}).followUpFields.fieldsRequired).toBe(false);
    });

    it('is independent of notesRequired', () => {
        const merged = mergeLeadSettings({
            followUpFields: { fieldsRequired: true, notesRequired: false },
        } as unknown as Partial<typeof LEAD_SETTINGS_DEFAULTS>);
        expect(merged.followUpFields.fieldsRequired).toBe(true);
        expect(merged.followUpFields.notesRequired).toBe(false);
    });

    it('only a real boolean true starts blocking counsellors', () => {
        const merged = mergeLeadSettings({
            followUpFields: { fieldsRequired: 'true' },
        } as unknown as Partial<typeof LEAD_SETTINGS_DEFAULTS>);
        expect(merged.followUpFields.fieldsRequired).toBe(false);
    });
});

describe('hideLostInFollowUps', () => {
    it('is on for an institute that never saved it, off only when switched off', () => {
        expect(mergeLeadSettings(undefined).hideLostInFollowUps).toBe(true);
        expect(mergeLeadSettings({}).hideLostInFollowUps).toBe(true);
        expect(mergeLeadSettings({ hideLostInFollowUps: false }).hideLostInFollowUps).toBe(false);
    });
});

describe('followUpStatusFilter', () => {
    it('excludes LOST when the route names nothing and the setting is on', () => {
        expect(followUpStatusFilter('', false, true)).toEqual({ leadStatusExcludeId: 'LOST' });
    });

    it('sends nothing when the route names nothing and the setting is off', () => {
        expect(followUpStatusFilter('', false, false)).toEqual({});
    });

    it('adds LOST to a route exclude list once', () => {
        expect(followUpStatusFilter('JUNK', true, true)).toEqual({
            leadStatusExcludeId: 'JUNK,LOST',
        });
        expect(followUpStatusFilter('LOST', true, true)).toEqual({ leadStatusExcludeId: 'LOST' });
    });

    it('keeps a route exclude list as-is when the setting is off', () => {
        expect(followUpStatusFilter('LOST', true, false)).toEqual({ leadStatusExcludeId: 'LOST' });
    });

    it('leaves a route that includes statuses alone', () => {
        expect(followUpStatusFilter('LOST', false, true)).toEqual({ leadStatusId: 'LOST' });
        expect(followUpStatusFilter('HOT,WARM', false, true)).toEqual({ leadStatusId: 'HOT,WARM' });
    });
});
