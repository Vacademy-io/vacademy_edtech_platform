import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Badge } from '@/components/ui/badge';
import { WorkflowExecutionLogDTO } from '@/types/workflow/workflow-types';
import { CaretDown, CaretRight, Warning, CheckCircle, XCircle, SkipForward, Spinner } from '@phosphor-icons/react';

interface Props {
    log: WorkflowExecutionLogDTO;
}

const buildStatusConfig = (
    t: TFunction
): Record<string, { color: string; icon: React.ReactNode; label: string }> => ({
    SUCCESS: { color: 'bg-green-100 text-green-800', icon: <CheckCircle size={14} className="text-green-600" />, label: t('status.SUCCESS') },
    FAILED: { color: 'bg-red-100 text-red-800', icon: <XCircle size={14} className="text-red-600" />, label: t('status.FAILED') },
    PARTIAL_SUCCESS: { color: 'bg-yellow-100 text-yellow-800', icon: <Warning size={14} className="text-yellow-600" />, label: t('status.PARTIAL_SUCCESS') },
    SKIPPED: { color: 'bg-gray-100 text-gray-600', icon: <SkipForward size={14} className="text-gray-500" />, label: t('status.SKIPPED') },
    RUNNING: { color: 'bg-blue-100 text-blue-800', icon: <Spinner size={14} className="text-blue-600 animate-spin" />, label: t('status.RUNNING') },
});

export function ExecutionNodeLogCard({ log }: Props) {
    const { t, i18n } = useTranslation('workflowExecutionNodeLogCard');
    const [expanded, setExpanded] = useState(false);
    const statusConfig = buildStatusConfig(t);
    const config = (statusConfig[log.status] ?? statusConfig['RUNNING'])!;

    const formatDuration = (ms: number | null) => {
        if (!ms) return '-';
        if (ms < 1000) return `${Math.round(ms)}ms`;
        if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
        return `${(ms / 60000).toFixed(1)}m`;
    };

    return (
        <div className="border rounded-lg overflow-hidden">
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-start"
            >
                {expanded ? <CaretDown size={14} /> : <CaretRight size={14} />}
                {config.icon}
                <Badge variant="outline" className="text-[10px] uppercase">
                    {log.node_type}
                </Badge>
                <Badge className={`${config.color} text-[10px]`}>{config.label}</Badge>
                <span className="flex-1 text-sm truncate text-muted-foreground">
                    {log.node_template_id?.slice(0, 8)}...
                </span>
                <span className="text-xs text-muted-foreground">
                    {formatDuration(log.execution_time_ms)}
                </span>
            </button>

            {expanded && (
                <div className="px-4 pb-4 pt-1 border-t bg-muted/20 space-y-2">
                    {log.error_message && (
                        <div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700">
                            <span className="font-medium">{t('error')}</span>
                            {log.error_message}
                            {log.error_type && (
                                <Badge variant="outline" className="ms-2 text-[10px]">
                                    {log.error_type}
                                </Badge>
                            )}
                        </div>
                    )}
                    {log.details && (
                        <div className="bg-muted rounded p-2">
                            <div className="text-[10px] font-medium text-muted-foreground mb-1">{t('details')}</div>
                            <pre className="text-xs overflow-auto max-h-48 whitespace-pre-wrap">
                                {JSON.stringify(log.details, null, 2)}
                            </pre>
                        </div>
                    )}
                    <div className="flex gap-4 text-[10px] text-muted-foreground">
                        {log.started_at && <span>{t('started')}{new Date(log.started_at).toLocaleString(i18n.language)}</span>}
                        {log.completed_at && <span>{t('completed')}{new Date(log.completed_at).toLocaleString(i18n.language)}</span>}
                    </div>
                </div>
            )}
        </div>
    );
}
