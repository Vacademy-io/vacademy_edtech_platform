import { format } from 'date-fns';
import type { LeadCardVM } from '@/components/shared/leads';
import {
    classify,
    effectiveDueMs,
    type FollowUpBucket,
    type PendingFollowUpBucket,
} from './follow-up-buckets';

/**
 * Calendar helpers for the Follow-ups month grid.
 *
 * Mirrors the bucket vocabulary from `follow-up-buckets.ts` (overdue / today /
 * upcoming) and surfaces them visually as design-system token classes — no raw
 * hex, no arbitrary Tailwind values.
 */

/**
 * Resolve a lead's calendar date — prefer `followUpDueAt`, fall back to
 * `tatDueAt`. Returns `null` when neither is set (those leads do not appear on
 * the calendar). UTC normalisation is handled inside `effectiveDueMs`.
 */
export const dueDate = (vm: LeadCardVM): Date | null => {
    const ms = effectiveDueMs(vm);
    if (!Number.isFinite(ms)) return null;
    return new Date(ms);
};

/** Group VMs by `yyyy-MM-dd` in the local timezone (calendar grid is local). */
export const groupByDay = (vms: LeadCardVM[]): Map<string, LeadCardVM[]> => {
    const map = new Map<string, LeadCardVM[]>();
    for (const vm of vms) {
        const d = dueDate(vm);
        if (!d) continue;
        const key = format(d, 'yyyy-MM-dd');
        const list = map.get(key);
        if (list) list.push(vm);
        else map.set(key, [vm]);
    }
    return map;
};

/** Dominant bucket for a day: overdue > today > upcoming. Drives the cell's pill colour. */
export const dominantBucket = (vms: LeadCardVM[], now: Date = new Date()): FollowUpBucket => {
    let hasToday = false;
    for (const vm of vms) {
        const b = classify(vm, now);
        if (b === 'overdue') return 'overdue';
        if (b === 'today') hasToday = true;
    }
    return hasToday ? 'today' : 'upcoming';
};

/**
 * Tailwind class string for a bucket's event pill — token-only (semantic
 * danger/warning/info/success palettes from `index.css`). Used by both the
 * per-day pills inside calendar cells and the per-lead pills inside the
 * selected-day panel.
 */
export const bucketPillClasses = (bucket: FollowUpBucket): string => {
    switch (bucket) {
        case 'overdue':
            return 'bg-danger-100 text-danger-600 border-danger-200';
        case 'today':
            return 'bg-warning-100 text-warning-600 border-warning-200';
        case 'upcoming':
            return 'bg-info-100 text-info-600 border-info-200';
        default:
            return 'bg-muted text-muted-foreground border-border';
    }
};

/** Human-readable bucket label (for the day panel header). */
export const bucketLabel = (bucket: FollowUpBucket): string => {
    switch (bucket) {
        case 'overdue':
            return 'Overdue';
        case 'today':
            return 'Due today';
        case 'upcoming':
            return 'Upcoming';
        default:
            return 'All';
    }
};

/** Bucket counts for a single day's VMs (used in the selected-day panel header). */
export const dayBucketCounts = (
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
