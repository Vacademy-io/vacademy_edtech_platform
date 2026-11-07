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
import type { SidebarItemsType } from '@/types/layout-container/layout-container-types';
import type { RecentTabEntry } from '@/components/common/layout-container/sidebar/recent-tabs-store';
import { createEntitlement, FULL_ENTITLEMENT } from './entitlement';
import {
    categoriesWithItems,
    collectNavEntries,
    decideRouteAccess,
    filterRecentEntries,
    filterSearchableItems,
    filterSidebarByEntitlement,
    pickActiveCategory,
} from './nav-access';
import { canAllExcept, canForModules, CRM_ONLY_MODULES, loadRealCatalog } from './test-support';

const catalog = loadRealCatalog();
const staticItems = getSidebarItemsData();
const Icon = (() => null) as unknown as SidebarItemsType['icon'];

const crmOnly = createEntitlement({
    catalog,
    can: canForModules(catalog, CRM_ONLY_MODULES),
    staticItems,
});

const ids = (items: SidebarItemsType[]) => items.map((i) => i.id);
const subIds = (items: SidebarItemsType[], tabId: string) =>
    (items.find((i) => i.id === tabId)?.subItems || []).map((s) => s.subItemId);

describe('LEGACY regression — the sidebar list is unchanged', () => {
    it('FULL_ENTITLEMENT returns the very same array', () => {
        expect(filterSidebarByEntitlement(staticItems, FULL_ENTITLEMENT)).toBe(staticItems);
        const withCustom = [
            ...staticItems,
            { icon: Icon, id: 'custom-1', title: 'Mine', to: '/study-library/courses' },
        ];
        expect(filterSidebarByEntitlement(withCustom, FULL_ENTITLEMENT)).toBe(withCustom);
    });

    it('MANAGED with every feature on drops nothing', () => {
        const all = createEntitlement({ catalog, can: () => true, staticItems });
        expect(filterSidebarByEntitlement(staticItems, all)).toEqual(staticItems);
    });
});

describe('filterSidebarByEntitlement — CRM-only plan', () => {
    const out = filterSidebarByEntitlement(staticItems, crmOnly);

    it('drops LMS, AI and ERP tabs, keeps CRM and core', () => {
        const kept = ids(out);
        [
            'dashboard',
            'leads',
            'admissions',
            'communications',
            'fee-management',
            'settings',
        ].forEach((id) => expect(kept).toContain(id));
        [
            'courses',
            'course-creation',
            'live-sessions',
            'assessments-tests',
            'question-banks',
            'ai-tools-tab',
            'knowledge-base-tab',
            'erp-people',
            'erp-payroll',
            'mentorship',
        ].forEach((id) => expect(kept).not.toContain(id));
        expect(categoriesWithItems(out, undefined)).toEqual(new Set(['CRM']));
    });

    it('drops non-entitled sub-tabs of a kept tab', () => {
        expect(subIds(out, 'manage-institute')).toEqual([
            'institute-overview',
            'teams',
            'suborg-teams',
            'manage-institute-suborgs',
            'inventory-management',
            'manage-packages',
        ]);
        expect(subIds(out, 'manage-contacts')).not.toContain('linked-contacts');
    });

    it('custom tabs stay unless their route is outside the plan', () => {
        const custom: SidebarItemsType[] = [
            { icon: Icon, id: 'custom-a', title: 'Courses link', to: '/study-library/courses' },
            { icon: Icon, id: 'custom-b', title: 'External', to: 'https://example.com' },
            { icon: Icon, id: 'custom-c', title: 'Leads link', to: '/audience-manager/list' },
            {
                icon: Icon,
                id: 'custom-d',
                title: 'Group',
                subItems: [
                    {
                        subItem: 'Batches',
                        subItemLink: '/manage-institute/batches',
                        subItemId: 'x1',
                    },
                    { subItem: 'Leads', subItemLink: '/audience-manager/list', subItemId: 'x2' },
                ],
            },
        ];
        const res = filterSidebarByEntitlement(custom, crmOnly);
        expect(ids(res)).toEqual(['custom-b', 'custom-c', 'custom-d']);
        expect(subIds(res, 'custom-d')).toEqual(['x2']);
    });

    it('a tab that loses every sub-tab is dropped; one with its own route stays a link', () => {
        const items: SidebarItemsType[] = [
            {
                icon: Icon,
                id: 'custom-e',
                title: 'Only LMS',
                subItems: [
                    { subItem: 'Courses', subItemLink: '/study-library/courses', subItemId: 'y1' },
                ],
            },
            {
                icon: Icon,
                id: 'custom-f',
                title: 'Routed',
                to: '/audience-manager/list',
                subItems: [
                    { subItem: 'Courses', subItemLink: '/study-library/courses', subItemId: 'y2' },
                ],
            },
        ];
        const res = filterSidebarByEntitlement(items, crmOnly);
        expect(ids(res)).toEqual(['custom-f']);
        expect(res[0]!.subItems).toBeUndefined();
    });

    it('a built-in tab with every governed sub-tab off disappears', () => {
        const off = catalog.modules
            .filter((m) => ['automation', 'website'].includes(m.key))
            .flatMap((m) => m.features.map((f) => f.key));
        const e = createEntitlement({ catalog, can: canAllExcept(off), staticItems });
        expect(ids(filterSidebarByEntitlement(staticItems, e))).not.toContain('automations');
    });
});

// ─── Locked / visible entries ────────────────────────────────────────────────

const roleItems: SidebarItemsType[] = [
    { icon: Icon, id: 'dashboard', title: 'Dashboard', to: '/dashboard', category: 'CRM' },
    {
        icon: Icon,
        id: 'leads',
        title: 'Leads',
        category: 'CRM',
        subItems: [
            { subItem: 'Lead list', subItemLink: '/audience-manager/list', subItemId: 'l1' },
            {
                subItem: 'Follow-ups',
                subItemLink: '/audience-manager/follow-ups?bucket=all',
                subItemId: 'l2',
                locked: true,
            },
        ],
    },
    {
        icon: Icon,
        id: 'admissions',
        title: 'Admissions',
        category: 'CRM',
        locked: true,
        subItems: [{ subItem: 'Dashboard', subItemLink: '/admissions/dashboard', subItemId: 'a1' }],
    },
    { icon: Icon, id: 'courses', title: 'Courses', to: '/study-library/courses', category: 'LMS' },
    {
        icon: Icon,
        id: 'ai-tools-tab',
        title: 'AI tools',
        to: '/ai-center/ai-tools',
        category: 'AI',
    },
    { icon: Icon, id: 'erp-people', title: 'People', to: '/erp/people', category: 'ERP' },
    {
        icon: Icon,
        id: 'other-inst',
        title: 'Other',
        to: '/other',
        category: 'CRM',
        showForInstitute: 'inst-2',
    },
    { icon: Icon, id: 'settings', title: 'Settings', to: '/settings', category: 'CRM' },
    { icon: Icon, id: 'custom-root', title: 'Root', to: '/', category: 'CRM', locked: true },
];
const ctx = {
    instituteId: 'inst-1',
    sidebarCategories: [
        { id: 'AI', visible: false },
        { id: 'ERP', visible: true, locked: true },
    ],
};

describe('collectNavEntries', () => {
    const entries = collectNavEntries(roleItems, ctx);
    const byRoute = Object.fromEntries(entries.map((e) => [e.route, e.locked]));

    it('marks entries locked by themselves, their parent tab or their category', () => {
        expect(byRoute).toEqual({
            '/dashboard': false,
            '/audience-manager/list': false,
            '/audience-manager/follow-ups?bucket=all': true,
            '/admissions/dashboard': true,
            '/study-library/courses': false,
            '/erp/people': true,
            '/': true,
        });
    });
    it('leaves out hidden categories, other institutes and settings', () => {
        expect(entries.map((e) => e.tabId)).not.toContain('ai-tools-tab');
        expect(entries.map((e) => e.tabId)).not.toContain('other-inst');
        expect(entries.map((e) => e.tabId)).not.toContain('settings');
    });
});

describe('⌘K search offers only visible, unlocked entries', () => {
    const res = filterSearchableItems(roleItems, ctx);
    it('drops locked tabs, locked sub-tabs, locked/hidden categories', () => {
        expect(ids(res)).toEqual(['dashboard', 'leads', 'courses']);
        expect(subIds(res, 'leads')).toEqual(['l1']);
    });
    it('without settings keeps everything visible and unlocked', () => {
        const plain = filterSearchableItems([roleItems[0]!, roleItems[3]!], {
            instituteId: 'inst-1',
            sidebarCategories: null,
        });
        expect(ids(plain)).toEqual(['dashboard', 'courses']);
    });
});

describe('Recent offers only visible, unlocked entries', () => {
    const entry = (route: string): RecentTabEntry => ({
        id: route,
        label: route,
        route,
        category: 'CRM',
        visitedAt: '2026-10-13T00:00:00Z',
    });
    const recent = [
        entry('/audience-manager/list'),
        entry('/audience-manager/follow-ups?bucket=all'), // locked sub-tab
        entry('/admissions/dashboard'), // under a locked tab
        entry('/erp/people'), // locked category
        entry('/ai-center/ai-tools'), // hidden category
        entry('/manage-pages/blog'), // no longer in the sidebar (hidden / out of plan)
        entry('/settings'),
        entry('/study-library/courses'),
    ];

    it('filters at render against the current sidebar', () => {
        expect(
            filterRecentEntries(recent, roleItems, { ...ctx, canOpenSettings: true }).map(
                (e) => e.route
            )
        ).toEqual(['/audience-manager/list', '/settings', '/study-library/courses']);
    });
    it('drops settings screens when the user cannot open Settings', () => {
        expect(
            filterRecentEntries(recent, roleItems, { ...ctx, canOpenSettings: false }).map(
                (e) => e.route
            )
        ).toEqual(['/audience-manager/list', '/study-library/courses']);
    });
});

// ─── Route guard decision ────────────────────────────────────────────────────

describe('decideRouteAccess', () => {
    const navEntries = collectNavEntries(roleItems, ctx);
    const blogOff = createEntitlement({
        catalog,
        can: canAllExcept(['website.blog']),
        staticItems,
    });

    it.each<[string, string, typeof FULL_ENTITLEMENT, 'allow' | 'not-in-plan' | 'locked']>([
        // LEGACY: only locks matter
        ['LEGACY, unlocked page', '/audience-manager/list', FULL_ENTITLEMENT, 'allow'],
        ['LEGACY, locked sub-tab', '/audience-manager/follow-ups', FULL_ENTITLEMENT, 'locked'],
        [
            'LEGACY, deeper page of locked tab',
            '/admissions/dashboard/x',
            FULL_ENTITLEMENT,
            'locked',
        ],
        ['LEGACY, locked category', '/erp/people/org', FULL_ENTITLEMENT, 'locked'],
        [
            'LEGACY, hidden category is NOT blocked',
            '/ai-center/ai-tools',
            FULL_ENTITLEMENT,
            'allow',
        ],
        [
            'LEGACY, hidden/unknown page is NOT blocked',
            '/manage-pages/blog',
            FULL_ENTITLEMENT,
            'allow',
        ],
        ['LEGACY, a locked "/" custom tab never blocks', '/foo', FULL_ENTITLEMENT, 'allow'],
        ['LEGACY, a locked dashboard never blocks', '/dashboard', FULL_ENTITLEMENT, 'allow'],
        ['LEGACY, settings never blocks', '/settings', FULL_ENTITLEMENT, 'allow'],
        ['LEGACY, locked-feature never blocks', '/locked-feature', FULL_ENTITLEMENT, 'allow'],
        // MANAGED
        ['MANAGED CRM-only, LMS page', '/study-library/courses', crmOnly, 'not-in-plan'],
        [
            'MANAGED CRM-only, LMS deep page',
            '/study-library/courses/course-details',
            crmOnly,
            'not-in-plan',
        ],
        ['MANAGED CRM-only, CRM page', '/audience-manager/list', crmOnly, 'allow'],
        ['MANAGED CRM-only, unclaimed page', '/some/new-page', crmOnly, 'allow'],
        ['MANAGED CRM-only, dashboard', '/dashboard', crmOnly, 'allow'],
        ['MANAGED CRM-only, settings', '/settings', crmOnly, 'allow'],
        ['MANAGED, plan wins over lock', '/erp/people', crmOnly, 'not-in-plan'],
        ['MANAGED, entitled but locked', '/audience-manager/follow-ups', crmOnly, 'locked'],
        ['MANAGED blog off, blog page', '/manage-pages/blog', blogOff, 'not-in-plan'],
        ['MANAGED blog off, builder page', '/manage-pages', blogOff, 'allow'],
    ])('%s (%s) → %s', (_name, pathname, entitlement, kind) => {
        expect(decideRouteAccess({ pathname, entitlement, navEntries }).kind).toBe(kind);
    });

    it('a page with both a locked and an unlocked visible entry is allowed', () => {
        const items: SidebarItemsType[] = [
            {
                icon: Icon,
                id: 'leads',
                title: 'Leads',
                subItems: [
                    {
                        subItem: 'Call log',
                        subItemLink: '/audience-manager/call-log',
                        subItemId: 'c1',
                        locked: true,
                    },
                ],
            },
            { icon: Icon, id: 'calling', title: 'Calling', to: '/audience-manager/call-log' },
        ];
        const entries = collectNavEntries(items, { instituteId: 'i' });
        expect(
            decideRouteAccess({
                pathname: '/audience-manager/call-log',
                entitlement: FULL_ENTITLEMENT,
                navEntries: entries,
            }).kind
        ).toBe('allow');
    });

    it('longest match wins: an unlocked deeper entry beats a locked parent route', () => {
        const items: SidebarItemsType[] = [
            { icon: Icon, id: 'a', title: 'Library', to: '/study-library', locked: true },
            { icon: Icon, id: 'b', title: 'Courses', to: '/study-library/courses' },
        ];
        const entries = collectNavEntries(items, {});
        expect(
            decideRouteAccess({
                pathname: '/study-library/courses/x',
                entitlement: FULL_ENTITLEMENT,
                navEntries: entries,
            }).kind
        ).toBe('allow');
        expect(
            decideRouteAccess({
                pathname: '/study-library/reports',
                entitlement: FULL_ENTITLEMENT,
                navEntries: entries,
            })
        ).toEqual({ kind: 'locked', label: 'Library' });
    });

    it('unknown sidebar state never blocks for a lock', () => {
        expect(
            decideRouteAccess({
                pathname: '/audience-manager/follow-ups',
                entitlement: FULL_ENTITLEMENT,
                navEntries: null,
            }).kind
        ).toBe('allow');
    });

    it('not-in-plan reports the governing features', () => {
        expect(
            decideRouteAccess({
                pathname: '/study-library/courses',
                entitlement: crmOnly,
                navEntries: null,
            })
        ).toEqual({ kind: 'not-in-plan', features: ['lms.courses'] });
    });
});

describe('pickActiveCategory (rail category for the current route)', () => {
    const cats = [
        { id: 'LMS', visible: true, default: true, order: 0 },
        { id: 'CRM', visible: true, default: false, order: 1 },
        { id: 'AI', visible: true, default: false, order: 2 },
        { id: 'ERP', visible: false, default: false, order: 3 },
    ];
    // What the CRM-only sidebar actually draws.
    const crmOnlyItems = filterSidebarByEntitlement(staticItems, crmOnly);
    const available = categoriesWithItems(crmOnlyItems, undefined);

    it('LEGACY behaves as before', () => {
        const base = { activeCategory: 'CRM', isNavigation: true, available: null };
        // a visible match wins
        expect(pickActiveCategory({ ...base, matches: ['LMS'], sidebarCategories: cats })).toBe(
            'LMS'
        );
        // navigating within the current category stays there
        expect(
            pickActiveCategory({ ...base, matches: ['LMS', 'CRM'], sidebarCategories: cats })
        ).toBe('CRM');
        // hidden match → the role's default visible category
        expect(pickActiveCategory({ ...base, matches: ['ERP'], sidebarCategories: cats })).toBe(
            'LMS'
        );
        // no match → default; no role settings yet → keep the current one
        expect(pickActiveCategory({ ...base, matches: [], sidebarCategories: cats })).toBe('LMS');
        expect(pickActiveCategory({ ...base, matches: [], sidebarCategories: null })).toBeNull();
    });

    it('MANAGED: a page outside the plan opens a category with items, never an empty panel', () => {
        expect(available.has('CRM')).toBe(true);
        expect(available.has('LMS')).toBe(false);
        // /study-library/courses matches the static LMS entry; LMS is the role default too.
        expect(
            pickActiveCategory({
                matches: ['LMS'],
                activeCategory: 'CRM',
                isNavigation: false,
                sidebarCategories: cats,
                available,
            })
        ).toBe('CRM');
        // Nothing matches and the role settings are not loaded yet.
        expect(
            pickActiveCategory({
                matches: [],
                activeCategory: 'LMS',
                isNavigation: false,
                sidebarCategories: null,
                available,
            })
        ).toBe('CRM');
        // Staying in the current category needs it to have items as well.
        expect(
            pickActiveCategory({
                matches: ['LMS', 'CRM'],
                activeCategory: 'LMS',
                isNavigation: true,
                sidebarCategories: cats,
                available,
            })
        ).toBe('CRM');
    });

    it('MANAGED: an entitled match still wins', () => {
        expect(
            pickActiveCategory({
                matches: ['CRM'],
                activeCategory: 'AI',
                isNavigation: false,
                sidebarCategories: cats,
                available: new Set(['CRM', 'AI']),
            })
        ).toBe('CRM');
        expect(
            pickActiveCategory({
                matches: [],
                activeCategory: 'CRM',
                isNavigation: false,
                sidebarCategories: [],
                available: new Set(),
            })
        ).toBeNull();
    });
});
