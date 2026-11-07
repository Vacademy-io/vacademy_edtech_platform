/**
 * Onboarding Dashboard — every onboarding instance across every subject, in
 * one place, filterable by flow/status. The per-subject side-view tab only
 * shows one person at a time; this is for the admin who needs to see who's
 * pending, on which flow, and stuck at which step, across the whole institute.
 */
import { OnboardingEnhancedHeader } from './OnboardingEnhancedHeader';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Path } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { MyTable } from '@/components/design-system/table';
import { MyPagination } from '@/components/design-system/pagination';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import {
    fetchOnboardingDashboard,
    fetchOnboardingFlows,
    onboardingDashboardKey,
    onboardingFlowsKey,
    type OnboardingInstanceSummaryDTO,
} from '../-services/onboarding-service';

const STATUS_OPTIONS = ['IN_PROGRESS', 'COMPLETED', 'ABANDONED', 'CANCELLED'] as const;

function statusLabel(status: string, t: TFunction): string {
    switch (status) {
        case 'IN_PROGRESS':
            return t('statusLabels.inProgress');
        case 'COMPLETED':
            return t('statusLabels.completed');
        case 'ABANDONED':
            return t('statusLabels.abandoned');
        case 'CANCELLED':
            return t('statusLabels.cancelled');
        default:
            return status;
    }
}

function StatusBadge({ status, t }: { status: string; t: TFunction }) {
    const toneClass =
        status === 'COMPLETED'
            ? 'bg-success-50 text-success-700'
            : status === 'ABANDONED' || status === 'CANCELLED'
              ? 'bg-neutral-100 text-neutral-500'
              : 'bg-info-50 text-info-600';
    return (
        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-caption font-medium ${toneClass}`}>
            {statusLabel(status, t)}
        </span>
    );
}

const ALL_VALUE = '__all__';

export function OnboardingDashboardPage({ instituteId }: { instituteId: string }) {
    const { t } = useTranslation('audienceManagerOnboardingDashboardPage');
    const [flowId, setFlowId] = useState<string>(ALL_VALUE);
    const [status, setStatus] = useState<string>(ALL_VALUE);
    const [page, setPage] = useState(0);

    const flowsQuery = useQuery({
        queryKey: onboardingFlowsKey(instituteId),
        queryFn: () => fetchOnboardingFlows(instituteId),
        enabled: !!instituteId,
        staleTime: 60 * 1000,
    });

    const effectiveFlowId = flowId === ALL_VALUE ? undefined : flowId;
    const effectiveStatus = status === ALL_VALUE ? undefined : status;

    const dashboardQuery = useQuery({
        queryKey: onboardingDashboardKey(instituteId, effectiveFlowId, effectiveStatus, page),
        queryFn: () =>
            fetchOnboardingDashboard(instituteId, {
                flowId: effectiveFlowId,
                status: effectiveStatus,
                pageNo: page,
            }),
        enabled: !!instituteId,
        staleTime: 15 * 1000,
    });

    const columns = useMemo<ColumnDef<OnboardingInstanceSummaryDTO>[]>(
        () => [
            {
                id: 'subject',
                header: t('columns.person'),
                size: 320,
                cell: ({ row }) => (
                    <div className="flex flex-col">
                        <span className="text-body font-medium text-neutral-800">
                            {row.original.subject_name || row.original.subject_user_id}
                        </span>
                        {row.original.subject_email && (
                            <span className="text-2xs text-neutral-500">{row.original.subject_email}</span>
                        )}
                        {row.original.resolved_subject_name && (
                            <span className="text-2xs text-success-600">
                                {t('resolvedStudentPrefix', { name: row.original.resolved_subject_name })}
                            </span>
                        )}
                    </div>
                ),
            },
            {
                accessorKey: 'flow_name',
                header: t('columns.flow'),
                size: 260,
                cell: ({ row }) => (
                    <span className="text-body text-neutral-700">{row.original.flow_name ?? '—'}</span>
                ),
            },
            {
                accessorKey: 'current_step_name',
                header: t('columns.currentStep'),
                size: 260,
                cell: ({ row }) => (
                    <span className="text-body text-neutral-700">
                        {row.original.current_step_name ??
                            (row.original.status === 'COMPLETED' ? '—' : t('unknownStep'))}
                    </span>
                ),
            },
            {
                accessorKey: 'status',
                header: t('columns.status'),
                size: 160,
                cell: ({ row }) => <StatusBadge status={row.original.status} t={t} />,
            },
            {
                accessorKey: 'started_by',
                header: t('columns.startedBy'),
                size: 160,
                cell: ({ row }) => (
                    <span className="text-body text-neutral-600">{row.original.started_by ?? '—'}</span>
                ),
            },
            {
                accessorKey: 'started_at',
                header: t('columns.started'),
                size: 200,
                cell: ({ row }) =>
                    row.original.started_at ? (
                        <span className="text-body text-neutral-600">
                            {new Date(row.original.started_at).toLocaleDateString()}
                        </span>
                    ) : (
                        <span className="text-body text-neutral-400">—</span>
                    ),
            },
        ],
        [t]
    );

    return (
        <div className="flex flex-col gap-4 p-2">
            <div className="flex flex-col gap-1">
                <h1 className="text-h1 font-medium text-neutral-900">{t('page.title')}</h1>
                <p className="text-subtitle text-neutral-500">{t('page.subtitle')}</p>
            </div>

            {/* Summary header. */}
            <OnboardingEnhancedHeader
                instituteId={instituteId}
                flowId={effectiveFlowId}
                status={effectiveStatus}
                onStatus={(next) => {
                    setStatus(next ?? ALL_VALUE);
                    setPage(0);
                }}
            />

            <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1">
                    <Label className="text-caption text-neutral-600">{t('filters.flow')}</Label>
                    <Select
                        value={flowId}
                        onValueChange={(v) => {
                            setFlowId(v);
                            setPage(0);
                        }}
                    >
                        <SelectTrigger className="w-56">
                            <SelectValue placeholder={t('filters.allFlows')} />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ALL_VALUE}>{t('filters.allFlows')}</SelectItem>
                            {(flowsQuery.data ?? []).map((f) => (
                                <SelectItem key={f.id} value={f.id}>
                                    {f.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex flex-col gap-1">
                    <Label className="text-caption text-neutral-600">{t('filters.status')}</Label>
                    <Select
                        value={status}
                        onValueChange={(v) => {
                            setStatus(v);
                            setPage(0);
                        }}
                    >
                        <SelectTrigger className="w-44">
                            <SelectValue placeholder={t('filters.allStatuses')} />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ALL_VALUE}>{t('filters.allStatuses')}</SelectItem>
                            {STATUS_OPTIONS.map((s) => (
                                <SelectItem key={s} value={s}>
                                    {statusLabel(s, t)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {!instituteId ? (
                <div className="rounded-lg border border-warning-200 bg-warning-50 p-4 text-body text-warning-700">
                    {t('states.noInstitute')}
                </div>
            ) : dashboardQuery.isError ? (
                <div className="flex flex-col items-center gap-3 rounded-lg border border-danger-200 bg-danger-50 p-8 text-center">
                    <p className="text-body text-danger-700">{t('states.loadError')}</p>
                </div>
            ) : !dashboardQuery.isLoading && (dashboardQuery.data?.content.length ?? 0) === 0 ? (
                <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-neutral-200 bg-white py-16 text-center shadow-sm">
                    <div className="flex size-16 items-center justify-center rounded-full border border-neutral-100 bg-neutral-50">
                        <Path size={32} className="text-neutral-400" weight="duotone" />
                    </div>
                    <h3 className="text-lg font-semibold text-neutral-900">{t('states.emptyTitle')}</h3>
                    <p className="max-w-sm text-body text-neutral-500">{t('states.emptyDescription')}</p>
                </div>
            ) : (
                <>
                    <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
                        <MyTable<OnboardingInstanceSummaryDTO>
                            data={dashboardQuery.data}
                            columns={columns}
                            isLoading={dashboardQuery.isLoading}
                            error={dashboardQuery.error}
                            currentPage={page}
                        />
                    </div>
                    {(dashboardQuery.data?.total_pages ?? 0) > 1 && (
                        <MyPagination
                            currentPage={page}
                            totalPages={dashboardQuery.data?.total_pages ?? 0}
                            onPageChange={setPage}
                        />
                    )}
                </>
            )}
        </div>
    );
}
