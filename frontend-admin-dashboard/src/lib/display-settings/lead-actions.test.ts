import { describe, expect, it } from 'vitest';

import { resolveLeadActions } from './lead-actions';
import { mergeDisplayWithDefaults } from '@/services/display-settings';
import {
    ADMIN_DISPLAY_SETTINGS_KEY,
    CUSTOM_ROLE_DISPLAY_SETTINGS_KEY,
    TEACHER_DISPLAY_SETTINGS_KEY,
    type DisplaySettingsData,
} from '@/types/display-settings';

/**
 * "Add New Lead" on All Leads is off for every role, admin included, and only an
 * explicit saved `true` turns it on. Every saved blob predates `leadActions`.
 */

const CUSTOM_KEY = `${CUSTOM_ROLE_DISPLAY_SETTINGS_KEY}_15`;
const ROLES = [ADMIN_DISPLAY_SETTINGS_KEY, TEACHER_DISPLAY_SETTINGS_KEY, CUSTOM_KEY];

const mergedFlag = (role: string, incoming?: Partial<DisplaySettingsData>) =>
    mergeDisplayWithDefaults(incoming, role as never).leadActions?.showAddLead;

const savedBeforeTheFlag = (): Partial<DisplaySettingsData> => ({
    liveClassActions: { allowDeletePastSessions: true },
});

describe('showAddLead merge', () => {
    it('is off for every role, including a blob saved before the flag existed', () => {
        for (const role of ROLES) {
            expect(mergedFlag(role)).toBe(false);
            expect(mergedFlag(role, savedBeforeTheFlag())).toBe(false);
        }
    });

    it('keeps a saved choice', () => {
        for (const role of ROLES) {
            expect(mergedFlag(role, { leadActions: { showAddLead: true } })).toBe(true);
            expect(mergedFlag(role, { leadActions: { showAddLead: false } })).toBe(false);
        }
    });
});

describe('allowEditFormResponses merge', () => {
    const editFlag = (role: string, incoming?: Partial<DisplaySettingsData>) =>
        mergeDisplayWithDefaults(incoming, role as never).leadActions?.allowEditFormResponses;

    it('is on for admin and off for other roles when never saved', () => {
        expect(editFlag(ADMIN_DISPLAY_SETTINGS_KEY)).toBe(true);
        expect(editFlag(ADMIN_DISPLAY_SETTINGS_KEY, savedBeforeTheFlag())).toBe(true);
        for (const role of [TEACHER_DISPLAY_SETTINGS_KEY, CUSTOM_KEY]) {
            expect(editFlag(role)).toBe(false);
            expect(editFlag(role, savedBeforeTheFlag())).toBe(false);
        }
    });

    it('keeps a saved choice', () => {
        for (const role of ROLES) {
            expect(editFlag(role, { leadActions: { allowEditFormResponses: true } })).toBe(true);
            expect(editFlag(role, { leadActions: { allowEditFormResponses: false } })).toBe(false);
        }
    });
});

describe('resolveLeadActions', () => {
    it('hides Add New Lead on a cold cache or an absent flag', () => {
        for (const role of ROLES) {
            expect(resolveLeadActions(undefined, role).canAddLead).toBe(false);
            expect(resolveLeadActions({}, role).canAddLead).toBe(false);
        }
    });

    it('shows Add New Lead only for an explicit true', () => {
        expect(resolveLeadActions({ showAddLead: true }, CUSTOM_KEY).canAddLead).toBe(true);
        expect(resolveLeadActions({ showAddLead: false }, CUSTOM_KEY).canAddLead).toBe(false);
    });

    it('falls back to the role default for form-answer editing', () => {
        expect(resolveLeadActions(undefined, ADMIN_DISPLAY_SETTINGS_KEY).canEditFormResponses).toBe(
            true
        );
        expect(
            resolveLeadActions(undefined, TEACHER_DISPLAY_SETTINGS_KEY).canEditFormResponses
        ).toBe(false);
        expect(resolveLeadActions({}, CUSTOM_KEY).canEditFormResponses).toBe(false);
    });

    it('lets a saved flag override the role default', () => {
        expect(
            resolveLeadActions({ allowEditFormResponses: false }, ADMIN_DISPLAY_SETTINGS_KEY)
                .canEditFormResponses
        ).toBe(false);
        expect(
            resolveLeadActions({ allowEditFormResponses: true }, CUSTOM_KEY).canEditFormResponses
        ).toBe(true);
    });
});
