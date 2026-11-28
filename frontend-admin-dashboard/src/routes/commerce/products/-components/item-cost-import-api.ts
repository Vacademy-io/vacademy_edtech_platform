/**
 * Item-costs import: a sheet of purchase prices becomes each item's standard
 * cost. validate writes nothing and answers a token; commit sends the same file
 * with that token. Manager and accountant, with the switch-over feature on.
 */
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { asList, asRecord, instituteParams, num, str } from '@/routes/commerce/-shared/commerce-api';
import { COMMERCE_BASE } from '@/routes/commerce/-shared/commerce-urls';
import { type DownloadedFile, filenameOf } from '@/routes/commerce/-shared/catalogue-api';

export const ITEM_COSTS_IMPORT = `${COMMERCE_BASE}/stock/standard-costs/import`;
export const ITEM_COSTS_TEMPLATE = `${COMMERCE_BASE}/stock/standard-costs/template`;

export interface ItemCostIssue {
    row: number;
    column: string | null;
    code: string;
    message: string;
    sku: string | null;
}

/**
 * `price` and `cost_per_unit` are per selling unit (`unit`, e.g. one metre);
 * `cost` and `current_cost` are per base unit, as stored (`qty_scale` base units
 * make one selling unit; 1 for counted items).
 */
export interface ItemCostSpotRow {
    row: number;
    sku: string;
    name: string;
    price: string;
    includes_tax: boolean;
    rate: string | null;
    cost: string;
    current_cost: string | null;
    unit: string | null;
    qty_scale: number;
    cost_per_unit: string;
}

/** What "includes tax = yes" did: taken out (REGULAR GST mode) or kept in the cost. */
export type ItemCostTaxRule = 'REMOVE_INCLUDED_TAX' | 'KEEP_TAX_IN_COST';

export interface ItemCostValidation {
    rows: number;
    ok: number;
    error_count: number;
    errors: ItemCostIssue[];
    warning_count: number;
    warnings: ItemCostIssue[];
    unchanged: number;
    to_change: number;
    sum_old: string;
    sum_new: string;
    missing_after: { count: number; skus: string[] };
    spot_check: ItemCostSpotRow[];
    token: string;
    tax_mode: string | null;
    tax_rule: ItemCostTaxRule | null;
}

export interface ItemCostCommit {
    rows: number;
    changed: number;
    already_done: number;
    unchanged: number;
    sum_old: string;
    sum_new: string;
}

const MULTIPART = { 'Content-Type': 'multipart/form-data' };

const fileForm = (file: File): FormData => {
    const form = new FormData();
    form.append('file', file);
    return form;
};

/** Money and costs travel as numbers; kept as text so 89.2768 is shown as sent. */
const amount = (value: unknown): string => {
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return str(value) ?? '0';
};

const issue = (value: unknown): ItemCostIssue => {
    const r = asRecord(value) ?? {};
    return {
        row: num(r.row) ?? 0,
        column: str(r.column) ?? null,
        code: str(r.code) ?? '',
        message: str(r.message) ?? '',
        sku: str(r.sku) ?? null,
    };
};

export function normalizeItemCostValidation(data: unknown): ItemCostValidation {
    const r = asRecord(data) ?? {};
    const missing = asRecord(r.missing_after) ?? {};
    return {
        rows: num(r.rows) ?? 0,
        ok: num(r.ok) ?? 0,
        error_count: num(r.error_count) ?? 0,
        errors: asList(r.errors).map(issue),
        warning_count: num(r.warning_count) ?? 0,
        warnings: asList(r.warnings).map(issue),
        unchanged: num(r.unchanged) ?? 0,
        to_change: num(r.to_change) ?? 0,
        sum_old: amount(r.sum_old),
        sum_new: amount(r.sum_new),
        missing_after: {
            count: num(missing.count) ?? 0,
            skus: asList(missing.skus)
                .map((sku) => str(sku))
                .filter((sku): sku is string => !!sku),
        },
        spot_check: asList(r.spot_check).map((value) => {
            const s = asRecord(value) ?? {};
            return {
                row: num(s.row) ?? 0,
                sku: str(s.sku) ?? '',
                name: str(s.name) ?? '',
                price: amount(s.price),
                includes_tax: s.includes_tax === true,
                rate: s.rate === null || s.rate === undefined ? null : amount(s.rate),
                cost: amount(s.cost),
                current_cost:
                    s.current_cost === null || s.current_cost === undefined
                        ? null
                        : amount(s.current_cost),
                unit: str(s.unit) ?? null,
                qty_scale: num(s.qty_scale) ?? 1,
                cost_per_unit:
                    s.cost_per_unit === null || s.cost_per_unit === undefined
                        ? amount(s.cost)
                        : amount(s.cost_per_unit),
            };
        }),
        token: str(r.token) ?? '',
        tax_mode: str(r.tax_mode) ?? null,
        tax_rule:
            r.tax_rule === 'REMOVE_INCLUDED_TAX' || r.tax_rule === 'KEEP_TAX_IN_COST' ? r.tax_rule : null,
    };
}

export async function validateItemCosts(file: File): Promise<ItemCostValidation> {
    const res = await authenticatedAxiosInstance.post<unknown>(ITEM_COSTS_IMPORT, fileForm(file), {
        params: { ...instituteParams(), mode: 'validate' },
        headers: MULTIPART,
    });
    return normalizeItemCostValidation(res.data);
}

export async function commitItemCosts(file: File, token: string): Promise<ItemCostCommit> {
    const res = await authenticatedAxiosInstance.post<unknown>(ITEM_COSTS_IMPORT, fileForm(file), {
        params: { ...instituteParams(), mode: 'commit', token },
        headers: MULTIPART,
    });
    const r = asRecord(res.data) ?? {};
    return {
        rows: num(r.rows) ?? 0,
        changed: num(r.changed) ?? 0,
        already_done: num(r.already_done) ?? 0,
        unchanged: num(r.unchanged) ?? 0,
        sum_old: amount(r.sum_old),
        sum_new: amount(r.sum_new),
    };
}

export async function downloadItemCostTemplate(format: 'xlsx' | 'csv'): Promise<DownloadedFile> {
    const res = await authenticatedAxiosInstance.get<Blob>(ITEM_COSTS_TEMPLATE, {
        params: { ...instituteParams(), format },
        responseType: 'blob',
    });
    return { blob: res.data, filename: filenameOf(res.headers?.['content-disposition']) };
}
