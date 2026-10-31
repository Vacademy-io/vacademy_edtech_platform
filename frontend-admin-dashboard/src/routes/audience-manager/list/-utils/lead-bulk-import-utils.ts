/**
 * Utilities for bulk CSV lead import.
 */

import type { TFunction } from 'i18next';

/** This file's own i18n namespace — passed explicitly via `{ ns: NAMESPACE }` so
 *  callers whose bound `t` defaults to a different namespace (e.g. the dialog
 *  that consumes these helpers) still resolve these keys correctly. Callers
 *  must include this namespace in their own `useTranslation([...])` array (or
 *  bind a separate `t` to it) so it's loaded before this runs. */
const NAMESPACE = 'audienceManagerLeadBulkImportUtils';

export interface CustomFieldConfig {
    id: string;
    fieldName: string;
    fieldKey: string;
    fieldType: string;
    isMandatory: boolean;
    defaultValue?: string;
    formOrder: number;
}

/**
 * Parse the custom fields JSON string passed via search params into a typed array.
 */
export function parseCustomFieldsFromJson(json: string | undefined): CustomFieldConfig[] {
    if (!json) return [];
    try {
        const parsed = JSON.parse(json);
        if (!Array.isArray(parsed)) return [];

        return parsed
            .map((field: any) => {
                const cf = field.custom_field || field;
                return {
                    id: cf.id || field.id,
                    fieldName: cf.fieldName || cf.field_name || field.field_name || '',
                    fieldKey: cf.fieldKey || cf.field_key || field.field_key || '',
                    fieldType: cf.fieldType || cf.field_type || field.field_type || 'TEXT',
                    isMandatory: cf.isMandatory ?? field.isMandatory ?? true,
                    defaultValue: cf.defaultValue || field.defaultValue || '',
                    formOrder: cf.formOrder || field.formOrder || 0,
                } as CustomFieldConfig;
            })
            .filter((f: CustomFieldConfig) => f.id && f.fieldName)
            .sort((a: CustomFieldConfig, b: CustomFieldConfig) => a.formOrder - b.formOrder);
    } catch {
        return [];
    }
}

/**
 * Optional, well-known column headers the importer understands in addition to the
 * campaign's custom fields. They are resolved against the institute's users / lead-status
 * catalog rather than stored as custom field values.
 */
export const LEAD_OWNER_COLUMN = 'Lead Owner (Counsellor Email)';
export const LEAD_STATUS_COLUMN = 'Lead Status';

/**
 * Generate a CSV template string with headers from the campaign's custom fields,
 * plus the optional Lead Owner + Lead Status columns the importer can resolve.
 * `statusSample` is the institute's default status label (shown in the sample row).
 *
 * `t` localizes the two well-known column headers and the sample-row filler text
 * that ends up in the downloaded CSV. Email/phone sample values are left as
 * plain format examples (not language-bound copy), matching the placeholder
 * convention used elsewhere in the app.
 */
export function generateCsvTemplate(
    customFields: CustomFieldConfig[],
    t: TFunction,
    options?: { statusSample?: string }
): string {
    const leadOwnerColumn = t('csvTemplate.leadOwnerColumn', { ns: NAMESPACE });
    const leadStatusColumn = t('csvTemplate.leadStatusColumn', { ns: NAMESPACE });
    const headers = [...customFields.map((f) => f.fieldName), leadOwnerColumn, leadStatusColumn];
    const sampleRow = [
        ...customFields.map((f) => {
            const key = f.fieldKey.toLowerCase();
            const name = f.fieldName.toLowerCase();
            const isEmail = key.includes('email') || name.includes('email');
            const isPhone =
                key.includes('phone') ||
                key.includes('mobile') ||
                name.includes('phone') ||
                name.includes('mobile');
            if (isEmail) return 'john@example.com';
            if (isPhone) return '+919876543210';
            if (!isEmail && !isPhone && (key.includes('name') || name.includes('name')))
                return t('csvTemplate.sampleName', { ns: NAMESPACE });
            return '';
        }),
        'counsellor@example.com',
        options?.statusSample || t('csvTemplate.sampleStatus', { ns: NAMESPACE }),
    ];

    const escape = (v: string) => {
        if (v.includes(',') || v.includes('"') || v.includes('\n')) {
            return `"${v.replace(/"/g, '""')}"`;
        }
        return v;
    };

    return [headers.map(escape).join(','), sampleRow.map(escape).join(',')].join('\n');
}

const normalizeHeader = (s: string) =>
    s
        .trim()
        .toLowerCase()
        .replace(/[\s_()-]+/g, '');

// Header aliases for the two special columns. Matched case/space/punctuation-insensitively
// so admins can label the columns naturally ("Counsellor", "Lead Owner Email", "Status", …).
const OWNER_HEADER_ALIASES = new Set(
    [
        'leadowner',
        'leadownercounselloremail',
        'leadownercounseloremail',
        'owner',
        'counsellor',
        'counselor',
        'counsellorname',
        'counselorname',
        'counselloremail',
        'counseloremail',
    ].map((s) => s.replace(/[\s_()-]+/g, ''))
);
const STATUS_HEADER_ALIASES = new Set(['leadstatus', 'status'].map((s) => s.replace(/[\s_()-]+/g, '')));

/** Find the CSV header that holds the lead owner, if present. */
export function detectOwnerHeader(headers: string[]): string | null {
    return headers.find((h) => OWNER_HEADER_ALIASES.has(normalizeHeader(h))) ?? null;
}

/** Find the CSV header that holds the lead status, if present. */
export function detectStatusHeader(headers: string[]): string | null {
    return headers.find((h) => STATUS_HEADER_ALIASES.has(normalizeHeader(h))) ?? null;
}

// ─── Owner (counsellor) resolution ──────────────────────────────────────────

export interface CounsellorOption {
    id: string;
    full_name: string;
    email?: string;
}

export interface CounsellorResolver {
    byEmail: Map<string, CounsellorOption>;
    byName: Map<string, CounsellorOption>;
    /** Lowercased names shared by more than one counsellor — can't be resolved by name. */
    ambiguousNames: Set<string>;
    hasAny: boolean;
}

export function buildCounsellorResolver(users: CounsellorOption[]): CounsellorResolver {
    const byEmail = new Map<string, CounsellorOption>();
    const byName = new Map<string, CounsellorOption>();
    const ambiguousNames = new Set<string>();

    for (const u of users) {
        if (!u.id) continue;
        if (u.email) byEmail.set(u.email.trim().toLowerCase(), u);
        const nameKey = (u.full_name || '').trim().toLowerCase();
        if (!nameKey) continue;
        if (byName.has(nameKey)) {
            ambiguousNames.add(nameKey);
        } else {
            byName.set(nameKey, u);
        }
    }

    return { byEmail, byName, ambiguousNames, hasAny: users.length > 0 };
}

export interface OwnerResolution {
    counsellorId?: string;
    counsellorName?: string;
    error?: string;
}

/**
 * Resolve a CSV owner cell (email or name) to a counsellor. Owner is optional — a blank
 * cell resolves to nothing without error. Emails resolve exactly; names resolve only when
 * unambiguous within the institute.
 */
export function resolveOwner(value: string, resolver: CounsellorResolver, t: TFunction): OwnerResolution {
    const raw = (value || '').trim();
    if (!raw) return {};

    if (raw.includes('@')) {
        const match = resolver.byEmail.get(raw.toLowerCase());
        if (match) return { counsellorId: match.id, counsellorName: match.full_name };
        return { error: t('errors.unknownCounsellorEmail', { ns: NAMESPACE, email: raw }) };
    }

    const nameKey = raw.toLowerCase();
    if (resolver.ambiguousNames.has(nameKey)) {
        return { error: t('errors.ambiguousCounsellorName', { ns: NAMESPACE, name: raw }) };
    }
    const match = resolver.byName.get(nameKey);
    if (match) return { counsellorId: match.id, counsellorName: match.full_name };
    return { error: t('errors.unknownCounsellor', { ns: NAMESPACE, name: raw }) };
}

// ─── Lead status resolution ─────────────────────────────────────────────────

export interface LeadStatusOption {
    id: string;
    status_key: string;
    label: string;
    is_default?: boolean;
}

export interface StatusResolver {
    byKey: Map<string, LeadStatusOption>;
    byLabel: Map<string, LeadStatusOption>;
    /** status_key of the institute default, applied to blank cells. */
    defaultKey: string | null;
    hasAny: boolean;
    /** Human-readable list of valid statuses, for error messages. */
    validLabels: string[];
}

export function buildStatusResolver(statuses: LeadStatusOption[]): StatusResolver {
    const byKey = new Map<string, LeadStatusOption>();
    const byLabel = new Map<string, LeadStatusOption>();
    let defaultKey: string | null = null;

    for (const s of statuses) {
        if (s.status_key) byKey.set(s.status_key.trim().toLowerCase(), s);
        if (s.label) byLabel.set(s.label.trim().toLowerCase(), s);
        if (s.is_default && !defaultKey) defaultKey = s.status_key;
    }

    return {
        byKey,
        byLabel,
        defaultKey,
        hasAny: statuses.length > 0,
        validLabels: statuses.map((s) => s.label).filter(Boolean),
    };
}

export interface StatusResolution {
    leadStatusKey?: string;
    error?: string;
}

/**
 * Resolve a CSV status cell (label or key) to a status_key. A blank cell falls back to the
 * institute default (so it shows as "New" rather than blank). An unrecognised value errors.
 */
export function resolveStatus(value: string, resolver: StatusResolver, t: TFunction): StatusResolution {
    const raw = (value || '').trim();
    if (!raw) {
        return resolver.defaultKey ? { leadStatusKey: resolver.defaultKey } : {};
    }

    const key = raw.toLowerCase();
    const match = resolver.byLabel.get(key) ?? resolver.byKey.get(key);
    if (match) return { leadStatusKey: match.status_key };

    const base = t('errors.unknownLeadStatus', { ns: NAMESPACE, status: raw });
    const valid = resolver.validLabels.length
        ? ' ' + t('errors.validStatuses', { ns: NAMESPACE, statuses: resolver.validLabels.join(', ') })
        : '';
    return { error: base + valid };
}

/**
 * Build a map from CSV column header (normalized) to custom field ID.
 * Matching is case-insensitive, whitespace-trimmed, with underscore normalization.
 */
export function buildHeaderToFieldIdMap(
    csvHeaders: string[],
    customFields: CustomFieldConfig[]
): Map<string, string> {
    const normalize = (s: string) =>
        s
            .trim()
            .toLowerCase()
            .replace(/[\s_-]+/g, '');

    const map = new Map<string, string>();

    for (const header of csvHeaders) {
        const normalizedHeader = normalize(header);
        // Try exact match on fieldName, then fieldKey
        const match = customFields.find(
            (f) => normalize(f.fieldName) === normalizedHeader || normalize(f.fieldKey) === normalizedHeader
        );
        if (match) {
            map.set(header, match.id);
        }
    }

    return map;
}

/**
 * Extract email, phone, and full name from a CSV row using the header-to-fieldId map.
 */
export function extractUserInfoFromRow(
    row: Record<string, string>,
    headerToFieldId: Map<string, string>,
    customFields: CustomFieldConfig[]
): { email: string; phone: string; fullName: string } {
    let email = '';
    let phone = '';
    let fullName = '';

    const fieldIdToConfig = new Map(customFields.map((f) => [f.id, f]));

    for (const [header, fieldId] of headerToFieldId) {
        const config = fieldIdToConfig.get(fieldId);
        if (!config) continue;

        const value = (row[header] || '').trim();
        if (!value) continue;

        const key = config.fieldKey.toLowerCase();
        const name = config.fieldName.toLowerCase();

        if (!email && (key.includes('email') || name.includes('email'))) {
            email = value;
        }
        if (
            !phone &&
            (key.includes('phone') || key.includes('mobile') || name.includes('phone') || name.includes('mobile'))
        ) {
            phone = normalizeMobile(value);
        }
        const isEmailField = key.includes('email') || name.includes('email');
        const isPhoneField =
            key.includes('phone') || key.includes('mobile') || name.includes('phone') || name.includes('mobile');
        if (
            !fullName &&
            !isEmailField &&
            !isPhoneField &&
            (key.includes('full_name') ||
                key.includes('fullname') ||
                name.includes('full name') ||
                name.includes('name'))
        ) {
            fullName = value;
        }
    }

    return { email, phone, fullName };
}

/**
 * Validate a single CSV row. Returns array of error messages (empty = valid).
 */
export function validateRow(
    row: Record<string, string>,
    headerToFieldId: Map<string, string>,
    customFields: CustomFieldConfig[],
    t: TFunction
): string[] {
    const errors: string[] = [];
    const fieldIdToConfig = new Map(customFields.map((f) => [f.id, f]));

    // Check mandatory fields have values
    for (const [header, fieldId] of headerToFieldId) {
        const config = fieldIdToConfig.get(fieldId);
        if (!config) continue;

        const value = (row[header] || '').trim();
        if (config.isMandatory && !value) {
            errors.push(t('errors.fieldRequired', { ns: NAMESPACE, field: config.fieldName }));
        }
    }

    // Validate email format if present
    for (const [header, fieldId] of headerToFieldId) {
        const config = fieldIdToConfig.get(fieldId);
        if (!config) continue;
        const key = config.fieldKey.toLowerCase();
        const name = config.fieldName.toLowerCase();
        const value = (row[header] || '').trim();

        if (value && (key.includes('email') || name.includes('email'))) {
            if (!isValidEmail(value)) {
                errors.push(t('errors.invalidEmail', { ns: NAMESPACE, email: value }));
            }
        }
        if (
            value &&
            (key.includes('phone') || key.includes('mobile') || name.includes('phone') || name.includes('mobile'))
        ) {
            if (!isValidMobile(normalizeMobile(value))) {
                errors.push(t('errors.invalidMobile', { ns: NAMESPACE, mobile: value }));
            }
        }
    }

    return errors;
}

export function isValidEmail(v: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export function isValidMobile(v: string): boolean {
    return /^\+?[0-9]{7,15}$/.test(v.replace(/[\s-]/g, ''));
}

/**
 * Clean a phone cell before it is validated or stored.
 *
 * A phone column that has passed through Excel / pandas as a NUMBER exports as
 * "9425677707.0". On 2026-09-11 a list uploaded that way put 43 such numbers into
 * lead profiles; at dial time the backend stripped the "." and sent Plivo
 * "+94256777070" — a Sri Lankan number — and every call failed. The trailing
 * ".0" is dropped here (no real phone number ends in ".0"); a genuine decimal or
 * scientific notation ("9.43E+09", digits already lost) is left alone so
 * isValidMobile rejects it and the row shows up in the invalid-rows report.
 */
export function normalizeMobile(v: string): string {
    return v
        .trim()
        .replace(/\.0+$/, '')
        .replace(/[\s\-()]/g, '');
}

/**
 * Check which mandatory columns are missing from the CSV headers.
 */
export function getMissingMandatoryColumns(
    headerToFieldId: Map<string, string>,
    customFields: CustomFieldConfig[]
): string[] {
    const mappedFieldIds = new Set(headerToFieldId.values());
    return customFields
        .filter((f) => f.isMandatory && !mappedFieldIds.has(f.id))
        .map((f) => f.fieldName);
}
