import { useTranslation } from 'react-i18next';
import { WorkflowExecutionLogDTO } from '@/types/workflow/workflow-types';
import { Badge } from '@/components/ui/badge';

interface Props {
    logs: WorkflowExecutionLogDTO[];
    selectedNodeId: string | null;
    onSelectNode: (nodeId: string) => void;
}

const statusColor: Record<string, string> = {
    SUCCESS: 'bg-green-500',
    FAILED: 'bg-red-500',
    PARTIAL_SUCCESS: 'bg-yellow-500',
    SKIPPED: 'bg-gray-400',
    RUNNING: 'bg-blue-500',
};

export function ExecutionTimeline({ logs, selectedNodeId, onSelectNode }: Props) {
    const { t } = useTranslation('workflowExecutionTimeline');
    if (logs.length === 0) return null;

    // Calculate time range
    const startTimes = logs.filter((l) => l.started_at).map((l) => new Date(l.started_at!).getTime());
    const endTimes = logs
        .filter((l) => l.completed_at)
        .map((l) => new Date(l.completed_at!).getTime());
    const minTime = Math.min(...startTimes);
    const maxTime = Math.max(...endTimes, ...startTimes.map((t) => t + 1000));
    const totalDuration = maxTime - minTime || 1;

    return (
        <div className="border rounded-lg p-3 space-y-1.5">
            <div className="text-xs font-semibold mb-2">{t('title')}</div>
            {logs.map((log) => {
                const start = log.started_at ? new Date(log.started_at).getTime() : minTime;
                const end = log.completed_at
                    ? new Date(log.completed_at).getTime()
                    : start + (log.execution_time_ms ?? 500);

                const leftPct = ((start - minTime) / totalDuration) * 100;
                const widthPct = Math.max(((end - start) / totalDuration) * 100, 1);
                const isSelected = log.node_template_id === selectedNodeId;

                return (
                    <div
                        key={log.id}
                        className={`flex items-center gap-2 h-7 cursor-pointer rounded px-1 transition-colors ${
                            isSelected ? 'bg-blue-50' : 'hover:bg-muted/50'
                        }`}
                        onClick={() => onSelectNode(log.node_template_id)}
                    >
                        <Badge variant="outline" className="text-[9px] w-20 shrink-0 justify-center uppercase">
                            {log.node_type}
                        </Badge>
                        <div className="flex-1 relative h-4 bg-muted/30 rounded overflow-hidden">
                            <div
                                className={`absolute h-full rounded ${statusColor[log.status] ?? 'bg-gray-300'} opacity-80`}
                                style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                            />
                        </div>
                        <span className="text-[10px] text-muted-foreground w-12 text-end shrink-0">
                            {log.execution_time_ms != null
                                ? log.execution_time_ms < 1000
                                    ? `${Math.round(log.execution_time_ms)}ms`
                                    : `${(log.execution_time_ms / 1000).toFixed(1)}s`
                                : '-'}
                        </span>
                    </div>
                );
            })}
        </div>
    );
}
