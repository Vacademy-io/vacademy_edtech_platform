import { createLazyFileRoute, useNavigate } from '@tanstack/react-router';
import { Helmet } from 'react-helmet';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
    ArrowLeft,
    ArrowRight,
    CheckCircle,
    Coins,
    FloppyDisk,
    Info,
    ListChecks,
    NotePencil,
    PaperPlaneTilt,
    Sparkle,
    Spinner,
    WarningCircle,
} from '@phosphor-icons/react';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useKnowledgeBase } from '../-hooks';
import { getTopics, rebuildTopics } from '../-services/paper-service';
import {
    buildBlueprint,
    fetchPaperPdf,
    formatEditedQuestion,
    getGeneration,
    loadPaperTheme,
    publishPaperLink,
    markGenerationSaved,
    getPaperJob,
    regenerateQuestion,
    savePaperToQuestionBank,
    startGeneration,
    validatePaper,
} from '../-services/paper-service';
import { getQuestionPaperById } from '@/routes/assessment/question-papers/-utils/question-paper-services';
import { transformResponseDataToMyQuestionsSchema } from '@/routes/assessment/question-papers/-utils/helper';
import {
    offlineTestInstructionsHtml,
    sectionsFromKbPaper,
    seedOfflineTestWizard,
} from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-utils/kb-paper-sections';
import { BlueprintTable } from '../-components/paper/BlueprintTable';
import { EditQuestionDialog } from '../-components/paper/EditQuestionDialog';
import { DEFAULT_INSTRUCTIONS, InstructionsEditor } from '../-components/paper/InstructionsEditor';
import { MyDialog } from '@/components/design-system/dialog';
import { PaperDownloadMenu } from '../-components/paper/PaperDownloadMenu';
import {
    QuestionTypesStep,
    planTotals,
    toSpecTypePlan,
} from '../-components/paper/QuestionTypesStep';
import { TestDetailsStep } from '../-components/paper/TestDetailsStep';
import { TopicPicker, toSelectedNodeIds } from '../-components/paper/TopicPicker';
import { ReviewBoard } from '../-components/paper/ReviewBoard';
import { WizardStepper } from '../-components/paper/WizardStepper';
import type {
    Blueprint,
    KbTopic,
    CreditEstimate,
    PaperIssue,
    PaperResult,
    PaperSpec,
    RawPaperQuestion,
    TypePlanEntry,
} from '../-types/paper';

/**
 * The date as it should read on the sheet: the field yields YYYY-MM-DD, the
 * paper prints "25 Sep 2026". Anything unparseable is printed as typed.
 */
const printableExamDate = (value: string | undefined): string | undefined => {
    if (!value) return undefined;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return value;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.getTime())
        ? value
        : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

export const Route = createLazyFileRoute('/knowledge-base/paper/$kbId')({
    component: PaperBuilderPage,
});

/**
 * The four configuration steps a teacher walks through (syllabus → types →
 * details → review), then the two states after "Generate": the wait, and the
 * editor where the paper is reviewed, edited, previewed and saved.
 */
type Step = 'syllabus' | 'types' | 'details' | 'review' | 'generating' | 'editor';
const WIZARD: Step[] = ['syllabus', 'types', 'details', 'review'];

const POLL_MS = 3000;

/** Last path segment, decoded when it can be; never throws on odd escapes. */
function fileNameFromUrl(url: string): string {
    const last = url.split('?')[0]?.split('/').pop() || 'question-paper.pdf';
    try {
        return decodeURIComponent(last);
    } catch {
        return last;
    }
}

function errorMessage(t: TFunction, error: unknown, fallback: string): string {
    const response = (error as { response?: { status?: number; data?: { detail?: unknown } } })
        ?.response;
    const detail = response?.data?.detail;
    if (response?.status === 402) {
        if (detail && typeof detail === 'object' && 'message' in detail) {
            return String((detail as { message: unknown }).message);
        }
        return t('errors.notEnoughCredits');
    }
    return typeof detail === 'string' ? detail : fallback;
}

function PaperBuilderPage() {
    const { t, i18n } = useTranslation('knowledgeBasePaperKbIdIndex');
    const { kbId } = Route.useParams();
    const { resume } = Route.useSearch();
    const navigate = useNavigate();
    const { setNavHeading } = useNavHeadingStore();
    const { data: kb } = useKnowledgeBase(kbId);

    const [step, setStep] = useState<Step>('syllabus');
    const [topics, setTopics] = useState<KbTopic[] | null>(null);
    const [selectedLeafIds, setSelectedLeafIds] = useState<Set<string>>(new Set());
    const [weightage, setWeightage] = useState<Record<string, number>>({});
    const [rebuilding, setRebuilding] = useState(false);

    const [typePlan, setTypePlan] = useState<TypePlanEntry[]>([]);
    const [spec, setSpec] = useState<PaperSpec>({
        duration_minutes: 90,
        difficulty: 'MIXED',
        grade: '',
        language: 'English',
        title: '',
        instructions: [...DEFAULT_INSTRUCTIONS],
        generate_diagrams: false,
    });
    const [instructionsOpen, setInstructionsOpen] = useState(false);

    const [blueprint, setBlueprint] = useState<Blueprint | null>(null);
    const [estimate, setEstimate] = useState<CreditEstimate | null>(null);
    const [planning, setPlanning] = useState(false);
    const [refineText, setRefineText] = useState('');

    const [taskId, setTaskId] = useState<string | null>(null);
    const [result, setResult] = useState<PaperResult | null>(null);
    const [issues, setIssues] = useState<PaperIssue[]>([]);
    const [regenNumber, setRegenNumber] = useState<number | null>(null);
    const [editIndex, setEditIndex] = useState<number | null>(null);
    const [saving, setSaving] = useState(false);
    const [generationId, setGenerationId] = useState<string | null>(null);
    const [resuming, setResuming] = useState(Boolean(resume));

    useEffect(() => {
        setNavHeading(t('pageTitle'));
    }, [setNavHeading, t]);

    // Reopen a previous run: its plan always, its questions when it produced
    // any. A FAILED run lands on the review step with its plan, ready to re-run.
    useEffect(() => {
        if (!resume) return;
        let cancelled = false;
        getGeneration(resume)
            .then((record) => {
                if (cancelled) return;
                setGenerationId(record.id);
                if (record.input?.blueprint) setBlueprint(record.input.blueprint);
                if (record.input?.grade) {
                    setSpec((prev) => ({ ...prev, grade: String(record.input.grade) }));
                }
                if (record.result?.questions?.length) {
                    setResult(record.result);
                    setIssues(record.result.issues ?? []);
                    setStep('editor');
                } else if (record.input?.blueprint) {
                    setStep('review');
                }
            })
            .catch(() => toast.error(t('errors.reopenFailed')))
            .finally(() => !cancelled && setResuming(false));
        return () => {
            cancelled = true;
        };
    }, [resume, t]);

    useEffect(() => {
        getTopics(kbId)
            .then(setTopics)
            .catch(() => setTopics([]));
    }, [kbId]);

    // A selected topic implies all of its subtopics, so this collapses to the
    // parent id where the whole topic is chosen — see toSelectedNodeIds.
    const selectedNodeIds = useMemo(
        () => toSelectedNodeIds(topics ?? [], selectedLeafIds),
        [topics, selectedLeafIds]
    );
    const totals = planTotals(typePlan);

    const handleRebuildTopics = async () => {
        setRebuilding(true);
        try {
            setTopics(await rebuildTopics(kbId));
            toast.success(t('toasts.topicMapRebuilt'));
        } catch (error) {
            toast.error(errorMessage(t, error, t('errors.rebuildTopicMapFailed')));
        } finally {
            setRebuilding(false);
        }
    };

    // ---- Plan -------------------------------------------------------------
    // The spec the planner sees: the mix the teacher fixed (enforced
    // server-side), the weightage they set on selected chapters, and the
    // test details. Returns the blueprint so "Generate" can chain on it.
    const plan = useCallback(
        async (instruction?: string): Promise<Blueprint | null> => {
            setPlanning(true);
            try {
                const selectedWeightage = Object.fromEntries(
                    Object.entries(weightage).filter(
                        ([id, pct]) =>
                            pct > 0 &&
                            (topics ?? []).some(
                                (topic) =>
                                    topic.id === id &&
                                    (topic.subtopics?.length
                                        ? topic.subtopics.some((s) => selectedLeafIds.has(s.id))
                                        : selectedLeafIds.has(topic.id))
                            )
                    )
                );
                const response = await buildBlueprint(kbId, {
                    spec: {
                        ...spec,
                        title: spec.title?.trim() || undefined,
                        grade: spec.grade?.trim() || undefined,
                        exam_style: spec.exam_style?.trim() || undefined,
                        total_questions: totals.questions || undefined,
                        instructions: (spec.instructions ?? [])
                            .map((l) => l.trim())
                            .filter(Boolean),
                        // FE-only switch; it rides the generate call, not the plan.
                        generate_diagrams: undefined,
                        type_plan: typePlan.length ? toSpecTypePlan(typePlan) : undefined,
                        weightage: Object.keys(selectedWeightage).length
                            ? selectedWeightage
                            : undefined,
                    },
                    selected_node_ids: selectedNodeIds.length ? selectedNodeIds : undefined,
                    current_blueprint: instruction ? blueprint ?? undefined : undefined,
                    instruction,
                });
                setBlueprint(response.blueprint);
                setEstimate(response.generation_estimate);
                setRefineText('');
                return response.blueprint;
            } catch (error) {
                toast.error(errorMessage(t, error, t('errors.planFailed')));
                return null;
            } finally {
                setPlanning(false);
            }
        },
        [
            kbId,
            spec,
            totals.questions,
            typePlan,
            weightage,
            topics,
            selectedLeafIds,
            selectedNodeIds,
            blueprint,
            t,
        ]
    );

    // ---- Generate ---------------------------------------------------------
    const generate = async (plannedBlueprint: Blueprint | null = blueprint) => {
        if (!plannedBlueprint) return;
        try {
            const { task_id } = await startGeneration(kbId, {
                blueprint: plannedBlueprint,
                grade: spec.grade || undefined,
                generate_diagrams: Boolean(spec.generate_diagrams),
            });
            setTaskId(task_id);
            // A fresh run supersedes whatever we resumed from.
            setGenerationId(null);
            setStep('generating');
        } catch (error) {
            toast.error(errorMessage(t, error, t('errors.startGenerationFailed')));
        }
    };

    // "Generate" on the review step: plan and write in one go, the way a
    // teacher expects — the plan is still there afterwards for anyone who
    // wants to inspect it, and "Adjust plan first" shows it before writing.
    const planAndGenerate = async () => {
        const planned = await plan();
        if (planned) await generate(planned);
    };

    useEffect(() => {
        if (step !== 'generating' || !taskId) return;
        let cancelled = false;
        const tick = async () => {
            try {
                const job = await getPaperJob(taskId);
                if (cancelled) return;
                if (job.status === 'COMPLETED' && job.result) {
                    setResult(job.result);
                    setIssues(job.result.issues);
                    setStep('editor');
                    return;
                }
                if (job.status === 'FAILED') {
                    toast.error(job.status_message || t('errors.generationFailed'));
                    setStep('review');
                    return;
                }
                setTimeout(tick, POLL_MS);
            } catch {
                if (!cancelled) setTimeout(tick, POLL_MS);
            }
        };
        const handle = setTimeout(tick, POLL_MS);
        return () => {
            cancelled = true;
            clearTimeout(handle);
        };
    }, [step, taskId, t]);

    // ---- Editing the generated paper -------------------------------------
    const revalidate = async (rawQuestions: RawPaperQuestion[]) => {
        if (!blueprint) return;
        // Re-validate: an edit or rewrite can introduce a duplicate or change
        // the marks total. Keep the previous issues rather than clearing them
        // if the check itself fails.
        try {
            const revalidated = await validatePaper(kbId, { blueprint, questions: rawQuestions });
            setIssues(revalidated.issues);
        } catch {
            /* keep previous issues */
        }
    };

    const replaceAt = (
        index: number,
        rawQuestion: RawPaperQuestion,
        question: PaperResult['questions'][number]
    ) => {
        if (!result) return null;
        const rawQuestions = result.raw_questions.map((q, i) => (i === index ? rawQuestion : q));
        const questions = result.questions.map((q, i) => (i === index ? question : q));
        const next = { ...result, raw_questions: rawQuestions, questions };
        setResult(next);
        return next;
    };

    const regenerate = async (raw: RawPaperQuestion, instruction?: string) => {
        if (!blueprint || !result) return;
        const rowId = raw.kb_meta?.row_id;
        const row = blueprint.rows.find((r) => r.id === rowId);
        if (!row) {
            toast.error(t('errors.sectionMissing'));
            return;
        }
        const index = result.raw_questions.indexOf(raw);
        const num = raw.question_number ?? 0;
        setRegenNumber(num);
        try {
            const { raw_question, question } = await regenerateQuestion(kbId, {
                blueprint_row: row,
                instruction,
                grade: spec.grade || undefined,
            });
            // Keep the original position and number so the paper's order is stable.
            const replacement: RawPaperQuestion = {
                ...raw_question,
                question_number: num,
                kb_meta: { ...(raw_question.kb_meta ?? {}), row_id: row.id },
            };
            const next = replaceAt(index, replacement, question);
            if (next) await revalidate(next.raw_questions);
            toast.success(t('toasts.questionRewritten'));
        } catch (error) {
            toast.error(errorMessage(t, error, t('errors.rewriteFailed')));
        } finally {
            setRegenNumber(null);
        }
    };

    const applyEdit = async (edited: RawPaperQuestion) => {
        if (editIndex === null || !result) return;
        const { raw_question, question } = await formatEditedQuestion(kbId, edited, generationId);
        const next = replaceAt(editIndex, raw_question, question);
        if (next) await revalidate(next.raw_questions);
        toast.success(t('toasts.questionEdited'));
    };

    const deleteQuestion = async (index: number) => {
        if (!result) return;
        const next = {
            ...result,
            raw_questions: result.raw_questions.filter((_, i) => i !== index),
            questions: result.questions.filter((_, i) => i !== index),
            delivered: Math.max(0, result.delivered - 1),
        };
        setResult(next);
        await revalidate(next.raw_questions);
    };

    const moveQuestion = (index: number, direction: -1 | 1) => {
        if (!result) return;
        const target = index + direction;
        if (target < 0 || target >= result.raw_questions.length) return;
        const swap = <T,>(list: T[]) => {
            const copy = [...list];
            [copy[index], copy[target]] = [copy[target]!, copy[index]!];
            return copy;
        };
        setResult({
            ...result,
            raw_questions: swap(result.raw_questions),
            questions: swap(result.questions),
        });
    };

    // ---- Save -------------------------------------------------------------
    // `next` = where to go once the paper is in the bank: the list, or straight
    // into creating a Manual Upload Exam (students download the paper, solve
    // offline, upload their answer sheet; teachers or AI check it).
    const save = async (next: 'list' | 'offline-test' = 'list') => {
        if (!result || !blueprint) return;
        setSaving(true);
        try {
            const saved = await savePaperToQuestionBank({
                title: blueprint.title,
                questions: result.questions,
            });
            // Best-effort: the paper IS saved either way, and failing to update
            // history must not make it look like the save failed.
            if (generationId) {
                await markGenerationSaved(generationId, saved?.saved_question_paper_id).catch(
                    () => undefined
                );
            }
            toast.success(t('toasts.savedToQuestionBank'));
            if (next === 'offline-test') {
                await handOffToOfflineTest(saved?.saved_question_paper_id);
                navigate({
                    to: '/assessment/create-assessment/$assessmentId/$examtype',
                    // EXAM, not MANUAL_UPLOAD_EXAM: the same shape the slide's offline test
                    // has (MANUAL evaluation, PDF submission, AI check, paper in the
                    // instructions) — one learner flow and one admin flow for both.
                    params: { assessmentId: 'defaultId', examtype: 'EXAM' },
                    search: { currentStep: 0 },
                });
            } else {
                navigate({ to: '/assessment/question-papers' });
            }
        } catch (error) {
            toast.error(errorMessage(t, error, t('errors.saveFailed')));
        } finally {
            setSaving(false);
        }
    };

    /**
     * Pre-fill the offline-test wizard so the teacher does not rebuild by hand what
     * was just generated: the saved questions become Step 2's sections (marks from
     * the plan), and the paper is published and attached to the instructions so
     * learners can open and download it from the test page. The wizard still opens
     * without the pre-fill if any of that fails — the paper is in the bank either way.
     */
    const handOffToOfflineTest = async (savedPaperId: string | undefined) => {
        if (!result || !blueprint || !savedPaperId) return;
        try {
            const stored = await getQuestionPaperById(savedPaperId);
            const questions = transformResponseDataToMyQuestionsSchema(stored.question_dtolist);
            const sections = sectionsFromKbPaper(blueprint, result.raw_questions, questions);
            let paperFile: { url: string; fileName: string } | null = null;
            try {
                const link = await publishPaperLink(
                    kbId,
                    { blueprint, questions: result.raw_questions },
                    {
                        theme: loadPaperTheme(),
                        gradeLine: spec.grade || undefined,
                        examDate: printableExamDate(spec.exam_date),
                    },
                    generationId ?? undefined
                );
                paperFile = { url: link.file_url, fileName: fileNameFromUrl(link.file_url) };
            } catch {
                toast.warning(t('toasts.offlinePaperNotAttached'));
            }
            seedOfflineTestWizard({
                blueprint,
                sections,
                instructionsHtml: offlineTestInstructionsHtml(blueprint, paperFile),
            });
            toast.success(t('toasts.offlineTestPrefilled', { count: sections.length }));
        } catch {
            toast.warning(t('toasts.offlineTestNotPrefilled'));
        }
    };

    const issuesByQuestion = useMemo(() => {
        const map = new Map<number, PaperIssue[]>();
        issues.forEach((i) => {
            if (i.question_number == null) return;
            map.set(i.question_number, [...(map.get(i.question_number) ?? []), i]);
        });
        return map;
    }, [issues]);

    const paperLevelIssues = issues.filter((i) => i.question_number == null);
    const errorCount = issues.filter((i) => i.severity === 'error').length;

    // ---- Wizard chrome ----------------------------------------------------
    const wizardIndex = WIZARD.indexOf(step);
    const inWizard = wizardIndex >= 0;
    const stepLabels = [
        { key: 'syllabus', label: t('wizard.syllabus') },
        { key: 'types', label: t('wizard.types') },
        { key: 'details', label: t('wizard.details') },
        { key: 'review', label: t('wizard.review') },
    ];
    const canContinue =
        step === 'syllabus' ? topics !== null : step === 'types' ? typePlan.length > 0 : true;
    const goBack = () => setStep(WIZARD[Math.max(0, wizardIndex - 1)]!);
    const goNext = () => setStep(WIZARD[Math.min(WIZARD.length - 1, wizardIndex + 1)]!);

    const selectedChapters = (topics ?? []).filter((topic) =>
        topic.subtopics?.length
            ? topic.subtopics.some((s) => selectedLeafIds.has(s.id))
            : selectedLeafIds.has(topic.id)
    );

    return (
        <LayoutContainer>
            <Helmet>
                <title>{t('pageTitle')}</title>
            </Helmet>

            <div className="flex flex-col gap-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <MyButton
                        buttonType="text"
                        scale="medium"
                        onClick={() => navigate({ to: '/knowledge-base/$kbId', params: { kbId } })}
                        className="w-fit"
                    >
                        <ArrowLeft className="mr-1 size-4" />
                        {kb?.name ?? t('fallbackKnowledgeBase')}
                    </MyButton>
                </div>

                {/* A syllabus fixes what is examinable; the model supplies the
                    content. Say so up front, because there will be no page
                    citations to a textbook in what comes out. */}
                {kb?.curriculum?.kind === 'SYLLABUS' && (
                    <p className="flex items-start gap-1.5 text-caption text-neutral-500">
                        <Info className="mt-0.5 size-3.5 shrink-0 text-primary-500" />
                        {t('syllabusNote')}
                    </p>
                )}

                {/* Reopening a saved run: hold the step UI until its plan lands,
                    otherwise the syllabus step flashes before being replaced. */}
                {resuming && (
                    <Card className="flex flex-col items-center gap-3 p-12 text-center">
                        <Spinner className="size-6 animate-spin text-primary-500" />
                        <p className="text-body text-neutral-600">{t('resumingMessage')}</p>
                    </Card>
                )}

                {/* ---------------- Steps 1–4 ---------------- */}
                {!resuming && inWizard && (
                    <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
                        <Card className="h-fit p-5">
                            <p className="mb-5 text-h3 font-semibold text-neutral-700">
                                {t('wizard.heading')}
                            </p>
                            <WizardStepper
                                steps={stepLabels}
                                activeIndex={wizardIndex}
                                onSelect={(i) => setStep(WIZARD[i]!)}
                            />
                        </Card>

                        <Card className="flex min-w-0 flex-col">
                            <div className="border-b border-neutral-200 px-5 py-4">
                                <p className="text-subtitle font-semibold text-neutral-700">
                                    {t(`${step}.heading`)}
                                </p>
                                <p className="text-caption text-neutral-500">
                                    {t(`${step}.description`)}
                                </p>
                            </div>

                            <div className="flex flex-col gap-4 p-5">
                                {step === 'syllabus' && (
                                    <>
                                        {topics === null && (
                                            <Skeleton className="h-40 w-full rounded-md" />
                                        )}
                                        {topics !== null && topics.length === 0 && (
                                            <div className="flex flex-col items-start gap-2">
                                                <p className="text-body text-neutral-500">
                                                    {t('scope.noTopicMap')}
                                                </p>
                                                <MyButton
                                                    buttonType="secondary"
                                                    scale="medium"
                                                    onClick={handleRebuildTopics}
                                                    disable={rebuilding}
                                                >
                                                    {rebuilding
                                                        ? t('scope.buildingButton')
                                                        : t('scope.buildTopicMapButton')}
                                                </MyButton>
                                            </div>
                                        )}
                                        {topics !== null && topics.length > 0 && (
                                            <>
                                                <TopicPicker
                                                    topics={topics}
                                                    selectedLeafIds={selectedLeafIds}
                                                    onChange={setSelectedLeafIds}
                                                    toolbar
                                                    weightage={weightage}
                                                    onWeightageChange={setWeightage}
                                                />
                                                <div className="flex items-center justify-between">
                                                    <p className="text-caption text-neutral-400">
                                                        {t('syllabus.weightageHint')}
                                                    </p>
                                                    <MyButton
                                                        buttonType="text"
                                                        scale="small"
                                                        onClick={handleRebuildTopics}
                                                        disable={rebuilding}
                                                    >
                                                        {rebuilding
                                                            ? t('scope.rebuildingButton')
                                                            : t('scope.rebuildButton')}
                                                    </MyButton>
                                                </div>
                                            </>
                                        )}
                                    </>
                                )}

                                {step === 'types' && (
                                    <QuestionTypesStep value={typePlan} onChange={setTypePlan} />
                                )}

                                {step === 'details' && (
                                    <TestDetailsStep
                                        value={spec}
                                        onChange={setSpec}
                                        defaultTitle={kb?.name}
                                    />
                                )}

                                {step === 'review' && (
                                    <div className="flex flex-col gap-4">
                                        <div className="grid gap-3 md:grid-cols-3">
                                            <Card className="flex flex-col gap-1 p-3">
                                                <p className="text-caption font-semibold text-neutral-500">
                                                    {t('wizard.syllabus')}
                                                </p>
                                                <p className="text-body text-neutral-700">
                                                    {selectedChapters.length === 0
                                                        ? t('review.wholeBook')
                                                        : t('review.chaptersSelected', {
                                                              count: selectedChapters.length,
                                                              subtopics: selectedLeafIds.size,
                                                          })}
                                                </p>
                                                {selectedChapters.length > 0 && (
                                                    <p className="line-clamp-3 text-caption text-neutral-500">
                                                        {selectedChapters
                                                            .map((c) =>
                                                                weightage[c.id]
                                                                    ? `${c.title} (${weightage[c.id]}%)`
                                                                    : c.title
                                                            )
                                                            .join(' · ')}
                                                    </p>
                                                )}
                                            </Card>
                                            <Card className="flex flex-col gap-1 p-3">
                                                <p className="text-caption font-semibold text-neutral-500">
                                                    {t('wizard.types')}
                                                </p>
                                                <p className="text-body text-neutral-700">
                                                    {t('review.totals', {
                                                        questions: totals.questions,
                                                        marks: totals.marks,
                                                    })}
                                                </p>
                                                <p className="line-clamp-3 text-caption text-neutral-500">
                                                    {typePlan
                                                        .map(
                                                            (e) =>
                                                                `${e.count} × ${e.label} (${e.marks_each})`
                                                        )
                                                        .join(' · ')}
                                                </p>
                                            </Card>
                                            <Card className="flex flex-col gap-1 p-3">
                                                <p className="text-caption font-semibold text-neutral-500">
                                                    {t('wizard.details')}
                                                </p>
                                                <p className="text-body text-neutral-700">
                                                    {spec.title?.trim() || t('review.autoTitle')}
                                                </p>
                                                <p className="text-caption text-neutral-500">
                                                    {t('review.detailsLine', {
                                                        minutes: spec.duration_minutes ?? 0,
                                                        difficulty: t(
                                                            `scope.difficulty.${(spec.difficulty ?? 'mixed').toLowerCase()}`
                                                        ),
                                                        language: spec.language ?? 'English',
                                                    })}
                                                    {spec.grade ? ` · ${spec.grade}` : ''}
                                                </p>
                                            </Card>
                                        </div>

                                        {estimate?.sufficient === false && (
                                            <Card className="flex items-center gap-2 border-danger-200 bg-danger-50 p-3">
                                                <Coins className="size-4 text-danger-500" />
                                                <p className="text-caption text-danger-600">
                                                    {t('blueprint.insufficientCredits', {
                                                        needed: Math.round(
                                                            estimate.estimated_credits
                                                        ),
                                                        available: Math.round(
                                                            estimate.current_balance ?? 0
                                                        ),
                                                    })}
                                                </p>
                                            </Card>
                                        )}

                                        {!blueprint && (
                                            <div className="flex flex-wrap items-center gap-2">
                                                <MyButton
                                                    buttonType="primary"
                                                    scale="large"
                                                    onClick={() => void planAndGenerate()}
                                                    disable={planning}
                                                >
                                                    {planning ? (
                                                        <Spinner className="mr-1 size-4 animate-spin" />
                                                    ) : (
                                                        <PaperPlaneTilt className="mr-1 size-4" />
                                                    )}
                                                    {planning
                                                        ? t('scope.planningButton')
                                                        : t('review.generateButton')}
                                                </MyButton>
                                                <MyButton
                                                    buttonType="secondary"
                                                    scale="large"
                                                    onClick={() => void plan()}
                                                    disable={planning}
                                                >
                                                    <ListChecks className="mr-1 size-4" />
                                                    {t('review.adjustPlanButton')}
                                                </MyButton>
                                                <p className="basis-full text-caption text-neutral-400">
                                                    {t('review.generateHint')}
                                                </p>
                                            </div>
                                        )}

                                        {blueprint && (
                                            <div className="flex flex-col gap-4">
                                                <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
                                                    <div className="min-w-0">
                                                        <p className="truncate text-subtitle font-semibold text-neutral-700">
                                                            {blueprint.title}
                                                        </p>
                                                        <p className="text-caption text-neutral-500">
                                                            {t('blueprint.questionsCount', {
                                                                count: blueprint.total_questions,
                                                            })}{' '}
                                                            ·{' '}
                                                            {t('blueprint.marksCount', {
                                                                count: blueprint.total_marks,
                                                                formatted:
                                                                    blueprint.total_marks.toLocaleString(
                                                                        i18n.language
                                                                    ),
                                                            })}
                                                            {blueprint.duration_minutes
                                                                ? t('blueprint.durationSuffix', {
                                                                      minutes:
                                                                          blueprint.duration_minutes,
                                                                  })
                                                                : ''}
                                                        </p>
                                                    </div>
                                                    <MyButton
                                                        buttonType="primary"
                                                        scale="medium"
                                                        onClick={() => void generate()}
                                                        disable={
                                                            planning ||
                                                            blueprint.total_questions === 0
                                                        }
                                                    >
                                                        <PaperPlaneTilt className="mr-1 size-4" />
                                                        {t('blueprint.generateButton', {
                                                            count: blueprint.total_questions,
                                                        })}
                                                        {estimate
                                                            ? t('blueprint.generateCreditsSuffix', {
                                                                  credits: Math.round(
                                                                      estimate.estimated_credits
                                                                  ),
                                                              })
                                                            : ''}
                                                    </MyButton>
                                                </Card>

                                                <BlueprintTable
                                                    blueprint={blueprint}
                                                    onChange={setBlueprint}
                                                    disabled={planning}
                                                />

                                                <Card className="flex flex-col gap-2 p-4">
                                                    <p className="flex items-center gap-2 text-caption font-semibold text-neutral-600">
                                                        <Sparkle className="size-4 text-primary-500" />
                                                        {t('blueprint.askForChangeHeading')}
                                                    </p>
                                                    <div className="flex flex-wrap gap-2">
                                                        {[
                                                            t('blueprint.suggestions.numericals'),
                                                            t(
                                                                'blueprint.suggestions.harderSectionB'
                                                            ),
                                                            t(
                                                                'blueprint.suggestions.moreApplicationBased'
                                                            ),
                                                        ].map((s) => (
                                                            <button
                                                                key={s}
                                                                type="button"
                                                                disabled={planning}
                                                                onClick={() => void plan(s)}
                                                                className="rounded-md border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-caption text-neutral-600 transition-colors hover:border-primary-200 hover:bg-primary-50"
                                                            >
                                                                {s}
                                                            </button>
                                                        ))}
                                                    </div>
                                                    <div className="flex items-end gap-2">
                                                        <MyInput
                                                            label=""
                                                            inputType="text"
                                                            input={refineText}
                                                            onChangeFunction={(e) =>
                                                                setRefineText(e.target.value)
                                                            }
                                                            inputPlaceholder={t(
                                                                'blueprint.refinePlaceholder'
                                                            )}
                                                            className="w-full flex-1"
                                                        />
                                                        <MyButton
                                                            buttonType="secondary"
                                                            scale="medium"
                                                            disable={planning || !refineText.trim()}
                                                            onClick={() =>
                                                                void plan(refineText.trim())
                                                            }
                                                        >
                                                            {planning
                                                                ? t('blueprint.updatingButton')
                                                                : t('blueprint.updatePlanButton')}
                                                        </MyButton>
                                                    </div>
                                                </Card>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            <div className="mt-auto flex items-center justify-between gap-2 border-t border-neutral-200 px-5 py-3">
                                <MyButton
                                    buttonType="secondary"
                                    scale="medium"
                                    onClick={goBack}
                                    disable={wizardIndex === 0 || planning}
                                >
                                    <ArrowLeft className="mr-1 size-4" />
                                    {t('wizard.back')}
                                </MyButton>
                                {step !== 'review' ? (
                                    <MyButton
                                        buttonType="primary"
                                        scale="medium"
                                        onClick={goNext}
                                        disable={!canContinue}
                                    >
                                        {t('wizard.continue')}
                                        <ArrowRight className="ml-1 size-4" />
                                    </MyButton>
                                ) : (
                                    <span className="text-caption text-neutral-400">
                                        {typePlan.length === 0 ? t('review.noMixHint') : ''}
                                    </span>
                                )}
                            </div>
                        </Card>
                    </div>
                )}

                {/* ---------------- Generating ---------------- */}
                {!resuming && step === 'generating' && (
                    <Card className="flex flex-col items-center gap-3 p-12 text-center">
                        <Spinner className="size-7 animate-spin text-primary-500" />
                        <p className="text-subtitle font-semibold text-neutral-700">
                            {t('generating.writingHeading', {
                                count: blueprint?.total_questions ?? 0,
                            })}
                        </p>
                        <p className="max-w-md text-body text-neutral-500">
                            {t('generating.hint')}
                        </p>
                    </Card>
                )}

                {/* ---------------- Editor ---------------- */}
                {!resuming && step === 'editor' && result && blueprint && (
                    <div className="flex flex-col gap-4">
                        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
                            <div className="min-w-0">
                                <p className="truncate text-subtitle font-semibold text-neutral-700">
                                    {blueprint.title}
                                </p>
                                <p className="flex flex-wrap items-center gap-x-3 text-caption text-neutral-500">
                                    <span>
                                        {t('review.deliveredCount', {
                                            delivered: result.raw_questions.length,
                                            planned: result.planned,
                                        })}
                                    </span>
                                    {errorCount > 0 ? (
                                        <span className="flex items-center gap-1 text-danger-600">
                                            <WarningCircle className="size-3.5" />
                                            {t('review.needFixing', { count: errorCount })}
                                        </span>
                                    ) : (
                                        <span className="flex items-center gap-1 text-success-600">
                                            <CheckCircle className="size-3.5" />
                                            {t('review.allChecksPassed')}
                                        </span>
                                    )}
                                </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <MyButton
                                    buttonType="secondary"
                                    scale="medium"
                                    onClick={() => setInstructionsOpen(true)}
                                    disable={saving}
                                >
                                    <NotePencil className="mr-1 size-4" />
                                    {t('review.editInstructions')}
                                </MyButton>
                                {/* The sheet a teacher hands out — available before
                                    saving, since most papers are printed, not
                                    delivered online. Sends the on-screen questions
                                    so edits and rewrites are in the printout. */}
                                <PaperDownloadMenu
                                    disabled={saving || result.raw_questions.length === 0}
                                    title={blueprint.title}
                                    fetchPdf={(options) =>
                                        fetchPaperPdf(
                                            kbId,
                                            { blueprint, questions: result.raw_questions },
                                            {
                                                ...options,
                                                gradeLine: spec.grade || undefined,
                                                examDate: printableExamDate(spec.exam_date),
                                            }
                                        )
                                    }
                                    onPublish={(options) =>
                                        publishPaperLink(
                                            kbId,
                                            { blueprint, questions: result.raw_questions },
                                            {
                                                ...options,
                                                gradeLine: spec.grade || undefined,
                                                examDate: printableExamDate(spec.exam_date),
                                            },
                                            generationId ?? undefined
                                        )
                                    }
                                />
                                <MyButton
                                    buttonType="secondary"
                                    scale="medium"
                                    onClick={() => void save('offline-test')}
                                    disable={saving || result.questions.length === 0}
                                >
                                    {t('review.createOfflineTest')}
                                </MyButton>
                                <MyButton
                                    buttonType="primary"
                                    scale="medium"
                                    onClick={() => void save('list')}
                                    disable={saving || result.questions.length === 0}
                                >
                                    <FloppyDisk className="mr-1 size-4" />
                                    {saving ? t('review.savingButton') : t('review.saveButton')}
                                </MyButton>
                            </div>
                        </Card>

                        {(paperLevelIssues.length > 0 || result.warnings.length > 0) && (
                            <Card className="flex flex-col gap-1 border-warning-200 bg-warning-50 p-3">
                                {[
                                    ...result.warnings,
                                    ...paperLevelIssues.map((i) => i.message),
                                ].map((message) => (
                                    <p
                                        key={message}
                                        className="flex items-start gap-2 text-caption text-warning-700"
                                    >
                                        <WarningCircle className="mt-0.5 size-4 shrink-0" />
                                        {message}
                                    </p>
                                ))}
                            </Card>
                        )}

                        <ReviewBoard
                            result={result}
                            blueprint={blueprint}
                            issuesByQuestion={issuesByQuestion}
                            regeneratingNumber={regenNumber}
                            onRegenerate={regenerate}
                            onEdit={setEditIndex}
                            onDelete={(index) => void deleteQuestion(index)}
                            onMove={moveQuestion}
                        />

                        <MyDialog
                            heading={t('review.editInstructions')}
                            open={instructionsOpen}
                            onOpenChange={setInstructionsOpen}
                            dialogWidth="max-w-xl"
                        >
                            <div className="flex flex-col gap-3 p-6">
                                <InstructionsEditor
                                    value={blueprint.instructions ?? []}
                                    onChange={(instructions) =>
                                        setBlueprint({ ...blueprint, instructions })
                                    }
                                />
                                <MyButton
                                    buttonType="primary"
                                    scale="medium"
                                    className="self-end"
                                    onClick={() => setInstructionsOpen(false)}
                                >
                                    {t('review.done')}
                                </MyButton>
                            </div>
                        </MyDialog>

                        <EditQuestionDialog
                            open={editIndex !== null}
                            onOpenChange={(open) => !open && setEditIndex(null)}
                            question={
                                editIndex !== null ? result.raw_questions[editIndex] ?? null : null
                            }
                            onSave={applyEdit}
                        />
                    </div>
                )}
            </div>
        </LayoutContainer>
    );
}
