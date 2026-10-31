import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { BookOpen, DownloadSimple } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MoneyCell } from '@/components/design-system/money-cell';
import {
    MonthPicker,
    formatMonthValue,
    previousMonthValue,
    type MonthValue,
} from '@/components/design-system/month-picker';
import { Card, CardContent } from '@/components/ui/card';
import { useHrRole } from '@/hooks/use-hr-role';
import { reportApiError } from '@/lib/report-api-error';
import { downloadJournalCsv } from '@/routes/erp/-shared/hr-service';
import {
    HrEmptyState,
    HrErrorState,
    HrLoadingRows,
    HrNoAccessCard,
} from '@/routes/erp/people/-components/HrStates';
import { downloadBlobAsFile, monthFileStamp, useJournal } from '../-hooks/use-finance';
import { JournalEntryCard } from './JournalEntryCard';

const toAmount = (value: number | string | null | undefined): number => {
    const numeric = typeof value === 'string' ? Number(value) : (value ?? 0);
    return Number.isFinite(numeric) ? numeric : 0;
};

/**
 * The month's accounting journal.
 *
 * Read-only, and deliberately so: nothing on this screen posts to the ledger.
 * Entries land here when a payroll run is approved and are reversed when that run
 * is rejected, which is why the empty state points at payroll rather than offering
 * a "create entry" button that would not exist server-side.
 *
 * Defaults to last month for the same reason payroll does — you close a month
 * after it ends, so the month you came to look at is almost never the current one.
 */
export const JournalMain = () => {
    const { t } = useTranslation('erpJournalMain');
    const { isHrAdmin, isHrStaff } = useHrRole();
    const [period, setPeriod] = useState<MonthValue>(() => previousMonthValue());

    const { entries, isLoading, isError, refetch } = useJournal(period, isHrStaff);

    const totals = useMemo(() => {
        const debit = entries.reduce((sum, entry) => sum + toAmount(entry.total_debit), 0);
        const credit = entries.reduce((sum, entry) => sum + toAmount(entry.total_credit), 0);
        return { debit, credit, currency: entries[0]?.currency };
    }, [entries]);

    if (!isHrStaff) return <HrNoAccessCard />;

    const exportCsv = async () => {
        try {
            const blob = await downloadJournalCsv(period.year, period.month);
            downloadBlobAsFile(blob, `journal-${monthFileStamp(period)}.csv`);
            toast.success(t('toasts.downloaded', { period: formatMonthValue(period) }));
        } catch (error) {
            reportApiError(error, {
                feature: 'erp-finance',
                tags: { action: 'export-journal' },
                extra: { month: period.month, year: period.year },
                fallbackMessage: t('errors.exportFailed'),
            });
        }
    };

    return (
        <div className="flex flex-col gap-4">
            <p className="max-w-3xl text-body text-muted-foreground">{t('intro')}</p>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <MonthPicker
                    label={t('periodLabel')}
                    value={period}
                    onChange={setPeriod}
                    disableFuture
                />
                {isHrAdmin && (
                    <div className="flex flex-col items-start gap-1 sm:items-end">
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            onAsyncClick={exportCsv}
                            loadingText={t('preparingCsv')}
                        >
                            <DownloadSimple size={16} />
                            {t('exportCsv')}
                        </MyButton>
                        <span className="text-caption text-muted-foreground">
                            {t('exportHint')}
                        </span>
                    </div>
                )}
            </div>

            {isError ? (
                <HrErrorState
                    message={t('errors.loadFailed', { period: formatMonthValue(period) })}
                    onRetry={refetch}
                />
            ) : isLoading ? (
                <HrLoadingRows rows={4} />
            ) : entries.length === 0 ? (
                <HrEmptyState
                    icon={<BookOpen size={40} className="text-muted-foreground" />}
                    title={t('emptyState.title', { period: formatMonthValue(period) })}
                    description={t('emptyState.description')}
                />
            ) : (
                <div className="flex flex-col gap-3">
                    <Card>
                        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
                            <span className="text-body text-muted-foreground">
                                {t('entriesPosted', {
                                    count: entries.length,
                                    period: formatMonthValue(period),
                                })}
                            </span>
                            <div className="flex items-center gap-4">
                                <span className="flex flex-col">
                                    <span className="text-caption text-muted-foreground">
                                        {t('totalDebits')}
                                    </span>
                                    <MoneyCell
                                        value={totals.debit}
                                        currency={totals.currency}
                                        className="text-body font-semibold text-foreground"
                                    />
                                </span>
                                <span className="flex flex-col">
                                    <span className="text-caption text-muted-foreground">
                                        {t('totalCredits')}
                                    </span>
                                    <MoneyCell
                                        value={totals.credit}
                                        currency={totals.currency}
                                        className="text-body font-semibold text-foreground"
                                    />
                                </span>
                            </div>
                        </CardContent>
                    </Card>

                    {entries.map((entry, index) => (
                        <JournalEntryCard
                            key={entry.id ?? `${entry.reference ?? 'entry'}-${index}`}
                            entry={entry}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};
