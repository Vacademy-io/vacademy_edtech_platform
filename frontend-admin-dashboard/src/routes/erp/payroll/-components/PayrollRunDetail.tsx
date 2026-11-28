import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft, NotePencil } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { formatMonthValue } from '@/components/design-system/month-picker';
import { StatusChip } from '@/components/design-system/status-chips';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useHrRole } from '@/hooks/use-hr-role';
import { RunStatusStepper } from '@/routes/erp/-shared/RunStatusStepper';
import {
    buildRunStatusLabels,
    buildRunTypeLabels,
    runStatusChipType,
    type PayrollRunStatus,
    type PayrollRunType,
} from '@/routes/erp/-shared/payroll-status';
import { HrErrorState, HrNoAccessCard } from '@/routes/erp/people/-components/HrStates';
import { usePayrollRun } from '@/routes/erp/payroll/-hooks/use-payroll-run';
import { PayrollEntriesTab } from './PayrollEntriesTab';
import { PayrollErrorsTab } from './PayrollErrorsTab';
import { PayslipsTab } from './PayslipsTab';
import { BankFileTab } from './BankFileTab';
import { RunActionBar } from './RunActionBar';
import { RunKpiCards } from './RunKpiCards';

/**
 * A single payroll run, end to end.
 *
 * Reads top-down as the question sequence somebody actually has in front of a run:
 * which month and where is it in its lifecycle (header + stepper), what does it cost
 * (KPIs), what can I do about it (action bar), who is on it (entries), and who is
 * missing (errors).
 */
export const PayrollRunDetail = ({
    runId,
    onPeriodResolved,
}: {
    runId: string;
    /** Lets the route lift the resolved period into the nav heading. */
    onPeriodResolved?: (period: string) => void;
}) => {
    const { t } = useTranslation(['erpPayrollRunDetail', 'erpPayrollStatus']);
    const navigate = useNavigate();
    const { isHrAdmin, isHrStaff } = useHrRole();
    const [tab, setTab] = useState('entries');

    const {
        run,
        entries,
        errors,
        transitions,
        isRunLoading,
        isRunError,
        isEntriesLoading,
        isEntriesError,
        isErrorsLoading,
        isErrorsError,
        refetchRun,
        refetchEntries,
        refetchErrors,
        process,
        approve,
        reject,
        markPaid,
        cancel,
        holdEntry,
        releaseEntry,
    } = usePayrollRun(runId);

    const period =
        run?.month && run?.year ? formatMonthValue({ month: run.month, year: run.year }) : '';

    useEffect(() => {
        if (period && onPeriodResolved) onPeriodResolved(period);
    }, [period, onPeriodResolved]);

    const backToRuns = () => void navigate({ to: '/erp/payroll' });

    if (!isHrStaff) return <HrNoAccessCard />;

    if (isRunError) {
        return (
            <div className="flex flex-col gap-4">
                <MyButton buttonType="text" scale="small" onClick={backToRuns}>
                    <ArrowLeft size={14} />
                    {t('backToRuns')}
                </MyButton>
                <HrErrorState message={t('errors.loadFailed')} onRetry={() => void refetchRun()} />
            </div>
        );
    }

    const runType = (run?.run_type ?? 'REGULAR').toUpperCase() as PayrollRunType;
    const status = (run?.status ?? '').toUpperCase() as PayrollRunStatus;
    const errorCount = errors.length;
    const runTypeLabels = buildRunTypeLabels(t);
    const runStatusLabels = buildRunStatusLabels(t);

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-4">
                <MyButton buttonType="text" scale="small" onClick={backToRuns}>
                    <ArrowLeft size={14} />
                    {t('backToRuns')}
                </MyButton>

                {isRunLoading || !run ? (
                    <div className="flex flex-col gap-3">
                        <Skeleton className="h-8 w-64" />
                        <Skeleton className="h-6 w-96" />
                    </div>
                ) : (
                    <div className="flex flex-col gap-4">
                        <div className="flex flex-wrap items-center gap-3">
                            <h2 className="text-h2 text-neutral-700">
                                {period || t('fallbackHeading')}
                            </h2>
                            <StatusChip
                                text={runTypeLabels[runType] ?? run.run_type ?? t('fallbackRunType')}
                                textSize="text-caption"
                                status="INFO"
                                showIcon={false}
                            />
                            <StatusChip
                                text={runStatusLabels[status] ?? run.status ?? '—'}
                                textSize="text-caption"
                                status={runStatusChipType(run.status)}
                                showIcon={false}
                            />
                        </div>
                        <RunStatusStepper status={run.status} />
                        {run.notes && (
                            <p className="flex items-start gap-2 text-caption text-neutral-500">
                                <NotePencil size={14} className="mt-1 shrink-0" />
                                <span>{run.notes}</span>
                            </p>
                        )}
                    </div>
                )}
            </div>

            <RunKpiCards run={run} isLoading={isRunLoading} />

            {run && (
                <RunActionBar
                    run={run}
                    transitions={transitions}
                    isHrAdmin={isHrAdmin}
                    onProcess={process}
                    onApprove={approve}
                    onReject={reject}
                    onMarkPaid={markPaid}
                    onCancel={cancel}
                />
            )}

            <Tabs value={tab} onValueChange={setTab} className="flex flex-col gap-4">
                <TabsList className="w-fit">
                    <TabsTrigger value="entries">
                        {t('tabs.entries', { count: entries.length })}
                    </TabsTrigger>
                    <TabsTrigger value="errors" className="flex items-center gap-2">
                        {t('tabs.errors')}
                        {errorCount > 0 && (
                            <Badge variant="destructive" className="px-2">
                                {errorCount}
                            </Badge>
                        )}
                    </TabsTrigger>
                    <TabsTrigger value="payslips">{t('tabs.payslips')}</TabsTrigger>
                    <TabsTrigger value="bank-file">{t('tabs.bankFile')}</TabsTrigger>
                </TabsList>

                <TabsContent value="entries" className="mt-0">
                    <PayrollEntriesTab
                        entries={entries}
                        isLoading={isEntriesLoading}
                        isError={isEntriesError}
                        onRetry={() => void refetchEntries()}
                        canEditEntries={transitions.canEditEntries}
                        isHrAdmin={isHrAdmin}
                        onHold={holdEntry}
                        onRelease={releaseEntry}
                    />
                </TabsContent>

                <TabsContent value="errors" className="mt-0">
                    <PayrollErrorsTab
                        errors={errors}
                        isLoading={isErrorsLoading}
                        isError={isErrorsError}
                        onRetry={() => void refetchErrors()}
                    />
                </TabsContent>

                <TabsContent value="payslips" className="mt-0">
                    <PayslipsTab
                        runId={runId}
                        run={run}
                        entries={entries}
                        isEntriesLoading={isEntriesLoading}
                        isHrAdmin={isHrAdmin}
                    />
                </TabsContent>

                <TabsContent value="bank-file" className="mt-0">
                    <BankFileTab runId={runId} run={run} isHrAdmin={isHrAdmin} />
                </TabsContent>
            </Tabs>
        </div>
    );
};
