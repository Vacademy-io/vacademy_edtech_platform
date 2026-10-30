import type { ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { CrmLink } from '@/routes/dashboard/-components/crm/crm-cards';
import type {
    DailyReportChannelRow,
    DailyReportEngineRow,
    DailyReportListRow,
    DailyReportTemplateRow,
    DailyReportWhatsappCategory,
    EngagementDailyReport,
} from '@/services/engagement-daily-report';
import {
    DASH,
    formatCredits,
    formatDay,
    formatDuration,
    formatMinutes,
    formatMoney,
    formatMoneyPartial,
    formatNumber,
    formatRate,
    humanizeKey,
} from './report-format';
import { partFailed, type ReportPart } from './report-errors';
import type { ReportTerms } from './report-terms';

/*
 * One description of every table and stat block on the page. The screen renders it
 * (MyTable and a stat grid) and the Excel and PDF exports flatten the same description,
 * so a column can never differ between what is shown and what is downloaded.
 */

export type CellTone = 'danger' | 'warning' | 'success' | 'muted';

export interface ReportColumn<R> {
    id: string;
    header: string;
    /** Number column: right-aligned. */
    numeric?: boolean;
    size?: number;
    /** Long text wraps to two lines instead of being cut off. */
    wrap?: boolean;
    /** Only in the Excel and PDF exports (detail the screen shows another way). */
    exportOnly?: boolean;
    /** What the cell shows, and what the PDF prints. */
    text: (row: R) => string;
    /** What Excel stores (numbers stay numbers). Falls back to `text`. */
    value?: (row: R) => string | number | null;
    /** Present = the header sorts by this value (null sorts last). */
    sort?: (row: R) => number | string | null;
    tone?: (row: R) => CellTone | undefined;
    render?: (row: R) => ReactNode;
}

export interface ReportTableSpec<R> {
    /** The part of the page this belongs to (see report-errors.ts). */
    key: ReportPart;
    title: string;
    subtitle?: string;
    sheetName: string;
    columns: ReportColumn<R>[];
    rows: R[];
    defaultSort?: { id: string; dir: 'asc' | 'desc' };
    /** Order for rows that tie on the sorted column. */
    tieBreak?: (a: R, b: R) => number;
    /** Rows that always stay at the end, whatever the sort (a "rest of the rows" total). */
    pinLast?: (row: R) => boolean;
}

export interface ReportStat {
    key: string;
    label: string;
    text: string;
    value?: number | string | null;
    tone?: CellTone;
    hint?: string;
    badge?: string;
}

export interface ReportStatsSpec {
    key: ReportPart;
    title: string;
    subtitle?: string;
    /** A line of explanation under the figures. */
    note?: string;
    /** A short tooltip beside the note. */
    noteHint?: string;
    sheetName: string;
    stats: ReportStat[];
}

export interface ReportCtx {
    t: TFunction;
    channelLabel: (channel: string) => string;
    terms: ReportTerms;
}

// ─── column helpers ─────────────────────────────────────────────────────────

/** Default width of a number column (px). Kept tight so a table fits the page at 1440px. */
const NUMBER_SIZE = 96;

/** A reply rate means nothing for a row that sent nothing. */
const noSends = <R extends { sent: number }>(row: R): boolean => row.sent === 0;

interface NumberColumnOptions<R> {
    format?: (n: number | null | undefined) => string;
    /** Export the number itself even though a custom `format` shows text. */
    raw?: boolean;
    size?: number;
    sortable?: boolean;
    /** The figure is not recorded, so the cell says "Not tracked" instead of a misleading 0. */
    untracked?: (row: R) => boolean;
    /** The figure does not apply to this row. */
    notApplicable?: (row: R) => boolean;
    tone?: (row: R) => CellTone | undefined;
}

const numberColumn = <R,>(
    ctx: ReportCtx,
    id: string,
    header: string,
    get: (row: R) => number | null | undefined,
    options: NumberColumnOptions<R> = {}
): ReportColumn<R> => {
    const format = options.format ?? formatNumber;
    const raw = options.raw ?? !options.format;
    const notTracked = ctx.t('notTracked');
    const na = (row: R) => options.notApplicable?.(row) ?? false;
    // "Does not apply" wins over "not tracked": a dash says there is nothing to track.
    const off = (row: R) => !na(row) && (options.untracked?.(row) ?? false);
    return {
        id,
        header,
        numeric: true,
        size: options.size ?? NUMBER_SIZE,
        text: (row) => (off(row) ? notTracked : na(row) ? DASH : format(get(row))),
        value: (row) =>
            off(row) ? notTracked : na(row) ? null : raw ? get(row) ?? null : format(get(row)),
        sort: options.sortable
            ? (row) => (off(row) || na(row) ? null : get(row) ?? null)
            : undefined,
        tone: (row) => (off(row) ? 'muted' : na(row) ? undefined : options.tone?.(row)),
    };
};

const textColumn = <R,>(
    id: string,
    header: string,
    text: (row: R) => string,
    options: {
        size?: number;
        wrap?: boolean;
        sortable?: boolean;
        render?: (row: R) => ReactNode;
    } = {}
): ReportColumn<R> => ({
    id,
    header,
    size: options.size ?? 160,
    wrap: options.wrap,
    text,
    render: options.render,
    sort: options.sortable ? text : undefined,
});

const stat = (
    key: string,
    label: string,
    text: string,
    extra: Partial<ReportStat> = {}
): ReportStat => ({ key, label, text, ...extra });

const countStat = (
    ctx: ReportCtx,
    key: string,
    label: string,
    n: number | null | undefined,
    extra: { untracked?: boolean; tone?: CellTone; hint?: string } = {}
): ReportStat =>
    extra.untracked
        ? stat(key, label, ctx.t('notTracked'), {
              value: ctx.t('notTracked'),
              tone: 'muted',
              hint: extra.hint,
          })
        : stat(key, label, formatNumber(n), {
              value: n ?? null,
              tone: extra.tone,
              hint: extra.hint,
          });

// ─── the sections ───────────────────────────────────────────────────────────

const buildPerEngine = (
    data: EngagementDailyReport,
    ctx: ReportCtx
): ReportTableSpec<DailyReportEngineRow> => {
    const { t } = ctx;
    const nameOf = (r: DailyReportEngineRow) => (r.system ? t('filter.systemEngine') : r.name);
    return {
        key: 'perEngine',
        title: t('perEngine.title'),
        subtitle: t('perEngine.subtitle'),
        sheetName: t('sheet.engines'),
        rows: data.perEngine,
        defaultSort: { id: 'sent', dir: 'desc' },
        columns: [
            textColumn('name', t('perEngine.col.engine'), nameOf, {
                size: 200,
                wrap: true,
                sortable: true,
                render: (r) =>
                    r.system || !r.engineId ? (
                        nameOf(r)
                    ) : (
                        <CrmLink
                            href={`/engagement-engines/${r.engineId}`}
                            className="line-clamp-2 break-words font-semibold text-neutral-900 hover:text-primary-600"
                        >
                            {r.name}
                        </CrmLink>
                    ),
            }),
            numberColumn(ctx, 'leadsAdded', t('perEngine.col.added'), (r) => r.leadsAdded, {
                sortable: true,
            }),
            numberColumn(ctx, 'sent', t('perEngine.col.sent'), (r) => r.sent, {
                sortable: true,
                size: 80,
            }),
            numberColumn(ctx, 'replies', t('perEngine.col.replies'), (r) => r.replies, {
                sortable: true,
                size: 88,
            }),
            numberColumn(ctx, 'replyRate', t('perEngine.col.replyRate'), (r) => r.replyRate, {
                format: formatRate,
                sortable: true,
                notApplicable: noSends,
            }),
            numberColumn(ctx, 'demos', t('perEngine.col.demos'), (r) => r.demosBooked, {
                sortable: true,
                size: 88,
            }),
            numberColumn(ctx, 'conversions', t('perEngine.col.conversions'), (r) => r.conversions, {
                sortable: true,
                size: 120,
            }),
            numberColumn(ctx, 'credits', t('perEngine.col.credits'), (r) => r.credits, {
                format: formatCredits,
                raw: true,
                sortable: true,
                size: 88,
            }),
            numberColumn(
                ctx,
                'costPerReply',
                t('perEngine.col.costPerReply'),
                (r) => r.costPerReply,
                { format: formatCredits, raw: true, sortable: true, size: 104 }
            ),
        ],
    };
};

const buildLists = (
    data: EngagementDailyReport,
    ctx: ReportCtx
): ReportTableSpec<DailyReportListRow> => {
    const { t, terms } = ctx;
    // Batch and individual groups come from the server with English names, so they are
    // renamed here with the institute's own words.
    // A list that was deleted after people joined it has no name any more.
    const nameOf = (r: DailyReportListRow) =>
        r.kind === 'BATCH' || r.listId === 'BATCH'
            ? t('lists.batchMembers', { batch: terms.batch })
            : r.kind === 'USERS' || r.listId === 'USERS'
              ? t('lists.individuals')
              : r.name?.trim() || t('lists.deleted', { list: terms.list.toLowerCase() });
    const agent = (r: DailyReportListRow) => r.leadAgent;
    const exportOnly = <R,>(column: ReportColumn<R>): ReportColumn<R> => ({
        ...column,
        exportOnly: true,
    });
    // The Lead Agent's day-by-day counters, kept in the exports only: the screen shows the
    // same figures in a line under each row instead of eight more columns.
    const agentCounts: Array<[string, string, (r: DailyReportListRow) => number | undefined]> = [
        ['agentDiscovered', t('lists.col.discovered'), (r) => agent(r)?.discovered],
        ['agentResearched', t('lists.col.researched'), (r) => agent(r)?.researched],
        ['agentReview', t('lists.col.review'), (r) => agent(r)?.review],
        ['agentRejected', t('lists.col.rejected'), (r) => agent(r)?.rejected],
        ['agentInCrm', t('lists.col.alreadyInCrm'), (r) => agent(r)?.alreadyInCrm],
        ['agentSearches', t('lists.col.searches'), (r) => agent(r)?.searches],
        ['agentPages', t('lists.col.pages'), (r) => agent(r)?.pages],
    ];
    return {
        key: 'lists',
        title: t('lists.title', { list: terms.list }),
        subtitle: t('lists.subtitle', { list: terms.list }),
        sheetName: t('sheet.lists', { lists: terms.lists }),
        rows: data.lists,
        defaultSort: { id: 'leadsAdded', dir: 'desc' },
        columns: [
            textColumn('name', t('lists.col.name', { list: terms.list }), nameOf, {
                size: 260,
                wrap: true,
                sortable: true,
            }),
            numberColumn(ctx, 'leadsAdded', t('lists.col.added'), (r) => r.leadsAdded, {
                sortable: true,
            }),
            numberColumn(ctx, 'newLeads', t('lists.col.new'), (r) => r.newLeads),
            numberColumn(ctx, 'existingLeads', t('lists.col.existing'), (r) => r.existingLeads),
            numberColumn(
                ctx,
                'agentDelivered',
                t('lists.col.agentDelivered'),
                (r) => agent(r)?.delivered,
                { size: 150 }
            ),
            exportOnly(
                textColumn<DailyReportListRow>(
                    'agentName',
                    t('lists.col.agentName'),
                    (r) => agent(r)?.name ?? DASH
                )
            ),
            ...agentCounts.map(([id, label, get]) => exportOnly(numberColumn(ctx, id, label, get))),
            exportOnly(
                numberColumn<DailyReportListRow>(
                    ctx,
                    'agentCredits',
                    t('lists.col.agentCredits'),
                    (r) => agent(r)?.credits,
                    { format: formatCredits, raw: true }
                )
            ),
        ],
    };
};

const KIND_ORDER = ['SEND', 'TASK', 'NO_OP', 'REPLY'];

interface KindRow {
    kind: string;
    count: number;
    share: number | null;
}
interface ErrorRow {
    message: string;
    count: number;
}

const buildRuns = (data: EngagementDailyReport, ctx: ReportCtx) => {
    const { t } = ctx;
    const runs = data.runs;
    if (!runs) return { stats: null, byKind: null, errors: null };
    const byKind = runs.byKind ?? {};
    const kinds = [...KIND_ORDER, ...Object.keys(byKind).filter((k) => !KIND_ORDER.includes(k))];
    const kindRows: KindRow[] = kinds
        .map((kind) => ({
            kind,
            count: byKind[kind] ?? 0,
            share: runs.decisions > 0 ? (byKind[kind] ?? 0) / runs.decisions : null,
        }))
        .filter((r) => r.count > 0 || KIND_ORDER.includes(r.kind));
    const stats: ReportStatsSpec = {
        key: 'runs',
        title: t('runs.title'),
        subtitle: t('runs.subtitle'),
        sheetName: t('sheet.runs'),
        stats: [
            countStat(ctx, 'decisions', t('runs.decisions'), runs.decisions, {
                hint: t('runs.decisionsHint'),
            }),
            countStat(ctx, 'evaluated', t('runs.evaluated'), runs.membersEvaluated),
            countStat(ctx, 'failed', t('runs.failed'), runs.failed, {
                tone: runs.failed > 0 ? 'danger' : undefined,
            }),
            countStat(ctx, 'expired', t('runs.expired'), runs.expired, {
                tone: runs.expired > 0 ? 'warning' : undefined,
                hint: t('runs.expiredHint'),
            }),
        ],
    };
    const byKindSpec: ReportTableSpec<KindRow> = {
        key: 'runs',
        title: t('runs.byKindTitle'),
        sheetName: t('sheet.decisions'),
        rows: kindRows,
        columns: [
            textColumn(
                'kind',
                t('runs.col.kind'),
                (r) => t(`runs.kind.${r.kind}`, { defaultValue: humanizeKey(r.kind) }),
                { size: 220 }
            ),
            numberColumn(ctx, 'count', t('runs.col.count'), (r) => r.count),
            numberColumn(ctx, 'share', t('runs.col.share'), (r) => r.share, { format: formatRate }),
        ],
    };
    const errorsSpec: ReportTableSpec<ErrorRow> = {
        key: 'runs',
        title: t('runs.errorsTitle'),
        sheetName: t('sheet.errors'),
        rows: runs.topErrors,
        columns: [
            textColumn('message', t('runs.col.error'), (r) => r.message, { size: 360, wrap: true }),
            numberColumn(ctx, 'count', t('runs.col.count'), (r) => r.count),
        ],
    };
    return { stats, byKind: byKindSpec, errors: errorsSpec };
};

const buildChannels = (
    data: EngagementDailyReport,
    ctx: ReportCtx
): ReportTableSpec<DailyReportChannelRow> => {
    const { t, channelLabel } = ctx;
    // Which figures this channel can report at all. Anything it cannot is "Not tracked",
    // never a 0 that would read as "nothing happened".
    const noDelivery = (r: DailyReportChannelRow) =>
        (r.channel === 'EMAIL' && data.email?.tracked === false) ||
        (r.channel === 'WHATSAPP' && data.whatsapp?.deliveryTracked === false);
    // Replies: email until inbound email is wired up, and in-app messages always.
    const noReplies = (r: DailyReportChannelRow) =>
        (r.channel === 'EMAIL' && data.email?.repliesTracked === false) || r.channel === 'IN_APP';
    // A call is not answered with a reply, so the figure does not exist for it.
    const noReplyFigure = (r: DailyReportChannelRow) => r.channel === 'AI_CALL';
    return {
        key: 'channels',
        title: t('channels.title'),
        subtitle: t('channels.subtitle'),
        sheetName: t('sheet.channels'),
        rows: data.channels,
        columns: [
            textColumn('channel', t('channels.col.channel'), (r) => channelLabel(r.channel), {
                size: 160,
            }),
            numberColumn(ctx, 'sent', t('channels.col.sent'), (r) => r.sent),
            numberColumn(ctx, 'delivered', t('channels.col.delivered'), (r) => r.delivered, {
                untracked: noDelivery,
            }),
            numberColumn(ctx, 'read', t('channels.col.read'), (r) => r.read, {
                untracked: noDelivery,
                notApplicable: (r) => r.channel === 'AI_CALL' || r.channel === 'IN_APP',
            }),
            numberColumn(ctx, 'replied', t('channels.col.replied'), (r) => r.replied, {
                untracked: noReplies,
                notApplicable: noReplyFigure,
            }),
            numberColumn(ctx, 'replyRate', t('channels.col.replyRate'), (r) => r.replyRate, {
                format: formatRate,
                untracked: noReplies,
                notApplicable: (r) => noReplyFigure(r) || noSends(r),
            }),
            // Failures known at send time are always counted, even when delivery receipts are not.
            numberColumn(ctx, 'failed', t('channels.col.failed'), (r) => r.failed, {
                tone: (r) => (r.failed > 0 ? 'danger' : undefined),
            }),
            numberColumn(ctx, 'credits', t('channels.col.credits'), (r) => r.credits, {
                format: formatCredits,
                raw: true,
            }),
        ],
    };
};

const buildCalls = (data: EngagementDailyReport, ctx: ReportCtx): ReportStatsSpec | null => {
    const { t } = ctx;
    const c = data.calls;
    if (!c) return null;
    return {
        key: 'calls',
        title: t('calls.title'),
        subtitle: t('calls.subtitle'),
        sheetName: t('sheet.calls'),
        stats: [
            countStat(ctx, 'placed', t('calls.placed'), c.placed),
            countStat(ctx, 'notDialled', t('calls.notDialled'), c.notDialled, {
                hint: t('calls.notDialledHint'),
            }),
            countStat(ctx, 'connected', t('calls.connected'), c.connected, {
                tone: c.connected > 0 ? 'success' : undefined,
                hint: t('calls.connectedHint'),
            }),
            countStat(ctx, 'noAnswer', t('calls.noAnswer'), c.noAnswer),
            countStat(ctx, 'busy', t('calls.busy'), c.busy, { hint: t('calls.busyHint') }),
            countStat(ctx, 'failed', t('calls.failed'), c.failed, {
                tone: c.failed > 0 ? 'danger' : undefined,
            }),
            countStat(ctx, 'inProgress', t('calls.inProgress'), c.inProgress),
            stat('talkTime', t('calls.talkTime'), formatMinutes(c.totalMinutes), {
                value: c.totalMinutes,
            }),
            // With nobody picking up there is no call length to average.
            c.connected === 0
                ? stat('avgDuration', t('calls.avgDuration'), DASH, { value: null })
                : stat('avgDuration', t('calls.avgDuration'), formatDuration(c.avgDurationSec), {
                      value: c.avgDurationSec,
                  }),
            stat('credits', t('calls.credits'), formatCredits(c.credits), { value: c.credits }),
        ],
    };
};

const buildEmail = (data: EngagementDailyReport, ctx: ReportCtx): ReportStatsSpec | null => {
    const { t } = ctx;
    const e = data.email;
    if (!e) return null;
    const off = !e.tracked;
    const rateTone: CellTone | undefined =
        e.bounceRate !== null && e.bounceRate >= 0.1
            ? 'danger'
            : e.bounceRate !== null && e.bounceRate >= 0.05
              ? 'warning'
              : undefined;
    return {
        key: 'email',
        title: t('email.title'),
        subtitle: t('email.subtitle'),
        note: !e.tracked
            ? t('email.trackingOffNote')
            : !e.repliesTracked
              ? t('email.repliesNote')
              : undefined,
        sheetName: t('sheet.email'),
        stats: [
            countStat(ctx, 'sent', t('email.sent'), e.sent),
            countStat(ctx, 'delivered', t('email.delivered'), e.delivered, { untracked: off }),
            countStat(ctx, 'opened', t('email.opened'), e.opened, {
                untracked: off,
                hint: t('email.openedHint'),
            }),
            countStat(ctx, 'clicked', t('email.clicked'), e.clicked, { untracked: off }),
            countStat(ctx, 'bounced', t('email.bounced'), e.bounced, {
                untracked: off,
                tone: e.bounced > 0 ? 'warning' : undefined,
                hint: t('email.bouncedHint'),
            }),
            countStat(ctx, 'complained', t('email.complained'), e.complained, {
                untracked: off,
                tone: e.complained > 0 ? 'danger' : undefined,
                hint: t('email.complainedHint'),
            }),
            off
                ? stat('bounceRate', t('email.bounceRate'), t('notTracked'), {
                      value: t('notTracked'),
                      tone: 'muted',
                  })
                : stat('bounceRate', t('email.bounceRate'), formatRate(e.bounceRate), {
                      value: formatRate(e.bounceRate),
                      tone: rateTone,
                      hint: t('email.bounceRateHint'),
                  }),
        ],
    };
};

/** The server returns at most this many template / subject rows. */
const TEMPLATES_CAP = 200;

/** What the server calls the rows it could not list one by one. */
const OTHER_ROW = '(other)';

const buildTemplates = (
    data: EngagementDailyReport,
    ctx: ReportCtx
): ReportTableSpec<DailyReportTemplateRow> => {
    const { t, channelLabel } = ctx;
    const isEmail = (r: DailyReportTemplateRow) => r.channel === 'EMAIL';
    const isOther = (r: DailyReportTemplateRow) => r.name?.trim().toLowerCase() === OTHER_ROW;
    // The server fills these in when a message has no template name or no subject.
    const nameOf = (r: DailyReportTemplateRow) => {
        const key = r.name?.trim().toLowerCase();
        if (key === OTHER_ROW) return t('templates.other');
        if (key === '(no template)') return t('templates.noTemplate');
        if (key === '(no subject)') return t('templates.noSubject');
        return r.name;
    };
    // The "other" rows go last in the exports too; the screen keeps them last when sorting.
    const rows = [...data.templates.filter((r) => !isOther(r)), ...data.templates.filter(isOther)];
    const noDelivery = (r: DailyReportTemplateRow) =>
        (isEmail(r) && data.email?.tracked === false) ||
        (r.channel === 'WHATSAPP' && data.whatsapp?.deliveryTracked === false);
    const noReplies = (r: DailyReportTemplateRow) =>
        isEmail(r) && data.email?.repliesTracked === false;
    return {
        key: 'templates',
        title: t('templates.title'),
        subtitle:
            data.templates.length >= TEMPLATES_CAP
                ? `${t('templates.subtitle')} ${t('templates.capped', { count: TEMPLATES_CAP })}`
                : t('templates.subtitle'),
        sheetName: t('sheet.templates'),
        rows,
        pinLast: isOther,
        // Most-sent first: AI-written emails mostly have a different subject each time (one
        // send each), so a lowest-reply-rate default would bury the messages that matter.
        // Sorting by reply rate is one click on the header.
        defaultSort: { id: 'sent', dir: 'desc' },
        tieBreak: (a, b) => (b.replyRate ?? -1) - (a.replyRate ?? -1),
        columns: [
            textColumn('channel', t('templates.col.channel'), (r) => channelLabel(r.channel), {
                size: 104,
            }),
            textColumn('name', t('templates.col.name'), nameOf, { size: 240, wrap: true }),
            numberColumn(ctx, 'sent', t('templates.col.sent'), (r) => r.sent, {
                sortable: true,
                size: 80,
            }),
            numberColumn(ctx, 'delivered', t('templates.col.delivered'), (r) => r.delivered, {
                untracked: noDelivery,
                size: 104,
            }),
            numberColumn(ctx, 'read', t('templates.col.read'), (r) => r.read, {
                untracked: noDelivery,
                size: 80,
            }),
            numberColumn(ctx, 'replied', t('templates.col.replied'), (r) => r.replied, {
                untracked: noReplies,
                sortable: true,
                size: 96,
            }),
            numberColumn(ctx, 'replyRate', t('templates.col.replyRate'), (r) => r.replyRate, {
                format: formatRate,
                untracked: noReplies,
                notApplicable: noSends,
                sortable: true,
            }),
            numberColumn(ctx, 'bounced', t('templates.col.bounced'), (r) => r.bounced, {
                untracked: (r) => isEmail(r) && data.email?.tracked === false,
                notApplicable: (r) => !isEmail(r),
                sortable: true,
            }),
            {
                id: 'cost',
                header: t('templates.col.cost'),
                numeric: true,
                size: 96,
                text: (r) => (isEmail(r) ? DASH : formatMoney(r.cost, r.currency)),
            },
        ],
    };
};

interface StatusRow {
    from: string;
    to: string;
    byEngine: number;
    byTeam: number;
    byAutomation: number;
    total: number;
}

const buildOutcomes = (data: EngagementDailyReport, ctx: ReportCtx) => {
    const { t } = ctx;
    const o = data.outcomes;
    if (!o) return { stats: null, statusChanges: null };
    const stats: ReportStatsSpec = {
        key: 'outcomes',
        title: t('outcomes.title'),
        subtitle: t('outcomes.subtitle'),
        sheetName: t('sheet.outcomes'),
        stats: [
            countStat(ctx, 'demosBooked', t('outcomes.demosBooked'), o.demosBooked, {
                hint: t('outcomes.demosBookedHint'),
            }),
            countStat(ctx, 'demosScheduled', t('outcomes.demosScheduled'), o.demosScheduled, {
                hint: t('outcomes.demosScheduledHint'),
            }),
            countStat(ctx, 'demosDone', t('outcomes.demosDone'), o.demosDone),
            countStat(ctx, 'demosNoShow', t('outcomes.demosNoShow'), o.demosNoShow, {
                tone: o.demosNoShow > 0 ? 'warning' : undefined,
            }),
            countStat(ctx, 'demosNotMarked', t('outcomes.demosNotMarked'), o.demosNotMarked, {
                hint: t('outcomes.demosNotMarkedHint'),
            }),
            countStat(ctx, 'conversions', t('outcomes.conversions'), o.conversions, {
                tone: o.conversions > 0 ? 'success' : undefined,
                hint: t('outcomes.conversionsHint'),
            }),
        ],
    };
    // Older responses have no "by automation" figure, so the column only appears when they do.
    const hasAutomation = o.statusChanges.some((r) => typeof r.byAutomation === 'number');
    const rows: StatusRow[] = o.statusChanges
        .map((r) => ({
            from: r.from || t('statusChanges.noStatus'),
            to: r.to || t('statusChanges.noStatus'),
            byEngine: r.byEngine,
            byTeam: r.byTeam,
            byAutomation: r.byAutomation ?? 0,
            total: r.byEngine + r.byTeam + (r.byAutomation ?? 0),
        }))
        .sort((a, b) => b.total - a.total);
    const statusChanges: ReportTableSpec<StatusRow> = {
        key: 'statusChanges',
        title: t('statusChanges.title'),
        subtitle: t('statusChanges.subtitle'),
        sheetName: t('sheet.statusChanges'),
        rows,
        columns: [
            textColumn('from', t('statusChanges.col.from'), (r) => r.from, {
                size: 200,
                wrap: true,
            }),
            textColumn('to', t('statusChanges.col.to'), (r) => r.to, { size: 200, wrap: true }),
            numberColumn(ctx, 'byEngine', t('statusChanges.col.byEngine'), (r) => r.byEngine),
            numberColumn(ctx, 'byTeam', t('statusChanges.col.byTeam'), (r) => r.byTeam),
            ...(hasAutomation
                ? [
                      numberColumn<StatusRow>(
                          ctx,
                          'byAutomation',
                          t('statusChanges.col.byAutomation'),
                          (r) => r.byAutomation,
                          { size: 112 }
                      ),
                  ]
                : []),
            numberColumn(ctx, 'total', t('statusChanges.col.total'), (r) => r.total),
        ],
    };
    return { stats, statusChanges };
};

interface CreditRow {
    key: string;
    label: string;
    credits: number;
    share: number | null;
}

const buildCosts = (data: EngagementDailyReport, ctx: ReportCtx) => {
    const { t } = ctx;
    const c = data.costs;
    if (!c) return { credits: null, whatsapp: null, categories: null, ai: null };

    const total = c.credits.total;
    const share = (n: number) => (total > 0 ? n / total : null);
    const creditRows: CreditRow[] = [
        { key: 'messages', label: t('costs.credits.messages'), credits: c.credits.messages },
        { key: 'calls', label: t('costs.credits.calls'), credits: c.credits.calls },
        { key: 'leadAgent', label: t('costs.credits.leadAgent'), credits: c.credits.leadAgent },
        { key: 'total', label: t('costs.credits.total'), credits: total },
    ].map((r) => ({ ...r, share: r.key === 'total' ? (total > 0 ? 1 : null) : share(r.credits) }));
    const credits: ReportTableSpec<CreditRow> = {
        key: 'costs',
        title: t('costs.credits.title'),
        subtitle: t('costs.credits.subtitle'),
        sheetName: t('sheet.costCredits'),
        rows: creditRows,
        columns: [
            textColumn('label', t('costs.credits.col.where'), (r) => r.label, { size: 200 }),
            numberColumn(ctx, 'credits', t('costs.credits.col.credits'), (r) => r.credits, {
                format: formatCredits,
                raw: true,
            }),
            numberColumn(ctx, 'share', t('costs.credits.col.share'), (r) => r.share, {
                format: formatRate,
            }),
        ],
    };

    const w = c.whatsapp;
    // The charges depend on the messages sent and their receipts, so they have their own part.
    const amountText = formatMoneyPartial(w.amount, w.currency, w.partial, t);
    const whatsapp: ReportStatsSpec = {
        key: 'whatsappCost',
        title: t('costs.whatsapp.title'),
        subtitle: t('costs.whatsapp.subtitle'),
        sheetName: t('sheet.costWhatsapp'),
        stats: [
            stat('amount', t('costs.whatsapp.amount'), amountText, {
                // A partial total is stored as text so the "at least" reaches Excel too.
                value: w.partial ? amountText : w.amount,
                badge: w.estimatedMessages > 0 ? t('estimated') : undefined,
                hint: w.partial
                    ? t('costs.whatsapp.partialHint')
                    : w.estimatedMessages > 0
                      ? t('costs.whatsapp.estimatedHint')
                      : undefined,
            }),
            countStat(ctx, 'billable', t('costs.whatsapp.billable'), w.billableMessages, {
                hint: t('costs.whatsapp.billableHint'),
            }),
            ...(w.estimatedMessages > 0
                ? [countStat(ctx, 'estimated', t('costs.whatsapp.estimated'), w.estimatedMessages)]
                : []),
            ...(w.missingRate > 0
                ? [
                      countStat(
                          ctx,
                          'missingRate',
                          t('costs.whatsapp.missingRate'),
                          w.missingRate,
                          { tone: 'warning', hint: t('costs.whatsapp.missingRateHint') }
                      ),
                  ]
                : []),
        ],
    };

    const categories: ReportTableSpec<DailyReportWhatsappCategory> = {
        key: 'whatsappCost',
        title: t('costs.whatsapp.byCategoryTitle'),
        sheetName: t('sheet.costWhatsappCategories'),
        rows: data.whatsapp?.byCategory ?? [],
        columns: [
            textColumn(
                'category',
                t('costs.whatsapp.col.category'),
                (r) =>
                    t(`whatsappCategory.${r.category}`, { defaultValue: humanizeKey(r.category) }),
                { size: 112 }
            ),
            numberColumn(ctx, 'count', t('costs.whatsapp.col.messages'), (r) => r.count, {
                size: 88,
            }),
            {
                id: 'rate',
                header: t('costs.whatsapp.col.rate'),
                numeric: true,
                size: 88,
                text: (r) => formatMoney(r.rate, r.currency),
            },
            {
                id: 'cost',
                header: t('costs.whatsapp.col.cost'),
                numeric: true,
                size: 96,
                text: (r) => formatMoney(r.cost, r.currency),
            },
            textColumn(
                'basis',
                t('costs.whatsapp.col.basis'),
                (r) =>
                    r.estimated
                        ? t('costs.whatsapp.basisEstimated')
                        : t('costs.whatsapp.basisReported'),
                { size: 96 }
            ),
        ],
    };

    // Token counts exist only from the day the server started saving them. With no date at
    // all nothing has been recorded yet, which reads as "no usage", not "not tracked".
    const since = c.ai.trackedSince;
    const beforeTracking = !!since && !!data.date && data.date < since;
    const ai: ReportStatsSpec = {
        key: 'costs',
        title: t('costs.ai.title'),
        subtitle: t('costs.ai.subtitle'),
        note: since
            ? t('costs.ai.trackedSince', { date: formatDay(since) })
            : t('costs.ai.noUsage'),
        noteHint: since ? undefined : t('costs.ai.trackingStartedHint'),
        sheetName: t('sheet.costAi'),
        stats: [
            countStat(ctx, 'tokensIn', t('costs.ai.tokensIn'), c.ai.tokensIn, {
                untracked: beforeTracking,
                hint: t('costs.ai.tokensInHint'),
            }),
            countStat(ctx, 'tokensOut', t('costs.ai.tokensOut'), c.ai.tokensOut, {
                untracked: beforeTracking,
                hint: t('costs.ai.tokensOutHint'),
            }),
            countStat(ctx, 'decisions', t('costs.ai.decisions'), c.ai.decisionsWithUsage, {
                untracked: beforeTracking,
            }),
        ],
    };
    return { credits, whatsapp, categories, ai };
};

const buildRealCost = (data: EngagementDailyReport, ctx: ReportCtx): ReportStatsSpec | null => {
    const { t } = ctx;
    const r = data.realCost;
    if (!r) return null;
    const usd = (key: string, label: string, n: number | null, hint?: string) =>
        n === null || n === undefined
            ? stat(key, label, t('realCost.notRecorded'), {
                  value: t('realCost.notRecorded'),
                  tone: 'muted',
                  hint,
              })
            : stat(key, label, formatMoney(n, 'USD'), { value: n, hint });
    return {
        key: 'realCost',
        title: t('realCost.title'),
        subtitle: t('realCost.subtitle'),
        sheetName: t('sheet.realCost'),
        stats: [
            usd('ai', t('realCost.ai'), r.aiUsd, t('realCost.aiHint')),
            usd('leadAgent', t('realCost.leadAgent'), r.leadAgentUsd, t('realCost.leadAgentHint')),
            usd('calls', t('realCost.calls'), r.callsUsd, t('realCost.callsHint')),
            usd('total', t('realCost.total'), r.totalUsd),
        ],
    };
};

// ─── the model ──────────────────────────────────────────────────────────────

export interface ReportModel {
    perEngine: ReportTableSpec<DailyReportEngineRow>;
    lists: ReportTableSpec<DailyReportListRow>;
    runsStats: ReportStatsSpec | null;
    runsByKind: ReportTableSpec<KindRow> | null;
    runsErrors: ReportTableSpec<ErrorRow> | null;
    channels: ReportTableSpec<DailyReportChannelRow>;
    calls: ReportStatsSpec | null;
    email: ReportStatsSpec | null;
    templates: ReportTableSpec<DailyReportTemplateRow>;
    outcomes: ReportStatsSpec | null;
    statusChanges: ReportTableSpec<StatusRow> | null;
    costCredits: ReportTableSpec<CreditRow> | null;
    costWhatsapp: ReportStatsSpec | null;
    costWhatsappCategories: ReportTableSpec<DailyReportWhatsappCategory> | null;
    costAi: ReportStatsSpec | null;
    realCost: ReportStatsSpec | null;
}

export const buildReportModel = (data: EngagementDailyReport, ctx: ReportCtx): ReportModel => {
    const runs = buildRuns(data, ctx);
    const outcomes = buildOutcomes(data, ctx);
    const costs = buildCosts(data, ctx);
    return {
        perEngine: buildPerEngine(data, ctx),
        lists: buildLists(data, ctx),
        runsStats: runs.stats,
        runsByKind: runs.byKind,
        runsErrors: runs.errors,
        channels: buildChannels(data, ctx),
        calls: buildCalls(data, ctx),
        email: buildEmail(data, ctx),
        templates: buildTemplates(data, ctx),
        outcomes: outcomes.stats,
        statusChanges: outcomes.statusChanges,
        costCredits: costs.credits,
        costWhatsapp: costs.whatsapp,
        costWhatsappCategories: costs.categories,
        costAi: costs.ai,
        realCost: buildRealCost(data, ctx),
    };
};

// ─── flattening for Excel and PDF ───────────────────────────────────────────

export interface ExportTable {
    /** Part of the page, to skip parts that failed to load. */
    key: ReportPart;
    title: string;
    sheetName: string;
    head: string[];
    /** Right-aligned columns. */
    numeric: boolean[];
    /** What Excel stores. */
    body: Array<Array<string | number | null>>;
    /** What the PDF prints. */
    display: string[][];
}

export const tableToExport = <R,>(spec: ReportTableSpec<R>): ExportTable => {
    const columns = spec.columns;
    return {
        key: spec.key,
        title: spec.title,
        sheetName: spec.sheetName,
        head: columns.map((c) => c.header),
        numeric: columns.map((c) => !!c.numeric),
        body: spec.rows.map((row) => columns.map((c) => (c.value ? c.value(row) : c.text(row)))),
        display: spec.rows.map((row) => columns.map((c) => c.text(row))),
    };
};

export const statsToExport = (spec: ReportStatsSpec, t: TFunction): ExportTable => ({
    key: spec.key,
    title: spec.title,
    sheetName: spec.sheetName,
    head: [t('export.metric'), t('export.value')],
    numeric: [false, true],
    body: spec.stats.map((s) => [s.label, s.value ?? s.text]),
    display: spec.stats.map((s) => [s.label, s.badge ? `${s.text} (${s.badge})` : s.text]),
});

/** Every non-empty table and stat block, in page order, skipping sections that failed. */
export const buildExportTables = (
    model: ReportModel,
    data: EngagementDailyReport,
    t: TFunction
): ExportTable[] => {
    const failed = (key: ReportPart) => partFailed(data.errors, key);
    const out: ExportTable[] = [];
    const addTable = <R,>(spec: ReportTableSpec<R> | null, include = true) => {
        if (spec && include && spec.rows.length > 0 && !failed(spec.key)) {
            out.push(tableToExport(spec));
        }
    };
    const addStats = (spec: ReportStatsSpec | null) => {
        if (spec && !failed(spec.key)) out.push(statsToExport(spec, t));
    };
    addTable(model.perEngine, data.engineId === null);
    addTable(model.lists);
    addStats(model.runsStats);
    addTable(model.runsByKind);
    addTable(model.runsErrors);
    addTable(model.channels);
    addStats(model.calls);
    addStats(model.email);
    addTable(model.templates);
    addStats(model.outcomes);
    addTable(model.statusChanges);
    addTable(model.costCredits);
    addStats(model.costWhatsapp);
    addTable(model.costWhatsappCategories);
    addStats(model.costAi);
    addStats(model.realCost);
    return out;
};
