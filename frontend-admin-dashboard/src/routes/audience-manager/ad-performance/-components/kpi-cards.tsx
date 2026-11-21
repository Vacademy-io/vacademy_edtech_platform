/**
 * The four headline numbers: total spend, enquiries, blended cost per enquiry and
 * admissions (the highlighted card, with cost per admission under it).
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ChatCircleText,
    CurrencyCircleDollar,
    GraduationCap,
    Receipt,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { AdPerformanceTotals } from '../../-marketing/types';
import { formatCount, formatMoney } from './ad-performance-utils';

function KpiCard({
    icon: KpiIcon,
    label,
    value,
    caption,
    highlighted = false,
}: {
    icon: Icon;
    label: string;
    value: string;
    caption: ReactNode;
    highlighted?: boolean;
}) {
    return (
        <Card
            className={cn(
                'flex flex-col gap-2 p-5 shadow-none',
                highlighted ? 'border-primary-500 bg-primary-500 text-white' : 'bg-white'
            )}
        >
            <div className="flex items-center justify-between gap-2">
                <span
                    className={cn(
                        'text-body font-medium',
                        highlighted ? 'text-white' : 'text-neutral-500'
                    )}
                >
                    {label}
                </span>
                <span
                    className={cn(
                        'flex size-8 items-center justify-center rounded-lg',
                        highlighted ? 'bg-white/20 text-white' : 'bg-neutral-50 text-neutral-500'
                    )}
                >
                    <KpiIcon size={18} weight="duotone" />
                </span>
            </div>
            <span
                className={cn(
                    'text-h2 font-semibold tabular-nums',
                    highlighted ? 'text-white' : 'text-neutral-900'
                )}
            >
                {value}
            </span>
            <span
                className={cn('text-caption', highlighted ? 'text-white/90' : 'text-neutral-500')}
            >
                {caption}
            </span>
        </Card>
    );
}

export function KpiCards({
    totals,
    currency,
    accountCount,
}: {
    totals: AdPerformanceTotals;
    currency: string;
    accountCount: number;
}) {
    const { t } = useTranslation('marketingAds');
    return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
                icon={CurrencyCircleDollar}
                label={t('ads.kpi.spend')}
                value={formatMoney(totals.spend, currency)}
                caption={t('ads.kpi.spendCaption', { count: accountCount })}
            />
            <KpiCard
                icon={ChatCircleText}
                label={t('ads.kpi.enquiries')}
                value={formatCount(totals.enquiries)}
                caption={t('ads.kpi.enquiriesCaption')}
            />
            <KpiCard
                icon={Receipt}
                label={t('ads.kpi.costPerEnquiry')}
                value={formatMoney(totals.cost_per_enquiry, currency)}
                caption={t('ads.kpi.costPerEnquiryCaption')}
            />
            <KpiCard
                icon={GraduationCap}
                label={t('ads.kpi.admissions')}
                value={formatCount(totals.admissions)}
                caption={
                    totals.cost_per_admission !== null
                        ? t('ads.kpi.admissionsCaption', {
                              amount: formatMoney(totals.cost_per_admission, currency),
                          })
                        : t('ads.kpi.admissionsCaptionEmpty')
                }
                highlighted
            />
        </div>
    );
}
