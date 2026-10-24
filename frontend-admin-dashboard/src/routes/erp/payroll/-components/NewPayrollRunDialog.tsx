import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import {
    MonthPicker,
    previousMonthValue,
    type MonthValue,
} from '@/components/design-system/month-picker';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { buildRunTypeLabels, type PayrollRunType } from '@/routes/erp/-shared/payroll-status';
import type { CreateRunInput, CreateRunResult } from '@/routes/erp/payroll/-hooks/use-payroll-runs';

/**
 * What each run type actually pays.
 *
 * Picking the wrong type is the most expensive mistake available on this screen: a
 * REGULAR run pays everyone, while an OFF_CYCLE or BONUS run pays *nobody* if no
 * adjustment carries that scope — which looks identical to a broken run. So the
 * choice is never four bare labels; every option carries the sentence that says who
 * ends up on the payslip list.
 */
const buildRunTypeOptions = (
    t: TFunction
): { value: PayrollRunType; label: string; covers: string }[] => {
    const runTypeLabels = buildRunTypeLabels(t);
    return [
        {
            value: 'REGULAR',
            label: runTypeLabels.REGULAR,
            covers: t('runTypes.regular'),
        },
        {
            value: 'OFF_CYCLE',
            label: runTypeLabels.OFF_CYCLE,
            covers: t('runTypes.offCycle'),
        },
        {
            value: 'FNF',
            label: runTypeLabels.FNF,
            covers: t('runTypes.fnf'),
        },
        {
            value: 'BONUS',
            label: runTypeLabels.BONUS,
            covers: t('runTypes.bonus'),
        },
    ];
};

interface NewPayrollRunDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Creates the run; failures are already reported by the hook. */
    onCreate: (input: CreateRunInput) => Promise<CreateRunResult>;
    /** Only called when the new run's id could be resolved. */
    onCreated: (runId: string) => void;
}

/**
 * Create a payroll run for a month.
 *
 * Defaults to last month because that is the month you pay: an institute running
 * payroll on the 3rd wants August, not September. Future months are blocked
 * outright — there is no attendance to compute against yet.
 */
export const NewPayrollRunDialog = ({
    open,
    onOpenChange,
    onCreate,
    onCreated,
}: NewPayrollRunDialogProps) => {
    const { t } = useTranslation(['erpNewPayrollRunDialog', 'erpPayrollStatus']);
    const [period, setPeriod] = useState<MonthValue>(() => previousMonthValue());
    const [runType, setRunType] = useState<PayrollRunType>('REGULAR');
    const [notes, setNotes] = useState('');

    // Reopening should not inherit the last attempt's choices — a failed "already
    // exists" attempt would otherwise be re-submitted verbatim.
    useEffect(() => {
        if (open) {
            setPeriod(previousMonthValue());
            setRunType('REGULAR');
            setNotes('');
        }
    }, [open]);

    const submit = async () => {
        const result = await onCreate({ period, runType, notes });
        if (!result.created) return;
        toast.success(t('toast.created'));
        onOpenChange(false);
        // No id means the run exists but we cannot deep-link to it; the refreshed
        // list behind this dialog already shows it, so staying put is correct.
        if (result.runId) onCreated(result.runId);
    };

    const runTypeOptions = buildRunTypeOptions(t);

    return (
        <MyDialog
            heading={t('heading')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-xl"
            footer={
                <>
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('actions.cancel')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        onAsyncClick={submit}
                        loadingText={t('actions.creating')}
                    >
                        {t('actions.createRun')}
                    </MyButton>
                </>
            }
        >
            <div className="flex flex-col gap-6">
                <div className="flex flex-col gap-2">
                    <span className="text-body font-semibold text-neutral-700">
                        {t('fields.payrollMonth')}
                    </span>
                    <MonthPicker
                        value={period}
                        onChange={setPeriod}
                        disableFuture
                        className="w-full sm:w-auto"
                    />
                    <p className="text-caption text-neutral-500">{t('fields.monthHint')}</p>
                </div>

                <div className="flex flex-col gap-2">
                    <span className="text-body font-semibold text-neutral-700">
                        {t('fields.runType')}
                    </span>
                    <RadioGroup
                        value={runType}
                        onValueChange={(value) => setRunType(value as PayrollRunType)}
                        className="flex flex-col gap-2"
                    >
                        {runTypeOptions.map((option) => (
                            <label
                                key={option.value}
                                htmlFor={`run-type-${option.value}`}
                                className={cn(
                                    'flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors',
                                    runType === option.value
                                        ? 'border-primary-500 bg-primary-50'
                                        : 'border-neutral-200 hover:border-primary-200'
                                )}
                            >
                                <RadioGroupItem
                                    value={option.value}
                                    id={`run-type-${option.value}`}
                                    className="mt-1"
                                />
                                <span className="flex flex-col gap-1">
                                    <span className="text-body font-semibold text-neutral-700">
                                        {option.label}
                                    </span>
                                    <span className="text-caption text-neutral-500">
                                        {option.covers}
                                    </span>
                                </span>
                            </label>
                        ))}
                    </RadioGroup>
                </div>

                <div className="flex flex-col gap-2">
                    <label
                        htmlFor="payroll-run-notes"
                        className="text-body font-semibold text-neutral-700"
                    >
                        {t('fields.notes')}{' '}
                        <span className="font-regular text-neutral-400">
                            {t('fields.notesOptional')}
                        </span>
                    </label>
                    <Textarea
                        id="payroll-run-notes"
                        value={notes}
                        onChange={(event) => setNotes(event.target.value)}
                        rows={3}
                        placeholder={t('fields.notesPlaceholder')}
                    />
                </div>
            </div>
        </MyDialog>
    );
};
