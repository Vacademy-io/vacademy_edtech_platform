import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { EnvelopeSimple, Pulse, WhatsappLogo } from '@phosphor-icons/react';
import { Skeleton } from '@/components/ui/skeleton';
import { MyButton } from '@/components/design-system/button';
import {
    EmptyChart,
    SectionCard,
} from '@/routes/study-library/live-session/-components/dashboard/dashboard-charts';
import type { HubRecentItem } from '../../-services/hub-api';

interface Props {
    items: HubRecentItem[];
    loading: boolean;
    hasMore: boolean;
    loadingMore: boolean;
    onLoadMore: () => void;
}

export function RecentActivity({ items, loading, hasMore, loadingMore, onLoadMore }: Props) {
    const { t, i18n } = useTranslation('communicationRecentActivity');

    return (
        <SectionCard title={t('title')} subtitle={t('subtitle')} icon={Pulse} className="h-full">
            {loading && items.length === 0 ? (
                <div className="space-y-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="h-14 rounded-md" />
                    ))}
                </div>
            ) : items.length === 0 ? (
                <EmptyChart text={t('emptyState')} className="h-32" />
            ) : (
                <>
                    <ul className="-mx-1 divide-y divide-neutral-100">
                        {items.map((item) => (
                            <li
                                key={item.id}
                                className="rounded-lg px-1 py-2.5 transition hover:bg-neutral-50"
                            >
                                <div className="flex items-start gap-3">
                                    <ChannelIcon channel={item.channel} />
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                            <span className="truncate text-sm font-semibold text-neutral-800">
                                                {item.fromName || item.from}
                                            </span>
                                            <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-caption font-medium uppercase text-neutral-600">
                                                {item.channel}
                                            </span>
                                        </div>
                                        {item.fromName && (
                                            <p className="truncate text-caption text-neutral-400">
                                                {item.from}
                                            </p>
                                        )}
                                        <p className="mt-0.5 truncate text-xs text-neutral-500">
                                            {item.preview || '—'}
                                        </p>
                                    </div>
                                    <span className="whitespace-nowrap text-caption text-neutral-400">
                                        {formatTime(item.timestamp, t, i18n.language)}
                                    </span>
                                </div>
                            </li>
                        ))}
                    </ul>
                    {(hasMore || loadingMore) && (
                        <div className="mt-2 flex justify-center border-t border-neutral-100 pt-3">
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                onClick={onLoadMore}
                                disable={loadingMore || !hasMore}
                            >
                                {loadingMore ? t('loadingMore') : t('loadMore')}
                            </MyButton>
                        </div>
                    )}
                    {!hasMore && items.length > 0 && !loadingMore && (
                        <p className="mt-2 border-t border-neutral-100 pt-3 text-center text-caption text-neutral-400">
                            {t('noMoreActivity')}
                        </p>
                    )}
                </>
            )}
        </SectionCard>
    );
}

function ChannelIcon({ channel }: { channel: HubRecentItem['channel'] }) {
    if (channel === 'EMAIL') {
        return (
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-info-50 text-info-600">
                <EnvelopeSimple size={16} />
            </div>
        );
    }
    return (
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-success-50 text-success-600">
            <WhatsappLogo size={16} />
        </div>
    );
}

function formatTime(timestamp: string, t: TFunction, locale: string): string {
    try {
        const d = new Date(timestamp);
        const now = new Date();
        const diffMs = now.getTime() - d.getTime();
        const diffMin = Math.floor(diffMs / 60000);
        if (diffMin < 1) return t('time.now');
        if (diffMin < 60) return t('time.minutes', { count: diffMin });
        const diffH = Math.floor(diffMin / 60);
        if (diffH < 24) return t('time.hours', { count: diffH });
        const diffD = Math.floor(diffH / 24);
        if (diffD < 7) return t('time.days', { count: diffD });
        return d.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
    } catch {
        return '';
    }
}
