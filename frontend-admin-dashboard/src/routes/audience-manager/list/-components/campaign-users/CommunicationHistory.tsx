import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Button } from '@/components/ui/button';
import { Pagination, PaginationContent, PaginationItem } from '@/components/ui/pagination';
import {
    CaretLeft,
    CaretRight,
    ChatCircleDots,
    CheckCircle,
    ClockCounterClockwise,
    EnvelopeSimple,
    Bell,
    PaperPlaneTilt,
    Users,
    WarningCircle,
    XCircle,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StatStrip } from '@/components/shared/crm-enhance';
import {
    EmptyChart,
    SectionCard,
} from '@/routes/study-library/live-session/-components/dashboard/dashboard-charts';
import {
    getAudienceCommunications,
    type AudienceCommunicationItem,
} from '../../-services/send-audience-message';

interface CommunicationHistoryProps {
    campaignId: string;
    /** Opens the page's Send Message dialog (same dialog as the toolbar button). */
    onSendMessage?: () => void;
}

const CHANNEL_ICONS: Record<string, React.ReactNode> = {
    WHATSAPP: <ChatCircleDots className="size-4 text-success-600" />,
    EMAIL: <EnvelopeSimple className="size-4 text-info-600" />,
    PUSH: <Bell className="size-4 text-primary-500" />,
    SYSTEM_ALERT: <WarningCircle className="size-4 text-warning-600" />,
};

const STATUS_COLORS: Record<string, string> = {
    COMPLETED: 'bg-success-50 text-success-700',
    PROCESSING: 'bg-info-50 text-info-600',
    PARTIAL: 'bg-warning-50 text-warning-700',
    FAILED: 'bg-danger-50 text-danger-600',
    PENDING: 'bg-neutral-100 text-neutral-600',
};

function buildChannelLabels(t: TFunction): Record<string, string> {
    return {
        WHATSAPP: t('channels.whatsapp'),
        EMAIL: t('channels.email'),
        PUSH: t('channels.push'),
        SYSTEM_ALERT: t('channels.systemAlert'),
    };
}

function buildStatusLabels(t: TFunction): Record<string, string> {
    return {
        COMPLETED: t('statuses.completed'),
        PROCESSING: t('statuses.processing'),
        PARTIAL: t('statuses.partial'),
        FAILED: t('statuses.failed'),
        PENDING: t('statuses.pending'),
    };
}

function formatDate(dateStr: string): string {
    try {
        return new Date(dateStr).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return dateStr;
    }
}

export function CommunicationHistory({ campaignId, onSendMessage }: CommunicationHistoryProps) {
    const { t, i18n } = useTranslation('audienceManagerCommunicationHistory');
    const [page, setPage] = useState(0);
    const pageSize = 10;

    const { data, isLoading } = useQuery({
        queryKey: ['audienceCommunications', campaignId, page],
        queryFn: () => getAudienceCommunications(campaignId, page, pageSize),
        enabled: !!campaignId,
    });

    const channelLabels = buildChannelLabels(t);
    const statusLabels = buildStatusLabels(t);

    const sendButton = onSendMessage ? (
        <MyButton buttonType="primary" scale="small" onClick={onSendMessage}>
            <PaperPlaneTilt size={14} />
            {t('sendMessage')}
        </MyButton>
    ) : undefined;

    if (isLoading) {
        return (
            <div className="flex flex-col gap-4" aria-label={t('loading')}>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    {[0, 1, 2, 3].map((i) => (
                        <Skeleton key={i} className="h-28 rounded-xl" />
                    ))}
                </div>
                <Skeleton className="h-64 rounded-xl" />
            </div>
        );
    }

    if (!data || data.content.length === 0) {
        return (
            <SectionCard
                icon={ClockCounterClockwise}
                title={t('heading')}
                subtitle={t('subtitle')}
                right={sendButton}
            >
                <EmptyChart text={t('emptyState')} className="h-40" />
            </SectionCard>
        );
    }

    // Totals of the sends on this page (the endpoint returns no overall sums).
    const items = data.content;
    const recipients = items.reduce((s, i) => s + (i.recipient_count || 0), 0);
    const accepted = items.reduce((s, i) => s + (i.successful || 0), 0);
    const failed = items.reduce((s, i) => s + (i.failed || 0), 0);
    const pageNote = t('summary.latest', { count: items.length });
    const fmtNum = (n: number) => n.toLocaleString(i18n.language);

    return (
        <div className="flex flex-col gap-4">
            <StatStrip
                items={[
                    {
                        key: 'sent',
                        icon: PaperPlaneTilt,
                        label: t('summary.sent'),
                        value: data.totalElements,
                        detail: t('summary.sentDetail'),
                    },
                    {
                        key: 'recipients',
                        icon: Users,
                        tint: 'info',
                        label: t('summary.recipients'),
                        value: recipients,
                        detail: pageNote,
                    },
                    {
                        key: 'accepted',
                        icon: CheckCircle,
                        tint: 'success',
                        label: t('summary.accepted'),
                        value: recipients
                            ? `${Math.round((accepted / recipients) * 100)}%`
                            : fmtNum(accepted),
                        detail: t('summary.acceptedDetail', {
                            accepted: fmtNum(accepted),
                            total: fmtNum(recipients),
                        }),
                    },
                    {
                        key: 'failed',
                        icon: XCircle,
                        tint: 'danger',
                        label: t('summary.failed'),
                        value: failed,
                        detail: pageNote,
                    },
                ]}
            />
            <SectionCard
                icon={ClockCounterClockwise}
                title={t('heading')}
                subtitle={t('subtitle')}
                right={sendButton}
            >
                {/* Full-bleed table: cancels the card padding on the sides and bottom. */}
                <div className="-mx-4 -mb-4 border-t border-neutral-200 sm:-mx-5 sm:-mb-5">
                    <div className="overflow-x-auto">
                        <table className="w-full text-body">
                            <thead className="bg-neutral-50 text-caption uppercase tracking-wide text-neutral-500">
                                <tr>
                                    <th className="px-4 py-2.5 text-start font-semibold">
                                        {t('table.channel')}
                                    </th>
                                    <th className="px-4 py-2.5 text-start font-semibold">
                                        {t('table.templateSubject')}
                                    </th>
                                    <th className="px-4 py-2.5 text-end font-semibold">
                                        {t('table.recipients')}
                                    </th>
                                    <th className="px-4 py-2.5 text-start font-semibold">
                                        {t('table.result')}
                                    </th>
                                    <th className="px-4 py-2.5 text-start font-semibold">
                                        {t('table.status')}
                                    </th>
                                    <th className="px-4 py-2.5 text-start font-semibold">
                                        {t('table.sentAt')}
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {items.map((item: AudienceCommunicationItem) => (
                                    <tr
                                        key={item.id}
                                        className="border-t border-neutral-100 hover:bg-neutral-50"
                                    >
                                        <td className="px-4 py-2.5">
                                            <div className="flex items-center gap-1.5 font-medium text-neutral-800">
                                                {CHANNEL_ICONS[item.channel] || null}
                                                <span className="text-caption">
                                                    {channelLabels[item.channel] || item.channel}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="max-w-56 truncate px-4 py-2.5 text-neutral-800">
                                            {item.template_name ||
                                                item.subject ||
                                                t('noValuePlaceholder')}
                                        </td>
                                        <td className="px-4 py-2.5 text-end tabular-nums text-neutral-800">
                                            {fmtNum(item.recipient_count)}
                                        </td>
                                        <td className="px-4 py-2.5">
                                            <span className="font-semibold text-success-700">
                                                {fmtNum(item.successful)}
                                            </span>
                                            {item.failed > 0 && (
                                                <>
                                                    {' · '}
                                                    <span className="text-danger-600">
                                                        {t('failedCount', { count: item.failed })}
                                                    </span>
                                                </>
                                            )}
                                        </td>
                                        <td className="px-4 py-2.5">
                                            <span
                                                className={`inline-block rounded-full px-2 py-0.5 text-caption font-medium ${STATUS_COLORS[item.status] || STATUS_COLORS.PENDING}`}
                                            >
                                                {statusLabels[item.status] || item.status}
                                            </span>
                                        </td>
                                        <td className="px-4 py-2.5 text-caption text-neutral-500">
                                            {formatDate(item.created_at)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {data.totalPages > 1 && (
                        <div className="border-t border-neutral-200 py-2">
                            <Pagination>
                                <PaginationContent>
                                    <PaginationItem>
                                        <Button
                                            variant="outline"
                                            size="icon"
                                            onClick={() => setPage(Math.max(0, page - 1))}
                                            disabled={page === 0}
                                        >
                                            <CaretLeft className="size-4" />
                                        </Button>
                                    </PaginationItem>
                                    <PaginationItem>
                                        <span className="px-3 text-body text-neutral-600">
                                            {t('pageOf', {
                                                current: page + 1,
                                                total: data.totalPages,
                                            })}
                                        </span>
                                    </PaginationItem>
                                    <PaginationItem>
                                        <Button
                                            variant="outline"
                                            size="icon"
                                            onClick={() =>
                                                setPage(Math.min(data.totalPages - 1, page + 1))
                                            }
                                            disabled={page >= data.totalPages - 1}
                                        >
                                            <CaretRight className="size-4" />
                                        </Button>
                                    </PaginationItem>
                                </PaginationContent>
                            </Pagination>
                        </div>
                    )}
                </div>
            </SectionCard>
        </div>
    );
}
