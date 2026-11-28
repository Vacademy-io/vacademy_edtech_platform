import { describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/roleUtils', () => ({
    mapRoleToCustomName: (name: string) =>
        name === 'CONTENT CREATOR'
            ? 'Course Creator'
            : name.charAt(0) + name.slice(1).toLowerCase(),
}));

import {
    buildRoleOptions,
    formatPhoneForDisplay,
    hasNeverSignedIn,
    memberStatusOf,
    sortRoleNames,
    toPhoneInputValue,
} from './team-helpers';

const INSTITUTE = 'inst-1';
const role = (id: string, name: string, instituteId: string | null) => ({
    id,
    name,
    instituteId,
    permissions: [],
});

describe('buildRoleOptions', () => {
    const roles = [
        role('r-counsellor', 'Counsellor', INSTITUTE),
        role('r-teacher', 'TEACHER', null),
        role('r-student', 'STUDENT', null),
        role('r-admin', 'ADMIN', null),
        role('r-foreign', 'Other Institute Role', 'inst-2'),
        role('r-cc', 'CONTENT CREATOR', null),
    ];

    it('offers platform roles plus only this institute’s custom roles', () => {
        const names = buildRoleOptions(roles, INSTITUTE, () => true).map((o) => o.name);
        expect(names).toEqual(['ADMIN', 'TEACHER', 'CONTENT CREATOR', 'Counsellor']);
        expect(names).not.toContain('Other Institute Role');
        expect(names).not.toContain('STUDENT');
    });

    it('marks institute-owned roles as custom and keeps their own name', () => {
        const options = buildRoleOptions(roles, INSTITUTE, () => true);
        expect(options.find((o) => o.name === 'Counsellor')).toMatchObject({
            custom: true,
            label: 'Counsellor',
        });
        expect(options.find((o) => o.name === 'CONTENT CREATOR')).toMatchObject({
            custom: false,
            label: 'Course Creator',
        });
    });

    it('accepts the snake_case owner field too', () => {
        const options = buildRoleOptions(
            [{ id: 'x', name: 'Front Desk', institute_id: INSTITUTE, permissions: [] }],
            INSTITUTE,
            () => true
        );
        expect(options).toEqual([
            { id: 'x', name: 'Front Desk', label: 'Front Desk', custom: true },
        ]);
    });

    it('drops roles the viewer is not allowed to see', () => {
        const names = buildRoleOptions(roles, INSTITUTE, (name) => name !== 'ADMIN').map(
            (o) => o.name
        );
        expect(names).not.toContain('ADMIN');
    });

    it('sorts selected role names in picker order', () => {
        const options = buildRoleOptions(roles, INSTITUTE, () => true);
        expect(sortRoleNames(['Counsellor', 'ADMIN', 'TEACHER'], options)).toEqual([
            'ADMIN',
            'TEACHER',
            'Counsellor',
        ]);
    });
});

describe('phone helpers', () => {
    it('formats widget digits, spaced and bare national numbers', () => {
        expect(formatPhoneForDisplay('919876543210', 'in')).toBe('+91 98765 43210');
        expect(formatPhoneForDisplay('+91 98765 43210', 'in')).toBe('+91 98765 43210');
        expect(formatPhoneForDisplay('9876543210', 'in')).toBe('+91 98765 43210');
        expect(formatPhoneForDisplay(null, 'in')).toBeNull();
        expect(formatPhoneForDisplay('  ', 'in')).toBeNull();
    });

    it('gives the phone widget digits with a dial code', () => {
        expect(toPhoneInputValue('+91 98765 43210', 'in')).toBe('919876543210');
        // A bare national number must not be read as +98 (Iran) by the widget.
        expect(toPhoneInputValue('9876543210', 'in')).toBe('919876543210');
        expect(toPhoneInputValue('', 'in')).toBe('');
    });
});

describe('memberStatusOf', () => {
    // Shaped like users-of-status: no `status`, and only ACTIVE/INVITED roles are listed.
    const member = (roles: { role_name: string; institute_id: string }[]) => ({
        id: 'u1',
        username: 'u1',
        email: 'u1@x.com',
        full_name: 'U One',
        mobile_number: null,
        profile_pic_file_id: null,
        status: null,
        root_user: false,
        roles: roles.map((role, index) => ({
            id: `ur${index}`,
            role_id: `r${index}`,
            status: 'ACTIVE',
            ...role,
        })),
    });

    it('is active while any staff role here is listed', () => {
        expect(
            memberStatusOf(member([{ role_name: 'TEACHER', institute_id: INSTITUTE }]), INSTITUTE)
        ).toBe('ACTIVE');
    });

    it('is disabled when no staff role here comes back (disabled rows are never listed)', () => {
        expect(memberStatusOf(member([]), INSTITUTE)).toBe('DISABLED');
        // A learner enrolment in the same institute does not make them active staff.
        expect(
            memberStatusOf(member([{ role_name: 'STUDENT', institute_id: INSTITUTE }]), INSTITUTE)
        ).toBe('DISABLED');
        // Staff elsewhere does not count here.
        expect(
            memberStatusOf(member([{ role_name: 'ADMIN', institute_id: 'other' }]), INSTITUTE)
        ).toBe('DISABLED');
    });
});

describe('hasNeverSignedIn', () => {
    it('is true only for an explicit null from the backend', () => {
        expect(hasNeverSignedIn({ last_login_time: null })).toBe(true);
        expect(hasNeverSignedIn({ last_login_time: 1760000000000 })).toBe(false);
        expect(hasNeverSignedIn({ last_login_time: '2026-10-20T10:00:00Z' })).toBe(false);
    });

    it('treats a missing field (older backend) as unknown, not as never signed in', () => {
        expect(hasNeverSignedIn({})).toBe(false);
    });
});
