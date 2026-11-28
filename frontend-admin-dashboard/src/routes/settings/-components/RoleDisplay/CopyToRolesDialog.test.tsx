import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import enStrings from '../../../../../public/locales/en/settingsRoleDisplayMain.json';
import CopyToRolesDialog from './CopyToRolesDialog';
import type { RoleCopyTarget } from '@/lib/display-settings/copy-to-roles';
import type { DisplaySettingsData } from '@/types/display-settings';

/**
 * Renders the dialog against the REAL `en` catalogue rather than the usual
 * `t: (k) => k` stub. Echoing the key proves a component renders, but it cannot
 * tell a translated string from a missing one — and a key that exists in the
 * component and nowhere in the JSON shows up in production as the literal
 * `copyToRoles.dialog.title`. Resolving here means the "no raw keys" assertion
 * below is a real check on the locale file.
 */
function translate(key: string, vars?: Record<string, unknown>): string {
    const count = vars?.count as number | undefined;
    const lookup = (path: string) =>
        path.split('.').reduce<unknown>((node, part) => {
            if (node && typeof node === 'object') return (node as Record<string, unknown>)[part];
            return undefined;
        }, enStrings as unknown);

    // i18next picks `<key>_other` for counts other than 1.
    let value = count !== undefined && count !== 1 ? lookup(`${key}_other`) : undefined;
    if (typeof value !== 'string') value = lookup(key);
    if (typeof value !== 'string') return key; // surfaces as a raw key in the DOM

    return value.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(vars?.[name] ?? ''));
}

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: translate }),
}));

const toastSpies = vi.hoisted(() => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: toastSpies }));

const services = vi.hoisted(() => ({
    getDisplaySettingsWithFallback: vi.fn(),
    saveDisplaySettings: vi.fn(),
}));
vi.mock('@/services/display-settings', () => services);

const SOURCE_KEY = 'ADMIN_DISPLAY_SETTINGS';

const SOURCE_SETTINGS = {
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

// The institute's real shape: the two system roles plus its own custom ones.
const TARGETS: RoleCopyTarget[] = [
    { settingsKey: SOURCE_KEY, kind: 'admin', label: 'Admin' },
    { settingsKey: 'TEACHER_DISPLAY_SETTINGS', kind: 'teacher', label: 'Teacher' },
    { settingsKey: 'CUSTOM_ROLE_DISPLAY_SETTINGS_15', kind: 'custom', label: 'COUNSELLOR' },
    {
        settingsKey: 'CUSTOM_ROLE_DISPLAY_SETTINGS_7d',
        kind: 'custom',
        label: 'FRONT_DESK_EMPLOYEE',
    },
];

function renderDialog(overrides: Partial<React.ComponentProps<typeof CopyToRolesDialog>> = {}) {
    const onOpenChange = vi.fn();
    render(
        <CopyToRolesDialog
            open
            onOpenChange={onOpenChange}
            sourceSettingsKey={SOURCE_KEY}
            sourceLabel="Admin"
            targets={TARGETS}
            {...overrides}
        />
    );
    return { onOpenChange };
}

const checkboxes = () => screen.getAllByRole('checkbox');

beforeEach(() => {
    services.getDisplaySettingsWithFallback.mockReset();
    services.getDisplaySettingsWithFallback.mockResolvedValue(SOURCE_SETTINGS);
    services.saveDisplaySettings.mockReset();
    services.saveDisplaySettings.mockResolvedValue(undefined);
    toastSpies.success.mockReset();
    toastSpies.error.mockReset();
    toastSpies.warning.mockReset();
});

describe('CopyToRolesDialog — what the admin sees', () => {
    it('lists every other role, including custom ones', () => {
        renderDialog();

        expect(screen.getByText('Teacher')).toBeInTheDocument();
        expect(screen.getByText('COUNSELLOR')).toBeInTheDocument();
        expect(screen.getByText('FRONT_DESK_EMPLOYEE')).toBeInTheDocument();
    });

    it('offers an "All roles" master toggle', () => {
        renderDialog();

        expect(screen.getByText('All roles')).toBeInTheDocument();
        expect(screen.getByText('3 roles')).toBeInTheDocument();
    });

    it('never offers the role being copied FROM', () => {
        renderDialog();

        // "Admin" is the source; it must not appear as a target row.
        expect(screen.queryByText('Admin')).not.toBeInTheDocument();
        // master + 3 targets
        expect(checkboxes()).toHaveLength(4);
    });

    it('renders no raw i18n keys — every string resolves in the en catalogue', () => {
        renderDialog();

        expect(document.body.textContent).not.toMatch(/copyToRoles\./);
    });

    it('says so when there is nothing to copy to', () => {
        renderDialog({ targets: [TARGETS[0]!] });

        expect(screen.getByText('There are no other roles to copy to yet.')).toBeInTheDocument();
    });
});

describe('CopyToRolesDialog — selection', () => {
    it('starts with nothing selected and the confirm button disabled', () => {
        renderDialog();

        expect(screen.getByRole('button', { name: /Copy to 0 roles/ })).toBeDisabled();
    });

    it('"All roles" ticks every target', () => {
        renderDialog();

        fireEvent.click(checkboxes()[0]!);

        expect(screen.getByRole('button', { name: /Copy to 3 roles/ })).toBeEnabled();
    });

    it('unticking "All roles" clears the selection again', () => {
        renderDialog();

        fireEvent.click(checkboxes()[0]!);
        fireEvent.click(checkboxes()[0]!);

        expect(screen.getByRole('button', { name: /Copy to 0 roles/ })).toBeDisabled();
    });

    it('warns that the selected roles will be overwritten', () => {
        renderDialog();

        fireEvent.click(checkboxes()[1]!);

        expect(screen.getByText(/replaces the display settings of 1 role/)).toBeInTheDocument();
    });

    it('a single role can be picked on its own', () => {
        renderDialog();

        fireEvent.click(checkboxes()[1]!);

        expect(screen.getByRole('button', { name: /Copy to 1 role$/ })).toBeEnabled();
    });
});

describe('CopyToRolesDialog — copying', () => {
    it('writes the source settings to each selected role', async () => {
        renderDialog();
        fireEvent.click(checkboxes()[0]!);

        fireEvent.click(screen.getByRole('button', { name: /Copy to 3 roles/ }));

        await waitFor(() => expect(services.saveDisplaySettings).toHaveBeenCalledTimes(3));
        expect(services.getDisplaySettingsWithFallback).toHaveBeenCalledWith(SOURCE_KEY);
        expect(services.saveDisplaySettings.mock.calls.map((c) => c[0])).toEqual([
            'TEACHER_DISPLAY_SETTINGS',
            'CUSTOM_ROLE_DISPLAY_SETTINGS_15',
            'CUSTOM_ROLE_DISPLAY_SETTINGS_7d',
        ]);
    });

    it('strips the admin-only Settings tab on the way to a custom role', async () => {
        // The escalation case, end to end through the dialog.
        renderDialog();
        fireEvent.click(checkboxes()[2]!); // COUNSELLOR

        fireEvent.click(screen.getByRole('button', { name: /Copy to 1 role$/ }));

        await waitFor(() => expect(services.saveDisplaySettings).toHaveBeenCalledTimes(1));
        const written = services.saveDisplaySettings.mock.calls[0]?.[1] as DisplaySettingsData;
        expect(written.sidebar.map((tab) => tab.id)).not.toContain('settings');
        expect(written.permissions.canEditInstituteDetails).toBe(false);
    });

    it('reports success and closes', async () => {
        const { onOpenChange } = renderDialog();
        fireEvent.click(checkboxes()[1]!);

        fireEvent.click(screen.getByRole('button', { name: /Copy to 1 role$/ }));

        await waitFor(() => expect(toastSpies.success).toHaveBeenCalled());
        expect(toastSpies.success.mock.calls[0]?.[0]).toBe('Display settings copied to 1 role');
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('names the roles that failed instead of claiming success', async () => {
        services.saveDisplaySettings
            .mockRejectedValueOnce(new Error('boom'))
            .mockResolvedValueOnce(undefined)
            .mockResolvedValueOnce(undefined);

        renderDialog();
        fireEvent.click(checkboxes()[0]!);

        fireEvent.click(screen.getByRole('button', { name: /Copy to 3 roles/ }));

        await waitFor(() => expect(toastSpies.warning).toHaveBeenCalled());
        expect(toastSpies.warning.mock.calls[0]?.[0]).toContain('Teacher');
        expect(toastSpies.success).not.toHaveBeenCalled();
    });

    it('keeps the dialog open when nothing landed, so the attempt is not lost', async () => {
        services.saveDisplaySettings.mockRejectedValue(new Error('offline'));

        const { onOpenChange } = renderDialog();
        fireEvent.click(checkboxes()[1]!);

        fireEvent.click(screen.getByRole('button', { name: /Copy to 1 role$/ }));

        await waitFor(() => expect(toastSpies.error).toHaveBeenCalled());
        expect(onOpenChange).not.toHaveBeenCalledWith(false);
    });
});
