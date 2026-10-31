// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { CreateCPOPayload } from '../-types/cpo-types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    DEFAULT_FLEXIBLE_DEFAULTS,
    flexibleDefaultsError,
    flexibleHasNoSplitFee,
    type FlexibleDefaultsForm,
} from '../-utils/flexible-defaults';
import { FlexibleScheduleSettings } from './FlexibleScheduleSettings';

// ─── Types for the form ─────────────────────────────────────────────────────────

export interface InstallmentForm {
    id: number;
    amount: number | string;
    startDate?: string;
    dueDate: string;
    endDate?: string;
}

export interface FeeTypeForm {
    id: number;
    name: string;
    code: string;
    description: string;
    amount: number | string;
    hasInstallment: boolean;
    isRefundable: boolean;
    hasPenalty: boolean;
    penaltyPercentage: number | string;
    noOfInstallments: number | string;
    installments: InstallmentForm[];
}

export interface CPOForm {
    name: string;
    status: string;
    packageSessionId: string;
    packageSessionIds: string[];
    feeTypes: FeeTypeForm[];
    /** When true, learners enrolling via this CPO need admin approval before course access. */
    requireApproval?: boolean;
    /**
     * FIXED (default): installment dates are part of the plan. FLEXIBLE: the plan holds
     * fees and amounts only; the admin picks the number of installments and the gap for
     * each learner at enrollment (docs/CPO_FLEXIBLE_INSTALLMENTS.md).
     */
    scheduleMode?: 'FIXED' | 'FLEXIBLE';
    /** Defaults for a FLEXIBLE plan; prefill the Enroll wizard. */
    flexibleDefaults?: FlexibleDefaultsForm;
}



export interface BatchOption {
    id: string;
    label: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────────

function buildInstallmentPresets(t: TFunction) {
    return [
        { label: t('presets.installment.annual'), count: 1 },
        { label: t('presets.installment.halfYearly'), count: 2 },
        { label: t('presets.installment.quarterly'), count: 4 },
        { label: t('presets.installment.monthly'), count: 12 },
        { label: t('presets.installment.custom'), count: null },
    ];
}

function buildFeeTypePresets(t: TFunction) {
    const tuitionLabel = t('presets.feeType.tuitionLabel');
    const examLabel = t('presets.feeType.examLabel');
    const libraryLabel = t('presets.feeType.libraryLabel');
    const transportLabel = t('presets.feeType.transportLabel');
    const hostelLabel = t('presets.feeType.hostelLabel');
    const labLabel = t('presets.feeType.labLabel');
    return [
        {
            label: tuitionLabel,
            name: tuitionLabel,
            code: 'TUITION_FEE',
            description: t('presets.feeType.tuitionDescription'),
            hasInstallment: true,
            isRefundable: false,
            hasPenalty: true,
            penaltyPercentage: 5,
            noOfInstallments: 4,
        },
        {
            label: examLabel,
            name: examLabel,
            code: 'EXAM_FEE',
            description: t('presets.feeType.examDescription'),
            hasInstallment: false,
            isRefundable: false,
            hasPenalty: false,
            penaltyPercentage: '',
            noOfInstallments: 1,
        },
        {
            label: libraryLabel,
            name: libraryLabel,
            code: 'LIBRARY_FEE',
            description: t('presets.feeType.libraryDescription'),
            hasInstallment: false,
            isRefundable: false,
            hasPenalty: false,
            penaltyPercentage: '',
            noOfInstallments: 1,
        },
        {
            label: transportLabel,
            name: transportLabel,
            code: 'TRANSPORT_FEE',
            description: t('presets.feeType.transportDescription'),
            hasInstallment: true,
            isRefundable: false,
            hasPenalty: false,
            penaltyPercentage: '',
            noOfInstallments: 12,
        },
        {
            label: hostelLabel,
            name: hostelLabel,
            code: 'HOSTEL_FEE',
            description: t('presets.feeType.hostelDescription'),
            hasInstallment: true,
            isRefundable: true,
            hasPenalty: false,
            penaltyPercentage: '',
            noOfInstallments: 2,
        },
        {
            label: labLabel,
            name: labLabel,
            code: 'LAB_FEE',
            description: t('presets.feeType.labDescription'),
            hasInstallment: false,
            isRefundable: false,
            hasPenalty: false,
            penaltyPercentage: '',
            noOfInstallments: 1,
        },
    ];
}

// ─── Payload builder ────────────────────────────────────────────────────────────

/** schedule_mode + flexible_defaults for the create payload; empty for a fixed plan. */
function flexiblePayload(form: CPOForm): Pick<CreateCPOPayload, 'schedule_mode' | 'flexible_defaults'> {
    if (form.scheduleMode !== 'FLEXIBLE') return {};
    const d = form.flexibleDefaults ?? DEFAULT_FLEXIBLE_DEFAULTS;
    const toInt = (v: number | string) => {
        const n = Math.floor(Number(v));
        return Number.isFinite(n) && n > 0 ? n : null;
    };
    return {
        schedule_mode: 'FLEXIBLE',
        flexible_defaults: {
            count: toInt(d.count),
            interval: { unit: d.unit, value: toInt(d.value) ?? 1 },
            max_count: toInt(d.maxCount),
        },
    };
}

export function buildCreateCPOPayload(form: CPOForm, allBatches: any[] = []): CreateCPOPayload {
    // A flexible plan carries no installment dates: each fee is either split over the
    // learner's schedule (has_installment) or paid upfront on the first due date.
    const flexible = form.scheduleMode === 'FLEXIBLE';
    const expandedIds = new Set<string>(form.packageSessionIds);
    for (const selectedId of form.packageSessionIds) {
        for (const batch of allBatches) {
            if (batch.parent_id === selectedId) {
                expandedIds.add(batch.id);
            }
        }
    }

    return {
        id: null,
        name: form.name,
        institute_id: '',
        default_payment_option_id: null,
        status: form.status,
        created_by: null,
        approved_by: null,
        require_approval: !!form.requireApproval,
        ...flexiblePayload(form),
        fee_types: form.feeTypes.map((ft) => ({
            id: null,
            name: ft.name,
            code: ft.code || ft.name.toUpperCase().replace(/\s+/g, '_'),
            description: ft.description,
            status: 'ACTIVE',
            assigned_fee_value: {
                id: null,
                amount: parseFloat(ft.amount as string) || 0,
                no_of_installments: ft.hasInstallment ? ft.installments.length : 1,
                has_installment: ft.hasInstallment,
                is_refundable: ft.isRefundable,
                has_penalty: ft.hasPenalty,
                penalty_percentage: ft.hasPenalty
                    ? parseFloat(ft.penaltyPercentage as string) || 0
                    : null,
                status: 'ACTIVE',
                installments: ft.hasInstallment && !flexible
                    ? ft.installments.map((inst, idx) => ({
                          id: null,
                          installment_number: idx + 1,
                          amount: parseFloat(inst.amount as string) || 0,
                          status: 'PENDING',
                          start_date: inst.startDate || null,
                          end_date: inst.endDate || inst.dueDate || null,
                          due_date: inst.dueDate || null,
                      }))
                    : [],
                original_amount: parseFloat(ft.amount as string) || 0,
                discount_type: null,
                discount_value: 0,
            },
        })),
        package_session_links: Array.from(expandedIds).map((id) => ({
            enroll_invite_id: null,
            package_session_id: id,
        })),
    };
}

function generateInstallments(count: number, totalAmount: number): InstallmentForm[] {
    const today = new Date();
    const perInstallment = totalAmount ? Math.floor(totalAmount / count) : 0;
    const remainder = totalAmount ? totalAmount - perInstallment * count : 0;

    // Determine month gap based on installment count
    const monthGap = count <= 1 ? 12 : count === 2 ? 6 : count <= 4 ? 3 : 1;

    return Array.from({ length: count }, (_, i) => {
        const monthOffset = i * monthGap;
        const monthStart = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
        // Last day of the period (spans monthGap months)
        const periodEnd = new Date(today.getFullYear(), today.getMonth() + monthOffset + monthGap, 0);
        // Due date = period end + 7 days
        const dueDay = new Date(periodEnd);
        dueDay.setDate(dueDay.getDate() + 7);

        const startDate = monthStart.toISOString().split('T')[0];
        const endDate = periodEnd.toISOString().split('T')[0];
        const dueDate = dueDay.toISOString().split('T')[0];
        return {
            id: i + 1,
            amount: i === 0 ? perInstallment + remainder : perInstallment,
            startDate,
            dueDate,
            endDate,
        };
    });
}

function createEmptyFeeType(id: number): FeeTypeForm {
    return {
        id,
        name: '',
        code: '',
        description: '',
        amount: '',
        hasInstallment: true,
        isRefundable: false,
        hasPenalty: false,
        penaltyPercentage: '',
        noOfInstallments: 4,
        installments: generateInstallments(4, 0),
    };
}

// ─── Sub-components ─────────────────────────────────────────────────────────────

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
    return (
        <div
            onClick={() => onChange(!value)}
            className="relative flex-shrink-0 cursor-pointer"
            style={{ width: 38, height: 20 }}
        >
            <div
                className={`rounded-full transition-colors ${value ? 'bg-primary-500' : 'bg-gray-300'}`}
                style={{
                    width: 38,
                    height: 20,
                }}
            />
            <div
                className="absolute top-0.5 rounded-full bg-white shadow transition-all"
                style={{
                    width: 16,
                    height: 16,
                    left: value ? 20 : 2,
                }}
            />
        </div>
    );
}

// ─── Fee Type Editor ────────────────────────────────────────────────────────────

function FeeTypeEditor({
    feeType,
    index,
    onChange,
    onRemove,
    canRemove,
    flexible = false,
}: {
    feeType: FeeTypeForm;
    index: number;
    onChange: (updated: FeeTypeForm) => void;
    onRemove: () => void;
    canRemove: boolean;
    /** Flexible plan: no installment table; the toggle chooses split vs upfront. */
    flexible?: boolean;
}) {
    const { t } = useTranslation('financialManagementCreateCpoDialog');
    const { t: tFlex } = useTranslation('financialManagementFlexibleSchedule');
    const [isExpanded, setIsExpanded] = useState(true);
    const installmentPresets = React.useMemo(() => buildInstallmentPresets(t), [t]);
    const feeTypePresets = React.useMemo(() => buildFeeTypePresets(t), [t]);

    const update = (field: string, value: any) => {
        onChange({ ...feeType, [field]: value });
    };

    const handlePreset = (count: number | null) => {
        if (count !== null) {
            const total = parseFloat(feeType.amount as string) || 0;
            onChange({
                ...feeType,
                noOfInstallments: count,
                installments: generateInstallments(count, total),
            });
        } else {
            // Custom — just reveal the number input without regenerating installments
            update('noOfInstallments', '');
        }
    };

    const handleInstallmentCountChange = (val: string) => {
        const n = parseInt(val);
        if (n > 0 && n <= 60) {
            const total = parseFloat(feeType.amount as string) || 0;
            onChange({
                ...feeType,
                noOfInstallments: n,
                installments: generateInstallments(n, total),
            });
        } else {
            update('noOfInstallments', val);
        }
    };

    const handleAmountChange = (val: string) => {
        const total = parseFloat(val) || 0;
        const count = feeType.installments.length || 1;
        const perInstallment = total ? Math.floor(total / count) : 0;
        const remainder = total ? total - perInstallment * count : 0;
        onChange({
            ...feeType,
            amount: val,
            // Preserve existing dates — only redistribute amounts
            installments: feeType.installments.map((inst, i) => ({
                ...inst,
                amount: i === 0 ? perInstallment + remainder : perInstallment,
            })),
        });
    };

    const updateInstallment = (id: number, field: string, value: any) => {
        onChange({
            ...feeType,
            installments: feeType.installments.map((inst) => {
                if (inst.id !== id) return inst;
                const updated = { ...inst, [field]: value };
                // Keep endDate in sync with dueDate unless user has already diverged them
                if (field === 'dueDate' && inst.endDate === inst.dueDate) {
                    updated.endDate = value;
                }
                return updated;
            }),
        });
    };

    const applyPreset = (preset: any) => {
        if (!preset.name) return; // Custom — leave blank for manual entry
        const count = preset.noOfInstallments ?? 1;
        const currentAmount = parseFloat(feeType.amount as string) || 0;
        onChange({
            ...feeType,
            name: preset.name,
            code: preset.code ?? '',
            description: preset.description ?? '',
            hasInstallment: preset.hasInstallment ?? false,
            isRefundable: preset.isRefundable ?? false,
            hasPenalty: preset.hasPenalty ?? false,
            penaltyPercentage: preset.penaltyPercentage ?? '',
            noOfInstallments: count,
            installments: generateInstallments(count, currentAmount),
        });
    };

    const installmentTotal = feeType.installments.reduce(
        (sum, i) => sum + (parseFloat(i.amount as string) || 0),
        0
    );
    const totalAmount = parseFloat(feeType.amount as string) || 0;
    const diff = totalAmount - installmentTotal;

    return (
        <div className="overflow-hidden rounded-xl border border-gray-200">
            {/* Fee Type Header */}
            <div
                className="flex cursor-pointer items-center justify-between bg-gray-50 px-4 py-3 transition-colors hover:bg-gray-100"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex items-center gap-3">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-100 text-xs font-bold text-primary-500">
                        {index + 1}
                    </div>
                    <div>
                        <div className="text-sm font-semibold text-gray-900">
                            {feeType.name || t('feeType.defaultName', { index: index + 1 })}
                        </div>
                        {feeType.amount && (
                            <div className="text-xs text-gray-500">
                                ₹{parseFloat(feeType.amount as string).toLocaleString('en-IN')} ·{' '}
                                {flexible
                                    ? tFlex(feeType.hasInstallment ? 'fee.split' : 'fee.upfront')
                                    : t('feeType.installmentCount', {
                                          count: feeType.installments.length,
                                      })}
                            </div>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {canRemove && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onRemove();
                            }}
                            className="cursor-pointer rounded px-2 py-1 text-xs font-medium text-red-500 transition hover:bg-red-50 hover:text-red-700"
                        >
                            {t('feeType.remove')}
                        </button>
                    )}
                    <svg
                        className={`h-4 w-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M19 9l-7 7-7-7"
                        />
                    </svg>
                </div>
            </div>

            {/* Fee Type Form */}
            {isExpanded && (
                <div className="flex flex-col gap-4 p-4">
                    {/* Quick Presets */}
                    <div>
                        <div className="flex flex-wrap gap-1.5">
                            {feeTypePresets.map((preset) => (
                                <button
                                    key={preset.label}
                                    type="button"
                                    onClick={() => applyPreset(preset)}
                                    className="cursor-pointer rounded-full border border-gray-200 px-3 py-1 text-xs font-semibold text-gray-600 transition hover:border-primary-400 hover:bg-primary-100 hover:text-primary-500"
                                >
                                    {preset.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Name & Description */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <Label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                                {t('feeType.nameLabel')} <span className="text-red-500">*</span>
                            </Label>
                            <Input
                                placeholder={t('feeType.namePlaceholder')}
                                value={feeType.name}
                                onChange={(e) => update('name', e.target.value)}
                                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none transition focus:border-primary-500"
                            />
                        </div>
                        <div>
                            <Label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                                {t('feeType.descriptionLabel')}
                            </Label>
                            <Input
                                placeholder={t('feeType.descriptionPlaceholder')}
                                value={feeType.description}
                                onChange={(e) => update('description', e.target.value)}
                                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none transition focus:border-primary-500"
                            />
                        </div>
                    </div>

                    {/* Amount */}
                    <div>
                        <Label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                            {t('feeType.totalAmountLabel')} <span className="text-red-500">*</span>
                        </Label>
                        <Input
                            type="number"
                            placeholder={t('feeType.amountPlaceholder')}
                            value={feeType.amount}
                            onChange={(e) => handleAmountChange(e.target.value)}
                            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold outline-none transition focus:border-primary-500"
                        />
                    </div>

                    {/* Toggles Row */}
                    <div className="flex flex-wrap items-center gap-6">
                        <div className="flex items-center gap-2">
                            <Toggle
                                value={feeType.hasInstallment}
                                onChange={(v) => update('hasInstallment', v)}
                            />
                            <span className="text-sm font-medium text-gray-700">
                                {flexible ? tFlex('fee.splitToggle') : t('feeType.hasInstallments')}
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <Toggle
                                value={feeType.isRefundable}
                                onChange={(v) => update('isRefundable', v)}
                            />
                            <span className="text-sm font-medium text-gray-700">
                                {t('feeType.refundable')}
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <Toggle
                                value={feeType.hasPenalty}
                                onChange={(v) => update('hasPenalty', v)}
                            />
                            <span className="text-sm font-medium text-gray-700">
                                {t('feeType.latePenalty')}
                            </span>
                        </div>
                        {feeType.hasPenalty && (
                            <div className="flex items-center gap-1">
                                <Input
                                    type="number"
                                    placeholder={t('feeType.penaltyPlaceholder')}
                                    value={feeType.penaltyPercentage}
                                    onChange={(e) => update('penaltyPercentage', e.target.value)}
                                    className="w-16 rounded-lg border border-gray-200 px-2 py-1 text-sm outline-none transition focus:border-primary-500"
                                />
                                <span className="text-xs text-gray-500">%</span>
                            </div>
                        )}
                    </div>

                    {/* Installment Configuration */}
                    {feeType.hasInstallment && !flexible && (
                        <div className="flex flex-col gap-3">
                            {/* Frequency Presets */}
                            <div>
                                <Label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                                    {t('feeType.paymentFrequency')}
                                </Label>
                                <div className="flex flex-wrap gap-2">
                                    {installmentPresets.map((preset) => {
                                        const isActive =
                                            preset.count !== null &&
                                            Number(feeType.noOfInstallments) === preset.count;
                                        return (
                                            <button
                                                key={preset.label}
                                                type="button"
                                                onClick={() => handlePreset(preset.count)}
                                                className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                                                    isActive
                                                        ? 'border-primary-500 bg-primary-100 text-primary-500'
                                                        : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                                                }`}
                                            >
                                                {preset.label}
                                                {preset.count && (
                                                    <span className="ml-1 opacity-60">
                                                        {t('feeType.presetMultiplier', {
                                                            count: preset.count,
                                                        })}
                                                    </span>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                                {/* Custom count input */}
                                {![1, 2, 4, 12].includes(Number(feeType.noOfInstallments)) && (
                                    <Input
                                        type="number"
                                        min={1}
                                        max={60}
                                        placeholder={t('feeType.installmentCountPlaceholder')}
                                        value={feeType.noOfInstallments}
                                        onChange={(e) =>
                                            handleInstallmentCountChange(e.target.value)
                                        }
                                        className="mt-2 w-48 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none transition focus:border-primary-500"
                                    />
                                )}
                            </div>

                            {/* Installment Table */}
                            <div className="overflow-hidden rounded-lg border border-gray-200">
                                {diff !== 0 && totalAmount > 0 && (
                                    <div
                                        className={`px-3 py-2 text-xs font-medium ${
                                            diff > 0
                                                ? 'border-b border-amber-100 bg-amber-50 text-amber-700'
                                                : 'border-b border-red-100 bg-red-50 text-red-700'
                                        }`}
                                    >
                                        {diff > 0
                                            ? t('feeType.remainingToAllocate', {
                                                  amount: diff.toLocaleString('en-IN'),
                                              })
                                            : t('feeType.exceedsTotal', {
                                                  amount: Math.abs(diff).toLocaleString('en-IN'),
                                              })}
                                    </div>
                                )}
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-gray-100 bg-gray-50">
                                            <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-gray-500">
                                                {t('feeType.columnIndex')}
                                            </th>
                                            <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-gray-500">
                                                {t('feeType.columnAmount')}
                                            </th>
                                            <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-gray-500">
                                                {t('feeType.columnStartDate')}
                                            </th>
                                            <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-gray-500">
                                                {t('feeType.columnEndDate')}
                                            </th>
                                            <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-gray-500">
                                                {t('feeType.columnDueDate')}
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {feeType.installments.map((inst, idx) => (
                                            <tr key={inst.id} className="border-b border-gray-50">
                                                <td className="w-10 px-3 py-2 font-medium text-gray-400">
                                                    {idx + 1}
                                                </td>
                                                <td className="px-3 py-2">
                                                    <Input
                                                        type="number"
                                                        value={inst.amount}
                                                        onChange={(e) =>
                                                            updateInstallment(
                                                                inst.id,
                                                                'amount',
                                                                e.target.value
                                                            )
                                                        }
                                                        className="w-28 rounded-md border border-gray-200 px-2 py-1 text-sm outline-none focus:border-primary-500"
                                                    />
                                                </td>
                                                <td className="px-3 py-2">
                                                    <Input
                                                        type="date"
                                                        value={inst.startDate ?? ''}
                                                        onChange={(e) =>
                                                            updateInstallment(
                                                                inst.id,
                                                                'startDate',
                                                                e.target.value
                                                            )
                                                        }
                                                        className="rounded-md border border-gray-200 px-2 py-1 text-sm outline-none focus:border-primary-500"
                                                    />
                                                </td>

                                                <td className="px-3 py-2">
                                                    <Input
                                                        type="date"
                                                        value={inst.endDate ?? ''}
                                                        onChange={(e) =>
                                                            updateInstallment(
                                                                inst.id,
                                                                'endDate',
                                                                e.target.value
                                                            )
                                                        }
                                                        className="rounded-md border border-gray-200 px-2 py-1 text-sm outline-none focus:border-primary-500"
                                                    />
                                                </td>
                                                <td className="px-3 py-2">
                                                    <Input
                                                        type="date"
                                                        value={inst.dueDate}
                                                        onChange={(e) =>
                                                            updateInstallment(
                                                                inst.id,
                                                                'dueDate',
                                                                e.target.value
                                                            )
                                                        }
                                                        className="rounded-md border border-gray-200 px-2 py-1 text-sm outline-none focus:border-primary-500"
                                                    />
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot>
                                        <tr className="bg-gray-50">
                                            <td className="px-3 py-2 font-bold text-gray-700">
                                                {t('feeType.total')}
                                            </td>
                                            <td
                                                className={`px-3 py-2 font-bold ${
                                                    installmentTotal === totalAmount
                                                        ? 'text-green-600'
                                                        : 'text-gray-800'
                                                }`}
                                            >
                                                ₹{installmentTotal.toLocaleString('en-IN')}
                                            </td>
                                            <td />
                                            <td />
                                            <td />
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ─── Class Multi-Select Dropdown ─────────────────────────────────────────────────

function ClassMultiSelect({
    batchOptions,
    selectedIds,
    onToggle,
}: {
    batchOptions: BatchOption[];
    selectedIds: string[];
    onToggle: (id: string) => void;
}) {
    const { t } = useTranslation('financialManagementCreateCpoDialog');
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');

    const selectedLabels = batchOptions
        .filter((opt) => selectedIds.includes(opt.id))
        .map((opt) => opt.label);

    const filteredOptions = React.useMemo(() => {
        const q = search.trim().toLowerCase();
        return q ? batchOptions.filter((opt) => opt.label.toLowerCase().includes(q)) : batchOptions;
    }, [batchOptions, search]);

    const toggleOpen = () => {
        setOpen((v) => {
            if (v) setSearch('');
            return !v;
        });
    };

    return (
        <div className="relative">
            <Label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                {t('classSelect.label')} <span className="text-red-500">*</span>
            </Label>
            <button
                type="button"
                onClick={toggleOpen}
                className="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-left text-sm outline-none transition focus:border-primary-500 focus:ring-1 focus:ring-primary-200"
            >
                <span className={selectedIds.length === 0 ? 'text-gray-400' : 'text-gray-700'}>
                    {selectedIds.length === 0
                        ? t('classSelect.placeholder')
                        : selectedLabels.length <= 2
                          ? selectedLabels.join(', ')
                          : t('classSelect.selectedBadge', { count: selectedLabels.length })}
                </span>
                <svg
                    className={`h-4 w-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M19 9l-7 7-7-7"
                    />
                </svg>
            </button>

            {open && (
                <div className="absolute z-[1300] mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg">
                    <div className="border-b border-gray-100 p-2">
                        <input
                            type="text"
                            autoFocus
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder={t('classSelect.searchPlaceholder')}
                            className="w-full rounded-md border border-gray-200 px-2 py-1.5 text-sm outline-none transition focus:border-primary-500 focus:ring-1 focus:ring-primary-200"
                        />
                    </div>
                    <div className="max-h-[200px] overflow-y-auto">
                        {batchOptions.length === 0 && (
                            <p className="px-3 py-2 text-sm text-gray-400">
                                {t('classSelect.noClasses')}
                            </p>
                        )}
                        {batchOptions.length > 0 && filteredOptions.length === 0 && (
                            <p className="px-3 py-2 text-sm text-gray-400">
                                {t('classSelect.noMatch')}
                            </p>
                        )}
                        {filteredOptions.map((opt) => (
                            <label
                                key={opt.id}
                                className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm transition hover:bg-gray-50"
                            >
                                <input
                                    type="checkbox"
                                    checked={selectedIds.includes(opt.id)}
                                    onChange={() => onToggle(opt.id)}
                                    className="h-4 w-4 rounded border-gray-300 text-primary-500 focus:ring-primary-500"
                                />
                                <span className="text-gray-700">{opt.label}</span>
                            </label>
                        ))}
                    </div>
                </div>
            )}

            {selectedIds.length > 0 && (
                <p className="mt-1 text-xs text-gray-500">
                    {t('classSelect.selectedSummary', { count: selectedIds.length })}
                </p>
            )}
        </div>
    );
}

// ─── Main Dialog ────────────────────────────────────────────────────────────────

export default function CreateCPODialog({
    onSave,
    onClose,
    batchOptions,
    allBatches = [],
    defaultPackageSessionId,
    isSaving = false,
}: {
    onSave: (data: CPOForm) => void;
    onClose: () => void;
    batchOptions: BatchOption[];
    defaultPackageSessionId?: string;
    isSaving?: boolean;
}) {
    const { t } = useTranslation('financialManagementCreateCpoDialog');
    const { t: tFlex } = useTranslation('financialManagementFlexibleSchedule');
    const [form, setForm] = useState<CPOForm>({
        name: '',
        status: 'ACTIVE',
        packageSessionId: defaultPackageSessionId ?? '',
        packageSessionIds: defaultPackageSessionId ? [defaultPackageSessionId] : [],
        feeTypes: [createEmptyFeeType(1)],
        requireApproval: false,
    });

    useEffect(() => {
        if (form.packageSessionIds.length === 0 && batchOptions.length > 0) {
            setForm((prev) => ({
                ...prev,
                packageSessionId: batchOptions[0].id,
                packageSessionIds: [batchOptions[0].id],
            }));
        }
    }, [batchOptions, form.packageSessionIds.length]);

    const togglePackageSession = (id: string) => {
        setForm((prev) => {
            const ids = prev.packageSessionIds.includes(id)
                ? prev.packageSessionIds.filter((i) => i !== id)
                : [...prev.packageSessionIds, id];
            return {
                ...prev,
                packageSessionIds: ids,
                packageSessionId: ids[0] ?? '',
            };
        });
    };

    const addFeeType = () => {
        const nextId = Math.max(...form.feeTypes.map((f) => f.id), 0) + 1;
        setForm((prev) => ({
            ...prev,
            feeTypes: [...prev.feeTypes, createEmptyFeeType(nextId)],
        }));
    };

    const removeFeeType = (id: number) => {
        setForm((prev) => ({
            ...prev,
            feeTypes: prev.feeTypes.filter((f) => f.id !== id),
        }));
    };

    const updateFeeType = (id: number, updated: FeeTypeForm) => {
        setForm((prev) => ({
            ...prev,
            feeTypes: prev.feeTypes.map((f) => (f.id === id ? updated : f)),
        }));
    };

    const isValid =
        form.packageSessionIds.length > 0 &&
        form.name.trim() !== '' &&
        form.feeTypes.length > 0 &&
        form.feeTypes.every((ft) => ft.name.trim() !== '' && parseFloat(ft.amount as string) > 0) &&
        !flexibleDefaultsError(form.scheduleMode, form.flexibleDefaults) &&
        !flexibleHasNoSplitFee(form.scheduleMode, form.feeTypes);

    const totalPackageAmount = form.feeTypes.reduce(
        (sum, ft) => sum + (parseFloat(ft.amount as string) || 0),
        0
    );

    const uniqueInstallmentCount = (() => {
        const uniqueDates = new Set<string>();
        form.feeTypes.forEach((ft, ftIdx) => {
            if (ft.hasInstallment) {
                ft.installments.forEach((inst) => {
                    uniqueDates.add(inst.dueDate || `_empty_${ftIdx}_${inst.id}`);
                });
            } else {
                uniqueDates.add(`_lump_${ft.id}`);
            }
        });
        return uniqueDates.size;
    })();

    return (
        <div
            className="fixed inset-0 z-[1000] flex items-center justify-center"
            style={{
                background: 'rgba(15,23,42,0.55)',
                backdropFilter: 'blur(4px)',
                fontFamily: "'DM Sans', sans-serif",
            }}
        >
            <div className="max-h-[92vh] w-[min(860px,96vw)] overflow-y-auto rounded-2xl bg-white shadow-2xl">
                {/* Header */}
                <div className="sticky top-0 z-10 border-b border-gray-100 bg-white px-6 pb-4 pt-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-primary-500">
                                {t('dialog.eyebrow')}
                            </div>
                            <h2 className="text-xl font-extrabold text-gray-900">
                                {t('dialog.title')}
                            </h2>
                        </div>
                        <button
                            onClick={onClose}
                            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg bg-gray-100 text-gray-500 transition hover:bg-gray-200"
                        >
                            ✕
                        </button>
                    </div>
                </div>

                {/* Summary Bar */}
                {form.feeTypes.length > 0 && (
                    <div className="mx-4 flex items-center gap-6 rounded-xl border border-primary-100 bg-primary-100 px-4 py-3">
                        <div className="flex items-center gap-x-2">
                            <div className="text-sm font-bold uppercase tracking-wider text-primary-500">
                                {t('summary.feeTypes')}
                            </div>
                            <div className="text-lg font-extrabold text-primary-500">
                                {form.feeTypes.length}
                            </div>
                        </div>
                        <div className="h-8 w-px bg-primary-200" />
                        <div className="flex items-center gap-x-2">
                            <div className="text-sm font-bold uppercase tracking-wider text-primary-500">
                                {t('summary.totalAmount')}
                            </div>
                            <div className="text-lg font-extrabold text-primary-500">
                                ₹{totalPackageAmount.toLocaleString('en-IN')}
                            </div>
                        </div>
                        <div className="h-8 w-px bg-primary-200" />
                        <div className="flex items-center gap-x-2">
                            <div className="text-sm font-bold uppercase tracking-wider text-primary-500">
                                {t('summary.paymentDates')}
                            </div>
                            <div className="text-lg font-extrabold text-primary-500">
                                {form.scheduleMode === 'FLEXIBLE'
                                    ? tFlex('perLearner')
                                    : uniqueInstallmentCount}
                            </div>
                        </div>
                    </div>
                )}

                {/* Body */}
                <div className="flex flex-col gap-5 px-6 py-5">
                    {/* Class Selector (multi-select dropdown) */}
                    <ClassMultiSelect
                        batchOptions={batchOptions}
                        selectedIds={form.packageSessionIds}
                        onToggle={togglePackageSession}
                    />

                    {/* Package Name & Status */}
                    <div className="grid grid-cols-[1fr_200px] gap-4">
                        <div>
                            <Label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                                {t('packageName.label')} <span className="text-red-500">*</span>
                            </Label>
                            <Input
                                placeholder={t('packageName.placeholder')}
                                value={form.name}
                                onChange={(e) =>
                                    setForm((prev) => ({ ...prev, name: e.target.value }))
                                }
                                className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none transition focus:border-primary-500 focus:ring-1 focus:ring-primary-200"
                            />
                        </div>
                        <div>
                            <Label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                                {t('status.label')}
                            </Label>
                            <Select
                                value={form.status}
                                onValueChange={(value) =>
                                    setForm((prev) => ({ ...prev, status: value }))
                                }
                            >
                                <SelectTrigger className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-primary-500">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="z-[1200]">
                                    <SelectItem value="ACTIVE">{t('status.active')}</SelectItem>
                                    <SelectItem value="DRAFT">{t('status.draft')}</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {/* Admin approval toggle */}
                    <div className="flex items-start justify-between gap-4 rounded-lg border border-gray-200 px-4 py-3">
                        <div>
                            <Label className="text-sm font-semibold text-gray-800">
                                {t('approval.label')}
                            </Label>
                            <p className="mt-0.5 text-xs text-gray-500">
                                {t('approval.description')}
                            </p>
                        </div>
                        <Switch
                            checked={!!form.requireApproval}
                            onCheckedChange={(checked) =>
                                setForm((prev) => ({ ...prev, requireApproval: checked }))
                            }
                        />
                    </div>

                    {/* Fixed dates vs chosen for each learner at enrollment */}
                    <FlexibleScheduleSettings
                        form={form}
                        onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
                    />

                    {/* Fee Types Section */}
                    <div>
                        <div className="mb-3 flex items-center justify-between">
                            <Label className="text-sm font-bold text-gray-800">
                                {t('summary.feeTypes')}
                            </Label>
                            <button
                                type="button"
                                onClick={addFeeType}
                                className="flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-primary-500 transition hover:bg-primary-100 hover:text-primary-500"
                            >
                                <svg
                                    className="h-3.5 w-3.5"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth="2"
                                        d="M12 4v16m8-8H4"
                                    />
                                </svg>
                                {t('addFeeType')}
                            </button>
                        </div>

                        <div className="flex flex-col gap-3">
                            {form.feeTypes.map((ft, idx) => (
                                <FeeTypeEditor
                                    key={ft.id}
                                    feeType={ft}
                                    index={idx}
                                    onChange={(updated) => updateFeeType(ft.id, updated)}
                                    onRemove={() => removeFeeType(ft.id)}
                                    canRemove={form.feeTypes.length > 1}
                                    flexible={form.scheduleMode === 'FLEXIBLE'}
                                />
                            ))}
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="sticky bottom-0 flex items-center justify-between border-t border-gray-100 bg-white px-6 py-4">
                    <button
                        onClick={onClose}
                        className="cursor-pointer rounded-lg border border-gray-200 px-5 py-2.5 text-sm font-semibold text-gray-600 transition hover:bg-gray-50"
                    >
                        {t('cancel')}
                    </button>
                    <button
                        onClick={() => onSave(form)}
                        disabled={!isValid || isSaving}
                        className={`cursor-pointer rounded-lg px-6 py-2.5 text-sm font-bold text-white transition ${
                            isValid && !isSaving
                                ? 'bg-gradient-to-r from-primary-400 to-primary-500 shadow-md hover:opacity-90'
                                : 'cursor-not-allowed bg-gray-300'
                        }`}
                    >
                        {isSaving ? t('saving') : t('savePackage')}
                    </button>
                </div>
            </div>
        </div>
    );
}
