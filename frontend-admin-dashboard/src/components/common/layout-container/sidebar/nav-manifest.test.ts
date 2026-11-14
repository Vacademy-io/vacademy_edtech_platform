/**
 * Nav manifest — the admin app's navigation, exported for the backend and the
 * super-admin portal (INSTITUTE_MODULES_AND_CONFIG_SPEC.md §12.1, §12.4).
 *
 * Built from the real code: getSidebarItemsData() (ids, routes, categories,
 * adminOnly), the admin/teacher Display Settings defaults (merged exactly the way
 * the app merges them, incl. sidebarCategories) and the role rules of
 * filterSidebarByRole — the rules are PROBED by running the real function, not
 * copied, so a change in helper.ts shows up here as drift.
 * Labels are English, resolved through public/locales/en and the system naming
 * terms (no institute renames).
 *
 * The manifest is committed at
 *   admin_core_service/src/main/resources/capabilities/nav-manifest.json
 * and this test fails when it no longer matches the code. To regenerate, from
 * frontend-admin-dashboard/:
 *
 *   UPDATE_NAV_MANIFEST=1 node_modules/.bin/vitest run src/components/common/layout-container/sidebar/nav-manifest.test.ts
 *
 * Fields beyond the §12.1 shape (rules that do not fit it):
 *  - categories[].order / is_default_landing — rail order and the landing category.
 *  - non_admin_opt_in_tab_ids — tabs a non-admin gets ONLY when the role's
 *    settings say `visible: true` (hidden on a cold cache / no settings).
 *  - admin_only_sub_tabs_never_opt_in_tab_ids — tabs whose `admin_only` sub-tabs
 *    a non-admin never gets, even with `visible: true` (engagement engines).
 *  - sub_org_module — the Sub-Organizations grant: for a non-admin the sub-tab
 *    shows only when the role's `subOrganizations.moduleEnabled` is true, and that
 *    grant alone keeps the tab carrying just that sub-tab.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import i18next from 'i18next';
import sidebarEn from '../../../../../public/locales/en/sidebar.json';
import categoryRailEn from '../../../../../public/locales/en/categoryRail.json';
import { getSidebarItemsData, withSystemDefaults } from './utils';
import { filterSidebarByRole } from './helper';
import { mergeDisplayWithDefaults } from '@/services/display-settings';
import {
    ADMIN_DISPLAY_SETTINGS_KEY,
    TEACHER_DISPLAY_SETTINGS_KEY,
    type DisplaySettingsData,
} from '@/types/display-settings';
import {
    SUB_ORG_MODULE_SUB_ITEM_ID,
    SUB_ORG_MODULE_TAB_ID,
} from '@/lib/display-settings/sub-org-module';
import type { SidebarItemsType } from '@/types/layout-container/layout-container-types';

// Node's own (unconfigured) Web Storage global shadows happy-dom's here, so
// `localStorage` is undefined. Install an in-memory one before any module reads it.
const state = vi.hoisted(() => {
    const store = new Map<string, string>();
    const memoryStorage = {
        getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
        setItem: (k: string, v: string) => void store.set(k, String(v)),
        removeItem: (k: string) => void store.delete(k),
        clear: () => store.clear(),
        key: (i: number) => Array.from(store.keys())[i] ?? null,
        get length() {
            return store.size;
        },
    };
    Object.defineProperty(globalThis, 'localStorage', {
        value: memoryStorage,
        configurable: true,
        writable: true,
    });
    return { roles: [] as string[], subOrgGranted: false };
});

vi.mock('@/lib/auth/instituteUtils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/auth/instituteUtils')>()),
    getRolesForCurrentInstitute: () => state.roles,
}));
vi.mock('@/lib/display-settings/sub-org-module', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/display-settings/sub-org-module')>()),
    canAccessSubOrgModule: () => state.subOrgGranted,
}));

const MANIFEST_PATH = path.resolve(
    __dirname,
    '../../../../../../admin_core_service/src/main/resources/capabilities/nav-manifest.json'
);
const REGENERATE_CMD =
    'UPDATE_NAV_MANIFEST=1 node_modules/.bin/vitest run src/components/common/layout-container/sidebar/nav-manifest.test.ts';

beforeAll(async () => {
    await i18next.init({
        lng: 'en',
        fallbackLng: 'en',
        ns: ['sidebar', 'categoryRail'],
        resources: { en: { sidebar: sidebarEn, categoryRail: categoryRailEn } },
        interpolation: { escapeValue: false },
    });
});

type Probe = { roles: string[]; subOrgGranted: boolean; display: DisplaySettingsData | null };

function runFilter(items: SidebarItemsType[], probe: Probe): SidebarItemsType[] {
    state.roles = probe.roles;
    state.subOrgGranted = probe.subOrgGranted;
    try {
        return filterSidebarByRole(items, probe.display);
    } finally {
        state.roles = [];
        state.subOrgGranted = false;
    }
}

/** A role config with every tab (and optionally every sub-tab) explicitly visible. */
function optInEverything(items: SidebarItemsType[], subTabs: boolean): DisplaySettingsData {
    return {
        sidebar: items.map((item, i) => ({
            id: item.id,
            order: i + 1,
            visible: true,
            subTabs: (item.subItems || []).map((s, j) => ({
                id: s.subItemId,
                route: s.subItemLink || '#',
                order: j + 1,
                visible: subTabs,
            })),
        })),
    } as DisplaySettingsData;
}

const subIds = (items: SidebarItemsType[], tabId: string) =>
    (items.find((i) => i.id === tabId)?.subItems || []).map((s) => s.subItemId);

function deriveRoleRules(items: SidebarItemsType[]) {
    const allIds = items.map((i) => i.id);

    // Admins see everything, whatever their settings.
    const asAdmin = runFilter(items, { roles: ['ADMIN'], subOrgGranted: false, display: null });
    expect(asAdmin.map((i) => i.id)).toEqual(allIds);

    // Non-admin with EVERYTHING explicitly on + the sub-org grant: whatever is still
    // missing can never be opted in.
    const optedIn = runFilter(items, {
        roles: ['TEACHER'],
        subOrgGranted: true,
        display: optInEverything(items, true),
    });
    const optedInIds = new Set(optedIn.map((i) => i.id));
    const alwaysAdminOnly = allIds.filter((id) => !optedInIds.has(id));

    const neverOptInTabs: string[] = [];
    for (const item of items) {
        if (!optedInIds.has(item.id)) continue;
        const kept = new Set(subIds(optedIn, item.id));
        const missing = (item.subItems || []).filter((s) => !kept.has(s.subItemId));
        if (missing.length === 0) continue;
        // Only adminOnly sub-tabs may be dropped here, and then all of a tab's.
        expect(missing.every((s) => s.adminOnly)).toBe(true);
        expect(missing.map((s) => s.subItemId)).toEqual(
            (item.subItems || []).filter((s) => s.adminOnly).map((s) => s.subItemId)
        );
        neverOptInTabs.push(item.id);
    }

    // Tabs on, adminOnly sub-tabs NOT explicitly on → every adminOnly sub-tab hidden.
    const tabsOnly = runFilter(items, {
        roles: ['TEACHER'],
        subOrgGranted: true,
        display: optInEverything(items, false),
    });
    for (const item of tabsOnly) {
        const adminOnly = (items.find((i) => i.id === item.id)?.subItems || [])
            .filter((s) => s.adminOnly)
            .map((s) => s.subItemId);
        expect(subIds(tabsOnly, item.id).filter((id) => adminOnly.includes(id))).toEqual([]);
    }

    // No settings at all (cold cache): tabs dropped beyond the always-admin-only
    // ones need an explicit `visible: true`.
    const cold = runFilter(items, { roles: ['TEACHER'], subOrgGranted: false, display: null });
    const coldIds = new Set(cold.map((i) => i.id));
    const nonAdminOptIn = allIds.filter((id) => !coldIds.has(id) && !alwaysAdminOnly.includes(id));

    // Sub-org module grant: alone, it keeps the tab with only its sub-tab…
    const grantOnly = runFilter(items, { roles: ['TEACHER'], subOrgGranted: true, display: null });
    expect(subIds(grantOnly, SUB_ORG_MODULE_TAB_ID)).toEqual([SUB_ORG_MODULE_SUB_ITEM_ID]);
    // …and without it the sub-tab is gone even when explicitly visible.
    const noGrant = runFilter(items, {
        roles: ['TEACHER'],
        subOrgGranted: false,
        display: optInEverything(items, true),
    });
    expect(subIds(noGrant, SUB_ORG_MODULE_TAB_ID)).not.toContain(SUB_ORG_MODULE_SUB_ITEM_ID);
    expect(subIds(optedIn, SUB_ORG_MODULE_TAB_ID)).toContain(SUB_ORG_MODULE_SUB_ITEM_ID);

    return { alwaysAdminOnly, nonAdminOptIn, neverOptInTabs };
}

function buildNavManifest() {
    // English labels with system naming terms; ids/routes are label-independent.
    const items = withSystemDefaults(() => getSidebarItemsData());
    const admin = mergeDisplayWithDefaults(null, ADMIN_DISPLAY_SETTINGS_KEY);
    // Custom roles fall back to the teacher defaults, exactly as the app does.
    const teacher = mergeDisplayWithDefaults(null, TEACHER_DISPLAY_SETTINGS_KEY);
    const rules = deriveRoleRules(items);

    const adminCats = admin.sidebarCategories || [];
    const teacherCats = teacher.sidebarCategories || [];
    // §12.1 has one default_visible per category; that only holds while the roles agree.
    expect(
        teacherCats,
        'teacher and admin category defaults diverged — extend the manifest'
    ).toEqual(adminCats);

    const categoryLabels = categoryRailEn.categories as Record<string, string>;
    const categories = adminCats.map((c) => ({
        id: c.id,
        label: categoryLabels[c.id.toLowerCase()] ?? c.id,
        default_visible: c.visible !== false,
        order: c.order ?? 0,
        is_default_landing: c.default === true,
    }));

    const tabCfg = (ds: DisplaySettingsData, id: string) => ds.sidebar.find((t) => t.id === id);
    const subCfg = (ds: DisplaySettingsData, tabId: string, subId: string) =>
        tabCfg(ds, tabId)?.subTabs?.find((s) => s.id === subId);

    const tabs = items.map((item) => {
        const a = tabCfg(admin, item.id);
        const t = tabCfg(teacher, item.id);
        expect(a, `admin defaults are missing tab ${item.id}`).toBeDefined();
        return {
            id: item.id,
            label: item.title,
            category: item.category ?? null,
            route: item.to ?? null,
            order: a?.order ?? 0,
            default_visible: {
                ADMIN: a?.visible !== false,
                // Absent from the teacher defaults (Settings) = not seeded for the role.
                TEACHER: t ? t.visible !== false : false,
            },
            sub_tabs: (item.subItems || []).map((sub) => {
                const sa = subCfg(admin, item.id, sub.subItemId);
                const st = subCfg(teacher, item.id, sub.subItemId);
                return {
                    id: sub.subItemId,
                    label: sub.subItem ?? sub.subItemId,
                    route: sub.subItemLink ?? null,
                    order: sa?.order ?? 0,
                    admin_only: sub.adminOnly === true,
                    default_visible: {
                        ADMIN: sa ? sa.visible !== false : false,
                        TEACHER: st ? st.visible !== false : false,
                    },
                };
            }),
        };
    });

    return {
        generated_at: null,
        generated_by:
            'frontend-admin-dashboard/src/components/common/layout-container/sidebar/nav-manifest.test.ts',
        categories,
        always_admin_only_tab_ids: rules.alwaysAdminOnly,
        non_admin_opt_in_tab_ids: rules.nonAdminOptIn,
        admin_only_sub_tabs_never_opt_in_tab_ids: rules.neverOptInTabs,
        sub_org_module: {
            tab_id: SUB_ORG_MODULE_TAB_ID,
            sub_tab_id: SUB_ORG_MODULE_SUB_ITEM_ID,
            role_setting: 'subOrganizations.moduleEnabled',
        },
        tabs,
    };
}

describe('nav manifest', () => {
    it('labels every entry in English, never with a raw i18n key', () => {
        const manifest = buildNavManifest();
        const labels = [
            ...manifest.categories.map((c) => c.label),
            ...manifest.tabs.flatMap((t) => [t.label, ...t.sub_tabs.map((s) => s.label)]),
        ];
        expect(labels.filter((l) => !l || l.includes(':') || l.includes('{{'))).toEqual([]);
    });

    it('matches the committed nav-manifest.json', () => {
        const json = `${JSON.stringify(buildNavManifest(), null, 2)}\n`;
        if (process.env.UPDATE_NAV_MANIFEST === '1') {
            fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
            fs.writeFileSync(MANIFEST_PATH, json);
            return;
        }
        const committed = fs.existsSync(MANIFEST_PATH)
            ? fs.readFileSync(MANIFEST_PATH, 'utf8')
            : '';
        expect(
            committed,
            `nav-manifest.json is out of date with the sidebar code. Regenerate it from frontend-admin-dashboard/ with:\n  ${REGENERATE_CMD}`
        ).toBe(json);
    });
});
