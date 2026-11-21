import { useMemo } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { PanelUsageMultiRow } from '@/classroom-shared/apiTypes';
import { MyPagination } from '@/components/design-system/pagination';
import { MyTable } from '@/components/design-system/table';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchMultipleInstituteDetails, getInstituteName } from '@/lib/auth/instituteService';
import { formatNumber } from '@/lib/formatters';
import { StaleNote, TableEmpty, TableError, useClientPage } from '../TableParts';
import { formatHours } from './UsageKpis';
import { USAGE_STALE_MS, fetchUsageMulti, usageKeys, type UsageRange } from './usageApi';

export interface MultiRow extends PanelUsageMultiRow {
    name: string;
}

/** School names come from the console's own institute details, never from the usage call. */
export function useInstituteNames(instituteIds: string[], enabled: boolean) {
    return useQuery({
        queryKey: ['classroom-panels', 'usage', 'institute-names', instituteIds],
        enabled,
        retry: false,
        staleTime: 30 * 60_000,
        queryFn: () => fetchMultipleInstituteDetails(instituteIds),
    });
}

const Num = ({ value }: { value: string }) => (
    <span className="block text-end tabular-nums text-neutral-700">{value}</span>
);

/** "My schools": the same totals for every institute the user is an admin of. */
export function MultiSchools({
    instituteIds,
    rows,
}: {
    instituteIds: string[];
    rows: ReturnType<typeof useMultiRows>;
}) {
    const { t } = useTranslation('settingsClassroomPanels');
    const { page, setPage, totalPages, pageSize, tableData } = useClientPage(rows.rows);
    const columns = useMemo<ColumnDef<MultiRow>[]>(
        () => [
            {
                id: 'school',
                header: t('usage.multi.columns.school'),
                size: 240,
                cell: ({ row }) => (
                    <span className="font-medium text-neutral-700">{row.original.name}</span>
                ),
            },
            {
                id: 'hours',
                header: t('usage.multi.columns.hours'),
                size: 120,
                cell: ({ row }) => <Num value={formatHours(row.original.totals.panel_hours)} />,
            },
            {
                id: 'sessions',
                header: t('usage.multi.columns.sessions'),
                size: 110,
                cell: ({ row }) => <Num value={formatNumber(row.original.totals.sessions)} />,
            },
            {
                id: 'rooms',
                header: t('usage.multi.columns.rooms'),
                size: 140,
                cell: ({ row }) => (
                    <Num
                        value={t('usage.kpi.roomsValue', {
                            used: formatNumber(row.original.totals.rooms_used),
                            total: formatNumber(row.original.totals.rooms_with_panel),
                        })}
                    />
                ),
            },
            {
                id: 'teachers',
                header: t('usage.multi.columns.teachers'),
                size: 110,
                cell: ({ row }) => <Num value={formatNumber(row.original.totals.teachers)} />,
            },
            {
                id: 'idle',
                header: t('usage.multi.columns.idle'),
                size: 110,
                cell: ({ row }) => <Num value={formatNumber(row.original.totals.idle_rooms)} />,
            },
        ],
        [t]
    );

    return (
        <Card>
            <CardHeader>
                <CardTitle>
                    <h3 className="text-h3 font-medium">{t('usage.multi.title')}</h3>
                </CardTitle>
                <CardDescription>
                    {t('usage.multi.description', { count: instituteIds.length })}
                </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
                {rows.query.isPending && (
                    <MyTable<MultiRow>
                        data={undefined}
                        columns={columns}
                        isLoading
                        error={null}
                        currentPage={0}
                        enableColumnPinning={false}
                    />
                )}
                {rows.query.isError && !rows.query.data && (
                    <TableError
                        message={t('usage.multi.loadError')}
                        error={rows.query.error}
                        onRetry={() => void rows.query.refetch()}
                    />
                )}
                {rows.query.data && (
                    <>
                        {rows.query.isError && (
                            <StaleNote onRetry={() => void rows.query.refetch()} />
                        )}
                        {rows.rows.length === 0 ? (
                            <TableEmpty
                                title={t('usage.multi.emptyTitle')}
                                body={t('usage.multi.emptyBody')}
                            />
                        ) : (
                            <>
                                <MyTable<MultiRow>
                                    data={tableData}
                                    columns={columns}
                                    isLoading={false}
                                    error={null}
                                    currentPage={page}
                                    enableColumnPinning={false}
                                />
                                {totalPages > 1 && (
                                    <MyPagination
                                        currentPage={page}
                                        totalPages={totalPages}
                                        onPageChange={setPage}
                                        totalElements={rows.rows.length}
                                        pageSize={pageSize}
                                    />
                                )}
                            </>
                        )}
                    </>
                )}
            </CardContent>
        </Card>
    );
}

/** The /usage/multi answer joined with school names, most panel hours first. */
export function useMultiRows(
    instituteIds: string[],
    range: UsageRange,
    tz: string,
    enabled: boolean
) {
    const { t } = useTranslation('settingsClassroomPanels');
    const query = useQuery({
        queryKey: usageKeys.multi(instituteIds, range, tz),
        enabled,
        retry: false,
        staleTime: USAGE_STALE_MS,
        queryFn: () => fetchUsageMulti(instituteIds, range, tz),
    });
    const names = useInstituteNames(instituteIds, enabled);
    const rows = useMemo<MultiRow[]>(
        () =>
            (query.data ?? [])
                .map((row) => {
                    const details = names.data?.[row.institute_id] ?? null;
                    return {
                        ...row,
                        name: details
                            ? getInstituteName(details, row.institute_id)
                            : t('usage.multi.fallbackName', { id: row.institute_id.slice(0, 8) }),
                    };
                })
                .sort((a, b) => b.totals.panel_hours - a.totals.panel_hours),
        [query.data, names.data, t]
    );
    return { query, rows };
}
