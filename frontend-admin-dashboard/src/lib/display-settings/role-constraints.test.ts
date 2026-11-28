import { describe, it, expect } from 'vitest';

import { applyRoleConstraints, roleKindForSettingsKey } from './role-constraints';
import {
    ADMIN_DISPLAY_SETTINGS_KEY,
    CUSTOM_ROLE_DISPLAY_SETTINGS_KEY,
    TEACHER_DISPLAY_SETTINGS_KEY,
    type DisplaySettingsData,
} from '@/types/display-settings';

/**
 * These rules stopped being a formality the moment "copy to other roles" existed.
 * Before it, a panel could only write its own role and the constraint was a
 * belt-and-braces re-assert of what its own UI already enforced. Now one role's
 * blob is written under another role's key, so the constraint is the ONLY thing
 * standing between "copy admin settings to the Counsellor role" and handing every
 * counsellor the Settings tab and institute-edit rights.
 */

function settings(overrides: Partial<DisplaySettingsData> = {}): DisplaySettingsData {
    return {
        sidebar: [
            { id: 'dashboard', visible: true, order: 0 },
            { id: 'settings', visible: false, order: 1 },
            { id: 'courses', visible: true, order: 2 },
        ],
        dashboard: { widgets: [] },
        postLoginRedirectRoute: '/dashboard',
        permissions: {
            canViewInstituteDetails: true,
            canEditInstituteDetails: true,
            canViewProfileDetails: true,
            canEditProfileDetails: true,
        },
        ...overrides,
    } as DisplaySettingsData;
}

const sidebarIds = (data: DisplaySettingsData) => data.sidebar.map((tab) => tab.id);

describe('roleKindForSettingsKey', () => {
    it('maps the admin and teacher keys to their own kinds', () => {
        expect(roleKindForSettingsKey(ADMIN_DISPLAY_SETTINGS_KEY)).toBe('admin');
        expect(roleKindForSettingsKey(TEACHER_DISPLAY_SETTINGS_KEY)).toBe('teacher');
    });

    it('maps a per-role custom key to custom', () => {
        expect(roleKindForSettingsKey(`${CUSTOM_ROLE_DISPLAY_SETTINGS_KEY}_abc-123`)).toBe(
            'custom'
        );
        expect(roleKindForSettingsKey(CUSTOM_ROLE_DISPLAY_SETTINGS_KEY)).toBe('custom');
    });

    it('treats an unrecognised key as the most restricted kind, not the least', () => {
        // Guessing "admin" for an unknown key would turn a typo into an escalation.
        expect(roleKindForSettingsKey('SOMETHING_ELSE')).toBe('custom');
    });
});

describe('applyRoleConstraints — admin', () => {
    it('forces the Settings tab visible so an institute cannot lock itself out', () => {
        const result = applyRoleConstraints(settings(), 'admin');

        expect(result.sidebar.find((tab) => tab.id === 'settings')?.visible).toBe(true);
    });

    it('leaves institute permissions as configured', () => {
        const result = applyRoleConstraints(settings(), 'admin');

        expect(result.permissions.canEditInstituteDetails).toBe(true);
    });

    it('does not mutate its input', () => {
        const input = settings();
        applyRoleConstraints(input, 'admin');

        expect(input.sidebar.find((tab) => tab.id === 'settings')?.visible).toBe(false);
    });
});

describe.each(['teacher', 'custom'] as const)('applyRoleConstraints — %s', (kind) => {
    it('strips the Settings tab entirely', () => {
        const result = applyRoleConstraints(settings(), kind);

        expect(sidebarIds(result)).toEqual(['dashboard', 'courses']);
    });

    it('denies institute editing however the source had it', () => {
        const result = applyRoleConstraints(settings(), kind);

        expect(result.permissions.canEditInstituteDetails).toBe(false);
    });

    it('keeps the other sidebar tabs and their order', () => {
        const result = applyRoleConstraints(settings(), kind);

        expect(result.sidebar.map((tab) => tab.order)).toEqual([0, 2]);
    });
});

describe('copying across role kinds', () => {
    it('an admin blob constrained for a custom role carries neither Settings nor institute edit', () => {
        // The exact path "copy to other roles" takes for Admin → Counsellor. This is
        // the privilege-escalation case the helper exists to prevent.
        const adminBlob = applyRoleConstraints(settings(), 'admin');

        const forCounsellor = applyRoleConstraints(adminBlob, 'custom');

        expect(sidebarIds(forCounsellor)).not.toContain('settings');
        expect(forCounsellor.permissions.canEditInstituteDetails).toBe(false);
    });

    it('is idempotent — re-applying the same kind changes nothing further', () => {
        const once = applyRoleConstraints(settings(), 'teacher');
        const twice = applyRoleConstraints(once, 'teacher');

        expect(twice).toEqual(once);
    });

    it('tolerates a blob with no sidebar array rather than throwing mid-copy', () => {
        // A partially-saved or hand-edited blob must not take down a multi-role copy.
        const sparse = { permissions: {} } as unknown as DisplaySettingsData;

        expect(() => applyRoleConstraints(sparse, 'custom')).not.toThrow();
        expect(applyRoleConstraints(sparse, 'admin').sidebar).toEqual([]);
    });
});
