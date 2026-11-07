import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { X } from '@phosphor-icons/react';
import { WorkflowExecutionLogDTO } from '@/types/workflow/workflow-types';

interface Props {
    log: WorkflowExecutionLogDTO | null;
    onClose: () => void;
}

const statusColor: Record<string, string> = {
    SUCCESS: 'bg-green-100 text-green-800',
    FAILED: 'bg-red-100 text-red-800',
    PARTIAL_SUCCESS: 'bg-yellow-100 text-yellow-800',
    SKIPPED: 'bg-gray-100 text-gray-600',
    RUNNING: 'bg-blue-100 text-blue-800',
};

export function NodeLogPopover({ log, onClose }: Props) {
    const { t, i18n } = useTranslation('workflowNodeLogPopover');
    if (!log) return null;

    return (
        <div className="h-full border rounded-lg bg-white shadow-sm flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
                <div className="flex items-center gap-2 min-w-0">
                    <Badge variant="outline" className="text-[10px] uppercase shrink-0">{log.node_type}</Badge>
                    <Badge className={`${statusColor[log.status] ?? ''} text-[10px] shrink-0`}>{log.status}</Badge>
                </div>
                <Button variant="ghost" size="sm" onClick={onClose} className="h-6 w-6 p-0 shrink-0">
                    <X size={14} />
                </Button>
            </div>

            {/* Body — scrollable */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs">
                {log.execution_time_ms != null && (
                    <div>
                        <span className="text-muted-foreground">{t('duration')}</span>
                        <span className="font-medium">
                            {log.execution_time_ms < 1000
                                ? `${Math.round(log.execution_time_ms)}ms`
                                : `${(log.execution_time_ms / 1000).toFixed(1)}s`}
                        </span>
                    </div>
                )}

                {log.started_at && (
                    <div>
                        <span className="text-muted-foreground">{t('started')}</span>
                        {new Date(log.started_at).toLocaleString(i18n.language)}
                    </div>
                )}

                {log.completed_at && (
                    <div>
                        <span className="text-muted-foreground">{t('completed')}</span>
                        {new Date(log.completed_at).toLocaleString(i18n.language)}
                    </div>
                )}

                {log.error_message && (
                    <div className="bg-red-50 border border-red-200 rounded p-2 text-red-700">
                        <div className="font-medium mb-1">{t('error')}</div>
                        <div className="break-words">{log.error_message}</div>
                        {log.error_type && (
                            <Badge variant="outline" className="mt-1 text-[9px]">{log.error_type}</Badge>
                        )}
                    </div>
                )}

                {log.details && Object.keys(log.details).length > 0 && (
                    <div>
                        <div className="text-muted-foreground font-medium mb-1">{t('details')}</div>
                        <pre className="bg-muted rounded p-2 text-[10px] overflow-auto max-h-48 whitespace-pre-wrap break-words">
                            {JSON.stringify(log.details, null, 2)}
                        </pre>
                    </div>
                )}
            </div>
        </div>
    );
}
