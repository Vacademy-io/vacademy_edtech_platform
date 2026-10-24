import type { ProductPageResponse } from '../-types/product-page-types';

/**
 * Reading the catalogue-sync response, defensively: the page may come spread
 * at the top level (the documented shape) or nested under `page`, and the
 * added / deactivated figures may be counts or lists. Nothing here trusts the
 * shape — a missing piece becomes 0 / [] / null, never a crash.
 *
 * The server explains what it skipped or switched off with machine codes
 * (`cpo_not_supported`, `left_catalogue`, …). Those are never shown raw:
 * describeSyncReason() turns each into plain words and a next step.
 */

/** Course name fields the server sends with each skipped / switched-off version. */
interface SyncCourseRef {
    package_name?: string;
    level_name?: string;
}

/** One catalogue course version the sync did not add, and why (a reason code such as `cpo_not_supported`). */
export interface CatalogueSyncSkip extends SyncCourseRef {
    package_session_id: string;
    reason: string;
}

/** One mapping of the page the sync switched off, and why (`left_catalogue`, `plan_inactive`, …). */
export interface CatalogueSyncDeactivation extends SyncCourseRef {
    mapping_id: string;
    package_session_id: string;
    reason: string;
}

/**
 * POST /v1/product-page/{id}/sync-catalogue: the admin page response plus a
 * summary of what changed (Knowledge Streams spec §7). `added` / `deactivated`
 * may arrive as counts or as lists; parseSyncResponse() reads either.
 */
export interface CatalogueSyncResponse extends Partial<ProductPageResponse> {
    added?: number | unknown[];
    deactivated?: number | unknown[];
    skipped?: CatalogueSyncSkip[];
    warnings?: (string | { message?: string })[];
    added_package_session_ids?: string[];
    deactivated_mappings?: CatalogueSyncDeactivation[];
    /** Some servers nest the page instead of spreading it. */
    page?: ProductPageResponse;
}

export interface CatalogueSyncResult {
    /**
     * The page after the sync, shaped as GET /v1/product-page/{id} returns it
     * (summary fields stripped, so it can go straight into the query cache), or
     * null when the response did not carry a usable one (refetch it).
     */
    page: ProductPageResponse | null;
    added: number;
    deactivated: number;
    skipped: CatalogueSyncSkip[];
    /** The switched-off mappings with their reasons; may be empty when an older server sends only the count. */
    deactivatedMappings: CatalogueSyncDeactivation[];
    warnings: string[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

const countOf = (v: unknown): number =>
    Array.isArray(v) ? v.length : typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;

const asPage = (v: unknown): ProductPageResponse | null =>
    isRecord(v) && typeof v.id === 'string' && v.id && Array.isArray(v.mappings)
        ? (v as unknown as ProductPageResponse)
        : null;

/** The sync's own fields — everything else at the top level is the page. */
const SUMMARY_KEYS = [
    'added',
    'deactivated',
    'skipped',
    'warnings',
    'added_package_session_ids',
    'deactivated_mappings',
    'page',
    'product_page',
];

const withoutSummary = (raw: Record<string, unknown>): Record<string, unknown> => {
    const page = { ...raw };
    for (const key of SUMMARY_KEYS) delete page[key];
    return page;
};

const textOf = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

const courseRefOf = (s: Record<string, unknown>): SyncCourseRef => {
    const ref: SyncCourseRef = {};
    const packageName = textOf(s.package_name ?? s.packageName);
    const levelName = textOf(s.level_name ?? s.levelName);
    if (packageName) ref.package_name = packageName;
    if (levelName) ref.level_name = levelName;
    return ref;
};

const recordsOf = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v : []).filter(isRecord);

export const parseSyncResponse = (data: unknown): CatalogueSyncResult => {
    const raw = isRecord(data) ? data : {};
    const page = asPage(raw.page) ?? asPage(raw.product_page) ?? asPage(withoutSummary(raw));
    const skipped: CatalogueSyncSkip[] = recordsOf(raw.skipped).map((s) => ({
        package_session_id: String(s.package_session_id ?? s.packageSessionId ?? ''),
        reason: textOf(s.reason) ?? '',
        ...courseRefOf(s),
    }));
    const deactivatedMappings: CatalogueSyncDeactivation[] = recordsOf(
        raw.deactivated_mappings ?? raw.deactivatedMappings
    ).map((d) => ({
        mapping_id: String(d.mapping_id ?? d.mappingId ?? ''),
        package_session_id: String(d.package_session_id ?? d.packageSessionId ?? ''),
        reason: textOf(d.reason) ?? '',
        ...courseRefOf(d),
    }));
    const warnings = (Array.isArray(raw.warnings) ? raw.warnings : [])
        .map((w) => (typeof w === 'string' ? w : isRecord(w) && typeof w.message === 'string' ? w.message : ''))
        .map((w) => w.trim())
        .filter(Boolean);
    return {
        page,
        added: Math.max(countOf(raw.added), countOf(raw.added_package_session_ids)),
        deactivated: Math.max(countOf(raw.deactivated), deactivatedMappings.length),
        skipped,
        deactivatedMappings,
        warnings,
    };
};

/* ── reasons in plain words ──────────────────────────────────────────── */

export interface SyncReasonText {
    /** What happened. */
    label: string;
    /** What the admin can do about it, when there is something to do. */
    hint?: string;
}

const READDED = 'If your catalogue still sells it, it was added again on the catalogue’s plan.';

/**
 * The codes CatalogueSyncPlanner (admin_core) sends. Skipped: no_active_invite,
 * invite_inactive, invite_not_started, invite_expired, payment_option_inactive,
 * cpo_not_supported, no_active_plan, non_default_invite, currency_mismatch,
 * vendor_mismatch. Switched off: left_catalogue, bridge_inactive,
 * invite_inactive, payment_option_inactive, plan_inactive, plan_missing.
 *
 * The sync sells a course only through its default invite link, so a closed
 * link is fixed by opening THAT link — never by reopening whichever link was
 * reported, which may be a promo or private one.
 *
 * currency_mismatch covers two cases: a currency other than the page's, and
 * a course whose own invite link and plan name different currencies (on any
 * page, even an empty one). Its own product page would not fix the second.
 */
const SYNC_REASONS: Record<string, SyncReasonText> = {
    no_active_invite: {
        label: 'No active invite link for this batch',
        hint: 'Create an invite link for the batch (or switch one on), then sync again.',
    },
    invite_inactive: {
        label: 'Its invite link is switched off',
        hint: 'The store sells a course through its default invite link, which must be switched on. Then sync again.',
    },
    invite_not_started: {
        label: 'Its invite link has not opened yet',
        hint: 'Sync again once the invite link’s start date has passed.',
    },
    invite_expired: {
        label: 'Its invite link has expired',
        hint: 'The store sells a course through its default invite link, which must be open. Then sync again.',
    },
    payment_option_inactive: {
        label: 'Its payment option is switched off or missing',
        hint: 'Give the invite link an active payment option, then sync again.',
    },
    cpo_not_supported: {
        label: 'Instalment (CPO) plans cannot be sold through the cart',
        hint: 'Sell these courses from their own course page or invite link instead.',
    },
    no_active_plan: {
        label: 'Its payment option has no active plan',
        hint: 'Add or switch on a payment plan, then sync again.',
    },
    non_default_invite: {
        label: 'Only a non-default invite link sells this course',
        hint: 'Add it by hand if that price is intended.',
    },
    currency_mismatch: {
        label: 'Priced in a different currency from this store page, or its invite link and payment plan name different currencies',
        hint: 'If its invite link and payment plan name different currencies, give them the same one, then sync again. Otherwise sell it from its own product page.',
    },
    vendor_mismatch: {
        label: 'Paid through a different payment gateway from this store page',
        hint: 'Sell it from its own product page.',
    },
    left_catalogue: {
        label: 'Not published to your catalogue (including courses that never were)',
        hint: 'To sell one here again, add it back in the Courses tab — and leave “switch off” unticked next time.',
    },
    bridge_inactive: { label: 'Its invite link no longer enrols into this batch', hint: READDED },
    plan_inactive: { label: 'Its payment plan is switched off', hint: READDED },
    plan_missing: { label: 'Its payment plan was deleted', hint: READDED },
};

/** A bare machine code ("some_new_code"), as opposed to a sentence a server may send instead. */
const MACHINE_CODE = /^[A-Za-z0-9]+(?:_[A-Za-z0-9]+)*$/;

/**
 * Reason code → plain words. Known codes get a sentence and a next step; an
 * unknown code is humanised ("some_new_code" → "Some new code"); a sentence
 * is shown as it came.
 */
export const describeSyncReason = (reason: string | null | undefined): SyncReasonText => {
    const raw = (reason || '').trim();
    if (!raw) return { label: 'No reason given' };
    const known = SYNC_REASONS[raw.toLowerCase()];
    if (known) return known;
    if (!MACHINE_CODE.test(raw)) return { label: raw };
    const words = raw.toLowerCase().replace(/_/g, ' ');
    return { label: words.charAt(0).toUpperCase() + words.slice(1) };
};

/* ── grouping and summaries ──────────────────────────────────────────── */

/** Level names that only fill a gap ("DEFAULT") — not worth showing next to the course. */
const PLACEHOLDER_LEVELS = new Set(['', 'default', 'none', 'null', 'undefined']);

/** "Yoga (Hindi)"; just the course when the level is a placeholder; '' when the server sent no name. */
export const syncCourseName = (item: SyncCourseRef): string => {
    const course = (item.package_name || '').trim();
    if (!course) return '';
    const level = (item.level_name || '').trim();
    return PLACEHOLDER_LEVELS.has(level.toLowerCase()) ? course : `${course} (${level})`;
};

export interface SyncReasonGroup {
    reason: string;
    count: number;
    /** Distinct course names, first seen first. */
    names: string[];
}

/** Skipped or switched-off versions grouped by reason, most common first (ties keep first-seen order). */
export const groupSyncItemsByReason = (items: (SyncCourseRef & { reason: string })[]): SyncReasonGroup[] => {
    const groups = new Map<string, SyncReasonGroup>();
    for (const item of items) {
        let group = groups.get(item.reason);
        if (!group) {
            group = { reason: item.reason, count: 0, names: [] };
            groups.set(item.reason, group);
        }
        group.count += 1;
        const name = syncCourseName(item);
        if (name && !group.names.includes(name)) group.names.push(name);
    }
    return [...groups.values()]
        .map((group, index) => ({ group, index }))
        .sort((a, b) => b.group.count - a.group.count || a.index - b.index)
        .map(({ group }) => group);
};

/** "Yoga, Vedas, Gita and 4 more" — the first `max` names. */
export const listCourseNames = (names: string[], max = 3): string =>
    names.length <= max ? names.join(', ') : `${names.slice(0, max).join(', ')} and ${names.length - max} more`;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One line for a summary header: "Added 12 course versions · switched off 2 · 3 not added". */
export const syncSummaryLine = (r: Pick<CatalogueSyncResult, 'added' | 'deactivated' | 'skipped'>): string => {
    const parts = [
        r.added ? `Added ${plural(r.added, 'course version', 'course versions')}` : 'Nothing new to add',
    ];
    if (r.deactivated) parts.push(`switched off ${r.deactivated}`);
    if (r.skipped.length) parts.push(`${r.skipped.length} not added`);
    return parts.join(' · ');
};
