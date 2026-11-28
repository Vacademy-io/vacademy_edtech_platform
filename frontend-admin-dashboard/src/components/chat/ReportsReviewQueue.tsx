import { useEffect, useState, useCallback } from 'react';
import { Flag, Robot, SpinnerGap, Trash, Warning } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
    listAdminReports,
    reviewReport,
    deleteMessage as apiDeleteMessage,
    describeDeleteChatError,
    type ChatReportResponse,
    type ReportStatus,
} from '@/services/chat/chatApi';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { formatDateAndClockTime, toUtcDate } from './chatTime';

const STATUS_FILTERS: { label: string; value?: ReportStatus }[] = [
    { label: 'Open', value: 'OPEN' },
    { label: 'Reviewing', value: 'REVIEWING' },
    { label: 'Actioned', value: 'ACTIONED' },
    { label: 'Dismissed', value: 'DISMISSED' },
    { label: 'All', value: undefined },
];

const PAGE_SIZE = 20;

const isSystemReason = (reason: string): boolean => {
    const r = reason.toUpperCase();
    return r.includes('SYSTEM') || r.includes('AUTO_MODERATION') || r.includes('AUTO');
};

const statusBadgeClass = (status: string): string => {
    switch (status.toUpperCase()) {
        case 'OPEN':
            return 'bg-warning-50 text-warning-600';
        case 'REVIEWING':
            return 'bg-info-50 text-info-600';
        case 'ACTIONED':
            return 'bg-danger-50 text-danger-600';
        case 'DISMISSED':
            return 'bg-neutral-100 text-neutral-500';
        default:
            return 'bg-neutral-100 text-neutral-500';
    }
};

/** Same wording the member picks from in the report dialog; unknown reasons fall back to title case. */
const REASON_LABELS: Record<string, string> = {
    SPAM: 'Spam or advertising',
    ABUSE: 'Abusive language',
    HARASSMENT: 'Harassment or bullying',
    INAPPROPRIATE: 'Inappropriate content',
    OTHER: 'Something else',
};

const titleCase = (v: string): string =>
    v
        .toLowerCase()
        .replace(/_/g, ' ')
        .replace(/^\w/, (c) => c.toUpperCase());

const reasonLabel = (reason: string): string =>
    REASON_LABELS[reason.toUpperCase()] ?? titleCase(reason);

const humanizeStatus = (status: string): string => titleCase(status);

const conversationTypeLabel = (type: string): string =>
    type === 'DIRECT'
        ? 'Direct message'
        : type === 'COMMUNITY'
          ? 'Community'
          : `${getTerminology(ContentTerms.Batch, SystemTerms.Batch)} group`;

const formatDate = (iso: string): string => {
    const d = toUtcDate(iso);
    return d ? formatDateAndClockTime(d) : '';
};

export function ReportsReviewQueue() {
    const [status, setStatus] = useState<ReportStatus | undefined>('OPEN');
    const [reports, setReports] = useState<ChatReportResponse[]>([]);
    const [page, setPage] = useState(0);
    const [totalPages, setTotalPages] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [isError, setIsError] = useState(false);
    const [updatingId, setUpdatingId] = useState<string | null>(null);

    const load = useCallback(
        async (nextStatus: ReportStatus | undefined, nextPage: number) => {
            setIsLoading(true);
            setIsError(false);
            try {
                const res = await listAdminReports(nextStatus, nextPage, PAGE_SIZE);
                setReports(res.content);
                setTotalPages(res.totalPages);
            } catch {
                setIsError(true);
                setReports([]);
            } finally {
                setIsLoading(false);
            }
        },
        []
    );

    useEffect(() => {
        void load(status, page);
    }, [status, page, load]);

    const handleStatusFilter = (next?: ReportStatus) => {
        setPage(0);
        setStatus(next);
    };

    /**
     * Take the reported message down and close the report in one go. Marking a report ACTIONED on its
     * own changes nothing a member can see — the offending message stays in the thread — so a reviewer
     * otherwise has to go find it again by hand in the conversation.
     */
    const handleRemoveMessage = async (report: ChatReportResponse) => {
        if (!report.messageId) return;
        setUpdatingId(report.id);
        try {
            await apiDeleteMessage(report.conversationId, report.messageId);
        } catch (err) {
            toast.error(describeDeleteChatError(err));
            setUpdatingId(null);
            return;
        }
        // Closing the report is a separate call: the message is already gone by here, so a failure
        // must not be reported as a failed delete.
        try {
            await reviewReport(report.id, 'ACTIONED');
            toast.success('Message deleted and report actioned.');
        } catch {
            toast.error('Message deleted, but the report could not be marked actioned.');
        } finally {
            await load(status, page);
            setUpdatingId(null);
        }
    };

    const handleReview = async (report: ChatReportResponse, nextStatus: ReportStatus) => {
        setUpdatingId(report.id);
        try {
            await reviewReport(report.id, nextStatus);
            toast.success(`Report marked ${nextStatus.toLowerCase()}.`);
            await load(status, page);
        } catch {
            toast.error('Failed to update the report.');
        } finally {
            setUpdatingId(null);
        }
    };

    return (
        <div className="flex h-full flex-col bg-neutral-50">
            {/* Status quick views */}
            <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-neutral-200 bg-white px-4 py-3">
                <div className="flex flex-wrap gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-0.5">
                    {STATUS_FILTERS.map((f) => (
                        <button
                            key={f.label}
                            type="button"
                            onClick={() => handleStatusFilter(f.value)}
                            aria-pressed={status === f.value}
                            className={cn(
                                'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                                status === f.value
                                    ? 'bg-white text-primary-600 shadow-sm'
                                    : 'text-neutral-500 hover:text-neutral-700'
                            )}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>
                <span className="text-caption text-neutral-500">
                    Reported and auto-flagged messages from groups, the community and direct
                    messages.
                </span>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
                {isLoading && (
                    <div className="flex items-center justify-center py-16">
                        <SpinnerGap size={24} className="animate-spin text-primary-500" />
                    </div>
                )}

                {!isLoading && isError && (
                    <div className="mx-auto flex max-w-md items-center gap-2 rounded-lg border border-danger-200 bg-danger-50 px-4 py-3">
                        <Warning size={20} className="text-danger-500" />
                        <span className="text-sm text-danger-700">
                            Could not load reports. Please try again.
                        </span>
                    </div>
                )}

                {!isLoading && !isError && reports.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                        <span className="mb-3 flex size-12 items-center justify-center rounded-full bg-white text-neutral-300">
                            <Flag size={28} weight="duotone" />
                        </span>
                        <p className="text-sm font-medium text-neutral-600">
                            No reports in this view.
                        </p>
                        <p className="mt-1 text-xs text-neutral-400">
                            Reported and auto-flagged messages appear here.
                        </p>
                    </div>
                )}

                {!isLoading &&
                    !isError &&
                    reports.map((report) => {
                        const system = isSystemReason(report.reason);
                        return (
                            <div
                                key={report.id}
                                className="mx-auto mb-3 max-w-4xl rounded-xl border border-neutral-200 bg-white p-4 shadow-sm"
                            >
                                <div className="mb-2 flex flex-wrap items-center gap-2">
                                    <span
                                        className={cn(
                                            'flex size-8 shrink-0 items-center justify-center rounded-lg',
                                            system
                                                ? 'bg-info-50 text-info-600'
                                                : 'bg-warning-50 text-warning-600'
                                        )}
                                    >
                                        {system ? (
                                            <Robot size={16} weight="duotone" />
                                        ) : (
                                            <Flag size={16} weight="duotone" />
                                        )}
                                    </span>
                                    <span className="text-sm font-semibold text-neutral-800">
                                        {reasonLabel(report.reason)}
                                    </span>
                                    {system && (
                                        <span className="rounded-full bg-info-50 px-2 py-0.5 text-caption font-semibold text-info-600">
                                            Auto
                                        </span>
                                    )}
                                    {/* Size on the inner span: cn() would drop text-caption
                                        against the badge's text colour. */}
                                    <span
                                        className={cn(
                                            'rounded-full px-2 py-0.5 font-semibold',
                                            statusBadgeClass(report.status)
                                        )}
                                    >
                                        <span className="text-caption">
                                            {humanizeStatus(report.status)}
                                        </span>
                                    </span>
                                    {report.conversationType && (
                                        <span className="ml-auto text-caption text-neutral-400">
                                            {conversationTypeLabel(report.conversationType)}
                                        </span>
                                    )}
                                </div>

                                {report.details && (
                                    <p className="mb-2 text-sm text-neutral-600">
                                        {report.details}
                                    </p>
                                )}

                                {report.reportedMessage?.content && (
                                    <div className="mb-2 rounded-r-lg border-l-4 border-neutral-300 bg-neutral-50 px-3 py-2">
                                        <div className="mb-1 text-caption font-semibold text-neutral-700">
                                            {report.reportedMessage.senderName ||
                                                report.reportedMessage.senderRole ||
                                                'Message'}
                                        </div>
                                        <div className="whitespace-pre-wrap break-words text-sm text-neutral-700">
                                            {report.reportedMessage.content}
                                        </div>
                                    </div>
                                )}

                                {report.reportedMessage?.attachmentUrl && (
                                    <a
                                        href={report.reportedMessage.attachmentUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="mb-2 inline-block"
                                    >
                                        <img
                                            src={report.reportedMessage.attachmentUrl}
                                            alt="reported attachment"
                                            className="max-h-40 rounded-md object-cover"
                                        />
                                    </a>
                                )}

                                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-100 pt-3">
                                    <span className="text-caption text-neutral-400">
                                        Reporter: {report.reporterId.slice(0, 8)}… ·{' '}
                                        {formatDate(report.createdAt)}
                                    </span>
                                    <div className="flex flex-wrap items-center gap-2">
                                        {report.status.toUpperCase() !== 'REVIEWING' && (
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                disabled={updatingId === report.id}
                                                onClick={() => handleReview(report, 'REVIEWING')}
                                                className="h-7 px-2 text-xs"
                                            >
                                                Mark reviewing
                                            </Button>
                                        )}
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            disabled={updatingId === report.id}
                                            onClick={() => handleReview(report, 'DISMISSED')}
                                            className="h-7 px-2 text-xs"
                                        >
                                            Dismiss
                                        </Button>
                                        {/* A DM is private to its two participants — the server
                                            refuses moderation there, so the take-down is offered only
                                            on group channels (and never for an already-gone message). */}
                                        {report.messageId &&
                                            report.reportedMessage &&
                                            !report.reportedMessage.isDeleted &&
                                            report.conversationType !== 'DIRECT' && (
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    disabled={updatingId === report.id}
                                                    onClick={() => handleRemoveMessage(report)}
                                                    className="h-7 gap-1 px-2 text-xs"
                                                >
                                                    <Trash size={13} />
                                                    Delete message
                                                </Button>
                                            )}
                                        <Button
                                            size="sm"
                                            disabled={updatingId === report.id}
                                            onClick={() => handleReview(report, 'ACTIONED')}
                                            className="h-7 bg-danger-500 px-2 text-xs hover:bg-danger-600"
                                        >
                                            {updatingId === report.id ? (
                                                <SpinnerGap size={13} className="animate-spin" />
                                            ) : (
                                                'Mark actioned'
                                            )}
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
            </div>

            {/* Pagination */}
            {!isLoading && !isError && totalPages > 1 && (
                <div className="flex shrink-0 items-center justify-center gap-3 border-t border-neutral-200 bg-white py-3">
                    <Button
                        size="sm"
                        variant="outline"
                        disabled={page === 0}
                        onClick={() => setPage((p) => Math.max(0, p - 1))}
                    >
                        Previous
                    </Button>
                    <span className="text-xs text-neutral-500">
                        Page {page + 1} of {totalPages}
                    </span>
                    <Button
                        size="sm"
                        variant="outline"
                        disabled={page >= totalPages - 1}
                        onClick={() => setPage((p) => p + 1)}
                    >
                        Next
                    </Button>
                </div>
            )}
        </div>
    );
}
