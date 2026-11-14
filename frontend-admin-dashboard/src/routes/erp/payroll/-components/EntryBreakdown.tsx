import { useMemo } from 'react';
import { Info, PauseCircle } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { MoneyCell } from '@/components/design-system/money-cell';
import { cn } from '@/lib/utils';
import type {
    ComponentType,
    PayrollEntryComponentDTO,
    PayrollEntryDTO,
} from '@/routes/erp/-shared/hr-types';

const buildGroups = (
    t: TFunction
): { type: ComponentType; label: string; tone: 'earning' | 'deduction' | 'default' }[] => [
    { type: 'EARNING', label: t('groups.earnings'), tone: 'default' },
    { type: 'DEDUCTION', label: t('groups.deductions'), tone: 'deduction' },
    { type: 'EMPLOYER_CONTRIBUTION', label: t('groups.employerContributions'), tone: 'default' },
];

const toNumber = (value: number | string | null | undefined) => {
    const numeric = typeof value === 'string' ? Number(value) : value ?? 0;
    return Number.isFinite(numeric) ? numeric : 0;
};

/**
 * TDS is the one line on a payslip that gets queried, disputed and audited, and it
 * is computed (projected annual tax spread over the year) rather than configured —
 * so it is called out instead of sitting anonymously among the deductions.
 */
const isTds = (component: PayrollEntryComponentDTO) => {
    const code = (component.component_code ?? '').toUpperCase();
    const name = (component.component_name ?? '').toUpperCase();
    return code === 'TDS' || code === 'INCOME_TAX' || name.includes('TDS');
};

const Row = ({
    component,
    currency,
    tone,
}: {
    component: PayrollEntryComponentDTO;
    currency: string | null | undefined;
    tone: 'earning' | 'deduction' | 'default';
}) => {
    const { t } = useTranslation('erpEntryBreakdown');
    const highlight = isTds(component);
    return (
        <div
            className={cn(
                'flex items-center justify-between gap-4 px-3 py-1',
                highlight && 'rounded-sm bg-warning-50'
            )}
        >
            <span className="flex min-w-0 items-center gap-2">
                <span className="truncate text-caption text-neutral-600">
                    {component.component_name ?? component.component_code ?? t('component')}
                </span>
                {highlight && (
                    <span className="shrink-0 rounded-sm bg-warning-100 px-1 text-caption text-warning-600">
                        {t('tax')}
                    </span>
                )}
            </span>
            <MoneyCell
                value={component.amount}
                currency={currency}
                tone={tone === 'default' ? 'default' : tone}
                className="shrink-0 text-caption"
            />
        </div>
    );
};

/**
 * One employee's payslip, expanded under their row.
 *
 * Grouped Earnings / Deductions / Employer contributions with a subtotal per group,
 * because the question asked of a breakdown is almost never "what is this one line"
 * but "does this add up to the net pay in the row above". The reconciliation line at
 * the bottom answers that explicitly: earnings − deductions = net.
 *
 * Employer contributions are shown but deliberately excluded from that arithmetic —
 * they are institute cost, not employee pay, and folding them in is the classic way
 * to make a payslip look wrong.
 */
export const EntryBreakdown = ({ entry }: { entry: PayrollEntryDTO }) => {
    const { t } = useTranslation('erpEntryBreakdown');
    const currency = entry.currency;

    const grouped = useMemo(() => {
        const components = entry.components ?? [];
        const groups = buildGroups(t);
        return groups.map((group) => {
            const rows = components.filter(
                (component) => (component.component_type ?? '').toUpperCase() === group.type
            );
            const subtotal = rows.reduce((sum, component) => sum + toNumber(component.amount), 0);
            return { ...group, rows, subtotal };
        });
    }, [entry.components, t]);

    const earnings = grouped.find((group) => group.type === 'EARNING')?.subtotal ?? 0;
    const deductions = grouped.find((group) => group.type === 'DEDUCTION')?.subtotal ?? 0;
    const hasComponents = grouped.some((group) => group.rows.length > 0);

    return (
        <div className="flex flex-col gap-4 p-4">
            {entry.hold_reason && (
                <div className="flex items-start gap-2 rounded-md bg-warning-50 p-3">
                    <PauseCircle
                        size={18}
                        weight="fill"
                        className="mt-1 shrink-0 text-warning-600"
                    />
                    <p className="text-caption text-warning-600">
                        <span className="font-semibold">{t('onHold')} </span>
                        {entry.hold_reason}
                    </p>
                </div>
            )}

            {!hasComponents ? (
                <div className="flex items-center gap-2 text-caption text-neutral-500">
                    <Info size={16} />
                    {t('noBreakdown')}
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                        {grouped.map((group) => (
                            <div
                                key={group.type}
                                className="flex flex-col gap-1 rounded-md border border-border bg-card p-3"
                            >
                                <span className="px-3 text-caption font-semibold text-neutral-700">
                                    {group.label}
                                </span>
                                {group.rows.length === 0 ? (
                                    <span className="px-3 py-1 text-caption text-neutral-400">
                                        {t('none')}
                                    </span>
                                ) : (
                                    group.rows.map((component, index) => (
                                        <Row
                                            key={
                                                component.component_id ??
                                                `${group.type}-${component.component_code ?? index}`
                                            }
                                            component={component}
                                            currency={currency}
                                            tone={group.tone}
                                        />
                                    ))
                                )}
                                <div className="mt-1 flex items-center justify-between gap-4 border-t border-border px-3 pt-2">
                                    <span className="text-caption font-semibold text-neutral-600">
                                        {t('subtotal')}
                                    </span>
                                    <MoneyCell
                                        value={group.subtotal}
                                        currency={currency}
                                        className="text-caption font-semibold"
                                    />
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-2 text-caption text-neutral-500">
                        <span>{t('groups.earnings')}</span>
                        <MoneyCell
                            value={earnings}
                            currency={currency}
                            className="inline text-caption text-neutral-600"
                        />
                        <span>−</span>
                        <span>{t('groups.deductions')}</span>
                        <MoneyCell
                            value={deductions}
                            currency={currency}
                            className="inline text-caption text-danger-600"
                        />
                        <span>=</span>
                        <span className="font-semibold text-neutral-700">{t('netPay')}</span>
                        <MoneyCell
                            value={entry.net_pay}
                            currency={currency}
                            className="inline text-caption font-semibold text-neutral-700"
                        />
                    </div>
                </>
            )}
        </div>
    );
};
