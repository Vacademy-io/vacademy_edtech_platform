import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { StatusChip, type StatusType } from '@/components/design-system/status-chips';
import { buildRunTypeLabels, type PayrollRunType } from '@/routes/erp/-shared/payroll-status';

/** Shared labels/options for the variable-pay table and its add dialog. */

export const ADJUSTMENT_TYPE_OPTIONS = [
    { _id: 'EARNING', value: 'EARNING', label: 'Earning — adds to net pay' },
    { _id: 'DEDUCTION', value: 'DEDUCTION', label: 'Deduction — reduces net pay' },
];

export const RUN_SCOPES: PayrollRunType[] = ['REGULAR', 'OFF_CYCLE', 'FNF', 'BONUS'];

/** One line each, because "FNF" means nothing to someone entering their first adjustment. */
export const RUN_SCOPE_MEANINGS: Record<PayrollRunType, string> = {
    REGULAR: 'the normal monthly payroll run',
    OFF_CYCLE: 'an extra run outside the monthly cycle',
    FNF: 'the full & final settlement when someone leaves',
    BONUS: 'a standalone bonus run',
};

/**
 * Module-scope constant that folds a translated run-type label with the
 * (still-English, out of this pass's scope) scope meaning, so this is a
 * `buildXxx(t)` factory — `t` must have `erpPayrollStatus` loaded alongside
 * the caller's own namespace.
 */
export const buildRunScopeOptions = (t: TFunction) => {
    const runTypeLabels = buildRunTypeLabels(t);
    return RUN_SCOPES.map((value) => ({
        _id: value,
        value,
        label: `${runTypeLabels[value]} — ${RUN_SCOPE_MEANINGS[value]}`,
    }));
};

export const CURRENCY_OPTIONS = [
    { _id: 'INR', value: 'INR', label: 'INR — Indian rupee' },
    { _id: 'AED', value: 'AED', label: 'AED — UAE dirham' },
    { _id: 'SAR', value: 'SAR', label: 'SAR — Saudi riyal' },
];

export function adjustmentTypeChipStatus(type: string | null | undefined): StatusType {
    return (type ?? '').toUpperCase() === 'DEDUCTION' ? 'DANGER' : 'SUCCESS';
}

export const AdjustmentTypeChip = ({ type }: { type: string | null | undefined }) => {
    const { t } = useTranslation('erpAdjustmentMeta');
    const upper = (type ?? '').toUpperCase();
    return (
        <StatusChip
            text={
                upper === 'DEDUCTION'
                    ? t('adjustmentType.deduction')
                    : upper === 'EARNING'
                      ? t('adjustmentType.earning')
                      : upper || '—'
            }
            textSize="text-caption"
            status={adjustmentTypeChipStatus(upper)}
            showIcon={false}
        />
    );
};

const RUN_SCOPE_LABEL_KEYS: Record<PayrollRunType, string> = {
    REGULAR: 'runScope.regular',
    OFF_CYCLE: 'runScope.offCycle',
    FNF: 'runScope.fnf',
    BONUS: 'runScope.bonus',
};

export const RunScopeChip = ({ scope }: { scope: string | null | undefined }) => {
    const { t } = useTranslation(['erpAdjustmentMeta', 'erpPayrollStatus']);
    const upper = (scope ?? 'REGULAR').toUpperCase();
    const labelKey = RUN_SCOPE_LABEL_KEYS[upper as PayrollRunType];
    const label = labelKey
        ? t(labelKey)
        : (buildRunTypeLabels(t)[upper as PayrollRunType] ?? upper);
    return (
        <span className="w-fit rounded-md border border-neutral-300 bg-neutral-50 px-2 py-1 text-caption text-neutral-600">
            {label}
        </span>
    );
};
