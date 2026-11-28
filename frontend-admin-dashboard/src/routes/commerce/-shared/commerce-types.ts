/**
 * Wire types for the commerce admin API. Payload fields are snake_case, as the
 * backend serialises them.
 *
 * BUILT (read from the controllers and DTOs): staff locations, staff PIN,
 * product summaries, collections.
 * ASSUMED (the controllers were not written when this was; shapes follow the
 * entities): tax settings, tax classes, locations. They
 * are marked below; align them here, in one place, when the endpoints land.
 */

import type { CommerceRoleName } from '@/lib/commerce/commerce-access';

// ─── Enums (binding names) ───────────────────────────────────────────────────

export type TaxMode = 'REGULAR' | 'COMPOSITION' | 'UNREGISTERED';
export type SlabBasis = 'NET_UNIT_PRICE' | 'LIST_UNIT_PRICE';
export type SlabCompare = 'TAX_EXCLUSIVE' | 'TAX_INCLUSIVE';
export type RoundTotalTo = 'NONE' | 'RUPEE';
export type TaxClassStatus = 'ACTIVE' | 'ARCHIVED';
export type LocationStatus = 'ACTIVE' | 'INACTIVE';
export type ProductStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
export type CollectionKind = 'CATEGORY' | 'COLLECTION';

// ─── Staff (built) ───────────────────────────────────────────────────────────

/** GET/PUT /staff/locations */
export interface StaffLocations {
    user_id: string;
    location_ids: string[];
}

/** PUT /staff/locations body: the FULL set of locations for one staff member. */
export interface StaffLocationsRequest {
    user_id: string;
    location_ids: string[];
}

/** GET/PUT /staff/pin. The PIN itself never comes back. */
export interface StaffPinStatus {
    has_pin: boolean;
}

/**
 * What a manager approval sends WITH the action it approves:
 * who approved and their PIN. Never stored on the device.
 */
export interface ManagerApproval {
    approver_user_id: string;
    pin: string;
    reason?: string;
}

/** A person on the Staff and roles card (from the Teams users endpoint). */
export interface CommerceStaffMember {
    user_id: string;
    full_name: string;
    email: string | null;
    is_admin: boolean;
    commerce_roles: CommerceRoleName[];
    has_other_roles: boolean;
}

// ─── Catalogue (built) ───────────────────────────────────────────────────────

/** One row of GET /products. */
export interface ProductSummary {
    package_id: string;
    external_ref: string | null;
    slug: string | null;
    status: ProductStatus | string;
    brand: string | null;
    /** Names by locale ("hi", "en"). */
    names: Record<string, string> | null;
    variant_count: number | null;
    min_price: number | null;
    max_price: number | null;
    currency: string | null;
    updated_at: string | null;
    /** QUANTITY or PIECE. */
    stock_mode?: string | null;
    /** Null when the product has no tax class yet. */
    tax_class_id?: string | null;
    /** Not sent by the server yet; the list reads it when it arrives. */
    stock_state?: 'OUT_OF_STOCK' | 'LOW_STOCK' | 'IN_STOCK' | string | null;
    /**
     * WP-44 B8: the unit and parts per unit, so a measured product's per-base-unit
     * `min_price`/`max_price` read per metre ("₹123.40 / m"). Absent on older servers.
     */
    unit?: string | null;
    qty_scale?: number | null;
    qty_step?: number | null;
}

export interface CommerceCollection {
    id: string;
    parent_id: string | null;
    kind: CollectionKind | string;
    slug: string | null;
    name_i18n: Record<string, string> | null;
    description_i18n: Record<string, string> | null;
    media_id: string | null;
    return_window_days: number | null;
    position: number | null;
    status: string | null;
    external_ref: string | null;
    children?: CommerceCollection[] | null;
}

/** A page as the screens use it (the server's Spring page, normalised). */
export interface CommercePage<T> {
    content: T[];
    page_no: number;
    page_size: number;
    total_pages: number;
    total_elements: number;
    last: boolean;
}

// ─── Tax settings (ASSUMED: entity CommerceTaxSetting) ───────────────────────

export interface CommerceTaxSettings {
    tax_mode: TaxMode | null;
    slab_basis: SlabBasis | null;
    slab_compare: SlabCompare | null;
    round_total_to: RoundTotalTo | null;
    seller_gstin: string | null;
    /** Two-digit GST state code, e.g. "08" for Rajasthan. */
    seller_state_code: string | null;
    seller_legal_name: string | null;
    seller_address: string | null;
}

export type CommerceTaxSettingsRequest = Partial<CommerceTaxSettings> & { tax_mode: TaxMode };

// ─── Tax classes (ASSUMED: entities CommerceTaxClass, CommerceTaxRateRule) ───

export interface TaxRateRule {
    id?: string;
    /** Unit price in rupees from which the slab applies (inclusive). */
    min_unit_price: number;
    /** Upper limit in rupees; null = no upper limit. */
    max_unit_price: number | null;
    rate_percent: number;
    cess_percent: number | null;
    /** ISO date (YYYY-MM-DD). */
    effective_from: string;
    effective_to: string | null;
}

export interface TaxClass {
    id: string;
    code: string;
    name: string;
    hsn_code: string | null;
    unit: string | null;
    status: TaxClassStatus | string | null;
    rules: TaxRateRule[];
}

export interface TaxClassRequest {
    code: string;
    name: string;
    hsn_code: string | null;
    unit: string | null;
    rules: TaxRateRule[];
}

// ─── Locations (ASSUMED: entity StockLocation) ───────────────────────────────

export interface CommerceLocation {
    id: string;
    code: string;
    name: string;
    address_line1: string | null;
    address_line2: string | null;
    city: string | null;
    pincode: string | null;
    state_code: string | null;
    gstin: string | null;
    is_store: boolean;
    is_warehouse: boolean;
    is_source: boolean;
    is_temporary: boolean;
    starts_on: string | null;
    ends_on: string | null;
    sells_online: boolean;
    is_pos_enabled: boolean;
    status: LocationStatus | string | null;
}

export type CommerceLocationRequest = Omit<CommerceLocation, 'id' | 'sells_online' | 'status'>;
