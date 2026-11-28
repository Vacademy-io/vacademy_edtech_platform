import type { TFunction } from 'i18next';
import type {
    DiagnosisLink,
    DiagnosisProblem,
    DiagnosisSeverity,
} from '@/services/engagement-diagnosis';
import { INBOX_OUTCOME_KEYS } from '../../-constants';
import type { OutcomeTab } from './outcomes-params';
import { formatRunway } from './report-health';
import { DASH, formatNumber, formatRate, humanizeKey } from './report-format';
import type { InboxLinkOutcome, ReportLinks, ReportLinkTarget } from './report-links';

/*
 * One problem from the diagnosis, as a row of words: a title, the evidence from its numbers, the
 * advice and where to look. The wording lives in the locale file under `diagnosis.problem.<CODE>`;
 * this file knows which numbers each code's sentence uses and what its link opens.
 */

interface ProblemCodeSpec {
    /** The `numbers` keys the evidence sentence uses. One the server left out reads as a dash. */
    keys: readonly string[];
    /** The `numbers` key whose value picks "1 message" or "5 messages". */
    count?: string;
    /** How a `breakdown` key is worded: a WhatsApp failure reason, or free text. */
    breakdown?: 'whatsappReason' | 'text';
    /** The link opens only the template or subject named in `names`, not the whole channel. */
    narrowByName?: boolean;
}

/** The rule catalogue (docs/engagement/ENGAGEMENT_DIAGNOSIS.md). A code not listed here is unknown. */
export const PROBLEM_CODES: Record<string, ProblemCodeSpec> = {
    LEADS_MISSING_CONTACT: { keys: ['neither', 'added', 'noPhone'] },
    LEAD_AGENT_NOT_DELIVERING: { keys: ['discovered', 'rejected', 'review'] },
    LEAD_SOURCE_WEAK: { keys: ['leads', 'responseRate', 'overallRate'] },
    CALLS_NOT_GOING_OUT: { keys: ['notDialled', 'placed'] },
    CONNECT_RATE_LOW: { keys: ['connected', 'placed', 'rate', 'baselineRate'] },
    SHORT_CALLS: { keys: ['under20s', 'connected', 'share'] },
    CALL_HOUR_WEAK: {
        keys: ['hour', 'placed', 'connectRate', 'overallRate', 'bestHour', 'bestRate'],
    },
    OBJECTION_RECURRING: { keys: ['count', 'analysed'] },
    WHATSAPP_FAILED_HIGH: { keys: ['failed', 'tried', 'rate'], breakdown: 'whatsappReason' },
    TEMPLATE_UNDERPERFORMING: {
        keys: ['sent', 'replyRate', 'channelRate'],
        narrowByName: true,
    },
    EMAIL_BOUNCE_HIGH: { keys: ['bounced', 'sent', 'rate'] },
    EMAIL_COMPLAINTS: { keys: ['complained', 'sent'], count: 'complained' },
    SUBJECT_UNDERPERFORMING: {
        keys: ['sent', 'replyRate', 'channelRate'],
        narrowByName: true,
    },
    ENGINE_ACTIONS_FAILING: { keys: ['failed', 'decisions', 'rate'], breakdown: 'text' },
    DOUBLE_CONTACT: { keys: ['people', 'contacted'], count: 'people' },
    SENT_AFTER_REPLY: { keys: ['sends'], count: 'sends' },
    CREDITS_LOW: { keys: ['runwayDays'] },
    MEMBERS_STUCK: { keys: ['members'], count: 'members' },
};

const specOf = (code: string): ProblemCodeSpec | undefined =>
    Object.prototype.hasOwnProperty.call(PROBLEM_CODES, code) ? PROBLEM_CODES[code] : undefined;

export const isKnownProblemCode = (code: string): boolean => specOf(code) !== undefined;

// ─── figures ────────────────────────────────────────────────────────────────

/** `rate`, `share` and every `…Rate` are fractions 0..1. */
const RATE_KEY = /^(rate|share)$|Rate$/;
const HOUR_KEY = /^(hour|bestHour)$/;

/** 14 is "14:00". */
export const hourLabel = (hour: number): string =>
    `${String(Math.trunc(hour)).padStart(2, '0')}:00`;

/** One number from `numbers`, worded by what its key is: a rate, an hour or a count. */
export const formatFigure = (key: string, value: number | undefined): string => {
    if (value === undefined || !Number.isFinite(value)) return DASH;
    if (RATE_KEY.test(key)) return formatRate(value);
    if (HOUR_KEY.test(key)) return hourLabel(value);
    return formatNumber(value);
};

/** `noPhone` is "No phone". For a key the page has no wording for. */
const figureLabel = (key: string): string => {
    const words = key
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/_/g, ' ')
        .toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1);
};

const clip = (value: string, max: number): string =>
    value.length > max ? `${value.slice(0, max - 1)}…` : value;

/** Names are listed up to this many, then "and 2 more". */
const NAMES_SHOWN = 3;
const BREAKDOWN_SHOWN = 3;

const namesText = (names: string[], t: TFunction): string => {
    const clean = names.map((n) => n.trim()).filter(Boolean);
    if (clean.length === 0) return DASH;
    if (clean.length <= NAMES_SHOWN) return clean.join(', ');
    return t('diagnosis.names.more', {
        list: clean.slice(0, NAMES_SHOWN).join(', '),
        count: clean.length - NAMES_SHOWN,
    });
};

// ─── the link ───────────────────────────────────────────────────────────────

/**
 * What an ITEMS link opens: the tab of the Leads & outcomes page that lists those people. The
 * kinds are the report's drill-down kinds (`ReportItemsKind`).
 */
const ITEMS_TAB: Record<string, { tab: OutcomeTab; filter?: string }> = {
    LEADS_ADDED: { tab: 'leads' },
    DEMOS_BOOKED: { tab: 'demos' },
    DEMOS_SCHEDULED: { tab: 'demos', filter: 'scheduled' },
    STATUS_CHANGES: { tab: 'status' },
    CONVERSIONS: { tab: 'conversions' },
    TEMPLATES_CREATED: { tab: 'templates' },
};

const INBOX_OUTCOMES: readonly string[] = INBOX_OUTCOME_KEYS;

/**
 * Where a problem leads, through the report's link helpers, so it carries the page's engine and
 * period. The contract's two targets:
 * - OUTCOMES (channel, optional outcome): the sent messages or calls of that channel and what
 *   happened to them. That is the Task Inbox, the only page that filters by channel and outcome.
 *   "failed" opens its Failed tab, as the report's channel table does: a send Meta refuses moves
 *   there within minutes, next to the ones rejected before Meta, so that tab is what the count holds.
 * - ITEMS (kind): the people behind a number, on the Leads & outcomes page.
 * Anything else, or no link, is no link.
 */
export const problemLink = (
    problem: Pick<DiagnosisProblem, 'code' | 'names' | 'link'>,
    links: ReportLinks
): ReportLinkTarget | null => {
    const link = problem.link;
    if (!link) return null;
    if (link.target === 'OUTCOMES') {
        if (link.outcome === 'failed') {
            return links.inbox({ filter: 'failed', channel: link.channel ?? undefined });
        }
        const name = specOf(problem.code)?.narrowByName ? problem.names[0]?.trim() : undefined;
        return links.inbox({
            filter: 'sent',
            channel: link.channel ?? undefined,
            outcome:
                link.outcome && INBOX_OUTCOMES.includes(link.outcome)
                    ? (link.outcome as InboxLinkOutcome)
                    : undefined,
            template: name || undefined,
        });
    }
    if (link.target === 'ITEMS') {
        const items = link.kind ? ITEMS_TAB[link.kind] : undefined;
        return items ? links.outcomes(items.tab, items.filter) : null;
    }
    return null;
};

const linkLabelKey = (link: DiagnosisLink): string => {
    if (link.target === 'ITEMS') return link.kind === 'LEADS_ADDED' ? 'leads' : 'people';
    if (link.channel === 'AI_CALL') return 'calls';
    return link.channel ? 'messages' : 'generic';
};

// ─── the row ────────────────────────────────────────────────────────────────

export interface ProblemRowView {
    key: string;
    code: string;
    /** False for a code a newer backend added: the row is generic, not wrong. */
    known: boolean;
    stage: string;
    stageLabel: string;
    severity: DiagnosisSeverity;
    title: string;
    /** The numbers in one short sentence; empty when the problem came with none. */
    evidence: string;
    /** The biggest few entries, biggest first. */
    breakdown: Array<{ key: string; label: string; count: string }>;
    advice: string;
    link: ReportLinkTarget | null;
    linkLabel: string | null;
}

const stageLabel = (stage: string, t: TFunction): string =>
    t(`diagnosis.stage.${stage}`, { defaultValue: humanizeKey(stage) });

const breakdownLabel = (spec: ProblemCodeSpec | undefined, key: string, t: TFunction): string => {
    if (spec?.breakdown === 'whatsappReason') {
        return t(`diagnosis.whatsappReason.${key}`, { defaultValue: humanizeKey(key) });
    }
    // A code such as OTHER is worded; free text (an error message) is shown as it came, cut short.
    return /^[A-Z0-9_]+$/.test(key) ? humanizeKey(key) : clip(key, 80);
};

/**
 * What the wording of a code can name: every number from `numbers`, worded by its key, plus the
 * names (`{{name}}`) and the credits runway. A number the server left out reads as a dash.
 */
const wordingValues = (
    problem: DiagnosisProblem,
    spec: ProblemCodeSpec,
    t: TFunction
): Record<string, string | number> => {
    const values: Record<string, string | number> = {};
    for (const key of spec.keys) values[key] = DASH;
    for (const [key, value] of Object.entries(problem.numbers)) {
        values[key] = formatFigure(key, value);
    }
    values.name = namesText(problem.names, t);
    values.runway = formatRunway(problem.numbers.runwayDays, t);
    // The count picks "1 message" or "5 messages" (the singular and plural keys of the sentence).
    const count = spec.count ? problem.numbers[spec.count] : undefined;
    if (count !== undefined) values.count = count;
    return values;
};

/** The numbers of a code the page has no wording for, in one line: "Failed 40 · Tried 120". */
const unknownEvidence = (problem: DiagnosisProblem): string =>
    Object.entries(problem.numbers)
        .slice(0, 3)
        .map(([key, value]) => `${figureLabel(key)} ${formatFigure(key, value)}`)
        .join(' · ');

/** The rows for a list of problems, in the order the API sent them (it has already ranked them). */
export const buildProblemRows = (
    problems: DiagnosisProblem[],
    ctx: { t: TFunction; links: ReportLinks }
): ProblemRowView[] => {
    const { t, links } = ctx;
    return problems.map((problem, index) => {
        const spec = specOf(problem.code);
        const values = spec ? wordingValues(problem, spec, t) : {};
        const link = problemLink(problem, links);
        const wording = (part: 'title' | 'evidence' | 'advice') =>
            t(`diagnosis.problem.${problem.code}.${part}`, values);
        return {
            key: `${problem.code}-${index}`,
            code: problem.code,
            known: !!spec,
            stage: problem.stage,
            stageLabel: stageLabel(problem.stage, t),
            severity: problem.severity,
            title: spec
                ? wording('title')
                : t('diagnosis.problem.unknown.title', { name: humanizeKey(problem.code) }),
            evidence: spec ? wording('evidence') : unknownEvidence(problem),
            breakdown: [...problem.breakdown]
                .sort((a, b) => b.count - a.count)
                .slice(0, BREAKDOWN_SHOWN)
                .map((b) => ({
                    key: b.key,
                    label: breakdownLabel(spec, b.key, t),
                    count: formatNumber(b.count),
                })),
            advice: spec ? wording('advice') : t('diagnosis.problem.unknown.advice'),
            link,
            linkLabel:
                link && problem.link ? t(`diagnosis.link.${linkLabelKey(problem.link)}`) : null,
        };
    });
};

/** The most problems a view lists: 5 for a day, 10 for a week. The server caps them too. */
export const PROBLEM_LIMIT = { DAILY: 5, WEEKLY: 10 } as const;

/**
 * The first `limit` rows, in the order the API sent them, and how many more there were. The API
 * already caps its list; this keeps a longer one from filling the top of the page.
 */
export const capProblems = (
    rows: ProblemRowView[],
    moreProblems: number,
    limit: number
): { problems: ProblemRowView[]; moreProblems: number } => ({
    problems: rows.slice(0, limit),
    moreProblems: moreProblems + Math.max(0, rows.length - limit),
});
