/**
 * Staff customer views (backend B2), after `customer-api` has normalised them:
 * money as numbers, counts never absent. Notes and consent sit inside
 * `customer` on the profile; `addresses` is at the top level.
 */
export interface CustomerRow {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    orders_count: number;
    total_spent: number;
    dues: number;
    last_order_at: string | null;
    cod_refusals: number;
    marketing_consent: boolean;
    anonymised: boolean;
    created_at: string | null;
}

export interface CustomerDetail extends CustomerRow {
    notes: string | null;
    consent_at: string | null;
    consent_source: string | null;
}

export interface CustomerPage {
    customers: CustomerRow[];
    page: number;
    page_size: number;
    total: number;
}

export interface CustomerAddress {
    id: string;
    label: string | null;
    name: string | null;
    phone: string | null;
    line1: string | null;
    line2: string | null;
    landmark: string | null;
    city: string | null;
    state_code: string | null;
    pincode: string | null;
    is_default: boolean;
}

export interface CustomerProfile {
    customer: CustomerDetail;
    addresses: CustomerAddress[];
}

export interface CustomerListFilters {
    search?: string;
    page?: number;
    pageSize?: number;
}
