/**
 * Per-lead TAT, SLA and Overdue exports for the Reports Center.
 *
 * The report tabs show counsellor-level aggregates; these give the row behind
 * them — one line per lead — so a manager can see which leads missed TAT, where
 * every lead sits on the SLA clock, and which follow-ups are overdue right now.
 *
 * No new endpoint: each one pages the leads list (the same query Recent Leads
 * and the Follow-ups page use) through the shared background export, which is
 * paced so a big institute never spikes the server. Off unless the institute
 * turns on "Per-lead report exports" in Lead settings → Follow-up fields.
 */
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { format } from 'date-fns';
import { startBackgroundExport, useIsExporting } from '@/components/shared/leads/background-export';
import { useFollowUpFeatures } from '@/components/shared/leads/follow-up-fields';
import { useLeadSettings } from '@/hooks/use-lead-settings';
import {
    fetchRecentLeads,
    type RecentLeadDetail,
    type RecentLeadsRequest,
} from '@/routes/audience-manager/list/-services/get-recent-leads';
import { parseHtmlToString } from '@/lib/utils';
import { ExportCsvButton, type ReportTabProps } from './report-shared';

export type PerLeadExportKind = 'tat' | 'sla' | 'overdue';

const EXPORT_KEY = (kind: PerLeadExportKind) => `reports-per-lead-${kind}`;

const dateTime = (raw: string | null | undefined): string =>
    raw ? format(new Date(raw), 'yyyy-MM-dd HH:mm') : '';

/** Follow-up notes come from the rich-text editor; a CSV cell wants plain text. */
const plainNote = (raw: string | null | undefined): string => {
    if (!raw) return '';
    return /<\/?[a-z][^>]*>/i.test(raw) ? parseHtmlToString(raw).trim() : raw.trim();
};

const name = (lead: RecentLeadDetail) => lead.parent_name || lead.user?.full_name || '';
const phone = (lead: RecentLeadDetail) => lead.parent_mobile || lead.user?.mobile_number || '';
const email = (lead: RecentLeadDetail) => lead.parent_email || lead.user?.email || '';
const yesNo = (t: TFunction, value: boolean | null | undefined) =>
    value ? t('values.yes') : t('values.no');

/** Minutes from enquiry to first response, or '' when there was none. */
export const responseMinutes = (lead: RecentLeadDetail): number | '' => {
    if (!lead.first_response_at || !lead.submitted_at_local) return '';
    const ms = Date.parse(lead.first_response_at) - Date.parse(lead.submitted_at_local);
    return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 60000) : '';
};

/** Met / Breached / Pending — the same rule the TAT-met KPI counts. */
export const tatStatus = (t: TFunction, lead: RecentLeadDetail): string => {
    if (lead.first_response_at) {
        // A repeat enquiry inherits the person's older activity, so its "first
        // response" can predate the enquiry itself. That is not a reply to this
        // enquiry, so it is called out rather than counted as met.
        if (
            lead.submitted_at_local &&
            Date.parse(lead.first_response_at) < Date.parse(lead.submitted_at_local)
        ) {
            return t('values.priorActivity');
        }
        if (!lead.tat_due_at) return t('values.responded');
        return Date.parse(lead.first_response_at) <= Date.parse(lead.tat_due_at)
            ? t('values.met')
            : t('values.breached');
    }
    if (lead.sla_closed) return t('values.closed');
    // Judged on the deadline itself: tat_overdue only reflects the CURRENT SLA
    // stage, and a lead that has moved on to a follow-up stage reads false there
    // even though its TAT was missed.
    if (!lead.tat_due_at) return t('values.pending');
    return Date.parse(lead.tat_due_at) < Date.now()
        ? t('values.breachedNoResponse')
        : t('values.pending');
};

const SLA_STAGE_KEYS: Record<string, string> = {
    TAT_BEFORE: 'stages.tatDueSoon',
    TAT_OVERDUE: 'stages.tatOverdue',
    FOLLOW_UP_DUE: 'stages.followUpDueSoon',
    FOLLOW_UP_OVERDUE: 'stages.followUpOverdue',
};
/** Readable SLA stage: on track (no stage), off the clock, or the stage in words. */
export const slaStage = (t: TFunction, lead: RecentLeadDetail): string => {
    if (lead.sla_closed) return t('stages.offClock');
    const stage = lead.tat_reminder_stage;
    if (!stage) return t('stages.onTrack');
    return SLA_STAGE_KEYS[stage] ? t(SLA_STAGE_KEYS[stage]) : stage;
};

export const daysOverdue = (dueAt: string | null | undefined): number | '' => {
    if (!dueAt) return '';
    const ms = Date.now() - Date.parse(dueAt);
    return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 86_400_000) : 0;
};

interface ExportDef {
    header: string[];
    filter: Partial<RecentLeadsRequest>;
    toRow: (lead: RecentLeadDetail) => (string | number | null | undefined)[];
}

function buildExport(
    kind: PerLeadExportKind,
    t: TFunction,
    props: ReportTabProps,
    hideLost: boolean
): ExportDef {
    // Report range is in the viewer's days; the leads query takes instants.
    const submittedRange = {
        submitted_from_local: props.fromDate
            ? new Date(`${props.fromDate}T00:00:00`).toISOString()
            : undefined,
        submitted_to_local: props.toDate
            ? new Date(`${props.toDate}T23:59:59.999`).toISOString()
            : undefined,
    };
    const lead = [t('columns.name'), t('columns.phone'), t('columns.email')];
    const leadCells = (l: RecentLeadDetail) => [name(l), phone(l), email(l)];

    if (kind === 'tat') {
        return {
            header: [
                ...lead,
                t('columns.source'),
                t('columns.counsellor'),
                t('columns.enquiredAt'),
                t('columns.tatDueAt'),
                t('columns.firstResponseAt'),
                t('columns.responseMinutes'),
                t('columns.tatStatus'),
            ],
            // Every enquiry in the range — converted ones answered too.
            filter: { ...submittedRange, conversion_status_filter: 'ALL' },
            toRow: (l) => [
                ...leadCells(l),
                l.campaign_name ?? '',
                l.assigned_counselor_name ?? '',
                dateTime(l.submitted_at_local),
                dateTime(l.tat_due_at),
                dateTime(l.first_response_at),
                responseMinutes(l),
                tatStatus(t, l),
            ],
        };
    }
    if (kind === 'sla') {
        return {
            header: [
                ...lead,
                t('columns.source'),
                t('columns.counsellor'),
                t('columns.leadStatus'),
                t('columns.enquiredAt'),
                t('columns.tatDueAt'),
                t('columns.firstResponseAt'),
                t('columns.followUpDueAt'),
                t('columns.slaStage'),
                t('columns.tatOverdue'),
                t('columns.followUpOverdue'),
                t('columns.offClock'),
            ],
            filter: { ...submittedRange, conversion_status_filter: 'ALL' },
            toRow: (l) => [
                ...leadCells(l),
                l.campaign_name ?? '',
                l.assigned_counselor_name ?? '',
                l.lead_status ?? '',
                dateTime(l.submitted_at_local),
                dateTime(l.tat_due_at),
                dateTime(l.first_response_at),
                dateTime(l.follow_up_due_at),
                slaStage(t, l),
                yesNo(t, l.tat_overdue),
                yesNo(t, l.follow_up_overdue),
                yesNo(t, l.sla_closed),
            ],
        };
    }
    // Overdue: open follow-ups already past due, right now — like the aging
    // buckets, this is a point in time, so the report's date range does not apply.
    return {
        header: [
            ...lead,
            t('columns.source'),
            t('columns.counsellor'),
            t('columns.leadStatus'),
            t('columns.followUpDueAt'),
            t('columns.daysOverdue'),
            t('columns.interestLevel'),
            t('columns.followUpNote'),
            t('columns.studentResponse'),
            t('columns.nextAction'),
        ],
        filter: {
            follow_up_pending: true,
            follow_up_to: new Date().toISOString(),
            conversion_status_filter: 'EXCLUDE_CONVERTED',
            // Same rule as the Follow-ups page: Lost leads are not pending work.
            lead_status_exclude_id: hideLost ? 'LOST' : undefined,
        },
        toRow: (l) => [
            ...leadCells(l),
            l.campaign_name ?? '',
            l.assigned_counselor_name ?? '',
            l.lead_status ?? '',
            dateTime(l.follow_up_due_at),
            daysOverdue(l.follow_up_due_at),
            l.follow_up_interest_level ?? '',
            plainNote(l.follow_up_content),
            l.follow_up_student_response ?? '',
            l.follow_up_next_action ?? '',
        ],
    };
}

function PerLeadExportButton({ kind, props }: { kind: PerLeadExportKind; props: ReportTabProps }) {
    const { t } = useTranslation('audienceManagerPerLeadExports');
    const leadSettings = useLeadSettings();
    const busy = useIsExporting(EXPORT_KEY(kind));
    // The leads query has no team filter; exporting the whole institute while a
    // team is selected would hand out rows the manager did not ask for.
    const teamSelected = !!props.teamId;

    const run = () => {
        const def = buildExport(kind, t, props, leadSettings.hideLostInFollowUps);
        const scope: Partial<RecentLeadsRequest> = {
            institute_id: props.instituteId,
            assigned_counselor_id: props.counsellorUserId || undefined,
            audience_id: props.audienceId || undefined,
        };
        startBackgroundExport<RecentLeadDetail>({
            key: EXPORT_KEY(kind),
            fileName: `${kind}-report_${format(new Date(), 'yyyy-MM-dd')}.csv`,
            header: def.header,
            fetchPage: (page, size) =>
                fetchRecentLeads({ ...scope, ...def.filter, page, size } as RecentLeadsRequest),
            rowKey: (l) => l.response_id,
            toRow: def.toRow,
            labels: {
                progress: (done, total) =>
                    total > 0
                        ? t('progress', {
                              done: done.toLocaleString(),
                              total: total.toLocaleString(),
                          })
                        : t('running'),
                done: (count) => t('done', { count }),
                failed: t('failed'),
                alreadyRunning: t('alreadyRunning'),
                truncated: (count) => t('truncated', { count }),
                partial: (count) => t('partial', { count }),
            },
        });
    };

    return (
        <span title={teamSelected ? t('teamNotSupported') : undefined}>
            <ExportCsvButton
                onClick={run}
                disabled={busy || teamSelected || !props.instituteId}
                label={busy ? t('exporting') : t(`button.${kind}`)}
            />
        </span>
    );
}

/** Renders nothing unless the institute switched per-lead exports on. */
export function PerLeadExports({
    kinds,
    ...props
}: ReportTabProps & { kinds: PerLeadExportKind[] }) {
    const { reportExports } = useFollowUpFeatures();
    if (!reportExports) return null;
    return (
        <div className="flex flex-wrap items-center justify-end gap-2">
            {kinds.map((kind) => (
                <PerLeadExportButton key={kind} kind={kind} props={props} />
            ))}
        </div>
    );
}
