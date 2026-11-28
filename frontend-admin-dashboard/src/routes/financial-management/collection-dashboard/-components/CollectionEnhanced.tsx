import { useTranslation } from 'react-i18next';
import { InsightStrip, type Insight } from '@/components/shared/crm-enhance';
import { AttentionCard, type AttentionItem } from '@/routes/dashboard/-components/crm/crm-cards';
import { formatCurrency } from '@/utils/finance-utils';
import type { DashboardCollectionResponse } from '@/services/manage-finances';

const rate = (collected: number, expected: number) =>
    expected > 0 ? (collected / expected) * 100 : 0;

/**
 * Fee Collection Dashboard: insights and a "needs attention" list (classes
 * with the most overdue and the weakest collection), from the collection data the
 * page already loads — no extra request.
 */
export function CollectionEnhanced({ data }: { data: DashboardCollectionResponse }) {
    const { t } = useTranslation('crmPages');
    const classes = data.classWiseBreakdown ?? [];
    const overall = rate(data.collectedToDate, data.expectedToDate);

    const insights: Insight[] = [];
    if (data.expectedToDate > 0) {
        insights.push({
            key: 'rate',
            tone: overall >= 85 ? 'success' : overall >= 60 ? 'warning' : 'danger',
            title: t('feesDash.insights.rate.title', { rate: `${overall.toFixed(1)}%` }),
            text: t('feesDash.insights.rate.text', {
                collected: formatCurrency(data.collectedToDate),
                expected: formatCurrency(data.expectedToDate),
            }),
        });
    }
    const byOverdue = [...classes]
        .filter((c) => c.overdue > 0)
        .sort((a, b) => b.overdue - a.overdue);
    if (byOverdue[0] && data.totalOverdue > 0) {
        insights.push({
            key: 'overdue',
            tone: 'danger',
            title: t('feesDash.insights.overdue.title', {
                name: byOverdue[0].className,
                share: `${Math.round((byOverdue[0].overdue / data.totalOverdue) * 100)}%`,
            }),
            text: t('feesDash.insights.overdue.text', {
                amount: formatCurrency(byOverdue[0].overdue),
            }),
            href: '/financial-management/pay-installments',
        });
    }
    const withExpected = classes.filter((c) => c.expectedToDate > 0);
    const best = [...withExpected].sort(
        (a, b) =>
            rate(b.collectedToDate, b.expectedToDate) - rate(a.collectedToDate, a.expectedToDate)
    )[0];
    if (best && withExpected.length > 1) {
        insights.push({
            key: 'best',
            tone: 'success',
            title: t('feesDash.insights.best.title', { name: best.className }),
            text: t('feesDash.insights.best.text', {
                rate: `${rate(best.collectedToDate, best.expectedToDate).toFixed(1)}%`,
            }),
        });
    }

    const attention: AttentionItem[] = [
        ...byOverdue.slice(0, 3).map((c) => ({
            key: `o-${c.packageSessionId}`,
            tone: 'danger' as const,
            title: t('feesDash.attention.overdue.title', {
                name: c.className,
                amount: formatCurrency(c.overdue),
            }),
            text: t('feesDash.attention.overdue.text', {
                rate: `${rate(c.collectedToDate, c.expectedToDate).toFixed(0)}%`,
            }),
            to: '/financial-management/pay-installments',
            cta: t('feesDash.attention.open'),
        })),
        ...withExpected
            .filter((c) => rate(c.collectedToDate, c.expectedToDate) < 50 && c.overdue === 0)
            .slice(0, 2)
            .map((c) => ({
                key: `l-${c.packageSessionId}`,
                tone: 'warning' as const,
                title: t('feesDash.attention.low.title', {
                    name: c.className,
                    rate: `${rate(c.collectedToDate, c.expectedToDate).toFixed(0)}%`,
                }),
                text: t('feesDash.attention.low.text'),
                to: '/financial-management/pay-installments',
                cta: t('feesDash.attention.open'),
            })),
    ];

    return (
        <div className="flex flex-col gap-4">
            <InsightStrip insights={insights} />
            <AttentionCard items={attention} />
        </div>
    );
}
