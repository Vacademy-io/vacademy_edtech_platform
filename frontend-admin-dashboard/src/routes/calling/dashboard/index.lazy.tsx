import { useEffect, useMemo, useState } from 'react';
import { createLazyFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ChartBar, Clock, PhoneCall, PhoneIncoming, Robot, Timer } from '@phosphor-icons/react';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { cn } from '@/lib/utils';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { InsightStrip, StatStrip, type Insight } from '@/components/shared/crm-enhance';
import {
    fetchCallMetrics,
    fetchDispositionCounts,
    type CallLogScope,
} from '@/routes/audience-manager/call-log/-services/call-log-service';
import {
    fetchCallsDaily,
    fetchCallsHeatmap,
} from '@/routes/audience-manager/reports/-components/calling/calling-reports-service';
import { CallsCard, Meter } from '@/routes/dashboard/-components/crm/crm-cards';
import {
    EmptyChart,
    SectionCard,
} from '@/routes/study-library/live-session/-components/dashboard/dashboard-charts';
import { Avatar } from '@/routes/study-library/live-session/-components/dashboard/dashboard-highlights';
import {
    CRM_RANGE_OPTIONS,
    formatNumber,
    formatPercent,
    formatTalkTime,
    isoDay,
    pctChange,
    type CrmRangeDays,
} from '@/routes/dashboard/-utils/crm-dashboard';

export const Route = createLazyFileRoute('/calling/dashboard/')({
    component: CallingDashboardPage,
});

const STALE = 5 * 60 * 1000;

const dayShift = (d: Date, n: number) => {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
};

/**
 * Calling Dashboard: dials, connect rate, talk time, when calls connect and who is
 * calling — built only from the endpoints the Call Log page already uses, so every
 * number is scoped exactly like the Call Log (the caller's team for a counsellor).
 */
function CallingDashboardPage() {
    const { t } = useTranslation('crmPages');
    const { setNavHeading } = useNavHeadingStore();
    useEffect(() => {
        setNavHeading(<h1 className="font-medium">{t('calling.title')}</h1>);
    }, [setNavHeading, t]);

    const instituteId = getCurrentInstituteId() || '';
    const [days, setDays] = useState<CrmRangeDays>(30);
    const range = useMemo(() => {
        const today = new Date();
        const from = dayShift(today, -(days - 1));
        const prevTo = dayShift(from, -1);
        const prevFrom = dayShift(prevTo, -(days - 1));
        return {
            cur: { instituteId, fromDate: isoDay(from), toDate: isoDay(today) } as CallLogScope,
            prev: {
                instituteId,
                fromDate: isoDay(prevFrom),
                toDate: isoDay(prevTo),
            } as CallLogScope,
        };
    }, [days, instituteId]);
    const enabled = !!instituteId;
    const opts = { enabled, staleTime: STALE, refetchOnWindowFocus: false } as const;

    const metrics = useQuery({
        queryKey: ['calling-dash-metrics', range.cur],
        queryFn: () => fetchCallMetrics(range.cur, {}),
        ...opts,
    });
    const prev = useQuery({
        queryKey: ['calling-dash-metrics', range.prev],
        queryFn: () => fetchCallMetrics(range.prev, {}),
        ...opts,
    });
    const daily = useQuery({
        queryKey: ['calling-dash-daily', range.cur],
        queryFn: () => fetchCallsDaily(range.cur),
        ...opts,
    });
    const heat = useQuery({
        queryKey: ['calling-dash-heat', range.cur],
        queryFn: () => fetchCallsHeatmap(range.cur),
        ...opts,
    });
    const outcomes = useQuery({
        queryKey: ['calling-dash-outcomes', range.cur],
        queryFn: () => fetchDispositionCounts(range.cur, {}),
        ...opts,
    });

    const m = metrics.data;
    const p = prev.data;
    const loading = metrics.isLoading;
    const dialsSpark = daily.data?.days.map((d) => d.dials);
    const connectedSpark = daily.data?.days.map((d) => d.connected);

    const insights: Insight[] = [];
    if (m && m.missed_inbound_due > 0) {
        insights.push({
            key: 'missed',
            tone: 'danger',
            title: t('calling.insights.missed.title', {
                total: formatNumber(m.missed_inbound_due),
            }),
            text: t('calling.insights.missed.text'),
            href: '/audience-manager/call-log',
        });
    }
    if (m && m.callbacks_due > 0) {
        insights.push({
            key: 'callbacks',
            tone: 'warning',
            title: t('calling.insights.callbacks.title', { total: formatNumber(m.callbacks_due) }),
            text: t('calling.insights.callbacks.text'),
            href: '/audience-manager/call-log',
        });
    }
    const top = [...(daily.data?.by_counsellor ?? [])].sort((a, b) => b.connected - a.connected)[0];
    if (top && top.connected > 0) {
        insights.push({
            key: 'top',
            tone: 'success',
            title: t('calling.insights.top.title', { name: top.name }),
            text: t('calling.insights.top.text', {
                total: formatNumber(top.connected),
                talk: formatTalkTime(top.talk_seconds),
            }),
        });
    }
    if (m && m.total_calls > 0 && m.ai_calls > 0) {
        insights.push({
            key: 'ai',
            tone: 'info',
            title: t('calling.insights.ai.title', {
                share: formatPercent(m.ai_calls, m.total_calls, 0),
            }),
            text: t('calling.insights.ai.text', { total: formatNumber(m.ai_calls) }),
            href: '/calling/ai-agents',
        });
    }

    const counsellors = [...(daily.data?.by_counsellor ?? [])]
        .sort((a, b) => b.dials - a.dials)
        .slice(0, 8);
    const maxDials = Math.max(1, ...counsellors.map((c) => c.dials));
    const disp = [...(outcomes.data ?? [])]
        .filter((d) => d.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, 8);
    const maxDisp = Math.max(1, ...disp.map((d) => d.count));

    return (
        <LayoutContainer>
            <div className="flex flex-col gap-5">
                <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                        <h1 className="font-semibold text-neutral-900">
                            <span className="text-h2">{t('calling.title')}</span>
                        </h1>
                        <p className="text-neutral-500">
                            <span className="text-body">{t('calling.subtitle')}</span>
                        </p>
                    </div>
                    <div className="flex rounded-lg border border-neutral-200 bg-white p-0.5">
                        {CRM_RANGE_OPTIONS.map((d) => (
                            <button
                                key={d}
                                type="button"
                                onClick={() => setDays(d)}
                                className={cn(
                                    'rounded-md px-3 py-1 font-medium transition-colors',
                                    days === d
                                        ? 'bg-primary-500 text-white'
                                        : 'text-neutral-600 hover:bg-neutral-100'
                                )}
                            >
                                <span className="text-caption">
                                    {t('common.days', { count: d })}
                                </span>
                            </button>
                        ))}
                    </div>
                </div>

                <StatStrip
                    deltaTitle={t('common.vsPrevious')}
                    items={[
                        {
                            key: 'dials',
                            icon: PhoneCall,
                            label: t('calling.stats.dials'),
                            value: m?.total_calls,
                            delta: m && p ? pctChange(m.total_calls, p.total_calls) : undefined,
                            spark: dialsSpark,
                            href: '/audience-manager/call-log',
                            loading,
                        },
                        {
                            key: 'connected',
                            icon: ChartBar,
                            tint: 'success',
                            label: t('calling.stats.connected'),
                            value: m
                                ? formatPercent(m.connected_calls, m.total_calls, 0)
                                : undefined,
                            detail: m
                                ? t('calling.stats.connectedDetail', {
                                      total: formatNumber(m.connected_calls),
                                  })
                                : undefined,
                            spark: connectedSpark,
                            loading,
                        },
                        {
                            key: 'talk',
                            icon: Timer,
                            tint: 'info',
                            label: t('calling.stats.talk'),
                            value: m ? formatTalkTime(m.total_talk_seconds) : undefined,
                            delta:
                                m && p
                                    ? pctChange(m.total_talk_seconds, p.total_talk_seconds)
                                    : undefined,
                            detail: m
                                ? t('calling.stats.talkDetail', {
                                      avg: formatTalkTime(m.avg_talk_seconds),
                                  })
                                : undefined,
                            loading,
                        },
                        {
                            key: 'leads',
                            icon: Clock,
                            tint: 'primary',
                            label: t('calling.stats.leads'),
                            value: m?.unique_leads,
                            detail: m
                                ? t('calling.stats.leadsDetail', {
                                      total: formatNumber(m.inbound_calls),
                                  })
                                : undefined,
                            loading,
                        },
                    ]}
                />
                <InsightStrip insights={insights} />

                <div className="grid gap-4 xl:grid-cols-2">
                    <div className="min-w-0">
                        <CallsCard
                            calls={{
                                total: m?.total_calls ?? 0,
                                connected: m?.connected_calls ?? 0,
                                talk_seconds: m?.total_talk_seconds ?? 0,
                                heatmap: (heat.data?.cells ?? []).map((c) => ({
                                    dow: c.dow,
                                    hour: c.hour,
                                    n: c.connected,
                                })),
                            }}
                        />
                    </div>
                    <SectionCard
                        icon={PhoneIncoming}
                        title={t('calling.outcomes.title')}
                        subtitle={t('calling.outcomes.subtitle')}
                    >
                        {disp.length === 0 ? (
                            <EmptyChart text={t('calling.empty')} />
                        ) : (
                            <div className="space-y-2">
                                {disp.map((d) => (
                                    <div
                                        key={d.key || 'none'}
                                        className="grid grid-cols-12 items-center gap-3"
                                    >
                                        <span className="col-span-4 truncate text-neutral-700">
                                            <span className="text-caption">
                                                {d.label || t('calling.outcomes.none')}
                                            </span>
                                        </span>
                                        <span className="col-span-6">
                                            <Meter value={d.count} max={maxDisp} tone="info" />
                                        </span>
                                        <span className="col-span-2 text-right font-semibold tabular-nums text-neutral-900">
                                            <span className="text-caption">
                                                {formatNumber(d.count)}
                                            </span>
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </SectionCard>
                </div>

                <SectionCard
                    icon={Robot}
                    title={t('calling.byCounsellor.title')}
                    subtitle={t('calling.byCounsellor.subtitle')}
                >
                    {counsellors.length === 0 ? (
                        <EmptyChart text={t('calling.empty')} />
                    ) : (
                        <div className="grid gap-x-8 gap-y-3 md:grid-cols-2">
                            {counsellors.map((c) => (
                                <div key={c.user_id} className="flex items-center gap-3">
                                    <Avatar id={c.user_id} name={c.name} className="size-8" />
                                    <span className="min-w-0 flex-1">
                                        <span className="flex justify-between gap-2">
                                            <span className="truncate font-medium text-neutral-900">
                                                <span className="text-caption">{c.name}</span>
                                            </span>
                                            <span className="shrink-0 tabular-nums text-neutral-500">
                                                <span className="text-caption">
                                                    {t('calling.byCounsellor.row', {
                                                        dials: formatNumber(c.dials),
                                                        rate:
                                                            c.connect_rate === null
                                                                ? '—'
                                                                : `${Math.round(c.connect_rate)}%`,
                                                    })}
                                                </span>
                                            </span>
                                        </span>
                                        <Meter value={c.dials} max={maxDials} tone="primary" />
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </SectionCard>
            </div>
        </LayoutContainer>
    );
}
