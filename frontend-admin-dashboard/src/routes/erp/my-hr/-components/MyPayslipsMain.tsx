import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { DownloadSimple, FileText } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDropdown } from '@/components/design-system/dropdown';
import { MoneyCell } from '@/components/design-system/money-cell';
import { formatMonthValue } from '@/components/design-system/month-picker';
import { Card } from '@/components/ui/card';
import { formatDate } from '@/lib/formatters';
import { reportApiError } from '@/lib/report-api-error';
import { downloadPayslipPdf } from '@/routes/erp/-shared/hr-service';
import type { Money, PayslipDTO } from '@/routes/erp/-shared/hr-types';
import {
    HrEmptyState,
    HrErrorState,
    HrLoadingRows,
} from '@/routes/erp/people/-components/HrStates';
import { useMyHrIdentity, useMyPayslips } from '@/routes/erp/my-hr/-hooks/use-my-hr';
import { MyHrNoProfileState, MyHrStatusChip } from './my-hr-shared';

/**
 * A payslip as the API might one day return it.
 *
 * `PayslipDTO` carries no net-pay field — the amount lives on the payroll ENTRY,
 * which is an HR-staff read — so the column is rendered only when the payload
 * actually has a figure on it. A permanently dashed "Net pay" column is worse
 * than none: it reads as "we paid you nothing".
 */
interface MyPayslipRow extends PayslipDTO {
    net_pay?: Money;
    net_salary?: Money;
}

const netPayOf = (payslip: MyPayslipRow): Money | undefined =>
    payslip.net_pay ?? payslip.net_salary;

/** The years someone realistically looks back over for a payslip. */
const payslipYears = (): number[] => {
    const current = new Date().getFullYear();
    return Array.from({ length: 5 }, (_, index) => current - index);
};

/**
 * The employee's own payslips for a year.
 *
 * Download is per row and goes through the authenticated blob endpoint — the
 * file is not on a public URL, so there is nothing to link to and the bytes have
 * to be fetched with the session's token before they can be saved.
 */
export const MyPayslipsMain = () => {
    const { t } = useTranslation('erpMyPayslipsMain');
    const { employeeId, isProfileLoading, hasNoProfile } = useMyHrIdentity();
    const [year, setYear] = useState<number>(() => new Date().getFullYear());
    const [downloadingId, setDownloadingId] = useState<string | null>(null);

    const query = useMyPayslips(employeeId, year);

    const payslips = useMemo(
        () =>
            [...((query.data ?? []) as MyPayslipRow[])].sort(
                (a, b) => (b.month ?? 0) - (a.month ?? 0)
            ),
        [query.data]
    );

    const showNetPay = useMemo(
        () => payslips.some((payslip) => netPayOf(payslip) != null),
        [payslips]
    );

    const download = async (payslip: MyPayslipRow) => {
        if (!payslip.id) return;
        setDownloadingId(payslip.id);
        try {
            await downloadPayslipPdf(
                payslip.id,
                `payslip_${payslip.year ?? year}_${String(payslip.month ?? '').padStart(2, '0')}.pdf`
            );
            toast.success(t('toasts.downloaded'));
        } catch (error) {
            reportApiError(error, {
                feature: 'erp-my-hr',
                tags: { action: 'download-my-payslip' },
                fallbackMessage: t('errors.downloadFailed'),
            });
        } finally {
            setDownloadingId(null);
        }
    };

    if (isProfileLoading) return <HrLoadingRows rows={4} />;
    if (hasNoProfile) return <MyHrNoProfileState />;

    return (
        <div className="flex flex-col gap-5">
            <p className="max-w-3xl text-body text-muted-foreground">{t('intro')}</p>

            <div className="flex flex-wrap items-center gap-3">
                <span className="text-caption text-muted-foreground">{t('yearLabel')}</span>
                <MyDropdown
                    currentValue={String(year)}
                    dropdownList={payslipYears().map(String)}
                    handleChange={(value) => setYear(Number(value))}
                />
                {!query.isLoading && !query.isError && payslips.length > 0 && (
                    <span className="text-caption text-muted-foreground">
                        {t('payslipCount', { count: payslips.length })}
                    </span>
                )}
            </div>

            {query.isLoading ? (
                <HrLoadingRows rows={4} />
            ) : query.isError ? (
                <HrErrorState message={t('errors.loadFailed')} onRetry={() => void query.refetch()} />
            ) : payslips.length === 0 ? (
                <HrEmptyState
                    icon={<FileText size={40} className="text-muted-foreground" />}
                    title={t('emptyState.title', { year })}
                    description={t('emptyState.description')}
                />
            ) : (
                <div className="flex flex-col gap-2">
                    {payslips.map((payslip) => (
                        <Card
                            key={payslip.id}
                            className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                        >
                            <div className="flex flex-col gap-1">
                                <span className="text-subtitle font-medium text-foreground">
                                    {formatMonthValue({
                                        month: payslip.month ?? 1,
                                        year: payslip.year ?? year,
                                    })}
                                </span>
                                <span className="text-caption text-muted-foreground">
                                    {payslip.generated_at
                                        ? t('issuedOn', { date: formatDate(payslip.generated_at) })
                                        : t('issueDateUnknown')}
                                </span>
                            </div>

                            <div className="flex flex-wrap items-center gap-4">
                                {showNetPay && (
                                    <div className="flex flex-col gap-0.5">
                                        <span className="text-caption text-muted-foreground">
                                            {t('netPay')}
                                        </span>
                                        <MoneyCell
                                            value={netPayOf(payslip) ?? null}
                                            currency={payslip.currency}
                                            className="text-start"
                                        />
                                    </div>
                                )}
                                <div className="flex flex-col gap-0.5">
                                    <span className="text-caption text-muted-foreground">
                                        {t('emailedToYou')}
                                    </span>
                                    <MyHrStatusChip status={payslip.email_status} />
                                </div>
                                <MyButton
                                    buttonType="secondary"
                                    scale="small"
                                    type="button"
                                    disable={downloadingId === payslip.id}
                                    onAsyncClick={() => download(payslip)}
                                    loadingText={t('downloading')}
                                >
                                    <DownloadSimple size={16} /> {t('download')}
                                </MyButton>
                            </div>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
};
