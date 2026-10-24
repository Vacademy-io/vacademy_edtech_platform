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

describe('resolveLeadActions', () => {
    it('hides the button on a cold cache or an absent flag', () => {
        expect(resolveLeadActions(undefined)).toEqual({ canAddLead: false });
        expect(resolveLeadActions({})).toEqual({ canAddLead: false });
    });

    it('shows it only for an explicit true', () => {
        expect(resolveLeadActions({ showAddLead: true }).canAddLead).toBe(true);
        expect(resolveLeadActions({ showAddLead: false }).canAddLead).toBe(false);
    });
});
