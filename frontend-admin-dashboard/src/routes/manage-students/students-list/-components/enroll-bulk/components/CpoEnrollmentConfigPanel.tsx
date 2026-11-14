import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCPOFullDetails } from '@/routes/financial-management/fee-plans/-services/cpo-service';
import type {
    CPOFeeType,
    CPOInstallment,
} from '@/routes/financial-management/fee-plans/-types/cpo-types';
import type {
    CpoEnrollmentConfig,
    InstallmentOverride,
    ScheduleDiscountSplit,
} from '@/routes/manage-students/students-list/-types/bulk-assign-types';
import type {
    DiscountSpec,
    DiscountType,
} from '@/routes/manage-students/students-list/-types/cpo-side-view-types';
import {
    MAX_INSTALLMENTS,
    discountAmount,
    initialSchedule,
    partsFromFeeTypes,
    rowsFromRule,
    spreadDiscount,
    validateSchedule,
    type SchedulePart,
} from '@/routes/manage-students/students-list/-utils/installment-schedule';
import { InstallmentScheduleEditor } from './InstallmentScheduleEditor';
import { OfflinePaymentFields } from '@/components/common/payments/OfflinePaymentFields';
import type { NumberingTarget } from '@/services/numbering-field';

interface InstallmentRow {
    id: string; // aft_installment id (matches SFP.iId)
    feeTypeName: string;
    installmentNumber: number;
    amount: number;
    dueDate: string | null;
    startDate: string | null;
}

interface Props {
    cpoId: string | null;
    /**
     * Set instead of `cpoId` when a course sold at a one-time price is being paid in
     * installments: there is no fee plan yet (the backend builds a hidden one), so the
     * panel splits this price and always uses a custom schedule.
     */
    oneTimePrice?: { amount: number; currency?: string | null } | null;
    value: CpoEnrollmentConfig | undefined;
    onChange: (next: CpoEnrollmentConfig) => void;
    /** Reports a schedule problem (translated) so the wizard can block Preview; null when fine. */
    onScheduleErrorChange?: (message: string | null) => void;
    /** Reports what blocks the offline payment details (translated); null when fine. */
    onPaymentErrorChange?: (message: string | null) => void;
    /** Learner being enrolled, for the numbering-series field (e.g. branch); see OfflinePaymentFields. */
    numbering?: NumberingTarget | null;
}

const flattenInstallments = (feeTypes: CPOFeeType[] | undefined): InstallmentRow[] => {
    if (!Array.isArray(feeTypes)) return [];
    const rows: InstallmentRow[] = [];
    for (const ft of feeTypes) {
        const afv = ft.assigned_fee_value;
        if (!afv) continue;
        const installments: CPOInstallment[] = afv.installments ?? [];
        if (installments.length === 0) {
            // Lump-sum AFV synthesizes a single virtual row keyed off the AFV id.
            // The SFP row for a one-off fee carries i_id = null (it has no
            // AftInstallment), so CpoEnrollmentConfigApplier resolves this id
            // against asv_id instead — see the lump-sum alias map there. Do not
            // switch this to an installment id: there isn't one.
            rows.push({
                id: afv.id,
                feeTypeName: ft.name,
                installmentNumber: 1,
                amount: Number(afv.amount ?? 0),
                dueDate: null,
                startDate: null,
            });
            continue;
        }
        for (const inst of installments) {
            rows.push({
                id: inst.id,
                feeTypeName: ft.name,
                installmentNumber: inst.installment_number,
                amount: Number(inst.amount ?? 0),
                dueDate: inst.due_date ?? null,
                startDate: inst.start_date ?? null,
            });
        }
    }
    return rows;
};

const fmt = (n: number) =>
    Number.isFinite(n) ? `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '—';

const isoDate = (s: string | null | undefined) => {
    if (!s) return '';
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return '';
    // <input type="date"> wants YYYY-MM-DD
    return d.toISOString().slice(0, 10);
};

const computeDiscountAmount = (base: number, d: DiscountSpec | null | undefined): number => {
    if (!d) return 0;
    if (d.type === 'PERCENTAGE') return (base * (d.value || 0)) / 100;
    return d.value || 0;
};

const blank: CpoEnrollmentConfig = {
    installment_overrides: [],
    cpo_discount: null,
    payment_mode: 'SKIP',
    payment_amount: null,
    payment_reference: null,
};

/**
 * Editor that produces a {@link CpoEnrollmentConfig} for one assignment.
 * Renders the CPO template installments with editable start/due/amount/discount,
 * plus a whole-CPO discount control and the existing offline-payment toggle.
 *
 * <p>Output is sent to the backend on the `cpo_config` field of an
 * {@link AssignmentItem} and supersedes the legacy `cpo_payment_*` fields.
 */
export const CpoEnrollmentConfigPanel = ({
    cpoId,
    oneTimePrice,
    value,
    onChange,
    onScheduleErrorChange,
    onPaymentErrorChange,
    numbering,
}: Props) => {
    const { t } = useTranslation('manageStudentsCpoEnrollmentConfigPanel');
    const { data, isLoading, isError } = useCPOFullDetails(cpoId, !!cpoId);
    const installments = useMemo(() => flattenInstallments(data?.fee_types), [data]);

    const cfg = value ?? blank;

    // ---- Learner-specific schedule (docs/CPO_FLEXIBLE_INSTALLMENTS.md) ----
    const isFlexible = data?.schedule_mode === 'FLEXIBLE';
    // A flexible plan has no fixed dates and a one-time price has no plan at all, so both
    // always use a custom schedule; a fixed plan offers it as an alternative.
    const customForced = isFlexible || !!oneTimePrice;
    const customSchedule = cfg.installment_schedule ?? null;
    const isCustom = customSchedule != null;
    const scheduleParts: SchedulePart[] = useMemo(
        () =>
            oneTimePrice
                ? [
                      {
                          feeTypeName: t('schedule.courseFee'),
                          total: oneTimePrice.amount,
                          split: true,
                      },
                  ]
                : partsFromFeeTypes(data?.fee_types),
        [oneTimePrice, data, t]
    );
    const maxCount = data?.flexible_defaults?.max_count ?? MAX_INSTALLMENTS;
    const templateCount = useMemo(
        () => installments.reduce((m, r) => Math.max(m, r.installmentNumber), 0),
        [installments]
    );
    const selectCustomSchedule = () =>
        onChange({
            ...cfg,
            installment_overrides: [],
            installment_schedule: initialSchedule(data?.flexible_defaults, templateCount),
        });
    const selectPlanSchedule = () => onChange({ ...cfg, installment_schedule: null });

    useEffect(() => {
        if (customForced && !isCustom && (oneTimePrice || data)) selectCustomSchedule();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [customForced, isCustom, oneTimePrice, data]);

    const scheduleError = useMemo(
        () => (isCustom ? validateSchedule(customSchedule, scheduleParts, maxCount) : null),
        [isCustom, customSchedule, scheduleParts, maxCount]
    );
    const scheduleErrorText = scheduleError ? t(scheduleError.key, scheduleError.params) : null;
    // Report only real changes: the parent's update merges into the props it rendered with,
    // so a redundant report in the same tick as another update would overwrite that update.
    const reportedError = useRef<string | null>(null);
    // A different plan starts from "nothing reported": the wizard clears the error when the
    // invite changes, so the same text on the new plan must be reported again.
    useEffect(() => {
        reportedError.current = null;
    }, [cpoId, oneTimePrice?.amount]);
    useEffect(() => {
        if (reportedError.current === scheduleErrorText) return;
        reportedError.current = scheduleErrorText;
        onScheduleErrorChange?.(scheduleErrorText);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scheduleErrorText]);
    const overridesById = useMemo(() => {
        const m = new Map<string, InstallmentOverride>();
        for (const ov of cfg.installment_overrides ?? []) m.set(ov.aft_installment_id, ov);
        return m;
    }, [cfg.installment_overrides]);

    // Derived totals after overrides + CPO-level discount
    const templateGross = useMemo(
        () => installments.reduce((sum, r) => sum + r.amount, 0),
        [installments]
    );
    const scheduleGross = useMemo(
        () => scheduleParts.reduce((sum, p) => sum + p.total, 0),
        [scheduleParts]
    );
    const grossTotal = isCustom ? scheduleGross : templateGross;
    /**
     * Per-row effective amount after applying installment overrides + CPO-level
     * discount (proportional share for PERCENTAGE; weighted-by-row-amount share
     * for FLAT). Mirrors the backend recompute so the UI shows what each row
     * will actually be billed at after Save.
     */
    const breakdown = useMemo(() => {
        // Step 1: per-row amount after manual override OR per-installment discount
        const postOverride: Array<{ id: string; amount: number }> = installments.map((r) => {
            const ov = overridesById.get(r.id);
            const amt =
                ov?.amount != null
                    ? ov.amount
                    : r.amount - computeDiscountAmount(r.amount, ov?.discount);
            return { id: r.id, amount: Math.max(0, amt) };
        });
        const postOverrideSum = postOverride.reduce((s, x) => s + x.amount, 0);

        // Step 2: CPO-level discount
        const cpoDiscountAmt = cfg.cpo_discount
            ? cfg.cpo_discount.type === 'PERCENTAGE'
                ? (postOverrideSum * (cfg.cpo_discount.value || 0)) / 100
                : Math.min(postOverrideSum, cfg.cpo_discount.value || 0)
            : 0;

        // Step 3: distribute CPO discount proportionally; last row absorbs rounding drift
        const effectiveByRow = new Map<string, number>();
        let allocated = 0;
        const lastIdx = postOverride.length - 1;
        postOverride.forEach((row, i) => {
            let share = 0;
            if (postOverrideSum > 0 && cpoDiscountAmt > 0) {
                if (i === lastIdx) {
                    share = cpoDiscountAmt - allocated;
                } else {
                    share = (row.amount / postOverrideSum) * cpoDiscountAmt;
                    allocated += share;
                }
            }
            effectiveByRow.set(row.id, Math.max(0, row.amount - share));
        });

        return {
            postOverride: postOverrideSum,
            net: Math.max(0, postOverrideSum - cpoDiscountAmt),
            cpoDiscountAmt,
            effectiveByRow,
        };
    }, [installments, overridesById, cfg.cpo_discount]);
    // With a custom schedule the discount is split over the installments row by row (each
    // row carries its own discount, which is exactly what gets billed). EVEN / FIRST / LAST
    // re-split it whenever the discount, the split or the number of installments changes;
    // editing an amount or what the learner pays keeps every row's discount.
    const scheduleSplit: ScheduleDiscountSplit = customSchedule?.discount_split ?? 'EVEN';
    const splitPartsOnly = useMemo(() => scheduleParts.filter((p) => p.split), [scheduleParts]);
    const scheduleAmountsEditable = splitPartsOnly.length === 1;
    const generatedRows = useMemo(
        () => (customSchedule ? rowsFromRule(customSchedule, splitPartsOnly) : []),
        [customSchedule, splitPartsOnly]
    );
    const scheduleRows = customSchedule?.rows ?? generatedRows;
    const rowDiscountSum =
        Math.round(scheduleRows.reduce((s, r) => s + (r.discount ?? 0), 0) * 100) / 100;
    const wantedDiscount = isCustom ? discountAmount(cfg.cpo_discount, scheduleGross) : 0;
    const scheduleTotals = useMemo(
        () => ({
            net: Math.max(0, scheduleGross - rowDiscountSum),
            cpoDiscountAmt: rowDiscountSum,
        }),
        [scheduleGross, rowDiscountSum]
    );
    useEffect(() => {
        if (!customSchedule) return;
        // Custom amounts are the admin's own, until the discount is removed altogether.
        if (scheduleSplit === 'CUSTOM' && cfg.cpo_discount) return;
        const base = customSchedule.rows ?? generatedRows;
        if (base.length === 0) return;
        const gross = base.map((r, k) => r.amount ?? generatedRows[k]?.amount ?? 0);
        const want =
            wantedDiscount > 0
                ? spreadDiscount(
                      gross,
                      wantedDiscount,
                      scheduleSplit === 'CUSTOM' ? 'EVEN' : scheduleSplit
                  )
                : gross.map(() => 0);
        const same = base.every(
            (r, k) => Math.round((r.discount ?? 0) * 100) === Math.round((want[k] ?? 0) * 100)
        );
        if (same) return;
        onChange({
            ...cfg,
            installment_schedule: {
                ...customSchedule,
                rows: base.map((r, k) => ({
                    due_date: r.due_date,
                    amount: scheduleAmountsEditable ? r.amount ?? null : null,
                    discount: want[k] || null,
                })),
            },
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        wantedDiscount,
        scheduleSplit,
        scheduleRows.length,
        customSchedule?.rows == null,
        !!cfg.cpo_discount,
    ]);
    const setScheduleSplit = (split: ScheduleDiscountSplit) => {
        if (!customSchedule) return;
        onChange({ ...cfg, installment_schedule: { ...customSchedule, discount_split: split } });
    };
    const totals = isCustom ? scheduleTotals : breakdown;
    /**
     * What falls due first, after discount: the usual amount collected at enrollment, so it
     * prefills the offline payment. Custom schedule: installment 1 plus the fees paid upfront
     * on its date. Plan schedule: the rows with the earliest due date plus one-off fees.
     */
    const firstDueNet = useMemo(() => {
        if (customSchedule) {
            const first = scheduleRows[0];
            if (!first) return totals.net;
            const net =
                (first.amount ?? generatedRows[0]?.amount ?? 0) -
                (first.discount ?? 0) +
                scheduleParts.filter((p) => !p.split).reduce((s, p) => s + p.total, 0);
            return Math.round(net * 100) / 100;
        }
        const dueOf = (r: InstallmentRow) =>
            (overridesById.get(r.id)?.due_date ?? r.dueDate)?.slice(0, 10) ?? null;
        const dated = installments.map(dueOf).filter((d): d is string => d != null);
        const earliest = dated.length > 0 ? dated.reduce((a, b) => (b < a ? b : a)) : null;
        const minNumber = installments.reduce((m, r) => Math.min(m, r.installmentNumber), Infinity);
        const sum = installments
            .filter((r) => {
                const due = dueOf(r);
                return earliest
                    ? due == null || due === earliest
                    : r.installmentNumber === minNumber;
            })
            .reduce((s, r) => s + (breakdown.effectiveByRow.get(r.id) ?? r.amount), 0);
        return sum > 0 ? Math.round(sum * 100) / 100 : totals.net;
    }, [
        customSchedule,
        scheduleParts,
        scheduleRows,
        generatedRows,
        installments,
        overridesById,
        breakdown,
        totals.net,
    ]);

    // Helpers ----------------------------------------------------------------

    const replaceOverride = (next: InstallmentOverride[]) =>
        onChange({ ...cfg, installment_overrides: next });

    const updateRow = (aftId: string, patch: Partial<InstallmentOverride>) => {
        const list = cfg.installment_overrides ?? [];
        const existing = list.find((o) => o.aft_installment_id === aftId);
        const merged: InstallmentOverride = {
            aft_installment_id: aftId,
            start_date: existing?.start_date ?? null,
            due_date: existing?.due_date ?? null,
            amount: existing?.amount ?? null,
            discount: existing?.discount ?? null,
            ...patch,
        };
        // Drop the override entirely if every field is null/empty — keeps the payload tidy.
        const isEmpty =
            (merged.start_date == null || merged.start_date === '') &&
            (merged.due_date == null || merged.due_date === '') &&
            (merged.amount == null || Number.isNaN(merged.amount)) &&
            !merged.discount;
        if (isEmpty) {
            replaceOverride(list.filter((o) => o.aft_installment_id !== aftId));
            return;
        }
        if (existing) {
            replaceOverride(list.map((o) => (o.aft_installment_id === aftId ? merged : o)));
        } else {
            replaceOverride([...list, merged]);
        }
    };

    const setCpoDiscount = (d: DiscountSpec | null) => onChange({ ...cfg, cpo_discount: d });

    const setPayment = (patch: Partial<CpoEnrollmentConfig>) => onChange({ ...cfg, ...patch });

    // While the amount is still the prefill, keep it in step with the schedule (e.g. the
    // admin raises installment 1 after choosing "record a payment"). A typed amount stays.
    const prefilledAmount = useRef<number | null>(null);
    useEffect(() => {
        if (cfg.payment_mode !== 'OFFLINE') return;
        if (cfg.payment_amount === firstDueNet) {
            prefilledAmount.current = firstDueNet;
            return;
        }
        if (prefilledAmount.current != null && cfg.payment_amount === prefilledAmount.current) {
            prefilledAmount.current = firstDueNet;
            setPayment({ payment_amount: firstDueNet });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [firstDueNet, cfg.payment_mode, cfg.payment_amount]);

    // Local string state for amount input so blank entries stay blank
    const [paymentInput, setPaymentInput] = useState<string>(
        cfg.payment_amount != null ? String(cfg.payment_amount) : ''
    );
    useEffect(() => {
        setPaymentInput(cfg.payment_amount != null ? String(cfg.payment_amount) : '');
    }, [cfg.payment_amount]);

    if (!cpoId && !oneTimePrice) return null;

    const discountBox = (
        <div className="mb-3 rounded-md border border-neutral-200 bg-white p-2.5">
            <p className="mb-2 text-2xs font-semibold uppercase tracking-wide text-neutral-500">
                {t('cpoDiscount.heading')}
            </p>
            <div className="flex flex-wrap items-end gap-2">
                <div>
                    <label className="block text-2xs text-neutral-500">
                        {t('cpoDiscount.typeLabel')}
                    </label>
                    <select
                        value={cfg.cpo_discount?.type ?? ''}
                        onChange={(e) => {
                            const nextType = e.target.value as DiscountType | '';
                            if (!nextType) setCpoDiscount(null);
                            else
                                setCpoDiscount({
                                    type: nextType,
                                    value: cfg.cpo_discount?.value ?? 0,
                                    reason: cfg.cpo_discount?.reason ?? null,
                                });
                        }}
                        className="rounded border border-neutral-200 px-2 py-1 text-2xs"
                    >
                        <option value="">{t('cpoDiscount.options.none')}</option>
                        <option value="PERCENTAGE">{t('cpoDiscount.options.percentage')}</option>
                        <option value="FLAT">{t('cpoDiscount.options.flat')}</option>
                    </select>
                </div>
                <div>
                    <label className="block text-2xs text-neutral-500">
                        {t('cpoDiscount.valueLabel')}
                    </label>
                    <input
                        type="number"
                        step="any"
                        min={0}
                        disabled={!cfg.cpo_discount || (isCustom && scheduleSplit === 'CUSTOM')}
                        // Render falsy / 0 as empty — avoids the "05" effect when
                        // the value defaults to 0 on type selection.
                        value={
                            isCustom && scheduleSplit === 'CUSTOM'
                                ? rowDiscountSum
                                : !cfg.cpo_discount?.value
                                  ? ''
                                  : cfg.cpo_discount.value
                        }
                        onChange={(e) =>
                            setCpoDiscount(
                                cfg.cpo_discount
                                    ? {
                                          ...cfg.cpo_discount,
                                          value: Number(e.target.value || 0),
                                      }
                                    : null
                            )
                        }
                        className="w-24 rounded border border-neutral-200 px-2 py-1 text-2xs disabled:bg-neutral-50"
                    />
                </div>
                <div className="min-w-40 flex-1">
                    <label className="block text-2xs text-neutral-500">
                        {t('cpoDiscount.reasonLabel')}
                    </label>
                    <input
                        type="text"
                        disabled={!cfg.cpo_discount}
                        placeholder={t('cpoDiscount.reasonPlaceholder')}
                        value={cfg.cpo_discount?.reason ?? ''}
                        onChange={(e) =>
                            setCpoDiscount(
                                cfg.cpo_discount
                                    ? { ...cfg.cpo_discount, reason: e.target.value }
                                    : null
                            )
                        }
                        className="w-full rounded border border-neutral-200 px-2 py-1 text-2xs disabled:bg-neutral-50"
                    />
                </div>
                <span className="text-2xs text-neutral-600">
                    {t('cpoDiscount.offSuffix', { amount: fmt(totals.cpoDiscountAmt) })}
                </span>
            </div>
            {isCustom && cfg.cpo_discount && (
                <div className="mt-2">
                    <p className="mb-1 text-2xs text-neutral-500">{t('cpoDiscount.splitLabel')}</p>
                    <div
                        role="radiogroup"
                        aria-label={t('cpoDiscount.splitLabel')}
                        className="flex flex-wrap gap-1.5"
                    >
                        {(['EVEN', 'FIRST', 'LAST', 'CUSTOM'] as ScheduleDiscountSplit[]).map(
                            (sp) => (
                                <button
                                    key={sp}
                                    type="button"
                                    role="radio"
                                    aria-checked={scheduleSplit === sp}
                                    onClick={() => setScheduleSplit(sp)}
                                    className={`rounded-full border px-2.5 py-0.5 text-2xs font-medium ${
                                        scheduleSplit === sp
                                            ? 'border-primary-400 bg-primary-50 text-primary-700'
                                            : 'border-neutral-200 bg-white text-neutral-600'
                                    }`}
                                >
                                    {t(`cpoDiscount.split.${sp}`)}
                                </button>
                            )
                        )}
                    </div>
                    <p className="mt-1 text-2xs text-neutral-500">
                        {t(`cpoDiscount.splitHint.${scheduleSplit}`)}
                    </p>
                    {scheduleSplit !== 'CUSTOM' &&
                        Math.round(wantedDiscount * 100) > Math.round(rowDiscountSum * 100) + 1 &&
                        rowDiscountSum > 0 && (
                            <p className="mt-1 text-2xs text-warning-700">
                                {t('cpoDiscount.cappedToInstallments', {
                                    amount: fmt(rowDiscountSum),
                                })}
                            </p>
                        )}
                </div>
            )}
        </div>
    );

    return (
        <div className="mt-3 rounded-lg border border-orange-200 bg-orange-50/40 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-2xs font-semibold uppercase tracking-wide text-orange-700">
                    {t('header.title')}
                </p>
                <span className="text-2xs text-neutral-600">
                    {t('header.totalLabel')}{' '}
                    <span className="font-semibold text-neutral-800">{fmt(grossTotal)}</span>
                    {' · '}
                    {t('header.afterDiscountLabel')}{' '}
                    <span className="font-semibold text-orange-800">{fmt(totals.net)}</span>
                </span>
            </div>

            {!customForced && installments.length > 0 && (
                <div
                    role="radiogroup"
                    aria-label={t('schedule.modeLabel')}
                    className="mb-2 flex flex-wrap gap-1.5"
                >
                    <button
                        type="button"
                        role="radio"
                        aria-checked={!isCustom}
                        onClick={selectPlanSchedule}
                        className={`rounded-full border px-2.5 py-0.5 text-2xs font-medium ${
                            !isCustom
                                ? 'border-primary-400 bg-primary-50 text-primary-700'
                                : 'border-neutral-200 bg-white text-neutral-600'
                        }`}
                    >
                        {t('schedule.usePlan')}
                    </button>
                    <button
                        type="button"
                        role="radio"
                        aria-checked={isCustom}
                        onClick={() => !isCustom && selectCustomSchedule()}
                        className={`rounded-full border px-2.5 py-0.5 text-2xs font-medium ${
                            isCustom
                                ? 'border-primary-400 bg-primary-50 text-primary-700'
                                : 'border-neutral-200 bg-white text-neutral-600'
                        }`}
                    >
                        {t('schedule.useCustom')}
                    </button>
                </div>
            )}
            {customForced && (
                <p className="mb-2 text-2xs text-neutral-600">
                    {oneTimePrice ? t('schedule.oneTimeIntro') : t('schedule.flexibleIntro')}
                </p>
            )}

            {isLoading && (
                <p className="py-2 text-center text-2xs text-neutral-500">{t('loading')}</p>
            )}
            {isError && <p className="py-2 text-center text-2xs text-red-600">{t('loadError')}</p>}

            {isCustom && discountBox}

            {isCustom && customSchedule && (
                <InstallmentScheduleEditor
                    schedule={customSchedule}
                    parts={scheduleParts}
                    maxCount={maxCount}
                    discountActive={!!cfg.cpo_discount}
                    split={scheduleSplit}
                    error={scheduleError}
                    onChange={(next) => onChange({ ...cfg, installment_schedule: next })}
                />
            )}

            {/* Installments table with editable cells */}
            {!isCustom && installments.length > 0 && (
                <div className="mb-3 max-h-64 overflow-y-auto rounded border border-orange-100 bg-white">
                    <table className="w-full text-start text-2xs">
                        <thead className="sticky top-0 bg-orange-50 text-2xs uppercase text-neutral-500">
                            <tr>
                                <th className="px-2 py-1 font-medium">{t('table.index')}</th>
                                <th className="px-2 py-1 font-medium">{t('table.feeType')}</th>
                                <th className="px-2 py-1 font-medium">{t('table.startDate')}</th>
                                <th className="px-2 py-1 font-medium">{t('table.dueDate')}</th>
                                <th className="px-2 py-1 text-end font-medium">
                                    {t('table.default')}
                                </th>
                                <th className="px-2 py-1 text-end font-medium">
                                    {t('table.amount')}
                                </th>
                                <th className="px-2 py-1 font-medium">{t('table.discount')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-orange-50">
                            {installments.map((row) => {
                                const ov = overridesById.get(row.id);
                                const startVal = ov?.start_date ?? row.startDate ?? '';
                                const dueVal = ov?.due_date ?? row.dueDate ?? '';
                                const amtVal = ov?.amount ?? '';
                                const discType = ov?.discount?.type ?? '';
                                const discValue = ov?.discount?.value ?? '';
                                // Effective amount this row will be billed at if no manual
                                // amount override is set: template − per-row discount − share
                                // of CPO discount. Used as placeholder so admins can see the
                                // post-discount figure without having to type it.
                                const effective =
                                    breakdown.effectiveByRow.get(row.id) ?? row.amount;
                                return (
                                    <tr key={row.id}>
                                        <td className="px-2 py-1 align-middle">
                                            {row.installmentNumber}
                                        </td>
                                        <td className="px-2 py-1 align-middle">
                                            {row.feeTypeName}
                                        </td>
                                        <td className="px-2 py-1 align-middle">
                                            <input
                                                type="date"
                                                value={isoDate(
                                                    typeof startVal === 'string' ? startVal : null
                                                )}
                                                onChange={(e) =>
                                                    updateRow(row.id, {
                                                        start_date: e.target.value || null,
                                                    })
                                                }
                                                className="w-28 rounded border border-neutral-200 px-1 py-0.5 text-2xs outline-none focus:border-primary-300"
                                            />
                                        </td>
                                        <td className="px-2 py-1 align-middle">
                                            <input
                                                type="date"
                                                value={isoDate(
                                                    typeof dueVal === 'string' ? dueVal : null
                                                )}
                                                onChange={(e) =>
                                                    updateRow(row.id, {
                                                        due_date: e.target.value || null,
                                                    })
                                                }
                                                className="w-28 rounded border border-neutral-200 px-1 py-0.5 text-2xs outline-none focus:border-primary-300"
                                            />
                                        </td>
                                        <td className="px-2 py-1 text-right align-middle text-neutral-500">
                                            {fmt(row.amount)}
                                        </td>
                                        <td className="px-2 py-1 text-end align-middle">
                                            <input
                                                type="number"
                                                step="any"
                                                min={0}
                                                placeholder={effective.toFixed(2)}
                                                title={
                                                    ov?.amount != null
                                                        ? t('table.amountOverrideTitle')
                                                        : t('table.effectiveTitle', {
                                                              effective: fmt(effective),
                                                              template: fmt(row.amount),
                                                          })
                                                }
                                                // Render 0/falsy as empty so typing into a
                                                // pre-zero field doesn't produce "0<digits>".
                                                value={!amtVal ? '' : amtVal}
                                                onChange={(e) => {
                                                    const v = e.target.value;
                                                    updateRow(row.id, {
                                                        amount: v === '' ? null : Number(v),
                                                    });
                                                }}
                                                className={`w-20 rounded border px-1 py-0.5 text-end text-2xs outline-none focus:border-primary-300 ${
                                                    ov?.amount != null
                                                        ? 'border-primary-300 font-medium'
                                                        : 'border-neutral-200'
                                                }`}
                                            />
                                        </td>
                                        <td className="px-2 py-1 align-middle">
                                            <div className="flex items-center gap-1">
                                                <select
                                                    value={discType}
                                                    onChange={(e) => {
                                                        const nextType = e.target.value as
                                                            | DiscountType
                                                            | '';
                                                        if (!nextType) {
                                                            updateRow(row.id, { discount: null });
                                                        } else {
                                                            updateRow(row.id, {
                                                                discount: {
                                                                    type: nextType,
                                                                    value:
                                                                        typeof discValue ===
                                                                        'number'
                                                                            ? discValue
                                                                            : 0,
                                                                    reason:
                                                                        ov?.discount?.reason ??
                                                                        null,
                                                                },
                                                            });
                                                        }
                                                    }}
                                                    className="rounded border border-neutral-200 px-1 py-0.5 text-2xs outline-none"
                                                >
                                                    <option value="">
                                                        {t('table.discountOptions.none')}
                                                    </option>
                                                    <option value="PERCENTAGE">
                                                        {t('table.discountOptions.percentage')}
                                                    </option>
                                                    <option value="FLAT">
                                                        {t('table.discountOptions.flat')}
                                                    </option>
                                                </select>
                                                <input
                                                    type="number"
                                                    step="any"
                                                    min={0}
                                                    disabled={!discType}
                                                    placeholder="0"
                                                    // Render falsy / 0 as empty so the input doesn't
                                                    // pre-fill with "0" — otherwise typing "5" appends
                                                    // to it and the field briefly reads "05".
                                                    value={!discValue ? '' : discValue}
                                                    onChange={(e) => {
                                                        const v = e.target.value;
                                                        const num = v === '' ? 0 : Number(v);
                                                        updateRow(row.id, {
                                                            discount: discType
                                                                ? {
                                                                      type:
                                                                          (discType as DiscountType) ||
                                                                          'FLAT',
                                                                      value: num,
                                                                      reason:
                                                                          ov?.discount?.reason ??
                                                                          null,
                                                                  }
                                                                : null,
                                                        });
                                                    }}
                                                    className="w-16 rounded border border-neutral-200 px-1 py-0.5 text-end text-2xs outline-none focus:border-primary-300 disabled:bg-neutral-50"
                                                />
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {/* CPO-level discount (above the schedule when it is a custom one) */}
            {!isCustom && discountBox}

            {/* Initial offline payment */}
            <div className="rounded-md border border-neutral-200 bg-white p-2.5">
                <p className="mb-2 text-2xs font-semibold uppercase tracking-wide text-neutral-500">
                    {t('payment.heading')}
                </p>
                <div className="mb-2 flex flex-col gap-1.5 text-2xs text-neutral-700">
                    <label className="flex cursor-pointer items-center gap-2">
                        <input
                            type="radio"
                            name={`cpo-cfg-mode-${cpoId ?? 'one-time'}`}
                            checked={(cfg.payment_mode ?? 'SKIP') === 'SKIP'}
                            onChange={() =>
                                setPayment({ payment_mode: 'SKIP', payment_amount: null })
                            }
                            className="h-3.5 w-3.5"
                        />
                        <span>
                            <strong>{t('payment.skipLabelBold')}</strong>{' '}
                            {t('payment.skipLabelRest')}
                        </span>
                    </label>
                    <label className="flex cursor-pointer items-center gap-2">
                        <input
                            type="radio"
                            name={`cpo-cfg-mode-${cpoId ?? 'one-time'}`}
                            checked={cfg.payment_mode === 'OFFLINE'}
                            onChange={() =>
                                setPayment({
                                    payment_mode: 'OFFLINE',
                                    payment_amount:
                                        cfg.payment_amount && cfg.payment_amount > 0
                                            ? cfg.payment_amount
                                            : firstDueNet,
                                })
                            }
                            className="h-3.5 w-3.5"
                        />
                        <span>
                            <strong>{t('payment.offlineLabelBold')}</strong>{' '}
                            {t('payment.offlineLabelRest')}
                        </span>
                    </label>
                </div>
                {cfg.payment_mode === 'OFFLINE' && (
                    // items-start so the two labels line up at the top regardless
                    // of the per-column helper text (the "Net dues" hint under Amount
                    // would otherwise push Reference's input down with items-end).
                    <div className="flex flex-wrap items-start gap-3">
                        <div className="min-w-36 flex-1">
                            <label className="mb-1 block text-2xs font-medium text-neutral-500">
                                {t('payment.amountLabel')}
                            </label>
                            <input
                                type="number"
                                step="any"
                                value={paymentInput}
                                onChange={(e) => {
                                    const v = e.target.value;
                                    setPaymentInput(v);
                                    setPayment({ payment_amount: v === '' ? null : Number(v) });
                                }}
                                onFocus={(e) => e.currentTarget.select()}
                                className="w-full rounded border border-neutral-200 px-2 py-1 text-xs outline-none focus:border-primary-300"
                            />
                            <p className="mt-1 text-2xs text-neutral-500">
                                {t('payment.firstDue', { amount: fmt(firstDueNet) })} ·{' '}
                                {t('payment.netDues', { amount: fmt(totals.net) })}
                            </p>
                        </div>
                        {/* How it was paid: mode, option (e.g. PhonePe), reference, proof. */}
                        <div className="w-full">
                            <OfflinePaymentFields
                                compact
                                value={cfg.payment_details ?? {}}
                                onChange={(v) => setPayment({ payment_details: v })}
                                numbering={numbering}
                                onErrorChange={onPaymentErrorChange}
                            />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
