import { AxiosError } from 'axios';
import { asRecord, num, str } from '@/routes/commerce/-shared/commerce-api';
import type {
    CustomerAddress,
    CustomerDetail,
    CustomerListFilters,
    CustomerPage,
    CustomerProfile,
    CustomerRow,
} from './customer-types';

/** Pure rules of the customers screens: query parameters and answer normalisation. */

export const CUSTOMER_PAGE_SIZE = 50;
export const CUSTOMER_SEARCH_MAX = 64;

export function customerListParams(filters: CustomerListFilters): Record<string, string | number> {
    const out: Record<string, string | number> = {};
    const search = (filters.search ?? '').trim().slice(0, CUSTOMER_SEARCH_MAX);
    if (search) out.search = search;
    out.page = Math.max(0, Math.floor(filters.page ?? 0));
    const size = Math.floor(filters.pageSize ?? CUSTOMER_PAGE_SIZE);
    out.pageSize = Math.min(CUSTOMER_PAGE_SIZE, Math.max(1, size));
    return out;
}

/**
 * The customers list route is not on this server yet (backend B2 not
 * deployed): 404 or 405. The screen then says "coming soon", not "error".
 */
export function isCustomersApiMissing(error: unknown): boolean {
    const status = error instanceof AxiosError ? error.response?.status : undefined;
    return status === 404 || status === 405;
}

/** A profile that does not exist (or belongs to another institute). */
export function isCustomerNotFound(error: unknown): boolean {
    return error instanceof AxiosError && error.response?.status === 404;
}

const records = (value: unknown): Record<string, unknown>[] =>
    (Array.isArray(value) ? value : []).map(asRecord).filter((r): r is Record<string, unknown> => !!r);

export function normalizeCustomerRow(data: unknown): CustomerRow {
    const r = asRecord(data) ?? {};
    return {
        id: str(r.id) ?? '',
        name: str(r.name),
        phone: str(r.phone),
        email: str(r.email),
        orders_count: num(r.orders_count) ?? 0,
        total_spent: num(r.total_spent) ?? 0,
        dues: num(r.dues) ?? 0,
        last_order_at: str(r.last_order_at),
        cod_refusals: num(r.cod_refusals) ?? 0,
        marketing_consent: r.marketing_consent === true,
        anonymised: r.anonymised === true,
        created_at: str(r.created_at),
    };
}

export function normalizeCustomerPage(data: unknown, pageSize = CUSTOMER_PAGE_SIZE): CustomerPage {
    const r = asRecord(data) ?? {};
    return {
        customers: records(r.customers).map(normalizeCustomerRow).filter((row) => row.id),
        page: num(r.page) ?? 0,
        page_size: num(r.page_size) ?? pageSize,
        total: num(r.total) ?? 0,
    };
}

const normalizeAddress = (r: Record<string, unknown>): CustomerAddress => ({
    id: str(r.id) ?? '',
    label: str(r.label),
    name: str(r.name),
    phone: str(r.phone),
    line1: str(r.line1),
    line2: str(r.line2),
    landmark: str(r.landmark),
    city: str(r.city),
    state_code: str(r.state_code),
    pincode: str(r.pincode),
    is_default: r.is_default === true,
});

export function normalizeCustomerProfile(data: unknown): CustomerProfile {
    const r = asRecord(data) ?? {};
    const c = asRecord(r.customer) ?? {};
    const customer: CustomerDetail = {
        ...normalizeCustomerRow(c),
        notes: str(c.notes),
        consent_at: str(c.consent_at),
        consent_source: str(c.consent_source),
    };
    return { customer, addresses: records(r.addresses).map(normalizeAddress) };
}
