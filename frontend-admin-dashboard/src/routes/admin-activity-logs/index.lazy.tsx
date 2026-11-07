import { createLazyFileRoute, useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { useTranslation } from 'react-i18next';
import { Notebook } from '@phosphor-icons/react';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import {
    useActivityLogs,
    type AdminActivityLog,
    type AdminActivityLogFilters,
} from '@/services/admin-activity-logs/getActivityLogs';
import { ActivityLogFilters } from './-components/ActivityLogFilters';
import { ActivityLogTable } from './-components/ActivityLogTable';
import { PayloadDrawer } from './-components/PayloadDrawer';

export const Route = createLazyFileRoute('/admin-activity-logs/')({
    component: AdminActivityLogsPage,
});

/** URL scalar → filter array. `?actorId=a,b` selects two people. */
const splitParam = (value: string | undefined): string[] | undefined => {
    if (!value) return undefined;
    const parts = value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
    return parts.length > 0 ? parts : undefined;
};

/** Filter array → URL scalar. An empty selection drops the param entirely. */
const joinParam = (values: string[] | undefined): string | undefined =>
    values && values.length > 0 ? values.join(',') : undefined;

function AdminActivityLogsPage() {
    return (
        <LayoutContainer>
            <AdminActivityLogsView />
        </LayoutContainer>
    );
}

function AdminActivityLogsView() {
    const { t } = useTranslation('adminActivityLogsIndexLazy');
    const { setNavHeading } = useNavHeadingStore();
    const search = useSearch({ from: '/admin-activity-logs/' });
    const navigate = useNavigate({ from: '/admin-activity-logs/' });
    const [selectedLog, setSelectedLog] = useState<AdminActivityLog | null>(null);

    useEffect(() => {
        setNavHeading(<h1 className="text-subtitle font-medium">{t('navHeading')}</h1>);
    }, [setNavHeading, t]);

    const filters: AdminActivityLogFilters = useMemo(
        () => ({
            page: search.page ?? 0,
            size: search.size ?? 20,
            entityTypes: splitParam(search.entityType),
            actions: splitParam(search.action),
            actorIds: splitParam(search.actorId),
            startDate: search.startDate,
            endDate: search.endDate,
        }),
        [search]
    );

    const { data, isLoading, isFetching, isError, refetch } = useActivityLogs(filters);

    /**
     * The filter bar speaks arrays; the URL speaks comma-separated scalars.
     * Translating here keeps every filtered view shareable as a plain link and
     * avoids bracketed array params, which the ingress rejects with a 400.
     */
    const updateFilters = (next: Partial<AdminActivityLogFilters>) => {
        navigate({
            search: (prev) => ({
                ...prev,
                ...('entityTypes' in next ? { entityType: joinParam(next.entityTypes) } : {}),
                ...('actions' in next ? { action: joinParam(next.actions) } : {}),
                ...('actorIds' in next ? { actorId: joinParam(next.actorIds) } : {}),
                ...('startDate' in next ? { startDate: next.startDate } : {}),
                ...('endDate' in next ? { endDate: next.endDate } : {}),
                // Any filter change invalidates the current page offset.
                page: next.page ?? 0,
            }),
            replace: true,
        });
    };

    /** One definition of "no filters", shared by the filter bar and the empty state. */
    const clearFilters = () =>
        updateFilters({
            entityTypes: undefined,
            actions: undefined,
            actorIds: undefined,
            startDate: undefined,
            endDate: undefined,
            page: 0,
        });

    const hasActiveFilters =
        (filters.entityTypes?.length ?? 0) > 0 ||
        (filters.actions?.length ?? 0) > 0 ||
        (filters.actorIds?.length ?? 0) > 0 ||
        filters.startDate != null ||
        filters.endDate != null;

    return (
        <>
            <Helmet>
                <title>{t('helmet.title')}</title>
                <meta name="description" content={t('helmet.description')} />
            </Helmet>

            {/* Page header */}
            <header className="mb-5 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                    <span className="mt-0.5 inline-flex size-10 items-center justify-center rounded-lg bg-primary-50 text-primary-500">
                        <Notebook className="size-5" weight="fill" />
                    </span>
                    <div>
                        <h1 className="text-h3 font-semibold tracking-tight text-neutral-700">
                            {t('pageTitle')}
                        </h1>
                        <p className="mt-0.5 text-body text-neutral-600">
                            {t('pageDescription')}
                        </p>
                    </div>
                </div>
                {data?.totalElements != null && (
                    <div className="mt-2 text-caption text-neutral-500 sm:mt-0">
                        {t('totalEntries', { count: data.totalElements })}
                    </div>
                )}
            </header>

            <ActivityLogFilters
                value={filters}
                onChange={updateFilters}
                onClear={clearFilters}
                onRefresh={() => refetch()}
                isFetching={isFetching}
            />

            <div className="mt-4">
                <ActivityLogTable
                    page={data}
                    isLoading={isLoading}
                    isError={isError}
                    onRowClick={setSelectedLog}
                    onPageChange={(page) => updateFilters({ page })}
                    hasActiveFilters={hasActiveFilters}
                    onClearFilters={clearFilters}
                />
            </div>

            <PayloadDrawer
                log={selectedLog}
                open={!!selectedLog}
                onClose={() => setSelectedLog(null)}
                onFilterByActor={(actorId) => {
                    updateFilters({ actorIds: [actorId] });
                    setSelectedLog(null);
                }}
            />
        </>
    );
}
