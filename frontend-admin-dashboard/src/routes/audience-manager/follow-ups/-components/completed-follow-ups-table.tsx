import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { LeadAvatar } from '@/components/shared/leads/lead-avatar';
import { LeadEmptyState } from '@/components/shared/leads';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { useLeadSettings } from '@/hooks/use-lead-settings';
import type { CompletedFollowUp } from '../-services/get-completed-follow-ups';

/**
 * CompletedFollowUpsTable — one row per CLOSED follow-up.
 *
 * Not LeadTable, because these rows are not leads: the same lead can appear
 * twice here (two calls, both completed) and also in Upcoming at the same time.
 * None of LeadTable's columns or row actions fit — a completed follow-up has no
 * due date to be overdue against and nothing left to mark complete.
 */

interface CompletedFollowUpsTableProps {
    rows: CompletedFollowUp[];
    isLoading: boolean;
    /** Opens the lead's side sheet, same as clicking a row in the other buckets. */
    onOpenLead: (row: CompletedFollowUp) => void;
    counsellorName: (userId: string | null) => string;
}

/** Backend sends bare ISO strings without a zone; read them as UTC. */
const toDate = (raw: string | null): Date | null => {
    if (!raw) return null;
    const hasZone = /Z$|[+-]\d{2}:?\d{2}$/i.test(raw);
    const d = new Date(hasZone ? raw : `${raw.replace(' ', 'T')}Z`);
    return Number.isNaN(d.getTime()) ? null : d;
};

export function CompletedFollowUpsTable({
    rows,
    isLoading,
    onOpenLead,
    counsellorName,
}: CompletedFollowUpsTableProps) {
    const { t } = useTranslation('audienceManagerFollowUpsCompletedTable');
    const { followUpFields } = useLeadSettings();

    /**
     * What the counsellor recorded on the call — shown only for institutes that
     * configured these fields, and only the ones they actually configured. An
     * institute with the block off sees exactly the six columns it saw before.
     */
    const extraColumns = (
        [
            ['interestLevel', 'interest_level', followUpFields.interestLevels],
            ['studentResponse', 'student_response', followUpFields.studentResponses],
            ['followUpMode', 'follow_up_mode', followUpFields.followUpModes],
            ['nextAction', 'next_action', followUpFields.nextActions],
        ] as const
    ).filter(([, , options]) => followUpFields.enabled && options.length > 0);

    if (isLoading) return <DashboardLoader />;
    if (rows.length === 0) {
        return <LeadEmptyState title={t('empty.title')} description={t('empty.description')} />;
    }

    const cell = (d: Date | null) => (d ? format(d, 'd MMM yyyy, h:mm a') : '—');

    return (
        <div className="overflow-x-auto rounded-lg border border-neutral-200">
            <table className="w-full text-sm">
                <thead className="bg-neutral-50">
                    <tr>
                        {[
                            'lead',
                            'contact',
                            ...(followUpFields.showHistory ? ['createdAt'] : []),
                            'wasDue',
                            'completedAt',
                            'completedBy',
                            'outcome',
                            ...extraColumns.map(([headerKey]) => headerKey),
                        ].map((k) => (
                            <th
                                key={k}
                                className="whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold text-neutral-500"
                            >
                                {t(`headers.${k}`)}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                    {rows.map((row) => (
                        <tr
                            key={row.id}
                            onClick={() => onOpenLead(row)}
                            className="cursor-pointer hover:bg-neutral-50"
                        >
                            <td className="px-4 py-3">
                                <span className="flex items-center gap-2">
                                    <LeadAvatar name={row.lead_name || '—'} />
                                    <span className="truncate font-medium text-neutral-800">
                                        {row.lead_name || t('unnamedLead')}
                                    </span>
                                </span>
                            </td>
                            <td className="px-4 py-3 text-neutral-500">{row.lead_mobile || '—'}</td>
                            {/* Created date only with the follow-up history switch on. */}
                            {followUpFields.showHistory && (
                                <td className="whitespace-nowrap px-4 py-3 text-neutral-500">
                                    {cell(toDate(row.created_at ?? null))}
                                </td>
                            )}
                            <td className="whitespace-nowrap px-4 py-3 text-neutral-500">
                                {cell(toDate(row.schedule_time))}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-neutral-700">
                                {cell(toDate(row.closed_at))}
                            </td>
                            <td className="px-4 py-3 text-neutral-500">
                                {counsellorName(row.closed_by)}
                            </td>
                            <td className="max-w-xs px-4 py-3 text-neutral-500">
                                <span className="block truncate" title={row.closer_reason ?? ''}>
                                    {row.closer_reason || '—'}
                                </span>
                            </td>
                            {extraColumns.map(([headerKey, field]) => (
                                <td key={headerKey} className="max-w-xs px-4 py-3 text-neutral-500">
                                    <span className="block truncate" title={row[field] ?? ''}>
                                        {row[field] || '—'}
                                    </span>
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
