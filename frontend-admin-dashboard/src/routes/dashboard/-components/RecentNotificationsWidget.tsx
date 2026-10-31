import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { getUserId } from '@/utils/userDetails';
import { stripHtml, formatAlertTimestamp } from '@/services/notifications/system-alerts';
import { useSystemAlertsPreview } from '../-hooks/useDashboardSources';
import SourceErrorNotice from './SourceErrorNotice';
import { BellSimple, ArrowRight } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';

export default function RecentNotificationsWidget({ onSeeAll }: { onSeeAll?: () => void }) {
    const { t } = useTranslation('dashboardRecentNotificationsWidget');
    const userId = getUserId();
    // useQuery, not useSuspenseQuery: no local Suspense boundary, so suspending blocked the
    // dashboard. Same key as the navbar bell, so this is served from its request.
    const { data, isLoading, refetch } = useSystemAlertsPreview(userId);
    const items = data?.content || [];
    // fetchSystemAlerts resolves to an empty page on failure; don't show that as "none".
    const failed = data?.fetchFailed === true;

    return (
        <Card className="flex h-full flex-col bg-white shadow-sm">
            <CardHeader className="p-4 pb-2">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <span className="flex size-7 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
                            <BellSimple size={14} weight="duotone" />
                        </span>
                        <CardTitle className="text-sm font-semibold">
                            {t('heading.title')}
                        </CardTitle>
                    </div>
                    {onSeeAll && (
                        <button
                            type="button"
                            onClick={onSeeAll}
                            className="flex items-center gap-1 text-2xs font-medium text-primary-600 hover:text-primary-700"
                        >
                            {t('seeAll')}
                            <ArrowRight size={12} weight="bold" />
                        </button>
                    )}
                </div>
                <CardDescription className="line-clamp-1 text-2xs text-neutral-500 sm:text-xs">
                    {t('heading.description')}
                </CardDescription>
            </CardHeader>
            <div className="flex flex-1 flex-col px-2 pb-3">
                {isLoading ? (
                    <ul className="space-y-1 px-2">
                        {[0, 1, 2].map((i) => (
                            <li key={i} className="space-y-1 rounded p-2">
                                <Skeleton className="h-3 w-2/3" />
                                <Skeleton className="h-2.5 w-1/2" />
                            </li>
                        ))}
                    </ul>
                ) : failed ? (
                    <SourceErrorNotice className="px-2 py-6" onRetry={() => void refetch()} />
                ) : items.length === 0 ? (
                    <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-center">
                        <BellSimple size={20} weight="duotone" className="text-neutral-300" />
                        <div className="text-2xs text-neutral-500">{t('empty.title')}</div>
                    </div>
                ) : (
                    <ul className="space-y-0.5">
                        {items.map((item) => (
                            <li
                                key={item.messageId}
                                className="rounded-md p-2 transition-colors hover:bg-neutral-50"
                            >
                                <div className="line-clamp-1 text-xs font-medium text-neutral-800">
                                    {item.title}
                                </div>
                                <div className="line-clamp-2 text-2xs text-neutral-600">
                                    {item.content?.type === 'html'
                                        ? stripHtml(item.content?.content)
                                        : item.content?.content}
                                </div>
                                <div className="mt-1 text-2xs text-neutral-400">
                                    {formatAlertTimestamp(item.createdAt)}
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </Card>
    );
}
