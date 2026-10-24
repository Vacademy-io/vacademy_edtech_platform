import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ArrowClockwise } from '@phosphor-icons/react';
import { getInstituteId } from '@/constants/helper';
import { cn } from '@/lib/utils';
import { MyButton } from '@/components/design-system/button';
import { StatsCards } from './stats-cards';
import { RecentActivity } from './recent-activity';
import { EmailEventsDialog } from './email-events-dialog';
import {
    getHubOverview,
    getHubRecent,
    type HubEmailEventType,
    type HubOverview,
    type HubRecentItem,
} from '../../-services/hub-api';

function buildWindowOptions(t: TFunction): Array<{ label: string; days: number }> {
    return [
        { label: t('window.last24h'), days: 1 },
        { label: t('window.last7Days'), days: 7 },
        { label: t('window.last30Days'), days: 30 },
    ];
}

const RECENT_PAGE_SIZE = 20;

export function OverviewTab() {
    const { t } = useTranslation('communicationOverviewTab');
    const windowOptions = buildWindowOptions(t);
    const instituteId = getInstituteId() || '';
    const [windowDays, setWindowDays] = useState(7);
    const [overview, setOverview] = useState<HubOverview | null>(null);
    const [recent, setRecent] = useState<HubRecentItem[]>([]);
    const [recentOffset, setRecentOffset] = useState(0);
    const [hasMoreRecent, setHasMoreRecent] = useState(false);
    const [loadingOverview, setLoadingOverview] = useState(false);
    const [loadingRecent, setLoadingRecent] = useState(false);
    const [loadingMoreRecent, setLoadingMoreRecent] = useState(false);
    const [drilldownEvent, setDrilldownEvent] = useState<HubEmailEventType | null>(null);

    const load = useCallback(async () => {
        if (!instituteId) return;
        setLoadingOverview(true);
        setLoadingRecent(true);
        try {
            const [o, r] = await Promise.all([
                getHubOverview(instituteId, windowDays),
                getHubRecent(instituteId, RECENT_PAGE_SIZE, 0),
            ]);
            setOverview(o);
            setRecent(r);
            setRecentOffset(r.length);
            setHasMoreRecent(r.length >= RECENT_PAGE_SIZE);
        } catch (err) {
            console.error('Failed to load hub overview', err);
        } finally {
            setLoadingOverview(false);
            setLoadingRecent(false);
        }
    }, [instituteId, windowDays]);

    const loadMoreRecent = useCallback(async () => {
        if (loadingMoreRecent || !hasMoreRecent || !instituteId) return;
        setLoadingMoreRecent(true);
        try {
            const more = await getHubRecent(instituteId, RECENT_PAGE_SIZE, recentOffset);
            if (more.length === 0) {
                setHasMoreRecent(false);
            } else {
                // Dedup by id in case a recent send appears in both the polled head and the
                // newly-fetched page (unlikely with offset, but cheap to guard).
                setRecent((prev) => {
                    const seen = new Set(prev.map((i) => i.id));
                    const additions = more.filter((i) => !seen.has(i.id));
                    return [...prev, ...additions];
                });
                setRecentOffset((prev) => prev + more.length);
                setHasMoreRecent(more.length >= RECENT_PAGE_SIZE);
            }
        } catch (err) {
            console.error('Failed to load more recent activity', err);
        } finally {
            setLoadingMoreRecent(false);
        }
    }, [hasMoreRecent, instituteId, loadingMoreRecent, recentOffset]);

    useEffect(() => {
        load();
    }, [load]);

    return (
        <div className="mx-auto w-full max-w-7xl space-y-4 p-4 sm:p-6">
            {/* Controls */}
            <div className="flex flex-wrap items-center gap-3">
                <div className="flex rounded-lg border border-neutral-200 bg-white p-0.5">
                    {windowOptions.map((opt) => (
                        <button
                            key={opt.days}
                            type="button"
                            onClick={() => setWindowDays(opt.days)}
                            aria-pressed={windowDays === opt.days}
                            className={cn(
                                'rounded-md px-3 py-1 font-medium transition-colors',
                                windowDays === opt.days
                                    ? 'bg-primary-500 text-white'
                                    : 'text-neutral-600 hover:bg-neutral-100'
                            )}
                        >
                            <span className="text-caption">{opt.label}</span>
                        </button>
                    ))}
                </div>
                <span className="text-caption text-neutral-500">{t('windowHint')}</span>
                <MyButton
                    buttonType="secondary"
                    scale="medium"
                    onClick={load}
                    disable={loadingOverview}
                    className="ml-auto gap-1.5 sm:min-w-0"
                    title={t('refresh')}
                >
                    <ArrowClockwise size={16} className={cn(loadingOverview && 'animate-spin')} />
                    {t('refresh')}
                </MyButton>
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                {/* Stats */}
                <div className="min-w-0 xl:col-span-2">
                    <StatsCards
                        overview={overview}
                        loading={loadingOverview}
                        onEmailStatClick={setDrilldownEvent}
                    />
                </div>

                {/* Recent activity */}
                <div className="min-w-0">
                    <RecentActivity
                        items={recent}
                        loading={loadingRecent}
                        hasMore={hasMoreRecent}
                        loadingMore={loadingMoreRecent}
                        onLoadMore={loadMoreRecent}
                    />
                </div>
            </div>

            {/* Drill-down: emails behind a clicked stat card */}
            <EmailEventsDialog
                eventType={drilldownEvent}
                windowDays={windowDays}
                onClose={() => setDrilldownEvent(null)}
            />
        </div>
    );
}
