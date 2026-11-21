import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    CheckCircle,
    XCircle,
    WarningCircle,
    MinusCircle,
    CircleNotch,
    CaretRight,
    Clock,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { StatusChip, type StatusType } from '@/components/design-system/status-chips';
import { getEnrollmentWorkflowRunsQuery } from '@/services/workflow-service';
import type {
    EnrollmentWorkflowRun,
    EnrollmentWorkflowStep,
    ExecutionLogStatus,
    WorkflowExecutionStatus,
} from '@/types/workflow/workflow-types';

interface EnrollmentWorkflowStatusProps {
    instituteId: string;
    /** Package session ids whose enrollment workflow runs should be shown. */
    packageSessionIds: string[];
    /** Heading shown above the runs. Defaults to "Enrollment workflow". */
    title?: string;
    className?: string;
    /** When true, render a compact card-less list (for embedding inside dialogs). */
    embedded?: boolean;
    /**
     * Poll interval in ms. Useful right after enrollment, where the workflow
     * fires asynchronously (post-commit) and the run may not exist yet on the
     * first fetch. Omit to disable polling.
     */
    pollMs?: number;
}

const stepIcon = (status: ExecutionLogStatus | null) => {
    switch (status) {
        case 'SUCCESS':
            return <CheckCircle weight="fill" className="size-5 shrink-0 text-success-500" />;
        case 'FAILED':
            return <XCircle weight="fill" className="size-5 shrink-0 text-danger-500" />;
        case 'PARTIAL_SUCCESS':
            return <WarningCircle weight="fill" className="size-5 shrink-0 text-warning-500" />;
        case 'SKIPPED':
            return <MinusCircle weight="fill" className="size-5 shrink-0 text-neutral-400" />;
        case 'RUNNING':
            return <CircleNotch className="size-5 shrink-0 animate-spin text-primary-500" />;
        default:
            // null / undefined => not yet run (pending / waiting to start).
            return <Clock className="size-5 shrink-0 text-neutral-300" />;
    }
};

const overallChip: Record<WorkflowExecutionStatus, { text: string; status: StatusType }> = {
    COMPLETED: { text: 'Completed', status: 'SUCCESS' },
    FAILED: { text: 'Failed', status: 'DANGER' },
    PROCESSING: { text: 'In progress', status: 'INFO' },
    PENDING: { text: 'Pending', status: 'INFO' },
    PAUSED: { text: 'Paused', status: 'WARNING' },
};

const isStepFailed = (status: ExecutionLogStatus | null) =>
    status === 'FAILED' || status === 'PARTIAL_SUCCESS';

function WorkflowStepRow({ step }: { step: EnrollmentWorkflowStep }) {
    const [open, setOpen] = useState(false);
    const hasError = isStepFailed(step.status) && !!step.error_message;

    return (
        <li className="flex flex-col">
            <button
                type="button"
                disabled={!hasError}
                onClick={() => hasError && setOpen((v) => !v)}
                className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body text-neutral-600',
                    hasError && 'hover:bg-danger-50 cursor-pointer',
                    !hasError && 'cursor-default'
                )}
            >
                {stepIcon(step.status)}
                <span className="flex-1 truncate">{step.node_name || step.node_type}</span>
                {hasError && (
                    <CaretRight
                        className={cn(
                            'size-4 shrink-0 text-danger-500 transition-transform',
                            open && 'rotate-90'
                        )}
                    />
                )}
            </button>
            {hasError && open && (
                <div className="ml-9 mr-2 mt-1 rounded-md border border-danger-200 bg-danger-50 px-3 py-2 text-caption text-danger-600">
                    {step.error_type && (
                        <span className="block font-semibold">{step.error_type}</span>
                    )}
                    <span className="block whitespace-pre-wrap break-words">
                        {step.error_message}
                    </span>
                </div>
            )}
        </li>
    );
}

function WorkflowRunCard({ run }: { run: EnrollmentWorkflowRun }) {
    const chip = overallChip[run.status] ?? overallChip.PENDING;
    return (
        <div className="rounded-lg border border-neutral-200 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
                <span className="truncate text-subtitle font-semibold text-neutral-700">
                    {run.workflow_name || 'Workflow'}
                </span>
                <StatusChip text={chip.text} textSize="text-caption" status={chip.status} />
            </div>
            {run.status === 'FAILED' && run.error_message && (
                <div className="mb-2 rounded-md border border-danger-200 bg-danger-50 px-3 py-2 text-caption text-danger-600">
                    {run.error_message}
                </div>
            )}
            <ul className="flex flex-col gap-0.5">
                {run.steps.map((step, idx) => (
                    <WorkflowStepRow
                        key={step.log_id ?? step.node_template_id ?? idx}
                        step={step}
                    />
                ))}
                {run.steps.length === 0 && (
                    <li className="px-2 py-1.5 text-caption text-neutral-400">
                        No steps have run yet.
                    </li>
                )}
            </ul>
        </div>
    );
}

/**
 * Renders the enrollment workflow run(s) attached to a learner's enrollment or a
 * course's package sessions as a tick/cross checklist. Each failed step is
 * clickable to reveal its error. Renders nothing when no workflow is attached, so
 * it is safe to drop anywhere an enrollment/course context is available.
 */
export function EnrollmentWorkflowStatus({
    instituteId,
    packageSessionIds,
    title = 'Enrollment workflow',
    className,
    embedded = false,
    pollMs,
}: EnrollmentWorkflowStatusProps) {
    const { data: runs, isLoading } = useQuery({
        ...getEnrollmentWorkflowRunsQuery(instituteId, packageSessionIds),
        refetchInterval: pollMs ?? false,
    });

    if (isLoading) {
        return (
            <div className={cn('flex items-center gap-2 text-caption text-neutral-400', className)}>
                <CircleNotch className="size-4 animate-spin" />
                Checking enrollment workflow…
            </div>
        );
    }

    if (!runs || runs.length === 0) {
        // No workflow attached to this enrollment/course — render nothing.
        return null;
    }

    return (
        <div
            className={cn(
                'flex flex-col gap-3',
                !embedded && 'rounded-xl border border-neutral-200 bg-white p-4',
                className
            )}
        >
            <span className="text-subtitle font-semibold text-neutral-700">{title}</span>
            {runs.map((run) => (
                <WorkflowRunCard
                    key={run.execution_id ?? `${run.workflow_id}:${run.event_id}`}
                    run={run}
                />
            ))}
        </div>
    );
}
