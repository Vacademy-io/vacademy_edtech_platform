import { describe, expect, it } from 'vitest';
import {
    getLoginGateRoles,
    getPortalAllowedRoles,
    getPortalType,
    normalizeRoleName,
    parsePortalRoles,
    portalAdmitsRoles,
} from './portal-roles';

describe('parsePortalRoles', () => {
    it('splits, trims, upper-cases, collapses spaces and dedupes', () => {
        expect(parsePortalRoles(' ADMIN, course  creator ,Counsellor,ADMIN')).toEqual([
            'ADMIN',
            'COURSE CREATOR',
            'COUNSELLOR',
        ]);
    });

    it('is empty for a missing role', () => {
        expect(parsePortalRoles(undefined)).toEqual([]);
        expect(parsePortalRoles('')).toEqual([]);
    });
});

describe('getPortalType', () => {
    it('reads learner, then admin, then teacher', () => {
        expect(getPortalType('LEARNER,TEACHER')).toBe('LEARNER');
        expect(getPortalType('COUNSELLOR,ADMIN,TEACHER')).toBe('ADMIN');
        expect(getPortalType('TEACHER,COURSE CREATOR')).toBe('TEACHER');
        expect(getPortalType('MANAGE_LEAD')).toBeNull();
    });
});

describe('getPortalAllowedRoles', () => {
    it('has no gate without a row or on a learner row', () => {
        expect(getPortalAllowedRoles(undefined)).toBeNull();
        expect(getPortalAllowedRoles('LEARNER')).toBeNull();
        expect(getPortalAllowedRoles('LEARNER,TEACHER')).toBeNull();
    });

    it('admits exactly the ticked roles on an admin portal', () => {
        expect(getPortalAllowedRoles('ADMIN')).toEqual(['ADMIN']);
        expect(getPortalAllowedRoles('ADMIN,COUNSELLOR,TEACHER')).toEqual([
            'ADMIN',
            'COUNSELLOR',
            'TEACHER',
        ]);
    });

    it('always admits ADMIN on a teacher or custom-role portal', () => {
        expect(getPortalAllowedRoles('TEACHER')).toEqual(['ADMIN', 'TEACHER']);
        expect(getPortalAllowedRoles('ADMIN OPS')).toEqual(['ADMIN', 'ADMIN OPS']);
    });
});

describe('portalAdmitsRoles', () => {
    it('lets anyone through when there is no gate', () => {
        expect(portalAdmitsRoles(null, ['COUNSELLOR'])).toBe(true);
    });

    it('admits a user holding any ticked role', () => {
        const allowed = getPortalAllowedRoles('ADMIN,COUNSELLOR,TEACHER');
        expect(portalAdmitsRoles(allowed, ['STUDENT', 'COUNSELLOR'])).toBe(true);
        expect(portalAdmitsRoles(allowed, ['ADMIN'])).toBe(true);
    });

    it('refuses a user holding none of them', () => {
        const allowed = getPortalAllowedRoles('ADMIN,COUNSELLOR');
        expect(portalAdmitsRoles(allowed, ['TEACHER', 'CRM_ACCESS'])).toBe(false);
        expect(portalAdmitsRoles(allowed, [])).toBe(false);
    });

    it('matches a mixed-case custom role against the upper-cased list', () => {
        const allowed = getPortalAllowedRoles('ADMIN,OPERATIONS,COURSE CREATOR');
        expect(portalAdmitsRoles(allowed, ['Operations'])).toBe(true);
        expect(portalAdmitsRoles(allowed, ['Course Creator'])).toBe(true);
    });

    it('keeps the legacy "Admin" role out of an ADMIN-only portal, as before', () => {
        expect(portalAdmitsRoles(getPortalAllowedRoles('ADMIN'), ['Admin'])).toBe(false);
        expect(portalAdmitsRoles(getPortalAllowedRoles('ADMIN'), ['ADMIN'])).toBe(true);
    });

    it('still lets the legacy "Admin" role into portals that admit more than ADMIN', () => {
        // Those portals were never gated before, so these users signed in there.
        expect(portalAdmitsRoles(getPortalAllowedRoles('ADMIN,TEACHER'), ['Admin'])).toBe(true);
        expect(portalAdmitsRoles(getPortalAllowedRoles('TEACHER'), ['Admin'])).toBe(true);
    });
});

describe('normalizeRoleName', () => {
    it('matches how the server canonicalises a role', () => {
        expect(normalizeRoleName('  assessment   creator ')).toBe('ASSESSMENT CREATOR');
    });
});

describe('getLoginGateRoles', () => {
    it('uses the ticked roles on a white-label host', () => {
        expect(getLoginGateRoles('ADMIN,COUNSELLOR', false)).toEqual(['ADMIN', 'COUNSELLOR']);
    });

    it('keeps the old exact-ADMIN rule in a native app branded from a fixed row', () => {
        // The Vacademy Admin app brands from one institute's row but every
        // institute's staff sign in to it; that row's list must not gate them.
        expect(
            getLoginGateRoles('ADMIN,EVALUATOR,COURSE CREATOR,TEACHER,ASSESSMENT CREATOR', true)
        ).toBeNull();
        expect(getLoginGateRoles('ADMIN', true)).toEqual(['ADMIN']);
        expect(getLoginGateRoles(undefined, true)).toBeNull();
    });
});
