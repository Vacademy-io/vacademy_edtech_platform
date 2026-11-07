import Papa from 'papaparse';
import type { TFunction } from 'i18next';
import { isBlankPhone, isValidPhoneValue } from '@/lib/phone-validation';
import {
    formatPhoneForDisplay,
    instituteRolesOf,
    memberStatusOf,
    toPhoneInputValue,
    type TeamMember,
    type TeamRoleOption,
} from './team-helpers';

/** Columns of the bulk-invite file, in template order. Only the first two are required. */
export const TEAM_IMPORT_HEADERS = ['full_name', 'email', 'mobile_number', 'roles'] as const;
const REQUIRED_HEADERS = ['full_name', 'email', 'roles'];

/** Each file is invited one person at a time (one invite email each), so keep it bounded. */
export const MAX_IMPORT_ROWS = 500;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A password the invite API echoed back is shareable only if it is the generated one, not a stored hash. */
export const isShareablePassword = (password: string | null | undefined): password is string =>
    !!password && !password.startsWith('$2');

export const triggerCsvDownload = (content: string, filename: string) => {
    // BOM so Excel opens UTF-8 (names with accents, Devanagari) correctly.
    const blob = new Blob(['﻿', content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};

const today = () => new Date().toISOString().slice(0, 10);

// ---- Export ------------------------------------------------------------------------------

export interface TeamExportContext {
    instituteId: string | undefined;
    tab: 'members' | 'invites';
    roleOptions: TeamRoleOption[];
    includePasswords: boolean;
    defaultCountry?: string;
    /** Sub-org names per member (individual links + role grants), already resolved by the page. */
    subOrgsOf?: (member: TeamMember) => string[];
}

export function buildTeamExportCsv(members: TeamMember[], ctx: TeamExportContext): string {
    const labelOf = (name: string) => ctx.roleOptions.find((o) => o.name === name)?.label ?? name;
    const fields = [
        'Name',
        'Email',
        'Username',
        ...(ctx.includePasswords ? ['Password'] : []),
        'Mobile number',
        ctx.tab === 'invites' ? 'Invited as' : 'Roles',
        ...(ctx.tab === 'members' && ctx.subOrgsOf ? ['Sub-orgs'] : []),
        'Designation',
        'Status',
    ];
    const data = members.map((member) => {
        const roles = instituteRolesOf(member, ctx.instituteId).map((role) =>
            labelOf(role.role_name)
        );
        const status =
            ctx.tab === 'invites'
                ? 'Invite pending'
                : memberStatusOf(member, ctx.instituteId) === 'ACTIVE'
                  ? 'Active'
                  : 'Disabled';
        return [
            member.full_name ?? '',
            member.email ?? '',
            member.username ?? '',
            ...(ctx.includePasswords ? [member.password ?? ''] : []),
            formatPhoneForDisplay(member.mobile_number, ctx.defaultCountry) ?? '',
            roles.join(' | '),
            ...(ctx.tab === 'members' && ctx.subOrgsOf ? [ctx.subOrgsOf(member).join(' | ')] : []),
            member.author_subtitle ?? '',
            status,
        ];
    });
    return Papa.unparse({ fields, data });
}

export const teamExportFileName = (tab: 'members' | 'invites') =>
    `team-${tab === 'invites' ? 'invites' : 'members'}-${today()}.csv`;

// ---- Import template + reference ---------------------------------------------------------

export function downloadTeamImportTemplate(roleOptions: TeamRoleOption[]) {
    const builtIn = roleOptions.filter((o) => !o.custom);
    const first = builtIn[0]?.label ?? 'Admin';
    const pair =
        builtIn
            .slice(0, 2)
            .map((o) => o.label)
            .join(' | ') || first;
    const csv = Papa.unparse({
        fields: [...TEAM_IMPORT_HEADERS],
        data: [
            ['Priya Sharma', 'priya.sharma@example.com', '+91 98765 43210', first],
            ['Rahul Verma', 'rahul.verma@example.com', '', pair],
        ],
    });
    triggerCsvDownload(csv, 'team-invite-template.csv');
}

export function downloadRoleReference(roleOptions: TeamRoleOption[]) {
    const csv = Papa.unparse({
        fields: ['role (write this in the roles column)', 'type'],
        data: roleOptions.map((o) => [o.label, o.custom ? 'Custom role' : 'Built-in role']),
    });
    triggerCsvDownload(csv, 'team-role-reference.csv');
}

// ---- Import parsing ----------------------------------------------------------------------

export interface TeamImportRow {
    /** 1-based data row number in the file (header excluded), for messages and the report. */
    rowNumber: number;
    name: string;
    email: string;
    /** Widget-style digits with the dial code, or '' when none was given. */
    mobile: string;
    /** Backend role names. */
    roles: string[];
}

export interface TeamImportRowError {
    /** 0 = a problem with the file itself. */
    rowNumber: number;
    label?: string;
    messages: string[];
}

export interface TeamImportParseResult {
    validRows: TeamImportRow[];
    errors: TeamImportRowError[];
    totalCount: number;
}

const normaliseKey = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Parse a bulk-invite CSV. Every row is validated up front — required fields, email format,
 * duplicates in the file, people already on the team, phone number, and that each role is
 * one this institute actually has — so nothing is sent until the admin has seen what will
 * happen. Bad rows are reported and skipped; the good ones can still go.
 */
export function parseTeamImportCsv(
    file: File,
    opts: {
        roleOptions: TeamRoleOption[];
        /** Lower-cased emails already on the team (members + pending invites). */
        existingEmails: Set<string>;
        defaultCountry?: string;
    },
    t: TFunction
): Promise<TeamImportParseResult> {
    const roleByKey = new Map<string, TeamRoleOption>();
    opts.roleOptions.forEach((option) => {
        roleByKey.set(normaliseKey(option.name), option);
        roleByKey.set(normaliseKey(option.label), option);
    });

    return new Promise((resolve) => {
        Papa.parse<Record<string, unknown>>(file, {
            header: true,
            skipEmptyLines: 'greedy',
            transformHeader: (header) => header.trim().toLowerCase().replace(/\s+/g, '_'),
            complete: (results) => {
                const fields = results.meta.fields ?? [];
                const missing = REQUIRED_HEADERS.filter((h) => !fields.includes(h));
                if (missing.length > 0) {
                    resolve({
                        validRows: [],
                        totalCount: results.data.length,
                        errors: [
                            {
                                rowNumber: 0,
                                messages: [
                                    t('import.errors.missingColumns', {
                                        columns: missing.join(', '),
                                    }),
                                ],
                            },
                        ],
                    });
                    return;
                }
                if (results.data.length > MAX_IMPORT_ROWS) {
                    resolve({
                        validRows: [],
                        totalCount: results.data.length,
                        errors: [
                            {
                                rowNumber: 0,
                                messages: [
                                    t('import.errors.tooManyRows', { max: MAX_IMPORT_ROWS }),
                                ],
                            },
                        ],
                    });
                    return;
                }

                const cell = (row: Record<string, unknown>, key: string) =>
                    String(row[key] ?? '').trim();
                const seenInFile = new Set<string>();
                const validRows: TeamImportRow[] = [];
                const errors: TeamImportRowError[] = [];

                results.data.forEach((raw, index) => {
                    const rowNumber = index + 1;
                    const messages: string[] = [];
                    const name = cell(raw, 'full_name');
                    const email = cell(raw, 'email').toLowerCase();
                    const phoneRaw = cell(raw, 'mobile_number');
                    const rolesRaw = cell(raw, 'roles');

                    if (!name) messages.push(t('import.errors.nameRequired'));
                    if (!email) messages.push(t('import.errors.emailRequired'));
                    else if (!EMAIL_PATTERN.test(email))
                        messages.push(t('import.errors.emailInvalid'));
                    else if (opts.existingEmails.has(email))
                        messages.push(t('import.errors.alreadyOnTeam'));
                    else if (seenInFile.has(email))
                        messages.push(t('import.errors.duplicateInFile'));

                    let mobile = '';
                    if (phoneRaw) {
                        mobile = toPhoneInputValue(phoneRaw, opts.defaultCountry);
                        if (isBlankPhone(mobile) || !isValidPhoneValue(mobile)) {
                            messages.push(t('import.errors.phoneInvalid', { value: phoneRaw }));
                        }
                    }

                    const roleNames: string[] = [];
                    const unknownRoles: string[] = [];
                    rolesRaw
                        .split(/[|;,]/)
                        .map((part) => part.trim())
                        .filter(Boolean)
                        .forEach((part) => {
                            const option = roleByKey.get(normaliseKey(part));
                            if (!option) unknownRoles.push(part);
                            else if (!roleNames.includes(option.name)) roleNames.push(option.name);
                        });
                    if (unknownRoles.length > 0)
                        messages.push(
                            t('import.errors.unknownRoles', { roles: unknownRoles.join(', ') })
                        );
                    else if (roleNames.length === 0) messages.push(t('import.errors.roleRequired'));

                    if (email) seenInFile.add(email);
                    if (messages.length > 0) {
                        errors.push({ rowNumber, label: name || email || undefined, messages });
                        return;
                    }
                    validRows.push({ rowNumber, name, email, mobile, roles: roleNames });
                });

                resolve({ validRows, errors, totalCount: results.data.length });
            },
            error: (error) =>
                resolve({
                    validRows: [],
                    totalCount: 0,
                    errors: [{ rowNumber: 0, messages: [error.message] }],
                }),
        });
    });
}

// ---- Results report ----------------------------------------------------------------------

export interface TeamImportResult {
    row: TeamImportRow;
    success: boolean;
    username?: string;
    password?: string;
    error?: string;
}

export function downloadTeamImportResults(
    results: TeamImportResult[],
    roleOptions: TeamRoleOption[]
) {
    const labelOf = (name: string) => roleOptions.find((o) => o.name === name)?.label ?? name;
    const csv = Papa.unparse({
        fields: ['row', 'full_name', 'email', 'roles', 'result', 'username', 'password', 'remarks'],
        data: results.map((r) => [
            r.row.rowNumber,
            r.row.name,
            r.row.email,
            r.row.roles.map(labelOf).join(' | '),
            r.success ? 'Invited' : 'Failed',
            r.username ?? '',
            r.password ?? '',
            r.success ? '' : r.error ?? '',
        ]),
    });
    triggerCsvDownload(csv, `team-invite-results-${today()}.csv`);
}
