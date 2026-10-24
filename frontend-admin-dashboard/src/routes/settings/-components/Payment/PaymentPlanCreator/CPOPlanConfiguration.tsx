// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import type { CPOForm, FeeTypeForm, InstallmentForm, BatchOption } from '@/routes/financial-management/fee-plans/-components/CreateCPODialog';
import { FlexibleScheduleSettings } from '@/routes/financial-management/fee-plans/-components/FlexibleScheduleSettings';

// ─── Constants ───────────────────────────────────────────────────────────────

const buildInstallmentPresets = (t: TFunction) => [
    { label: t('installmentPresets.annual'), count: 1 },
    { label: t('installmentPresets.halfYearly'), count: 2 },
    { label: t('installmentPresets.quarterly'), count: 4 },
    { label: t('installmentPresets.monthly'), count: 12 },
    { label: t('installmentPresets.custom'), count: null },
];

const buildFeeTypePresets = (t: TFunction) => [
    { label: t('feeTypePresets.tuitionFee.label'), name: t('feeTypePresets.tuitionFee.label'), code: 'TUITION_FEE', description: t('feeTypePresets.tuitionFee.description'), hasInstallment: true, isRefundable: false, hasPenalty: true, penaltyPercentage: 5, noOfInstallments: 4 },
    { label: t('feeTypePresets.examFee.label'), name: t('feeTypePresets.examFee.label'), code: 'EXAM_FEE', description: t('feeTypePresets.examFee.description'), hasInstallment: false, isRefundable: false, hasPenalty: false, penaltyPercentage: '', noOfInstallments: 1 },
    { label: t('feeTypePresets.libraryFee.label'), name: t('feeTypePresets.libraryFee.label'), code: 'LIBRARY_FEE', description: t('feeTypePresets.libraryFee.description'), hasInstallment: false, isRefundable: false, hasPenalty: false, penaltyPercentage: '', noOfInstallments: 1 },
    { label: t('feeTypePresets.transportFee.label'), name: t('feeTypePresets.transportFee.label'), code: 'TRANSPORT_FEE', description: t('feeTypePresets.transportFee.description'), hasInstallment: true, isRefundable: false, hasPenalty: false, penaltyPercentage: '', noOfInstallments: 12 },
    { label: t('feeTypePresets.hostelFee.label'), name: t('feeTypePresets.hostelFee.label'), code: 'HOSTEL_FEE', description: t('feeTypePresets.hostelFee.description'), hasInstallment: true, isRefundable: true, hasPenalty: false, penaltyPercentage: '', noOfInstallments: 2 },
    { label: t('feeTypePresets.labFee.label'), name: t('feeTypePresets.labFee.label'), code: 'LAB_FEE', description: t('feeTypePresets.labFee.description'), hasInstallment: false, isRefundable: false, hasPenalty: false, penaltyPercentage: '', noOfInstallments: 1 },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateInstallments(count: number, totalAmount: number): InstallmentForm[] {
    const today = new Date();
    const perInstallment = totalAmount ? Math.floor(totalAmount / count) : 0;
    const remainder = totalAmount ? totalAmount - perInstallment * count : 0;
    const monthGap = count <= 1 ? 12 : count === 2 ? 6 : count <= 4 ? 3 : 1;
    return Array.from({ length: count }, (_, i) => {
        const monthStart = new Date(today.getFullYear(), today.getMonth() + i * monthGap, 1);
        const periodEnd = new Date(today.getFullYear(), today.getMonth() + i * monthGap + monthGap, 0);
        const dueDay = new Date(periodEnd);
        dueDay.setDate(dueDay.getDate() + 7);
        return {
            id: i + 1,
            amount: i === 0 ? perInstallment + remainder : perInstallment,
            startDate: monthStart.toISOString().split('T')[0],
            dueDate: dueDay.toISOString().split('T')[0],
            endDate: periodEnd.toISOString().split('T')[0],
        };
    });
}

function createEmptyFeeType(id: number): FeeTypeForm {
    return { id, name: '', code: '', description: '', amount: '', hasInstallment: true, isRefundable: false, hasPenalty: false, penaltyPercentage: '', noOfInstallments: 4, installments: generateInstallments(4, 0) };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
    return (
        <div onClick={() => onChange(!value)} className="relative flex-shrink-0 cursor-pointer" style={{ width: 38, height: 20 }}>
            <div className={`rounded-full transition-colors ${value ? 'bg-primary-500' : 'bg-gray-300'}`} style={{ width: 38, height: 20 }} />
            <div className="absolute top-0.5 rounded-full bg-white shadow transition-all" style={{ width: 16, height: 16, left: value ? 20 : 2 }} />
        </div>
    );
}

function FeeTypeEditor({ feeType, index, onChange, onRemove, canRemove, flexible = false }: { feeType: FeeTypeForm; index: number; onChange: (updated: FeeTypeForm) => void; onRemove: () => void; canRemove: boolean; flexible?: boolean }) {
    const { t } = useTranslation('settingsCpoPlanConfiguration');
    // Flexible plan: no installment table; the toggle chooses split over the learner's schedule vs upfront.
    const { t: tFlex } = useTranslation('financialManagementFlexibleSchedule');
    const installmentPresets = React.useMemo(() => buildInstallmentPresets(t), [t]);
    const feeTypePresets = React.useMemo(() => buildFeeTypePresets(t), [t]);
    const [isExpanded, setIsExpanded] = useState(true);
    const update = (field: string, value: any) => onChange({ ...feeType, [field]: value });

    const handlePreset = (count: number | null) => {
        if (count !== null) {
            onChange({ ...feeType, noOfInstallments: count, installments: generateInstallments(count, parseFloat(feeType.amount as string) || 0) });
        } else {
            update('noOfInstallments', '');
        }
    };

    const handleInstallmentCountChange = (val: string) => {
        const n = parseInt(val);
        if (n > 0 && n <= 60) {
            onChange({ ...feeType, noOfInstallments: n, installments: generateInstallments(n, parseFloat(feeType.amount as string) || 0) });
        } else {
            update('noOfInstallments', val);
        }
    };

    const handleAmountChange = (val: string) => {
        const total = parseFloat(val) || 0;
        const count = feeType.installments.length || 1;
        const per = total ? Math.floor(total / count) : 0;
        const rem = total ? total - per * count : 0;
        onChange({ ...feeType, amount: val, installments: feeType.installments.map((inst, i) => ({ ...inst, amount: i === 0 ? per + rem : per })) });
    };

    const updateInstallment = (id: number, field: string, value: any) => {
        onChange({
            ...feeType,
            installments: feeType.installments.map((inst) => {
                if (inst.id !== id) return inst;
                const updated = { ...inst, [field]: value };
                if (field === 'dueDate' && inst.endDate === inst.dueDate) updated.endDate = value;
                return updated;
            }),
        });
    };

    const applyPreset = (preset: any) => {
        if (!preset.name) return;
        const count = preset.noOfInstallments ?? 1;
        const currentAmount = parseFloat(feeType.amount as string) || 0;
        onChange({ ...feeType, name: preset.name, code: preset.code ?? '', description: preset.description ?? '', hasInstallment: preset.hasInstallment ?? false, isRefundable: preset.isRefundable ?? false, hasPenalty: preset.hasPenalty ?? false, penaltyPercentage: preset.penaltyPercentage ?? '', noOfInstallments: count, installments: generateInstallments(count, currentAmount) });
    };

    const installmentTotal = feeType.installments.reduce((sum, i) => sum + (parseFloat(i.amount as string) || 0), 0);
    const totalAmount = parseFloat(feeType.amount as string) || 0;
    const diff = totalAmount - installmentTotal;

    return (
        <div className="overflow-hidden rounded-xl border border-gray-200">
            <div className="flex cursor-pointer items-center justify-between bg-gray-50 px-4 py-3 transition-colors hover:bg-gray-100" onClick={() => setIsExpanded(!isExpanded)}>
                <div className="flex items-center gap-3">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-100 text-xs font-bold text-primary-500">{index + 1}</div>
                    <div>
                        <div className="text-sm font-semibold text-gray-900">{feeType.name || t('feeTypeEditor.defaultName', { number: index + 1 })}</div>
                        {feeType.amount && <div className="text-xs text-gray-500">₹{parseFloat(feeType.amount as string).toLocaleString('en-IN')} · {flexible ? tFlex(feeType.hasInstallment ? 'fee.split' : 'fee.upfront') : t('feeTypeEditor.installmentCount', { count: feeType.installments.length })}</div>}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {canRemove && <button onClick={(e) => { e.stopPropagation(); onRemove(); }} className="cursor-pointer rounded px-2 py-1 text-xs font-medium text-red-500 transition hover:bg-red-50 hover:text-red-700">{t('feeTypeEditor.remove')}</button>}
                    <svg className={`h-4 w-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
                </div>
            </div>

            {isExpanded && (
                <div className="flex flex-col gap-4 p-4">
                    <div className="flex flex-wrap gap-1.5">
                        {feeTypePresets.map((preset) => (
                            <button key={preset.label} type="button" onClick={() => applyPreset(preset)} className="cursor-pointer rounded-full border border-gray-200 px-3 py-1 text-xs font-semibold text-gray-600 transition hover:border-primary-400 hover:bg-primary-100 hover:text-primary-500">{preset.label}</button>
                        ))}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <Label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">{t('feeTypeEditor.feeName.label')} <span className="text-red-500">*</span></Label>
                            <Input placeholder={t('feeTypeEditor.feeName.placeholder')} value={feeType.name} onChange={(e) => update('name', e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none transition focus:border-primary-500" />
                        </div>
                        <div>
                            <Label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">{t('feeTypeEditor.description.label')}</Label>
                            <Input placeholder={t('feeTypeEditor.description.placeholder')} value={feeType.description} onChange={(e) => update('description', e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none transition focus:border-primary-500" />
                        </div>
                    </div>

                    <div>
                        <Label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">{t('feeTypeEditor.totalAmount.label')} <span className="text-red-500">*</span></Label>
                        <Input type="number" placeholder={t('feeTypeEditor.totalAmount.placeholder')} value={feeType.amount} onChange={(e) => handleAmountChange(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold outline-none transition focus:border-primary-500" />
                    </div>

                    <div className="flex flex-wrap items-center gap-6">
                        <div className="flex items-center gap-2"><Toggle value={feeType.hasInstallment} onChange={(v) => update('hasInstallment', v)} /><span className="text-sm font-medium text-gray-700">{flexible ? tFlex('fee.splitToggle') : t('feeTypeEditor.hasInstallments')}</span></div>
                        <div className="flex items-center gap-2"><Toggle value={feeType.isRefundable} onChange={(v) => update('isRefundable', v)} /><span className="text-sm font-medium text-gray-700">{t('feeTypeEditor.refundable')}</span></div>
                        <div className="flex items-center gap-2"><Toggle value={feeType.hasPenalty} onChange={(v) => update('hasPenalty', v)} /><span className="text-sm font-medium text-gray-700">{t('feeTypeEditor.latePenalty')}</span></div>
                        {feeType.hasPenalty && (
                            <div className="flex items-center gap-1">
                                <Input type="number" placeholder={t('feeTypeEditor.penaltyPercentagePlaceholder')} value={feeType.penaltyPercentage} onChange={(e) => update('penaltyPercentage', e.target.value)} className="w-16 rounded-lg border border-gray-200 px-2 py-1 text-sm outline-none transition focus:border-primary-500" />
                                <span className="text-xs text-gray-500">%</span>
                            </div>
                        )}
                    </div>

                    {feeType.hasInstallment && !flexible && (
                        <div className="flex flex-col gap-3">
                            <div>
                                <Label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">{t('feeTypeEditor.paymentFrequency')}</Label>
                                <div className="flex flex-wrap gap-2">
                                    {installmentPresets.map((preset) => {
                                        const isActive = preset.count !== null && Number(feeType.noOfInstallments) === preset.count;
                                        return (
                                            <button key={preset.label} type="button" onClick={() => handlePreset(preset.count)} className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${isActive ? 'border-primary-500 bg-primary-100 text-primary-500' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                                                {preset.label}{preset.count && <span className="ml-1 opacity-60">({preset.count}x)</span>}
                                            </button>
                                        );
                                    })}
                                </div>
                                {![1, 2, 4, 12].includes(Number(feeType.noOfInstallments)) && (
                                    <Input type="number" min={1} max={60} placeholder={t('feeTypeEditor.installmentCountPlaceholder')} value={feeType.noOfInstallments} onChange={(e) => handleInstallmentCountChange(e.target.value)} className="mt-2 w-48 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none transition focus:border-primary-500" />
                                )}
                            </div>

                            <div className="overflow-hidden rounded-lg border border-gray-200">
                                {diff !== 0 && totalAmount > 0 && (
                                    <div className={`px-3 py-2 text-xs font-medium ${diff > 0 ? 'border-b border-amber-100 bg-amber-50 text-amber-700' : 'border-b border-red-100 bg-red-50 text-red-700'}`}>
                                        {diff > 0 ? t('feeTypeEditor.installmentTable.remaining', { amount: diff.toLocaleString('en-IN') }) : t('feeTypeEditor.installmentTable.exceeds', { amount: Math.abs(diff).toLocaleString('en-IN') })}
                                    </div>
                                )}
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-gray-100 bg-gray-50">
                                            <th className="px-3 py-2 text-start text-xs font-semibold uppercase text-gray-500">{t('feeTypeEditor.installmentTable.columns.number')}</th>
                                            <th className="px-3 py-2 text-start text-xs font-semibold uppercase text-gray-500">{t('feeTypeEditor.installmentTable.columns.amount')}</th>
                                            <th className="px-3 py-2 text-start text-xs font-semibold uppercase text-gray-500">{t('feeTypeEditor.installmentTable.columns.startDate')}</th>
                                            <th className="px-3 py-2 text-start text-xs font-semibold uppercase text-gray-500">{t('feeTypeEditor.installmentTable.columns.endDate')}</th>
                                            <th className="px-3 py-2 text-start text-xs font-semibold uppercase text-gray-500">{t('feeTypeEditor.installmentTable.columns.dueDate')}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {feeType.installments.map((inst, idx) => (
                                            <tr key={inst.id} className="border-b border-gray-50">
                                                <td className="w-10 px-3 py-2 font-medium text-gray-400">{idx + 1}</td>
                                                <td className="px-3 py-2"><Input type="number" value={inst.amount} onChange={(e) => updateInstallment(inst.id, 'amount', e.target.value)} className="w-28 rounded-md border border-gray-200 px-2 py-1 text-sm outline-none focus:border-primary-500" /></td>
                                                <td className="px-3 py-2"><Input type="date" value={inst.startDate ?? ''} onChange={(e) => updateInstallment(inst.id, 'startDate', e.target.value)} className="rounded-md border border-gray-200 px-2 py-1 text-sm outline-none focus:border-primary-500" /></td>
                                                <td className="px-3 py-2"><Input type="date" value={inst.endDate ?? ''} onChange={(e) => updateInstallment(inst.id, 'endDate', e.target.value)} className="rounded-md border border-gray-200 px-2 py-1 text-sm outline-none focus:border-primary-500" /></td>
                                                <td className="px-3 py-2"><Input type="date" value={inst.dueDate} onChange={(e) => updateInstallment(inst.id, 'dueDate', e.target.value)} className="rounded-md border border-gray-200 px-2 py-1 text-sm outline-none focus:border-primary-500" /></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot>
                                        <tr className="bg-gray-50">
                                            <td className="px-3 py-2 font-bold text-gray-700">{t('feeTypeEditor.installmentTable.total')}</td>
                                            <td className={`px-3 py-2 font-bold ${installmentTotal === totalAmount ? 'text-green-600' : 'text-gray-800'}`}>₹{installmentTotal.toLocaleString('en-IN')}</td>
                                            <td /><td /><td />
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

function ClassMultiSelect({ batchOptions, selectedIds, onToggle }: { batchOptions: BatchOption[]; selectedIds: string[]; onToggle: (id: string) => void }) {
    const { t } = useTranslation('settingsCpoPlanConfiguration');
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const selectedLabels = batchOptions.filter((opt) => selectedIds.includes(opt.id)).map((opt) => opt.label);
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
            <Label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">{t('classMultiSelect.label')} <span className="text-red-500">*</span></Label>
            <button type="button" onClick={toggleOpen} className="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-left text-sm outline-none transition focus:border-primary-500 focus:ring-1 focus:ring-primary-200">
                <span className={selectedIds.length === 0 ? 'text-gray-400' : 'text-gray-700'}>
                    {selectedIds.length === 0 ? t('classMultiSelect.placeholder') : selectedLabels.length <= 2 ? selectedLabels.join(', ') : t('classMultiSelect.selectedCount', { count: selectedLabels.length })}
                </span>
                <svg className={`h-4 w-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
            </button>
            {open && (
                <div className="absolute z-popover-above-modal mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg">
                    <div className="border-b border-gray-100 p-2">
                        <input
                            type="text"
                            autoFocus
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder={t('classMultiSelect.searchPlaceholder')}
                            className="w-full rounded-md border border-gray-200 px-2 py-1.5 text-sm outline-none transition focus:border-primary-500 focus:ring-1 focus:ring-primary-200"
                        />
                    </div>
                    <div className="max-h-48 overflow-y-auto">
                        {batchOptions.length === 0 && <p className="px-3 py-2 text-sm text-gray-400">{t('classMultiSelect.noClassesAvailable')}</p>}
                        {batchOptions.length > 0 && filteredOptions.length === 0 && <p className="px-3 py-2 text-sm text-gray-400">{t('classMultiSelect.noSearchResults')}</p>}
                        {filteredOptions.map((opt) => (
                            <label key={opt.id} className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm transition hover:bg-gray-50">
                                <input type="checkbox" checked={selectedIds.includes(opt.id)} onChange={() => onToggle(opt.id)} className="h-4 w-4 rounded border-gray-300 text-primary-500 focus:ring-primary-500" />
                                <span className="text-gray-700">{opt.label}</span>
                            </label>
                        ))}
                    </div>
                </div>
            )}
            {selectedIds.length > 0 && <p className="mt-1 text-xs text-gray-500">{t('classMultiSelect.selectedCount', { count: selectedIds.length })}</p>}
        </div>
    );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface CPOPlanConfigurationProps {
    planName: string;
    cpoForm: CPOForm;
    onChange: (form: CPOForm) => void;
}

export const CPOPlanConfiguration: React.FC<CPOPlanConfigurationProps> = ({ planName, cpoForm, onChange }) => {
    const { t } = useTranslation('settingsCpoPlanConfiguration');
    const instituteDetails = useInstituteDetailsStore((s) => s.instituteDetails);

    const batches = React.useMemo(() => instituteDetails?.batches_for_sessions ?? [], [instituteDetails]);

    const batchOptions: BatchOption[] = React.useMemo(() =>
        batches
            .filter((batch) => batch.is_parent === true || !batch.parent_id)
            .map((batch) => ({
                id: batch.id,
                label: `${batch.package_dto.package_name} – ${batch.level.level_name}${batch.name ? ` – ${batch.name}` : ''}`,
            })),
        [batches]
    );

    // Auto-select first batch if none selected
    useEffect(() => {
        if (cpoForm.packageSessionIds.length === 0 && batchOptions.length > 0) {
            onChange({ ...cpoForm, packageSessionIds: [batchOptions[0].id], packageSessionId: batchOptions[0].id });
        }
    }, [batchOptions]);

    // Sync plan name from step 1
    useEffect(() => {
        if (planName && cpoForm.name !== planName) {
            onChange({ ...cpoForm, name: planName });
        }
    }, [planName]);

    const toggleBatch = (id: string) => {
        const ids = cpoForm.packageSessionIds.includes(id)
            ? cpoForm.packageSessionIds.filter((i) => i !== id)
            : [...cpoForm.packageSessionIds, id];
        onChange({ ...cpoForm, packageSessionIds: ids, packageSessionId: ids[0] ?? '' });
    };

    const addFeeType = () => {
        const nextId = Math.max(...cpoForm.feeTypes.map((f) => f.id), 0) + 1;
        onChange({ ...cpoForm, feeTypes: [...cpoForm.feeTypes, createEmptyFeeType(nextId)] });
    };

    const removeFeeType = (id: number) => {
        onChange({ ...cpoForm, feeTypes: cpoForm.feeTypes.filter((f) => f.id !== id) });
    };

    const updateFeeType = (id: number, updated: FeeTypeForm) => {
        onChange({ ...cpoForm, feeTypes: cpoForm.feeTypes.map((f) => (f.id === id ? updated : f)) });
    };

    const totalPackageAmount = cpoForm.feeTypes.reduce((sum, ft) => sum + (parseFloat(ft.amount as string) || 0), 0);

    return (
        <div className="flex flex-col gap-5">
            {/* Summary Bar */}
            {cpoForm.feeTypes.length > 0 && (
                <div className="flex items-center gap-6 rounded-xl border border-primary-100 bg-primary-50 px-4 py-3">
                    <div className="flex items-center gap-x-2">
                        <div className="text-sm font-bold uppercase tracking-wider text-primary-500">{t('summary.feeTypes')}</div>
                        <div className="text-lg font-extrabold text-primary-500">{cpoForm.feeTypes.length}</div>
                    </div>
                    <div className="h-8 w-px bg-primary-200" />
                    <div className="flex items-center gap-x-2">
                        <div className="text-sm font-bold uppercase tracking-wider text-primary-500">{t('summary.totalAmount')}</div>
                        <div className="text-lg font-extrabold text-primary-500">₹{totalPackageAmount.toLocaleString('en-IN')}</div>
                    </div>
                </div>
            )}

            <ClassMultiSelect batchOptions={batchOptions} selectedIds={cpoForm.packageSessionIds} onToggle={toggleBatch} />

            <div>
                <Label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">{t('status.label')}</Label>
                <Select value={cpoForm.status} onValueChange={(value) => onChange({ ...cpoForm, status: value })}>
                    <SelectTrigger className="w-40 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-primary-500">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-popover-above-modal">
                        <SelectItem value="ACTIVE">{t('status.active')}</SelectItem>
                        <SelectItem value="DRAFT">{t('status.draft')}</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {/* Fixed dates vs chosen for each learner at enrollment */}
            <FlexibleScheduleSettings form={cpoForm} onChange={(patch) => onChange({ ...cpoForm, ...patch })} />

            <div>
                <div className="mb-3 flex items-center justify-between">
                    <Label className="text-sm font-bold text-gray-800">{t('feeTypesSection.title')}</Label>
                    <button type="button" onClick={addFeeType} className="flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-primary-500 transition hover:bg-primary-100">
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
                        {t('feeTypesSection.addFeeType')}
                    </button>
                </div>
                <div className="flex flex-col gap-3">
                    {cpoForm.feeTypes.map((ft, idx) => (
                        <FeeTypeEditor key={ft.id} feeType={ft} index={idx} onChange={(updated) => updateFeeType(ft.id, updated)} onRemove={() => removeFeeType(ft.id)} canRemove={cpoForm.feeTypes.length > 1} flexible={cpoForm.scheduleMode === 'FLEXIBLE'} />
                    ))}
                </div>
            </div>
        </div>
    );
};
