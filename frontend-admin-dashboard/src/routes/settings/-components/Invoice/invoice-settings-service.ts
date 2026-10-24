import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import {
    GET_INSITITUTE_SETTINGS,
    GET_INSTITUTE_USERS,
    GET_INVOICE_NUMBERING_STATE,
    GET_INVOICE_NUMBERING_TOKENS,
    POST_INVOICE_NUMBERING_PREVIEW,
    SAVE_INSTITUTE_SETTING,
} from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { CURRENCIES } from '@/constants/currencies';

// ─── Types ───────────────────────────────────────────────────────────────────

/** A single named tax component, e.g. { label: "CGST", rate: 9 }. */
export interface TaxComponent {
    label: string;
    rate: number;
}

/**
 * The operating country for invoicing: which country, the institute's own tax
 * registration number (GSTIN / VAT no.) and the tax components that apply there.
 * Injected into invoice templates via {{country}}, {{tax_registration_number}}
 * and {{tax_components}}.
 */
export interface InvoiceCountryConfig {
    /** Lowercase ISO 3166-1 alpha-2 code, e.g. "in". */
    code: string;
    /** Human-readable country name, e.g. "India". */
    name: string;
    /** Institute's own tax registration number (GSTIN / VAT no.). */
    taxRegistrationNumber: string;
    /** HSN/SAC code (SAC for services such as courses). Injectable via {{hsn_code}}. */
    hsnSacCode: string;
    /** Default tax components, applied when a package type has no specific override. */
    taxComponents: TaxComponent[];
    /**
     * Per-package-type tax components, keyed by package type (COURSE, PRODUCT,
     * SERVICE, …). At invoice time each line item uses its type's components,
     * falling back to {@link taxComponents}.
     */
    taxComponentsByPackageType: Record<string, TaxComponent[]>;
}

/**
 * Where the generated invoice PDF is delivered after a successful payment.
 * - `INVOICE_EMAIL` (default): PDF goes in the dedicated invoice email; the payment-confirmation
 *   email is sent separately with no PDF (legacy behaviour — two emails).
 * - `PAYMENT_CONFIRMATION_EMAIL`: PDF is attached to the payment-confirmation email and the
 *   separate invoice email is suppressed, so the learner receives a single email.
 */
export type InvoicePdfPlacement = 'INVOICE_EMAIL' | 'PAYMENT_CONFIRMATION_EMAIL';

/** Package types that can have their own tax components (matches backend package_type). */
export const PACKAGE_TYPES = [
    'COURSE',
    'PRODUCT',
    'SERVICE',
    'MEMBERSHIP',
    'DELIVERY_CHARGE',
    'SECURITY_DEPOSIT',
] as const;

/** When the invoice-number counter rolls back to 1. */
export type InvoiceSeqScope = 'NEVER' | 'YEARLY' | 'MONTHLY' | 'DAILY';

/**
 * Admin-configured invoice number strategy. Stored under
 * {@link InvoiceSettingsData.numbering}; the backend reads it as
 * `INVOICE_SETTING.numbering`.
 */
export interface InvoiceNumberingConfig {
    /** Token format, e.g. `{{institute_code}}/{{FY}}/{{seq}}`. Must contain `{{seq}}` once. */
    format: string;
    /** Zero-padding for `{{seq}}` when the token carries no `:N` modifier. */
    seqPadding: number;
    seqScope: InvoiceSeqScope;
    /** Short code for `{{institute_code}}`; blank means "derive from the institute name". */
    instituteCode: string;
    /** First month of the financial year (1-12) for `{{FY}}`/`{{FYY}}`/`{{FQ}}`. 4 = April. */
    fyStartMonth: number;
    /** Uppercase / strip accents / truncate the free-text tokens. */
    sanitizeTokens: boolean;
    /**
     * Floor for the sequence, so an institute migrating from another accounting system can
     * continue its existing series. 0 = no floor. It is a floor, not a hard set: a value at
     * or below what has already been issued is ignored rather than reusing a number.
     */
    startFrom: number;
}

/** Matches the backend legacy default — reproduces the old hardcoded `INV-yyyyMMdd-0001`. */
export const DEFAULT_NUMBERING: InvoiceNumberingConfig = {
    format: 'INV-{{YYYYMMDD}}-{{seq}}',
    seqPadding: 4,
    seqScope: 'DAILY',
    instituteCode: '',
    fyStartMonth: 4,
    sanitizeTokens: true,
    startFrom: 0,
};

/** One entry in the click-to-insert palette, served by `GET /numbering/tokens`. */
export interface InvoiceNumberToken {
    key: string;
    label: string;
    group: 'SEQUENCE' | 'INSTITUTE' | 'LEARNER' | 'DATE' | 'TRANSACTION';
    example: string;
    /** Costs an extra DB read; resolved only when the format uses it. */
    lazy: boolean;
    /** Makes numbering non-sequential — badged in the palette, warned about on save. */
    riskyForTax: boolean;
}

export interface InvoiceNumberPreview {
    valid: boolean;
    samples: string[];
    errors: string[];
    warnings: string[];
    nextSequence: number;
    /** Highest position already issued in this window; a startFrom at or below it is ignored. */
    highestIssuedSequence: number;
    maxLength: number;
}

export interface InvoiceNumberingState {
    currentFormat: string;
    seqScope: InvoiceSeqScope;
    currentExample: string;
    lastIssuedNumber: string | null;
    nextSequence: number;
    existingInvoiceCount: number;
}

export interface InvoiceSettingsData {
    /** Whether listed prices already include tax. */
    taxIncluded: boolean;
    /** Default tax rate as a percentage (e.g. 18 for 18%). */
    taxRate: number;
    /** Label shown for the tax line, e.g. "GST", "VAT". */
    taxLabel: string;
    /** ISO currency code, e.g. "INR". */
    currency: string;
    /** Whether the invoice email is sent to the learner automatically. */
    sendInvoiceEmail: boolean;
    /** Which email carries the invoice PDF after a successful payment. */
    invoicePdfPlacement: InvoicePdfPlacement;
    /**
     * Issue unpaid invoices as PROFORMA documents.
     *
     * When on, an invoice raised before payment is a proforma: it is numbered from a
     * separate `PRO-` series and does NOT consume a number from the real invoice series.
     * The real invoice number is allocated at the moment the invoice is paid, and the PDF
     * is regenerated under it. A proforma that is cancelled or never paid therefore leaves
     * no gap in the numbered tax series.
     */
    proformaEnabled: boolean;
    /**
     * Generate an invoice when an admin enrolls learners manually / in bulk
     * (no payment gateway). Read by BulkAssignmentService.
     */
    generateInvoiceOnManualEnroll: boolean;
    /**
     * When true, the admins in {@link adminCopyUserIds} also receive the
     * invoice / payment-confirmation emails sent on a completed payment.
     * Read by InvoiceAdminCopyRecipientResolver on the backend.
     */
    sendAdminCopy: boolean;
    /** Auth-service user ids of the admins who receive the copy. */
    adminCopyUserIds: string[];
    country: InvoiceCountryConfig;
    /**
     * Invoice number strategy. Editable from the Numbering section; see
     * {@link InvoiceNumberingConfig}.
     */
    numbering: InvoiceNumberingConfig;
    /**
     * Extra receipt series picked by a learner field (e.g. one per branch); a learner no
     * series matches stays on {@link numbering}. Top-level on purpose: {@link numbering} is
     * rebuilt from a fixed key list on load. Read by InvoiceNumberConfig on the backend.
     */
    numberingSeries?: InvoiceNumberingSeries[];
    /** Whether the record-payment dialogs ask for the series field on an enrolment's first payment. */
    numberingSeriesPolicy?: InvoiceNumberingSeriesPolicy;
    /**
     * Institute-level invoice defaults set from the admin Create-Invoice dialog (Review
     * step "Institute" group) — corrected institute name/address/contact and default
     * notes, remembered so future invoices (by any admin) prefill them. Not editable
     * from this settings page; passed through untouched so saving unrelated settings
     * here (tax rate, currency, …) doesn't silently wipe them — INVOICE_SETTING writes
     * are a full overwrite, not a merge, on the backend.
     */
    instituteNameOverride?: string;
    instituteAddressOverride?: string;
    instituteContactOverride?: string;
    defaultNotes?: string;
    /**
     * Template ids the admin marked default in the Templates sections (INVOICE PDF layout /
     * INVOICE_EMAIL body). Owned by {@link setDefaultInvoiceTemplate} only; when absent, or
     * the template was deleted, the backend uses the newest template of that type.
     */
    defaultInvoiceTemplateId?: string;
    defaultInvoiceEmailTemplateId?: string;
}

/** INVOICE_SETTING key holding the default template id for each invoice template type. */
export const DEFAULT_TEMPLATE_SETTING_KEYS = {
    INVOICE: 'defaultInvoiceTemplateId',
    INVOICE_EMAIL: 'defaultInvoiceEmailTemplateId',
} as const;

export type InvoiceTemplateType = keyof typeof DEFAULT_TEMPLATE_SETTING_KEYS;

/** One extra receipt series: its own format and counter, for learners with one of `values`. */
export interface InvoiceNumberingSeries {
    /** Names the counter; A-Z 0-9 _, at most 16. Never reuse one for something else. */
    key: string;
    format: string;
    startFrom: number;
    learnerFieldId: string;
    values: string[];
}

export interface InvoiceNumberingSeriesPolicy {
    askOnFirstPayment: boolean;
    required: boolean;
    fieldId?: string | null;
}

export const SETTING_KEY = 'INVOICE_SETTING';

export const DEFAULT_INVOICE_SETTINGS: InvoiceSettingsData = {
    taxIncluded: false,
    taxRate: 0,
    taxLabel: 'Tax',
    currency: 'INR',
    sendInvoiceEmail: false,
    invoicePdfPlacement: 'INVOICE_EMAIL',
    proformaEnabled: false,
    generateInvoiceOnManualEnroll: false,
    sendAdminCopy: false,
    adminCopyUserIds: [],
    country: {
        code: '',
        name: '',
        taxRegistrationNumber: '',
        hsnSacCode: '',
        taxComponents: [],
        taxComponentsByPackageType: {},
    },
    numbering: DEFAULT_NUMBERING,
};

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Currencies the invoice generator knows how to render a symbol for. */
export const CURRENCY_OPTIONS: Array<{ code: string; label: string; symbol: string }> =
    CURRENCIES.map(({ code, name, symbol }) => ({ code, label: name, symbol }));

/**
 * Suggested tax components per country (applied when a country is picked and no
 * components have been configured yet). The admin can edit/add/remove freely.
 */
export const COUNTRY_TAX_PRESETS: Record<string, TaxComponent[]> = {
    in: [
        { label: 'CGST', rate: 9 },
        { label: 'SGST', rate: 9 },
    ],
    gb: [{ label: 'VAT', rate: 20 }],
    ae: [{ label: 'VAT', rate: 5 }],
    au: [{ label: 'GST', rate: 10 }],
    sg: [{ label: 'GST', rate: 9 }],
    us: [{ label: 'Sales Tax', rate: 0 }],
    ca: [{ label: 'GST', rate: 5 }],
    de: [{ label: 'VAT', rate: 19 }],
    fr: [{ label: 'VAT', rate: 20 }],
};

/** Suggested currency per country (applied alongside the tax preset). */
export const COUNTRY_DEFAULT_CURRENCY: Record<string, string> = {
    in: 'INR',
    us: 'USD',
    gb: 'GBP',
    ae: 'AED',
    au: 'AUD',
    sg: 'SGD',
    ca: 'CAD',
    de: 'EUR',
    fr: 'EUR',
};

// ─── API ─────────────────────────────────────────────────────────────────────

/** Sanitize a raw component array into clean { label, rate } entries. */
const normalizeComponents = (arr: unknown): TaxComponent[] =>
    Array.isArray(arr)
        ? arr.map((c) => ({
              label: (c as TaxComponent)?.label ?? '',
              rate: Number((c as TaxComponent)?.rate ?? 0) || 0,
          }))
        : [];

const SEQ_SCOPES: InvoiceSeqScope[] = ['NEVER', 'YEARLY', 'MONTHLY', 'DAILY'];

/** Clamp to a range, falling back when the value isn't a usable number. */
const clampInt = (value: unknown, min: number, max: number, fallback: number): number => {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.trunc(n)));
};

/**
 * Fill in a complete numbering config from whatever the API returned. Institutes created
 * before this feature have no `numbering` block at all, so every field falls back to the
 * legacy default — which reproduces the old hardcoded `INV-yyyyMMdd-0001` exactly.
 */
const normalizeNumbering = (raw: unknown): InvoiceNumberingConfig => {
    const base = (raw ?? {}) as Partial<InvoiceNumberingConfig>;
    const scope = SEQ_SCOPES.includes(base.seqScope as InvoiceSeqScope)
        ? (base.seqScope as InvoiceSeqScope)
        : DEFAULT_NUMBERING.seqScope;
    return {
        format:
            typeof base.format === 'string' && base.format.trim()
                ? base.format
                : DEFAULT_NUMBERING.format,
        seqPadding: clampInt(base.seqPadding, 1, 12, DEFAULT_NUMBERING.seqPadding),
        seqScope: scope,
        instituteCode: typeof base.instituteCode === 'string' ? base.instituteCode : '',
        fyStartMonth: clampInt(base.fyStartMonth, 1, 12, DEFAULT_NUMBERING.fyStartMonth),
        sanitizeTokens: base.sanitizeTokens ?? DEFAULT_NUMBERING.sanitizeTokens,
        startFrom: Math.max(0, Number(base.startFrom) || 0),
    };
};

/** Normalize whatever shape the API returns into a complete InvoiceSettingsData. */
const normalize = (raw: Partial<InvoiceSettingsData> | null | undefined): InvoiceSettingsData => {
    const base = raw ?? {};
    const country = (base.country ?? {}) as Partial<InvoiceCountryConfig>;
    const byType: Record<string, TaxComponent[]> = {};
    if (country.taxComponentsByPackageType && typeof country.taxComponentsByPackageType === 'object') {
        for (const [type, comps] of Object.entries(country.taxComponentsByPackageType)) {
            byType[type] = normalizeComponents(comps);
        }
    }
    return {
        // Keys this page does not edit (e.g. termsAndConditions, set from the backend) must
        // survive a save: INVOICE_SETTING writes are a full overwrite, not a merge.
        ...base,
        taxIncluded: base.taxIncluded ?? DEFAULT_INVOICE_SETTINGS.taxIncluded,
        taxRate: Number(base.taxRate ?? DEFAULT_INVOICE_SETTINGS.taxRate) || 0,
        taxLabel: base.taxLabel ?? DEFAULT_INVOICE_SETTINGS.taxLabel,
        currency: base.currency ?? DEFAULT_INVOICE_SETTINGS.currency,
        sendInvoiceEmail: base.sendInvoiceEmail ?? DEFAULT_INVOICE_SETTINGS.sendInvoiceEmail,
        invoicePdfPlacement:
            base.invoicePdfPlacement === 'PAYMENT_CONFIRMATION_EMAIL'
                ? 'PAYMENT_CONFIRMATION_EMAIL'
                : DEFAULT_INVOICE_SETTINGS.invoicePdfPlacement,
        proformaEnabled: base.proformaEnabled ?? DEFAULT_INVOICE_SETTINGS.proformaEnabled,
        generateInvoiceOnManualEnroll:
            base.generateInvoiceOnManualEnroll ?? DEFAULT_INVOICE_SETTINGS.generateInvoiceOnManualEnroll,
        sendAdminCopy: base.sendAdminCopy ?? DEFAULT_INVOICE_SETTINGS.sendAdminCopy,
        adminCopyUserIds: Array.isArray(base.adminCopyUserIds)
            ? base.adminCopyUserIds.filter((id): id is string => typeof id === 'string' && !!id)
            : [],
        country: {
            code: country.code ?? '',
            name: country.name ?? '',
            taxRegistrationNumber: country.taxRegistrationNumber ?? '',
            hsnSacCode: country.hsnSacCode ?? '',
            taxComponents: normalizeComponents(country.taxComponents),
            taxComponentsByPackageType: byType,
        },
        // MUST be round-tripped: INVOICE_SETTING writes are a full overwrite, so omitting
        // this here would let a save from any other section silently wipe the institute's
        // invoice numbering strategy.
        numbering: normalizeNumbering(base.numbering),
        // Pass-through only — see the field doc on InvoiceSettingsData.
        instituteNameOverride: base.instituteNameOverride,
        instituteAddressOverride: base.instituteAddressOverride,
        instituteContactOverride: base.instituteContactOverride,
        defaultNotes: base.defaultNotes,
    };
};

export const fetchInvoiceSettings = async (): Promise<InvoiceSettingsData> => {
    const instituteId = getCurrentInstituteId();
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: GET_INSITITUTE_SETTINGS,
        params: { instituteId, settingKey: SETTING_KEY },
    });
    return normalize(response.data?.data);
};

/** An institute admin selectable as an invoice-copy recipient. */
export interface AdminCopyOption {
    id: string;
    fullName: string;
    email: string;
}

/**
 * Active users holding the ADMIN role in this institute. Users without an
 * email are dropped — they cannot receive the copy anyway.
 */
export const fetchInvoiceAdminOptions = async (): Promise<AdminCopyOption[]> => {
    const instituteId = getCurrentInstituteId();
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: GET_INSTITUTE_USERS,
        params: { instituteId, pageNumber: 0, pageSize: 500 },
        data: { roles: ['ADMIN'], status: ['ACTIVE'] },
    });
    const raw = Array.isArray(response.data) ? response.data : (response.data?.content ?? []);
    return raw
        .map((u: { id: string; full_name?: string; email?: string | null }) => ({
            id: u.id,
            fullName: u.full_name ?? '',
            email: u.email ?? '',
        }))
        .filter((u: AdminCopyOption) => !!u.id && !!u.email);
};

// ─── Numbering ───────────────────────────────────────────────────────────────

/**
 * Validate a candidate format and render sample numbers. Safe to call on every
 * keystroke: the backend peeks at the sequence rather than allocating, so previewing
 * never consumes a number or leaves a gap in the series.
 */
export const previewInvoiceNumbering = async (
    numbering: InvoiceNumberingConfig
): Promise<InvoiceNumberPreview> => {
    const instituteId = getCurrentInstituteId();
    const response = await authenticatedAxiosInstance.post(POST_INVOICE_NUMBERING_PREVIEW, {
        instituteId,
        ...numbering,
    });
    return response.data;
};

/** The token palette. Served by the backend so it can't drift from the renderer. */
export const fetchInvoiceNumberTokens = async (): Promise<InvoiceNumberToken[]> => {
    const response = await authenticatedAxiosInstance.get(GET_INVOICE_NUMBERING_TOKENS);
    return Array.isArray(response.data) ? response.data : [];
};

/**
 * Current strategy + how many invoices already exist — drives the change warning.
 * Resolves to a zero-count default rather than throwing, so a failure here degrades to
 * "no warning shown" instead of blocking the settings page from loading.
 */
export const fetchInvoiceNumberingState = async (): Promise<InvoiceNumberingState> => {
    const instituteId = getCurrentInstituteId();
    try {
        const response = await authenticatedAxiosInstance.get(GET_INVOICE_NUMBERING_STATE, {
            params: { instituteId },
        });
        return response.data;
    } catch {
        return {
            currentFormat: DEFAULT_NUMBERING.format,
            seqScope: DEFAULT_NUMBERING.seqScope,
            currentExample: '',
            lastIssuedNumber: null,
            nextSequence: 1,
            existingInvoiceCount: 0,
        };
    }
};

/** The stored INVOICE_SETTING exactly as saved (no defaults applied), or null if never saved. */
const fetchRawInvoiceSettings = async (): Promise<Record<string, unknown> | null> => {
    const instituteId = getCurrentInstituteId();
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: GET_INSITITUTE_SETTINGS,
        params: { instituteId, settingKey: SETTING_KEY },
    });
    const raw = response.data?.data;
    return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
};

const postInvoiceSettings = async (data: object): Promise<void> => {
    const instituteId = getCurrentInstituteId();
    await authenticatedAxiosInstance.post(
        SAVE_INSTITUTE_SETTING,
        { setting_name: 'Invoice Setting', setting_data: data },
        { params: { instituteId, settingKey: SETTING_KEY } }
    );
};

export const saveInvoiceSettings = async (data: InvoiceSettingsData): Promise<void> => {
    // The default-template keys are set from the Templates sections on this same page,
    // possibly after this form loaded. Keep the stored values so saving the form never
    // reverts a default picked meanwhile (INVOICE_SETTING writes are a full overwrite).
    let payload: InvoiceSettingsData = data;
    try {
        const current = await fetchRawInvoiceSettings();
        payload = {
            ...data,
            defaultInvoiceTemplateId: current?.defaultInvoiceTemplateId as string | undefined,
            defaultInvoiceEmailTemplateId: current?.defaultInvoiceEmailTemplateId as string | undefined,
        };
    } catch {
        // Fall back to the values the form loaded with.
    }
    await postInvoiceSettings(payload);
};

/** Default template ids per type, read fresh from the stored setting. */
export const fetchDefaultInvoiceTemplateIds = async (): Promise<
    Record<InvoiceTemplateType, string | null>
> => {
    const raw = await fetchRawInvoiceSettings();
    const read = (key: string) => (typeof raw?.[key] === 'string' && raw[key] ? (raw[key] as string) : null);
    return {
        INVOICE: read(DEFAULT_TEMPLATE_SETTING_KEYS.INVOICE),
        INVOICE_EMAIL: read(DEFAULT_TEMPLATE_SETTING_KEYS.INVOICE_EMAIL),
    };
};

/**
 * Mark `templateId` as the default template of `type`. Only that one key changes: the rest
 * of the stored setting is written back as it is (an institute that never saved invoice
 * settings gets the same defaults the settings page would save).
 */
export const setDefaultInvoiceTemplate = async (
    type: InvoiceTemplateType,
    templateId: string
): Promise<void> => {
    const raw = await fetchRawInvoiceSettings();
    await postInvoiceSettings({
        ...(raw ?? DEFAULT_INVOICE_SETTINGS),
        [DEFAULT_TEMPLATE_SETTING_KEYS[type]]: templateId,
    });
};
