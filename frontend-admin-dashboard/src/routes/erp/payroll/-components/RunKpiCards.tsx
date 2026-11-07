import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { MoneyCell } from '@/components/design-system/money-cell';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { PayrollRunDTO } from '@/routes/erp/-shared/hr-types';

const Tile = ({ label, hint, children }: { label: string; hint: string; children: ReactNode }) => (
    <Card>
        <CardContent className="flex flex-col gap-1 p-4">
            <span className="text-caption text-neutral-500">{label}</span>
            <div className="text-h3 text-neutral-700">{children}</div>
            <span className="text-caption text-neutral-400">{hint}</span>
        </CardContent>
    </Card>
);

/**
 * The five numbers a run is judged on.
 *
 * Gross → deductions → net is the payslip identity, so they sit in that order and
 * read left to right as an equation. Employer cost is separate on purpose: it is
 * what the institute spends, not what anyone is paid, and mixing it into the same
 * visual group is how people end up reporting the wrong figure to finance.
 *
 * Every amount uses the run's own `currency` — a run is single-currency, but which
 * one differs by institute.
 */
export const RunKpiCards = ({
    run,
    isLoading,
}: {
    run: PayrollRunDTO | undefined;
    isLoading: boolean;
}) => {
    const { t } = useTranslation('erpRunKpiCards');

    if (isLoading || !run) {
        return (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
                {Array.from({ length: 5 }, (_, index) => (
                    <Card key={index}>
                        <CardContent className="flex flex-col gap-2 p-4">
                            <Skeleton className="h-3 w-24" />
                            <Skeleton className="h-6 w-32" />
                            <Skeleton className="h-3 w-20" />
                        </CardContent>
                    </Card>
                ))}
            </div>
        );
    }

    const currency = run.currency;

    return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <Tile label={t('totalGross.label')} hint={t('totalGross.hint')}>
                <MoneyCell value={run.total_gross} currency={currency} className="text-start" />
            </Tile>
            <Tile label={t('totalDeductions.label')} hint={t('totalDeductions.hint')}>
                <MoneyCell
                    value={run.total_deductions}
                    currency={currency}
                    tone="deduction"
                    className="text-start"
                />
            </Tile>
            <Tile label={t('totalNetPay.label')} hint={t('totalNetPay.hint')}>
                <MoneyCell
                    value={run.total_net_pay}
                    currency={currency}
                    className="text-start font-semibold"
                />
            </Tile>
            <Tile label={t('totalEmployerCost.label')} hint={t('totalEmployerCost.hint')}>
                <MoneyCell
                    value={run.total_employer_cost}
                    currency={currency}
                    className="text-start"
                />
            </Tile>
            <Tile label={t('employees.label')} hint={t('employees.hint')}>
                <span className="tabular-nums">{run.total_employees ?? 0}</span>
            </Tile>
        </div>
    );
};
