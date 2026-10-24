import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
    PaperPlaneTilt,
    Eye,
    CursorClick,
    Warning,
    ArrowFatDown,
    Stack,
    CheckCircle,
    EnvelopeSimple,
    WhatsappLogo,
    ProhibitInset,
    type Icon,
} from '@phosphor-icons/react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { SectionCard } from '@/routes/study-library/live-session/-components/dashboard/dashboard-charts';
import { formatPercent } from '@/routes/dashboard/-utils/crm-dashboard';
import { getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import type { HubOverview, HubEmailEventType } from '../../-services/hub-api';

interface Props {
    overview: HubOverview | null;
    loading: boolean;
    /** Opens the drill-down list for an email stat (delivered/opened/clicked/bounced/complaints). */
    onEmailStatClick?: (eventType: HubEmailEventType) => void;
}

interface Stat {
    label: string;
    value: number | string;
    icon: Icon;
    /** Small line under the number (a rate or the time window). */
    detail?: string;
    tone?: 'default' | 'muted' | 'warn' | 'good';
    onClick?: () => void;
}

export function StatsCards({ overview, loading, onEmailStatClick }: Props) {
    const { t, i18n } = useTranslation('communicationStatsCards');

    if (loading && !overview) {
        return (
            <div className="space-y-4">
                <Skeleton className="h-64 rounded-xl" />
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <Skeleton className="h-36 rounded-xl" />
                    <Skeleton className="h-36 rounded-xl" />
                </div>
            </div>
        );
    }

    if (!overview) {
        return (
            <Card className="rounded-xl border-neutral-200">
                <CardContent className="py-6 text-center text-sm text-neutral-500">
                    {t('couldNotLoad')}
                </CardContent>
            </Card>
        );
    }

    const email = overview.email;
    const wa = overview.whatsapp;
    const batches = overview.batches;
    const windowLabel = t('windowLabel', { count: overview.windowDays });

    const drill = (eventType: HubEmailEventType) =>
        onEmailStatClick ? () => onEmailStatClick(eventType) : undefined;

    const emailStats: Stat[] = [
        {
            label: t('emailStats.sent'),
            value: email.sent,
            icon: PaperPlaneTilt,
            detail: windowLabel,
        },
        {
            label: t('emailStats.delivered'),
            value: email.delivered,
            icon: CheckCircle,
            tone: 'good',
            detail: t('rates.ofSent', { rate: formatPercent(email.delivered, email.sent) }),
            onClick: drill('DELIVERY'),
        },
        {
            label: t('emailStats.opened'),
            value: email.opened,
            icon: Eye,
            detail: t('rates.open', { rate: formatPercent(email.opened, email.delivered) }),
            onClick: drill('OPEN'),
        },
        {
            label: t('emailStats.clicked'),
            value: email.clicked,
            icon: CursorClick,
            detail: t('rates.click', { rate: formatPercent(email.clicked, email.delivered) }),
            onClick: drill('CLICK'),
        },
        {
            label: t('emailStats.bounced'),
            value: email.bounced,
            icon: Warning,
            tone: 'warn',
            detail: t('rates.bounce', { rate: formatPercent(email.bounced, email.sent) }),
            onClick: drill('BOUNCE'),
        },
        {
            label: t('emailStats.complaints'),
            value: email.complained ?? 0,
            icon: ProhibitInset,
            detail: t('rates.complaints'),
            onClick: drill('COMPLAINT'),
        },
        {
            label: t('emailStats.inbound'),
            value: email.inbound,
            icon: ArrowFatDown,
            detail: windowLabel,
        },
    ];

    const waStats: Stat[] = [
        { label: t('waStats.out'), value: wa.outgoing, icon: PaperPlaneTilt, detail: windowLabel },
        { label: t('waStats.in'), value: wa.incoming, icon: ArrowFatDown, detail: windowLabel },
    ];

    const batchStats: Stat[] = [
        {
            label: t('activeBatches'),
            value: batches.active,
            icon: Stack,
            tone: batches.active > 0 ? 'good' : 'muted',
        },
        {
            label: t('batchesCompleted', { count: overview.windowDays }),
            value: batches.completedInWindow,
            icon: CheckCircle,
        },
    ];

    return (
        <div className="space-y-4">
            <SectionCard
                title={t('sections.email')}
                icon={EnvelopeSimple}
                subtitle={
                    !email.configured
                        ? t('emailSubtitle.notConfigured')
                        : email.inboundConfigured
                          ? t('emailSubtitle.fullyConfigured')
                          : t('emailSubtitle.senderOnly')
                }
                className={cn(!email.configured && 'opacity-70')}
            >
                <StatGrid stats={emailStats} t={t} locale={i18n.language} />
            </SectionCard>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <SectionCard
                    title={t('sections.whatsapp')}
                    icon={WhatsappLogo}
                    subtitle={
                        wa.configured ? t('waSubtitle.connected') : t('waSubtitle.notConfigured')
                    }
                    className={cn(!wa.configured && 'opacity-70')}
                >
                    <StatGrid stats={waStats} t={t} locale={i18n.language} />
                </SectionCard>
                <SectionCard
                    title={getTerminologyPlural(ContentTerms.Batch, SystemTerms.Batch)}
                    icon={Stack}
                >
                    <StatGrid stats={batchStats} t={t} locale={i18n.language} />
                </SectionCard>
            </div>
        </div>
    );
}

function StatGrid({ stats, t, locale }: { stats: Stat[]; t: TFunction; locale: string }) {
    return (
        <div
            className={cn(
                'grid grid-cols-2 gap-3',
                stats.length > 2 && 'md:grid-cols-3 xl:grid-cols-4'
            )}
        >
            {stats.map((s) => (
                <StatTile key={s.label} {...s} t={t} locale={locale} />
            ))}
        </div>
    );
}

const TONE: Record<NonNullable<Stat['tone']>, string> = {
    default: 'text-neutral-900',
    muted: 'text-neutral-400',
    warn: 'text-warning-600',
    good: 'text-success-600',
};

function StatTile({
    label,
    value,
    icon: IconCmp,
    detail,
    tone = 'default',
    onClick,
    t,
    locale,
}: Stat & { t: TFunction; locale: string }) {
    const body = (
        <>
            <div className="flex items-center justify-between gap-2 text-neutral-500">
                <span className="truncate font-medium">
                    <span className="text-caption">{label}</span>
                </span>
                <IconCmp size={16} className="shrink-0 text-neutral-400" />
            </div>
            <div className={cn('mt-1 font-bold tabular-nums', TONE[tone])}>
                <span className="text-h3">
                    {typeof value === 'number' ? value.toLocaleString(locale) : value}
                </span>
            </div>
            {detail && (
                <p className="truncate text-neutral-500">
                    <span className="text-caption">{detail}</span>
                </p>
            )}
        </>
    );
    const base = 'flex min-w-0 flex-col rounded-xl border border-neutral-200 bg-white px-3 py-2.5';
    return onClick ? (
        <button
            type="button"
            onClick={onClick}
            title={t('viewStat', { label: label.toLowerCase() })}
            className={cn(
                base,
                'text-start transition hover:border-primary-300 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500'
            )}
        >
            {body}
        </button>
    ) : (
        <div className={base}>{body}</div>
    );
}
