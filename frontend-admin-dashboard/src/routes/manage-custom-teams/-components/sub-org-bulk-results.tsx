import { useTranslation } from 'react-i18next';
import { StatusChip, type StatusType } from '@/components/design-system/status-chips';
import { cn } from '@/lib/utils';
import type { SubOrgBulkResult, SubOrgBulkStatus } from '@/services/sub-org-bulk-members';

const CHIP_STATUS: Record<SubOrgBulkStatus, StatusType> = {
    ADDED: 'SUCCESS',
    MOVED: 'SUCCESS',
    ALREADY_MEMBER: 'INFO',
    FAILED: 'DANGER',
};

/** Failed rows first: those are the ones the admin has to act on. */
const ORDER: Record<SubOrgBulkStatus, number> = {
    FAILED: 0,
    ALREADY_MEMBER: 1,
    MOVED: 2,
    ADDED: 3,
};

interface Props {
    result: SubOrgBulkResult;
    /** Label for a learner whose name and email are unknown (e.g. a row with no account). */
    unknownLabel?: string;
}

/**
 * Totals and the per-learner outcome of a bulk add or move into a sub-org. Shared by the
 * sub-org page's "Add learners" dialog and the students list's "Move to sub-org" action.
 */
export function SubOrgBulkResults({ result, unknownLabel }: Props) {
    const { t } = useTranslation('manageCustomTeamsSubOrgBulkResults');
    const rows = [...result.results].sort((a, b) => ORDER[a.status] - ORDER[b.status]);
    const tiles: { key: string; label: string; value: number; tone: string }[] = [
        { key: 'added', label: t('tiles.added'), value: result.added, tone: 'text-success-600' },
        { key: 'moved', label: t('tiles.moved'), value: result.moved, tone: 'text-success-600' },
        {
            key: 'already',
            label: t('tiles.alreadyMember'),
            value: result.already_member,
            tone: 'text-neutral-600',
        },
        { key: 'failed', label: t('tiles.failed'), value: result.failed, tone: 'text-danger-600' },
    ];

    return (
        <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {tiles.map((tile) => (
                    <div key={tile.key} className="rounded-md border border-neutral-200 p-3">
                        <p className="text-caption text-neutral-500">{tile.label}</p>
                        <p className={cn('text-h3 font-semibold', tile.tone)}>{tile.value}</p>
                    </div>
                ))}
            </div>
            {rows.length > 0 && (
                <ul className="max-h-72 divide-y divide-neutral-100 overflow-y-auto rounded-md border border-neutral-200">
                    {rows.map((row, idx) => (
                        <li
                            key={`${row.user_id ?? row.email ?? 'row'}-${row.package_session_id ?? ''}-${idx}`}
                            className="flex items-start justify-between gap-3 px-3 py-2"
                        >
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-body font-medium text-neutral-700">
                                    {row.name || row.email || unknownLabel || t('unknownLearner')}
                                </p>
                                {row.name && row.email && (
                                    <p className="truncate text-caption text-neutral-500">
                                        {row.email}
                                    </p>
                                )}
                                {row.message && (
                                    <p
                                        className={cn(
                                            'text-caption',
                                            row.status === 'FAILED'
                                                ? 'text-danger-600'
                                                : 'text-neutral-500'
                                        )}
                                    >
                                        {row.message}
                                    </p>
                                )}
                            </div>
                            <StatusChip
                                status={CHIP_STATUS[row.status]}
                                text={t(`status.${row.status}`)}
                                textSize="text-caption"
                                showIcon={false}
                            />
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
