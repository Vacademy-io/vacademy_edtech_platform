import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DownloadSimple, WarningCircle, CheckCircle } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { MoneyCell } from '@/components/design-system/money-cell';
import { Card } from '@/components/ui/card';
import { getInstituteId } from '@/constants/helper';
import { HR_COMPLIANCE_FORM16_DOWNLOAD } from '@/constants/urls';
import { reportApiError } from '@/lib/report-api-error';
import {
    ERP_KEY,
    downloadComplianceFile,
    fetchForm16,
    fetchForm24Q,
} from '@/routes/erp/-shared/hr-service';
import { EmployeePicker } from '@/routes/erp/-shared/EmployeePicker';
import {
    HrEmptyState,
    HrErrorState,
    HrLoadingRows,
} from '@/routes/erp/people/-components/HrStates';
import { ComplianceStat, ComplianceWarnings } from './compliance-shared';

export const Form16Preview = ({ financialYear }: { financialYear: string }) => {
    const { t } = useTranslation('erpTdsFilingPreviews');
    const [employeeId, setEmployeeId] = useState<string>('');

    const query = useQuery({
        queryKey: [...ERP_KEY, 'form16', employeeId, financialYear],
        queryFn: () => fetchForm16(employeeId, financialYear),
        enabled: !!getInstituteId() && !!employeeId,
        staleTime: 5 * 60 * 1000,
    });
    const data = query.data;

    const handleDownload = async () => {
        try {
            await downloadComplianceFile(
                HR_COMPLIANCE_FORM16_DOWNLOAD,
                { employeeId, financialYear },
                `form16_${data?.employeeCode || employeeId}_${financialYear}.pdf`
            );
            toast.success(t('form16.toast.downloaded'));
        } catch (error) {
            reportApiError(error, {
                feature: 'erp-compliance',
                fallbackMessage: t('form16.errors.downloadFailed'),
            });
        }
    };

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
                <span className="text-caption uppercase text-neutral-500">
                    {t('form16.employeeLabel')}
                </span>
                <EmployeePicker
                    value={employeeId}
                    onChange={setEmployeeId}
                    portal={false}
                    placeholder={t('form16.employeePickerPlaceholder')}
                />
            </div>

            {!employeeId ? (
                <HrEmptyState
                    title={t('form16.empty.title')}
                    description={t('form16.empty.description')}
                />
            ) : query.isLoading ? (
                <HrLoadingRows rows={4} />
            ) : query.isError ? (
                <HrErrorState
                    message={t('form16.errors.loadFailed')}
                    onRetry={() => void query.refetch()}
                />
            ) : (
                <>
                    <ComplianceWarnings warnings={data?.warnings} />
                    {data?.lastComputedMonth !== undefined && data.lastComputedMonth < 12 && (
                        <p className="rounded-md bg-warning-50 px-3 py-2 text-caption text-warning-700">
                            {t('form16.incompleteYearNotice')}
                        </p>
                    )}

                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <ComplianceStat
                            label={t('form16.stats.grossSalary')}
                            value={data?.grossSalaryPaid}
                            isMoney
                        />
                        <ComplianceStat
                            label={t('form16.stats.totalExemptions')}
                            value={data?.totalExemptions}
                            isMoney
                        />
                        <ComplianceStat
                            label={t('form16.stats.taxableIncome')}
                            value={data?.taxableIncome}
                            isMoney
                        />
                        <ComplianceStat
                            label={t('form16.stats.tdsDeducted')}
                            value={data?.totalTdsDeducted}
                            isMoney
                        />
                    </div>

                    <Card className="flex flex-col gap-2 p-4 text-body">
                        <div className="flex justify-between">
                            <span className="text-neutral-500">{t('form16.card.regime')}</span>
                            <span className="text-neutral-700">{data?.regime || '—'}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-neutral-500">{t('form16.card.pan')}</span>
                            <span className="tabular-nums text-neutral-700">
                                {data?.employeePan || '—'}
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-neutral-500">{t('form16.card.deductorTan')}</span>
                            <span className="tabular-nums text-neutral-700">
                                {data?.deductorTan || '—'}
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-neutral-500">
                                {t('form16.card.totalTaxLiability')}
                            </span>
                            <MoneyCell value={data?.totalTaxLiability ?? null} className="w-auto" />
                        </div>
                    </Card>

                    {data?.monthlyDetails?.length ? (
                        <div className="overflow-x-auto rounded-md border border-neutral-200">
                            <table className="w-full text-body">
                                <thead>
                                    <tr className="border-b border-neutral-200 bg-neutral-50 text-caption uppercase text-neutral-500">
                                        <th className="px-3 py-2 text-start font-medium">
                                            {t('form16.table.month')}
                                        </th>
                                        <th className="px-3 py-2 text-end font-medium">
                                            {t('form16.table.incomePaid')}
                                        </th>
                                        <th className="px-3 py-2 text-end font-medium">
                                            {t('form16.table.tds')}
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.monthlyDetails.map((m, i) => (
                                        <tr
                                            key={`${m.month}-${m.year}-${i}`}
                                            className="border-b border-neutral-100 last:border-0"
                                        >
                                            <td className="px-3 py-2 text-neutral-700">
                                                {m.monthName || `${m.month}/${m.year}`}
                                            </td>
                                            <td className="px-3 py-2">
                                                <MoneyCell value={m.incomePaid ?? null} />
                                            </td>
                                            <td className="px-3 py-2">
                                                <MoneyCell value={m.tdsDeducted ?? null} />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : null}

                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        onAsyncClick={handleDownload}
                        loadingText={t('form16.actions.preparing')}
                    >
                        <DownloadSimple size={16} />
                        {t('form16.actions.downloadPdf')}
                    </MyButton>
                </>
            )}
        </div>
    );
};

export const Form24QPreview = ({
    financialYear,
    quarter,
}: {
    financialYear: string;
    quarter: string;
}) => {
    const { t } = useTranslation('erpTdsFilingPreviews');
    const query = useQuery({
        queryKey: [...ERP_KEY, '24q', financialYear, quarter],
        queryFn: () => fetchForm24Q(financialYear, quarter),
        enabled: !!getInstituteId(),
        staleTime: 5 * 60 * 1000,
    });
    const data = query.data;
    const rows = data?.deducteeRows ?? [];

    if (query.isLoading) return <HrLoadingRows rows={5} />;
    if (query.isError) {
        return (
            <HrErrorState
                message={t('form24q.errors.loadFailed')}
                onRetry={() => void query.refetch()}
            />
        );
    }

    return (
        <div className="flex flex-col gap-4">
            <ComplianceWarnings warnings={data?.warnings} />

            {/* The reconciliation signal: what was withheld vs what was actually deposited. */}
            <Card
                className={
                    data?.mismatch
                        ? 'flex flex-col gap-2 border-danger-200 bg-danger-50 p-4'
                        : 'flex flex-col gap-2 border-success-200 bg-success-50 p-4'
                }
            >
                <div
                    className={`flex items-center gap-2 ${data?.mismatch ? 'text-danger-600' : 'text-success-700'}`}
                >
                    {data?.mismatch ? <WarningCircle size={18} /> : <CheckCircle size={18} />}
                    <span className="text-subtitle font-medium">
                        {data?.mismatch
                            ? t('form24q.reconciliation.mismatch')
                            : t('form24q.reconciliation.matched')}
                    </span>
                </div>
                <div className="flex flex-wrap gap-6 text-body">
                    <span className="text-neutral-600">
                        {t('form24q.reconciliation.deducted')}{' '}
                        <MoneyCell
                            value={data?.totalTdsDeducted ?? null}
                            className="inline-block w-auto"
                        />
                    </span>
                    <span className="text-neutral-600">
                        {t('form24q.reconciliation.deposited')}{' '}
                        <MoneyCell
                            value={data?.totalChallanAmount ?? null}
                            className="inline-block w-auto"
                        />
                    </span>
                </div>
                {data?.mismatch && (
                    <p className="text-caption text-neutral-600">
                        {t('form24q.reconciliation.mismatchHint')}
                    </p>
                )}
            </Card>

            <div className="grid gap-3 sm:grid-cols-3">
                <ComplianceStat label={t('form24q.stats.deductees')} value={rows.length} />
                <ComplianceStat
                    label={t('form24q.stats.challans')}
                    value={data?.challans?.length ?? 0}
                />
                <ComplianceStat
                    label={t('form24q.stats.deductorTan')}
                    value={data?.deductor?.tan ?? '—'}
                />
            </div>

            <div className="overflow-x-auto rounded-md border border-neutral-200">
                <table className="w-full text-body">
                    <thead>
                        <tr className="border-b border-neutral-200 bg-neutral-50 text-caption uppercase text-neutral-500">
                            <th className="px-3 py-2 text-start font-medium">
                                {t('form24q.table.employee')}
                            </th>
                            <th className="px-3 py-2 text-end font-medium">
                                {t('form24q.table.pan')}
                            </th>
                            <th className="px-3 py-2 text-end font-medium">
                                {t('form24q.table.month')}
                            </th>
                            <th className="px-3 py-2 text-end font-medium">
                                {t('form24q.table.incomePaid')}
                            </th>
                            <th className="px-3 py-2 text-end font-medium">
                                {t('form24q.table.tds')}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((r, i) => (
                            <tr
                                key={`${r.employeeId ?? i}-${r.month}`}
                                className="border-b border-neutral-100 last:border-0"
                            >
                                <td className="px-3 py-2 text-neutral-700">
                                    {r.name || r.employeeCode || '—'}
                                </td>
                                <td className="px-3 py-2 text-end tabular-nums text-neutral-600">
                                    {r.pan || '—'}
                                </td>
                                <td className="px-3 py-2 text-end text-neutral-600">
                                    {r.monthName || r.month || '—'}
                                </td>
                                <td className="px-3 py-2">
                                    <MoneyCell value={r.incomePaid ?? null} />
                                </td>
                                <td className="px-3 py-2">
                                    <MoneyCell value={r.tdsDeducted ?? null} />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
