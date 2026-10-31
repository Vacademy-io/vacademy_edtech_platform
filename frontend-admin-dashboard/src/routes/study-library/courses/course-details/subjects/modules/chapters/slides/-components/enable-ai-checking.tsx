import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CheckCircle, Coins, FilePdf, Sparkle, Spinner, WarningCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { MyDropdown } from '@/components/design-system/dropdown';
import { cn } from '@/lib/utils';
import { savePaperToQuestionBank } from '@/routes/knowledge-base/-services/paper-service';
import { getQuestionPaperById } from '@/routes/assessment/question-papers/-utils/question-paper-services';
import { triggerAIEvaluation } from '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-services/ai-evaluation-services';
import {
    adoptDigitisedQuestions,
    estimatePaperDigitise,
    findPdfAttachments,
    getAiGradability,
    getPaperDigitiseJobForAssessment,
    isJobRunning,
    listPendingPaperReads,
    paperDigitiseErrorMessage,
    type AdoptQuestionsResult,
    type DigitisedPaper,
    type PaperDigitiseEstimate,
} from '@/services/paper-digitise';
import { usePaperDigitise } from '../-hooks/use-paper-digitise';
import { getInstituteId } from '@/constants/helper';
import { getCopyCheckConfig } from '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-services/copy-intake-services';
import {
    toCopyCheckConfig,
    useCopyCheckSettings,
} from '@/components/common/ai-copy-check/CopyCheckSettingsFields';
import { CopyCheckCriteriaPanel } from '@/components/common/ai-copy-check/CopyCheckCriteriaPanel';
import {
    COPY_CHECK_CRITERIA_KEY,
    criteriaToCopyCheckRubric,
    saveCopyCheckConfig,
    saveCopyCheckCriteria,
    toRubric,
} from '@/services/copy-check-criteria';
import type { RubricJson } from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-services/criteria-services';
import {
    PaperDigitiseReviewDialog,
    type ReviewedChoice,
    type ReviewedQuestion,
} from './paper-digitise-review-dialog';

/** A stored criteria JSON, or null when there is none or it does not parse. */
const parseJson = (json: string | null | undefined): unknown => {
    if (!json) return null;
    try {
        return JSON.parse(json);
    } catch {
        return null;
    }
};

type Step =
    | { kind: 'closed' }
    | { kind: 'confirm'; estimate?: PaperDigitiseEstimate; error?: string; loading: boolean }
    | { kind: 'adopting' }
    | { kind: 'done'; result: AdoptQuestionsResult; questionCount: number };

/**
 * "Enable AI checking" for a test that was created without it.
 *
 * Such a test holds one placeholder question, so the AI has nothing to grade
 * against — and it refuses to run. This reads the paper still attached in the
 * test's description into real questions (same review as at creation), swaps
 * them in for the placeholder on the server (same section, so nothing an
 * attempt points at changes), turns AI checking on, and readies every sheet
 * already uploaded. Sheets the teacher graded by hand are left alone.
 *
 * The read takes minutes and runs on the server, so this never blocks: the
 * card shows "reading…" from the job the server holds for this test (a test
 * created with AI checking on arrives here with that read already running),
 * the root watcher toasts once when it settles, and "Review & enable" opens
 * the result whenever the teacher comes back — from any tab or device.
 *
 * Rendered only while the test is placeholder-only; disappears once enabled.
 */
export const EnableAiChecking = ({
    assessmentId,
    assessmentName,
    instructionsHtml,
    totalMarks,
    framed = false,
    onEnabled,
}: {
    assessmentId: string;
    /** What the toast / bell call the test. */
    assessmentName?: string;
    /** The test's saved instructions — where the paper PDF was attached. */
    instructionsHtml: string | null | undefined;
    /** The placeholder's marks, i.e. the paper's total as the teacher typed it. */
    totalMarks: number | null;
    /** Stand-alone card (own border + margin) rather than a strip inside a panel. */
    framed?: boolean;
    onEnabled?: () => void;
}) => {
    const { t } = useTranslation('studyLibraryAssessmentCreateForm');
    const queryClient = useQueryClient();
    const { state, starting, start, attach, abandon } = usePaperDigitise();
    const [step, setStep] = useState<Step>({ kind: 'closed' });
    const [checking, setChecking] = useState(false);
    // The progress dialog: opens by itself right after a read is started here,
    // and on "View progress"; "Continue in background" closes it and remembers
    // that choice for this read so it does not pop up again.
    const [progressOpen, setProgressOpen] = useState(false);
    // Bank ids already saved for this exact set — a retry after the adopt call
    // failed must not file the same paper into the bank twice.
    const savedRef = useRef<{ key: string; ids: string[] } | null>(null);
    const instituteId = getInstituteId() ?? '';
    // How the AI will check the sheets, set in the review: this test's own settings,
    // else the institute's defaults.
    const [aiSettings, setAiSettings] = useCopyCheckSettings(state.phase === 'review', () =>
        getCopyCheckConfig(assessmentId, instituteId)
    );

    const { data: gradability } = useQuery({
        queryKey: ['AI_GRADABILITY', assessmentId],
        queryFn: () => getAiGradability(assessmentId),
        enabled: Boolean(assessmentId),
        staleTime: 60 * 1000,
    });

    const placeholderOnly = Boolean(gradability?.placeholder_only);

    // The read the server holds for this test — polled only while it is running.
    const { data: job } = useQuery({
        queryKey: ['PAPER_READ', assessmentId],
        queryFn: () => getPaperDigitiseJobForAssessment(assessmentId),
        enabled: Boolean(assessmentId) && placeholderOnly,
        staleTime: 5 * 1000,
        refetchInterval: (query) => (isJobRunning(query.state.data) ? 10 * 1000 : false),
    });

    const pdfs = useMemo(() => findPdfAttachments(instructionsHtml || ''), [instructionsHtml]);
    const [selectedUrl, setSelectedUrl] = useState('');
    const pdfUrl = pdfs.some((p) => p.url === selectedUrl) ? selectedUrl : (pdfs[0]?.url ?? '');

    const reading = isJobRunning(job);
    const ready = job?.status === 'COMPLETED' && job.result && job.result.questions.length > 0 ? job.result : null;
    const readFailed = job?.status === 'FAILED' || (job?.status === 'COMPLETED' && !ready);
    const startedAgoMin = job?.created_at
        ? Math.max(0, Math.round((Date.now() - new Date(job.created_at).getTime()) / 60000))
        : null;
    const taskId = job?.task_id ?? null;

    // A read started from this browser moments ago (the create form, or the
    // button above) shows its progress without being asked — once per read.
    useEffect(() => {
        if (!taskId || !reading || progressOpen) return;
        if (sessionStorage.getItem(`paper-read-progress-seen:${taskId}`)) return;
        const mine = listPendingPaperReads().some(
            (r) => r.taskId === taskId && Date.now() - r.startedAt < 2 * 60 * 1000
        );
        if (mine) {
            sessionStorage.setItem(`paper-read-progress-seen:${taskId}`, '1');
            setProgressOpen(true);
        }
    }, [taskId, reading, progressOpen]);

    // Still watching when it settles: straight into the review (or the reason).
    useEffect(() => {
        if (!progressOpen || reading || !job) return;
        if (ready) {
            setProgressOpen(false);
            attach(ready);
        }
    }, [progressOpen, reading, job, ready, attach]);

    if (!placeholderOnly) return null;

    const continueInBackground = () => {
        if (taskId) sessionStorage.setItem(`paper-read-progress-seen:${taskId}`, '1');
        setProgressOpen(false);
        toast.info(t('background.continuing'));
    };

    const openConfirm = async (url: string) => {
        setStep({ kind: 'confirm', loading: true });
        try {
            const estimate = await estimatePaperDigitise(url);
            setStep({ kind: 'confirm', estimate, loading: false });
        } catch (error: unknown) {
            setStep({
                kind: 'confirm',
                error: paperDigitiseErrorMessage(error, t('aiCheck.estimateFailed')),
                loading: false,
            });
        }
    };

    const beginRead = async () => {
        if (!pdfUrl) return;
        setStep({ kind: 'closed' });
        const started = await start({
            pdfUrl,
            expectedTotalMarks: totalMarks && totalMarks > 0 ? totalMarks : undefined,
            title: assessmentName,
            assessmentId,
            name: assessmentName || t('retrofit.thisTest'),
            returnPath: `${window.location.pathname}${window.location.search}`,
        });
        if (started) setProgressOpen(true);
    };

    const adopt = async (
        paper: DigitisedPaper,
        accepted: ReviewedQuestion[],
        choices?: ReviewedChoice[]
    ) => {
        setStep({ kind: 'adopting' });
        try {
            const questions = accepted.map(({ index, marks, criteria: edited }) => {
                const dto = paper.questions[index]!;
                // Criteria the teacher wrote in the review replace the paper read's.
                let criteria = edited
                    ? JSON.stringify(
                          criteriaToCopyCheckRubric(
                              edited,
                              marks,
                              toRubric(parseJson(dto.evaluation_criteria_json), marks)
                          )
                      )
                    : dto.evaluation_criteria_json ?? null;
                // Marks corrected on review → the rubric's maximum must follow.
                try {
                    const parsed = criteria ? JSON.parse(criteria) : null;
                    if (parsed && typeof parsed === 'object' && Number(parsed.max_marks) !== marks) {
                        const items: Array<{ max_marks?: number }> = Array.isArray(parsed.rubric)
                            ? parsed.rubric
                            : [];
                        const oldTotal = items.reduce((sum, c) => sum + Number(c.max_marks || 0), 0);
                        const factor = oldTotal > 0 ? marks / oldTotal : 0;
                        items.forEach((c) => {
                            c.max_marks = Math.round(Number(c.max_marks || 0) * factor * 100) / 100;
                        });
                        parsed.max_marks = marks;
                        criteria = JSON.stringify(parsed);
                    }
                } catch {
                    /* keep the rubric as generated */
                }
                return { dto: { ...dto, evaluation_criteria_json: criteria }, marks };
            });
            const cacheKey = JSON.stringify([paper.file_name, paper.estimate, accepted]);
            let ids: string[];
            if (savedRef.current?.key === cacheKey) {
                ids = savedRef.current.ids;
            } else {
                const saved = await savePaperToQuestionBank({
                    title: paper.title,
                    questions: questions.map((q) => q.dto),
                });
                const savedId = saved?.saved_question_paper_id;
                if (!savedId) throw new Error(t('errors.questionsNotSaved'));
                const stored = await getQuestionPaperById(savedId);
                ids = (stored?.question_dtolist ?? []).map((q: { id: string }) => q.id);
                if (ids.length !== questions.length) throw new Error(t('errors.questionsNotSaved'));
                savedRef.current = { key: cacheKey, ids };
            }

            // "Answer any FOUR of these five", by the ids the questions were saved under.
            const idOf = new Map(accepted.map(({ index }, i) => [index, ids[i]!]));
            const choiceGroups = (choices ?? []).map((c) => ({
                label: c.label,
                question_ids: c.indexes
                    .map((index) => idOf.get(index))
                    .filter((id): id is string => !!id),
                attempt: c.attempt,
                policy: c.policy,
            }));
            const result = await adoptDigitisedQuestions(
                assessmentId,
                questions.map((q, i) => ({
                    question_id: ids[i]!,
                    question_type: String(q.dto.question_type || 'LONG_ANSWER'),
                    marks: q.marks,
                })),
                choiceGroups
            );
            // The criteria the teacher saw in the review are what the AI marks by, and the
            // settings go with the test. Neither may undo the enable: a failure here only
            // says where to set them again.
            const rubrics: Record<string, RubricJson> = {};
            questions.forEach((q, i) => {
                // No usable criteria: the AI writes them on the first check.
                const rubric = toRubric(parseJson(q.dto.evaluation_criteria_json), q.marks);
                if (rubric && rubric.rubric.length > 0) rubrics[ids[i]!] = rubric;
            });
            const followUps: Promise<unknown>[] = [];
            if (Object.keys(rubrics).length > 0)
                followUps.push(saveCopyCheckCriteria(assessmentId, rubrics));
            if (instituteId) {
                followUps.push(
                    saveCopyCheckConfig(assessmentId, instituteId, toCopyCheckConfig(aiSettings))
                );
            }
            const settled = await Promise.allSettled(followUps);
            if (settled.some((r) => r.status === 'rejected')) {
                toast.warning(t('retrofit.criteriaNotSaved'));
            }
            queryClient.invalidateQueries({ queryKey: [COPY_CHECK_CRITERIA_KEY, assessmentId] });
            abandon();
            queryClient.invalidateQueries({ queryKey: ['AI_GRADABILITY', assessmentId] });
            queryClient.invalidateQueries({ queryKey: ['GET_QUESTIONS_DATA_FOR_SECTIONS'] });
            queryClient.invalidateQueries({ queryKey: ['GET_ASSESSMENT_DETAILS'] });
            setStep({ kind: 'done', result, questionCount: questions.length });
            onEnabled?.();
        } catch (error: unknown) {
            toast.error(paperDigitiseErrorMessage(error, t('retrofit.enableFailed')));
            // Back to the review so the questions are not lost; a retry re-uses them.
            setStep({ kind: 'closed' });
        }
    };

    const checkNow = async (result: AdoptQuestionsResult) => {
        setChecking(true);
        try {
            const processes = await triggerAIEvaluation(result.attempt_ids_ready);
            toast.success(t('retrofit.checkStarted', { count: processes.length }));
            queryClient.invalidateQueries({ queryKey: ['ASSESSMENT_SLIDE_SUBMISSIONS_PANEL'] });
            setStep({ kind: 'closed' });
        } catch (error: unknown) {
            toast.error(paperDigitiseErrorMessage(error, t('retrofit.checkFailed')));
        } finally {
            setChecking(false);
        }
    };

    const estimateData = step.kind === 'confirm' ? step.estimate : undefined;

    return (
        <>
            <div
                className={cn(
                    'flex flex-col gap-2 bg-primary-50/40 px-3 py-2.5',
                    framed
                        ? 'mx-4 rounded-md border border-primary-100'
                        : 'border-b border-neutral-100'
                )}
            >
                <div className="flex items-start gap-2">
                    {reading ? (
                        <Spinner className="mt-0.5 size-4 shrink-0 animate-spin text-primary-500" />
                    ) : ready ? (
                        <CheckCircle className="mt-0.5 size-4 shrink-0 text-success-600" weight="bold" />
                    ) : (
                        <Sparkle className="mt-0.5 size-4 shrink-0 text-primary-500" weight="bold" />
                    )}
                    <div className="flex min-w-0 flex-1 flex-col">
                        <span className="text-xs font-semibold text-neutral-800">
                            {reading
                                ? t('background.readingTitle')
                                : ready
                                  ? t('background.readyTitle', { count: ready.questions.length })
                                  : t('retrofit.title')}
                        </span>
                        <span className="text-2xs text-neutral-500">
                            {reading
                                ? startedAgoMin != null
                                    ? t('background.readingSince', { count: startedAgoMin })
                                    : t('background.readingHint')
                                : ready
                                  ? t('background.readyHint')
                                  : readFailed
                                    ? t('background.failedInline', {
                                          reason: job?.status_message || t('aiCheck.noQuestions'),
                                      })
                                    : pdfs.length > 0
                                      ? t('retrofit.description')
                                      : t('retrofit.noPdf')}
                        </span>
                    </div>
                    {ready ? (
                        <MyButton buttonType="primary" scale="small" onClick={() => attach(ready)}>
                            <span className="text-xs">{t('background.reviewButton')}</span>
                        </MyButton>
                    ) : reading ? (
                        <MyButton buttonType="secondary" scale="small" onClick={() => setProgressOpen(true)}>
                            <span className="text-xs">{t('background.viewProgress')}</span>
                        </MyButton>
                    ) : (
                        <MyButton
                            buttonType="primary"
                            scale="small"
                            disable={pdfs.length === 0 || starting || reading}
                            onClick={() => void openConfirm(pdfUrl)}
                        >
                            <span className="text-xs">
                                {readFailed ? t('aiCheck.tryAgain') : t('retrofit.enableButton')}
                            </span>
                        </MyButton>
                    )}
                </div>
                {state.phase === 'failed' && (
                    <p className="flex items-start gap-1.5 text-2xs text-danger-600">
                        <WarningCircle className="mt-0.5 size-3 shrink-0" />
                        {state.message}
                    </p>
                )}
                {pdfs.length > 1 && !reading && !ready && (
                    <MyDropdown
                        currentValue={pdfs.find((p) => p.url === pdfUrl)?.name ?? ''}
                        dropdownList={pdfs.map((p) => ({ label: p.name, value: p.url }))}
                        placeholder={t('aiCheck.whichPaper')}
                        handleChange={setSelectedUrl}
                    />
                )}
            </div>

            {/* Cost confirmation before anything is charged */}
            <MyDialog
                heading={t('retrofit.confirmHeading')}
                open={step.kind === 'confirm'}
                onOpenChange={(next) => {
                    if (!next) setStep({ kind: 'closed' });
                }}
                dialogWidth="max-w-lg"
                footer={
                    <>
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => setStep({ kind: 'closed' })}
                        >
                            {t('form.cancel')}
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            disable={
                                !estimateData || estimateData.estimate.sufficient === false || starting
                            }
                            onClick={() => void beginRead()}
                        >
                            {estimateData
                                ? t('form.readPaperAndCreateNoEstimate') +
                                  ` (≈${estimateData.estimate.estimated_credits})`
                                : t('form.readPaperAndCreateNoEstimate')}
                        </MyButton>
                    </>
                }
            >
                {step.kind === 'confirm' && (
                    <div className="flex flex-col gap-3 text-body text-neutral-700">
                        <p className="flex items-center gap-2">
                            <FilePdf className="size-4 shrink-0 text-danger-500" />
                            <span className="truncate">{pdfs.find((p) => p.url === pdfUrl)?.name}</span>
                        </p>
                        {step.loading && (
                            <p className="flex items-center gap-2 text-caption text-neutral-500">
                                <Spinner className="size-4 animate-spin" />
                                {t('aiCheck.estimating')}
                            </p>
                        )}
                        {step.error && (
                            <p className="flex items-start gap-2 text-caption text-danger-600">
                                <WarningCircle className="mt-0.5 size-4 shrink-0" />
                                {step.error}
                            </p>
                        )}
                        {estimateData && (
                            <>
                                <p className="flex items-center gap-2 font-medium">
                                    <Coins className="size-4 text-primary-500" weight="bold" />
                                    {t('aiCheck.estimateLine', {
                                        credits: estimateData.estimate.estimated_credits,
                                        count: estimateData.pages,
                                    })}
                                    {estimateData.estimate.current_balance != null && (
                                        <span className="font-normal text-neutral-500">
                                            · {t('aiCheck.balance', { balance: estimateData.estimate.current_balance })}
                                        </span>
                                    )}
                                </p>
                                {estimateData.estimate.sufficient === false ? (
                                    <p className="text-caption text-danger-600">
                                        {t('aiCheck.insufficientCredits')}
                                    </p>
                                ) : (
                                    <p className="text-caption text-neutral-500">{t('retrofit.confirmBody')}</p>
                                )}
                            </>
                        )}
                    </div>
                )}
            </MyDialog>

            {/* Progress — stay and get the review the moment it lands, or go on working */}
            <MyDialog
                heading={readFailed ? t('aiCheck.failedHeading') : t('background.readingTitle')}
                open={progressOpen}
                onOpenChange={(next) => {
                    if (next) return;
                    if (readFailed) setProgressOpen(false);
                    else continueInBackground();
                }}
                dialogWidth="max-w-lg"
                footer={
                    readFailed ? (
                        <>
                            <MyButton buttonType="secondary" scale="medium" onClick={() => setProgressOpen(false)}>
                                {t('form.cancel')}
                            </MyButton>
                            <MyButton
                                buttonType="primary"
                                scale="medium"
                                disable={starting}
                                onClick={() => {
                                    setProgressOpen(false);
                                    void openConfirm(pdfUrl);
                                }}
                            >
                                {t('aiCheck.tryAgain')}
                            </MyButton>
                        </>
                    ) : (
                        <MyButton buttonType="primary" scale="medium" onClick={continueInBackground}>
                            {t('background.continueButton')}
                        </MyButton>
                    )
                }
            >
                {readFailed ? (
                    <div className="flex flex-col gap-3">
                        <p className="flex items-start gap-2 text-body text-danger-600">
                            <WarningCircle className="mt-0.5 size-5 shrink-0" />
                            {job?.status_message || t('aiCheck.noQuestions')}
                        </p>
                        <p className="text-caption text-neutral-500">{t('retrofit.failedHint')}</p>
                    </div>
                ) : (
                    <div className="flex flex-col gap-3">
                        <p className="flex items-center gap-3 text-body text-neutral-700">
                            <Spinner className="size-5 shrink-0 animate-spin text-primary-500" />
                            {startedAgoMin != null && startedAgoMin > 0
                                ? t('background.readingSince', { count: startedAgoMin })
                                : t('background.readingHint')}
                        </p>
                        <p className="text-caption text-neutral-500">{t('background.stayNote')}</p>
                        <p className="text-caption text-neutral-500">{t('background.leaveNote')}</p>
                    </div>
                )}
            </MyDialog>

            <PaperDigitiseReviewDialog
                open={state.phase === 'review' || step.kind === 'adopting'}
                paper={state.phase === 'review' ? state.paper : null}
                expectedTotal={totalMarks}
                busy={step.kind === 'adopting'}
                onConfirm={(accepted, choices) => {
                    if (state.phase === 'review') void adopt(state.paper, accepted, choices);
                }}
                onCreateWithoutAi={() => {
                    abandon();
                    toast.info(t('aiCheck.reviewClosed'));
                }}
                onClose={() => {
                    abandon();
                    toast.info(t('aiCheck.reviewClosed'));
                }}
                secondaryLabel={t('form.cancel')}
                primaryLabel={(count) => t('retrofit.enableWithQuestions', { count })}
                aiSettings={aiSettings}
                onAiSettingsChange={setAiSettings}
            />

            {/* Done: what changed, and the sheets that can be checked right now */}
            <MyDialog
                heading={t('retrofit.doneHeading')}
                open={step.kind === 'done'}
                onOpenChange={(next) => {
                    if (!next && !checking) setStep({ kind: 'closed' });
                }}
                dialogWidth="max-w-lg"
                footer={
                    step.kind === 'done' ? (
                        <>
                            <MyButton
                                buttonType="secondary"
                                scale="medium"
                                disable={checking}
                                onClick={() => setStep({ kind: 'closed' })}
                            >
                                {t('retrofit.later')}
                            </MyButton>
                            {step.result.attempt_ids_ready.length > 0 && (
                                <MyButton
                                    buttonType="primary"
                                    scale="medium"
                                    disable={checking}
                                    onClick={() => void checkNow(step.result)}
                                >
                                    {checking
                                        ? t('retrofit.checking')
                                        : t('retrofit.checkNow', {
                                              count: step.result.attempt_ids_ready.length,
                                              credits:
                                                  step.result.attempt_ids_ready.length * step.questionCount,
                                          })}
                                </MyButton>
                            )}
                        </>
                    ) : undefined
                }
            >
                {step.kind === 'done' && (
                    <ul className="flex flex-col gap-2 text-body text-neutral-700">
                        <li>
                            {t('retrofit.doneQuestions', {
                                count: step.result.questions_mapped,
                                total: step.result.total_marks,
                            })}
                        </li>
                        <li>{t('retrofit.doneReady', { count: step.result.attempt_ids_ready.length })}</li>
                        {step.result.attempts_left_as_graded > 0 && (
                            <li>{t('retrofit.doneGraded', { count: step.result.attempts_left_as_graded })}</li>
                        )}
                        {step.result.attempts_in_progress > 0 && (
                            <li>{t('retrofit.doneInProgress', { count: step.result.attempts_in_progress })}</li>
                        )}
                        <li className="text-caption text-neutral-500">{t('retrofit.doneFuture')}</li>
                    </ul>
                )}
                {step.kind === 'done' && (
                    <div className="mt-4">
                        <CopyCheckCriteriaPanel
                            assessmentId={assessmentId}
                            subject={aiSettings.subject}
                        />
                    </div>
                )}
            </MyDialog>
        </>
    );
};
