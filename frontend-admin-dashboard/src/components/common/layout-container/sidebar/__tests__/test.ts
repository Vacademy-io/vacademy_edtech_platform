import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    filterSidebarByRole,
    isSidebarLinkActive,
    pickActiveSidebarLink,
    sidebarLinkSpecificity,
} from '@/components/common/layout-container/sidebar/helper';
import type { SidebarItemsType } from '@/types/layout-container/layout-container-types';
import type { DisplaySettingsData } from '@/types/display-settings';

const auth = vi.hoisted(() => ({ roles: [] as string[], subOrgGranted: false }));
vi.mock('@/lib/auth/sessionUtility', () => ({
    getTokenFromCookie: () => 'token',
    getUserRoles: () => auth.roles,
}));
vi.mock('@/lib/display-settings/sub-org-module', () => ({
    SUB_ORG_MODULE_TAB_ID: 'manage-institute',
    SUB_ORG_MODULE_SUB_ITEM_ID: 'manage-institute-suborgs',
    canAccessSubOrgModule: () => auth.subOrgGranted,
}));

// The Follow-ups sub-items all share one path and differ only by bucket.
const TODAY = '/audience-manager/follow-ups?bucket=today';
const ALL = '/audience-manager/follow-ups?bucket=all';
const BARE = '/audience-manager/follow-ups';

describe('isSidebarLinkActive', () => {
    it('matches the bucket the user is actually on, not its siblings', () => {
        const path = '/audience-manager/follow-ups';
        expect(isSidebarLinkActive(ALL, path, { bucket: 'all' })).toBe(true);
        expect(isSidebarLinkActive(TODAY, path, { bucket: 'all' })).toBe(false);
    });

    it('ignores extra params the page added', () => {
        // ?lock=bucket rides along on the pinned sub-tabs.
        expect(
            isSidebarLinkActive(ALL, '/audience-manager/follow-ups', {
                bucket: 'all',
                lock: 'bucket',
            })
        ).toBe(true);
    });

    it('a link with no params matches on path alone', () => {
        expect(isSidebarLinkActive(BARE, '/audience-manager/follow-ups', {})).toBe(true);
        expect(isSidebarLinkActive(BARE, '/audience-manager/follow-ups', { bucket: 'all' })).toBe(
            true
        );
    });

    it('still matches a nested route under the link', () => {
        expect(isSidebarLinkActive('/erp/people', '/erp/people/abc123', {})).toBe(true);
    });

    it('does not match a different path, or a sibling prefix', () => {
        expect(isSidebarLinkActive(BARE, '/audience-manager/recent-leads', {})).toBe(false);
        // "/erp/leave" must not light up on "/erp/leave-setup"
        expect(isSidebarLinkActive('/erp/leave', '/erp/leave-setup', {})).toBe(false);
    });

    it('is false for a missing link', () => {
        expect(isSidebarLinkActive(undefined, '/anything', {})).toBe(false);
    });
});

describe('sidebarLinkSpecificity', () => {
    it('ranks a link with params above the bare path it shares', () => {
        expect(sidebarLinkSpecificity(ALL)).toBeGreaterThan(sidebarLinkSpecificity(BARE));
    });

    it('ranks a longer path above a shorter one', () => {
        expect(sidebarLinkSpecificity('/erp/people/org')).toBeGreaterThan(
            sidebarLinkSpecificity('/erp/people')
        );
    });
});

// I2CAN's Enquiry sub-tabs, as saved in prod: one page, told apart by pinned filters,
// every one opening on range=ALL.
const LEADS = '/audience-manager/recent-leads';
const UNTOUCHED = `${LEADS}?range=ALL&status=LEAD&lock=status`;
const PROCESSED = `${LEADS}?range=ALL&status=LEAD,LOST&statusExclude=1&lock=status,statusExclude`;
const ALL_LEADS = `${LEADS}?range=ALL&status=__ACTIVE__,LOST&statusExclude=1&lock=status,statusExclude`;
const SHORTLISTED = `${LEADS}?range=ALL&tier=HOT,VERY_HOT,SUPER_HOT&status=__ACTIVE__,LOST&statusExclude=1&lock=tier,status,statusExclude`;
const DISCARDED = `${LEADS}?range=ALL&status=LOST&lock=status`;
const ENQUIRY = [UNTOUCHED, PROCESSED, ALL_LEADS, SHORTLISTED, DISCARDED];

/** The search object the page writes back for a sub-tab once the user filters. */
const allLeadsFiltered = {
    lock: 'status,statusExclude',
    status: '__ACTIVE__,LOST',
    statusExclude: '1',
    range: 'CUSTOM',
    from: '2026-10-13',
    to: '2026-10-13',
};

describe('pickActiveSidebarLink', () => {
    it('keeps All Leads highlighted after the user picks a date', () => {
        expect(pickActiveSidebarLink(ENQUIRY, LEADS, allLeadsFiltered)).toBe(ALL_LEADS);
    });

    it('keeps each pinned sub-tab after its opening range is changed', () => {
        expect(
            pickActiveSidebarLink(ENQUIRY, LEADS, { lock: 'status', status: 'LEAD', range: '7' })
        ).toBe(UNTOUCHED);
        expect(
            pickActiveSidebarLink(ENQUIRY, LEADS, {
                lock: 'status,statusExclude',
                status: 'LEAD,LOST',
                statusExclude: '1',
                counsellor: 'u1',
            })
        ).toBe(PROCESSED);
        expect(pickActiveSidebarLink(ENQUIRY, LEADS, { lock: 'status', status: 'LOST' })).toBe(
            DISCARDED
        );
    });

    it('tells Shortlisted apart from All Leads, which pins the same statuses', () => {
        const shortlisted = {
            lock: 'tier,status,statusExclude',
            tier: 'HOT,VERY_HOT,SUPER_HOT',
            status: '__ACTIVE__,LOST',
            statusExclude: '1',
            sla: 'TAT_OVERDUE',
        };
        expect(pickActiveSidebarLink(ENQUIRY, LEADS, shortlisted)).toBe(SHORTLISTED);
        expect(isSidebarLinkActive(ALL_LEADS, LEADS, shortlisted)).toBe(false);
    });

    it('still matches on a fresh click (range=ALL untouched)', () => {
        expect(pickActiveSidebarLink(ENQUIRY, LEADS, { ...allLeadsFiltered, range: 'ALL' })).toBe(
            ALL_LEADS
        );
    });

    it('reads a pinned list in any order', () => {
        expect(
            pickActiveSidebarLink(ENQUIRY, LEADS, {
                ...allLeadsFiltered,
                status: 'LOST,__ACTIVE__',
            })
        ).toBe(ALL_LEADS);
    });

    it('matches nothing when the URL is outside every sub-tab', () => {
        expect(pickActiveSidebarLink(ENQUIRY, LEADS, { status: 'CONVERTED' })).toBeNull();
    });

    it('a pinned follow-up bucket survives a status filter change', () => {
        const fu = '/audience-manager/follow-ups';
        const today = `${fu}?bucket=today&lock=bucket&status=LOST&statusExclude=1`;
        const overdue = `${fu}?bucket=overdue&lock=bucket&status=LOST&statusExclude=1`;
        expect(
            pickActiveSidebarLink([today, overdue], fu, {
                bucket: 'overdue',
                lock: 'bucket',
                status: 'NEW',
            })
        ).toBe(overdue);
    });

    it('between links pinning the same filters, prefers the one whose opening values still hold', () => {
        const a = `${LEADS}?range=7&status=LEAD&lock=status`;
        const b = `${LEADS}?range=30&status=LEAD&lock=status`;
        const url = { lock: 'status', status: 'LEAD' };
        expect(pickActiveSidebarLink([a, b], LEADS, { ...url, range: '30' })).toBe(b);
        // Neither holds: the earlier link wins, as the panel always picked on a tie.
        expect(pickActiveSidebarLink([a, b], LEADS, { ...url, range: 'CUSTOM' })).toBe(a);
    });

    it('leaves unpinned links on exact matching, as before', () => {
        const overdue = `${LEADS}?sla=ANY_OVERDUE`;
        expect(pickActiveSidebarLink([overdue], LEADS, { sla: 'ANY_OVERDUE', range: '7' })).toBe(
            overdue
        );
        expect(pickActiveSidebarLink([overdue], LEADS, { sla: 'TAT_OVERDUE' })).toBeNull();
        // A bare-path sibling still catches the page, exactly as it did.
        expect(pickActiveSidebarLink([LEADS, overdue], LEADS, { sla: 'TAT_OVERDUE' })).toBe(LEADS);
    });

    it('a dashboard drill-through without the pins lights no pinned tab', () => {
        expect(pickActiveSidebarLink(ENQUIRY, LEADS, { status: 'LEAD', range: '30' })).toBeNull();
    });
});

const icon = (() => null) as unknown as SidebarItemsType['icon'];
const MENU: SidebarItemsType[] = [
    { icon, title: 'Dashboard', id: 'dashboard', to: '/dashboard' },
    {
        icon,
        title: 'Manage Institute',
        id: 'manage-institute',
        subItems: [
            { subItem: 'Batches', subItemLink: '/manage-institute/batches', subItemId: 'batches' },
            { subItem: 'Teams', subItemLink: '/manage-institute/teams', subItemId: 'teams' },
            {
                subItem: 'Sub-Orgs',
                subItemLink: '/manage-custom-teams',
                subItemId: 'manage-institute-suborgs',
            },
            {
                subItem: 'Packages',
                subItemLink: '/admin-package-management',
                subItemId: 'manage-packages',
                adminOnly: true,
            },
        ],
    },
    {
        icon,
        title: 'Payroll',
        id: 'erp-payroll',
        subItems: [
            {
                subItem: 'Runs',
                subItemLink: '/erp/payroll',
                subItemId: 'erp-payroll-runs',
                adminOnly: true,
            },
        ],
    },
    { icon, title: 'Settings', id: 'settings', to: '/settings' },
    {
        icon,
        title: 'Engagement',
        id: 'engagement-engines',
        subItems: [
            {
                subItem: 'Engines',
                subItemLink: '/engagement-engines',
                subItemId: 'engagement-engines-list',
                adminOnly: true,
            },
        ],
    },
    { icon, title: 'Logs', id: 'admin-activity-logs', to: '/admin-activity-logs' },
];

type Tab = DisplaySettingsData['sidebar'][number];
const tab = (id: string, visible: boolean, subs: Record<string, boolean> = {}): Tab => ({
    id,
    order: 1,
    visible,
    subTabs: Object.entries(subs).map(([sid, v], i) => ({
        id: sid,
        route: '#',
        order: i + 1,
        visible: v,
    })),
});
const settings = (...sidebar: Tab[]) => ({ sidebar }) as DisplaySettingsData;
const ids = (items: SidebarItemsType[]) => items.map((i) => i.id);
const subIds = (items: SidebarItemsType[], id: string) =>
    items.find((i) => i.id === id)?.subItems?.map((s) => s.subItemId);

describe('filterSidebarByRole', () => {
    beforeEach(() => {
        auth.roles = ['Operations'];
        auth.subOrgGranted = false;
    });

    it('gives an admin everything', () => {
        auth.roles = ['ADMIN'];
        expect(filterSidebarByRole(MENU, null)).toEqual(MENU);
    });

    it('hides admin-only tabs and sub-items when the role has no settings', () => {
        const out = filterSidebarByRole(MENU, null);
        expect(ids(out)).toEqual(['dashboard', 'erp-payroll', 'engagement-engines']);
        expect(subIds(out, 'erp-payroll')).toEqual([]);
    });

    it('shows Manage Institute to a custom role whose settings turn it on', () => {
        const out = filterSidebarByRole(
            MENU,
            settings(tab('manage-institute', true, { batches: true, teams: true }))
        );
        expect(subIds(out, 'manage-institute')).toEqual(['batches', 'teams']);
    });

    it('shows an adminOnly sub-item only when the settings explicitly turn it on', () => {
        const off = filterSidebarByRole(MENU, settings(tab('erp-payroll', true)));
        expect(subIds(off, 'erp-payroll')).toEqual([]);

        const on = filterSidebarByRole(
            MENU,
            settings(
                tab('erp-payroll', true, { 'erp-payroll-runs': true }),
                tab('manage-institute', true, { 'manage-packages': true })
            )
        );
        expect(subIds(on, 'erp-payroll')).toEqual(['erp-payroll-runs']);
        expect(subIds(on, 'manage-institute')).toContain('manage-packages');
    });

    it('ignores an adminOnly sub-item switched on under a hidden tab', () => {
        const out = filterSidebarByRole(
            MENU,
            settings(tab('manage-institute', false, { 'manage-packages': true }))
        );
        expect(ids(out)).not.toContain('manage-institute');
    });

    it('never shows Settings or Engagement Engines to a non-admin', () => {
        const out = filterSidebarByRole(
            MENU,
            settings(
                tab('settings', true),
                tab('engagement-engines', true, { 'engagement-engines-list': true })
            )
        );
        expect(ids(out)).not.toContain('settings');
        // The tab itself stays as before; only its admin-only entries can't be opted in.
        expect(subIds(out, 'engagement-engines')).toEqual([]);
    });

    it('never shows admin activity logs to a non-admin, even when switched on', () => {
        const out = filterSidebarByRole(MENU, settings(tab('admin-activity-logs', true)));
        expect(ids(out)).not.toContain('admin-activity-logs');
    });

    it('keeps the sub-orgs entry behind its own module grant', () => {
        const optedIn = settings(
            tab('manage-institute', true, { batches: true, 'manage-institute-suborgs': true })
        );
        expect(subIds(filterSidebarByRole(MENU, optedIn), 'manage-institute')).toEqual([
            'batches',
            'teams',
        ]);

        auth.subOrgGranted = true;
        expect(subIds(filterSidebarByRole(MENU, null), 'manage-institute')).toEqual([
            'manage-institute-suborgs',
        ]);
        expect(subIds(filterSidebarByRole(MENU, optedIn), 'manage-institute')).toEqual([
            'batches',
            'teams',
            'manage-institute-suborgs',
        ]);
    });
});
