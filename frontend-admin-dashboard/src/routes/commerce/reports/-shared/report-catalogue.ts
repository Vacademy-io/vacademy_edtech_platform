import {
    type CommerceAccess,
    COMMERCE_FEATURE,
    COMMERCE_ROLE,
    type CommerceFeatureKey,
    type CommerceRoleName,
} from '@/lib/commerce/commerce-access';
import type { ReportFormat } from './report-types';

/**
 * The reports the shop offers (WP-50 contract §2, WP-51 §7.2), one entry per
 * card on the reports home. Each entry says which endpoint answers it, which
 * feature and roles open it (contract §3.5), the filters its page shows, the
 * default range, whether it pages (registers) or answers whole (summaries),
 * and the file formats it downloads in. WP-67 adds the accounts reports here.
 *
 * Words on screen live under `reports.catalogue.<id>.title` / `.help`.
 */

export const REPORT_IDS = [
    'salesRegister',
    'gstr1',
    'hsnSummary',
    'creditNotes',
    'documentsIssued',
    'taxByRate',
    'gstPack',
    'sales',
    'products',
    'paymentModes',
    'codOutstanding',
    'customerDues',
    'dayBook',
    'posSessions',
    'audit',
] as const;
export type ReportId = (typeof REPORT_IDS)[number];

export const REPORT_GROUPS = ['gst', 'sales', 'money', 'counter', 'audit'] as const;
export type ReportGroup = (typeof REPORT_GROUPS)[number];

/** Filters a report page can show (contract §7.2 `ReportFilters`). */
export type ReportFilterKey = 'range' | 'month' | 'location' | 'channel' | 'gstin' | 'groupBy' | 'asOf';

/** How the page draws the answer. */
export type ReportView = 'table' | 'gstr1' | 'documents' | 'dayBook' | 'file' | 'link';

export const REPORT_CHANNELS = ['ONLINE', 'ADMIN', 'POS'] as const;
export const SALES_GROUP_BY = ['day', 'month', 'channel', 'location', 'staff', 'payment_method'] as const;
export const PRODUCT_GROUP_BY = ['variant', 'product', 'collection', 'category'] as const;

export interface ReportEntry {
    id: ReportId;
    /** `GET /commerce/v1/reports/{api}`; null for the audit log (its own route). */
    api: string | null;
    group: ReportGroup;
    /** ANY of these features opens it (contract §3.5). */
    anyFeature: readonly CommerceFeatureKey[];
    filters: readonly ReportFilterKey[];
    /** Range used when the address has none: this month, today, or no range (as of now). */
    defaultRange: 'month' | 'today' | 'none';
    /** Registers page by keyset (`next_cursor`); summaries answer every row. */
    kind: 'register' | 'summary' | 'file';
    formats: readonly ReportFormat[];
    view: ReportView;
    groupBy?: readonly string[];
    /** The longest range the server takes (contract §3.1). */
    maxDays: number;
}

/** Who reads reports (institute ADMIN always): contract §3.5. */
export const REPORT_ROLES: readonly CommerceRoleName[] = [COMMERCE_ROLE.STORE_MANAGER, COMMERCE_ROLE.ACCOUNTANT];

const TAX = [COMMERCE_FEATURE.TAX_REPORTS] as const;
const ORDERS = [COMMERCE_FEATURE.ORDERS] as const;
const BOTH = [COMMERCE_FEATURE.TAX_REPORTS, COMMERCE_FEATURE.ORDERS] as const;
const FILES: readonly ReportFormat[] = ['csv', 'xlsx'];
const YEAR = 366;

export const REPORT_CATALOGUE: readonly ReportEntry[] = [
    // GST pack (commerce.tax_reports; the GST reports cover the whole GSTIN).
    {
        id: 'salesRegister',
        api: 'sales-register',
        group: 'gst',
        anyFeature: TAX,
        filters: ['range', 'location', 'channel', 'gstin'],
        defaultRange: 'month',
        kind: 'register',
        formats: FILES,
        view: 'table',
        maxDays: YEAR,
    },
    {
        id: 'gstr1',
        api: 'gstr1',
        group: 'gst',
        anyFeature: TAX,
        filters: ['month', 'gstin'],
        defaultRange: 'month',
        kind: 'summary',
        // One answer holds every sheet: a CSV cannot carry them, the workbook can.
        formats: ['xlsx'],
        view: 'gstr1',
        maxDays: YEAR,
    },
    {
        id: 'hsnSummary',
        api: 'hsn-summary',
        group: 'gst',
        anyFeature: TAX,
        filters: ['range', 'gstin'],
        defaultRange: 'month',
        kind: 'summary',
        formats: FILES,
        view: 'table',
        maxDays: YEAR,
    },
    {
        id: 'creditNotes',
        api: 'credit-notes',
        group: 'gst',
        anyFeature: TAX,
        filters: ['range', 'location', 'channel', 'gstin'],
        defaultRange: 'month',
        kind: 'register',
        formats: FILES,
        view: 'table',
        maxDays: YEAR,
    },
    {
        id: 'documentsIssued',
        api: 'documents-issued',
        group: 'gst',
        anyFeature: TAX,
        filters: ['range', 'location', 'gstin'],
        defaultRange: 'month',
        kind: 'summary',
        formats: FILES,
        view: 'documents',
        maxDays: YEAR,
    },
    {
        id: 'taxByRate',
        api: 'tax-by-rate',
        group: 'gst',
        anyFeature: TAX,
        filters: ['range', 'location', 'channel', 'gstin'],
        defaultRange: 'month',
        kind: 'summary',
        formats: FILES,
        view: 'table',
        maxDays: YEAR,
    },
    {
        id: 'gstPack',
        api: 'gst-pack',
        group: 'gst',
        anyFeature: TAX,
        filters: ['month', 'gstin'],
        defaultRange: 'month',
        kind: 'file',
        formats: ['xlsx'],
        view: 'file',
        maxDays: YEAR,
    },
    // Sales (commerce.orders).
    {
        id: 'sales',
        api: 'sales',
        group: 'sales',
        anyFeature: ORDERS,
        filters: ['range', 'location', 'channel', 'groupBy'],
        defaultRange: 'month',
        kind: 'summary',
        formats: FILES,
        view: 'table',
        groupBy: SALES_GROUP_BY,
        maxDays: YEAR,
    },
    {
        id: 'products',
        api: 'products',
        group: 'sales',
        anyFeature: ORDERS,
        filters: ['range', 'location', 'channel', 'groupBy'],
        defaultRange: 'month',
        kind: 'register',
        formats: FILES,
        view: 'table',
        groupBy: PRODUCT_GROUP_BY,
        maxDays: YEAR,
    },
    // Money (commerce.orders).
    {
        id: 'paymentModes',
        api: 'payment-modes',
        group: 'money',
        anyFeature: ORDERS,
        filters: ['range', 'location'],
        defaultRange: 'month',
        kind: 'summary',
        formats: FILES,
        view: 'table',
        maxDays: YEAR,
    },
    {
        id: 'codOutstanding',
        api: 'cod-outstanding',
        group: 'money',
        anyFeature: ORDERS,
        filters: ['asOf', 'range', 'location'],
        defaultRange: 'month',
        kind: 'register',
        formats: FILES,
        view: 'table',
        maxDays: YEAR,
    },
    {
        id: 'customerDues',
        api: 'customer-dues',
        group: 'money',
        anyFeature: ORDERS,
        filters: ['location'],
        defaultRange: 'none',
        kind: 'register',
        formats: FILES,
        view: 'table',
        maxDays: YEAR,
    },
    // Counter and day (commerce.tax_reports).
    {
        id: 'dayBook',
        api: 'day-book',
        group: 'counter',
        anyFeature: TAX,
        filters: ['range', 'location'],
        defaultRange: 'today',
        kind: 'register',
        formats: FILES,
        view: 'dayBook',
        maxDays: 31,
    },
    {
        id: 'posSessions',
        api: 'pos-sessions',
        group: 'counter',
        anyFeature: TAX,
        filters: ['range', 'location'],
        defaultRange: 'month',
        kind: 'register',
        formats: FILES,
        view: 'table',
        maxDays: YEAR,
    },
    // Audit log (either feature; its own route).
    {
        id: 'audit',
        api: null,
        group: 'audit',
        anyFeature: BOTH,
        filters: [],
        defaultRange: 'month',
        kind: 'register',
        formats: ['csv'],
        view: 'link',
        maxDays: YEAR,
    },
];

const BY_ID = new Map<string, ReportEntry>(REPORT_CATALOGUE.map((entry) => [entry.id, entry]));

export const reportEntry = (id: string | null | undefined): ReportEntry | undefined =>
    id ? BY_ID.get(id) : undefined;

export const reportTitleKey = (id: ReportId) => `reports.catalogue.${id}.title`;
export const reportHelpKey = (id: ReportId) => `reports.catalogue.${id}.help`;

/** The person may open this report: one of its features is on and the role reads reports. */
export function canSeeReport(entry: ReportEntry, access: Pick<CommerceAccess, 'isFeatureOn' | 'hasAnyRole'>): boolean {
    return access.hasAnyRole(REPORT_ROLES) && entry.anyFeature.some((feature) => access.isFeatureOn(feature));
}

/** The cards of the reports home for this person, grouped in screen order; empty groups left out. */
export function visibleReportGroups(
    access: Pick<CommerceAccess, 'isFeatureOn' | 'hasAnyRole'>
): { group: ReportGroup; entries: ReportEntry[] }[] {
    return REPORT_GROUPS.map((group) => ({
        group,
        entries: REPORT_CATALOGUE.filter((entry) => entry.group === group && canSeeReport(entry, access)),
    })).filter((block) => block.entries.length > 0);
}

/**
 * Section keys the screens have their own words for (`reports.sections.<key>`).
 * Assumed names of the blocks of §2 (the backend is built in parallel); a
 * section with another key shows the server's title, else its key.
 */
export const REPORT_SECTION_KEYS = [
    // GSTR-1 sheets (§2.5) and the B2C small sub-block.
    'b2b',
    'b2cl',
    'b2cs',
    'b2cs_credit_notes',
    'cdnr',
    'cdnur',
    'exemp',
    'hsn_b2b',
    'hsn_b2c',
    'docs',
    // HSN summary (§2.4).
    'b2c',
    'round_off',
    // Tax by rate (§2.3).
    'invoices',
    'credit_notes',
    'net',
    // Documents issued (§2.6).
    'system',
    'bill_books',
    'other_period',
    // Day book (§2.7).
    'documents',
    'money',
    'by_mode',
    'sessions',
    // Payment modes (§2.8).
    'paid_not_invoiced',
    // COD outstanding (§2.9).
    'outstanding',
    'in_transit',
    'remittances',
    'rto',
    // POS sessions (§2.11) and products (§2.13).
    'open_sessions',
    'never_sold',
] as const;

const KNOWN_SECTIONS = new Set<string>(REPORT_SECTION_KEYS);

export const isKnownSection = (key: string): boolean => KNOWN_SECTIONS.has(key);
