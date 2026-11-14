import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn();
vi.mock('@/lib/auth/axiosInstance', () => ({ default: { get: (...a: unknown[]) => get(...a) } }));
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));
vi.mock('@/constants/urls', () => ({ BASE_URL: 'http://x' }));

import { fetchStudentDisplaySettingsForEdit } from './student-display-settings';

/**
 * The settings editor saves the whole blob back. Two things must hold for that
 * to be safe: custom Courses-page tabs survive the merge with defaults (it
 * rebuilds `allCourses` field by field), and a failed read never hands the
 * editor defaults it could save over the institute's real settings.
 */
describe('fetchStudentDisplaySettingsForEdit', () => {
    beforeEach(() => {
        get.mockReset();
    });

    it('keeps custom course tabs and the built-in tabs through the merge', async () => {
        get.mockResolvedValue({
            data: {
                data: {
                    allCourses: {
                        tabs: [{ id: 'AllCourses', order: 1, visible: true }],
                        customTabs: [
                            {
                                id: 'custom-1',
                                label: 'Free',
                                tags: ['free'],
                                order: 2,
                                visible: true,
                            },
                            { label: 'no id', tags: ['x'], order: 3, visible: true },
                        ],
                        defaultTab: 'AllCourses',
                    },
                    liveClasses: { showUnassignedPublicSessions: true },
                },
            },
        });

        const s = await fetchStudentDisplaySettingsForEdit();

        expect(s.allCourses.customTabs).toEqual([
            {
                id: 'custom-1',
                label: 'Free',
                // saved before tab types existed → a tag tab
                type: 'TAG',
                tags: ['free'],
                courseIds: [],
                productPages: [],
                order: 2,
                visible: true,
            },
        ]);
        expect(s.allCourses.tabs.map((t) => t.id).sort()).toEqual([
            'AllCourses',
            'Completed',
            'InProgress',
        ]);
        expect(s.allCourses.defaultTab).toBe('AllCourses');
    });

    it('keeps typed tabs and drops junk inside them', async () => {
        get.mockResolvedValue({
            data: {
                data: {
                    allCourses: {
                        tabs: [],
                        customTabs: [
                            {
                                id: 'c1',
                                label: 'Live',
                                type: 'LIVE_SESSIONS',
                                order: 4,
                                visible: true,
                            },
                            {
                                id: 'c2',
                                label: 'Picked',
                                type: 'COURSES',
                                courseIds: ['p1', '', 7],
                                order: 5,
                            },
                            {
                                id: 'c3',
                                label: 'Pages',
                                type: 'PRODUCT_PAGES',
                                productPages: [
                                    { code: 'bundle', name: 'Bundle' },
                                    { name: 'no code' },
                                    { code: 'x' },
                                ],
                                order: 6,
                            },
                            { id: 'c4', label: 'Weird', type: 'NOPE', tags: ['a'], order: 7 },
                        ],
                        defaultTab: 'InProgress',
                    },
                },
            },
        });
        const tabs = (await fetchStudentDisplaySettingsForEdit()).allCourses.customTabs ?? [];
        expect(tabs.map((t) => t.type)).toEqual([
            'LIVE_SESSIONS',
            'COURSES',
            'PRODUCT_PAGES',
            'TAG',
        ]);
        expect(tabs[1]!.courseIds).toEqual(['p1']);
        expect(tabs[2]!.productPages).toEqual([
            { code: 'bundle', name: 'Bundle' },
            { code: 'x', name: 'x' },
        ]);
        expect(tabs[0]!.visible).toBe(true);
    });

    it('gives an empty list for blobs saved before custom tabs existed', async () => {
        get.mockResolvedValue({
            data: { data: { allCourses: { tabs: [], defaultTab: 'InProgress' } } },
        });
        const s = await fetchStudentDisplaySettingsForEdit();
        expect(s.allCourses.customTabs).toEqual([]);
    });

    it('throws instead of returning defaults when the read fails', async () => {
        get.mockRejectedValue(new Error('network'));
        await expect(fetchStudentDisplaySettingsForEdit()).rejects.toThrow('network');
    });
});
