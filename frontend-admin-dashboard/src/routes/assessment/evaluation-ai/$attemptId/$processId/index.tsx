import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router';
import {
    Circle,
    CheckCircle,
    WarningCircle,
    PencilSimple,
    CaretLeft,
    CircleNotch,
    Clock,
    FileText,
    ListChecks,
    Percent,
    Trophy,
    X,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { ChipToggleGroup } from '@/components/design-system/chips';
import { cn } from '@/lib/utils';
import {
    AssessmentTag,
    type Tone,
} from '@/routes/assessment/assessment-list/-components/assessment-presentation';
import { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import { Card, CardContent } from '@/components/ui/card';
import { MyButton } from '@/components/design-system/button';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
    getEvaluationProgress,
    overrideQuestionEvaluation,
    useStopEvaluation,
} from '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-services/ai-evaluation-services';
import { getInstituteId } from '@/constants/helper';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { getAssessmentDetails } from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-services/assessment-services';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { getQuestionsDataForStep2 } from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-services/assessment-services';
import { getEvaluationDataFromStorage } from '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-services/ai-evaluation-services';
import TipTapEditor from '@/components/tiptap/TipTapEditor';
import LatexRenderer from '../../-components/latex-renderer';
import {
    getAssessmentTotalMarks,
    getAttemptDetails,
} from '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-services/assessment-details-services';

import { getPublicUrl } from '@/services/upload_file';
import SimplePDFViewer from '@/components/common/simple-pdf-viewer';
import {
    PdfAnnotationOverlay,
    type Annotation,
    type LayoutMap,
    type QuestionScoreMarker,
} from './-components/PdfAnnotationOverlay';
import { RubricChangedBadge } from './-components/RubricChangedBadge';
import { parseReviewMeta, type ReviewAttribution } from './-utils/review-meta';
import { getLayoutMap } from '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-services/ai-evaluation-services';

export const Route = createFileRoute('/assessment/evaluation-ai/$attemptId/$processId/')({
    component: RouteComponent,
});

const showStatusMessage = (status: string) => {
    switch (status) {
        case 'PENDING':
            return i18next.t('assessmentEvaluationAi:status.pending');
        case 'IN_PROGRESS':
            return i18next.t('assessmentEvaluationAi:status.inProgress');
        case 'STARTED':
            return i18next.t('assessmentEvaluationAi:status.initiated');
        case 'PROCESSING':
            return i18next.t('assessmentEvaluationAi:status.processing');
        case 'EXTRACTING':
            return i18next.t('assessmentEvaluationAi:status.extracting');
        case 'EVALUATING':
            return i18next.t('assessmentEvaluationAi:status.evaluating');
        case 'GRADING':
            return i18next.t('assessmentEvaluationAi:status.grading');
        case 'COMPLETED':
            return i18next.t('assessmentEvaluationAi:status.completed');
        case 'FAILED':
            return i18next.t('assessmentEvaluationAi:status.failed');
        case 'CANCELLED':
            return i18next.t('assessmentEvaluationAi:status.cancelled');
        default:
            return i18next.t('assessmentEvaluationAi:status.unknown');
    }
};

// Status → chip tone. Anything still running reads as "info".
const statusTone = (status: string): Tone =>
    status === 'COMPLETED'
        ? 'success'
        : status === 'FAILED'
          ? 'danger'
          : status === 'CANCELLED'
            ? 'neutral'
            : 'info';

const isRunning = (status: string) =>
    status !== 'COMPLETED' && status !== 'FAILED' && status !== 'CANCELLED';

function StatCard({
    icon: StatIcon,
    label,
    value,
    tone = 'primary',
}: {
    icon: Icon;
    label: string;
    value: string;
    tone?: 'primary' | 'success' | 'warning';
}) {
    const iconClass = {
        primary: 'bg-primary-50 text-primary-600',
        success: 'bg-success-50 text-success-700',
        warning: 'bg-warning-50 text-warning-700',
    }[tone];
    const valueClass = {
        primary: 'text-neutral-900',
        success: 'text-success-700',
        warning: 'text-warning-700',
    }[tone];
    return (
        <Card className="border-neutral-200 shadow-sm">
            <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                    <p className="text-caption font-medium text-neutral-500">{label}</p>
                    <span
                        className={cn(
                            'flex size-8 shrink-0 items-center justify-center rounded-lg',
                            iconClass
                        )}
                    >
                        <StatIcon size={16} />
                    </span>
                </div>
                <p
                    className={cn(
                        'mt-1 text-h2 font-semibold tabular-nums tracking-tight',
                        valueClass
                    )}
                >
                    {value}
                </p>
            </CardContent>
        </Card>
    );
}

function RouteComponent() {
    const { t } = useTranslation('assessmentEvaluationAi');
    const { attemptId, processId } = Route.useParams();
    const navigate = useNavigate();
    const router = useRouter();
    const { setNavHeading } = useNavHeadingStore();
    const instituteId = getInstituteId();
    const [expandedQuestion, setExpandedQuestion] = useState<string | null>(null);
    const [filterTab, setFilterTab] = useState<'all' | 'completed' | 'pending'>('all');
    const [startTime] = useState(Date.now());
    const [isStopEvaluation, setIsStopEvaluation] = useState(false);
    const [isPdfPanelOpen, setIsPdfPanelOpen] = useState(false);
    const [pdfUrl, setPdfUrl] = useState<string | null>(null);
    // Which file id `pdfUrl` was resolved from, so a switch from the raw sheet
    // (shown while the run is in progress) to the checked copy reloads the viewer.
    const [pdfFileId, setPdfFileId] = useState<string | null>(null);
    const [isLoadingPdf, setIsLoadingPdf] = useState(false);
    const [duration, setDuration] = useState('0s');
    // Callback ref triggers a re-render with the populated element so the
    // overlay receives a non-null container on the same tick the PDF wrapper
    // mounts. A bare useRef would still be `null` when JSX is evaluated.
    const [pdfContainerEl, setPdfContainerEl] = useState<HTMLDivElement | null>(null);

    const { data: attemptDetails, isLoading: isAttemptLoading } = useQuery({
        ...getAttemptDetails(attemptId),
    });

    // localStorage handoff is only a fallback now — assessment/section context
    // comes from the progress API, so the page works cross-device and after a
    // storage clear (runs triggered before this was wired still read storage).
    const evaluationData = getEvaluationDataFromStorage().find(
        (data: any) => data.processId === processId
    );

    const {
        data: progress,
        isLoading,
        error,
    } = useQuery({
        queryKey: ['EVALUATION_PROGRESS', processId],
        queryFn: () => getEvaluationProgress(processId),
        refetchInterval: (query) => {
            // Stop polling if completed or failed
            const status = query?.state.data?.overall_status;
            if (status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED') {
                return false;
            }
            return 6000; // Poll every 6 seconds
        },
        staleTime: 0,
        enabled: !!processId && !isStopEvaluation,
    });

    // Assessment context: server-provided (cross-device safe), storage fallback.
    const assessmentId = progress?.assessment_id ?? evaluationData?.assessmentId;

    const stopEvaluationMutation = useMutation({
        ...useStopEvaluation(),
        onSuccess: () => {
            toast.success(t('toasts.evaluationStopped'));
            setIsStopEvaluation(true);
        },
        onError: () => {
            toast.error(t('toasts.stopFailed'));
        },
    });

    const layoutMapUrl = progress?.layout_map_url ?? null;
    const { data: layoutMapData } = useQuery({
        queryKey: ['COPY_CHECK_LAYOUT_MAP', layoutMapUrl],
        queryFn: () => (layoutMapUrl ? getLayoutMap(layoutMapUrl) : null),
        enabled: !!layoutMapUrl,
        staleTime: 5 * 60_000,
    });
    const layoutMap = (layoutMapData ?? null) as LayoutMap | null;

    // The checked copy THIS run rendered (progress.file_id — ticks, notes and
    // marks already drawn into the PDF; the backend serves it from the run's own
    // complete payload, never the attempt's latest, so an older run's page never
    // shows a newer run's marks). When it exists the viewer shows it as-is and
    // the JSON overlay stays off — drawing the same annotations again on top
    // produced a second set of green ticks, boxes and notes over the pen marks.
    // The overlay is only a fallback for a FINISHED run that produced no checked
    // copy at all. It never draws mid-run: the green ticks, red boxes and typed
    // notes it painted over the raw sheet while grading was still going looked
    // like the actual result ("what kind of checking is this"), and the pen
    // copy that replaced them a minute later was the one the teacher wanted.
    // While the run is on, the raw sheet is shown plain and the progress card
    // says what is happening.
    const checkedFileId: string | null =
        progress?.overall_status === 'COMPLETED' && progress?.file_id ? progress.file_id : null;
    const answerSheetFileId: string | null =
        checkedFileId ?? (attemptDetails as string | null) ?? null;
    const showOverlay = progress?.overall_status === 'COMPLETED' && !checkedFileId;

    const annotations: Annotation[] = useMemo(() => {
        const out: Annotation[] = [];
        for (const q of progress?.completed_questions ?? []) {
            const qAnnotations = q.annotations ?? q.evaluation_details_json?.annotations ?? [];
            for (const ann of qAnnotations) {
                out.push({ ...ann, question_id: q.question_id });
            }
        }
        return out;
    }, [progress?.completed_questions]);

    // Circled per-question marks beside the answer on the sheet, the way a
    // checked copy carries them. Anchored to the question's LAST annotation so
    // the badge lands near the end of that answer; a question with no
    // annotations has nowhere on the page to point at, so its marks stay on
    // the question card only.
    const questionScores: QuestionScoreMarker[] = useMemo(() => {
        const out: QuestionScoreMarker[] = [];
        for (const q of progress?.completed_questions ?? []) {
            if (q.status !== 'COMPLETED') continue;
            const qAnnotations = q.annotations ?? q.evaluation_details_json?.annotations ?? [];
            const anchor = qAnnotations[qAnnotations.length - 1];
            if (!anchor) continue;
            out.push({
                target: anchor.target,
                page_id: anchor.page_id,
                label: `${Number(q.marks_awarded ?? 0)}`,
                outOf: q.max_marks != null ? `/ ${Number(q.max_marks)}` : undefined,
            });
        }
        return out;
    }, [progress?.completed_questions]);

    const { data: assessmentData } = useQuery({
        ...getAssessmentDetails({
            assessmentId: assessmentId,
            instituteId: instituteId,
            type: 'EXAM',
        }),
    });

    // Section IDs to fetch question content — derived from the assessment itself
    // (same shape the trigger used), with the localStorage handoff as fallback.
    const sectionIds =
        assessmentData?.[1]?.saved_data?.sections?.map((section: any) => section.id).join(',') ??
        evaluationData?.sectionIds?.join(',');

    const { data: totalMarks } = useQuery({
        queryKey: ['TOTAL_MARKS', assessmentId],
        queryFn: () => getAssessmentTotalMarks(assessmentId),
    });

    const { data: questionsData, isLoading: isLoadingQuestions } = useQuery({
        queryKey: ['SECTION_QUESTIONS', sectionIds, assessmentId],
        queryFn: async () => {
            const data = await getQuestionsDataForStep2({
                assessmentId: assessmentId ?? '',
                sectionIds,
            });
            return data;
        },
    });

    useEffect(() => {
        // Stop timer if evaluation is completed or failed
        if (
            progress?.overall_status === 'COMPLETED' ||
            progress?.overall_status === 'FAILED' ||
            progress?.overall_status === 'CANCELLED'
        ) {
            return;
        }

        const interval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            const minutes = Math.floor(elapsed / 60);
            const seconds = elapsed % 60;
            setDuration(`${minutes}m ${seconds}s`);
        }, 1000);
        return () => clearInterval(interval);
    }, [startTime, progress?.overall_status]);

    // Handle completion
    useEffect(() => {
        if (progress?.overall_status === 'COMPLETED') {
            toast.success(t('toasts.evaluationCompleted'), {
                duration: 5000,
            });
        } else if (progress?.overall_status === 'FAILED') {
            toast.error(t('toasts.evaluationFailedRetry'), {
                duration: 5000,
            });
        }
    }, [progress?.overall_status]);

    useEffect(() => {
        const heading = (
            <div className="flex items-center gap-4">
                <CaretLeft onClick={() => router.history.back()} className="cursor-pointer" />
                <div>{t('nav.heading')}</div>
            </div>
        );
        setNavHeading(heading);
        // `t` in deps: the namespace loads lazily and the first render's `t`
        // would otherwise pin the raw key "nav.heading" into the top bar.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [t]);

    const allSectionQuestions = questionsData ? Object.values(questionsData).flat() : [];

    // Total score counts only successfully-graded questions; questions the AI
    // couldn't grade (FAILED) are excluded until the teacher grades them.
    const totalScore =
        progress?.completed_questions
            .filter((q) => q.status === 'COMPLETED')
            .reduce((sum, q) => sum + (q.marks_awarded || 0), 0) || 0;
    const needsReviewCount =
        progress?.completed_questions.filter((q) => q.status === 'FAILED').length || 0;
    const maxScore = totalMarks?.total_achievable_marks || 0;
    const allQuestions = progress
        ? [...progress.completed_questions, ...progress.pending_questions]
        : [];
    const filteredQuestions =
        filterTab === 'all'
            ? allQuestions
            : filterTab === 'completed'
              ? progress?.completed_questions || []
              : progress?.pending_questions || [];

    const toggleQuestion = (question_id: string) => {
        setExpandedQuestion(expandedQuestion === question_id ? null : question_id);
    };

    const showShimmer = (status: string) => {
        return status === 'STARTED' || status === 'PROCESSING' || status === 'EXTRACTING';
    };

    const loadAnswerSheet = async (fileId: string) => {
        setIsLoadingPdf(true);
        try {
            const url = await getPublicUrl(fileId);
            if (url) {
                setPdfUrl(url);
                setPdfFileId(fileId);
                setIsPdfPanelOpen(true);
            } else {
                toast.error(t('toasts.answerSheetLoadFailed'));
            }
        } catch (error) {
            console.error('Error loading PDF:', error);
            toast.error(t('toasts.answerSheetLoadFailed'));
        } finally {
            setIsLoadingPdf(false);
        }
    };

    const handleViewAnswerSheet = async () => {
        if (isPdfPanelOpen) {
            setIsPdfPanelOpen(false);
            return;
        }

        if (!answerSheetFileId) {
            toast.error(t('toasts.answerSheetUnavailable'));
            return;
        }

        if (pdfUrl && pdfFileId === answerSheetFileId) {
            setIsPdfPanelOpen(true);
            return;
        }

        await loadAnswerSheet(answerSheetFileId);
    };

    // Panel open on the raw sheet when the run finishes → swap to the checked
    // copy. One automatic attempt per file id: a failed load already toasts, and
    // retrying it from here would loop; the button reloads on the next click.
    const autoLoadedFor = useRef<string | null>(null);
    useEffect(() => {
        if (!isPdfPanelOpen || isLoadingPdf || !answerSheetFileId) return;
        if (pdfFileId === answerSheetFileId || autoLoadedFor.current === answerSheetFileId) return;
        autoLoadedFor.current = answerSheetFileId;
        void loadAnswerSheet(answerSheetFileId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [answerSheetFileId, isPdfPanelOpen, isLoadingPdf, pdfFileId]);

    if (isLoading || !progress) {
        return <DashboardLoader />;
    }

    if (error) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-neutral-50">
                <div className="text-center">
                    <h2 className="mb-2 text-xl font-bold text-red-600">{t('error.title')}</h2>
                    <p className="text-neutral-600">
                        {error instanceof Error ? error.message : t('error.loadFailed')}
                    </p>
                    <MyButton onClick={() => navigate({ to: -1 as any })} className="mt-4">
                        {t('error.goBack')}
                    </MyButton>
                </div>
            </div>
        );
    }

    const userFullName = progress?.participant_details?.name || t('common.loading');
    const assessmentName = assessmentData?.[0]?.saved_data?.name || t('common.loading');

    const running = isRunning(progress.overall_status);
    const percentage = maxScore > 0 ? ((totalScore / maxScore) * 100).toFixed(1) : '0';

    return (
        <LayoutContainer>
            <div className="flex flex-col gap-4">
                {/* Masthead: who, what, where the run is */}
                <Card className="border-neutral-200 shadow-sm">
                    <CardContent className="flex flex-col gap-4 p-5">
                        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
                            <div className="min-w-0">
                                <p className="text-caption font-medium uppercase tracking-wide text-neutral-500">
                                    {t('header.participant')}
                                </p>
                                <h1 className="truncate text-h3 font-semibold text-neutral-900">
                                    {userFullName}
                                </h1>
                                <p className="mt-0.5 truncate text-body text-neutral-500">
                                    {assessmentName}
                                </p>
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                    <AssessmentTag tone={statusTone(progress.overall_status)} dot>
                                        {showStatusMessage(progress.overall_status)}
                                    </AssessmentTag>
                                    <span className="inline-flex items-center gap-1 text-caption text-neutral-500">
                                        <Clock size={14} />
                                        {duration}
                                    </span>
                                </div>
                            </div>
                            {running && (
                                <MyButton
                                    onClick={() => stopEvaluationMutation.mutate(processId)}
                                    disabled={stopEvaluationMutation.isPending}
                                    buttonType="secondary"
                                    scale="medium"
                                    className="shrink-0 border-danger-300 !text-danger-600 hover:bg-danger-50 sm:min-w-0"
                                >
                                    {stopEvaluationMutation.isPending
                                        ? t('header.stopping')
                                        : t('header.stop')}
                                </MyButton>
                            )}
                        </div>
                        <div>
                            <div className="mb-1.5 flex items-center justify-between text-caption">
                                <span className="font-medium text-neutral-600">
                                    {t('header.progress')}
                                </span>
                                <span className="tabular-nums text-neutral-600">
                                    {progress.progress.completed}/{progress.progress.total}
                                </span>
                            </div>
                            <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-200">
                                <div
                                    className={cn(
                                        'h-full rounded-full transition-all',
                                        progress.overall_status === 'FAILED'
                                            ? 'bg-danger-500'
                                            : 'bg-primary-500'
                                    )}
                                    style={{ width: `${progress.progress.percentage}%` }} // dynamic value
                                />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Key numbers */}
                <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
                    <StatCard
                        icon={Trophy}
                        label={t('summary.totalScore')}
                        value={`${totalScore.toFixed(1)}/${maxScore}`}
                    />
                    <StatCard
                        icon={Percent}
                        label={t('summary.percentage')}
                        value={`${percentage}%`}
                    />
                    <StatCard
                        icon={ListChecks}
                        label={t('summary.completed')}
                        value={String(progress.progress.completed)}
                        tone="success"
                    />
                    <StatCard
                        icon={Clock}
                        label={t('summary.pending')}
                        value={String(progress.progress.total - progress.progress.completed)}
                        tone="warning"
                    />
                </div>

                {/* Filter + answer sheet */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <ChipToggleGroup
                        size="md"
                        variant="outline"
                        ariaLabel={t('filters.ariaLabel')}
                        value={filterTab}
                        onChange={(next) => setFilterTab(next)}
                        options={[
                            { value: 'all', label: t('filters.all') },
                            { value: 'completed', label: t('filters.completed') },
                            { value: 'pending', label: t('filters.pending') },
                        ]}
                    />
                    {answerSheetFileId && (
                        <MyButton
                            onClick={handleViewAnswerSheet}
                            disabled={isLoadingPdf}
                            buttonType="secondary"
                            scale="medium"
                            className="gap-2 sm:min-w-0"
                        >
                            <FileText size={16} />
                            {isLoadingPdf ? t('answerSheet.loading') : t('answerSheet.button')}
                        </MyButton>
                    )}
                </div>

                {/* Banners */}
                {progress.overall_status === 'COMPLETED' && (
                    <div className="rounded-lg border border-primary-200 bg-primary-50 px-4 py-3">
                        <p className="text-body font-medium text-primary-700">
                            {t('banners.aiDrafted')}
                        </p>
                    </div>
                )}
                {needsReviewCount > 0 && (
                    <div className="flex items-start gap-2 rounded-lg border border-danger-200 bg-danger-50 px-4 py-3">
                        <WarningCircle
                            size={18}
                            weight="fill"
                            className="mt-0.5 shrink-0 text-danger-600"
                        />
                        <p className="text-body font-medium text-danger-700">
                            {t('banners.needsReview', { count: needsReviewCount })}
                        </p>
                    </div>
                )}
                {running && (
                    <div className="flex items-center gap-2 rounded-lg border border-info-200 bg-info-50 px-4 py-3">
                        <CircleNotch size={18} className="shrink-0 animate-spin text-info-600" />
                        <p className="text-body font-medium text-info-700">
                            {showStatusMessage(progress.overall_status)}
                        </p>
                    </div>
                )}

                {/* Question list */}
                <div className="flex flex-col gap-3">
                    {filteredQuestions.length === 0 && !showShimmer(progress.overall_status) ? (
                        <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center shadow-sm">
                            <p className="text-body text-neutral-600">
                                {t(
                                    filterTab === 'all'
                                        ? 'emptyState.all'
                                        : filterTab === 'completed'
                                          ? 'emptyState.completed'
                                          : 'emptyState.pending'
                                )}
                            </p>
                        </div>
                    ) : (
                        filteredQuestions.map((question) => {
                            // Find matching question details from API
                            const questionDetails = allSectionQuestions.find(
                                (q: any) => q.question_id === question.question_id
                            );

                            return (
                                <QuestionCard
                                    key={question.question_id}
                                    question={question}
                                    processId={processId}
                                    isExpanded={expandedQuestion === question.question_id}
                                    onToggle={() => toggleQuestion(question.question_id)}
                                    questionDetails={questionDetails}
                                    currentRubricVersion={progress?.rubric_version}
                                />
                            );
                        })
                    )}
                    {showShimmer(progress.overall_status) &&
                        [1, 2, 3].map((index) => (
                            <Card
                                key={index}
                                className="animate-pulse overflow-hidden border-neutral-200"
                            >
                                <div className="flex items-center justify-between p-4">
                                    <div className="flex items-center gap-4">
                                        <div className="size-10 rounded-lg bg-neutral-200" />
                                        <div className="space-y-2">
                                            <div className="h-4 w-32 rounded bg-neutral-200" />
                                            <div className="h-3 w-24 rounded bg-neutral-100" />
                                        </div>
                                    </div>
                                    <div className="size-6 rounded-full bg-neutral-200" />
                                </div>
                            </Card>
                        ))}
                </div>
            </div>

            {/* Answer sheet: a full-size dialog, not a side panel that halves the page */}
            <Dialog open={isPdfPanelOpen} onOpenChange={setIsPdfPanelOpen}>
                <DialogContent className="flex h-dialog-tall max-h-dialog-tall !w-dialog-xl !max-w-full flex-col !gap-0 overflow-hidden rounded-xl !p-0 [&>button]:hidden">
                    <div className="flex shrink-0 items-center justify-between border-b border-neutral-200 bg-neutral-50 px-4 py-3">
                        <DialogTitle asChild>
                            <h2 className="text-subtitle font-semibold text-neutral-800">
                                {t('answerSheet.panelTitle')}
                            </h2>
                        </DialogTitle>
                        <MyButton
                            type="button"
                            layoutVariant="icon"
                            scale="small"
                            buttonType="text"
                            aria-label={t('answerSheet.close')}
                            className="size-8 text-neutral-500 hover:bg-neutral-100"
                            onClick={() => setIsPdfPanelOpen(false)}
                        >
                            <X size={18} />
                        </MyButton>
                    </div>
                    <div className="min-h-0 flex-1 bg-neutral-100 p-2 sm:p-4">
                        {pdfUrl ? (
                            <div ref={setPdfContainerEl} className="relative size-full">
                                <SimplePDFViewer pdfUrl={pdfUrl} />
                                {showOverlay && (
                                    <PdfAnnotationOverlay
                                        pdfContainerEl={pdfContainerEl}
                                        layoutMap={layoutMap}
                                        annotations={annotations}
                                        scores={questionScores}
                                    />
                                )}
                            </div>
                        ) : (
                            <div className="flex h-full items-center justify-center">
                                <DashboardLoader />
                            </div>
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </LayoutContainer>
    );
}

/** i18n key for a review_meta attribution line (spec §12: "Reviewed via API by T-0042 (Mrs. Iyer)"). */
const reviewAttributionKey = (a: ReviewAttribution): string => {
    const action = a.kind === 'approved' ? 'approved' : 'reviewed';
    const channel = a.viaApi ? 'ViaApi' : '';
    const named = a.reviewer ? 'By' : '';
    return `question.reviewMeta.${action}${channel}${named}`;
};

interface QuestionCardProps {
    question: any;
    processId: string;
    isExpanded: boolean;
    onToggle: () => void;
    questionDetails?: any;
    currentRubricVersion?: number | null;
}

function QuestionCard({
    question,
    processId,
    isExpanded,
    onToggle,
    questionDetails,
    currentRubricVersion,
}: QuestionCardProps) {
    const { t } = useTranslation('assessmentEvaluationAi');
    const queryClient = useQueryClient();
    const isCompleted = question.status === 'COMPLETED';
    const isFailed = question.status === 'FAILED';
    const completedTime = question.completed_at
        ? formatDistanceToNow(new Date(question.completed_at), { addSuffix: true })
        : '';

    // Inline teacher override of this question's marks/feedback.
    const [isEditing, setIsEditing] = useState(false);
    const [marksInput, setMarksInput] = useState('');
    const [feedbackInput, setFeedbackInput] = useState('');

    const overrideMutation = useMutation({
        mutationFn: () =>
            overrideQuestionEvaluation(processId, question.question_id, {
                marks_awarded: Number(marksInput) || 0,
                feedback: feedbackInput,
            }),
        onSuccess: () => {
            toast.success(t('toasts.marksUpdated'));
            setIsEditing(false);
            queryClient.invalidateQueries({ queryKey: ['EVALUATION_PROGRESS', processId] });
        },
        onError: () => toast.error(t('toasts.marksUpdateFailed')),
    });

    // Parse evaluation_json to get correct option IDs
    const evaluationJson = questionDetails?.evaluation_json
        ? JSON.parse(questionDetails.evaluation_json)
        : null;
    const correctOptionIds = evaluationJson?.data?.correctOptionIds || [];

    // Extract max marks from questionDetails as fallback
    const markingJson = questionDetails?.marking_json
        ? JSON.parse(questionDetails.marking_json)
        : null;
    const maxMarksFromQuestionDetails = markingJson?.data?.totalMark
        ? parseFloat(markingJson.data.totalMark)
        : 0;

    // Use question.max_marks if available, otherwise fall back to questionDetails
    const maxMarks = question.max_marks ?? maxMarksFromQuestionDetails;

    // Partner reviewer recorded by an API override/approve (plain text, escaped by React).
    const reviewAttribution = parseReviewMeta(question.review_meta, question.edited_by);

    return (
        <Card
            className={cn(
                'overflow-hidden border shadow-sm transition-colors',
                isCompleted
                    ? 'border-success-200'
                    : isFailed
                      ? 'border-danger-200'
                      : 'border-warning-200'
            )}
        >
            {/* Header: identity on the left, verdict on the right; wraps on a phone */}
            <button
                type="button"
                onClick={onToggle}
                aria-expanded={isExpanded}
                className="w-full p-4 text-left transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-400"
            >
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                        <div
                            className={cn(
                                'flex size-10 shrink-0 items-center justify-center rounded-lg text-body font-semibold',
                                isCompleted
                                    ? 'bg-success-50 text-success-700'
                                    : isFailed
                                      ? 'bg-danger-50 text-danger-700'
                                      : 'bg-warning-50 text-warning-700'
                            )}
                        >
                            {t('question.qLabel', { number: question.question_number })}
                        </div>
                        <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                                <h3 className="text-body font-semibold text-neutral-900">
                                    {t('question.title', { number: question.question_number })}
                                </h3>
                                <RubricChangedBadge
                                    evaluationVersion={question.rubric_version}
                                    currentVersion={currentRubricVersion}
                                />
                                {isCompleted && question.is_edited && (
                                    <span className="rounded-full bg-primary-50 px-2 py-0.5 text-2xs font-semibold text-primary-600">
                                        {t('question.editedBadge')}
                                    </span>
                                )}
                            </div>
                            {isCompleted && (
                                <p className="text-caption text-neutral-500">
                                    {/* "Reviewed by you" is wrong when the override came
                                        through the API; that reviewer is named below. */}
                                    {question.is_edited && reviewAttribution?.kind !== 'reviewed'
                                        ? t('question.reviewedPrefix')
                                        : ''}
                                    {t('question.completedAt', { time: completedTime })}
                                </p>
                            )}
                            {reviewAttribution && (
                                <p className="text-caption font-medium text-primary-600">
                                    {t(reviewAttributionKey(reviewAttribution), {
                                        reviewer: reviewAttribution.reviewer,
                                    })}
                                </p>
                            )}
                            {isFailed && (
                                <>
                                    <p className="text-caption font-medium text-danger-600">
                                        {t('question.failedGradeMessage')}
                                    </p>
                                    {question.error_detail && (
                                        <p className="mt-0.5 break-words font-mono text-2xs text-neutral-500">
                                            {question.error_detail}
                                        </p>
                                    )}
                                </>
                            )}
                            {!isCompleted && !isFailed && (
                                <p className="text-caption text-neutral-500">
                                    {t('question.pendingStatus')}
                                </p>
                            )}
                        </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                        {isCompleted ? (
                            <>
                                <p className="text-title font-semibold tabular-nums text-neutral-900">
                                    {question.marks_awarded?.toFixed(1) || 0}
                                    <span className="text-caption font-normal text-neutral-500">
                                        {' '}
                                        / {maxMarks}
                                    </span>
                                </p>
                                <CheckCircle size={22} className="text-success-600" weight="fill" />
                            </>
                        ) : isFailed ? (
                            <span className="flex items-center gap-1 rounded-full bg-danger-50 px-2.5 py-1 text-2xs font-semibold text-danger-700">
                                <WarningCircle size={14} weight="fill" />
                                {t('question.needsReviewBadge')}
                            </span>
                        ) : (
                            <Circle size={22} className="animate-spin text-warning-500" />
                        )}
                    </div>
                </div>
            </button>

            {/* Expanded Content - Show for ALL questions (pending and completed) */}
            {isExpanded && (
                <div className="space-y-6 border-t border-neutral-200 bg-white p-4 sm:p-6">
                    {/* Teacher review: adjust marks/feedback before the result is released */}
                    {(isCompleted || isFailed) && (
                        <div
                            className={cn(
                                'rounded-md border p-4',
                                isFailed
                                    ? 'border-danger-200 bg-danger-50'
                                    : 'border-neutral-200 bg-neutral-50'
                            )}
                        >
                            {!isEditing ? (
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="text-sm font-medium text-neutral-800">
                                            {isFailed
                                                ? t('teacherReview.failedTitle')
                                                : t('teacherReview.aiDraftedTitle')}
                                        </p>
                                        <p className="text-xs text-neutral-500">
                                            {isFailed
                                                ? t('teacherReview.failedHint')
                                                : t('teacherReview.aiDraftedHint')}
                                        </p>
                                    </div>
                                    <MyButton
                                        type="button"
                                        buttonType={isFailed ? 'primary' : 'secondary'}
                                        scale="small"
                                        onClick={() => {
                                            setMarksInput(
                                                question.marks_awarded != null
                                                    ? String(question.marks_awarded)
                                                    : ''
                                            );
                                            setFeedbackInput(question.feedback ?? '');
                                            setIsEditing(true);
                                        }}
                                    >
                                        <PencilSimple size={14} className="mr-1" />
                                        {isFailed
                                            ? t('teacherReview.gradeManually')
                                            : t('teacherReview.edit')}
                                    </MyButton>
                                </div>
                            ) : (
                                <div className="flex flex-col gap-3">
                                    <div className="flex items-center gap-2">
                                        <label className="text-sm font-medium text-neutral-700">
                                            {t('teacherReview.marksLabel')}
                                        </label>
                                        <input
                                            type="number"
                                            min={0}
                                            max={maxMarks || undefined}
                                            step="0.5"
                                            value={marksInput}
                                            onChange={(e) => setMarksInput(e.target.value)}
                                            className="w-24 rounded-md border border-neutral-300 px-2 py-1 text-sm"
                                        />
                                        <span className="text-sm text-neutral-500">
                                            / {maxMarks}
                                        </span>
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-sm font-medium text-neutral-700">
                                            {t('teacherReview.feedbackLabel')}
                                        </label>
                                        <textarea
                                            value={feedbackInput}
                                            onChange={(e) => setFeedbackInput(e.target.value)}
                                            rows={3}
                                            className="w-full rounded-md border border-neutral-300 px-2 py-1 text-sm"
                                            placeholder={t('teacherReview.feedbackPlaceholder')}
                                        />
                                    </div>
                                    <div className="flex justify-end gap-2">
                                        <MyButton
                                            type="button"
                                            buttonType="secondary"
                                            scale="small"
                                            onClick={() => setIsEditing(false)}
                                            disabled={overrideMutation.isPending}
                                        >
                                            {t('teacherReview.cancel')}
                                        </MyButton>
                                        <MyButton
                                            type="button"
                                            buttonType="primary"
                                            scale="small"
                                            onClick={() => overrideMutation.mutate()}
                                            disabled={overrideMutation.isPending}
                                        >
                                            {overrideMutation.isPending
                                                ? t('teacherReview.saving')
                                                : t('teacherReview.save')}
                                        </MyButton>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Question Text */}
                    {questionDetails?.question?.content && (
                        <div>
                            <h4 className="mb-2 text-xs font-semibold uppercase text-neutral-500">
                                {t('details.questionHeading')}
                            </h4>

                            <TipTapEditor
                                value={questionDetails.question.content}
                                onChange={() => {}}
                                editable={false}
                            />
                        </div>
                    )}

                    {/* Correct Answer (for MCQ) */}
                    {questionDetails?.question_type === 'MCQS' &&
                        questionDetails?.options_with_explanation &&
                        correctOptionIds.length > 0 && (
                            <div>
                                <h4 className="mb-2 text-xs font-semibold uppercase text-neutral-500">
                                    {t('details.correctAnswerHeading')}
                                </h4>
                                <div className="rounded-md bg-success-50 p-3">
                                    {questionDetails.options_with_explanation
                                        .filter((opt: any) => correctOptionIds.includes(opt.id))
                                        .map((opt: any, idx: number) => (
                                            <TipTapEditor
                                                key={idx}
                                                value={opt.text.content}
                                                onChange={() => {}}
                                                editable={false}
                                                // className="h-fit bg-red-400"
                                            />
                                        ))}
                                </div>
                            </div>
                        )}

                    {/* Student's Answer */}
                    {question.extracted_answer && (
                        <div>
                            <h4 className="mb-2 text-xs font-semibold uppercase text-neutral-500">
                                {t('details.studentAnswerHeading')}
                            </h4>
                            <Card className="rounded-sm p-4">
                                <LatexRenderer
                                    content={question.extracted_answer}
                                    className="text-base"
                                />
                            </Card>
                        </div>
                    )}

                    {/* Feedback */}
                    {question.feedback && (
                        <div>
                            <h4 className="mb-2 text-xs font-semibold uppercase text-neutral-500">
                                {t('details.feedbackHeading')}
                            </h4>
                            <p className="rounded-md bg-neutral-50 p-3 text-sm">
                                {question.feedback}
                            </p>
                        </div>
                    )}

                    {/* Criteria Breakdown */}
                    {question.evaluation_details_json?.criteria_breakdown && (
                        <div>
                            <h4 className="mb-3 text-xs font-semibold uppercase text-neutral-500">
                                {t('details.gradingBreakdownHeading')}
                            </h4>
                            <div className="overflow-x-auto rounded-md border border-neutral-200">
                                <table className="w-full min-w-96">
                                    <thead className="bg-neutral-100">
                                        <tr>
                                            <th className="p-3 text-left text-xs font-semibold uppercase text-neutral-600">
                                                {t('table.criteria')}
                                            </th>
                                            <th className="p-3 text-left text-xs font-semibold uppercase text-neutral-600">
                                                {t('table.reason')}
                                            </th>
                                            <th className="w-24 p-3 text-right text-xs font-semibold uppercase text-neutral-600">
                                                {t('table.marks')}
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-neutral-200">
                                        {question.evaluation_details_json.criteria_breakdown.map(
                                            (criteria: any, index: number) => (
                                                <tr key={index} className="hover:bg-neutral-50">
                                                    <td className="p-3 text-sm font-medium text-neutral-900">
                                                        {criteria.criteria_name}
                                                    </td>
                                                    <td className="p-3 text-sm text-neutral-600">
                                                        {criteria.reason}
                                                    </td>
                                                    <td className="p-3 text-right text-sm font-semibold text-neutral-900">
                                                        {criteria.marks.toFixed(1)}
                                                    </td>
                                                </tr>
                                            )
                                        )}
                                        <tr className="bg-primary-50">
                                            <td
                                                colSpan={2}
                                                className="p-3 text-right text-sm font-semibold text-primary-700"
                                            >
                                                {t('table.totalMarksAwarded')}
                                            </td>
                                            <td className="p-3 text-right text-sm font-bold text-primary-700">
                                                {question.marks_awarded?.toFixed(1) || 0}
                                                {maxMarks && ` / ${maxMarks}`}
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </Card>
    );
}
