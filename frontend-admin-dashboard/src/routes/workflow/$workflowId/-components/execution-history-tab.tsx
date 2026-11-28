import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useQuery } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { getExecutionSummaryQuery } from '@/services/workflow-service';
import { ExecutionSummaryCards } from './execution-summary-cards';
import { ExecutionDetailDrawer } from './execution-detail-drawer';
import { CaretLeft, CaretRight, FunnelSimple } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { BASE_URL } from '@/constants/urls';

interface ExecutionRow {
    id: string;
    idempotency_key: string;
    status: string;
    error_message: string | null;
    started_at: string | null;
    completed_at: string | null;
    created_at: string;
    updated_at: string;
    workflow_id: string;
    workflow_name: string;
    workflow_schedule_id?: string;
}

interface Props {
    workflowId: string;
    instituteId: string;
    onViewOnDiagram?: (executionId: string) => void;
}

const STATUS_FILTERS = ['ALL', 'COMPLETED', 'FAILED', 'PROCESSING', 'PENDING'] as const;

const statusBadgeColor: Record<string, string> = {
    COMPLETED: 'bg-green-100 text-green-800',
    FAILED: 'bg-red-100 text-red-800',
    PROCESSING: 'bg-blue-100 text-blue-800',
    PENDING: 'bg-yellow-100 text-yellow-800',
};

export function ExecutionHistoryTab({ workflowId, instituteId, onViewOnDiagram }: Props) {
    const { t, i18n } = useTranslation('workflowExecutionHistoryTab');
    const [statusFilter, setStatusFilter] = useState<string>('ALL');
    const [page, setPage] = useState(0);
    const pageSize = 10;

    // Date range: default last 7 days
    // Use date-only inputs (YYYY-MM-DD) and append UTC boundaries when sending to API
    const todayStr = new Date().toISOString().slice(0, 10); // "2026-04-20"
    const weekAgoStr = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10); // "2026-04-13"

    const [startDate, setStartDate] = useState(weekAgoStr);
    const [endDate, setEndDate] = useState(todayStr);

    // Append UTC boundaries: start at 00:00:00Z, end at 23:59:59Z
    const startIso = startDate ? `${startDate}T00:00:00.000Z` : undefined;
    const endIso = endDate ? `${endDate}T23:59:59.999Z` : undefined;

    // Fetch execution list
    const { data: executionData, isLoading } = useQuery({
        queryKey: ['WORKFLOW_EXECUTIONS', workflowId, statusFilter, startIso, endIso, page],
        queryFn: async () => {
            const body: Record<string, unknown> = {
                institute_id: instituteId,
                workflow_ids: [workflowId],
                sort_columns: { startedAt: 'desc' },
            };
            if (statusFilter !== 'ALL') body.statuses = [statusFilter];
            if (startIso) body.start_date = startIso;
            if (endIso) body.end_date = endIso;

            const resp = await authenticatedAxiosInstance.post(
                `${BASE_URL}/admin-core-service/v1/workflow-execution/list?pageNo=${page}&pageSize=${pageSize}`,
                body
            );
            return resp.data as {
                content: ExecutionRow[];
                total_elements: number;
                total_pages: number;
                page_number: number;
            };
        },
        staleTime: 30_000,
    });

    // Fetch summary
    const { data: summary } = useQuery(
        getExecutionSummaryQuery(workflowId, startIso, endIso)
    );

    // Drawer state
    const [selectedExecution, setSelectedExecution] = useState<ExecutionRow | null>(null);
    const [drawerOpen, setDrawerOpen] = useState(false);

    // Reset page when filter changes
    useEffect(() => setPage(0), [statusFilter, startDate, endDate]);

    const executions = executionData?.content ?? [];
    const totalPages = executionData?.total_pages ?? 0;

    const statusFilterLabels: Record<(typeof STATUS_FILTERS)[number], string> = {
        ALL: t('statusFilters.all'),
        COMPLETED: t('statusFilters.completed'),
        FAILED: t('statusFilters.failed'),
        PROCESSING: t('statusFilters.processing'),
        PENDING: t('statusFilters.pending'),
    };

    return (
        <div className="space-y-4">
            {/* Summary cards */}
            {summary && <ExecutionSummaryCards summary={summary} />}

            {/* Filters row */}
            <div className="flex flex-wrap items-center gap-2">
                <FunnelSimple size={16} className="text-muted-foreground" />
                {STATUS_FILTERS.map((s) => (
                    <Button
                        key={s}
                        variant={statusFilter === s ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setStatusFilter(s)}
                        className="h-7 text-xs"
                    >
                        {statusFilterLabels[s]}
                    </Button>
                ))}
                <div className="flex-1" />
                <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="h-7 text-xs border rounded px-2"
                />
                <span className="text-xs text-muted-foreground">{t('to')}</span>
                <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="h-7 text-xs border rounded px-2"
                />
            </div>

            {/* Execution table */}
            <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                        <tr>
                            <th className="text-start px-4 py-2 font-medium">{t('table.started')}</th>
                            <th className="text-start px-4 py-2 font-medium">{t('table.completed')}</th>
                            <th className="text-start px-4 py-2 font-medium">{t('table.status')}</th>
                            <th className="text-start px-4 py-2 font-medium">{t('table.duration')}</th>
                            <th className="text-start px-4 py-2 font-medium">{t('table.error')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading ? (
                            <tr>
                                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                                    {t('loading')}
                                </td>
                            </tr>
                        ) : executions.length === 0 ? (
                            <tr>
                                <td colSpan={5} className="px-4 py-12 text-center">
                                    <div className="space-y-2">
                                        <p className="text-sm font-medium text-muted-foreground">{t('empty.title')}</p>
                                        <p className="text-xs text-gray-400 max-w-md mx-auto">
                                            {t('empty.hint')}
                                        </p>
                                    </div>
                                </td>
                            </tr>
                        ) : (
                            executions.map((ex) => {
                                const duration =
                                    ex.started_at && ex.completed_at
                                        ? new Date(ex.completed_at).getTime() - new Date(ex.started_at).getTime()
                                        : null;
                                return (
                                    <tr
                                        key={ex.id}
                                        className="border-t hover:bg-muted/30 cursor-pointer transition-colors"
                                        onClick={() => {
                                            setSelectedExecution(ex);
                                            setDrawerOpen(true);
                                            if (onViewOnDiagram) onViewOnDiagram(ex.id);
                                        }}
                                    >
                                        <td className="px-4 py-2 text-xs">
                                            {ex.started_at ? new Date(ex.started_at).toLocaleString(i18n.language) : '-'}
                                        </td>
                                        <td className="px-4 py-2 text-xs">
                                            {ex.completed_at ? new Date(ex.completed_at).toLocaleString(i18n.language) : '-'}
                                        </td>
                                        <td className="px-4 py-2">
                                            <Badge className={`${statusBadgeColor[ex.status] ?? 'bg-gray-100'} text-[10px]`}>
                                                {ex.status}
                                            </Badge>
                                        </td>
                                        <td className="px-4 py-2 text-xs">
                                            {duration !== null
                                                ? duration < 1000
                                                    ? `${duration}ms`
                                                    : `${(duration / 1000).toFixed(1)}s`
                                                : '-'}
                                        </td>
                                        <td className="px-4 py-2 text-xs text-red-600 truncate max-w-[200px]">
                                            {ex.error_message ?? ''}
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                        {t('pagination.summary', {
                            current: page + 1,
                            total: totalPages,
                            count: executionData?.total_elements ?? 0,
                        })}
                    </span>
                    <div className="flex gap-1">
                        <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
                            <CaretLeft size={14} />
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={page >= totalPages - 1}
                            onClick={() => setPage(page + 1)}
                        >
                            <CaretRight size={14} />
                        </Button>
                    </div>
                </div>
            )}

            {/* Detail drawer */}
            <ExecutionDetailDrawer
                execution={selectedExecution}
                open={drawerOpen}
                onOpenChange={setDrawerOpen}
                onViewOnDiagram={onViewOnDiagram}
            />
        </div>
    );
}
