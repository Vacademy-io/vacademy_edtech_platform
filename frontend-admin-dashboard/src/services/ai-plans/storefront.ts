/**
 * AI plan storefront: the tenant billing facade in admin_core
 * (`/admin-core-service/ai-plans/v1/**`, every call `requireInstituteAdmin`).
 *
 * The server decides everything that matters: whether this institute may see
 * the storefront at all (404 STOREFRONT_OFF otherwise — rollout flag, allow-list,
 * sub-org guard), which plans are offered, every price and tax figure, and the
 * brand mode. This module only fetches, normalises and caches. Any error
 * resolves to "no storefront" so nothing renders and the old Plan tab stays
 * exactly as it was.
 *
 * Expected shapes (snake_case like the credit-pack DTOs; camelCase is accepted
 * too — the parser is tolerant on purpose):
 *
 *   GET  storefront?instituteId=
 *     -> { brand_mode: VACADEMY|NEUTRAL,
 *          supplier: { legal_name, gstin?, trade_name?, neutral_display_name?, display_name?, logo_url?, support_email? },
 *          autopay: { enabled, max_debit_minor },
 *          plans: [{ plan_id, plan_key, plan_version_id, name, tagline, highlights[], badge, sort_order,
 *                    period_months, currency, price: { base_minor, tax_minor, total_minor, tax_rate_bps, tax_label },
 *                    allowance_credits, features: [{ feature_key, label, mode, display_cap_text }],
 *                    is_current, action: SUBSCRIBE|UPGRADE|DOWNGRADE|CURRENT|CONTACT_SALES,
 *                    autopay_eligible?, upgrade_quote?: { base_minor, tax_minor, total_minor, service_start, service_end } }],
 *          subscription: { id, plan_id, plan_version_id, plan_name, status, source, period_start, period_end,
 *                          renews_at, end_at, grace_until, cancel_at_period_end, pending_plan?: { name, effective_at } } | null,
 *          open_charge: { charge_id, kind, status, total_minor, due_at, link_url, platform_payment_id, next_attempt_at } | null,
 *          billing_profile: { legal_name, gstin, state_code, address, billing_email } | null,
 *          mandate: { status, method, max_amount_minor } | null }
 *   PUT  billing-profile        { institute_id, legal_name, gstin, state_code, address, billing_email }
 *   POST checkout               { institute_id, plan_version_id, autopay, return_url, idempotency_key }
 *                               -> { mode: LINK|MANDATE, url, platform_payment_id? }
 *   POST change                 { institute_id, action: UPGRADE|DOWNGRADE|CANCEL|RESUME, plan_version_id?, return_url?, dry_run? }
 *                               -> { mode?: LINK|MANDATE|APPLIED, url?, platform_payment_id?, quote? }
 *   GET  invoices?instituteId=  -> [{ id, doc_type: INVOICE|CREDIT_NOTE, item_kind, number, issued_at, description,
 *                                     service_start?, service_end?, total_minor, tax_minor?, currency, status }]
 *   GET  invoices/{id}/pdf, credit-notes/{id}/pdf
 *   POST charges/{id}/pay       { institute_id, return_url } -> { mode: LINK|APPLIED, url, platform_payment_id }
 *   POST mandate/setup          { institute_id, return_url } -> { url }
 *   POST mandate/cancel         { institute_id }
 */
import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL } from '@/constants/urls';
import { isAdminForInstitute } from '@/lib/auth/roleUtils';
import { isIOS } from '@/native/platform';

export const AI_PLANS_API_BASE = `${BASE_URL}/admin-core-service/ai-plans/v1`;

/** Deep link to AI Settings → Plan & billing. A full navigation, so it works from any root. */
export const PLANS_SETTINGS_PATH = '/settings?selectedTab=aiSettings&aiSection=grp-plan';

/** Rs 15,000 in paise: the per-debit ceiling for an AFA-free recurring debit (RBI e-mandate rules). */
export const AUTOPAY_MAX_DEBIT_MINOR = 1_500_000;

// ─── Types ───────────────────────────────────────────────────────────

export type BrandMode = 'VACADEMY' | 'NEUTRAL';
export type PlanFeatureMode = 'INCLUDED' | 'ALLOWANCE' | 'CHARGED';
export type PlanAction = 'SUBSCRIBE' | 'UPGRADE' | 'DOWNGRADE' | 'CURRENT' | 'CONTACT_SALES';

export interface PlanPrice {
    currency: string;
    base_minor: number;
    tax_minor: number;
    total_minor: number;
    /** 1800 = 18%. Null when the server did not send it (derive from base/tax for display only). */
    tax_rate_bps: number | null;
    /** Server-made label, e.g. "IGST 18%" or "CGST 9% + SGST 9%". */
    tax_label: string | null;
}

export interface UpgradeQuote {
    base_minor: number;
    tax_minor: number | null;
    total_minor: number | null;
    service_start: string | null;
    service_end: string | null;
}

export interface StorefrontFeature {
    feature_key: string;
    label: string;
    mode: PlanFeatureMode;
    display_cap_text: string | null;
}

export interface StorefrontPlan {
    plan_id: string;
    plan_key: string;
    plan_version_id: string;
    name: string;
    tagline: string | null;
    highlights: string[];
    badge: string | null;
    sort_order: number;
    period_months: number;
    price: PlanPrice;
    allowance_credits: number;
    features: StorefrontFeature[];
    is_current: boolean;
    action: PlanAction;
    /** False when the server says this plan can't renew by autopay (e.g. above the per-debit ceiling). */
    autopay_eligible: boolean | null;
    upgrade_quote: UpgradeQuote | null;
}

export interface StorefrontSubscription {
    id: string;
    plan_id: string | null;
    plan_version_id: string | null;
    plan_name: string;
    /** PENDING | TRIAL | ACTIVE | GRACE | EXPIRED | CANCELLED | SCHEDULED */
    status: string;
    source: string | null;
    period_start: string | null;
    period_end: string | null;
    renews_at: string | null;
    end_at: string | null;
    grace_until: string | null;
    cancel_at_period_end: boolean;
    pending_plan: { name: string; effective_at: string | null } | null;
    /** The institute's own pre-tax price per period (a custom deal), when it differs from the plan's. */
    price_override_base_minor: number | null;
}

export interface OpenCharge {
    charge_id: string;
    kind: string;
    /** DUE | LINK_SENT | DEBIT_SCHEDULED | PAID | FAILED | VOID | REFUNDED | PARTIALLY_REFUNDED */
    status: string;
    total_minor: number;
    currency: string;
    due_at: string | null;
    link_url: string | null;
    platform_payment_id: string | null;
    next_attempt_at: string | null;
}

export interface PlanBillingProfile {
    legal_name: string | null;
    gstin: string | null;
    state_code: string | null;
    address: string | null;
    billing_email: string | null;
}

export interface PlanMandate {
    /** PENDING | ACTIVE | PAUSED | CANCELLED | REJECTED | EXPIRED */
    status: string;
    method: string | null;
    max_amount_minor: number | null;
}

export interface PlanSupplier {
    legal_name: string | null;
    gstin: string | null;
    trade_name: string | null;
    neutral_display_name: string | null;
    display_name: string | null;
    support_email: string | null;
}

export interface Storefront {
    brand_mode: BrandMode;
    supplier: PlanSupplier;
    autopay: { enabled: boolean; max_debit_minor: number };
    plans: StorefrontPlan[];
    subscription: StorefrontSubscription | null;
    open_charge: OpenCharge | null;
    billing_profile: PlanBillingProfile | null;
    mandate: PlanMandate | null;
}

export type BillingDocType = 'INVOICE' | 'CREDIT_NOTE';

export interface BillingDocument {
    id: string;
    doc_type: BillingDocType;
    /** CREDIT_PACK | AI_SUBSCRIPTION */
    item_kind: string;
    number: string;
    issued_at: string | null;
    description: string | null;
    service_start: string | null;
    service_end: string | null;
    total_minor: number;
    tax_minor: number | null;
    currency: string;
    status: string | null;
}

export interface PaymentRedirect {
    /** LINK = hosted payment link, MANDATE = autopay registration, APPLIED = nothing to pay. */
    mode: 'LINK' | 'MANDATE' | 'APPLIED';
    url: string | null;
    platform_payment_id: string | null;
    quote: UpgradeQuote | null;
}

// ─── Tolerant parsing ────────────────────────────────────────────────

type Obj = Record<string, unknown>;

const obj = (v: unknown): Obj =>
    v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {};
const camel = (k: string) => k.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
/** First present value among the keys, each tried as snake_case then camelCase. */
function pick(o: Obj, ...keys: string[]): unknown {
    for (const k of keys) {
        if (o[k] !== undefined && o[k] !== null) return o[k];
        const c = camel(k);
        if (o[c] !== undefined && o[c] !== null) return o[c];
    }
    return undefined;
}
const str = (v: unknown): string | null =>
    typeof v === 'string' && v.trim() !== '' ? v : typeof v === 'number' ? String(v) : null;
const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
};
const bool = (v: unknown): boolean | null =>
    typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : null;
const upper = (v: unknown): string => (typeof v === 'string' ? v.toUpperCase() : '');

const MODES: PlanFeatureMode[] = ['INCLUDED', 'ALLOWANCE', 'CHARGED'];
const ACTIONS: PlanAction[] = ['SUBSCRIBE', 'UPGRADE', 'DOWNGRADE', 'CURRENT', 'CONTACT_SALES'];

function parsePrice(raw: unknown, fallbackCurrency: string): PlanPrice | null {
    const p = obj(raw);
    const base = num(pick(p, 'base_minor', 'base_amount_minor'));
    const total = num(pick(p, 'total_minor', 'total_amount_minor'));
    if (base === null && total === null) return null;
    const tax = num(pick(p, 'tax_minor', 'tax_amount_minor'));
    const b = base ?? Math.max(0, (total ?? 0) - (tax ?? 0));
    const tx = tax ?? Math.max(0, (total ?? b) - b);
    return {
        currency: str(pick(p, 'currency')) ?? fallbackCurrency,
        base_minor: b,
        tax_minor: tx,
        total_minor: total ?? b + tx,
        tax_rate_bps: num(pick(p, 'tax_rate_bps')),
        tax_label: str(pick(p, 'tax_label')),
    };
}

function parseQuote(raw: unknown): UpgradeQuote | null {
    const q = obj(raw);
    const base = num(pick(q, 'base_minor', 'base_due_minor', 'due_base_minor'));
    const total = num(pick(q, 'total_minor', 'due_total_minor'));
    if (base === null && total === null) return null;
    return {
        base_minor: base ?? total ?? 0,
        tax_minor: num(pick(q, 'tax_minor')),
        total_minor: total,
        service_start: str(pick(q, 'service_start', 'period_start', 'from')),
        service_end: str(pick(q, 'service_end', 'period_end', 'until')),
    };
}

function parseFeature(raw: unknown): StorefrontFeature | null {
    const f = obj(raw);
    const key = str(pick(f, 'feature_key', 'key'));
    if (!key) return null;
    const m = upper(pick(f, 'mode'));
    return {
        feature_key: key,
        label: str(pick(f, 'tenant_label', 'label')) ?? key,
        mode: (MODES as string[]).includes(m) ? (m as PlanFeatureMode) : 'CHARGED',
        display_cap_text: str(pick(f, 'display_cap_text', 'fair_use_text')),
    };
}

function parsePlan(
    raw: unknown,
    subscription: StorefrontSubscription | null
): StorefrontPlan | null {
    const p = obj(raw);
    const versionId = str(pick(p, 'plan_version_id', 'version_id', 'listing_version_id'));
    const planId = str(pick(p, 'plan_id', 'id'));
    const name = str(pick(p, 'name', 'plan_name'));
    if (!versionId || !name) return null;
    const currency = str(pick(p, 'currency')) ?? 'INR';
    const price = parsePrice(pick(p, 'price') ?? p, currency);
    if (!price) return null;
    const highlights = pick(p, 'highlights');
    const features = pick(p, 'features', 'items');
    const actionRaw = upper(pick(p, 'action'));
    const isCurrent =
        bool(pick(p, 'is_current', 'current')) === true ||
        actionRaw === 'CURRENT' ||
        (!!subscription &&
            ((!!subscription.plan_version_id && subscription.plan_version_id === versionId) ||
                (!!subscription.plan_id &&
                    !!planId &&
                    subscription.plan_id === planId &&
                    !subscription.plan_version_id)));
    const action: PlanAction = isCurrent
        ? 'CURRENT'
        : (ACTIONS as string[]).includes(actionRaw)
          ? (actionRaw as PlanAction)
          : subscription
            ? 'CONTACT_SALES'
            : 'SUBSCRIBE';
    return {
        plan_id: planId ?? versionId,
        plan_key: str(pick(p, 'plan_key', 'key')) ?? planId ?? versionId,
        plan_version_id: versionId,
        name,
        tagline: str(pick(p, 'tagline')),
        highlights: Array.isArray(highlights)
            ? highlights
                  .map((h) => (typeof h === 'string' ? h : str(obj(h).text)))
                  .filter((h): h is string => !!h && h.trim() !== '')
                  .slice(0, 6)
            : [],
        badge: str(pick(p, 'badge')),
        sort_order: num(pick(p, 'sort_order')) ?? 0,
        period_months: Math.max(1, num(pick(p, 'period_months')) ?? 1),
        price,
        allowance_credits: Math.max(
            0,
            num(pick(p, 'allowance_credits', 'monthly_allowance_credits')) ?? 0
        ),
        features: (Array.isArray(features) ? features : [])
            .map(parseFeature)
            .filter((f): f is StorefrontFeature => f !== null),
        is_current: isCurrent,
        action,
        autopay_eligible: bool(pick(p, 'autopay_eligible')),
        upgrade_quote: parseQuote(pick(p, 'upgrade_quote', 'quote')),
    };
}

function parseSubscription(raw: unknown): StorefrontSubscription | null {
    const s = obj(raw);
    const id = str(pick(s, 'id', 'subscription_id'));
    const status = upper(pick(s, 'status'));
    if (!id || !status) return null;
    const pending = obj(pick(s, 'pending_plan'));
    const pendingName = str(pick(pending, 'name', 'plan_name'));
    return {
        id,
        plan_id: str(pick(s, 'plan_id')),
        plan_version_id: str(pick(s, 'plan_version_id')),
        plan_name: str(pick(s, 'plan_name', 'name')) ?? '',
        status,
        source: str(pick(s, 'source')),
        period_start: str(pick(s, 'period_start', 'current_period_start')),
        period_end: str(pick(s, 'period_end', 'current_period_end')),
        renews_at: str(pick(s, 'renews_at', 'next_renewal_at')),
        end_at: str(pick(s, 'end_at')),
        grace_until: str(pick(s, 'grace_until')),
        cancel_at_period_end: bool(pick(s, 'cancel_at_period_end')) === true,
        pending_plan: pendingName
            ? { name: pendingName, effective_at: str(pick(pending, 'effective_at')) }
            : null,
        price_override_base_minor: num(pick(s, 'price_override_base_minor')),
    };
}

function parseOpenCharge(raw: unknown): OpenCharge | null {
    const c = obj(raw);
    const id = str(pick(c, 'charge_id', 'id'));
    const status = upper(pick(c, 'status'));
    if (!id || !status) return null;
    return {
        charge_id: id,
        kind: upper(pick(c, 'kind')) || 'PERIOD',
        status,
        total_minor: num(pick(c, 'total_minor')) ?? 0,
        currency: str(pick(c, 'currency')) ?? 'INR',
        due_at: str(pick(c, 'due_at', 'service_start')),
        link_url: str(pick(c, 'link_url', 'payment_link_url')),
        platform_payment_id: str(pick(c, 'platform_payment_id')),
        next_attempt_at: str(pick(c, 'next_attempt_at')),
    };
}

function parseBillingProfile(raw: unknown): PlanBillingProfile | null {
    const b = obj(raw);
    if (Object.keys(b).length === 0) return null;
    return {
        legal_name: str(pick(b, 'legal_name')),
        gstin: str(pick(b, 'gstin')),
        state_code: str(pick(b, 'state_code')),
        address: str(pick(b, 'address')),
        billing_email: str(pick(b, 'billing_email', 'email')),
    };
}

function parseMandate(raw: unknown): PlanMandate | null {
    const m = obj(raw);
    const status = upper(pick(m, 'status'));
    if (!status) return null;
    return {
        status,
        method: str(pick(m, 'method')),
        max_amount_minor: num(pick(m, 'max_amount_minor')),
    };
}

/** Normalise the storefront GET. `null` = no storefront (also for any malformed body). */
export function normalizeStorefront(raw: unknown): Storefront | null {
    const r = obj(raw);
    const plansRaw = pick(r, 'plans', 'catalog');
    const catalog = Array.isArray(plansRaw)
        ? plansRaw
        : Array.isArray(obj(plansRaw).plans)
          ? (obj(plansRaw).plans as unknown[])
          : null;
    if (!catalog) return null;
    const subscription = parseSubscription(pick(r, 'subscription', 'current_subscription'));
    const supplier = obj(pick(r, 'supplier'));
    const autopay = obj(pick(r, 'autopay'));
    const plans = catalog
        .map((p) => parsePlan(p, subscription))
        .filter((p): p is StorefrontPlan => p !== null)
        .sort((a, b) => a.sort_order - b.sort_order || a.price.base_minor - b.price.base_minor);
    return {
        brand_mode: upper(pick(r, 'brand_mode')) === 'VACADEMY' ? 'VACADEMY' : 'NEUTRAL',
        supplier: {
            legal_name: str(pick(supplier, 'legal_name')),
            gstin: str(pick(supplier, 'gstin')),
            trade_name: str(pick(supplier, 'trade_name')),
            neutral_display_name: str(pick(supplier, 'neutral_display_name')),
            display_name: str(pick(supplier, 'display_name')),
            support_email: str(pick(supplier, 'support_email', 'billing_support_email')),
        },
        autopay: {
            enabled:
                bool(pick(autopay, 'enabled')) === true ||
                bool(pick(r, 'autopay_enabled')) === true,
            max_debit_minor:
                num(pick(autopay, 'max_debit_minor', 'ceiling_minor')) ?? AUTOPAY_MAX_DEBIT_MINOR,
        },
        plans,
        subscription,
        open_charge: parseOpenCharge(pick(r, 'open_charge', 'charge')),
        billing_profile: parseBillingProfile(pick(r, 'billing_profile')),
        mandate: parseMandate(pick(r, 'mandate')),
    };
}

export function normalizeBillingDocuments(raw: unknown): BillingDocument[] {
    const r = obj(raw);
    const list = Array.isArray(raw)
        ? raw
        : Array.isArray(pick(r, 'documents'))
          ? (pick(r, 'documents') as unknown[])
          : [
                ...(
                    (Array.isArray(pick(r, 'invoices')) ? pick(r, 'invoices') : []) as unknown[]
                ).map((d) => ({ doc_type: 'INVOICE', ...obj(d) })),
                ...(
                    (Array.isArray(pick(r, 'credit_notes'))
                        ? pick(r, 'credit_notes')
                        : []) as unknown[]
                ).map((d) => ({ doc_type: 'CREDIT_NOTE', ...obj(d) })),
            ];
    return list
        .map((d): BillingDocument | null => {
            const o = obj(d);
            const docType: BillingDocType =
                upper(pick(o, 'doc_type', 'type')) === 'CREDIT_NOTE' ? 'CREDIT_NOTE' : 'INVOICE';
            const id = str(
                pick(o, 'id', docType === 'CREDIT_NOTE' ? 'credit_note_id' : 'invoice_id')
            );
            if (!id) return null;
            return {
                id,
                doc_type: docType,
                item_kind: upper(pick(o, 'item_kind')) || 'CREDIT_PACK',
                number: str(pick(o, 'number', 'invoice_number', 'credit_note_number')) ?? id,
                issued_at: str(pick(o, 'issued_at')),
                description: str(pick(o, 'description', 'pack_name')),
                service_start: str(pick(o, 'service_start', 'service_period_start')),
                service_end: str(pick(o, 'service_end', 'service_period_end')),
                total_minor: num(pick(o, 'total_minor', 'total_amount_minor')) ?? 0,
                tax_minor: num(pick(o, 'tax_minor', 'tax_amount_minor')),
                currency: str(pick(o, 'currency')) ?? 'INR',
                status: str(pick(o, 'status', 'payment_status')),
            };
        })
        .filter((d): d is BillingDocument => d !== null);
}

function normalizeRedirect(raw: unknown): PaymentRedirect {
    const r = obj(raw);
    const url = str(pick(r, 'url', 'payment_link_url', 'short_url', 'registration_url'));
    const m = upper(pick(r, 'mode'));
    // Only an explicit APPLIED means "nothing to pay". Anything else without a
    // URL stays LINK, which the caller treats as a failure (never as success).
    return {
        mode: m === 'MANDATE' ? 'MANDATE' : m === 'APPLIED' ? 'APPLIED' : 'LINK',
        url,
        platform_payment_id: str(pick(r, 'platform_payment_id')),
        quote: parseQuote(pick(r, 'quote')),
    };
}

/** Status values that count as "the institute has a plan right now" on the manage view. */
export const LIVE_SUBSCRIPTION_STATUSES = ['TRIAL', 'ACTIVE', 'GRACE'];

export function isLiveSubscription(
    s: StorefrontSubscription | null | undefined
): s is StorefrontSubscription {
    return !!s && LIVE_SUBSCRIPTION_STATUSES.includes(s.status);
}

/** A charge the admin can still pay (a link is or can be produced). */
export function isPayableCharge(c: OpenCharge | null | undefined): c is OpenCharge {
    return !!c && ['DUE', 'LINK_SENT', 'FAILED'].includes(c.status);
}

/** Server error code from a facade error (409 ALREADY_SUBSCRIBED, 422 BUYER_STATE_REQUIRED …). */
export function apiErrorCode(error: unknown): string | null {
    const e = obj(error);
    const data = obj(obj(e.response).data);
    const code = str(pick(data, 'code', 'error_code', 'error', 'responseCode'));
    if (code && /^[A-Z][A-Z0-9_]+$/.test(code)) return code;
    const msg = str(pick(data, 'ex', 'message', 'detail'));
    const m = msg?.match(/\b([A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+)\b/);
    if (m) return m[1] ?? null;
    const status = num(obj(e.response).status);
    return status === 404 ? 'STOREFRONT_OFF' : null;
}

// ─── Storefront cache (shared by react-query and the out-of-tree dialogs) ──

const STOREFRONT_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
    data: Storefront | null | undefined;
    at: number;
    promise: Promise<Storefront | null> | null;
}

const cache = new Map<string, CacheEntry>();
const listeners = new Set<() => void>();

function emit() {
    listeners.forEach((l) => l());
}

export function subscribeStorefront(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** Last known storefront for the institute: undefined = never loaded, null = not visible. */
export function getStorefrontSnapshot(
    instituteId: string | null | undefined
): Storefront | null | undefined {
    if (!instituteId) return null;
    return cache.get(instituteId)?.data;
}

/** True when this session may ask for the storefront at all (admin of the institute, not native iOS). */
export function canRequestStorefront(
    instituteId: string | null | undefined
): instituteId is string {
    if (!instituteId) return false;
    try {
        // Apple Guideline 3.1.1: no digital purchases outside IAP on native iOS.
        if (isIOS()) return false;
        return isAdminForInstitute(instituteId);
    } catch {
        return false;
    }
}

export async function fetchStorefront(instituteId: string): Promise<Storefront | null> {
    const response = await authenticatedAxiosInstance.get<unknown>(
        `${AI_PLANS_API_BASE}/storefront?instituteId=${encodeURIComponent(instituteId)}`
    );
    return normalizeStorefront(response.data);
}

/**
 * Load (deduplicated) and cache. Errors of any kind resolve to null, so a
 * storefront that is off, not deployed or forbidden simply never renders.
 */
export function loadStorefront(
    instituteId: string,
    { force = false }: { force?: boolean } = {}
): Promise<Storefront | null> {
    const entry = cache.get(instituteId);
    if (entry?.promise) return entry.promise;
    if (!force && entry && entry.data !== undefined && Date.now() - entry.at < STOREFRONT_TTL_MS) {
        return Promise.resolve(entry.data);
    }
    const promise = fetchStorefront(instituteId)
        .catch(() => null)
        .then((data) => {
            cache.set(instituteId, { data, at: Date.now(), promise: null });
            emit();
            return data;
        });
    cache.set(instituteId, { data: entry?.data, at: entry?.at ?? 0, promise });
    return promise;
}

/** Test hook: forget everything. */
export function resetStorefrontCache() {
    cache.clear();
    emit();
}

/** Test/seed hook: put a storefront into the cache as if it had been fetched. */
export function primeStorefrontCache(instituteId: string, data: Storefront | null) {
    cache.set(instituteId, { data, at: Date.now(), promise: null });
    emit();
}

// ─── React Query hooks ───────────────────────────────────────────────

export const storefrontQueryKey = (instituteId: string | null | undefined) =>
    ['GET_AI_PLAN_STOREFRONT', instituteId ?? null] as const;
export const billingDocumentsQueryKey = (instituteId: string | null | undefined) =>
    ['GET_AI_PLAN_BILLING_DOCS', instituteId ?? null] as const;

/**
 * The storefront, or null when it is not visible to this admin. Disabled (and
 * so always null) for non-admins and on native iOS.
 */
export const useStorefrontQuery = (instituteId: string | null | undefined, enabled = true) => {
    const allowed = enabled && canRequestStorefront(instituteId);
    return useQuery({
        queryKey: storefrontQueryKey(instituteId),
        queryFn: () => loadStorefront(instituteId as string, { force: true }),
        enabled: allowed,
        staleTime: STOREFRONT_TTL_MS,
        retry: false,
    });
};

export const useBillingDocumentsQuery = (instituteId: string | null | undefined, enabled = true) =>
    useQuery({
        queryKey: billingDocumentsQueryKey(instituteId),
        queryFn: async () => {
            const response = await authenticatedAxiosInstance.get<unknown>(
                `${AI_PLANS_API_BASE}/invoices?instituteId=${encodeURIComponent(instituteId as string)}`
            );
            return normalizeBillingDocuments(response.data);
        },
        enabled: enabled && !!instituteId,
        staleTime: 60_000,
        retry: false,
    });

/** Refresh everything a plan payment or change can move. */
export const useInvalidatePlanQueries = () => {
    const queryClient = useQueryClient();
    // Stable identity: callers keep it in effect dependencies.
    return useCallback(() => {
        queryClient.invalidateQueries({ queryKey: ['GET_AI_PLAN_STOREFRONT'] });
        queryClient.invalidateQueries({ queryKey: ['GET_AI_PLAN_BILLING_DOCS'] });
        queryClient.invalidateQueries({ queryKey: ['GET_AI_PLAN'] });
        queryClient.invalidateQueries({ queryKey: ['GET_AI_CREDITS'] });
        queryClient.invalidateQueries({ queryKey: ['GET_CREDIT_PACK_ORDER_STATUS'] });
    }, [queryClient]);
};

// ─── Writes ──────────────────────────────────────────────────────────

export interface BillingProfileInput {
    legalName: string;
    gstin: string;
    stateCode: string;
    address: string;
    email: string;
}

export async function saveBillingProfile(instituteId: string, input: BillingProfileInput) {
    await authenticatedAxiosInstance.put(`${AI_PLANS_API_BASE}/billing-profile`, {
        institute_id: instituteId,
        legal_name: input.legalName.trim() || null,
        gstin: input.gstin.trim() || null,
        state_code: input.stateCode || null,
        address: input.address.trim() || null,
        billing_email: input.email.trim() || null,
    });
}

export type AutopayMethod = 'UPI' | 'CARD';

export interface CheckoutInput {
    instituteId: string;
    planVersionId: string;
    autopay: boolean;
    /** Required by the mandate registration when autopay is on. */
    autopayMethod?: AutopayMethod;
    /** Payer mobile (10 digits) — Razorpay recurring needs a contact for the customer. */
    contact?: string;
    returnUrl: string;
    idempotencyKey: string;
}

/** "+91 98765 43210" → "9876543210"; null unless it is a valid Indian mobile. */
export function normalizeIndianMobile(raw: string): string | null {
    const digits = raw.replace(/\D/g, '').replace(/^(?:91|0)(?=\d{10}$)/, '');
    return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

export async function startPlanCheckout(input: CheckoutInput): Promise<PaymentRedirect> {
    const response = await authenticatedAxiosInstance.post<unknown>(
        `${AI_PLANS_API_BASE}/checkout`,
        {
            institute_id: input.instituteId,
            plan_version_id: input.planVersionId,
            autopay: input.autopay,
            autopay_method: input.autopay ? input.autopayMethod : undefined,
            contact: input.autopay ? input.contact : undefined,
            return_url: input.returnUrl,
            idempotency_key: input.idempotencyKey,
        },
        { headers: { 'Idempotency-Key': input.idempotencyKey } }
    );
    return normalizeRedirect(response.data);
}

export type ChangeAction = 'UPGRADE' | 'DOWNGRADE' | 'CANCEL' | 'RESUME';

export interface ChangeInput {
    instituteId: string;
    action: ChangeAction;
    planVersionId?: string;
    returnUrl?: string;
    dryRun?: boolean;
}

export async function changePlan(input: ChangeInput): Promise<PaymentRedirect> {
    const response = await authenticatedAxiosInstance.post<unknown>(`${AI_PLANS_API_BASE}/change`, {
        institute_id: input.instituteId,
        action: input.action,
        plan_version_id: input.planVersionId,
        return_url: input.returnUrl,
        dry_run: input.dryRun || undefined,
    });
    return normalizeRedirect(response.data);
}

/**
 * A payment link for an open charge of this institute (renewal due, failed
 * autopay debit, expired link). Idempotent on the server: a live link is
 * returned as is, a dead one is replaced.
 */
export async function payCharge(
    instituteId: string,
    chargeId: string,
    returnUrl: string
): Promise<PaymentRedirect> {
    const response = await authenticatedAxiosInstance.post<unknown>(
        `${AI_PLANS_API_BASE}/charges/${encodeURIComponent(chargeId)}/pay`,
        { institute_id: instituteId, return_url: returnUrl }
    );
    return normalizeRedirect(response.data);
}

export async function setupMandate(
    instituteId: string,
    returnUrl: string,
    method: AutopayMethod,
    contact: string
): Promise<PaymentRedirect> {
    const response = await authenticatedAxiosInstance.post<unknown>(
        `${AI_PLANS_API_BASE}/mandate/setup`,
        { institute_id: instituteId, return_url: returnUrl, method, contact }
    );
    return normalizeRedirect(response.data);
}

export async function cancelMandate(instituteId: string): Promise<void> {
    await authenticatedAxiosInstance.post(`${AI_PLANS_API_BASE}/mandate/cancel`, {
        institute_id: instituteId,
    });
}

export const useChangePlanMutation = () =>
    useMutation({ mutationFn: (input: ChangeInput) => changePlan(input) });

/** Download a subscription invoice or a credit note PDF (auth header → blob → save). */
export async function downloadBillingDocumentPdf(
    instituteId: string,
    doc: Pick<BillingDocument, 'id' | 'doc_type' | 'number'>
): Promise<void> {
    const path = doc.doc_type === 'CREDIT_NOTE' ? 'credit-notes' : 'invoices';
    const response = await authenticatedAxiosInstance.get<Blob>(
        `${AI_PLANS_API_BASE}/${path}/${encodeURIComponent(doc.id)}/pdf?instituteId=${encodeURIComponent(instituteId)}`,
        { responseType: 'blob' }
    );
    const url = URL.createObjectURL(response.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(doc.number || doc.id).replace(/[^A-Za-z0-9._-]+/g, '-')}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Where Razorpay sends the browser back: the Plan & billing tab on this same host. */
export function planReturnUrl(): string {
    try {
        return new URL(PLANS_SETTINGS_PATH, window.location.origin).toString();
    } catch {
        return PLANS_SETTINGS_PATH;
    }
}

/** A fresh idempotency key per checkout dialog open. */
export function newIdempotencyKey(): string {
    try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }
    } catch {
        // fall through
    }
    return `ck-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
