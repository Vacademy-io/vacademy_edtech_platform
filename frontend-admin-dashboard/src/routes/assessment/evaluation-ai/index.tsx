import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { ArrowClockwise, ArrowSquareOut, WarningCircle } from '@phosphor-icons/react';
import i18next from 'i18next';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { MyButton } from '@/components/design-system/button';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import {
    EvaluationProcessSummary,
    getEvaluationProcesses,
    triggerAIEvaluation,
} from '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-services/ai-evaluation-services';

export const Route = createFileRoute('/assessment/evaluation-ai/')({
    validateSearch: (search: Record<string, unknown>) => ({
        assessmentId: (search.assessmentId as string) ?? '',
    }),
    component: RouteComponent,
});

const TERMINAL = ['COMPLETED', 'FAILED', 'CANCELLED'];

type ChipTone = 'info' | 'success' | 'warning' | 'danger' | 'neutral';

const CHIP_CLASSES: Record<ChipTone, string> = {
    info: 'bg-primary-50 text-primary-600',
    success: 'bg-success-50 text-success-600',
    warning: 'bg-warning-100 text-warning-700',
    danger: 'bg-danger-50 text-danger-600',
    neutral: 'bg-neutral-100 text-neutral-600',
};

function statusChip(status: string, needsReview: number): { label: string; tone: ChipTone } {
    if (status === 'COMPLETED') {
        return needsReview > 0
            ? {
                  label: i18next.t('assessmentEvaluationAiIndex:status.needsReview', {
                      count: needsReview,
                  }),
                  tone: 'warning',
              }
            : { label: i18next.t('assessmentEvaluationAiIndex:status.completed'), tone: 'success' };
    }
    if (status === 'FAILED')
        return { label: i18next.t('assessmentEvaluationAiIndex:status.failed'), tone: 'danger' };
    if (status === 'CANCELLED')
        return { label: i18next.t('assessmentEvaluationAiIndex:status.cancelled'), tone: 'neutral' };
    return { label: i18next.t('assessmentEvaluationAiIndex:status.inProgress'), tone: 'info' };
}

function RouteComponent() {
    const { t } = useTranslation('assessmentEvaluationAiIndex');
    const { assessmentId } = Route.useSearch();
    const navigate = useNavigate();
    const queryClient = useQueryClient();

    const {
        data: processes,
        isLoading,
        error,
    } = useQuery({
        queryKey: ['EVALUATION_PROCESSES', assessmentId],
        queryFn: () => getEvaluationProcesses(assessmentId),
        enabled: !!assessmentId,
        // Keep polling while any run is still in progress.
        refetchInterval: (query) => {
            const rows = query?.state.data as EvaluationProcessSummary[] | undefined;
            const anyRunning = rows?.some((r) => !TERMINAL.includes(r.status));
            return anyRunning ? 8000 : false;
        },
    });

    const retryMutation = useMutation({
        mutationFn: (attemptId: string) => triggerAIEvaluation([attemptId]),
        onSuccess: (processIds, attemptId) => {
            toast.success(t('toasts.restartSuccess'));
            queryClient.invalidateQueries({ queryKey: ['EVALUATION_PROCESSES', assessmentId] });
            const newProcessId = processIds?.[0];
            if (newProcessId) {
                navigate({
                    to: '/assessment/evaluation-ai/$attemptId/$processId',
                    params: { attemptId, processId: newProcessId },
                });
            }
        },
        onError: () => toast.error(t('toasts.restartError')),
    });

    const openProcess = (row: EvaluationProcessSummary) => {
        navigate({
            to: '/assessment/evaluation-ai/$attemptId/$processId',
            params: { attemptId: row.attempt_id, processId: row.process_id },
        });
    };

    return (
        <LayoutContainer>
            <div className="flex flex-col gap-4 p-1">
                <div>
                    <h1 className="text-h3 font-semibold text-neutral-700">{t('header.title')}</h1>
                    <p className="text-body text-neutral-500">{t('header.subtitle')}</p>
                </div>

                {!assessmentId ? (
                    <Card>
                        <CardContent className="p-6 text-center text-neutral-500">
                            {t('emptyStates.noAssessment')}
                        </CardContent>
                    </Card>
                ) : isLoading ? (
                    <DashboardLoader />
                ) : error ? (
                    <Card>
                        <CardContent className="p-6 text-center text-danger-600">
                            {t('emptyStates.error')}
                        </CardContent>
                    </Card>
                ) : !processes || processes.length === 0 ? (
                    <Card>
                        <CardContent className="p-6 text-center text-neutral-500">
                            {t('emptyStates.noEvaluations')}
                        </CardContent>
                    </Card>
                ) : (
                    <div className="overflow-hidden rounded-lg border border-neutral-200">
                        <table className="w-full">
                            <thead className="bg-neutral-50">
                                <tr>
                                    <th className="p-3 text-left text-caption font-semibold uppercase text-neutral-500">
                                        {t('table.columns.participant')}
                                    </th>
                                    <th className="p-3 text-left text-caption font-semibold uppercase text-neutral-500">
                                        {t('table.columns.status')}
                                    </th>
                                    <th className="p-3 text-left text-caption font-semibold uppercase text-neutral-500">
                                        {t('table.columns.progress')}
                                    </th>
                                    <th className="p-3 text-left text-caption font-semibold uppercase text-neutral-500">
                                        {t('table.columns.started')}
                                    </th>
                                    <th className="p-3 text-right text-caption font-semibold uppercase text-neutral-500">
                                        {t('table.columns.actions')}
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-neutral-200 bg-white">
                                {processes.map((row) => {
                                    const needsReview = row.needs_review_count ?? 0;
                                    const chip = statusChip(row.status, needsReview);
                                    const isFailed = row.status === 'FAILED';
                                    return (
                                        <tr key={row.process_id} className="hover:bg-neutral-50">
                                            <td className="p-3 text-body font-medium text-neutral-700">
                                                {row.participant_name || t('table.unknownParticipant')}
                                            </td>
                                            <td className="p-3">
                                                <span
                                                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-caption font-medium ${CHIP_CLASSES[chip.tone]}`}
                                                >
                                                    {chip.tone === 'warning' && (
                                                        <WarningCircle size={12} weight="fill" />
                                                    )}
                                                    {chip.label}
                                                </span>
                                            </td>
                                            <td className="p-3 text-body text-neutral-600">
                                                {row.questions_total
                                                    ? `${row.questions_completed ?? 0}/${row.questions_total}`
                                                    : t('table.notAvailable')}
                                            </td>
                                            <td className="p-3 text-body text-neutral-500">
                                                {row.started_at
                                                    ? formatDistanceToNow(new Date(row.started_at), {
                                                          addSuffix: true,
                                                      })
                                                    : t('table.notAvailable')}
                                            </td>
                                            <td className="p-3">
                                                <div className="flex justify-end gap-2">
                                                    <MyButton
                                                        type="button"
                                                        buttonType="secondary"
                                                        scale="small"
                                                        onClick={() => openProcess(row)}
                                                    >
                                                        <ArrowSquareOut size={14} className="mr-1" />
                                                        {t('actions.open')}
                                                    </MyButton>
                                                    {isFailed && (
                                                        <MyButton
                                                            type="button"
                                                            buttonType="primary"
                                                            scale="small"
                                                            disabled={retryMutation.isPending}
                                                            onClick={() =>
                                                                retryMutation.mutate(row.attempt_id)
                                                            }
                                                        >
                                                            <ArrowClockwise
                                                                size={14}
                                                                className="mr-1"
                                                            />
                                                            {t('actions.retry')}
                                                        </MyButton>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </LayoutContainer>
    );
}
