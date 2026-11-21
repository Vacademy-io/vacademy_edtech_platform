import { describe, expect, it, vi } from 'vitest';
import Papa from 'papaparse';

vi.mock('@/utils/roleUtils', () => ({
    mapRoleToCustomName: (name: string) => name.charAt(0) + name.slice(1).toLowerCase(),
}));

import { buildTeamExportCsv, isShareablePassword, parseTeamImportCsv } from './team-csv';
import type { TeamMember, TeamRoleOption } from './team-helpers';

const t = ((key: string, vars?: Record<string, unknown>) =>
    vars ? `${key} ${JSON.stringify(vars)}` : key) as never;

const ROLES: TeamRoleOption[] = [
    { id: 'r1', name: 'ADMIN', label: 'Admin', custom: false },
    { id: 'r2', name: 'TEACHER', label: 'Faculty', custom: false },
    { id: 'r3', name: 'Counsellor', label: 'Counsellor', custom: true },
];

const csvFile = (text: string) => new File([text], 'team.csv', { type: 'text/csv' });

const parse = (text: string, existing: string[] = []) =>
    parseTeamImportCsv(
        csvFile(text),
        { roleOptions: ROLES, existingEmails: new Set(existing), defaultCountry: 'in' },
        t
    );

describe('parseTeamImportCsv', () => {
    it('accepts role names or labels, several per row, and normalises phones', async () => {
        const result = await parse(
            [
                'full_name,email,mobile_number,roles',
                'Priya Sharma,PRIYA@example.com,9876543210,Faculty | counsellor',
                'Rahul Verma,rahul@example.com,,ADMIN',
            ].join('\n')
        );
        expect(result.errors).toEqual([]);
        expect(result.validRows).toEqual([
            {
                rowNumber: 1,
                name: 'Priya Sharma',
                email: 'priya@example.com',
                mobile: '919876543210',
                roles: ['TEACHER', 'Counsellor'],
            },
            {
                rowNumber: 2,
                name: 'Rahul Verma',
                email: 'rahul@example.com',
                mobile: '',
                roles: ['ADMIN'],
            },
        ]);
    });

    it('reports every problem per row and keeps the good rows', async () => {
        const result = await parse(
            [
                'full_name,email,mobile_number,roles',
                ',bad-email,123,Wizard',
                'Asha,asha@example.com,,Admin',
                'Asha Again,asha@example.com,,Admin',
                'Old Hand,old@example.com,,Admin',
                'No Role,norole@example.com,,',
            ].join('\n'),
            ['old@example.com']
        );
        expect(result.validRows.map((r) => r.email)).toEqual(['asha@example.com']);
        const byRow = new Map(result.errors.map((e) => [e.rowNumber, e.messages.join(' | ')]));
        expect(byRow.get(1)).toContain('import.errors.nameRequired');
        expect(byRow.get(1)).toContain('import.errors.emailInvalid');
        expect(byRow.get(1)).toContain('import.errors.phoneInvalid');
        expect(byRow.get(1)).toContain('Wizard');
        expect(byRow.get(3)).toContain('import.errors.duplicateInFile');
        expect(byRow.get(4)).toContain('import.errors.alreadyOnTeam');
        expect(byRow.get(5)).toContain('import.errors.roleRequired');
    });

    it('rejects a file without the required columns', async () => {
        const result = await parse('name,mail\nA,a@example.com');
        expect(result.validRows).toEqual([]);
        expect(result.errors[0]?.rowNumber).toBe(0);
        expect(result.errors[0]?.messages[0]).toContain('full_name');
    });
});

describe('buildTeamExportCsv', () => {
    const member: TeamMember = {
        id: 'u1',
        username: 'priya5616',
        email: 'priya@example.com',
        full_name: 'Priya Sharma',
        mobile_number: '919876543210',
        profile_pic_file_id: null,
        author_subtitle: 'Physics',
        status: null,
        root_user: true,
        password: 'a0ff6a',
        roles: [
            {
                id: 'ur1',
                institute_id: 'inst',
                role_name: 'TEACHER',
                status: 'ACTIVE',
                role_id: 'r2',
            },
            {
                id: 'ur2',
                institute_id: 'other',
                role_name: 'ADMIN',
                status: 'ACTIVE',
                role_id: 'r1',
            },
        ],
    };

    it('writes this institute’s roles, formatted phone and derived status', () => {
        const csv = buildTeamExportCsv([member], {
            instituteId: 'inst',
            tab: 'members',
            roleOptions: ROLES,
            includePasswords: true,
            defaultCountry: 'in',
            subOrgsOf: () => ['Bhopal Centre'],
        });
        const [header, row] = Papa.parse<string[]>(csv.trim()).data;
        expect(header).toEqual([
            'Name',
            'Email',
            'Username',
            'Password',
            'Mobile number',
            'Roles',
            'Sub-orgs',
            'Designation',
            'Status',
        ]);
        expect(row).toEqual([
            'Priya Sharma',
            'priya@example.com',
            'priya5616',
            'a0ff6a',
            '+91 98765 43210',
            'Faculty',
            'Bhopal Centre',
            'Physics',
            'Active',
        ]);
    });

    it('leaves passwords out when the institute hides them', () => {
        const csv = buildTeamExportCsv([member], {
            instituteId: 'inst',
            tab: 'invites',
            roleOptions: ROLES,
            includePasswords: false,
        });
        expect(csv).not.toContain('a0ff6a');
        expect(csv.split(/\r?\n/)[0]).toContain('Invited as');
    });
});

describe('isShareablePassword', () => {
    it('never treats a stored bcrypt hash as login details', () => {
        expect(isShareablePassword('3e9a1f')).toBe(true);
        expect(isShareablePassword('$2a$10$abcdefghijklmnopqrstuv')).toBe(false);
        expect(isShareablePassword(undefined)).toBe(false);
    });
});
