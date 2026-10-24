import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

/**
 * URL state for the Reports Center — the active tab lives in the URL
 * (?tab=sources) so reloads and deep links land on the same report.
 */
export const REPORT_TABS = [
    'overview',
    'sources',
    'utm',
    'funnel',
    'dispositions',
    'calling',
    'lead-calls',
    'call-intelligence',
    'activity',
    'followups',
    'counsellors',
    'manager',
    'revenue',
    'cohort',
    'forecast',
    'custom',
] as const;

export type ReportTab = (typeof REPORT_TABS)[number];

const ReportsSearchSchema = z.object({
    /** Active tab — defaults to 'overview' when omitted or invalid. */
    tab: z.enum(REPORT_TABS).optional().catch(undefined),
});

export type ReportsSearch = z.infer<typeof ReportsSearchSchema>;

export const Route = createFileRoute('/audience-manager/reports/')({
    component: () => null,
    validateSearch: ReportsSearchSchema,
});
