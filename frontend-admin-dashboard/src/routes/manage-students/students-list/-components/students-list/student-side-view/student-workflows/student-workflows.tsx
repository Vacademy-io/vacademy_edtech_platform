import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { format } from 'date-fns';
import {
    Robot,
    CheckCircle,
    XCircle,
    WarningCircle,
    MinusCircle,
    CircleNotch,
    CaretRight,
    Clock,
    ArrowClockwise,
    ArrowUUpLeft,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { MyButton } from '@/components/design-system/button';
import { StatusChip, type StatusType } from '@/components/design-system/status-chips';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { getUserWorkflowRunsQuery, retryWorkflowExecution } from '@/services/workflow-service';
import type {
    ExecutionLogStatus,
    UserWorkflowRun,
    UserWorkflowRunStep,
    WorkflowExecutionStatus,
} from '@/types/workflow/workflow-types';
import { ProfileEmpty, ProfileError, ProfileHero, ProfileSkeleton } from '../profile-ui';

const PAGE_SIZE = 20;

// ── Status presentation ───────────────────────────────────────────────────────

const RUN_CHIP: Record<WorkflowExecutionStatus, { text: string; status: StatusType }> = {
    COMPLETED: { text: 'Completed', status: 'SUCCESS' },
    FAILED: { text: 'Failed', status: 'DANGER' },
    PROCESSING: { text: 'Running', status: 'INFO' },
    PENDING: { text: 'Pending', status: 'INFO' },
    // A run that hit a long DELAY and is waiting to resume — mid-drip, not finished.
    PAUSED: { text: 'Waiting', status: 'WARNING' },
};

const stepIcon = (status: ExecutionLogStatus | null) => {
    switch (status) {
        case 'SUCCESS':
            return <CheckCircle weight="fill" className="size-4 shrink-0 text-success-500" />;
        case 'FAILED':
            return <XCircle weight="fill" className="size-4 shrink-0 text-danger-500" />;
        case 'PARTIAL_SUCCESS':
            return <WarningCircle weight="fill" className="size-4 shrink-0 text-warning-500" />;
        case 'SKIPPED':
            return <MinusCircle weight="fill" className="size-4 shrink-0 text-neutral-400" />;
        case 'RUNNING':
            return <CircleNotch className="size-4 shrink-0 animate-spin text-primary-500" />;
        default:
            return <Clock className="size-4 shrink-0 text-neutral-300" />;
    }
};

const isStepFailed = (status: ExecutionLogStatus | null) =>
    status === 'FAILED' || status === 'PARTIAL_SUCCESS';

/** "LEARNER_BATCH_ENROLLMENT" → "Learner batch enrollment". */
const humanizeEvent = (eventName: string | null) => {
    if (!eventName) return null;
    const words = eventName.replace(/_/g, ' ').toLowerCase().trim();
    return words.charAt(0).toUpperCase() + words.slice(1);
};

const formatWhen = (iso: string | null) => {
    if (!iso) return null;
    try {
        return format(new Date(iso), 'd MMM yyyy, h:mm a');
    } catch {
        return null;
    }
};

// ── Step row ──────────────────────────────────────────────────────────────────

function StepRow({ step }: { step: UserWorkflowRunStep }) {
    const [open, setOpen] = useState(false);
    const hasError = isStepFailed(step.status) && !!step.error_message;

    return (
        <li className="flex flex-col">
            <button
                type="button"
                disabled={!hasError}
                onClick={() => hasError && setOpen((v) => !v)}
                className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-caption text-neutral-600',
                    hasError ? 'cursor-pointer hover:bg-danger-50' : 'cursor-default'
                )}
            >
                {stepIcon(step.status)}
                <span className="min-w-0 flex-1 truncate">{step.node_name || step.node_type}</span>
                {step.execution_time_ms != null && (
                    <span className="shrink-0 text-2xs tabular-nums text-neutral-400">
                        {step.execution_time_ms}ms
                    </span>
                )}
                {hasError && (
                    <CaretRight
                        className={cn(
                            'size-3.5 shrink-0 text-danger-500 transition-transform',
                            open && 'rotate-90'
                        )}
                    />
                )}
            </button>
            {hasError && open && (
                <div className="ml-8 mr-2 mt-1 rounded-md border border-danger-200 bg-danger-50 px-3 py-2 text-2xs text-danger-600">
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

// ── Run card ──────────────────────────────────────────────────────────────────

function RunCard({
    run,
    onRetry,
    isRetrying,
}: {
    run: UserWorkflowRun;
    onRetry: (run: UserWorkflowRun) => void;
    isRetrying: boolean;
}) {
    const [stepsOpen, setStepsOpen] = useState(run.status === 'FAILED');
    const chip = RUN_CHIP[run.status] ?? RUN_CHIP.PENDING;
    const event = humanizeEvent(run.event_name);
    const when = formatWhen(run.started_at);

    const failedCount = run.steps.filter((s) => isStepFailed(s.status)).length;

    return (
        <div className="rounded-lg border border-neutral-200 bg-white p-3 shadow-sm">
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="truncate text-body font-semibold text-neutral-700">
                            {run.workflow_name || 'Workflow'}
                        </span>
                        <StatusChip text={chip.text} textSize="text-caption" status={chip.status} />
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-neutral-400">
                        {event && <span className="truncate">{event}</span>}
                        {event && when && <span aria-hidden>·</span>}
                        {when && <span>{when}</span>}
                    </div>
                    {run.retry_of_execution_id && (
                        <div className="mt-1 inline-flex items-center gap-1 rounded bg-neutral-100 px-1.5 py-0.5 text-2xs text-neutral-500">
                            <ArrowUUpLeft className="size-3" />
                            Re-run of an earlier attempt
                        </div>
                    )}
                </div>

                {/* Retry — always rendered so its absence is never ambiguous; when the
                    run can't be re-run the button is disabled and titled with why. */}
                <MyButton
                    buttonType="secondary"
                    scale="small"
                    disable={!run.retryable || isRetrying}
                    onClick={() => onRetry(run)}
                    title={run.retry_blocked_reason ?? 'Run this automation again for this person'}
                    className="shrink-0"
                >
                    <span className="flex items-center gap-1.5">
                        <ArrowClockwise
                            className={cn('size-3.5', isRetrying && 'animate-spin')}
                            weight="bold"
                        />
                        {isRetrying ? 'Starting…' : 'Retry'}
                    </span>
                </MyButton>
            </div>

            {run.status === 'FAILED' && run.error_message && (
                <div className="mt-2 rounded-md border border-danger-200 bg-danger-50 px-3 py-2 text-2xs text-danger-600">
                    <span className="block whitespace-pre-wrap break-words">
                        {run.error_message}
                    </span>
                </div>
            )}

            {!run.retryable && run.retry_blocked_reason && (
                <p className="mt-2 text-2xs italic text-neutral-400">{run.retry_blocked_reason}</p>
            )}

            {run.steps.length > 0 ? (
                <div className="mt-2 border-t border-neutral-100 pt-2">
                    <button
                        type="button"
                        onClick={() => setStepsOpen((v) => !v)}
                        className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-neutral-400 hover:text-neutral-600"
                    >
                        <CaretRight
                            className={cn('size-3 transition-transform', stepsOpen && 'rotate-90')}
                        />
                        {run.steps.length} step{run.steps.length === 1 ? '' : 's'}
                        {failedCount > 0 && (
                            <span className="text-danger-500">· {failedCount} failed</span>
                        )}
                    </button>
                    {stepsOpen && (
                        <ul className="mt-1 flex flex-col gap-0.5">
                            {run.steps.map((step, idx) => (
                                <StepRow
                                    key={step.log_id ?? `${step.node_template_id}:${idx}`}
                                    step={step}
                                />
                            ))}
                        </ul>
                    )}
                </div>
            ) : (
                <p className="mt-2 border-t border-neutral-100 pt-2 text-2xs text-neutral-400">
                    No steps were recorded for this run.
                </p>
            )}
        </div>
    );
}

// ── Tab ───────────────────────────────────────────────────────────────────────

interface StudentWorkflowsProps {
    userId: string;
    instituteId: string;
}

/**
 * "Workflows" tab on the learner side-view: the automations that ran FOR this
 * person, newest first, each expandable into its per-node steps with the error
 * behind any failed one — plus a Retry that re-runs it with the same inputs.
 *
 * Only runs the backend recorded a subject for appear here (V488 onwards). Older
 * runs are absent rather than guessed at, so the tab never shows an automation
 * that was actually about someone else.
 */
export const StudentWorkflows = ({ userId, instituteId }: StudentWorkflowsProps) => {
    const queryClient = useQueryClient();
    const [page, setPage] = useState(0);
    const [confirming, setConfirming] = useState<UserWorkflowRun | null>(null);

    const { data, isLoading, error, refetch } = useQuery({
        ...getUserWorkflowRunsQuery(userId, instituteId, page, PAGE_SIZE),
        // A retry (and any workflow still mid-flight) finishes server-side, so keep
        // the list moving on its own while the tab is open rather than making the
        // admin click refresh to find out whether the re-run worked.
        refetchInterval: (query) =>
            query.state.data?.content?.some(
                (run) => run.status === 'PROCESSING' || run.status === 'PENDING'
            )
                ? 5_000
                : false,
    });

    const retryMutation = useMutation({
        mutationFn: (executionId: string) => retryWorkflowExecution(executionId, instituteId),
        onSuccess: (response) => {
            toast.success(
                `Re-running "${response.workflow_name ?? 'workflow'}" — the new run will appear at the top.`
            );
            queryClient.invalidateQueries({ queryKey: ['USER_WORKFLOW_RUNS', userId] });
            // The new run lands first; jump back so the admin sees it.
            setPage(0);
        },
        onError: (err: unknown) => {
            // GlobalExceptionHandler returns ErrorInfo — a record of {url, ex, responseCode,
            // date}. The reason is in `ex`; there is no `message` field, so reading one would
            // always fall through to the generic text and hide why the retry was refused.
            const data = (err as { response?: { data?: { ex?: string; message?: string } } })
                ?.response?.data;
            toast.error(
                data?.ex ?? data?.message ?? 'Could not start the re-run. Please try again.'
            );
        },
    });

    const runs = data?.content ?? [];
    const totalPages = data?.total_pages ?? 1;
    const totalElements = data?.total_elements ?? runs.length;

    const failedRuns = runs.filter((r) => r.status === 'FAILED').length;

    if (isLoading) return <ProfileSkeleton blocks={3} />;

    if (error) {
        return (
            <ProfileError
                title="Couldn't load automations"
                hint="Something went wrong fetching this person's workflow runs."
                onRetry={() => refetch()}
            />
        );
    }

    if (runs.length === 0) {
        return (
            <ProfileEmpty
                icon={Robot}
                title="No automations have run for this person"
                hint="Workflows triggered for this learner — enrollment emails, follow-up reminders, drip messages — will be listed here once they fire."
            />
        );
    }

    return (
        <div className="flex flex-col gap-3">
            <ProfileHero
                eyebrow="Automations"
                title={`${totalElements} run${totalElements === 1 ? '' : 's'}`}
                subtitle={
                    failedRuns > 0
                        ? `${failedRuns} of the runs on this page failed`
                        : 'Every run on this page completed or is still going'
                }
                icon={Robot}
                tone={failedRuns > 0 ? 'danger' : 'primary'}
            />

            <div className="flex flex-col gap-2">
                {runs.map((run) => (
                    <RunCard
                        key={run.execution_id}
                        run={run}
                        onRetry={setConfirming}
                        isRetrying={
                            retryMutation.isPending && retryMutation.variables === run.execution_id
                        }
                    />
                ))}
            </div>

            {totalPages > 1 && (
                <div className="flex items-center justify-between border-t border-neutral-100 pt-3">
                    <span className="text-caption text-neutral-400">
                        Page {page + 1} of {totalPages}
                    </span>
                    <div className="flex gap-1.5">
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            onClick={() => setPage((p) => Math.max(0, p - 1))}
                            disable={page === 0}
                        >
                            Previous
                        </MyButton>
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                            disable={page >= totalPages - 1}
                        >
                            Next
                        </MyButton>
                    </div>
                </div>
            )}

            {/* Re-running is a real side effect — it sends the emails/WhatsApp messages
                and calls the webhooks again. Confirm before it goes out. */}
            <AlertDialog
                open={!!confirming}
                onOpenChange={(open) => {
                    if (!open) setConfirming(null);
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Re-run “{confirming?.workflow_name ?? 'this workflow'}”?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            This runs the automation again from the start with the same inputs it
                            had the first time. Any messages it sends — email, WhatsApp, SMS — and
                            any webhooks it calls will go out again. The original run is kept as-is
                            in this list.
                            {confirming?.status === 'PAUSED' && (
                                // A paused run is mid-drip: it is waiting on a DELAY and will
                                // resume on its own later. Re-running does not cancel that, so
                                // this person would be on two copies of the sequence at once.
                                <span className="mt-2 block font-semibold text-warning-600">
                                    This run is still waiting to continue on its own. Re-running it
                                    now means the person is in the sequence twice — the paused run
                                    will resume as scheduled as well.
                                </span>
                            )}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => {
                                if (confirming) retryMutation.mutate(confirming.execution_id);
                                setConfirming(null);
                            }}
                        >
                            Re-run it
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};
