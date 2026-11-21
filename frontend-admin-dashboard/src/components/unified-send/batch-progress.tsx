import { useEffect, useState } from 'react';
import {
    getBatchStatus,
    insufficientCreditsMessage,
    type UnifiedSendResponse,
} from '@/services/unified-send-service';
import { CheckCircle, XCircle, Spinner, Clock } from '@phosphor-icons/react';

interface Props {
    batchId: string;
    onComplete?: (result: UnifiedSendResponse) => void;
}

/**
 * Shows real-time progress for async batch sends (>100 recipients).
 * Polls every 2 seconds until batch completes.
 */
export function BatchProgress({ batchId, onComplete }: Props) {
    const [status, setStatus] = useState<UnifiedSendResponse | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let active = true;

        const poll = async () => {
            try {
                const result = await getBatchStatus(batchId);
                if (!active) return;
                setStatus(result);

                if (result.status !== 'PROCESSING') {
                    onComplete?.(result);
                    return;
                }

                setTimeout(poll, 2000);
            } catch (err) {
                if (!active) return;
                setError(err instanceof Error ? err.message : 'Failed to get status');
            }
        };

        poll();
        return () => { active = false; };
    }, [batchId]);

    if (error) {
        return (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                <XCircle size={18} className="text-red-500" />
                <span className="text-sm text-red-700">{error}</span>
            </div>
        );
    }

    if (!status) {
        return (
            <div className="flex items-center gap-2 p-3 bg-gray-50 border rounded-lg">
                <Spinner size={18} className="text-gray-400 animate-spin" />
                <span className="text-sm text-gray-500">Loading batch status...</span>
            </div>
        );
    }

    const progress = status.total > 0 ? ((status.accepted + status.failed) / status.total) * 100 : 0;
    const isComplete = status.status !== 'PROCESSING';

    const statuses: Record<string, any> = {
        COMPLETED: { icon: CheckCircle, color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-200', label: 'Completed' },
        PARTIAL: { icon: CheckCircle, color: 'text-yellow-600', bg: 'bg-yellow-50', border: 'border-yellow-200', label: 'Partial' },
        FAILED: { icon: XCircle, color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200', label: 'Failed' },
        PROCESSING: { icon: Clock, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200', label: 'Processing' },
        // Refused whole for lack of free emails or credits: nothing went out.
        INSUFFICIENT_CREDITS: { icon: XCircle, color: 'text-danger-600', bg: 'bg-danger-50', border: 'border-danger-200', label: 'Not sent — no credits' },
    };

    const statusConfig = statuses[status.status] || statuses.PROCESSING;

    const Icon = statusConfig.icon;

    return (
        <div className={`p-3 ${statusConfig.bg} border ${statusConfig.border} rounded-lg`}>
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                    {isComplete ? (
                        <Icon size={18} className={statusConfig.color} />
                    ) : (
                        <Spinner size={18} className="text-blue-500 animate-spin" />
                    )}
                    <span className={`text-sm font-medium ${statusConfig.color}`}>
                        {statusConfig.label}
                    </span>
                </div>
                <span className="text-xs text-gray-500">
                    {status.accepted + status.failed} / {status.total}
                </span>
            </div>

            {/* Progress bar */}
            <div className="w-full bg-gray-200 rounded-full h-1.5">
                <div
                    className={`h-1.5 rounded-full transition-all duration-300 ${
                        status.failed > 0 ? 'bg-yellow-500' : 'bg-green-500'
                    }`}
                    style={{ width: `${progress}%` }}
                />
            </div>

            {/* Stats */}
            <div className="flex gap-4 mt-2 text-xs text-gray-500">
                <span className="text-green-600">{status.accepted} sent</span>
                {status.failed > 0 && <span className="text-red-500">{status.failed} failed</span>}
            </div>
            {status.status === 'INSUFFICIENT_CREDITS' && (
                <p className="mt-2 text-caption text-danger-700">{insufficientCreditsMessage(status)}</p>
            )}
        </div>
    );
}
