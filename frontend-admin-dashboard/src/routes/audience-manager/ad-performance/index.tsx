import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

/**
 * URL state for the Ad performance screen (all connected Meta + Google ad accounts).
 *   range  — preset window; 'season' = 1 April of the current academic year → today.
 *   from   — custom window start (yyyy-MM-dd), used when range = 'custom'.
 *   to     — custom window end (yyyy-MM-dd, inclusive).
 *   metric — what the "by day" chart stacks per platform.
 * The OAuth return params (mkt_session, mkt_provider, mkt_error) are read straight from
 * window.location by use-oauth-return, not through this schema.
 */
export const AD_RANGES = ['7d', '30d', 'season', 'custom'] as const;
export type AdRange = (typeof AD_RANGES)[number];

export const AD_METRICS = ['enquiries', 'spend', 'admissions'] as const;
export type AdMetric = (typeof AD_METRICS)[number];

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const AdPerformanceSearchSchema = z.object({
    range: z.enum(AD_RANGES).optional().catch(undefined),
    from: isoDay.optional().catch(undefined),
    to: isoDay.optional().catch(undefined),
    metric: z.enum(AD_METRICS).optional().catch(undefined),
});

export type AdPerformanceSearch = z.infer<typeof AdPerformanceSearchSchema>;

export const Route = createFileRoute('/audience-manager/ad-performance/')({
    component: () => null,
    validateSearch: AdPerformanceSearchSchema,
});
