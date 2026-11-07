import { StatusChip } from '@/components/design-system/status-chips';
import type {
    DiagnosisCallHour,
    DiagnosisEmailSubject,
    DiagnosisLeadSource,
    DiagnosisMinimums,
    DiagnosisProblem,
    DiagnosisPromptChange,
    DiagnosisWeekly,
    DiagnosisWhatsappFailure,
    DiagnosisWhatsappTemplate,
} from '@/services/engagement-diagnosis';
import { hourLabel } from './diagnosis-problems';
import {
    flagVerdict,
    rowVerdict,
    verdictText,
    type RowVerdict,
    type VerdictUnit,
} from './diagnosis-verdict';
import { DASH, formatDateTimeInZone, formatNumber, formatRate, humanizeKey } from './report-format';
import {
    numberColumn,
    textColumn,
    type ReportColumn,
    type ReportCtx,
    type ReportStat,
    type ReportStatsSpec,
    type ReportTableSpec,
} from './report-tables';

/*
 * The weekly page's tables, described once like the daily report's (report-tables.tsx): the page
 * renders them with ReportTable and the Excel and PDF exports flatten the same description.
 *
 * A row without enough data keeps its numbers but says it needs more instead of a verdict (see
 * diagnosis-verdict.ts). Nothing here colours a row good or bad on its own.
 */

/** What the report cannot see this week, as the table cells need it. true = not tracked ("off"). */
export interface WeeklyTracking {
    emailDeliveryOff: boolean;
    whatsappDeliveryOff: boolean;
    /** Replies cannot be seen for the senders of this week's emails. */
    emailRepliesOff: boolean;
}

export interface LengthRow {
    key: 'under20s' | 's20to60' | 'over60';
    label: string;
    count: number;
    /** Share of the connected calls; null with none. */
    share: number | null;
}

export interface OutcomeRow {
    status: string;
    label: string;
    count: number;
    share: number | null;
}

export interface ObjectionRow {
    text: string;
    count: number;
}

export interface FailureRow extends DiagnosisWhatsappFailure {
    label: string;
    share: number | null;
}

export interface WeeklyModel {
    minimums: DiagnosisMinimums;
    sources: ReportTableSpec<DiagnosisLeadSource>;
    callHours: ReportTableSpec<DiagnosisCallHour>;
    callLengths: ReportTableSpec<LengthRow> | null;
    callStats: ReportStatsSpec | null;
    callOutcomes: ReportTableSpec<OutcomeRow> | null;
    objections: ReportTableSpec<ObjectionRow> | null;
    whatsappFailures: ReportTableSpec<FailureRow>;
    whatsappTemplates: ReportTableSpec<DiagnosisWhatsappTemplate>;
    emailSubjects: ReportTableSpec<DiagnosisEmailSubject>;
    promptChanges: ReportTableSpec<DiagnosisPromptChange>;
    engineChecks: ReportStatsSpec | null;
}

const share = (part: number, whole: number): number | null => (whole > 0 ? part / whole : null);

/** A verdict in a cell: BEST and WORST and WEAK as chips, "Needs 100 sends" and the rest as plain words. */
function VerdictCell({ verdict, label }: { verdict: RowVerdict; label: string }) {
    if (verdict === 'BEST') {
        return <StatusChip text={label} textSize="text-caption" status="SUCCESS" />;
    }
    if (verdict === 'WORST') {
        return <StatusChip text={label} textSize="text-caption" status="DANGER" />;
    }
    if (verdict === 'WEAK') {
        return <StatusChip text={label} textSize="text-caption" status="WARNING" />;
    }
    return <span className="text-neutral-500">{label || DASH}</span>;
}

const verdictColumn = <R,>(
    ctx: ReportCtx,
    header: string,
    pick: (row: R) => RowVerdict,
    unit: VerdictUnit,
    need: number | null
): ReportColumn<R> => {
    const text = (row: R) => verdictText(pick(row), unit, need, ctx.t) || DASH;
    return {
        id: 'verdict',
        header,
        size: 150,
        text,
        render: (row) => <VerdictCell verdict={pick(row)} label={text(row)} />,
    };
};

// ─── leads and calling ──────────────────────────────────────────────────────

const buildSources = (
    weekly: DiagnosisWeekly,
    ctx: ReportCtx,
    problems: DiagnosisProblem[]
): ReportTableSpec<DiagnosisLeadSource> => {
    const { t } = ctx;
    const need = weekly.minimums.leadsPerSource;
    const weak = new Set(
        problems.filter((p) => p.code === 'LEAD_SOURCE_WEAK').flatMap((p) => p.names)
    );
    const pick = (r: DiagnosisLeadSource): RowVerdict => {
        const base = flagVerdict(r.enough, r.leads, need);
        return base === 'NONE' && weak.has(r.source) ? 'WEAK' : base;
    };
    const nameOf = (r: DiagnosisLeadSource) =>
        r.source === 'OTHER' ? t('diagnosis.weekly.sources.other') : r.source || DASH;
    return {
        key: 'diagnosis',
        title: t('diagnosis.weekly.sources.title'),
        subtitle: t('diagnosis.weekly.sources.subtitle'),
        sheetName: t('diagnosis.sheet.sources'),
        rows: weekly.leadSources,
        defaultSort: { id: 'leads', dir: 'desc' },
        columns: [
            textColumn('source', t('diagnosis.weekly.sources.col.source'), nameOf, {
                size: 200,
                wrap: true,
                sortable: true,
            }),
            numberColumn(ctx, 'leads', t('diagnosis.weekly.sources.col.leads'), (r) => r.leads, {
                sortable: true,
                size: 80,
            }),
            numberColumn(
                ctx,
                'contacted',
                t('diagnosis.weekly.sources.col.contacted'),
                (r) => r.contacted,
                { sortable: true, size: 100 }
            ),
            numberColumn(
                ctx,
                'responded',
                t('diagnosis.weekly.sources.col.responded'),
                (r) => r.responded,
                { sortable: true, size: 104 }
            ),
            numberColumn(
                ctx,
                'demosBooked',
                t('diagnosis.weekly.sources.col.demos'),
                (r) => r.demosBooked,
                { sortable: true, size: 88 }
            ),
            numberColumn(
                ctx,
                'contactRate',
                t('diagnosis.weekly.sources.col.contactRate'),
                (r) => r.contactRate,
                { format: formatRate, sortable: true, size: 104 }
            ),
            numberColumn(
                ctx,
                'responseRate',
                t('diagnosis.weekly.sources.col.responseRate'),
                (r) => r.responseRate,
                { format: formatRate, sortable: true, size: 112 }
            ),
            verdictColumn(ctx, t('diagnosis.weekly.col.status'), pick, 'leads', need),
        ],
    };
};

const buildCallHours = (
    weekly: DiagnosisWeekly,
    ctx: ReportCtx,
    problems: DiagnosisProblem[]
): ReportTableSpec<DiagnosisCallHour> => {
    const { t } = ctx;
    const need = weekly.minimums.callsPerHour;
    const weak = new Set(
        problems.filter((p) => p.code === 'CALL_HOUR_WEAK').map((p) => p.numbers.hour)
    );
    const pick = (r: DiagnosisCallHour): RowVerdict => {
        const base = flagVerdict(r.enough, r.placed, need);
        return base === 'NONE' && weak.has(r.hour) ? 'WEAK' : base;
    };
    return {
        key: 'diagnosis',
        title: t('diagnosis.weekly.hours.title'),
        subtitle: t('diagnosis.weekly.hours.subtitle'),
        sheetName: t('diagnosis.sheet.callHours'),
        rows: weekly.callHours,
        defaultSort: { id: 'hour', dir: 'asc' },
        columns: [
            textColumn('hour', t('diagnosis.weekly.hours.col.hour'), (r) => hourLabel(r.hour), {
                size: 90,
                sortable: true,
            }),
            numberColumn(ctx, 'placed', t('diagnosis.weekly.hours.col.placed'), (r) => r.placed, {
                sortable: true,
                size: 88,
            }),
            numberColumn(
                ctx,
                'connected',
                t('diagnosis.weekly.hours.col.connected'),
                (r) => r.connected,
                { sortable: true, size: 100 }
            ),
            numberColumn(
                ctx,
                'connectRate',
                t('diagnosis.weekly.hours.col.connectRate'),
                (r) => r.connectRate,
                { format: formatRate, sortable: true, size: 112 }
            ),
            verdictColumn(ctx, t('diagnosis.weekly.col.status'), pick, 'calls', need),
        ],
    };
};

const buildCallLengths = (weekly: DiagnosisWeekly, ctx: ReportCtx) => {
    const lengths = weekly.callLengths;
    if (!lengths) return null;
    const { t } = ctx;
    const rows: LengthRow[] = (['under20s', 's20to60', 'over60'] as const).map((key) => ({
        key,
        label: t(`diagnosis.weekly.lengths.${key}`),
        count: lengths[key],
        share: share(lengths[key], lengths.connected),
    }));
    const spec: ReportTableSpec<LengthRow> = {
        key: 'diagnosis',
        title: t('diagnosis.weekly.lengths.title'),
        subtitle: t('diagnosis.weekly.lengths.subtitle'),
        sheetName: t('diagnosis.sheet.callLengths'),
        rows: lengths.connected > 0 ? rows : [],
        columns: [
            textColumn('length', t('diagnosis.weekly.lengths.col.length'), (r) => r.label, {
                size: 160,
            }),
            numberColumn(ctx, 'count', t('diagnosis.weekly.lengths.col.calls'), (r) => r.count, {
                size: 88,
            }),
            numberColumn(ctx, 'share', t('diagnosis.weekly.lengths.col.share'), (r) => r.share, {
                format: formatRate,
                size: 120,
            }),
        ],
    };
    return spec;
};

const buildCallInsights = (weekly: DiagnosisWeekly, ctx: ReportCtx) => {
    const insights = weekly.callInsights;
    if (!insights) return { stats: null, outcomes: null, objections: null };
    const { t } = ctx;
    const stat = (key: string, label: string, n: number, hint?: string): ReportStat => ({
        key,
        label,
        text: formatNumber(n),
        value: n,
        hint,
    });
    const stats: ReportStatsSpec = {
        key: 'diagnosis',
        title: t('diagnosis.weekly.insights.title'),
        subtitle: t('diagnosis.weekly.insights.subtitle'),
        sheetName: t('diagnosis.sheet.callInsights'),
        stats: [
            stat('analysed', t('diagnosis.weekly.insights.analysed'), insights.analysed),
            stat(
                'positive',
                t('diagnosis.weekly.insights.positive'),
                insights.sentiment.POSITIVE ?? 0
            ),
            stat(
                'neutral',
                t('diagnosis.weekly.insights.neutral'),
                insights.sentiment.NEUTRAL ?? 0
            ),
            stat(
                'negative',
                t('diagnosis.weekly.insights.negative'),
                insights.sentiment.NEGATIVE ?? 0
            ),
            stat(
                'likely',
                t('diagnosis.weekly.insights.likely'),
                insights.highLikelihood,
                t('diagnosis.weekly.insights.likelyHint')
            ),
        ],
    };
    const outcomes: ReportTableSpec<OutcomeRow> = {
        key: 'diagnosis',
        title: t('diagnosis.weekly.insights.outcomes'),
        sheetName: t('diagnosis.sheet.callOutcomes'),
        rows: insights.outcomes.map((o) => ({
            status: o.status,
            label: t(`diagnosis.weekly.insights.outcome.${o.status}`, {
                defaultValue: humanizeKey(o.status),
            }),
            count: o.count,
            share: share(o.count, insights.analysed),
        })),
        defaultSort: { id: 'count', dir: 'desc' },
        columns: [
            textColumn('outcome', t('diagnosis.weekly.insights.col.outcome'), (r) => r.label, {
                size: 220,
                wrap: true,
            }),
            numberColumn(ctx, 'count', t('diagnosis.weekly.insights.col.calls'), (r) => r.count, {
                sortable: true,
                size: 88,
            }),
            numberColumn(ctx, 'share', t('diagnosis.weekly.insights.col.share'), (r) => r.share, {
                format: formatRate,
                size: 120,
            }),
        ],
    };
    const objections: ReportTableSpec<ObjectionRow> = {
        key: 'diagnosis',
        title: t('diagnosis.weekly.insights.objections'),
        subtitle: t('diagnosis.weekly.insights.objectionsSubtitle'),
        sheetName: t('diagnosis.sheet.objections'),
        rows: insights.topObjections.map((o) => ({ text: o.text, count: o.count })),
        columns: [
            textColumn('objection', t('diagnosis.weekly.insights.col.objection'), (r) => r.text, {
                size: 260,
                wrap: true,
            }),
            numberColumn(ctx, 'count', t('diagnosis.weekly.insights.col.calls'), (r) => r.count, {
                size: 88,
            }),
        ],
    };
    return { stats, outcomes, objections };
};

// ─── WhatsApp and email ─────────────────────────────────────────────────────

const buildFailures = (weekly: DiagnosisWeekly, ctx: ReportCtx): ReportTableSpec<FailureRow> => {
    const { t } = ctx;
    const total = weekly.whatsappFailures.reduce((sum, r) => sum + r.count, 0);
    return {
        key: 'diagnosis',
        title: t('diagnosis.weekly.failures.title'),
        subtitle: t('diagnosis.weekly.failures.subtitle'),
        sheetName: t('diagnosis.sheet.whatsappFailures'),
        rows: weekly.whatsappFailures.map((r) => ({
            ...r,
            label: t(`diagnosis.whatsappReason.${r.reason}`, {
                defaultValue: humanizeKey(r.reason),
            }),
            share: share(r.count, total),
        })),
        defaultSort: { id: 'count', dir: 'desc' },
        columns: [
            textColumn('reason', t('diagnosis.weekly.failures.col.reason'), (r) => r.label, {
                size: 240,
                wrap: true,
            }),
            textColumn('code', t('diagnosis.weekly.failures.col.code'), (r) => r.code ?? DASH, {
                size: 100,
            }),
            numberColumn(
                ctx,
                'count',
                t('diagnosis.weekly.failures.col.messages'),
                (r) => r.count,
                { sortable: true, size: 100 }
            ),
            numberColumn(ctx, 'share', t('diagnosis.weekly.failures.col.share'), (r) => r.share, {
                format: formatRate,
                size: 120,
            }),
        ],
    };
};

const buildTemplates = (
    weekly: DiagnosisWeekly,
    ctx: ReportCtx,
    tracking: WeeklyTracking
): ReportTableSpec<DiagnosisWhatsappTemplate> => {
    const { t, links } = ctx;
    const need = weekly.minimums.sendsPerRow;
    const pick = (r: DiagnosisWhatsappTemplate) => rowVerdict(r.verdict, r.sent, need);
    // The inbox finds a template's messages by its name; a row with no name has none to open.
    const messages = (r: DiagnosisWhatsappTemplate) =>
        r.name.trim()
            ? links.inbox({ filter: 'sent', channel: 'WHATSAPP', template: r.name })
            : null;
    const noDelivery = () => tracking.whatsappDeliveryOff;
    return {
        key: 'diagnosis',
        title: t('diagnosis.weekly.templates.title'),
        subtitle: t('diagnosis.weekly.templates.subtitle'),
        sheetName: t('diagnosis.sheet.whatsappTemplates'),
        rows: weekly.whatsappTemplates,
        defaultSort: { id: 'sent', dir: 'desc' },
        columns: [
            textColumn(
                'name',
                t('diagnosis.weekly.templates.col.template'),
                (r) => r.name || DASH,
                {
                    size: 220,
                    wrap: true,
                    sortable: true,
                }
            ),
            numberColumn(ctx, 'sent', t('diagnosis.weekly.col.sent'), (r) => r.sent, {
                sortable: true,
                size: 80,
                link: messages,
            }),
            numberColumn(
                ctx,
                'delivered',
                t('diagnosis.weekly.col.delivered'),
                (r) => r.delivered,
                {
                    sortable: true,
                    size: 96,
                    untracked: noDelivery,
                }
            ),
            numberColumn(ctx, 'read', t('diagnosis.weekly.col.read'), (r) => r.read, {
                sortable: true,
                size: 80,
                untracked: noDelivery,
            }),
            numberColumn(ctx, 'replied', t('diagnosis.weekly.col.replied'), (r) => r.replied, {
                sortable: true,
                size: 88,
            }),
            numberColumn(
                ctx,
                'replyRate',
                t('diagnosis.weekly.col.replyRate'),
                (r) => r.replyRate,
                {
                    format: formatRate,
                    sortable: true,
                    size: 104,
                }
            ),
            verdictColumn(ctx, t('diagnosis.weekly.col.verdict'), pick, 'sends', need),
        ],
    };
};

const buildSubjects = (
    weekly: DiagnosisWeekly,
    ctx: ReportCtx,
    tracking: WeeklyTracking
): ReportTableSpec<DiagnosisEmailSubject> => {
    const { t, links } = ctx;
    const need = weekly.minimums.sendsPerRow;
    const pick = (r: DiagnosisEmailSubject) => rowVerdict(r.verdict, r.sent, need);
    const messages = (r: DiagnosisEmailSubject) =>
        r.name.trim() ? links.inbox({ filter: 'sent', channel: 'EMAIL', template: r.name }) : null;
    const noDelivery = () => tracking.emailDeliveryOff;
    const noReplies = () => tracking.emailRepliesOff;
    return {
        key: 'diagnosis',
        title: t('diagnosis.weekly.subjects.title'),
        subtitle: t('diagnosis.weekly.subjects.subtitle'),
        sheetName: t('diagnosis.sheet.emailSubjects'),
        rows: weekly.emailSubjects,
        defaultSort: { id: 'sent', dir: 'desc' },
        columns: [
            textColumn('name', t('diagnosis.weekly.subjects.col.subject'), (r) => r.name || DASH, {
                size: 240,
                wrap: true,
                sortable: true,
            }),
            numberColumn(ctx, 'sent', t('diagnosis.weekly.col.sent'), (r) => r.sent, {
                sortable: true,
                size: 80,
                link: messages,
            }),
            numberColumn(
                ctx,
                'delivered',
                t('diagnosis.weekly.col.delivered'),
                (r) => r.delivered,
                {
                    sortable: true,
                    size: 96,
                    untracked: noDelivery,
                }
            ),
            numberColumn(ctx, 'clicked', t('diagnosis.weekly.col.clicked'), (r) => r.clicked, {
                sortable: true,
                size: 88,
                untracked: noDelivery,
            }),
            numberColumn(ctx, 'bounced', t('diagnosis.weekly.col.bounced'), (r) => r.bounced, {
                sortable: true,
                size: 88,
                untracked: noDelivery,
            }),
            numberColumn(ctx, 'replied', t('diagnosis.weekly.col.replied'), (r) => r.replied, {
                sortable: true,
                size: 88,
                untracked: noReplies,
            }),
            numberColumn(
                ctx,
                'clickRate',
                t('diagnosis.weekly.col.clickRate'),
                (r) => r.clickRate,
                {
                    format: formatRate,
                    sortable: true,
                    size: 104,
                    untracked: noDelivery,
                }
            ),
            numberColumn(
                ctx,
                'replyRate',
                t('diagnosis.weekly.col.replyRate'),
                (r) => r.replyRate,
                {
                    format: formatRate,
                    sortable: true,
                    size: 104,
                    untracked: noReplies,
                }
            ),
            verdictColumn(ctx, t('diagnosis.weekly.col.verdict'), pick, 'sends', need),
        ],
    };
};

// ─── the engine ─────────────────────────────────────────────────────────────

const buildEngineChecks = (weekly: DiagnosisWeekly, ctx: ReportCtx): ReportStatsSpec | null => {
    const checks = weekly.engineChecks;
    if (!checks) return null;
    const { t } = ctx;
    const stat = (key: keyof typeof checks, n: number | null): ReportStat => ({
        key,
        label: t(`diagnosis.weekly.checks.${key}.label`),
        exportLabel: t(`diagnosis.weekly.checks.${key}.exportLabel`),
        hint: t(`diagnosis.weekly.checks.${key}.hint`),
        text: formatNumber(n),
        value: n,
    });
    return {
        key: 'diagnosis',
        title: t('diagnosis.weekly.checks.title'),
        subtitle: t('diagnosis.weekly.checks.subtitle'),
        sheetName: t('diagnosis.sheet.engineChecks'),
        stats: [
            stat('doubleContact', checks.doubleContact),
            stat('sentAfterReply', checks.sentAfterReply),
            stat('stuckMembers', checks.stuckMembers),
        ],
    };
};

const buildPromptChanges = (
    weekly: DiagnosisWeekly,
    ctx: ReportCtx,
    timezone: string,
    engineId: string | null
): ReportTableSpec<DiagnosisPromptChange> => {
    const { t } = ctx;
    const need = weekly.minimums.sendsPerRow;
    const pick = (r: DiagnosisPromptChange) => flagVerdict(r.enough, r.sends, need);
    // With one engine picked every row is that engine, so its name is only worth a column when mixed.
    const engineColumn: ReportColumn<DiagnosisPromptChange>[] = engineId
        ? []
        : [
              textColumn(
                  'engine',
                  t('diagnosis.weekly.prompts.col.engine'),
                  (r) => r.engineName || DASH,
                  { size: 160, wrap: true }
              ),
          ];
    return {
        key: 'diagnosis',
        title: t('diagnosis.weekly.prompts.title'),
        subtitle: t('diagnosis.weekly.prompts.subtitle'),
        sheetName: t('diagnosis.sheet.promptChanges'),
        // Newest first, as the server sends them: no default sort.
        rows: weekly.promptChanges,
        columns: [
            ...engineColumn,
            textColumn(
                'version',
                t('diagnosis.weekly.prompts.col.version'),
                (r) => t('diagnosis.weekly.prompts.versionLabel', { version: r.version }),
                {
                    size: 72,
                }
            ),
            textColumn(
                'changedAt',
                t('diagnosis.weekly.prompts.col.changedAt'),
                (r) => formatDateTimeInZone(r.createdAt, timezone),
                { size: 160 }
            ),
            textColumn(
                'source',
                t('diagnosis.weekly.prompts.col.source'),
                (r) =>
                    r.source
                        ? t(`diagnosis.weekly.prompts.source.${r.source}`, {
                              defaultValue: humanizeKey(r.source),
                          })
                        : DASH,
                { size: 110 }
            ),
            textColumn(
                'change',
                t('diagnosis.weekly.prompts.col.change'),
                (r) => r.change || DASH,
                {
                    size: 320,
                    wrap: true,
                }
            ),
            numberColumn(ctx, 'sends', t('diagnosis.weekly.col.sent'), (r) => r.sends, {
                size: 80,
            }),
            numberColumn(ctx, 'replies', t('diagnosis.weekly.col.replied'), (r) => r.replies, {
                size: 88,
            }),
            numberColumn(
                ctx,
                'replyRate',
                t('diagnosis.weekly.col.replyRate'),
                (r) => r.replyRate,
                {
                    format: formatRate,
                    size: 104,
                }
            ),
            numberColumn(
                ctx,
                'demosBooked',
                t('diagnosis.weekly.prompts.col.demos'),
                (r) => r.demosBooked,
                { size: 88 }
            ),
            verdictColumn(ctx, t('diagnosis.weekly.col.status'), pick, 'sends', need),
        ],
    };
};

// ─── the model ──────────────────────────────────────────────────────────────

export interface WeeklyModelInput {
    /** Only used to mark the weak sources and hours the diagnosis itself named. */
    problems: DiagnosisProblem[];
    tracking: WeeklyTracking;
    timezone: string;
    engineId: string | null;
}

export const buildWeeklyModel = (
    weekly: DiagnosisWeekly,
    ctx: ReportCtx,
    input: WeeklyModelInput
): WeeklyModel => {
    const insights = buildCallInsights(weekly, ctx);
    return {
        minimums: weekly.minimums,
        sources: buildSources(weekly, ctx, input.problems),
        callHours: buildCallHours(weekly, ctx, input.problems),
        callLengths: buildCallLengths(weekly, ctx),
        callStats: insights.stats,
        callOutcomes: insights.outcomes,
        objections: insights.objections,
        whatsappFailures: buildFailures(weekly, ctx),
        whatsappTemplates: buildTemplates(weekly, ctx, input.tracking),
        emailSubjects: buildSubjects(weekly, ctx, input.tracking),
        promptChanges: buildPromptChanges(weekly, ctx, input.timezone, input.engineId),
        engineChecks: buildEngineChecks(weekly, ctx),
    };
};
