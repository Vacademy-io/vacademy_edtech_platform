import { useTranslation } from 'react-i18next';
import { Warning, Prohibit } from '@phosphor-icons/react';
import { Card } from '@/components/ui/card';
import { MoneyCell } from '@/components/design-system/money-cell';
import type { ComplianceSkippedRowDTO, Money } from '@/routes/erp/-shared/hr-types';

/** The FY a date falls in, India-style (April–March): 2026-08-28 → "2026-27". */
export function financialYearOf(date = new Date()): string {
    const year = date.getFullYear();
    const start = date.getMonth() + 1 >= 4 ? year : year - 1;
    return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** The last `count` financial years, newest first — for the FY selector. */
export function recentFinancialYears(count = 5): string[] {
    const current = financialYearOf();
    const startYear = Number(current.slice(0, 4));
    return Array.from({ length: count }, (_, i) => {
        const y = startYear - i;
        return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
    });
}

export const FY_QUARTERS = [
    { value: 'Q1', label: 'Q1 (Apr–Jun)' },
    { value: 'Q2', label: 'Q2 (Jul–Sep)' },
    { value: 'Q3', label: 'Q3 (Oct–Dec)' },
    { value: 'Q4', label: 'Q4 (Jan–Mar)' },
];

/**
 * Warnings the backend attached to a filing.
 *
 * These are the whole point of previewing before you file: they name what is
 * unconfigured (no TAN, no PF establishment id) or provisional. Shown as a
 * block, never collapsed away.
 */
export const ComplianceWarnings = ({ warnings }: { warnings?: string[] }) => {
    const { t } = useTranslation('erpComplianceShared');
    if (!warnings?.length) return null;
    return (
        <Card className="flex flex-col gap-2 border-warning-200 bg-warning-50 p-4">
            <div className="flex items-center gap-2 text-warning-700">
                <Warning size={18} />
                <span className="text-subtitle font-medium">{t('warnings.title')}</span>
            </div>
            <ul className="flex list-disc flex-col gap-1 ps-6 text-body text-neutral-600">
                {warnings.map((w) => (
                    <li key={w}>{w}</li>
                ))}
            </ul>
        </Card>
    );
};

/**
 * Employees left out of a generated file.
 *
 * A filing that silently omits people is worse than one that fails, so this is
 * given the same visual weight as the data itself — each row names the employee
 * and the fixable reason (missing UAN, missing IP number, no IBAN).
 */
export const ComplianceSkipped = ({
    skipped,
    noun,
}: {
    skipped?: ComplianceSkippedRowDTO[];
    noun?: string;
}) => {
    const { t } = useTranslation('erpComplianceShared');
    if (!skipped?.length) return null;
    const resolvedNoun = noun ?? t('skipped.defaultNoun');
    return (
        <Card className="flex flex-col gap-3 border-danger-200 bg-danger-50 p-4">
            <div className="flex items-center gap-2 text-danger-600">
                <Prohibit size={18} />
                <span className="text-subtitle font-medium">
                    {t('skipped.excludedCount', { count: skipped.length, noun: resolvedNoun })}
                </span>
            </div>
            <p className="text-caption text-neutral-600">{t('skipped.fixHint')}</p>
            <div className="overflow-x-auto">
                <table className="w-full text-body">
                    <thead>
                        <tr className="border-b border-danger-200 text-caption uppercase text-neutral-500">
                            <th className="py-2 text-start font-medium">
                                {t('skipped.table.employee')}
                            </th>
                            <th className="py-2 text-start font-medium">
                                {t('skipped.table.reason')}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {skipped.map((row, i) => (
                            <tr
                                key={`${row.employeeCode ?? 'row'}-${i}`}
                                className="border-b border-danger-100 last:border-0"
                            >
                                <td className="py-2 text-neutral-700">
                                    {row.employeeName || row.employeeCode || '—'}
                                    {row.employeeName && row.employeeCode ? (
                                        <span className="ms-2 text-caption text-neutral-500">
                                            {row.employeeCode}
                                        </span>
                                    ) : null}
                                </td>
                                <td className="py-2 text-neutral-600">{row.reason || '—'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </Card>
    );
};

/** A labelled figure in a filing's summary strip. */
export const ComplianceStat = ({
    label,
    value,
    currency,
    isMoney = false,
}: {
    label: string;
    value: Money | number | undefined;
    currency?: string;
    isMoney?: boolean;
}) => (
    <div className="flex flex-col gap-1 rounded-md border border-neutral-200 px-4 py-3">
        <span className="text-caption text-neutral-500">{label}</span>
        {isMoney ? (
            <MoneyCell value={value ?? null} currency={currency} className="text-start" />
        ) : (
            <span className="text-subtitle font-medium tabular-nums text-neutral-700">
                {value ?? '—'}
            </span>
        )}
    </div>
);
