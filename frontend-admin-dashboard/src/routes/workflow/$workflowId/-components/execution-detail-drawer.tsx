import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getExecutionLogsQuery } from '@/services/workflow-service';
import { ExecutionNodeLogCard } from './execution-node-log-card';
import { Eye } from '@phosphor-icons/react';

interface ExecutionRow {
    id: string;
    status: string;
    error_message: string | null;
    started_at: string | null;
    completed_at: string | null;
    idempotency_key: string;
}

interface Props {
    execution: ExecutionRow | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onViewOnDiagram?: (executionId: string) => void;
}

const statusBadgeColor: Record<string, string> = {
    COMPLETED: 'bg-green-100 text-green-800',
    FAILED: 'bg-red-100 text-red-800',
    PROCESSING: 'bg-blue-100 text-blue-800',
    PENDING: 'bg-yellow-100 text-yellow-800',
};

export function ExecutionDetailDrawer({ execution, open, onOpenChange, onViewOnDiagram }: Props) {
    const { t, i18n } = useTranslation('workflowExecutionDetailDrawer');
    const { data: logs, isLoading } = useQuery({
        ...getExecutionLogsQuery(execution?.id ?? ''),
        enabled: open && !!execution?.id,
    });

    if (!execution) return null;

    const duration =
        execution.started_at && execution.completed_at
            ? Math.round(
                  (new Date(execution.completed_at).getTime() - new Date(execution.started_at).getTime())
              )
            : null;

    const formatDuration = (ms: number | null) => {
        if (!ms) return '-';
        if (ms < 1000) return `${ms}ms`;
        if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
        return `${(ms / 60000).toFixed(1)}m`;
    };

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
                <SheetHeader>
                    <SheetTitle className="flex items-center gap-2">
                        {t('title')}
                        <Badge className={statusBadgeColor[execution.status] ?? 'bg-gray-100'}>
                            {execution.status}
                        </Badge>
                    </SheetTitle>
                </SheetHeader>

                <div className="mt-4 space-y-4">
                    {/* Metadata */}
                    <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                            <span className="text-muted-foreground">{t('started')}</span>
                            <div className="font-medium">
                                {execution.started_at
                                    ? new Date(execution.started_at).toLocaleString(i18n.language)
                                    : '-'}
                            </div>
                        </div>
                        <div>
                            <span className="text-muted-foreground">{t('completed')}</span>
                            <div className="font-medium">
                                {execution.completed_at
                                    ? new Date(execution.completed_at).toLocaleString(i18n.language)
                                    : '-'}
                            </div>
                        </div>
                        <div>
                            <span className="text-muted-foreground">{t('duration')}</span>
                            <div className="font-medium">{formatDuration(duration)}</div>
                        </div>
                        <div>
                            <span className="text-muted-foreground">{t('idempotencyKey')}</span>
                            <div className="font-medium text-xs truncate">{execution.idempotency_key}</div>
                        </div>
                    </div>

                    {execution.error_message && (
                        <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700">
                            {execution.error_message}
                        </div>
                    )}

                    {/* View on Diagram button */}
                    {onViewOnDiagram && (
                        <Button
                            variant="outline"
                            size="sm"
                            className="w-full"
                            onClick={() => {
                                onViewOnDiagram(execution.id);
                                onOpenChange(false);
                            }}
                        >
                            <Eye size={16} className="me-2" />
                            {t('viewOnDiagram')}
                        </Button>
                    )}

                    {/* Node Logs */}
                    <div>
                        <h3 className="text-sm font-semibold mb-2">
                            {logs ? t('nodeExecutionLogsCount', { count: logs.length }) : t('nodeExecutionLogs')}
                        </h3>
                        {isLoading ? (
                            <div className="text-sm text-muted-foreground py-4 text-center">{t('loadingLogs')}</div>
                        ) : logs && logs.length > 0 ? (
                            <div className="space-y-2">
                                {logs.map((log) => (
                                    <ExecutionNodeLogCard key={log.id} log={log} />
                                ))}
                            </div>
                        ) : (
                            <div className="text-sm text-muted-foreground py-4 text-center">{t('noNodeLogsFound')}</div>
                        )}
                    </div>
                </div>
            </SheetContent>
        </Sheet>
    );
}
