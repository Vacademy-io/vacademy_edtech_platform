import { useTranslation } from 'react-i18next';
import { StatusChip, type StatusType } from '@/components/design-system/status-chips';
import type { CalculationType, ComponentType } from '@/routes/erp/-shared/hr-types';

/** Labels + option lists shared by the components table, the dialog and the template editor. */

export const COMPONENT_TYPE_LABELS: Record<ComponentType, string> = {
    EARNING: 'Earning',
    DEDUCTION: 'Deduction',
    EMPLOYER_CONTRIBUTION: 'Employer contribution',
};

export const COMPONENT_TYPE_OPTIONS = (Object.keys(COMPONENT_TYPE_LABELS) as ComponentType[]).map(
    (value) => ({ _id: value, value, label: COMPONENT_TYPE_LABELS[value] })
);

export const COMPONENT_CATEGORIES = ['FIXED', 'VARIABLE', 'STATUTORY'] as const;

export const COMPONENT_CATEGORY_LABELS: Record<string, string> = {
    FIXED: 'Fixed',
    VARIABLE: 'Variable',
    STATUTORY: 'Statutory',
};

export const COMPONENT_CATEGORY_OPTIONS = COMPONENT_CATEGORIES.map((value) => ({
    _id: value,
    value,
    label: COMPONENT_CATEGORY_LABELS[value] ?? value,
}));

export const CALCULATION_TYPE_LABELS: Record<CalculationType, string> = {
    FIXED_AMOUNT: 'Fixed amount',
    PERCENTAGE_OF_BASIC: '% of Basic',
    PERCENTAGE_OF_CTC: '% of CTC',
    PERCENTAGE_OF_GROSS: '% of Gross',
    FORMULA: 'Formula',
};

export const CALCULATION_TYPE_OPTIONS = (
    Object.keys(CALCULATION_TYPE_LABELS) as CalculationType[]
).map((value) => ({ _id: value, value, label: CALCULATION_TYPE_LABELS[value] }));

/** Which value field a calculation type actually reads — the rest are ignored by the engine. */
export function valueFieldFor(
    calculationType: CalculationType | undefined
): 'fixed_value' | 'percentage_value' | 'formula' {
    switch (calculationType) {
        case 'FIXED_AMOUNT':
            return 'fixed_value';
        case 'FORMULA':
            return 'formula';
        default:
            return 'percentage_value';
    }
}

export const CURRENCY_OPTIONS = [
    { _id: 'INR', value: 'INR', label: 'INR — Indian rupee' },
    { _id: 'AED', value: 'AED', label: 'AED — UAE dirham' },
    { _id: 'SAR', value: 'SAR', label: 'SAR — Saudi riyal' },
];

/**
 * Earnings read as positive, deductions as money leaving — the employer's own
 * contribution is neither, so it stays neutral rather than borrowing "danger".
 */
export function componentTypeChipStatus(type: string | null | undefined): StatusType {
    switch ((type ?? '').toUpperCase()) {
        case 'EARNING':
            return 'SUCCESS';
        case 'DEDUCTION':
            return 'DANGER';
        default:
            return 'INFO';
    }
}

const COMPONENT_TYPE_LABEL_KEYS: Record<ComponentType, string> = {
    EARNING: 'componentType.earning',
    DEDUCTION: 'componentType.deduction',
    EMPLOYER_CONTRIBUTION: 'componentType.employerContribution',
};

export const ComponentTypeChip = ({ type }: { type: string | null | undefined }) => {
    const { t } = useTranslation('erpSalaryMeta');
    const upper = (type ?? '').toUpperCase();
    const labelKey = COMPONENT_TYPE_LABEL_KEYS[upper as ComponentType];
    const label = labelKey ? t(labelKey) : upper || '—';
    return (
        <StatusChip
            text={label}
            textSize="text-caption"
            status={componentTypeChipStatus(upper)}
            showIcon={false}
        />
    );
};
