import { Check, Prohibit } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { RUN_STEPS, type PayrollRunStatus } from '@/routes/erp/-shared/payroll-status';

interface RunStatusStepperProps {
    status: string | null | undefined;
    className?: string;
}

/**
 * Where a payroll run stands, as a four-step rail: Draft → Processed → Approved → Paid.
 *
 * A run is a sequence of irreversible-ish money events, and the single most
 * common question in front of it is "what has already happened and what is next".
 * PROCESSING renders as Draft-in-progress (it is a transient server state, not a
 * milestone); CANCELLED replaces the rail entirely, because a cancelled run has
 * no position on the happy path.
 */
const STEP_LABEL_KEYS: Record<PayrollRunStatus, string> = {
    DRAFT: 'steps.draft',
    PROCESSING: 'steps.processing',
    PROCESSED: 'steps.processed',
    APPROVED: 'steps.approved',
    PAID: 'steps.paid',
    CANCELLED: 'steps.cancelled',
};

export const RunStatusStepper = ({ status, className }: RunStatusStepperProps) => {
    const { t } = useTranslation('erpRunStatusStepper');
    const current = (status ?? '').toUpperCase();

    if (current === 'CANCELLED') {
        return (
            <div
                className={cn(
                    'flex items-center gap-2 rounded-md bg-danger-50 px-3 py-2 text-body text-danger-600',
                    className
                )}
            >
                <Prohibit size={18} />
                <span>{t('cancelledMessage')}</span>
            </div>
        );
    }

    // PROCESSING sits between Draft and Processed: Draft is done, nothing else is.
    const effective = current === 'PROCESSING' ? 'DRAFT' : current;
    const activeIndex = RUN_STEPS.indexOf(effective as PayrollRunStatus);

    return (
        <ol className={cn('flex flex-wrap items-center gap-y-2', className)}>
            {RUN_STEPS.map((step, index) => {
                const isDone = activeIndex > index;
                const isCurrent = activeIndex === index;
                const isBusy = isCurrent && current === 'PROCESSING';

                return (
                    <li key={step} className="flex items-center">
                        <div className="flex items-center gap-2">
                            <span
                                className={cn(
                                    'flex size-6 shrink-0 items-center justify-center rounded-full border text-caption font-medium',
                                    isDone && 'border-success-500 bg-success-500 text-white',
                                    isCurrent &&
                                        !isBusy &&
                                        'border-primary-500 bg-primary-50 text-primary-500',
                                    isBusy && 'animate-pulse border-warning-500 bg-warning-50 text-warning-600',
                                    !isDone && !isCurrent && 'border-neutral-200 text-neutral-400'
                                )}
                            >
                                {isDone ? <Check size={13} weight="bold" /> : index + 1}
                            </span>
                            <span
                                className={cn(
                                    'text-body',
                                    isDone && 'text-neutral-500',
                                    isCurrent && 'font-medium text-neutral-700',
                                    !isDone && !isCurrent && 'text-neutral-400'
                                )}
                            >
                                {isBusy ? t('processing') : t(STEP_LABEL_KEYS[step])}
                            </span>
                        </div>
                        {index < RUN_STEPS.length - 1 && (
                            <span
                                aria-hidden
                                className={cn(
                                    'mx-3 h-px w-8',
                                    isDone ? 'bg-success-500' : 'bg-neutral-200'
                                )}
                            />
                        )}
                    </li>
                );
            })}
        </ol>
    );
};
