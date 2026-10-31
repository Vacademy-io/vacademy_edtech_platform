/**
 * Display Settings → Sidebar Tabs used to render a column of empty "Tab Name" and
 * "Label" boxes next to correctly-filled routes: the built-in names resolve
 * through i18next, and they were being read at module-evaluation time, before
 * i18next had been initialised, so every one of them was `undefined`.
 *
 * A saved institute config stores ids, routes, order and visibility but no
 * labels for built-in tabs — that is what `savedSettings` below reproduces — so
 * the names have to come from the sidebar catalog at render time.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import sidebarEn from '../../../../../public/locales/en/sidebar.json';
import type { DisplaySettingsData } from '@/types/display-settings';

const savedSettings: DisplaySettingsData = {
    sidebar: [
        {
            id: 'manage-contacts',
            route: '/manage-contacts',
            order: 1,
            visible: true,
            subTabs: [
                { id: 'all-contacts', route: '/manage-contacts', order: 1, visible: true },
                { id: 'user-tags-main', route: '/user-tags/institute', order: 2, visible: true },
            ],
        },
        {
            id: 'admissions',
            route: '',
            order: 2,
            visible: false,
            subTabs: [
                {
                    id: 'admission-dashboard',
                    route: '/admissions/dashboard',
                    order: 1,
                    visible: true,
                },
            ],
        },
    ],
    dashboard: { widgets: [] },
    permissions: {
        canViewInstituteDetails: false,
        canEditInstituteDetails: false,
        canViewProfileDetails: false,
        canEditProfileDetails: false,
    },
    postLoginRedirectRoute: '/dashboard',
};

vi.mock('@/services/display-settings', () => ({
    getDisplaySettingsWithFallback: vi.fn(async () => savedSettings),
    saveDisplaySettings: vi.fn(async () => undefined),
}));

vi.mock('@/routes/settings/-hooks/use-offline-access-enabled', () => ({
    useOfflineAccessEnabled: () => false,
}));

// Needs a live TanStack router to install its navigation blocker; the save bar
// is not what this test is about.
vi.mock('@/components/common/unsaved-changes-bar', () => ({
    useUnsavedChangesGuard: () => undefined,
    UnsavedChangesBar: () => null,
}));

// Imported at module scope, while i18next is still uninitialised — the same
// order production uses, and the one that produced the blank boxes.
import AdminDisplaySettings from './AdminDisplaySettings';

beforeAll(async () => {
    await i18next.use(initReactI18next).init({
        lng: 'en',
        fallbackLng: 'en',
        ns: ['sidebar', 'settingsAdminDisplay'],
        defaultNS: 'settingsAdminDisplay',
        resources: { en: { sidebar: sidebarEn, settingsAdminDisplay: {} } },
        interpolation: { escapeValue: false },
        react: { useSuspense: false },
    });
});

const renderEditor = () => {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });
    return render(
        <QueryClientProvider client={queryClient}>
            <AdminDisplaySettings />
        </QueryClientProvider>
    );
};

/** Every text box in the editor, by the value the user would see in it. */
const textBoxValues = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('input'))
        .map((el) => el.value)
        .filter(Boolean);

describe('Display Settings · Sidebar Tabs', () => {
    it('shows the built-in name for a tab saved without a label', async () => {
        renderEditor();
        expect(await screen.findByDisplayValue(sidebarEn.manageContacts)).toBeInTheDocument();
    });

    it('shows built-in names for sub-tabs saved without labels', async () => {
        renderEditor();
        await screen.findByDisplayValue(sidebarEn.manageContacts);
        expect(screen.getByDisplayValue(sidebarEn.allContacts)).toBeInTheDocument();
    });

    it('leaves no name box blank while its route is filled in', async () => {
        const { container } = renderEditor();
        await screen.findByDisplayValue(sidebarEn.manageContacts);

        const values = textBoxValues(container);
        // The saved routes are all present...
        expect(values).toContain('/manage-contacts');
        expect(values).toContain('/user-tags/institute');
        // ...and so is a real name for each of them, which is what was missing.
        expect(values).toContain(sidebarEn.manageContacts);
        expect(values).toContain(sidebarEn.userTags);
    });
});
