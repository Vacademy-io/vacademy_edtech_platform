import { describe, expect, it } from 'vitest';

import { resolveLiveClassActions } from './live-class-actions';
import { mergeDisplayWithDefaults } from '@/services/display-settings';
import {
    ADMIN_DISPLAY_SETTINGS_KEY,
    CUSTOM_ROLE_DISPLAY_SETTINGS_KEY,
    TEACHER_DISPLAY_SETTINGS_KEY,
    type DisplaySettingsData,
} from '@/types/display-settings';

/**
 * "Delete" on the Past tab is on for admin and off for every other role. Every
 * institute's saved blob predates `liveClassActions`, so the role default has to
 * survive a blob that lacks the section — and a saved choice has to survive the merge.
 */

const CUSTOM_KEY = `${CUSTOM_ROLE_DISPLAY_SETTINGS_KEY}_42`;

const mergedFlag = (role: string, incoming?: Partial<DisplaySettingsData>) =>
    mergeDisplayWithDefaults(incoming, role as never).liveClassActions?.allowDeletePastSessions;

/** A blob saved before this flag existed: other live-class settings present, the section absent. */
const savedBeforeTheFlag = (): Partial<DisplaySettingsData> => ({
    liveClassScheduling: { bulkScheduleEnabled: true, singleScheduleEnabled: true },
});

describe('allowDeletePastSessions merge', () => {
    it('is on for admin, including a blob saved before the flag existed', () => {
        expect(mergedFlag(ADMIN_DISPLAY_SETTINGS_KEY)).toBe(true);
        expect(mergedFlag(ADMIN_DISPLAY_SETTINGS_KEY, savedBeforeTheFlag())).toBe(true);
    });

    it('is off for teacher and custom roles unless turned on', () => {
        expect(mergedFlag(TEACHER_DISPLAY_SETTINGS_KEY, savedBeforeTheFlag())).toBe(false);
        expect(mergedFlag(CUSTOM_KEY, savedBeforeTheFlag())).toBe(false);
    });

    it('keeps a saved choice in either direction', () => {
        expect(
            mergedFlag(ADMIN_DISPLAY_SETTINGS_KEY, {
                liveClassActions: { allowDeletePastSessions: false },
            })
        ).toBe(false);
        expect(
            mergedFlag(TEACHER_DISPLAY_SETTINGS_KEY, {
                liveClassActions: { allowDeletePastSessions: true },
            })
        ).toBe(true);
    });
});

describe('resolveLiveClassActions', () => {
    // A cold cache hands the resolver no settings at all; it must not flash the
    // button in for a teacher while their settings load.
    it('falls back to the role default when settings are missing', () => {
        expect(resolveLiveClassActions(undefined, ADMIN_DISPLAY_SETTINGS_KEY)).toEqual({
            canDeletePastSessions: true,
        });
        expect(resolveLiveClassActions(undefined, TEACHER_DISPLAY_SETTINGS_KEY)).toEqual({
            canDeletePastSessions: false,
        });
        expect(resolveLiveClassActions(undefined, CUSTOM_KEY)).toEqual({
            canDeletePastSessions: false,
        });
    });

    it('follows the saved flag over the role default', () => {
        expect(
            resolveLiveClassActions({ allowDeletePastSessions: false }, ADMIN_DISPLAY_SETTINGS_KEY)
                .canDeletePastSessions
        ).toBe(false);
        expect(
            resolveLiveClassActions({ allowDeletePastSessions: true }, CUSTOM_KEY)
                .canDeletePastSessions
        ).toBe(true);
    });
});
