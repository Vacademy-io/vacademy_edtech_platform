import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DownloadSimple, Sparkle } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { MyDropdown } from '@/components/design-system/dropdown';
import { MyInput } from '@/components/design-system/input';
import { MoneyCell } from '@/components/design-system/money-cell';
import {
    MonthPicker,
    currentMonthValue,
    formatMonthValue,
    type MonthValue,
} from '@/components/design-system/month-picker';
import { Card } from '@/components/ui/card';
import { StatusChip } from '@/components/design-system/status-chips';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getInstituteId } from '@/constants/helper';
import {
    HR_COMPLIANCE_EOSB_DOWNLOAD,
    HR_COMPLIANCE_GRATUITY_DOWNLOAD,
} from '@/constants/urls';
import { reportApiError } from '@/lib/report-api-error';
import { useHrRole } from '@/hooks/use-hr-role';
import {
    downloadComplianceFile,
    fetchBonusComputation,
    fetchEosbProvision,
    fetchGratuityProvision,
    fetchTaxConfiguration,
    hrKeys,
    materializeBonus,
    resolveComplianceCountry,
} from '@/routes/erp/-shared/hr-service';
import {
    HrEmptyState,
    HrErrorState,
    HrLoadingRows,
    HrNoAccessCard,
} from '@/routes/erp/people/-components/HrStates';
import { ComplianceStat, financialYearOf, recentFinancialYears } from './compliance-shared';

const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * Long-service liabilities and the annual bonus.
 *
 * Gratuity (India) and EOSB (Gulf) are the same idea under two statutes, so the
 * institute's configured country decides which tab exists — showing both would
 * imply an institute owes both, which no institute does.
 */
export const ProvisionsMain = () => {
    const { t } = useTranslation('erpProvisionsMain');
    const { isHrAdmin } = useHrRole();
    const [asOfDate, setAsOfDate] = useState<string>(todayIso());

    const { data: taxConfig } = useQuery({
        queryKey: hrKeys.taxConfig(),
        queryFn: fetchTaxConfiguration,
        enabled: !!getInstituteId() && isHrAdmin,
        staleTime: 10 * 60 * 1000,
    });

    if (!isHrAdmin) return <HrNoAccessCard />;

    const country = resolveComplianceCountry(taxConfig) ?? 'IND';
    const isGulf = country === 'ARE' || country === 'SAU';

    return (
        <div className="flex flex-col gap-5">
            <p className="text-body text-neutral-500">{t('description')}</p>

            <Tabs defaultValue={isGulf ? 'eosb' : 'gratuity'} className="flex flex-col gap-4">
                <TabsList className="w-fit">
                    {isGulf ? (
                        <TabsTrigger value="eosb">{t('tabs.eosb')}</TabsTrigger>
                    ) : (
                        <TabsTrigger value="gratuity">{t('tabs.gratuity')}</TabsTrigger>
                    )}
                    {!isGulf && <TabsTrigger value="bonus">{t('tabs.bonus')}</TabsTrigger>}
                </TabsList>

                {!isGulf && (
                    <TabsContent value="gratuity" className="mt-0">
                        <GratuityTab asOfDate={asOfDate} onAsOfDateChange={setAsOfDate} />
                    </TabsContent>
                )}
                {isGulf && (
                    <TabsContent value="eosb" className="mt-0">
                        <EosbTab asOfDate={asOfDate} onAsOfDateChange={setAsOfDate} />
                    </TabsContent>
                )}
                {!isGulf && (
                    <TabsContent value="bonus" className="mt-0">
                        <BonusTab />
                    </TabsContent>
                )}
            </Tabs>
        </div>
    );
};

const AsOfControl = ({
    asOfDate,
    onAsOfDateChange,
    onDownload,
}: {
    asOfDate: string;
    onAsOfDateChange: (v: string) => void;
    onDownload: () => Promise<void>;
}) => {
    const { t } = useTranslation('erpProvisionsMain');
    return (
        <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex w-64 flex-col gap-1.5">
                <span className="text-caption text-neutral-600">{t('asOf.label')}</span>
                <MyInput
                    inputType="date"
                    input={asOfDate}
                    onChangeFunction={(e) => onAsOfDateChange(e.target.value)}
                    inputPlaceholder=""
                    className="w-full"
                />
            </div>
            <MyButton
                buttonType="secondary"
                scale="medium"
                onAsyncClick={onDownload}
                loadingText={t('asOf.preparing')}
            >
                <DownloadSimple size={16} />
                {t('asOf.downloadCsv')}
            </MyButton>
        </div>
    );
};

const GratuityTab = ({
    asOfDate,
    onAsOfDateChange,
}: {
    asOfDate: string;
    onAsOfDateChange: (v: string) => void;
}) => {
    const { t } = useTranslation('erpProvisionsMain');
    const query = useQuery({
        queryKey: hrKeys.gratuity(asOfDate),
        queryFn: () => fetchGratuityProvision(asOfDate),
        enabled: !!getInstituteId(),
        staleTime: 5 * 60 * 1000,
    });
    const data = query.data;
    const rows = data?.rows ?? [];

    const handleDownload = async () => {
        try {
            await downloadComplianceFile(
                HR_COMPLIANCE_GRATUITY_DOWNLOAD,
                { asOfDate },
                `gratuity_provision_${asOfDate}.csv`
            );
            toast.success(t('gratuity.downloadSuccess'));
        } catch (error) {
            reportApiError(error, {
                feature: 'erp-compliance',
                fallbackMessage: t('gratuity.downloadError'),
            });
        }
    };

    return (
        <div className="flex flex-col gap-4">
            <AsOfControl
                asOfDate={asOfDate}
                onAsOfDateChange={onAsOfDateChange}
                onDownload={handleDownload}
            />
            {query.isLoading ? (
                <HrLoadingRows rows={5} />
            ) : query.isError ? (
                <HrErrorState
                    message={t('gratuity.computeError')}
                    onRetry={() => void query.refetch()}
                />
            ) : rows.length === 0 ? (
                <HrEmptyState
                    title={t('gratuity.emptyTitle')}
                    description={t('gratuity.emptyDescription')}
                />
            ) : (
                <>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <ComplianceStat
                            label={t('gratuity.stats.employees')}
                            value={data?.employee_count ?? rows.length}
                        />
                        <ComplianceStat
                            label={t('gratuity.stats.totalLiability')}
                            value={data?.total_accrued_liability}
                            currency={data?.currency}
                            isMoney
                        />
                        <ComplianceStat
                            label={t('gratuity.stats.vested')}
                            value={data?.vested_accrued_liability}
                            currency={data?.currency}
                            isMoney
                        />
                        <ComplianceStat
                            label={t('gratuity.stats.monthlyRunRate')}
                            value={data?.total_monthly_run_rate}
                            currency={data?.currency}
                            isMoney
                        />
                    </div>
                    <Card className="overflow-x-auto p-0">
                        <table className="w-full text-body">
                            <thead>
                                <tr className="border-b border-neutral-200 bg-neutral-50 text-caption uppercase text-neutral-500">
                                    <th className="px-4 py-2 text-start font-medium">
                                        {t('gratuity.table.employee')}
                                    </th>
                                    <th className="px-4 py-2 text-end font-medium">
                                        {t('gratuity.table.years')}
                                    </th>
                                    <th className="px-4 py-2 text-end font-medium">
                                        {t('gratuity.table.monthlyBasic')}
                                    </th>
                                    <th className="px-4 py-2 text-end font-medium">
                                        {t('gratuity.table.liability')}
                                    </th>
                                    <th className="px-4 py-2 text-end font-medium">
                                        {t('gratuity.table.runRate')}
                                    </th>
                                    <th className="px-4 py-2 text-end font-medium">
                                        {t('gratuity.table.vested')}
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((r) => (
                                    <tr
                                        key={r.employee_id}
                                        className="border-b border-neutral-100 last:border-0"
                                    >
                                        <td className="px-4 py-2.5 text-neutral-700">
                                            {r.employee_name || r.employee_code || '—'}
                                        </td>
                                        <td className="px-4 py-2.5 text-end tabular-nums text-neutral-600">
                                            {r.rounded_years ?? '—'}
                                        </td>
                                        <td className="px-4 py-2.5">
                                            <MoneyCell
                                                value={r.monthly_basic ?? null}
                                                currency={r.currency}
                                            />
                                        </td>
                                        <td className="px-4 py-2.5">
                                            <MoneyCell
                                                value={r.accrued_liability ?? null}
                                                currency={r.currency}
                                            />
                                        </td>
                                        <td className="px-4 py-2.5">
                                            <MoneyCell
                                                value={r.monthly_run_rate ?? null}
                                                currency={r.currency}
                                            />
                                        </td>
                                        <td className="px-4 py-2.5 text-end">
                                            <StatusChip
                                                text={
                                                    r.vested
                                                        ? t('gratuity.vestedChip')
                                                        : t('gratuity.notYetChip')
                                                }
                                                textSize="text-caption"
                                                status={r.vested ? 'SUCCESS' : 'INFO'}
                                            />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </Card>
                </>
            )}
        </div>
    );
};

const EosbTab = ({
    asOfDate,
    onAsOfDateChange,
}: {
    asOfDate: string;
    onAsOfDateChange: (v: string) => void;
}) => {
    const { t } = useTranslation('erpProvisionsMain');
    const query = useQuery({
        queryKey: hrKeys.eosb(asOfDate),
        queryFn: () => fetchEosbProvision(asOfDate),
        enabled: !!getInstituteId(),
        staleTime: 5 * 60 * 1000,
    });
    const data = query.data;
    const rows = data?.rows ?? [];

    const handleDownload = async () => {
        try {
            await downloadComplianceFile(
                HR_COMPLIANCE_EOSB_DOWNLOAD,
                { asOfDate },
                `eosb_provision_${asOfDate}.csv`
            );
            toast.success(t('eosb.downloadSuccess'));
        } catch (error) {
            reportApiError(error, {
                feature: 'erp-compliance',
                fallbackMessage: t('eosb.downloadError'),
            });
        }
    };

    return (
        <div className="flex flex-col gap-4">
            <AsOfControl
                asOfDate={asOfDate}
                onAsOfDateChange={onAsOfDateChange}
                onDownload={handleDownload}
            />
            <p className="text-caption text-neutral-500">{t('eosb.description')}</p>
            {query.isLoading ? (
                <HrLoadingRows rows={5} />
            ) : query.isError ? (
                <HrErrorState
                    message={t('eosb.computeError')}
                    onRetry={() => void query.refetch()}
                />
            ) : rows.length === 0 ? (
                <HrEmptyState
                    title={t('eosb.emptyTitle')}
                    description={t('eosb.emptyDescription')}
                />
            ) : (
                <>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <ComplianceStat
                            label={t('eosb.stats.employees')}
                            value={data?.employee_count ?? rows.length}
                        />
                        <ComplianceStat
                            label={t('eosb.stats.statutoryLiability')}
                            value={data?.total_statutory_liability}
                            currency={data?.currency}
                            isMoney
                        />
                        <ComplianceStat
                            label={t('eosb.stats.accountingAccrual')}
                            value={data?.total_accounting_accrual}
                            currency={data?.currency}
                            isMoney
                        />
                        <ComplianceStat
                            label={t('eosb.stats.monthlyRunRate')}
                            value={data?.total_monthly_run_rate}
                            currency={data?.currency}
                            isMoney
                        />
                    </div>
                    <Card className="overflow-x-auto p-0">
                        <table className="w-full text-body">
                            <thead>
                                <tr className="border-b border-neutral-200 bg-neutral-50 text-caption uppercase text-neutral-500">
                                    <th className="px-4 py-2 text-start font-medium">
                                        {t('eosb.table.employee')}
                                    </th>
                                    <th className="px-4 py-2 text-end font-medium">
                                        {t('eosb.table.years')}
                                    </th>
                                    <th className="px-4 py-2 text-end font-medium">
                                        {t('eosb.table.monthlyBasic')}
                                    </th>
                                    <th className="px-4 py-2 text-end font-medium">
                                        {t('eosb.table.statutory')}
                                    </th>
                                    <th className="px-4 py-2 text-end font-medium">
                                        {t('eosb.table.accrual')}
                                    </th>
                                    <th className="px-4 py-2 text-end font-medium">
                                        {t('eosb.table.eligible')}
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((r) => (
                                    <tr
                                        key={r.employee_id}
                                        className="border-b border-neutral-100 last:border-0"
                                    >
                                        <td className="px-4 py-2.5 text-neutral-700">
                                            {r.employee_name || r.employee_code || '—'}
                                        </td>
                                        <td className="px-4 py-2.5 text-end tabular-nums text-neutral-600">
                                            {r.service_years ?? '—'}
                                        </td>
                                        <td className="px-4 py-2.5">
                                            <MoneyCell
                                                value={r.monthly_basic ?? null}
                                                currency={r.currency}
                                            />
                                        </td>
                                        <td className="px-4 py-2.5">
                                            <MoneyCell
                                                value={r.statutory_liability ?? null}
                                                currency={r.currency}
                                            />
                                        </td>
                                        <td className="px-4 py-2.5">
                                            <MoneyCell
                                                value={r.accounting_accrual ?? null}
                                                currency={r.currency}
                                            />
                                        </td>
                                        <td className="px-4 py-2.5 text-end">
                                            <StatusChip
                                                text={
                                                    r.statutory_eligible
                                                        ? t('eosb.eligibleChip')
                                                        : t('eosb.notYetChip')
                                                }
                                                textSize="text-caption"
                                                status={r.statutory_eligible ? 'SUCCESS' : 'INFO'}
                                            />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </Card>
                </>
            )}
        </div>
    );
};

const BonusTab = () => {
    const { t } = useTranslation('erpProvisionsMain');
    const [financialYear, setFinancialYear] = useState(() => financialYearOf());
    const [bonusPct, setBonusPct] = useState('8.33');
    const [payoutPeriod, setPayoutPeriod] = useState<MonthValue>(() => currentMonthValue());

    const pct = Number(bonusPct);
    const pctValid = Number.isFinite(pct) && pct >= 8.33 && pct <= 20;

    const query = useQuery({
        queryKey: hrKeys.bonus(financialYear, pct),
        queryFn: () => fetchBonusComputation(financialYear, pct),
        enabled: !!getInstituteId() && pctValid,
        staleTime: 5 * 60 * 1000,
    });
    const data = query.data;
    const rows = data?.rows ?? [];
    const eligibleRows = rows.filter((r) => r.eligible !== false);

    const handleMaterialize = async () => {
        try {
            const result = await materializeBonus({
                financialYear,
                bonusPct: pct,
                month: payoutPeriod.month,
                year: payoutPeriod.year,
            });
            const createdCount = result.created_count ?? 0;
            const skippedExisting = result.skipped_existing_count ?? 0;
            toast.success(
                t('bonus.materializeSuccess', {
                    count: createdCount,
                    period: formatMonthValue(payoutPeriod),
                }) + (skippedExisting ? t('bonus.alreadyExisted', { count: skippedExisting }) : '')
            );
            void query.refetch();
        } catch (error) {
            reportApiError(error, {
                feature: 'erp-compliance',
                fallbackMessage: t('bonus.materializeError'),
            });
        }
    };

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1.5">
                    <span className="text-caption text-neutral-600">{t('bonus.financialYear')}</span>
                    <MyDropdown
                        currentValue={financialYear}
                        dropdownList={recentFinancialYears()}
                        handleChange={(v) => setFinancialYear(String(v))}
                    />
                </div>
                <div className="flex w-40 flex-col gap-1.5">
                    <span className="text-caption text-neutral-600">{t('bonus.rate')}</span>
                    <MyInput
                        inputType="number"
                        input={bonusPct}
                        onChangeFunction={(e) => setBonusPct(e.target.value)}
                        inputPlaceholder="8.33"
                        className="w-full"
                    />
                </div>
                <span className="pb-2 text-caption text-neutral-500">{t('bonus.rateHint')}</span>
            </div>

            {!pctValid ? (
                <HrEmptyState
                    title={t('bonus.invalidRateTitle')}
                    description={t('bonus.invalidRateDescription')}
                />
            ) : query.isLoading ? (
                <HrLoadingRows rows={5} />
            ) : query.isError ? (
                <HrErrorState
                    message={t('bonus.computeError')}
                    onRetry={() => void query.refetch()}
                />
            ) : rows.length === 0 ? (
                <HrEmptyState
                    title={t('bonus.emptyTitle')}
                    description={t('bonus.emptyDescription')}
                />
            ) : (
                <>
                    <div className="grid gap-3 sm:grid-cols-3">
                        <ComplianceStat
                            label={t('bonus.stats.eligibleEmployees')}
                            value={data?.eligible_count ?? eligibleRows.length}
                        />
                        <ComplianceStat
                            label={t('bonus.stats.totalBonus')}
                            value={data?.total_bonus}
                            currency={data?.currency}
                            isMoney
                        />
                        <ComplianceStat
                            label={t('bonus.stats.appliedRate')}
                            value={`${data?.bonus_pct ?? pct}%`}
                        />
                    </div>

                    <Card className="flex flex-wrap items-end justify-between gap-3 p-4">
                        <div className="flex flex-col gap-1">
                            <span className="text-subtitle font-medium text-neutral-700">
                                {t('bonus.payCardTitle')}
                            </span>
                            <span className="text-caption text-neutral-500">
                                {t('bonus.payCardDescription')}
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <MonthPicker
                                value={payoutPeriod}
                                onChange={setPayoutPeriod}
                                label={t('bonus.payoutLabel')}
                            />
                            <MyButton
                                buttonType="primary"
                                scale="medium"
                                onAsyncClick={handleMaterialize}
                                loadingText={t('bonus.materializing')}
                                disabled={eligibleRows.length === 0}
                            >
                                <Sparkle size={16} />
                                {t('bonus.materialize')}
                            </MyButton>
                        </div>
                    </Card>

                    <Card className="overflow-x-auto p-0">
                        <table className="w-full text-body">
                            <thead>
                                <tr className="border-b border-neutral-200 bg-neutral-50 text-caption uppercase text-neutral-500">
                                    <th className="px-4 py-2 text-start font-medium">
                                        {t('bonus.table.employee')}
                                    </th>
                                    <th className="px-4 py-2 text-end font-medium">
                                        {t('bonus.table.monthlyBasic')}
                                    </th>
                                    <th className="px-4 py-2 text-end font-medium">
                                        {t('bonus.table.months')}
                                    </th>
                                    <th className="px-4 py-2 text-end font-medium">
                                        {t('bonus.table.wageBase')}
                                    </th>
                                    <th className="px-4 py-2 text-end font-medium">
                                        {t('bonus.table.bonus')}
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((r) => (
                                    <tr
                                        key={r.employee_id}
                                        className={`border-b border-neutral-100 last:border-0 ${
                                            r.eligible === false ? 'opacity-60' : ''
                                        }`}
                                    >
                                        <td className="px-4 py-2.5 text-neutral-700">
                                            {r.employee_name || r.employee_code || '—'}
                                            {r.eligible === false && r.ineligible_reason && (
                                                <span className="ms-2 text-caption text-neutral-500">
                                                    {r.ineligible_reason}
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-2.5">
                                            <MoneyCell
                                                value={r.monthly_basic ?? null}
                                                currency={r.currency}
                                            />
                                        </td>
                                        <td className="px-4 py-2.5 text-end tabular-nums text-neutral-600">
                                            {r.eligible_months ?? '—'}
                                        </td>
                                        <td className="px-4 py-2.5">
                                            <MoneyCell
                                                value={r.bonus_wage_base ?? null}
                                                currency={r.currency}
                                                dashOnZero
                                            />
                                        </td>
                                        <td className="px-4 py-2.5">
                                            <MoneyCell
                                                value={r.computed_bonus ?? null}
                                                currency={r.currency}
                                                dashOnZero
                                            />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </Card>
                </>
            )}
        </div>
    );
};
