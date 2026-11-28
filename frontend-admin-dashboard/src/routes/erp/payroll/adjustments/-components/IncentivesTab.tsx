import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ArrowRight, Calculator, Sparkle, UserMinus } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { MoneyCell } from '@/components/design-system/money-cell';
import {
    MonthPicker,
    currentMonthValue,
    formatMonthValue,
    previousMonthValue,
    type MonthValue,
} from '@/components/design-system/month-picker';
import { MyTable, type TableData } from '@/components/design-system/table';
import { Card } from '@/components/ui/card';
import { useHrRole } from '@/hooks/use-hr-role';
import { reportApiError } from '@/lib/report-api-error';
import type { IncentiveMaterializeResultDTO, IncentiveRowDTO } from '@/routes/erp/-shared/hr-types';
import { HrEmptyState, HrErrorState } from '@/routes/erp/people/-components/HrStates';
import {
    MAX_COMMISSION_PCT,
    hasUsableTerms,
    useIncentivePreview,
    useMaterializeIncentives,
    type IncentiveTerms,
} from '../-hooks/use-crm-incentives';
import { NoProfileNote, VariablePayStat, formatCount } from './variable-pay-shared';

/**
 * Variable Pay → Incentives.
 *
 * Sales incentive on collected revenue, per counsellor. The screen insists on two
 * months rather than one: the EARNING month is where the revenue was collected,
 * and the PAYOUT month is the payroll that actually pays it — you pay August's
 * incentive in September. Collapsing them into one control is how an institute
 * ends up paying the wrong month's number, so both pickers are visible and the
 * sentence between them spells the direction out.
 */

/** A number the user is still typing: blank and half-typed values are not errors yet. */
const parseAmount = (text: string): number | undefined => {
    const trimmed = text.trim();
    if (!trimmed) return undefined;
    const value = Number(trimmed);
    return Number.isFinite(value) ? value : undefined;
};

export const IncentivesTab = () => {
    const { t } = useTranslation('erpIncentivesTab');
    const { isHrAdmin } = useHrRole();

    const [earningMonth, setEarningMonth] = useState<MonthValue>(() => previousMonthValue());
    const [payoutMonth, setPayoutMonth] = useState<MonthValue>(() => currentMonthValue());
    const [commissionText, setCommissionText] = useState('5');
    const [fixedText, setFixedText] = useState('');
    const [materializeResult, setMaterializeResult] =
        useState<IncentiveMaterializeResultDTO | null>(null);

    const commissionValue = parseAmount(commissionText);
    const fixedValue = parseAmount(fixedText);

    const commissionError =
        commissionValue !== undefined &&
        (commissionValue < 0 || commissionValue > MAX_COMMISSION_PCT)
            ? t('enterRange', { max: MAX_COMMISSION_PCT })
            : null;
    const fixedError = fixedValue !== undefined && fixedValue < 0 ? t('cannotBeNegative') : null;

    const terms: IncentiveTerms = useMemo(
        () => ({
            commissionPct: commissionValue,
            fixedPerConversion: fixedValue,
        }),
        [commissionValue, fixedValue]
    );

    const termsUsable = hasUsableTerms(terms) && !commissionError && !fixedError;

    const previewQuery = useIncentivePreview(earningMonth, terms);
    const materializeMutation = useMaterializeIncentives(earningMonth, payoutMonth);

    const preview = previewQuery.data;
    const allRows = useMemo(() => preview?.rows ?? [], [preview]);
    const linkedRows = useMemo(
        () => allRows.filter((row) => row.no_employee_profile !== true),
        [allRows]
    );
    const unlinkedRows = useMemo(
        () => allRows.filter((row) => row.no_employee_profile === true),
        [allRows]
    );

    /**
     * Clamp on blur, not on keystroke: clamping as the user types turns "55" into
     * "5" mid-word and makes the field feel broken. The value is still validated
     * while typing, and the server clamps again regardless of what is sent.
     */
    const clampCommission = () => {
        const value = parseAmount(commissionText);
        if (value === undefined) return;
        const clamped = Math.min(Math.max(value, 0), MAX_COMMISSION_PCT);
        if (clamped !== value) setCommissionText(String(clamped));
    };

    const runPreview = async () => {
        setMaterializeResult(null);
        const result = await previewQuery.refetch();
        if (result.error) {
            reportApiError(result.error, {
                feature: 'erp-incentives',
                tags: { action: 'preview' },
                fallbackMessage: t('errors.computeFailed'),
            });
            return;
        }
        toast.success(
            t('toast.previewReady', {
                count: result.data?.counsellor_count ?? 0,
                month: formatMonthValue(earningMonth),
            })
        );
    };

    const handleMaterialize = async () => {
        try {
            const result = await materializeMutation.mutateAsync(terms);
            setMaterializeResult(result);
            toast.success(
                t('toast.materialized', {
                    count: result.created_count ?? 0,
                    month: formatMonthValue(payoutMonth),
                }) + (result.skipped_count ? ` · ${t('toast.skipped', { count: result.skipped_count })}` : '')
            );
        } catch (error) {
            reportApiError(error, {
                feature: 'erp-incentives',
                tags: { action: 'materialize' },
                fallbackMessage: t('errors.materializeFailed'),
            });
        }
    };

    const columns = useMemo<ColumnDef<IncentiveRowDTO>[]>(
        () => [
            {
                id: 'counsellor',
                header: t('columns.counsellor'),
                cell: ({ row }) => (
                    <span className="text-body text-neutral-700">
                        {row.original.counsellor_name || row.original.counsellor_user_id || '—'}
                    </span>
                ),
            },
            {
                id: 'revenue',
                header: t('columns.revenueCollected'),
                cell: ({ row }) => <MoneyCell value={row.original.revenue ?? null} dashOnZero />,
            },
            {
                id: 'paying_leads',
                header: t('columns.payingLeads'),
                cell: ({ row }) => (
                    <span className="block text-end tabular-nums text-neutral-600">
                        {formatCount(row.original.paying_leads)}
                    </span>
                ),
            },
            {
                id: 'payments',
                header: t('columns.payments'),
                cell: ({ row }) => (
                    <span className="block text-end tabular-nums text-neutral-600">
                        {formatCount(row.original.payments)}
                    </span>
                ),
            },
            {
                id: 'commission_component',
                header: t('columns.commission'),
                cell: ({ row }) => (
                    <MoneyCell value={row.original.commission_component ?? null} dashOnZero />
                ),
            },
            {
                id: 'fixed_component',
                header: t('columns.perConversion'),
                cell: ({ row }) => (
                    <MoneyCell value={row.original.fixed_component ?? null} dashOnZero />
                ),
            },
            {
                id: 'incentive',
                header: t('columns.incentive'),
                cell: ({ row }) => (
                    <MoneyCell value={row.original.incentive ?? null} tone="earning" dashOnZero />
                ),
            },
        ],
        [t]
    );

    const tableData: TableData<IncentiveRowDTO> = {
        content: linkedRows,
        total_pages: 1,
        page_no: 0,
        page_size: linkedRows.length,
        total_elements: linkedRows.length,
        last: true,
    };

    return (
        <div className="flex flex-col gap-4">
            <p className="max-w-3xl text-body text-neutral-600">{t('intro')}</p>

            <Card className="flex flex-col gap-4 p-4">
                <div className="flex flex-wrap items-start gap-4">
                    <div className="flex flex-col gap-1.5">
                        <span className="text-caption text-neutral-600">
                            {t('earningMonthLabel')}
                        </span>
                        <MonthPicker
                            value={earningMonth}
                            onChange={setEarningMonth}
                            disableFuture
                        />
                    </div>
                    <div className="flex w-40 flex-col gap-1.5">
                        <span className="text-caption text-neutral-600">
                            {t('commissionLabel')}
                        </span>
                        <MyInput
                            inputType="number"
                            input={commissionText}
                            onChangeFunction={(e) => setCommissionText(e.target.value)}
                            onBlur={clampCommission}
                            inputPlaceholder="5"
                            error={commissionError}
                            className="w-full"
                        />
                    </div>
                    <div className="flex w-48 flex-col gap-1.5">
                        <span className="text-caption text-neutral-600">
                            {t('fixedPerConversionLabel')}
                        </span>
                        <MyInput
                            inputType="number"
                            input={fixedText}
                            onChangeFunction={(e) => setFixedText(e.target.value)}
                            inputPlaceholder="0"
                            error={fixedError}
                            className="w-full"
                        />
                    </div>
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        className="mt-6"
                        onAsyncClick={runPreview}
                        loadingText={t('computing')}
                        disabled={!termsUsable}
                    >
                        <Calculator size={16} />
                        {preview ? t('recomputePreview') : t('previewIncentives')}
                    </MyButton>
                </div>
                <p className="text-caption text-neutral-500">
                    {t('commissionHint', { max: MAX_COMMISSION_PCT })}
                </p>
            </Card>

            {!termsUsable ? (
                <HrEmptyState
                    title={t('emptyTerms.title')}
                    description={t('emptyTerms.description')}
                />
            ) : previewQuery.isError ? (
                <HrErrorState
                    message={t('errors.computeFailed')}
                    onRetry={() => void previewQuery.refetch()}
                />
            ) : !preview ? (
                <HrEmptyState
                    title={t('nothingComputed.title')}
                    description={t('nothingComputed.description', {
                        month: formatMonthValue(earningMonth),
                    })}
                />
            ) : (
                <>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <VariablePayStat
                            label={t('stats.counsellors')}
                            value={preview.counsellor_count ?? allRows.length}
                        />
                        <VariablePayStat
                            label={t('stats.revenueCollected')}
                            value={preview.total_revenue}
                            isMoney
                        />
                        <VariablePayStat
                            label={t('stats.payingLeads')}
                            value={preview.total_paying_leads ?? 0}
                        />
                        <VariablePayStat
                            label={t('stats.totalIncentive')}
                            value={preview.total_incentive}
                            isMoney
                        />
                    </div>

                    {linkedRows.length === 0 ? (
                        <HrEmptyState
                            title={t('noneToPay.title')}
                            description={t('noneToPay.description', {
                                month: formatMonthValue(earningMonth),
                            })}
                        />
                    ) : (
                        <MyTable<IncentiveRowDTO>
                            data={tableData}
                            columns={columns}
                            isLoading={previewQuery.isFetching}
                            error={null}
                            currentPage={0}
                            scrollable
                        />
                    )}

                    {unlinkedRows.length > 0 && (
                        <Card className="flex flex-col gap-3 border-warning-200 bg-warning-50 p-4">
                            <div className="flex items-center gap-2 text-warning-700">
                                <UserMinus size={18} />
                                <span className="text-subtitle font-medium">
                                    {t('willBeSkipped', { count: unlinkedRows.length })}
                                </span>
                            </div>
                            <p className="text-body text-neutral-600">{t('unlinkedHint')}</p>
                            <ul className="flex flex-col gap-2">
                                {unlinkedRows.map((row) => (
                                    <li
                                        key={row.counsellor_user_id ?? row.counsellor_name}
                                        className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-card px-3 py-2"
                                    >
                                        <span className="flex flex-col">
                                            <span className="text-body text-neutral-700">
                                                {row.counsellor_name ||
                                                    row.counsellor_user_id ||
                                                    '—'}
                                            </span>
                                            <NoProfileNote />
                                        </span>
                                        <MoneyCell value={row.incentive ?? null} dashOnZero />
                                    </li>
                                ))}
                            </ul>
                        </Card>
                    )}

                    {isHrAdmin && (
                        <Card className="flex flex-col gap-3 p-4">
                            <div className="flex flex-col gap-1">
                                <span className="text-subtitle font-medium text-neutral-700">
                                    {t('payThisIncentive')}
                                </span>
                                <span className="max-w-2xl text-caption text-neutral-500">
                                    {t('payThisIncentiveHint')}
                                </span>
                            </div>

                            <div className="flex flex-wrap items-end gap-4">
                                <div className="flex flex-col gap-1.5">
                                    <span className="text-caption text-neutral-600">
                                        {t('earnedIn')}
                                    </span>
                                    <span className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-body font-medium text-neutral-700">
                                        {formatMonthValue(earningMonth)}
                                    </span>
                                </div>
                                <ArrowRight
                                    size={18}
                                    className="mb-3 text-neutral-400 rtl:rotate-180"
                                />
                                <div className="flex flex-col gap-1.5">
                                    <span className="text-caption text-neutral-600">
                                        {t('paidOnPayrollFor')}
                                    </span>
                                    <MonthPicker value={payoutMonth} onChange={setPayoutMonth} />
                                </div>
                                <MyButton
                                    buttonType="primary"
                                    scale="medium"
                                    onAsyncClick={handleMaterialize}
                                    loadingText={t('creating')}
                                    disabled={linkedRows.length === 0}
                                >
                                    <Sparkle size={16} />
                                    {t('materialize')}
                                </MyButton>
                            </div>

                            <p className="text-caption text-neutral-500">
                                {t('payoutSummary', {
                                    earning: formatMonthValue(earningMonth),
                                    payout: formatMonthValue(payoutMonth),
                                })}
                                {earningMonth.month === payoutMonth.month &&
                                earningMonth.year === payoutMonth.year
                                    ? ` ${t('sameMonthWarning')}`
                                    : ''}
                            </p>

                            {materializeResult && (
                                <div className="grid gap-3 sm:grid-cols-3">
                                    <VariablePayStat
                                        label={t('stats.adjustmentsCreated')}
                                        value={materializeResult.created_count ?? 0}
                                    />
                                    <VariablePayStat
                                        label={t('stats.skipped')}
                                        value={materializeResult.skipped_count ?? 0}
                                    />
                                    <VariablePayStat
                                        label={t('stats.totalPaidOut')}
                                        value={materializeResult.total_amount}
                                        isMoney
                                    />
                                </div>
                            )}
                        </Card>
                    )}
                </>
            )}
        </div>
    );
};
