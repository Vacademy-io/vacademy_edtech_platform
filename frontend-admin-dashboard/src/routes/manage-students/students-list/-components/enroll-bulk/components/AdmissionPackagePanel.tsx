import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Package } from '@phosphor-icons/react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { OfflinePaymentFields } from '@/components/common/payments/OfflinePaymentFields';
import type { NumberingTarget } from '@/services/numbering-field';
import type {
    AdmissionPackageRequest,
    AdmissionPackageState,
    InstallmentSchedule,
    ScheduleDiscountSplit,
    SelectedPackageSession,
} from '@/routes/manage-students/students-list/-types/bulk-assign-types';
import type { DiscountType } from '@/routes/manage-students/students-list/-types/cpo-side-view-types';
import {
    MAX_INSTALLMENTS,
    discountAmount,
    formatInr,
    initialSchedule,
    respreadScheduleDiscounts,
    rowsFromRule,
    validateSchedule,
    type SchedulePart,
} from '@/routes/manage-students/students-list/-utils/installment-schedule';
import { InstallmentScheduleEditor } from './InstallmentScheduleEditor';
import { toOfflinePaymentDetailsPayload } from '@/services/offline-payment-modes';

/** A package as it starts when switched on: three monthly installments from today. */
export const initialAdmissionPackage = (): AdmissionPackageState => ({
    enabled: true,
    discount: null,
    schedule: { ...initialSchedule(null, 3), discount_split: 'EVEN' },
    payment_mode: 'SKIP',
    payment_amount: null,
    payment_details: undefined,
    error: null,
});

/** The package as the backend takes it: explicit rows (the rule's, when none were edited). */
export const toAdmissionPackageRequest = (
    state: AdmissionPackageState,
    feeTotal: number
): AdmissionPackageRequest => {
    const parts: SchedulePart[] = [{ feeTypeName: 'Package', total: feeTotal, split: true }];
    const generated = rowsFromRule(state.schedule, parts);
    const rows = (state.schedule.rows ?? generated).map((r, k) => ({
        due_date: r.due_date,
        amount: r.amount ?? generated[k]?.amount ?? 0,
        discount: r.discount ?? 0,
    }));
    const offline = state.payment_mode === 'OFFLINE' && (state.payment_amount ?? 0) > 0;
    const details = offline ? toOfflinePaymentDetailsPayload(state.payment_details) : null;
    return {
        discount: state.discount,
        rows,
        payment_mode: offline ? 'OFFLINE' : 'SKIP',
        payment_amount: offline ? state.payment_amount : null,
        payment_reference: details?.reference ?? null,
        payment_details: details,
    };
};

interface Props {
    courses: SelectedPackageSession[];
    value: AdmissionPackageState | null;
    onChange: (next: AdmissionPackageState | null) => void;
    numbering: NumberingTarget;
}

const inputClass = 'rounded border border-neutral-200 px-2 py-1 text-xs';

/**
 * Step 3, two or more courses: enroll them as one admission package — one discount on the
 * total, one installment schedule, one payment at admission and one admission receipt. The
 * backend splits all of it across the courses in proportion to their fees and gives each course
 * its own installments (AdmissionPackageSplitter), so per-course reports and dues still work.
 * Courses whose plan cannot follow a package schedule say why and keep the switch off.
 */
export const AdmissionPackagePanel = ({ courses, value, onChange, numbering }: Props) => {
    const { t } = useTranslation('manageStudentsAdmissionPackage');
    const pkg = value?.enabled ? value : null;

    const blockers = courses.filter((c) => c.packageBlocker);
    const pending = courses.some((c) => c.packageFee == null && !c.packageBlocker);
    const feeTotal = useMemo(
        () => Math.round(courses.reduce((s, c) => s + (c.packageFee ?? 0), 0) * 100) / 100,
        [courses]
    );
    const parts: SchedulePart[] = useMemo(
        () => [{ feeTypeName: t('package'), total: feeTotal, split: true }],
        [feeTotal, t]
    );

    const schedule = pkg?.schedule ?? null;
    const split: ScheduleDiscountSplit = schedule?.discount_split ?? 'EVEN';
    const generated = useMemo(
        () => (schedule ? rowsFromRule(schedule, parts) : []),
        [schedule, parts]
    );
    const rows = schedule?.rows ?? generated;
    const rowDiscountSum = Math.round(rows.reduce((s, r) => s + (r.discount ?? 0), 0) * 100) / 100;
    const wanted = pkg ? discountAmount(pkg.discount, feeTotal) : 0;
    const net = Math.max(0, Math.round((feeTotal - rowDiscountSum) * 100) / 100);
    const firstToPay = rows[0]
        ? Math.round(
              ((rows[0].amount ?? generated[0]?.amount ?? 0) - (rows[0].discount ?? 0)) * 100
          ) / 100
        : 0;

    const update = (patch: Partial<AdmissionPackageState>) => pkg && onChange({ ...pkg, ...patch });
    const setSchedule = (next: InstallmentSchedule) => update({ schedule: next });

    // The courses' fees changed (another invite picked): edited amounts no longer add up.
    useEffect(() => {
        if (!schedule?.rows) return;
        const sum = schedule.rows.reduce((s, r) => s + (r.amount ?? 0), 0);
        if (Math.round(sum * 100) !== Math.round(feeTotal * 100))
            setSchedule({ ...schedule, rows: null });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [feeTotal]);

    // Re-split the discount over the installments when it, the split or the rows change.
    useEffect(() => {
        if (!schedule) return;
        const next = respreadScheduleDiscounts(
            schedule,
            generated,
            wanted,
            split,
            !!pkg?.discount,
            true
        );
        if (next) setSchedule({ ...schedule, rows: next });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [wanted, split, rows.length, schedule?.rows == null, !!pkg?.discount]);

    // While the payment amount is still the prefill, keep it on the first installment.
    const prefilled = useRef<number | null>(null);
    useEffect(() => {
        if (!pkg || pkg.payment_mode !== 'OFFLINE') return;
        if (pkg.payment_amount === firstToPay) {
            prefilled.current = firstToPay;
        } else if (prefilled.current != null && pkg.payment_amount === prefilled.current) {
            prefilled.current = firstToPay;
            update({ payment_amount: firstToPay });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [firstToPay, pkg?.payment_mode, pkg?.payment_amount]);

    const [detailsError, setDetailsError] = useState<string | null>(null);
    const scheduleError = schedule ? validateSchedule(schedule, parts, MAX_INSTALLMENTS) : null;
    const errorText = !pkg
        ? null
        : blockers.length > 0
          ? t('errors.blocked')
          : pending
            ? t('errors.loading')
            : scheduleError
              ? t(scheduleError.key, {
                    ...scheduleError.params,
                    ns: 'manageStudentsCpoEnrollmentConfigPanel',
                })
              : pkg.payment_mode === 'OFFLINE' && !(pkg.payment_amount && pkg.payment_amount > 0)
                ? t('errors.paymentAmount')
                : pkg.payment_mode === 'OFFLINE' && (pkg.payment_amount ?? 0) > net + 0.004
                  ? t('errors.paymentTooMuch', { net: formatInr(net) })
                  : pkg.payment_mode === 'OFFLINE' && detailsError
                    ? detailsError
                    : null;
    // Report only real changes (the parent merges into the props it rendered with).
    useEffect(() => {
        if (pkg && (pkg.error ?? null) !== errorText) update({ error: errorText });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [errorText, !!pkg]);

    if (courses.length < 2) return null;

    return (
        <div className="rounded-lg border border-primary-200 bg-primary-50/40 p-4">
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2">
                    <Package size={18} weight="duotone" className="mt-0.5 text-primary-500" />
                    <div>
                        <Label className="text-sm font-semibold text-neutral-800">
                            {t('toggle.label')}
                        </Label>
                        <p className="text-xs text-neutral-500">{t('toggle.hint')}</p>
                    </div>
                </div>
                <Switch
                    checked={!!pkg}
                    disabled={!pkg && blockers.length > 0}
                    onCheckedChange={(on) => onChange(on ? initialAdmissionPackage() : null)}
                    aria-label={t('toggle.label')}
                />
            </div>

            {blockers.length > 0 && (
                <ul className="mt-2 list-disc ps-5 text-xs text-warning-700">
                    {blockers.map((c) => (
                        <li key={c.packageSessionId}>{c.packageBlocker}</li>
                    ))}
                </ul>
            )}

            {pkg && schedule && (
                <div className="mt-4 flex flex-col gap-3">
                    {/* Courses and the total */}
                    <div className="rounded-md border border-neutral-200 bg-white">
                        <ul className="divide-y divide-neutral-100 text-xs">
                            {courses.map((c) => (
                                <li
                                    key={c.packageSessionId}
                                    className="flex items-center justify-between px-3 py-2"
                                >
                                    <span className="text-neutral-700">{c.courseName}</span>
                                    <span className="tabular-nums text-neutral-800">
                                        {c.packageFee != null ? formatInr(c.packageFee) : '…'}
                                    </span>
                                </li>
                            ))}
                            <li className="flex items-center justify-between bg-neutral-50 px-3 py-2 font-semibold">
                                <span>{t('total')}</span>
                                <span className="tabular-nums">{formatInr(feeTotal)}</span>
                            </li>
                        </ul>
                    </div>

                    {/* Package discount */}
                    <div className="rounded-md border border-neutral-200 bg-white p-3">
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                            {t('discount.heading')}
                        </p>
                        <div className="flex flex-wrap items-end gap-2">
                            <div>
                                <label className="block text-xs text-neutral-500">
                                    {t('discount.type')}
                                </label>
                                <select
                                    value={pkg.discount?.type ?? ''}
                                    onChange={(e) => {
                                        const type = e.target.value as DiscountType | '';
                                        update({
                                            discount: type
                                                ? {
                                                      type,
                                                      value: pkg.discount?.value ?? 0,
                                                      reason: pkg.discount?.reason ?? null,
                                                  }
                                                : null,
                                        });
                                    }}
                                    className={inputClass}
                                >
                                    <option value="">{t('discount.none')}</option>
                                    <option value="FLAT">{t('discount.flat')}</option>
                                    <option value="PERCENTAGE">{t('discount.percentage')}</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs text-neutral-500">
                                    {t('discount.value')}
                                </label>
                                <input
                                    type="number"
                                    min={0}
                                    step="any"
                                    disabled={!pkg.discount || split === 'CUSTOM'}
                                    value={
                                        split === 'CUSTOM'
                                            ? rowDiscountSum
                                            : pkg.discount?.value
                                              ? pkg.discount.value
                                              : ''
                                    }
                                    onChange={(e) =>
                                        pkg.discount &&
                                        update({
                                            discount: {
                                                ...pkg.discount,
                                                value: Number(e.target.value || 0),
                                            },
                                        })
                                    }
                                    className={`${inputClass} w-24 disabled:bg-neutral-50`}
                                />
                            </div>
                            <div className="min-w-40 flex-1">
                                <label className="block text-xs text-neutral-500">
                                    {t('discount.reason')}
                                </label>
                                <input
                                    type="text"
                                    disabled={!pkg.discount}
                                    value={pkg.discount?.reason ?? ''}
                                    placeholder={t('discount.reasonPlaceholder')}
                                    onChange={(e) =>
                                        pkg.discount &&
                                        update({
                                            discount: { ...pkg.discount, reason: e.target.value },
                                        })
                                    }
                                    className={`${inputClass} w-full disabled:bg-neutral-50`}
                                />
                            </div>
                        </div>
                        {pkg.discount && (
                            <div className="mt-2">
                                <p className="mb-1 text-xs text-neutral-500">
                                    {t('discount.splitLabel')}
                                </p>
                                <div role="radiogroup" className="flex flex-wrap gap-1.5">
                                    {(
                                        [
                                            'EVEN',
                                            'FIRST',
                                            'LAST',
                                            'CUSTOM',
                                        ] as ScheduleDiscountSplit[]
                                    ).map((sp) => (
                                        <button
                                            key={sp}
                                            type="button"
                                            role="radio"
                                            aria-checked={split === sp}
                                            onClick={() =>
                                                setSchedule({ ...schedule, discount_split: sp })
                                            }
                                            className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                                                split === sp
                                                    ? 'border-primary-400 bg-primary-50 text-primary-700'
                                                    : 'border-neutral-200 bg-white text-neutral-600'
                                            }`}
                                        >
                                            {t(`discount.split.${sp}`)}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                        <p className="mt-2 text-xs text-neutral-700">
                            {t('summary', {
                                total: formatInr(feeTotal),
                                off: formatInr(rowDiscountSum),
                                net: formatInr(net),
                            })}
                        </p>
                        <p className="mt-0.5 text-xs text-neutral-500">{t('discount.byFee')}</p>
                    </div>

                    {/* One schedule for the package */}
                    <div>
                        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                            {t('schedule.heading')}
                        </p>
                        <InstallmentScheduleEditor
                            schedule={schedule}
                            parts={parts}
                            maxCount={MAX_INSTALLMENTS}
                            discountActive={!!pkg.discount}
                            split={split}
                            error={null}
                            onChange={setSchedule}
                        />
                        <p className="text-xs text-neutral-500">{t('schedule.hint')}</p>
                    </div>

                    {/* Payment at admission */}
                    <div className="rounded-md border border-neutral-200 bg-white p-3">
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                            {t('payment.heading')}
                        </p>
                        <div className="flex flex-col gap-1.5 text-xs text-neutral-700">
                            <label className="flex cursor-pointer items-center gap-2">
                                <input
                                    type="radio"
                                    checked={pkg.payment_mode === 'SKIP'}
                                    onChange={() =>
                                        update({ payment_mode: 'SKIP', payment_amount: null })
                                    }
                                    className="size-3.5"
                                />
                                {t('payment.skip')}
                            </label>
                            <label className="flex cursor-pointer items-center gap-2">
                                <input
                                    type="radio"
                                    checked={pkg.payment_mode === 'OFFLINE'}
                                    onChange={() =>
                                        update({
                                            payment_mode: 'OFFLINE',
                                            payment_amount:
                                                pkg.payment_amount && pkg.payment_amount > 0
                                                    ? pkg.payment_amount
                                                    : firstToPay,
                                        })
                                    }
                                    className="size-3.5"
                                />
                                {t('payment.offline')}
                            </label>
                        </div>
                        {pkg.payment_mode === 'OFFLINE' && (
                            <div className="mt-3 flex flex-col gap-3">
                                <div>
                                    <label className="block text-xs font-medium text-neutral-500">
                                        {t('payment.amount')}
                                    </label>
                                    <input
                                        type="number"
                                        min={0}
                                        step="any"
                                        value={pkg.payment_amount ?? ''}
                                        onChange={(e) =>
                                            update({
                                                payment_amount:
                                                    e.target.value === ''
                                                        ? null
                                                        : Number(e.target.value),
                                            })
                                        }
                                        onFocus={(e) => e.currentTarget.select()}
                                        className={`${inputClass} w-40`}
                                    />
                                    <p className="mt-1 text-xs text-neutral-500">
                                        {t('payment.amountHint', {
                                            first: formatInr(firstToPay),
                                            net: formatInr(net),
                                        })}
                                    </p>
                                </div>
                                <OfflinePaymentFields
                                    compact
                                    showNotes
                                    value={pkg.payment_details ?? {}}
                                    onChange={(d) => update({ payment_details: d })}
                                    onErrorChange={setDetailsError}
                                    numbering={numbering}
                                />
                                <p className="text-xs text-neutral-500">
                                    {t('payment.receiptHint')}
                                </p>
                            </div>
                        )}
                    </div>

                    {errorText && (
                        <p role="alert" className="text-xs font-medium text-danger-600">
                            {errorText}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
};
