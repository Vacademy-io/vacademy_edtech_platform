import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, Hourglass } from '@phosphor-icons/react';
import { StatStrip } from '@/components/shared/crm-enhance';

interface PendingAdjustment {
    adjustment_type?: string | null;
    adjustment_amount?: number | null;
}

const inr = (n: number) =>
    new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0,
    }).format(n);

/** Adjustment Approvals: what is waiting, split by concession and penalty. */
export function AdjustmentsSummary({ items }: { items: PendingAdjustment[] }) {
    const { t } = useTranslation('crmPages');
    if (items.length === 0) return null;
    const pen = items.filter((i) => i.adjustment_type === 'PENALTY');
    const con = items.filter((i) => i.adjustment_type !== 'PENALTY');
    const sum = (xs: PendingAdjustment[]) =>
        xs.reduce((s, x) => s + Math.abs(x.adjustment_amount ?? 0), 0);
    return (
        <div className="mb-4">
            <StatStrip
                items={[
                    {
                        key: 'pending',
                        icon: Hourglass,
                        tint: 'warning',
                        label: t('adjustments.pending'),
                        value: items.length,
                        detail: t('adjustments.pendingDetail'),
                    },
                    {
                        key: 'concession',
                        icon: ArrowDown,
                        tint: 'success',
                        label: t('adjustments.concessions'),
                        value: con.length,
                        detail: inr(sum(con)),
                    },
                    {
                        key: 'penalty',
                        icon: ArrowUp,
                        tint: 'danger',
                        label: t('adjustments.penalties'),
                        value: pen.length,
                        detail: inr(sum(pen)),
                    },
                ]}
            />
        </div>
    );
}
