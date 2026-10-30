import type { Icon } from '@phosphor-icons/react';
import {
    CalendarCheck,
    ChatCircleDots,
    Coins,
    Info,
    PaperPlaneTilt,
    PhoneCall,
    Receipt,
    Trophy,
    UserPlus,
} from '@phosphor-icons/react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { DeltaChip, type Tint } from '@/routes/dashboard/-components/crm/crm-cards';
import type { KpiKey, ReportKpi } from '../../-utils/report-kpis';
import { SectionError } from './ReportSection';

const KPI_STYLE: Record<KpiKey, { icon: Icon; tint: Tint }> = {
    peopleAdded: { icon: UserPlus, tint: 'primary' },
    messagesSent: { icon: PaperPlaneTilt, tint: 'info' },
    replies: { icon: ChatCircleDots, tint: 'success' },
    callsConnected: { icon: PhoneCall, tint: 'info' },
    demosBooked: { icon: CalendarCheck, tint: 'primary' },
    conversions: { icon: Trophy, tint: 'success' },
    creditsSpent: { icon: Coins, tint: 'warning' },
    costPerDemo: { icon: Receipt, tint: 'warning' },
};

const ICON_TINT: Record<Tint, string> = {
    primary: 'bg-primary-50 text-primary-500',
    info: 'bg-info-50 text-info-600',
    success: 'bg-success-50 text-success-600',
    warning: 'bg-warning-50 text-warning-600',
    danger: 'bg-danger-50 text-danger-600',
};

const KPI_ORDER = Object.keys(KPI_STYLE) as KpiKey[];

/**
 * The link of a card with one: the label is the link and its ::after stretches over the whole
 * card, so the card is one big target while the info button and the change chip stay above it
 * (z-10) and keep working. A card is never a link inside a link or a button inside a link.
 */
const CARD_LINK_CLASS =
    'rounded-sm after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring';

function KpiCard({ kpi }: { kpi: ReportKpi }) {
    const { t } = useTranslation('engagementDailyReport');
    const { icon: KpiIcon, tint } = KPI_STYLE[kpi.key];
    const link = kpi.link ?? null;
    const label = <span className="text-caption">{kpi.label}</span>;
    return (
        <Card
            className={cn(
                'relative flex h-full min-w-0 flex-col gap-2 rounded-xl border-neutral-200 p-4 shadow-sm transition-shadow hover:shadow-md',
                link && 'hover:border-primary-200'
            )}
        >
            <div className="flex items-center gap-2 text-neutral-600">
                <span
                    className={cn(
                        'flex size-8 items-center justify-center rounded-lg',
                        ICON_TINT[tint]
                    )}
                >
                    <KpiIcon size={16} weight="duotone" />
                </span>
                <span className="truncate font-medium">
                    {link ? (
                        <Link
                            to={link.to as never}
                            search={link.search as never}
                            aria-label={t('links.openKpi', { label: kpi.label, value: kpi.value })}
                            className={CARD_LINK_CLASS}
                        >
                            {label}
                        </Link>
                    ) : (
                        label
                    )}
                </span>
                <TooltipProvider delayDuration={150}>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                type="button"
                                aria-label={`${kpi.label}: ${kpi.hint}`}
                                className="relative z-10 ms-auto shrink-0 rounded-full text-neutral-400 hover:text-neutral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                                <Info size={14} />
                            </button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">{kpi.hint}</TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            </div>
            <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold tabular-nums text-neutral-900">
                        <span className="text-h2">{kpi.value}</span>
                    </span>
                    <span className="relative z-10 inline-flex items-center gap-1.5">
                        <DeltaChip
                            value={kpi.delta}
                            lowerIsBetter={kpi.lowerIsBetter}
                            title={kpi.deltaTitle ?? kpi.deltaLabel ?? ''}
                        />
                        {kpi.delta !== null && kpi.deltaLabel && (
                            <span className="text-neutral-500">
                                <span className="text-caption">{kpi.deltaLabel}</span>
                            </span>
                        )}
                    </span>
                </div>
                {kpi.detail && (
                    <p className="line-clamp-2 text-neutral-500">
                        <span className="text-caption">{kpi.detail}</span>
                    </p>
                )}
            </div>
        </Card>
    );
}

function KpiCardSkeleton({ kpiKey }: { kpiKey: KpiKey }) {
    const { t } = useTranslation('engagementDailyReport');
    const { icon: KpiIcon, tint } = KPI_STYLE[kpiKey];
    return (
        <Card className="flex h-full min-w-0 flex-col gap-2 rounded-xl border-neutral-200 p-4 shadow-sm">
            <div className="flex items-center gap-2 text-neutral-600">
                <span
                    className={cn(
                        'flex size-8 items-center justify-center rounded-lg',
                        ICON_TINT[tint]
                    )}
                >
                    <KpiIcon size={16} weight="duotone" />
                </span>
                <span className="truncate font-medium">
                    <span className="text-caption">{t(`kpi.${kpiKey}.label`)}</span>
                </span>
            </div>
            <Skeleton className="h-8 w-20" />
        </Card>
    );
}

interface KpiCardsProps {
    kpis: ReportKpi[];
    isLoading: boolean;
    hasError: boolean;
    onRetry: () => void;
}

/**
 * The eight headline numbers, each with its change against the previous period (the day before,
 * for one day). A number above zero opens the items behind it.
 */
export function KpiCards({ kpis, isLoading, hasError, onRetry }: KpiCardsProps) {
    if (hasError) return <SectionError onRetry={onRetry} />;
    return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {isLoading
                ? KPI_ORDER.map((key) => <KpiCardSkeleton key={key} kpiKey={key} />)
                : kpis.map((k) => <KpiCard key={k.key} kpi={k} />)}
        </div>
    );
}
