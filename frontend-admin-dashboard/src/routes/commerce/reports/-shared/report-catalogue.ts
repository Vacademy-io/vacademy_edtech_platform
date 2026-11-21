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
export type ReportFilterKey =
    | 'range'
    | 'month'
    | 'location'
    | 'channel'
    | 'gstin'
    | 'groupBy'
    | 'asOf'
    | 'status'
    | 'b2clLimit';

/** How the page draws the answer. */
export type ReportView = 'table' | 'gstr1' | 'documents' | 'dayBook' | 'file' | 'link';

export const REPORT_CHANNELS = ['ONLINE', 'ADMIN', 'POS'] as const;
/** Sales register `status` filter (contract §2.1; absent = all bills). */
export const REPORT_STATUSES = ['ACTIVE', 'CANCELLED'] as const;
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
    /**
     * Registers page by keyset (`next_cursor`): sales register, credit notes, customer dues, POS
     * sessions. Summaries answer in one go (the server cuts a block at 5,000 rows with `ROWS_CUT`).
     */
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
        filters: ['range', 'location', 'channel', 'gstin', 'status'],
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
        filters: ['month', 'gstin', 'b2clLimit'],
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
        filters: ['month', 'gstin', 'b2clLimit'],
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
        kind: 'summary', // not paged by the server (B2): at most 5,000 rows per block on screen, ROWS_CUT beyond
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
        kind: 'summary', // not paged by the server (B2): at most 5,000 rows per block on screen, ROWS_CUT beyond
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
        kind: 'summary', // not paged by the server (B2): at most 5,000 rows per block on screen, ROWS_CUT beyond
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

/**
 * The GST reports cover the whole GSTIN: the server opens them only to ADMIN
 * and to staff assigned to every place (contract §3.5), with the tax reports
 * feature on. The places answer (R9) says so in `gst_reports`, which wins when
 * sent; else `all_places` decides for a non-admin. null = not known, the cards
 * stay and the server still refuses.
 */
export function gstClosedToPlaces(
    access: Pick<CommerceAccess, 'isAdmin'>,
    allPlaces: boolean | null | undefined,
    gstReports: boolean | null | undefined = null
): boolean {
    if (typeof gstReports === 'boolean') return !gstReports;
    return !access.isAdmin && allPlaces === false;
}

/**
 * The cards of the reports home for this person, grouped in screen order; empty
 * groups left out. The GST group is left out for a reader limited to some
 * places (M6): every card would only answer "no access at this location".
 */
export function visibleReportGroups(
    access: Pick<CommerceAccess, 'isFeatureOn' | 'hasAnyRole'> & Partial<Pick<CommerceAccess, 'isAdmin'>>,
    allPlaces: boolean | null = null,
    gstReports: boolean | null = null
): { group: ReportGroup; entries: ReportEntry[] }[] {
    const gstClosed = gstClosedToPlaces({ isAdmin: !!access.isAdmin }, allPlaces, gstReports);
    return REPORT_GROUPS.map((group) => ({
        group,
        entries: REPORT_CATALOGUE.filter(
            (entry) => entry.group === group && canSeeReport(entry, access) && !(gstClosed && entry.group === 'gst')
        ),
    })).filter((block) => block.entries.length > 0);
}

/** True when the person's features and role would show the GST group (to explain why it is not there). */
export const wouldSeeGst = (access: Pick<CommerceAccess, 'isFeatureOn' | 'hasAnyRole'>): boolean =>
    REPORT_CATALOGUE.some((entry) => entry.group === 'gst' && canSeeReport(entry, access));
