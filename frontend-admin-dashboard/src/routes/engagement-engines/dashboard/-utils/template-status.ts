import type { TFunction } from 'i18next';
import { DASH, humanizeKey } from './report-format';

/*
 * New WhatsApp templates: the server's raw review states folded into the six buckets the daily
 * report counts (and the Templates list filters by), so a figure on the report and the rows
 * behind it always agree.
 */

export const TEMPLATE_BUCKETS = [
    'in_review',
    'approved_by_you',
    'with_meta',
    'live',
    'rejected',
    'withdrawn',
] as const;
export type TemplateBucket = (typeof TEMPLATE_BUCKETS)[number];

const BUCKET_OF: Record<string, TemplateBucket> = {
    // Waiting for the admin.
    AI_PROPOSED: 'in_review',
    USER_REVIEW: 'in_review',
    // Approved by the admin, not yet sent to Meta.
    USER_APPROVED: 'approved_by_you',
    // Sent to Meta, waiting for its decision.
    SUBMITTED: 'with_meta',
    META_PENDING: 'with_meta',
    // Meta said yes (possibly in another category).
    META_APPROVED: 'live',
    META_RECATEGORISED: 'live',
    META_REJECTED: 'rejected',
    META_DISABLED: 'rejected',
    WITHDRAWN: 'withdrawn',
    SUPERSEDED: 'withdrawn',
};

/** The bucket of a raw status; null for a status this page does not know. */
export const templateBucket = (status: string | null | undefined): TemplateBucket | null =>
    (status && BUCKET_OF[status.trim().toUpperCase()]) || null;

/** The visual weight of a bucket: Live is good, Rejected is bad, In review needs the admin. */
export type TemplateTone = 'success' | 'danger' | 'warning' | 'neutral';

export const BUCKET_TONE: Record<TemplateBucket, TemplateTone> = {
    in_review: 'warning',
    approved_by_you: 'neutral',
    with_meta: 'neutral',
    live: 'success',
    rejected: 'danger',
    withdrawn: 'neutral',
};

/** "In review", "With Meta", "Live", ...; an unknown status shows as its own words, none as a dash. */
export const templateStatusLabel = (status: string | null | undefined, t: TFunction): string => {
    const bucket = templateBucket(status);
    if (bucket) return t(`templateStatus.${bucket}`);
    return status?.trim() ? humanizeKey(status) : DASH;
};

/** MARKETING, Utility, authentication... as the words the report uses; empty is a dash. */
export const templateCategoryLabel = (
    category: string | null | undefined,
    t: TFunction
): string => {
    const key = category?.trim();
    if (!key) return DASH;
    return t(`whatsappCategory.${key.toLowerCase()}`, { defaultValue: humanizeKey(key) });
};

/** True when Meta put the template in another category than the engine proposed. */
export const categoryChanged = (
    proposed: string | null | undefined,
    meta: string | null | undefined
): boolean => {
    const a = proposed?.trim().toUpperCase();
    const b = meta?.trim().toUpperCase();
    return !!a && !!b && a !== b;
};
