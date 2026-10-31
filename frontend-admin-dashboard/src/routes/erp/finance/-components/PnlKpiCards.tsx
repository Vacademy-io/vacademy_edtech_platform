import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { MoneyCell } from '@/components/design-system/money-cell';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { NormalizedPnl } from '../-hooks/use-finance';

/**
 * A percentage with one decimal. No locale grouping on purpose — a ratio is a
 * small number, and "1,250.0%" reads worse than "1250.0%".
 */
export const formatPercent = (value: number | undefined): string =>
    value === undefined || !Number.isFinite(value) ? '—' : `${value.toFixed(1)}%`;

/** The em dash every absent figure on this screen renders as. */
const Absent = ({ className }: { className?: string }) => (
    <span className={cn('text-muted-foreground', className)}>—</span>
);

const Tile = ({ label, hint, children }: { label: string; hint: string; children: ReactNode }) => (
    <Card>
        <CardContent className="flex flex-col gap-1 p-4">
            <span className="text-caption text-muted-foreground">{label}</span>
            <div className="text-h3 text-foreground">{children}</div>
            <span className="text-caption text-muted-foreground">{hint}</span>
        </CardContent>
    </Card>
);

/**
 * The four numbers the month is judged on.
 *
 * Revenue is *collected* fee revenue — cash that actually arrived — and the copy
 * says so on the tile rather than in a footnote, because "revenue" next to a
 * payroll cost invites the reader to assume billings and conclude the month went
 * better than it did.
 *
 * Every tile renders an em dash when its figure is absent instead of falling back
 * to zero: on a P&L, a missing number and a zero mean opposite things.
 */
export const PnlKpiCards = ({
    snapshot,
    isLoading,
}: {
    snapshot: NormalizedPnl | undefined;
    isLoading: boolean;
}) => {
    const { t } = useTranslation('erpPnlKpiCards');
    if (isLoading || !snapshot) {
        return (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {Array.from({ length: 4 }, (_, index) => (
                    <Card key={index}>
                        <CardContent className="flex flex-col gap-2 p-4">
                            <Skeleton className="h-3 w-28" />
                            <Skeleton className="h-6 w-32" />
                            <Skeleton className="h-3 w-24" />
                        </CardContent>
                    </Card>
                ))}
            </div>
        );
    }

    const { currency, revenue, employerCost, margin, costToRevenuePct } = snapshot;
    const marginIsLoss = margin !== undefined && margin < 0;

    return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Tile label={t('tiles.revenue.label')} hint={t('tiles.revenue.hint')}>
                {revenue === undefined ? (
                    <Absent />
                ) : (
                    <MoneyCell value={revenue} currency={currency} className="text-start" />
                )}
            </Tile>

            <Tile label={t('tiles.payrollCost.label')} hint={t('tiles.payrollCost.hint')}>
                {employerCost === undefined ? (
                    <Absent />
                ) : (
                    <MoneyCell value={employerCost} currency={currency} className="text-start" />
                )}
            </Tile>

            <Tile
                label={t('tiles.margin.label')}
                hint={
                    snapshot.marginComputed
                        ? t('tiles.margin.hintComputed')
                        : t('tiles.margin.hintReported')
                }
            >
                {margin === undefined ? (
                    <Absent />
                ) : (
                    <MoneyCell
                        value={margin}
                        currency={currency}
                        className={cn(
                            'text-start font-semibold',
                            marginIsLoss ? 'text-danger-600' : 'text-success-600'
                        )}
                    />
                )}
            </Tile>

            <Tile
                label={t('tiles.costToRevenue.label')}
                hint={
                    costToRevenuePct === undefined
                        ? t('tiles.costToRevenue.hintMissing')
                        : t('tiles.costToRevenue.hintPresent')
                }
            >
                <span
                    className={cn(
                        'tabular-nums',
                        costToRevenuePct !== undefined && costToRevenuePct > 100 && 'text-danger-600'
                    )}
                >
                    {formatPercent(costToRevenuePct)}
                </span>
            </Tile>
        </div>
    );
};
