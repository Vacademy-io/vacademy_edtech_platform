import { useEffect, useMemo, useState } from 'react';
import { createLazyFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
    ChatsCircle,
    CursorClick,
    EnvelopeOpen,
    EnvelopeSimple,
    PaperPlaneTilt,
    WarningCircle,
    WhatsappLogo,
} from '@phosphor-icons/react';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { getCurrentInstituteId, getRolesForCurrentInstitute } from '@/lib/auth/instituteUtils';
import { cn } from '@/lib/utils';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { InsightStrip, StatStrip, type Insight } from '@/components/shared/crm-enhance';
import { Meter } from '@/routes/dashboard/-components/crm/crm-cards';
import {
    EmptyChart,
    SectionCard,
} from '@/routes/study-library/live-session/-components/dashboard/dashboard-charts';
import { formatNumber, formatPercent } from '@/routes/dashboard/-utils/crm-dashboard';
import { getHubOverview } from '../notification-hub/-services/hub-api';

export const Route = createLazyFileRoute('/communication/dashboard/')({
    component: MessagingDashboardPage,
});

const WINDOWS = [7, 30, 90] as const;

/**
 * Messaging Dashboard: email delivery and engagement plus WhatsApp volume, from the
 * Notification Hub overview (the same numbers as its Overview tab). Those numbers
 * are institute-wide, so the page is for admins only.
 */
function MessagingDashboardPage() {
    const { t } = useTranslation('crmPages');
    const { setNavHeading } = useNavHeadingStore();
    useEffect(() => {
        setNavHeading(<h1 className="font-medium">{t('messaging.title')}</h1>);
    }, [setNavHeading, t]);

    const instituteId = getCurrentInstituteId() || '';
    const isAdmin = useMemo(() => getRolesForCurrentInstitute().includes('ADMIN'), []);
    const [days, setDays] = useState<(typeof WINDOWS)[number]>(30);
    const { data, isLoading } = useQuery({
        queryKey: ['messaging-dashboard', instituteId, days],
        queryFn: () => getHubOverview(instituteId, days),
        enabled: isAdmin && !!instituteId,
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
    });

    const e = data?.email;
    const w = data?.whatsapp;
    const insights: Insight[] = [];
    if (e && e.sent > 0) {
        const openRate = e.delivered > 0 ? e.opened / e.delivered : 0;
        insights.push({
            key: 'open',
            tone: openRate >= 0.2 ? 'success' : 'warning',
            title: t('messaging.insights.open.title', {
                rate: formatPercent(e.opened, e.delivered, 0),
            }),
            text: t(
                openRate >= 0.2 ? 'messaging.insights.open.good' : 'messaging.insights.open.low'
            ),
            href: '/communication/notification-hub',
        });
        if (e.bounced / e.sent >= 0.02) {
            insights.push({
                key: 'bounce',
                tone: 'danger',
                title: t('messaging.insights.bounce.title', {
                    rate: formatPercent(e.bounced, e.sent),
                }),
                text: t('messaging.insights.bounce.text'),
                href: '/communication/notification-hub',
            });
        }
    }
    if (w && w.incoming > 0) {
        insights.push({
            key: 'replies',
            tone: 'info',
            title: t('messaging.insights.replies.title', { total: formatNumber(w.incoming) }),
            text: t('messaging.insights.replies.text'),
            href: '/communication/inbox',
        });
    }
    if ((data?.batches?.active ?? 0) > 0) {
        insights.push({
            key: 'batches',
            tone: 'info',
            title: t('messaging.insights.batches.title', { total: data?.batches?.active ?? 0 }),
            text: t('messaging.insights.batches.text'),
            href: '/announcement/history',
        });
    }

    const funnel = e
        ? [
              { key: 'sent', n: e.sent },
              { key: 'delivered', n: e.delivered },
              { key: 'opened', n: e.opened },
              { key: 'clicked', n: e.clicked },
          ]
        : [];
    const max = Math.max(1, ...funnel.map((f) => f.n));

    return (
        <LayoutContainer>
            <div className="flex flex-col gap-5">
                <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                        <h1 className="font-semibold text-neutral-900">
                            <span className="text-h2">{t('messaging.title')}</span>
                        </h1>
                        <p className="text-neutral-500">
                            <span className="text-body">{t('messaging.subtitle')}</span>
                        </p>
                    </div>
                    {isAdmin && (
                        <div className="flex rounded-lg border border-neutral-200 bg-white p-0.5">
                            {WINDOWS.map((d) => (
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
                    )}
                </div>
                {!isAdmin ? (
                    <EmptyChart text={t('messaging.adminOnly')} className="h-32" />
                ) : (
                    <>
                        <StatStrip
                            items={[
                                {
                                    key: 'sent',
                                    icon: PaperPlaneTilt,
                                    label: t('messaging.stats.sent'),
                                    value: e?.sent,
                                    detail: e
                                        ? t('messaging.stats.sentDetail', {
                                              rate: formatPercent(e.delivered, e.sent, 0),
                                          })
                                        : undefined,
                                    loading: isLoading,
                                },
                                {
                                    key: 'opened',
                                    icon: EnvelopeOpen,
                                    tint: 'success',
                                    label: t('messaging.stats.opened'),
                                    value: e ? formatPercent(e.opened, e.delivered, 0) : undefined,
                                    detail: e
                                        ? t('messaging.stats.openedDetail', {
                                              total: formatNumber(e.opened),
                                          })
                                        : undefined,
                                    loading: isLoading,
                                },
                                {
                                    key: 'clicked',
                                    icon: CursorClick,
                                    tint: 'info',
                                    label: t('messaging.stats.clicked'),
                                    value: e ? formatPercent(e.clicked, e.delivered, 1) : undefined,
                                    detail: e
                                        ? t('messaging.stats.clickedDetail', {
                                              total: formatNumber(e.clicked),
                                          })
                                        : undefined,
                                    loading: isLoading,
                                },
                                {
                                    key: 'whatsapp',
                                    icon: WhatsappLogo,
                                    tint: 'success',
                                    label: t('messaging.stats.whatsapp'),
                                    value: w?.outgoing,
                                    detail: w
                                        ? t('messaging.stats.whatsappDetail', {
                                              total: formatNumber(w.incoming),
                                          })
                                        : undefined,
                                    href: '/communication/inbox',
                                    loading: isLoading,
                                },
                            ]}
                        />
                        <InsightStrip insights={insights} />
                        <div className="grid gap-4 xl:grid-cols-2">
                            <SectionCard
                                icon={EnvelopeSimple}
                                title={t('messaging.funnel.title')}
                                subtitle={t('messaging.funnel.subtitle', { days })}
                            >
                                {!e || e.sent === 0 ? (
                                    <EmptyChart text={t('messaging.emptyEmail')} />
                                ) : (
                                    <div className="space-y-2">
                                        {funnel.map((f) => (
                                            <div
                                                key={f.key}
                                                className="grid grid-cols-12 items-center gap-3"
                                            >
                                                <span className="col-span-3 text-neutral-700">
                                                    <span className="text-caption">
                                                        {t(`messaging.funnel.${f.key}`)}
                                                    </span>
                                                </span>
                                                <span className="col-span-7">
                                                    <Meter value={f.n} max={max} tone="primary" />
                                                </span>
                                                <span className="col-span-2 text-right font-semibold tabular-nums text-neutral-900">
                                                    <span className="text-caption">
                                                        {formatNumber(f.n)}
                                                    </span>
                                                </span>
                                            </div>
                                        ))}
                                        <p className="pt-2 text-neutral-500">
                                            <span className="text-caption">
                                                {t('messaging.funnel.problems', {
                                                    bounced: formatNumber(e.bounced),
                                                    complained: formatNumber(e.complained),
                                                })}
                                            </span>
                                        </p>
                                    </div>
                                )}
                            </SectionCard>
                            <SectionCard
                                icon={ChatsCircle}
                                title={t('messaging.wa.title')}
                                subtitle={t('messaging.funnel.subtitle', { days })}
                            >
                                {!w || !w.configured ? (
                                    <EmptyChart text={t('messaging.wa.notConfigured')} />
                                ) : (
                                    <div className="grid grid-cols-2 gap-3">
                                        {[
                                            ['outgoing', w.outgoing],
                                            ['incoming', w.incoming],
                                        ].map(([k, v]) => (
                                            <div
                                                key={k as string}
                                                className="rounded-lg border border-neutral-100 p-4"
                                            >
                                                <span className="block font-bold tabular-nums text-neutral-900">
                                                    <span className="text-h2">
                                                        {formatNumber(v as number)}
                                                    </span>
                                                </span>
                                                <span className="text-neutral-500">
                                                    <span className="text-caption">
                                                        {t(`messaging.wa.${k}`)}
                                                    </span>
                                                </span>
                                            </div>
                                        ))}
                                        <p className="col-span-2 flex items-center gap-1.5 text-neutral-500">
                                            <WarningCircle size={14} />
                                            <span className="text-caption">
                                                {t('messaging.wa.hint')}
                                            </span>
                                        </p>
                                    </div>
                                )}
                            </SectionCard>
                        </div>
                    </>
                )}
            </div>
        </LayoutContainer>
    );
}
