import { describe, expect, it } from 'vitest';

import { mergeDisplayWithDefaults } from './display-settings';
import {
    ADMIN_DISPLAY_SETTINGS_KEY,
    TEACHER_DISPLAY_SETTINGS_KEY,
    type DisplaySettingsData,
    type StudentSideViewSettings,
} from '@/types/display-settings';

/**
 * `allowResendMessage` decides whether an admin can send a learner the same message twice from
 * their Notifications tab. Adding a flag to these settings has a known failure mode: the Role
 * Display page saves the FULLY MERGED object, so every institute that has ever opened and saved it
 * carries explicit values for the flags that existed then — and a new flag has to survive landing
 * in a blob that predates it. These pin that, per role, rather than trusting the `??` chain.
 */

const resendFor = (role: string, incoming?: Partial<DisplaySettingsData>): boolean | undefined =>
    mergeDisplayWithDefaults(incoming, role as never).studentSideView?.allowResendMessage;

/** A blob saved before this flag existed: studentSideView present, the new key absent. */
const savedBeforeTheFlag = (): Partial<DisplaySettingsData> & {
    studentSideView: StudentSideViewSettings;
} => ({
    studentSideView: {
        overviewTab: true,
        testTab: true,
        progressTab: true,
        coursesTab: true,
        notificationTab: true,
        membershipTab: false,
        paymentHistoryTab: true,
        userTaggingTab: false,
        badgesTab: true,
        fileTab: false,
        portalAccessTab: false,
        reportsTab: false,
        enrollDerollTab: false,
        enquiryTab: false,
        applicationTab: false,
        leadTab: false,
    },
});

describe('allowResendMessage defaults', () => {
    it('is on for admin when nothing was ever saved', () => {
        expect(resendFor(ADMIN_DISPLAY_SETTINGS_KEY)).toBe(true);
    });

    // The whole point of the flag's optionality: an institute that saved its display settings
    // months ago must still get the admin default rather than a silent `undefined` → hidden button.
    it('is on for admin in a blob saved before the flag existed', () => {
        expect(resendFor(ADMIN_DISPLAY_SETTINGS_KEY, savedBeforeTheFlag())).toBe(true);
    });

    it('is off for teacher and custom roles unless they turn it on', () => {
        expect(resendFor(TEACHER_DISPLAY_SETTINGS_KEY)).toBe(false);
        expect(resendFor(TEACHER_DISPLAY_SETTINGS_KEY, savedBeforeTheFlag())).toBe(false);
        // Custom roles baseline off the teacher defaults.
        expect(resendFor('CUSTOM_ROLE_DISPLAY_SETTINGS_KEY')).toBe(false);
    });

    it('respects an explicit choice over the role default, in both directions', () => {
        const off = savedBeforeTheFlag();
        off.studentSideView.allowResendMessage = false;
        expect(resendFor(ADMIN_DISPLAY_SETTINGS_KEY, off)).toBe(false);

        const on = savedBeforeTheFlag();
        on.studentSideView.allowResendMessage = true;
        expect(resendFor(TEACHER_DISPLAY_SETTINGS_KEY, on)).toBe(true);
    });
});
