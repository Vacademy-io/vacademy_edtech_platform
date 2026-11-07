import { useMemo, useState } from 'react';
import { DownloadSimple, Warning, CheckCircle, Info } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { getInstituteId } from '@/constants/helper';
import { ERP_PNL_SNAPSHOT_DOWNLOAD } from '@/constants/urls';
import { reportApiError } from '@/lib/report-api-error';
import { MyButton } from '@/components/design-system/button';
import { MoneyCell } from '@/components/design-system/money-cell';
import {
    MonthPicker,
    formatMonthValue,
    previousMonthValue,
    type MonthValue,
} from '@/components/design-system/month-picker';
import { Card } from '@/components/ui/card';
import { useHrRole } from '@/hooks/use-hr-role';
import {
    HrErrorState,
    HrLoadingRows,
    HrNoAccessCard,
} from '@/routes/erp/people/-components/HrStates';
import { PnlKpiCards } from './PnlKpiCards';
import { downloadBlobAsFile, monthFileStamp, usePnlSnapshot } from '../-hooks/use-finance';

/**
 * P&L Snapshot — what the institute collected against what it paid its people,
 * for one month.
 *
 * "Revenue" here is deliberately CASH COLLECTED (fee payments allocated in the
 * period), not billed or expected fees: the payroll side is also cash going out,
 * so comparing anything else would put two different bases on one line.
 */
export const PnlMain = () => {
    const { t } = useTranslation('erpPnlMain');
    const { isHrAdmin, isHrStaff } = useHrRole();
    const [period, setPeriod] = useState<MonthValue>(() => previousMonthValue());

    const { snapshot, isLoading, isError, refetch } = usePnlSnapshot(period, isHrStaff);

    const departments = useMemo(() => snapshot?.departments ?? [], [snapshot]);

    if (!isHrStaff) {
        return <HrNoAccessCard />;
    }

    const handleDownload = async () => {
        try {
            const { data } = await authenticatedAxiosInstance.get(ERP_PNL_SNAPSHOT_DOWNLOAD, {
                params: {
                    instituteId: getInstituteId(),
                    year: period.year,
                    month: period.month,
                },
                responseType: 'blob',
            });
            downloadBlobAsFile(data as Blob, `pnl_snapshot_${monthFileStamp(period)}.csv`);
            toast.success(t('toast.downloaded'));
        } catch (error) {
            reportApiError(error, {
                feature: 'erp-finance',
                fallbackMessage: t('errors.downloadFailed'),
            });
        }
    };

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-col gap-1">
                    <p className="text-body text-neutral-500">
                        {t('subtitle', { month: formatMonthValue(period) })}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <MonthPicker
                        value={period}
                        onChange={setPeriod}
                        disableFuture
                        label={t('periodLabel')}
                    />
                    {isHrAdmin && (
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            onAsyncClick={handleDownload}
                            loadingText={t('preparing')}
                            disabled={!snapshot}
                        >
                            <DownloadSimple size={16} />
                            {t('downloadCsv')}
                        </MyButton>
                    )}
                </div>
            </div>

            {isError ? (
                <HrErrorState
                    message={t('errors.loadFailed')}
                    onRetry={() => void refetch()}
                />
            ) : (
                <>
                    <PnlKpiCards snapshot={snapshot} isLoading={isLoading} />

                    {snapshot?.warnings?.length ? (
                        <Card className="flex flex-col gap-2 border-warning-200 bg-warning-50 p-4">
                            <div className="flex items-center gap-2 text-warning-700">
                                <Warning size={18} />
                                <span className="text-subtitle font-medium">
                                    {t('checkWarnings')}
                                </span>
                            </div>
                            <ul className="flex list-disc flex-col gap-1 ps-6 text-body text-neutral-600">
                                {snapshot.warnings.map((warning) => (
                                    <li key={warning}>{warning}</li>
                                ))}
                            </ul>
                        </Card>
                    ) : null}

                    {snapshot?.journal?.reported ? (
                        <Card
                            className={
                                snapshot.journal.posted
                                    ? 'flex items-center gap-2 border-success-200 bg-success-50 p-4 text-body text-success-700'
                                    : 'flex items-center gap-2 border-neutral-200 p-4 text-body text-neutral-600'
                            }
                        >
                            {snapshot.journal.posted ? (
                                <CheckCircle size={18} />
                            ) : (
                                <Info size={18} className="text-neutral-400" />
                            )}
                            <span>
                                {snapshot.journal.posted
                                    ? snapshot.journal.count
                                        ? t('journal.postedWithCount', {
                                              count: snapshot.journal.count,
                                          })
                                        : t('journal.posted')
                                    : t('journal.notPosted')}
                            </span>
                        </Card>
                    ) : null}

                    <Card className="flex flex-col gap-4 p-5">
                        <div className="flex flex-col gap-1">
                            <h3 className="text-subtitle font-semibold text-neutral-700">
                                {t('costByDepartment')}
                            </h3>
                            <p className="text-caption text-neutral-500">
                                {t('employerCostHint')}
                            </p>
                        </div>

                        {isLoading ? (
                            <HrLoadingRows rows={4} />
                        ) : departments.length === 0 ? (
                            <p className="py-6 text-center text-body text-neutral-500">
                                {t('noCostRecorded', { month: formatMonthValue(period) })}
                            </p>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-body">
                                    <thead>
                                        <tr className="border-b border-neutral-200 text-caption uppercase text-neutral-500">
                                            <th className="py-2 text-start font-medium">
                                                {t('columns.department')}
                                            </th>
                                            <th className="py-2 text-end font-medium">
                                                {t('columns.headcount')}
                                            </th>
                                            <th className="py-2 text-end font-medium">
                                                {t('columns.employerCost')}
                                            </th>
                                            <th className="py-2 text-end font-medium">
                                                {t('columns.share')}
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {departments.map((dept) => (
                                            <tr
                                                key={dept.key}
                                                className="border-b border-neutral-100 last:border-0"
                                            >
                                                <td className="py-2.5 text-neutral-700">
                                                    {dept.name}
                                                </td>
                                                <td className="py-2.5 text-end tabular-nums text-neutral-600">
                                                    {dept.headcount ?? '—'}
                                                </td>
                                                <td className="py-2.5">
                                                    <MoneyCell
                                                        value={dept.employerCost ?? null}
                                                        currency={snapshot?.currency}
                                                        dashOnZero
                                                    />
                                                </td>
                                                <td className="py-2.5 text-end tabular-nums text-neutral-600">
                                                    {dept.sharePct === undefined
                                                        ? '—'
                                                        : `${dept.sharePct.toFixed(1)}%`}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    {snapshot?.departmentTotal !== undefined && (
                                        <tfoot>
                                            <tr className="border-t border-neutral-200 font-medium">
                                                <td className="py-2.5 text-neutral-700">
                                                    {t('total')}
                                                </td>
                                                <td />
                                                <td className="py-2.5">
                                                    <MoneyCell
                                                        value={snapshot.departmentTotal}
                                                        currency={snapshot.currency}
                                                    />
                                                </td>
                                                <td />
                                            </tr>
                                        </tfoot>
                                    )}
                                </table>
                            </div>
                        )}
                    </Card>
                </>
            )}
        </div>
    );
};
