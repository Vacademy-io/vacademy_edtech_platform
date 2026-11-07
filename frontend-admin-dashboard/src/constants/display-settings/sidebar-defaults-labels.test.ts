/**
 * Built-in sidebar tabs must be seeded WITHOUT a `label`.
 *
 * mySidebar treats a saved label as a deliberate user customization unless it
 * still matches the built-in name, and then renders it verbatim forever
 * (`title: isSeededTitle ? item.title : cfg.label`). A default that seeds the
 * name i18n resolves to today would therefore freeze the nav: an institute that
 * saves its display settings while the UI is in French, or before renaming
 * "Course" to "Program", would keep the stale wording afterwards.
 *
 * Display Settings fills its Tab Name / Label boxes by falling back to the live
 * sidebar entry instead — display only, nothing written to the saved config.
 * See sidebar-tab-names.test.tsx for that half.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import i18next from 'i18next';
import sidebarEn from '../../../public/locales/en/sidebar.json';
import { getDefaultAdminDisplaySettings } from './admin-defaults';
import { getDefaultTeacherDisplaySettings } from './teacher-defaults';

beforeAll(async () => {
    await i18next.init({
        lng: 'en',
        fallbackLng: 'en',
        ns: ['sidebar'],
        resources: { en: { sidebar: sidebarEn } },
        interpolation: { escapeValue: false },
    });
});

const labelled = (sidebar: ReturnType<typeof getDefaultAdminDisplaySettings>['sidebar']) => [
    ...sidebar.filter((tab) => tab.label !== undefined).map((tab) => tab.id),
    ...sidebar.flatMap((tab) =>
        (tab.subTabs || [])
            .filter((sub) => sub.label !== undefined)
            .map((sub) => `${tab.id}/${sub.id}`)
    ),
];

describe('default sidebar config', () => {
    it('seeds no label on any built-in admin tab or sub-tab', () => {
        const { sidebar } = getDefaultAdminDisplaySettings();
        expect(sidebar.length).toBeGreaterThan(0);
        expect(sidebar.some((tab) => (tab.subTabs || []).length > 0)).toBe(true);
        expect(labelled(sidebar)).toEqual([]);
    });

    it('seeds no label on any built-in teacher tab or sub-tab', () => {
        const { sidebar } = getDefaultTeacherDisplaySettings();
        expect(sidebar.length).toBeGreaterThan(0);
        expect(labelled(sidebar)).toEqual([]);
    });

    it('still seeds the routes and ordering the nav needs', () => {
        const { sidebar } = getDefaultAdminDisplaySettings();
        const contacts = sidebar.find((tab) => tab.id === 'manage-contacts');
        expect(contacts?.order).toBeGreaterThan(0);
        expect(contacts?.subTabs?.map((sub) => sub.route)).toContain('/manage-contacts');
    });
});
