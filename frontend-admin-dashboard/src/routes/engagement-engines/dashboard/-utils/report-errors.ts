import type { TFunction } from 'i18next';
import { humanizeKey } from './report-format';

/*
 * The server builds the report from independent queries and lists the ones that failed in
 * `errors`, by query name (lists, runs, outreach, calls, costs, whatsappCost, creditBalance,
 * statusChanges, conversions, demos, delivery, replies). One screen section can draw on several queries, so
 * this maps each section to the queries it needs. A name that matches a section directly
 * (a response field such as "funnel") also counts, in case the server starts using those.
 */

export type ReportPart =
    | 'funnel'
    | 'trend'
    | 'channels'
    | 'costChart'
    | 'perEngine'
    | 'lists'
    | 'runs'
    | 'calls'
    | 'email'
    | 'templates'
    | 'outcomes'
    | 'statusChanges'
    | 'costs'
    | 'whatsappCost'
    | 'realCost';

const PART_DEPS: Record<ReportPart, string[]> = {
    funnel: ['outreach', 'calls', 'delivery', 'replies', 'demos', 'conversions'],
    trend: ['outreach', 'calls', 'lists', 'replies', 'costs', 'demos'],
    channels: ['outreach', 'calls', 'delivery', 'replies', 'costs'],
    costChart: ['costs', 'calls', 'lists'],
    perEngine: ['lists', 'outreach', 'calls', 'replies', 'demos', 'conversions', 'costs'],
    lists: ['lists'],
    runs: ['runs'],
    calls: ['calls'],
    email: ['outreach', 'delivery'],
    templates: ['outreach', 'delivery', 'replies'],
    outcomes: ['demos', 'conversions'],
    statusChanges: ['statusChanges'],
    costs: ['costs', 'calls', 'lists', 'runs'],
    // The WhatsApp charges come from the messages sent and their delivery receipts.
    whatsappCost: ['outreach', 'delivery'],
    realCost: ['costs', 'calls', 'lists', 'runs'],
};

const KPI_DEPS: Record<string, string[]> = {
    peopleAdded: ['lists'],
    messagesSent: ['outreach'],
    replies: ['outreach', 'replies'],
    callsConnected: ['calls'],
    demosBooked: ['demos'],
    conversions: ['conversions'],
    creditsSpent: ['costs', 'calls', 'lists'],
    costPerDemo: ['costs', 'calls', 'lists', 'demos'],
};

type Errors = Record<string, string>;

/** True when a query this screen section needs failed, so its numbers cannot be trusted. */
export const partFailed = (errors: Errors, part: ReportPart): boolean =>
    part in errors || PART_DEPS[part].some((name) => name in errors);

/** Same, for one headline card. */
export const kpiFailed = (errors: Errors, kpi: string): boolean =>
    'summary' in errors || (KPI_DEPS[kpi] ?? []).some((name) => name in errors);

/** Plain names of what failed, for the notice and the exports. */
export const failedSectionNames = (errors: Errors, t: TFunction): string =>
    Object.keys(errors)
        .map((name) => t(`errorSection.${name}`, { defaultValue: humanizeKey(name) }))
        .join(', ');
