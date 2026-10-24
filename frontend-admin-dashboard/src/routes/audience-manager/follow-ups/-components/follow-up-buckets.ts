import type { LeadCardVM } from '@/components/shared/leads';

/**
 * follow-up-buckets — client-side classifier that splits leads into
 * Pending (overdue) / Today / Upcoming buckets for the Follow-ups page.
 *
 * UI-only stand-in: when a server `is_pending_follow_up` filter + bucket counts
 * endpoint lands later, swap the page's call to `classify(...)` for a server
 * value. The page layout doesn't change because the bucket vocabulary is the
 * same.
 */

/**
 * 'completed' is the odd one out: the other four are slices of work still open
 * and come from the leads query, while completed follow-ups are events and come
 * from their own endpoint. It lives in the same vocabulary because it is the
 * same row of cards to the user.
 */
export type FollowUpBucket = 'overdue' | 'today' | 'upcoming' | 'all' | 'completed';

/** The buckets that can be derived from a lead on screen. Completed cannot: it
 *  counts closed follow-up events, which the leads query never returns. */
export type PendingFollowUpBucket = Exclude<FollowUpBucket, 'completed'>;

/**
 * Effective due time for a lead — prefer the next follow-up deadline; fall back
 * to the first-touch TAT deadline (no counsellor activity yet). Returns
 * `+Infinity` when both are missing so such rows sink to the bottom of any sort.
 */
export const effectiveDueMs = (vm: LeadCardVM): number => {
    const raw = vm.followUpDueAt ?? vm.tatDueAt;
    if (!raw) return Number.POSITIVE_INFINITY;
    // Backend serialises Timestamps as bare ISO strings without a TZ marker.
    // Treat them as UTC so a local user sees the right wall-clock.
    const hasTimezone = /Z$|[+-]\d{2}:?\d{2}$/i.test(raw);
    const normalized = hasTimezone ? raw : `${raw.replace(' ', 'T')}Z`;
    const t = Date.parse(normalized);
    return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
};

/** True when the lead has any pending SLA — first-touch or follow-up. */
export const isPendingFollowUp = (vm: LeadCardVM): boolean => !!vm.tatDueAt || !!vm.followUpDueAt;

/** Classify a lead into a bucket based on its effective due time and the SLA flags. */
export const classify = (vm: LeadCardVM, now: Date = new Date()): PendingFollowUpBucket => {
    if (vm.tatOverdue || vm.followUpOverdue) return 'overdue';
    const dueMs = effectiveDueMs(vm);
    if (!Number.isFinite(dueMs)) return 'upcoming';
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);
    if (dueMs < startOfToday.getTime()) return 'overdue';
    if (dueMs <= endOfToday.getTime()) return 'today';
    return 'upcoming';
};

/** Counts per bucket across an array of VMs (current page only). `all` = vms.length. */
export const bucketCounts = (
    vms: LeadCardVM[],
    now: Date = new Date()
): Record<PendingFollowUpBucket, number> => {
    const counts: Record<PendingFollowUpBucket, number> = {
        overdue: 0,
        today: 0,
        upcoming: 0,
        all: vms.length,
    };
    for (const vm of vms) {
        const b = classify(vm, now);
        if (b !== 'all') counts[b] += 1;
    }
    return counts;
};

/**
 * The schedule_time window a bucket stands for, in the USER's clock. Sent to the server so
 * counts and paging are over the whole institute rather than whatever happened to be on the
 * first fetched page — and so an Asia/Kolkata counsellor's "today" is their today.
 */
export const bucketWindow = (
    bucket: FollowUpBucket,
    now: Date = new Date()
): { from?: string; to?: string } => {
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);
    switch (bucket) {
        case 'overdue':
            return { to: now.toISOString() };
        case 'today':
            return { from: now.toISOString(), to: endOfToday.toISOString() };
        case 'upcoming':
            return { from: endOfToday.toISOString() };
        // 'completed' never reaches the leads query, and 'all' means no window.
        default:
            return {};
    }
};

/**
 * A bucket's window narrowed by the due-date filter: the later `from`, the earlier `to`.
 * A range outside the bucket (Upcoming + last week) comes back with from > to, which the
 * server answers with nothing — the right answer, not an error.
 */
export const intersectWindows = (
    a: { from?: string; to?: string },
    b: { from?: string; to?: string }
): { from?: string; to?: string } => {
    const later = (x?: string, y?: string) => (!x ? y : !y ? x : x > y ? x : y);
    const earlier = (x?: string, y?: string) => (!x ? y : !y ? x : x < y ? x : y);
    return { from: later(a.from, b.from), to: earlier(a.to, b.to) };
};

/** Filter VMs to a specific bucket (or all). */
export const filterToBucket = (
    vms: LeadCardVM[],
    bucket: FollowUpBucket,
    now: Date = new Date()
): LeadCardVM[] => (bucket === 'all' ? vms : vms.filter((vm) => classify(vm, now) === bucket));
