import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
    // Node's unconfigured Web Storage global shadows happy-dom's here.
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
        value: {
            getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
            setItem: (k: string, v: string) => void store.set(k, String(v)),
            removeItem: (k: string) => void store.delete(k),
            clear: () => store.clear(),
        },
        configurable: true,
        writable: true,
    });
});

import { getSidebarItemsData } from '@/components/common/layout-container/sidebar/utils';
import { resolveCan } from '@/services/capabilities';
import {
    createEntitlement,
    FULL_ENTITLEMENT,
    isAlwaysAllowedPath,
    normalizeCatalog,
    pathCovers,
    toAppPath,
} from './entitlement';
import { canAllExcept, canForModules, CRM_ONLY_MODULES, loadRealCatalog } from './test-support';
import { COMMERCE_NAV, isCommerceRoleName } from '@/lib/commerce/commerce-access';

const catalog = loadRealCatalog();
const staticItems = getSidebarItemsData();

const allIds = (pick: (g: (typeof catalog.modules)[0]['features'][0]['governs']) => string[]) =>
    Array.from(new Set(catalog.modules.flatMap((m) => m.features.flatMap((f) => pick(f.governs)))));

describe('catalogue', () => {
    it('normalizes the real catalogue (15 modules, 60 features)', () => {
        expect(catalog.modules).toHaveLength(15);
        expect(catalog.modules.flatMap((m) => m.features)).toHaveLength(60);
    });

    it('rejects malformed bodies (fail open = no catalogue)', () => {
        expect(normalizeCatalog(null)).toBeNull();
        expect(normalizeCatalog('<html>')).toBeNull();
        expect(normalizeCatalog({ modules: {} })).toBeNull();
        expect(normalizeCatalog({ modules: [{ key: 'x' }] })).toBeNull();
        expect(normalizeCatalog({ modules: [{ key: 'x', features: [{}] }] })).toBeNull();
    });

    it('every catalogue nav id names a real sidebar tab / sub-tab', () => {
        const known = new Set<string>();
        staticItems.forEach((i) => {
            known.add(i.id);
            i.subItems?.forEach((s) => known.add(`${i.id}/${s.subItemId}`));
        });
        expect(allIds((g) => g.nav).filter((id) => !known.has(id))).toEqual([]);
    });
});

/**
 * Sidebar entries deliberately outside the catalogue (always available). A new
 * sidebar tab must either be governed in catalog.json or be listed here (§4).
 *
 * The ten commerce tabs are listed because their gate is not the catalogue: it
 * is the fail-closed commerce reader, in every mode (lib/commerce/
 * commerce-access.ts, tested in commerce-access.test.ts), and two of them (Home,
 * Settings) open on ANY commerce feature, which `governs.nav` cannot express
 * (several features there mean ALL). The catalogue entry still ships with empty
 * `governs.nav`; when the backend fills it, drop the governed ids from here.
 */
const UNGOVERNED_NAV_IDS: string[] = COMMERCE_NAV.map((rule) => rule.id);

describe('catalogue coverage (spec §4)', () => {
    it('every built-in sidebar tab is governed (tab-level or every sub-tab) or listed as ungoverned', () => {
        const governed = new Set(allIds((g) => g.nav));
        const uncovered = staticItems
            .filter(
                (i) =>
                    !governed.has(i.id) &&
                    !(
                        i.subItems?.length &&
                        i.subItems.every((s) => governed.has(`${i.id}/${s.subItemId}`))
                    )
            )
            .map((i) => i.id)
            .filter((id) => !UNGOVERNED_NAV_IDS.includes(id));
        expect(uncovered).toEqual([]);
    });
});

describe('paths', () => {
    it.each([
        ['/a/b?x=1', '/a/b'],
        ['/a/b/', '/a/b'],
        ['/a#h', '/a'],
        ['/', '/'],
        ['https://x.y/a', null],
        ['', null],
        [undefined, null],
    ])('toAppPath(%s) = %s', (input, out) => {
        expect(toAppPath(input)).toBe(out);
    });

    it('prefix match is segment-aware', () => {
        expect(pathCovers('/chat', '/chat')).toBe(true);
        expect(pathCovers('/chat', '/chat/x')).toBe(true);
        expect(pathCovers('/chat', '/chatbot')).toBe(false);
    });

    it.each([
        '/dashboard',
        '/settings',
        '/settings/x',
        '/login',
        '/locked-feature',
        '/',
        '/signup',
    ])('%s is always allowed', (p) => expect(isAlwaysAllowedPath(p)).toBe(true));
    it('feature pages are not always allowed', () => {
        expect(isAlwaysAllowedPath('/study-library/courses')).toBe(false);
        expect(isAlwaysAllowedPath('/dashboards')).toBe(false);
    });
});

describe('LEGACY regression — nothing is ever gated', () => {
    const navIds = staticItems.flatMap((i) => [
        [i.id, undefined] as const,
        ...(i.subItems || []).map((s) => [i.id, s.subItemId] as const),
    ]);

    it('FULL_ENTITLEMENT entitles every catalogue-governed id and path', () => {
        const e = FULL_ENTITLEMENT;
        expect(e.managed).toBe(false);
        navIds.forEach(([tab, sub]) => expect(e.isNavItemEntitled(tab, sub)).toBe(true));
        allIds((g) => g.widgets).forEach((id) => expect(e.isWidgetEntitled(id)).toBe(true));
        allIds((g) => g.quick_actions).forEach((id) =>
            expect(e.isQuickActionEntitled(id)).toBe(true)
        );
        allIds((g) => g.assistant_groups).forEach((id) =>
            expect(e.isAssistantGroupEntitled(id)).toBe(true)
        );
        allIds((g) => g.setup_steps).forEach((id) => expect(e.isSetupStepEntitled(id)).toBe(true));
        allIds((g) => g.routes).forEach((r) => expect(e.isPathEntitled(r)).toBe(true));
    });

    it('LEGACY /me can() is true even for features the server reports off', () => {
        const allOff = Object.fromEntries(
            catalog.modules.flatMap((m) => m.features.map((f) => [f.key, false]))
        );
        const snapshot = {
            instituteId: 'inst-1',
            status: 'loaded' as const,
            data: {
                mode: 'LEGACY' as const,
                catalog_version: 1,
                modules: {},
                features: allOff,
                opt_in_modules: ['commerce'],
                display_settings_version: null,
            },
        };
        const can = (k: string) => resolveCan(snapshot, 'inst-1', k);
        // Even if a catalogue were applied, LEGACY's can() keeps everything entitled.
        // Opt-in modules are the one exception (next test): their tabs and routes
        // are left out here so this stays true once the catalogue governs them.
        const optIn = (key: string) => key.startsWith('commerce') || key === 'learner-home';
        const e = createEntitlement({ catalog, can, staticItems });
        navIds
            .filter(([tab]) => !optIn(tab))
            .forEach(([tab, sub]) => expect(e.isNavItemEntitled(tab, sub)).toBe(true));
        allIds((g) => g.widgets).forEach((id) => expect(e.isWidgetEntitled(id)).toBe(true));
        allIds((g) => g.routes)
            .filter((r) => !r.startsWith('/commerce') && r !== '/learner-home')
            .forEach((r) => expect(e.isPathEntitled(r)).toBe(true));
    });

    it('LEGACY /me can() is false for an opt-in module the server reports off', () => {
        const commerceKeys = catalog.modules
            .filter((m) => m.key === 'commerce')
            .flatMap((m) => m.features.map((f) => f.key));
        expect(commerceKeys).toEqual([
            'commerce.catalogue',
            'commerce.orders',
            'commerce.stock',
            'commerce.pos',
            'commerce.tax_reports',
        ]);
        const snapshot = (features: Record<string, boolean>) => ({
            instituteId: 'inst-1',
            status: 'loaded' as const,
            data: {
                mode: 'LEGACY' as const,
                catalog_version: 1,
                modules: {},
                features,
                opt_in_modules: ['commerce'],
                display_settings_version: null,
            },
        });
        const off = snapshot(Object.fromEntries(commerceKeys.map((k) => [k, false])));
        commerceKeys.forEach((k) => expect(resolveCan(off, 'inst-1', k)).toBe(false));
        const on = snapshot(Object.fromEntries(commerceKeys.map((k) => [k, true])));
        commerceKeys.forEach((k) => expect(resolveCan(on, 'inst-1', k)).toBe(true));
    });

    it('the learner home builder is opt-in too, off until the server reports it on', () => {
        const keys = catalog.modules
            .filter((m) => m.key === 'learner_home')
            .flatMap((m) => m.features.map((f) => f.key));
        expect(keys).toEqual(['learner_home.builder']);
        const snapshot = (on: boolean) => ({
            instituteId: 'inst-1',
            status: 'loaded' as const,
            data: {
                mode: 'LEGACY' as const,
                catalog_version: 1,
                modules: {},
                features: { 'learner_home.builder': on },
                // An older backend that omits learner_home here still reads as opt-in.
                opt_in_modules: ['commerce'],
                display_settings_version: null,
            },
        });
        expect(resolveCan(snapshot(false), 'inst-1', 'learner_home.builder')).toBe(false);
        expect(resolveCan(snapshot(true), 'inst-1', 'learner_home.builder')).toBe(true);
        // Not loaded = off (fail closed), unlike ordinary features.
        expect(
            resolveCan(
                { instituteId: null, status: 'idle', data: null },
                'inst-1',
                'learner_home.builder'
            )
        ).toBe(false);
    });

    it('the four commerce role names are the ones the backend seeds', () => {
        [
            'COMMERCE_STORE_MANAGER',
            'COMMERCE_WAREHOUSE_STAFF',
            'COMMERCE_POS_CASHIER',
            'COMMERCE_ACCOUNTANT',
        ].forEach((name) => expect(isCommerceRoleName(name)).toBe(true));
        expect(isCommerceRoleName('ADMIN')).toBe(false);
    });
});

describe('MANAGED — CRM-only plan', () => {
    const e = createEntitlement({
        catalog,
        can: canForModules(catalog, CRM_ONLY_MODULES),
        staticItems,
    });

    it.each([
        ['dashboard', undefined, true],
        ['leads', undefined, true],
        ['courses', undefined, false],
        ['assessments-tests', undefined, false],
        ['ai-tools-tab', undefined, false],
        ['erp-payroll', undefined, false],
        // core tab, mixed sub-tabs
        ['manage-institute', undefined, true],
        ['manage-institute', 'teams', true],
        ['manage-institute', 'batches', false],
        ['manage-institute', 'sessions', false],
        ['manage-institute', 'manage-packages', true],
        ['manage-contacts', 'linked-contacts', false],
        ['manage-contacts', 'all-contacts', true],
        // a tab governed directly hides with all its sub-tabs
        ['live-sessions', 'live-session-dashboard', false],
        ['course-creation', 'create-course-ai', false],
    ])('nav %s/%s → %s', (tab, sub, expected) => {
        expect(e.isNavItemEntitled(tab, sub)).toBe(expected);
    });

    it('widgets, quick actions, assistant groups and setup steps follow the plan', () => {
        expect(e.isWidgetEntitled('learningCenter')).toBe(false);
        expect(e.isWidgetEntitled('liveClasses')).toBe(false);
        expect(e.isWidgetEntitled('financeSummary')).toBe(true);
        expect(e.isWidgetEntitled('pendingActions')).toBe(true); // ungoverned
        expect(e.isQuickActionEntitled('add-student')).toBe(false);
        expect(e.isQuickActionEntitled('new-batch')).toBe(false);
        expect(e.isQuickActionEntitled('reports')).toBe(false);
        expect(e.isQuickActionEntitled('announce')).toBe(true);
        expect(e.isQuickActionEntitled('collect-payment')).toBe(true);
        expect(e.isAssistantGroupEntitled('batch_data')).toBe(false);
        expect(e.isAssistantGroupEntitled('schedule')).toBe(false);
        expect(e.isAssistantGroupEntitled('payments')).toBe(true);
        expect(e.isAssistantGroupEntitled('institute_overview')).toBe(true); // ungoverned
        ['course', 'level', 'batch', 'learner'].forEach((s) =>
            expect(e.isSetupStepEntitled(s)).toBe(false)
        );
    });

    it('featuresForPath uses the most specific claims', () => {
        expect(e.featuresForPath('/study-library/courses/course-details')).toEqual(['lms.courses']);
        expect(e.featuresForPath('/erp/my-hr/leave')).toEqual(['erp.my_hr']);
        expect(e.featuresForPath('/somewhere-unknown')).toEqual([]);
        expect(e.featuresForPath('/settings')).toEqual([]);
    });

    it.each([
        ['/study-library/courses', false],
        ['/study-library/courses/course-details', false],
        ['/manage-institute/batches', false],
        ['/manage-institute/teams', true],
        ['/manage-students/students-list', false],
        ['/manage-contacts', true],
        ['/audience-manager/list', true],
        ['/erp/payroll', false],
        ['/knowledge-base', false],
        ['/dashboard', true],
        ['/settings', true],
        ['/not-in-the-catalogue', true],
    ])('path %s entitled → %s', (p, expected) => {
        expect(e.isPathEntitled(p)).toBe(expected);
    });
});

describe('MANAGED — multi-feature governance and specificity', () => {
    it('a sub-tab governed by two features needs both (leads/call-log)', () => {
        const e = createEntitlement({ catalog, can: canAllExcept(['crm.calling']), staticItems });
        expect(e.isNavItemEntitled('leads')).toBe(true);
        expect(e.isNavItemEntitled('leads', 'call-log')).toBe(false);
        expect(e.isNavItemEntitled('leads', 'follow-ups')).toBe(true);
        expect(e.isNavItemEntitled('calling')).toBe(false);
        expect(e.isPathEntitled('/audience-manager/call-log')).toBe(false);
        expect(e.isPathEntitled('/audience-manager/list')).toBe(true);
    });

    it('a deeper route of a switched-off feature is blocked though its parent prefix is on', () => {
        const e = createEntitlement({ catalog, can: canAllExcept(['website.blog']), staticItems });
        expect(e.isPathEntitled('/manage-pages')).toBe(true);
        expect(e.isPathEntitled('/manage-pages/blog')).toBe(false);
        expect(e.isPathEntitled('/manage-pages/blog/post-1')).toBe(false);
        expect(e.isPathEntitled('/manage-pages/product-pages')).toBe(true);
    });

    it('a path stays open while any equally specific claim is entitled', () => {
        // /study-library/ai-copilot: ai.course_creator (catalogue + AI tab) and
        // course-creation/create-course-ai (lms.courses + ai.course_creator).
        const e = createEntitlement({ catalog, can: canAllExcept(['lms.courses']), staticItems });
        expect(e.isPathEntitled('/study-library/ai-copilot')).toBe(true);
        expect(e.isNavItemEntitled('course-creation', 'create-course-ai')).toBe(false);
        expect(e.isNavItemEntitled('ai-copilot-tab')).toBe(true);
    });

    it('a tab whose every built-in sub-tab is off is not entitled', () => {
        const off = catalog.modules
            .filter((m) => ['automation', 'website'].includes(m.key))
            .flatMap((m) => m.features.map((f) => f.key));
        const e = createEntitlement({ catalog, can: canAllExcept(off), staticItems });
        expect(e.isNavItemEntitled('automations')).toBe(false);
        // one sub-tab back on → the tab stays
        const e2 = createEntitlement({
            catalog,
            can: canAllExcept(off.filter((k) => k !== 'website.blog')),
            staticItems,
        });
        expect(e2.isNavItemEntitled('automations')).toBe(true);
        expect(e2.isNavItemEntitled('automations', 'blog')).toBe(true);
        expect(e2.isNavItemEntitled('automations', 'workflow-list')).toBe(false);
    });

    it('everything on → everything entitled', () => {
        const e = createEntitlement({ catalog, can: () => true, staticItems });
        staticItems.forEach((i) => {
            expect(e.isNavItemEntitled(i.id)).toBe(true);
            i.subItems?.forEach((s) => expect(e.isNavItemEntitled(i.id, s.subItemId)).toBe(true));
        });
    });
});
