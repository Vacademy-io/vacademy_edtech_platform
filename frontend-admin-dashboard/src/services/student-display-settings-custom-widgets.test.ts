import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn();
const post = vi.fn();
vi.mock('@/lib/auth/axiosInstance', () => ({
    default: {
        get: (...a: unknown[]) => get(...a),
        post: (...a: unknown[]) => post(...a),
    },
}));
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));
vi.mock('@/constants/urls', () => ({ BASE_URL: 'http://x' }));

import {
    fetchStudentDisplaySettingsForEdit,
    isCustomWidget,
    newCustomWidgetId,
    saveStudentDisplaySettings,
} from './student-display-settings';
import { DEFAULT_STUDENT_DISPLAY_SETTINGS } from '@/constants/display-settings/student-defaults';
import type { StudentDashboardWidgetConfig } from '@/types/student-display-settings';

/**
 * Custom dashboard widgets used to share the id "custom", and the merge keyed by
 * id, so only the last one survived a load, and the editor's next Save wrote
 * that single survivor back over the others.
 */
const legacyThree = [
    {
        id: 'custom',
        title: 'One',
        subTitle: 'a',
        link: '/one',
        order: 20,
        visible: true,
        isCustom: true,
    },
    {
        id: 'custom',
        title: 'Two',
        subTitle: 'b',
        link: 'https://example.com',
        order: 21,
        visible: false,
        isCustom: true,
    },
    { id: 'custom', title: 'Three', link: '/three?x=1', order: 22, visible: true, isCustom: true },
];

const serve = (widgets: unknown[]) =>
    get.mockResolvedValue({ data: { data: { dashboard: { widgets } } } });

const customsOf = (widgets: StudentDashboardWidgetConfig[]) =>
    widgets.filter((w) => isCustomWidget(w));
const builtInsOf = (widgets: StudentDashboardWidgetConfig[]) =>
    widgets.filter((w) => !isCustomWidget(w));

describe('custom dashboard widgets in the student display settings editor', () => {
    beforeEach(() => {
        get.mockReset();
        post.mockReset();
        post.mockResolvedValue({ data: {} });
    });

    it('keeps all three legacy "custom" entries on load, each with a stable unique id', async () => {
        serve(legacyThree);
        const s = await fetchStudentDisplaySettingsForEdit();
        const customs = customsOf(s.dashboard.widgets);
        expect(customs).toEqual([
            {
                id: 'custom',
                title: 'One',
                subTitle: 'a',
                link: '/one',
                order: 20,
                visible: true,
                isCustom: true,
            },
            {
                id: 'custom:legacy-1',
                title: 'Two',
                subTitle: 'b',
                link: 'https://example.com',
                order: 21,
                visible: false,
                isCustom: true,
            },
            {
                id: 'custom:legacy-2',
                title: 'Three',
                subTitle: undefined,
                link: '/three?x=1',
                order: 22,
                visible: true,
                isCustom: true,
            },
        ]);

        // A second load of the same stored list gives the same ids.
        serve(legacyThree);
        const again = await fetchStudentDisplaySettingsForEdit();
        expect(customsOf(again.dashboard.widgets).map((w) => w.id)).toEqual(
            customs.map((w) => w.id)
        );
    });

    it('writes every custom widget back on save, and a reload of that keeps them', async () => {
        serve(legacyThree);
        const s = await fetchStudentDisplaySettingsForEdit();
        await saveStudentDisplaySettings(s);

        expect(post).toHaveBeenCalledTimes(1);
        const body = post.mock.calls[0]![1] as {
            setting_data: { dashboard: { widgets: StudentDashboardWidgetConfig[] } };
        };
        const saved = body.setting_data.dashboard.widgets;
        expect(customsOf(saved).map((w) => [w.id, w.title])).toEqual([
            ['custom', 'One'],
            ['custom:legacy-1', 'Two'],
            ['custom:legacy-2', 'Three'],
        ]);

        // The saved list round-trips unchanged.
        serve(JSON.parse(JSON.stringify(saved)));
        const reloaded = await fetchStudentDisplaySettingsForEdit();
        expect(customsOf(reloaded.dashboard.widgets)).toEqual(customsOf(s.dashboard.widgets));
    });

    it('keeps distinct new-style ids and re-ids duplicates and legacy entries without clashing', async () => {
        serve([
            { id: 'custom:abc', title: 'A', order: 30, visible: true, isCustom: true },
            { id: 'custom', title: 'Legacy', order: 31, visible: true, isCustom: true },
            { id: 'custom:abc', title: 'Duplicate', order: 32, visible: true, isCustom: true },
            {
                id: 'custom:legacy-1',
                title: 'Already saved',
                order: 33,
                visible: true,
                isCustom: true,
            },
            { id: 'custom:xyz', title: 'Flag missing', order: 34, visible: true },
        ]);
        const s = await fetchStudentDisplaySettingsForEdit();
        const customs = customsOf(s.dashboard.widgets);
        expect(customs.map((w) => [w.id, w.title])).toEqual([
            ['custom:abc', 'A'],
            ['custom', 'Legacy'],
            ['custom:legacy-2', 'Duplicate'],
            ['custom:legacy-1', 'Already saved'],
            ['custom:xyz', 'Flag missing'],
        ]);
        expect(new Set(customs.map((w) => w.id)).size).toBe(customs.length);
        expect(customs.every((w) => w.isCustom === true)).toBe(true);
    });

    it('leaves the built-in widget merge unchanged', async () => {
        const builtInOverrides = [
            { id: 'myBooks', visible: false },
            { id: 'continueLearning', order: 99 },
            { id: 'referAFriend', order: 5, visible: true },
        ];
        serve(builtInOverrides);
        const without = await fetchStudentDisplaySettingsForEdit();
        serve([...legacyThree, ...builtInOverrides]);
        const withCustoms = await fetchStudentDisplaySettingsForEdit();

        expect(builtInsOf(withCustoms.dashboard.widgets)).toEqual(without.dashboard.widgets);
        const byId = new Map<string, StudentDashboardWidgetConfig>(
            without.dashboard.widgets.map((w) => [w.id, w])
        );
        expect(byId.get('myBooks')?.visible).toBe(false);
        expect(byId.get('continueLearning')?.order).toBe(99);
        // Stored ids the defaults do not know are still kept as before.
        expect(byId.get('referAFriend')).toBeDefined();
        expect(byId.get('exploreBooks')?.visible).toBe(false);
        // Every default is present, with its default values where not overridden.
        for (const d of DEFAULT_STUDENT_DISPLAY_SETTINGS.dashboard.widgets) {
            expect(byId.has(d.id)).toBe(true);
            // exploreBooks follows a saved myBooks flag (seedExploreCtaVisibility).
            if (['myBooks', 'continueLearning', 'exploreBooks'].includes(d.id)) continue;
            expect(byId.get(d.id)?.order).toBe(d.order);
            expect(byId.get(d.id)?.visible).toBe(d.visible);
        }
    });
});

describe('newCustomWidgetId', () => {
    it('gives a custom-style id not already in use', () => {
        const seen = new Set<string>(['custom', 'custom']);
        for (let i = 0; i < 200; i++) {
            const id = newCustomWidgetId(seen);
            expect(id).toMatch(/^custom:[a-z0-9]+$/);
            expect(seen.has(id)).toBe(false);
            expect(isCustomWidget({ id })).toBe(true);
            seen.add(id);
        }
    });
});

describe('isCustomWidget', () => {
    it('treats the isCustom flag or a custom-style id as custom', () => {
        expect(isCustomWidget({ id: 'custom' })).toBe(true);
        expect(isCustomWidget({ id: 'custom:abc' })).toBe(true);
        expect(isCustomWidget({ id: 'myBooks', isCustom: true })).toBe(true);
        expect(isCustomWidget({ id: 'myBooks', isCustom: false })).toBe(false);
        expect(isCustomWidget(undefined)).toBe(false);
    });
});

describe('older learner app builds', () => {
    it('keep seeing one card: the first custom widget keeps the plain "custom" id', () => {
        expect(newCustomWidgetId([])).toBe('custom');
        expect(newCustomWidgetId(['custom'])).toMatch(/^custom:[a-z0-9]+$/);
    });
});
