import { describe, expect, it } from 'vitest';
import { FULL_ENTITLEMENT } from './entitlement';
import { decideRouteAccess, NOT_IN_ALLOW_LIST_LABEL, type NavEntry } from './nav-access';

/** The four pages a Telleo sign-up sees (TelleoDisplaySettings on the server). */
const telleoEntries: NavEntry[] = [
    {
        route: '/audience-manager/list',
        path: '/audience-manager/list',
        label: 'Lead list',
        locked: false,
        tabId: 'leads',
        subId: 'lead-list-leads',
    },
    {
        route: '/calling/dashboard',
        path: '/calling/dashboard',
        label: 'Calls',
        locked: false,
        tabId: 'calling',
        subId: 'calling-dashboard',
    },
    {
        route: '/audience-manager/call-log',
        path: '/audience-manager/call-log',
        label: 'Call log',
        locked: false,
        tabId: 'calling',
        subId: 'calling-call-log',
    },
    {
        route: '/calling/ai-agents',
        path: '/calling/ai-agents',
        label: 'AI agents',
        locked: false,
        tabId: 'calling',
        subId: 'calling-ai-agents',
    },
];

const decide = (
    pathname: string,
    allowListOnly: boolean,
    navEntries: NavEntry[] | null = telleoEntries
) => decideRouteAccess({ pathname, entitlement: FULL_ENTITLEMENT, navEntries, allowListOnly });

describe('decideRouteAccess in allow-list mode', () => {
    it.each([
        '/audience-manager/list',
        '/calling/dashboard',
        '/audience-manager/call-log',
        '/calling/ai-agents',
    ])('opens the listed page %s', (path) => expect(decide(path, true)).toEqual({ kind: 'allow' }));

    it('opens pages under a listed entry (an agent of the list)', () => {
        expect(decide('/calling/ai-agents/abc', true)).toEqual({ kind: 'allow' });
    });

    it.each([
        '/manage-students/students-list',
        '/audience-manager/lead-board',
        '/calling/call-queue',
        '/study-library/courses',
    ])('blocks the unlisted page %s', (path) =>
        expect(decide(path, true)).toEqual({ kind: 'locked', label: NOT_IN_ALLOW_LIST_LABEL })
    );

    it('keeps the always-allowed pages (settings, dashboard, login)', () => {
        expect(decide('/settings', true)).toEqual({ kind: 'allow' });
        expect(decide('/dashboard', true)).toEqual({ kind: 'allow' });
        expect(decide('/login', true)).toEqual({ kind: 'allow' });
    });

    it('does not block while the sidebar is unknown', () => {
        expect(decide('/manage-students/students-list', true, null)).toEqual({ kind: 'allow' });
    });

    it('is off by default: an unlisted page opens, as deep links always have', () => {
        expect(decide('/manage-students/students-list', false)).toEqual({ kind: 'allow' });
        expect(
            decideRouteAccess({
                pathname: '/calling/call-queue',
                entitlement: FULL_ENTITLEMENT,
                navEntries: telleoEntries,
            })
        ).toEqual({ kind: 'allow' });
    });
});
