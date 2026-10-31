import { useTranslation } from 'react-i18next';
import { Funnel } from '@phosphor-icons/react';
import { InsightStrip, type Insight } from '@/components/shared/crm-enhance';
import { Meter } from '@/routes/dashboard/-components/crm/crm-cards';
import { SectionCard } from '@/routes/study-library/live-session/-components/dashboard/dashboard-charts';
import { formatNumber, formatPercent } from '@/routes/dashboard/-utils/crm-dashboard';
import type { PipelineMetrics } from '../-types/pipeline-types';

/**
 * Admissions Dashboard: the enquiry → application → admission funnel with
 * the drop-off at each step, and insights on where admissions leak. Built from the
 * pipeline metrics the page already loads — no extra request.
 */
export function AdmissionsEnhanced({ data }: { data: PipelineMetrics }) {
    const { t } = useTranslation('crmPages');
    const steps = [
        { key: 'enquiries', n: data.total_enquiries, tone: 'info' as const },
        { key: 'applications', n: data.total_applications, tone: 'primary' as const },
        { key: 'admissions', n: data.total_admissions, tone: 'success' as const },
    ];
    const max = Math.max(1, ...steps.map((s) => s.n));

    const insights: Insight[] = [];
    const e2a = data.enquiry_to_application_conversion_rate;
    const a2d = data.application_to_admission_conversion_rate;
    if (data.total_enquiries > 0 && data.total_applications > 0) {
        const leak = e2a <= a2d ? 'application' : 'admission';
        insights.push({
            key: 'leak',
            tone: 'warning',
            title: t(`admissionsDash.insights.leak.${leak}.title`, {
                rate: `${(leak === 'application' ? e2a : a2d).toFixed(1)}%`,
            }),
            text: t(`admissionsDash.insights.leak.${leak}.text`),
            href: leak === 'application' ? '/admissions/enquiries' : '/admissions/application',
        });
    }
    if (data.total_admissions > 0) {
        insights.push({
            key: 'direct',
            tone: 'info',
            title: t('admissionsDash.insights.direct.title', {
                share: formatPercent(data.direct_admissions, data.total_admissions, 0),
            }),
            text: t('admissionsDash.insights.direct.text', {
                total: formatNumber(data.direct_admissions),
            }),
            href: '/admissions/admission-list',
        });
        insights.push({
            key: 'overall',
            tone: data.overall_conversion_rate >= 20 ? 'success' : 'warning',
            title: t('admissionsDash.insights.overall.title', {
                rate: `${data.overall_conversion_rate.toFixed(1)}%`,
            }),
            text: t('admissionsDash.insights.overall.text', {
                total: formatNumber(data.admissions_from_enquiry),
            }),
        });
    }

    return (
        <div className="flex flex-col gap-4">
            <SectionCard
                icon={Funnel}
                title={t('admissionsDash.funnel.title')}
                subtitle={t('admissionsDash.funnel.subtitle')}
            >
                <div className="space-y-3">
                    {steps.map((s, i) => {
                        const prev = i > 0 ? steps[i - 1]!.n : null;
                        return (
                            <div key={s.key} className="grid grid-cols-12 items-center gap-3">
                                <span className="col-span-3 text-neutral-700">
                                    <span className="text-caption">
                                        {t(`admissionsDash.funnel.${s.key}`)}
                                    </span>
                                </span>
                                <span className="col-span-6">
                                    <Meter value={s.n} max={max} tone={s.tone} />
                                </span>
                                <span className="col-span-1 text-right font-semibold tabular-nums text-neutral-900">
                                    <span className="text-caption">{formatNumber(s.n)}</span>
                                </span>
                                <span className="col-span-2 text-right text-neutral-500">
                                    <span className="text-caption">
                                        {prev === null
                                            ? '—'
                                            : t('admissionsDash.funnel.ofPrevious', {
                                                  rate: formatPercent(s.n, prev, 0),
                                              })}
                                    </span>
                                </span>
                            </div>
                        );
                    })}
                </div>
            </SectionCard>
            <InsightStrip insights={insights} />
        </div>
    );
}
