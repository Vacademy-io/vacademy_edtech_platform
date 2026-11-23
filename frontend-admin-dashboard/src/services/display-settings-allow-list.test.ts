import { describe, expect, it } from 'vitest';
import { mergeDisplayWithDefaults } from './display-settings';
import { ADMIN_DISPLAY_SETTINGS_KEY, type DisplaySettingsData } from '@/types/display-settings';

/** What the server writes for a new Telleo sign-up (TelleoDisplaySettings). */
const telleoBlob = (allowList: boolean): Partial<DisplaySettingsData> =>
    ({
        sidebar: [
            {
                id: 'leads',
                order: 0,
                visible: true,
                subTabs: [
                    {
                        id: 'lead-list-leads',
                        route: '/audience-manager/list',
                        order: 0,
                        visible: true,
                    },
                ],
            },
            {
                id: 'calling',
                order: 1,
                visible: true,
                subTabs: [
                    {
                        id: 'calling-dashboard',
                        route: '/calling/dashboard',
                        order: 0,
                        visible: true,
                    },
                    {
                        id: 'calling-call-log',
                        route: '/audience-manager/call-log',
                        order: 1,
                        visible: true,
                    },
                    {
                        id: 'calling-ai-agents',
                        route: '/calling/ai-agents',
                        order: 2,
                        visible: true,
                    },
                ],
            },
        ],
        postLoginRedirectRoute: '/calling/dashboard',
        ui: { showSupportButton: true, showAiCredits: true, sidebarAllowList: allowList },
    }) as Partial<DisplaySettingsData>;

const visibleSubs = (merged: DisplaySettingsData, tabId: string) =>
    (merged.sidebar.find((t) => t.id === tabId)?.subTabs ?? [])
        .filter((s) => s.visible)
        .map((s) => s.id);

describe('mergeDisplayWithDefaults allow-list mode', () => {
    it('shows only what the blob lists', () => {
        const merged = mergeDisplayWithDefaults(telleoBlob(true), ADMIN_DISPLAY_SETTINGS_KEY);
        expect(merged.ui?.sidebarAllowList).toBe(true);
        expect(
            merged.sidebar
                .filter((t) => t.visible)
                .map((t) => t.id)
                .sort()
        ).toEqual(['calling', 'leads']);
        expect(visibleSubs(merged, 'leads')).toEqual(['lead-list-leads']);
        expect(visibleSubs(merged, 'calling')).toEqual([
            'calling-dashboard',
            'calling-call-log',
            'calling-ai-agents',
        ]);
    });

    it('is off unless the blob turns it on: unlisted tabs come from the defaults as before', () => {
        const merged = mergeDisplayWithDefaults(telleoBlob(false), ADMIN_DISPLAY_SETTINGS_KEY);
        expect(merged.ui?.sidebarAllowList).toBe(false);
        expect(merged.sidebar.filter((t) => t.visible).length).toBeGreaterThan(2);
        expect(visibleSubs(merged, 'leads').length).toBeGreaterThan(1);
    });

    it('is never switched on by the defaults', () => {
        expect(
            mergeDisplayWithDefaults(null, ADMIN_DISPLAY_SETTINGS_KEY).ui?.sidebarAllowList
        ).toBe(false);
    });
});
