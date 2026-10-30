import type { Icon } from '@phosphor-icons/react';
import {
    CalendarCheck,
    ChatCircleDots,
    Coins,
    PaperPlaneTilt,
    PhoneCall,
    Receipt,
    Trophy,
    UserPlus,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { StatStrip, type StatItem } from '@/components/shared/crm-enhance';
import type { Tint } from '@/routes/dashboard/-components/crm/crm-cards';
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

const KPI_ORDER = Object.keys(KPI_STYLE) as KpiKey[];

interface KpiCardsProps {
    kpis: ReportKpi[];
    isLoading: boolean;
    hasError: boolean;
    onRetry: () => void;
}

/** The eight headline numbers, each with its change against the previous day. */
export function KpiCards({ kpis, isLoading, hasError, onRetry }: KpiCardsProps) {
    const { t } = useTranslation('engagementDailyReport');
    if (hasError) return <SectionError onRetry={onRetry} />;

    const items: StatItem[] = isLoading
        ? KPI_ORDER.map((key) => ({
              key,
              label: t(`kpi.${key}.label`),
              value: '',
              icon: KPI_STYLE[key].icon,
              tint: KPI_STYLE[key].tint,
              loading: true,
          }))
        : kpis.map((k) => ({
              key: k.key,
              label: k.label,
              value: k.value,
              detail: k.detail,
              hint: k.hint,
              delta: k.delta,
              lowerIsBetter: k.lowerIsBetter,
              icon: KPI_STYLE[k.key].icon,
              tint: KPI_STYLE[k.key].tint,
          }));

    return <StatStrip items={items} deltaTitle={t('kpi.deltaTitle')} />;
}
