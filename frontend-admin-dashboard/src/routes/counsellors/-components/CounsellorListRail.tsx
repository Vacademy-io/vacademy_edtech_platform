import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Crown, CircleNotch } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { CounsellorRatingBadge } from '@/components/counsellor/CounsellorRatingBadge';
import {
    setCounsellorStatus,
    type WorkbenchCounsellor,
    type StatusChangeResponse,
} from '../-services/counsellor-workbench-services';

interface Props {
    instituteId: string;
    counsellors: WorkbenchCounsellor[];
    selectedUserId: string | null;
    onSelect: (userId: string) => void;
    onMarkedInactive: (response: StatusChangeResponse) => void;
}

/**
 * Left rail of /counsellors. One card per counsellor in the caller's team
 * subtree. Toggle in the top-right of each card flips org-wide status; on
 * INACTIVE, the response carries the list of open leads which the parent
 * page picks up to open the reassign dialog.
 */
export function CounsellorListRail({
    instituteId,
    counsellors,
    selectedUserId,
    onSelect,
    onMarkedInactive,
}: Props) {
    const { t } = useTranslation('counsellorsListRail');
    if (!counsellors || counsellors.length === 0) {
        return (
            <div className="p-4 text-subtitle text-neutral-500">
                {t('empty')}
            </div>
        );
    }
    return (
        <ul className="space-y-2 p-2">
            {counsellors.map((c) => (
                <CounsellorCard
                    key={c.user_id}
                    instituteId={instituteId}
                    counsellor={c}
                    selected={c.user_id === selectedUserId}
                    onSelect={() => onSelect(c.user_id)}
                    onMarkedInactive={onMarkedInactive}
                />
            ))}
        </ul>
    );
}

function CounsellorCard({
    instituteId,
    counsellor,
    selected,
    onSelect,
    onMarkedInactive,
}: {
    instituteId: string;
    counsellor: WorkbenchCounsellor;
    selected: boolean;
    onSelect: () => void;
    onMarkedInactive: (response: StatusChangeResponse) => void;
}) {
    const { t } = useTranslation('counsellorsListRail');
    const queryClient = useQueryClient();
    const statusMutation = useMutation({
        mutationFn: (next: 'ACTIVE' | 'INACTIVE') =>
            setCounsellorStatus(counsellor.user_id, instituteId, next),
        onSuccess: (data, next) => {
            // Both lists need to refetch — the paginated display AND the
            // size=500 candidates query that gates the reassign dropdown
            // on `is_active`. See index.lazy setActiveMutation for the
            // same fix; the bug surfaced as "marked active, but still
            // filtered out of the reassign target list".
            queryClient.invalidateQueries({
                queryKey: ['workbench-counsellors', instituteId],
            });
            queryClient.invalidateQueries({
                queryKey: ['workbench-counsellors-candidates', instituteId],
            });
            if (next === 'INACTIVE' && data.open_leads.length > 0) {
                onMarkedInactive(data);
            } else {
                toast.success(
                    next === 'ACTIVE'
                        ? t('toast.reactivated')
                        : t('toast.markedInactive')
                );
            }
        },
        onError: (e) => {
            const msg = (e as { response?: { data?: { ex?: string } } })?.response?.data?.ex;
            toast.error(msg ?? t('toast.updateFailed'));
        },
    });

    return (
        <li>
            <button
                type="button"
                onClick={onSelect}
                aria-pressed={selected}
                className={cn(
                    'flex w-full items-center gap-3 rounded-md border p-3 text-left transition-colors',
                    selected
                        ? 'border-primary-300 bg-primary-50'
                        : 'border-neutral-200 bg-white hover:bg-neutral-50'
                )}
            >
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-100 text-h4 font-medium text-primary-700">
                    {(counsellor.full_name ?? counsellor.user_id).slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1 truncate text-body font-medium text-neutral-900">
                        {counsellor.full_name ?? counsellor.user_id.slice(0, 8)}
                        {counsellor.role_label === 'Org Head' && (
                            <Crown size={12} weight="fill" className="text-warning-500" />
                        )}
                    </div>
                    <div className="flex items-center gap-2 text-caption text-neutral-500">
                        <span className="truncate">{counsellor.team_name ?? '—'}</span>
                        <span aria-hidden="true">·</span>
                        <span>{t('assignedCount', { count: counsellor.open_leads_count })}</span>
                    </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                    <CounsellorRatingBadge
                        instituteId={instituteId}
                        userId={counsellor.user_id}
                        size="sm"
                    />
                    <ToggleStatus
                        active={counsellor.is_active}
                        loading={statusMutation.isPending}
                        onToggle={(next) => statusMutation.mutate(next)}
                    />
                </div>
            </button>
        </li>
    );
}

function ToggleStatus({
    active,
    loading,
    onToggle,
}: {
    active: boolean;
    loading: boolean;
    onToggle: (next: 'ACTIVE' | 'INACTIVE') => void;
}) {
    const { t } = useTranslation('counsellorsListRail');
    return (
        <button
            type="button"
            onClick={(e) => {
                e.stopPropagation();
                onToggle(active ? 'INACTIVE' : 'ACTIVE');
            }}
            disabled={loading}
            className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-caption font-medium',
                active
                    ? 'border-success-200 bg-success-50 text-success-700'
                    : 'border-neutral-200 bg-neutral-100 text-neutral-600',
                loading && 'opacity-60'
            )}
            aria-label={active ? t('markInactive') : t('markActive')}
        >
            {loading ? (
                <CircleNotch size={10} className="animate-spin" />
            ) : (
                <span
                    className={cn(
                        'size-1.5 rounded-full',
                        active ? 'bg-success-500' : 'bg-neutral-400'
                    )}
                />
            )}
            {active ? t('active') : t('inactive')}
        </button>
    );
}
