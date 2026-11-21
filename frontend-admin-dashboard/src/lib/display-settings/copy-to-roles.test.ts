import { describe, it, expect, vi, beforeEach } from 'vitest';

import { copyDisplaySettingsToRoles, type RoleCopyTarget } from './copy-to-roles';
import type { DisplaySettingsData } from '@/types/display-settings';

const saveDisplaySettings = vi.hoisted(() => vi.fn());

vi.mock('@/services/display-settings', () => ({
    saveDisplaySettings,
}));

/**
 * The copy writes several roles in one gesture, so the two things worth pinning
 * are what each target RECEIVES (its own constraints, not the source's) and what
 * happens when one of the writes fails partway through a batch.
 */

function settings(): DisplaySettingsData {
    return {
        sidebar: [
            { id: 'dashboard', visible: true, order: 0 },
            { id: 'settings', visible: true, order: 1 },
        ],
        dashboard: { widgets: [] },
        postLoginRedirectRoute: '/dashboard',
        permissions: {
            canViewInstituteDetails: true,
            canEditInstituteDetails: true,
            canViewProfileDetails: true,
            canEditProfileDetails: true,
        },
    } as DisplaySettingsData;
}

const target = (settingsKey: string, kind: RoleCopyTarget['kind'], label: string) => ({
    settingsKey,
    kind,
    label,
});

beforeEach(() => {
    saveDisplaySettings.mockReset();
    saveDisplaySettings.mockResolvedValue(undefined);
});

describe('copyDisplaySettingsToRoles', () => {
    it('writes every target and reports them all', async () => {
        const result = await copyDisplaySettingsToRoles(settings(), [
            target('TEACHER_DISPLAY_SETTINGS', 'teacher', 'Teacher'),
            target('CUSTOM_ROLE_DISPLAY_SETTINGS_1', 'custom', 'Counsellor'),
        ]);

        expect(saveDisplaySettings).toHaveBeenCalledTimes(2);
        expect(result.succeeded).toEqual(['Teacher', 'Counsellor']);
        expect(result.failed).toEqual([]);
    });

    it('constrains the blob for the TARGET role, not the source', async () => {
        // Source is an admin blob carrying the Settings tab and institute-edit.
        await copyDisplaySettingsToRoles(settings(), [
            target('CUSTOM_ROLE_DISPLAY_SETTINGS_1', 'custom', 'Counsellor'),
        ]);

        const written = saveDisplaySettings.mock.calls[0]?.[1] as DisplaySettingsData;
        expect(written.sidebar.map((tab) => tab.id)).not.toContain('settings');
        expect(written.permissions.canEditInstituteDetails).toBe(false);
    });

    it('gives each target its own constrained copy', async () => {
        await copyDisplaySettingsToRoles(settings(), [
            target('ADMIN_DISPLAY_SETTINGS', 'admin', 'Admin'),
            target('CUSTOM_ROLE_DISPLAY_SETTINGS_1', 'custom', 'Counsellor'),
        ]);

        const toAdmin = saveDisplaySettings.mock.calls[0]?.[1] as DisplaySettingsData;
        const toCustom = saveDisplaySettings.mock.calls[1]?.[1] as DisplaySettingsData;

        expect(toAdmin.sidebar.map((tab) => tab.id)).toContain('settings');
        expect(toCustom.sidebar.map((tab) => tab.id)).not.toContain('settings');
    });

    it('writes sequentially — custom roles share one blob and would race', async () => {
        // saveDisplaySettings is read-modify-write over the single
        // ROLE_DISPLAY_SETTINGS object. Concurrent writes each read the pre-copy
        // blob and the last one wins, dropping every sibling in the batch.
        const order: string[] = [];
        saveDisplaySettings.mockImplementation(async (key: string) => {
            order.push(`start:${key}`);
            await Promise.resolve();
            order.push(`end:${key}`);
        });

        await copyDisplaySettingsToRoles(settings(), [
            target('CUSTOM_ROLE_DISPLAY_SETTINGS_1', 'custom', 'A'),
            target('CUSTOM_ROLE_DISPLAY_SETTINGS_2', 'custom', 'B'),
        ]);

        expect(order).toEqual([
            'start:CUSTOM_ROLE_DISPLAY_SETTINGS_1',
            'end:CUSTOM_ROLE_DISPLAY_SETTINGS_1',
            'start:CUSTOM_ROLE_DISPLAY_SETTINGS_2',
            'end:CUSTOM_ROLE_DISPLAY_SETTINGS_2',
        ]);
    });

    it('keeps going after one role fails, and names it', async () => {
        saveDisplaySettings
            .mockRejectedValueOnce({ response: { data: { message: 'nope' } } })
            .mockResolvedValueOnce(undefined);

        const result = await copyDisplaySettingsToRoles(settings(), [
            target('CUSTOM_ROLE_DISPLAY_SETTINGS_1', 'custom', 'Counsellor'),
            target('CUSTOM_ROLE_DISPLAY_SETTINGS_2', 'custom', 'Front Desk'),
        ]);

        expect(result.succeeded).toEqual(['Front Desk']);
        expect(result.failed).toEqual([{ label: 'Counsellor', message: 'nope' }]);
    });

    it('never rejects, so a partial copy is reportable rather than thrown away', async () => {
        saveDisplaySettings.mockRejectedValue(new Error('network down'));

        const result = await copyDisplaySettingsToRoles(settings(), [
            target('CUSTOM_ROLE_DISPLAY_SETTINGS_1', 'custom', 'Counsellor'),
        ]);

        expect(result.succeeded).toEqual([]);
        expect(result.failed[0]?.message).toBe('network down');
    });

    it('does nothing when there are no targets', async () => {
        const result = await copyDisplaySettingsToRoles(settings(), []);

        expect(saveDisplaySettings).not.toHaveBeenCalled();
        expect(result).toEqual({ succeeded: [], failed: [] });
    });
});
