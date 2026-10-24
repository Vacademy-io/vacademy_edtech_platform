import { z } from 'zod';

/**
 * URL search-param contract for /audience-manager/recent-leads.
 *
 * The Recent Leads filters are URL-driven (mirrors the Follow-ups page):
 * the page initializes its filter state from these params and writes them
 * back with `navigate({ search, replace: true })` on every change, so
 * reloads restore the same view and other surfaces (Lead Reports, Sales
 * Dashboard) can deep-link into a pre-filtered list.
 *
 * Sentinel values are shared from here so drill-through links and the page
 * itself can never drift apart.
 */

// ── Sentinel filter values (also the URL param values) ────────────────
export const ALL_AUDIENCES_VALUE = '__ALL__';
export const ALL_TIERS_VALUE = '__ALL__';
export const ALL_ACTIVE_VALUE = '__ACTIVE__'; // all leads except Converted
export const ALL_STATUSES_VALUE = '__ALL_STATUS__'; // every lead regardless of status (default — enrolled leads stay visible unless LEAD_SETTING.hideConvertedInAllLeads is on)
export const ALL_CONVERTED_VALUE = '__CONVERTED__'; // only leads enrolled into a course
export const ALL_SLA_VALUE = '__ALL_SLA__'; // every lead regardless of SLA stage
export const ALL_COUNSELLORS_VALUE = '__ALL_COUNSELLORS__';
// Sentinel for the counsellor dropdown's "Unassigned" entry — narrows to leads
// with no owner on either linked_users (ENQUIRY) or user_lead_profile. Sent to
// the backend as `is_unassigned: true` (assigned_counselor_id omitted).
export const UNASSIGNED_COUNSELLOR_VALUE = '__UNASSIGNED__';

// Date-range presets. `range` holds a preset day-count ('1' | '7' | '15' |
// '30'), 'ALL' (no date filter) or 'CUSTOM' (read `from` / `to`).
export const ALL_DATE_VALUE = 'ALL';
export const CUSTOM_DATE_VALUE = 'CUSTOM';
export const DEFAULT_RANGE_DAYS = '30';

/**
 * A search param that is conceptually a string but must survive arriving as a number.
 *
 * TanStack Router JSON-parses every search value, so a hand-written URL — which is
 * exactly what an institute's sidebar sub-tab is — turns `?statusExclude=1` into the
 * NUMBER 1. A plain `z.string()` then rejects it, and because validateSearch runs during
 * route matching the whole page dies on the error boundary before it renders anything.
 * That is what "Processed (Touched) Leads" was doing. `range=7`, `calledWithin=24` and
 * `calledCount=3` were all one sub-tab away from the same crash.
 *
 * The app's own navigations were unaffected: the router JSON-stringifies what it writes,
 * so its values come back quoted and already strings.
 */
const looseString = z.union([z.string(), z.number()]).transform(String);

export const RecentLeadsSearchSchema = z.object({
    /** Lead-status filter — comma-separated status_keys or sentinels (ALL_ACTIVE / ALL_CONVERTED). */
    status: looseString.optional(),
    /** Tier filter — comma-separated HOT/WARM/COLD values. */
    tier: looseString.optional(),
    /** SLA filter — comma-separated SLA stage values. */
    sla: looseString.optional(),
    /** Assigned counsellor userIds — comma-separated, may include __UNASSIGNED__. */
    counsellor: looseString.optional(),
    /** Audience (campaign) ids — comma-separated. */
    audience: looseString.optional(),
    /** Campaign types — comma-separated audience.campaign_type values. Narrows the
     *  audience dropdown and the leads to audiences of these types. */
    campaignType: looseString.optional(),
    /** Free-text search query (applied, not the live input). */
    search: looseString.optional(),
    /** Date-range preset — '1' | '7' | '15' | '30' | 'ALL' | 'CUSTOM'. */
    range: looseString.optional(),
    /** Custom-range start (yyyy-MM-dd) — only meaningful when range=CUSTOM. */
    from: looseString.pipe(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
    /** Custom-range end (yyyy-MM-dd) — only meaningful when range=CUSTOM. */
    to: looseString.pipe(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
    /** Lead source type — WEBSITE / META / GOOGLE / ORGANIC / … (LeadFilterDTO.sourceType). */
    source: looseString.optional(),
    /** Call-history filter — NOT_CALLED / CALLED / CALLED_ONCE / CALLED_TWICE_PLUS /
     *  CALLED_N_TIMES / CALLED_N_PLUS_TIMES / AI_CALLED / MANUAL_CALLED. */
    called: looseString.optional(),
    /** Attempt count N for called=CALLED_N_TIMES / CALLED_N_PLUS_TIMES. Kept as a
     *  string like every other param here; the page clamps it to 1–99 on read. */
    calledCount: looseString.optional(),
    /** "Called within the last N hours" — preset hour-count ('24' | '168' | '360' |
     *  '720'). Rolling from now, unlike `range`, which buckets by calendar day.
     *  Bounds the last CALL on the lead, not its submission. */
    calledWithin: looseString.optional(),
    /** "Worked within the last N hours" — same presets as calledWithin, but bounds the
     *  last timeline activity of any kind (note, status change, logged call). */
    workedWithin: looseString.optional(),
    /** Explicit from–to for `calledWithin` / `workedWithin` when they hold 'CUSTOM'
     *  (yyyy-mm-dd, same shape as `from`/`to`). Both ends are inclusive calendar days,
     *  unlike the rolling presets. */
    /** Comma-separated filter names this ROUTE owns (see pinned-filters.ts). They
     *  survive "Clear all" and render read-only, so a sidebar sub-tab keeps meaning
     *  what its label says. Absent = nothing pinned, i.e. the old behaviour. */
    /** When '1', the picked statuses mean "everything EXCEPT these". */
    statusExclude: looseString.optional(),
    /** Route-owned duplicate filter: 'exclude' hides enquiries flagged as duplicates of a lead
     *  they repeat (so a repeat does not add to the count), 'only' lists just them (a
     *  Duplicate Leads tab). Absent = no filter. */
    duplicates: looseString.optional(),
    lock: looseString.optional(),
    calledFrom: looseString.optional(),
    calledTo: looseString.optional(),
    workedFrom: looseString.optional(),
    workedTo: looseString.optional(),
    /** Campaign (UTM) filters — comma-separated values per dimension. Only
     *  honoured while the institute's UTM setting is on (the controls that
     *  read them render nothing otherwise). The Reports Center's UTM tab
     *  drills through with these. */
    utmSource: looseString.optional(),
    utmMedium: looseString.optional(),
    utmCampaign: looseString.optional(),
    utmContent: looseString.optional(),
    utmTerm: looseString.optional(),
    utmChannel: looseString.optional(),
});

/** URL param per UTM dimension — shared by the page and its drill-through links. */
export const UTM_SEARCH_PARAM = {
    source: 'utmSource',
    medium: 'utmMedium',
    campaign: 'utmCampaign',
    content: 'utmContent',
    term: 'utmTerm',
    source_type: 'utmChannel',
} as const;

export type RecentLeadsSearch = z.infer<typeof RecentLeadsSearchSchema>;
