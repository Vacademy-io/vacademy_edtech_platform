import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { ExecutionSummary } from '@/types/workflow/workflow-types';
import { Lightning, CheckCircle, XCircle, Clock } from '@phosphor-icons/react';

interface Props {
    summary: ExecutionSummary;
}

export function ExecutionSummaryCards({ summary }: Props) {
    const { t } = useTranslation('workflowExecutionSummaryCards');
    const formatDuration = (ms: number) => {
        if (ms < 1000) return `${Math.round(ms)}ms`;
        if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
        return `${(ms / 60000).toFixed(1)}m`;
    };

    return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card>
                <CardContent className="p-4">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                        <Lightning size={16} />
                        {t('totalRuns')}
                    </div>
                    <div className="text-2xl font-bold">{summary.total_executions}</div>
                </CardContent>
            </Card>
            <Card>
                <CardContent className="p-4">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                        <CheckCircle size={16} className="text-green-500" />
                        {t('successRate')}
                    </div>
                    <div className="text-2xl font-bold text-green-600">
                        {(summary.success_rate * 100).toFixed(1)}%
                    </div>
                </CardContent>
            </Card>
            <Card>
                <CardContent className="p-4">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                        <Clock size={16} className="text-blue-500" />
                        {t('avgDuration')}
                    </div>
                    <div className="text-2xl font-bold">
                        {formatDuration(summary.avg_execution_time_ms)}
                    </div>
                </CardContent>
            </Card>
            <Card>
                <CardContent className="p-4">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                        <XCircle size={16} className="text-red-500" />
                        {t('failed')}
                    </div>
                    <div className="text-2xl font-bold text-red-600">{summary.failed}</div>
                </CardContent>
            </Card>
        </div>
    );
}
