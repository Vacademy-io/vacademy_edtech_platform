import { useEffect, useMemo, useState } from 'react';
import { UseFormReturn, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import i18next from 'i18next';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Books, CaretLeft, Spinner, WarningCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { MyInput } from '@/components/design-system/input';
import SelectField from '@/components/design-system/select-field';
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { useKnowledgeBases } from '@/routes/knowledge-base/-hooks';
import { CurriculumPicker } from '@/routes/knowledge-base/-components/curriculum/CurriculumPicker';
import { curriculumOnly, ownOnly } from '@/routes/knowledge-base/-components/curriculum/curriculum';
import {
    generateSectionFromKb,
    getPaperJob,
    getTopics,
    markGenerationSaved,
    regenerateQuestion,
    savePaperToQuestionBank,
    validatePaper,
} from '@/routes/knowledge-base/-services/paper-service';
import { ReviewBoard } from '@/routes/knowledge-base/-components/paper/ReviewBoard';
import {
    TopicPicker,
    toSelectedNodeIds,
} from '@/routes/knowledge-base/-components/paper/TopicPicker';
import type {
    KbTopic,
    PaperDifficulty,
    PaperIssue,
    PaperQuestionType,
    PaperResult,
    RawPaperQuestion,
} from '@/routes/knowledge-base/-types/paper';
import { getQuestionPaperById } from '@/routes/assessment/question-papers/-utils/question-paper-services';
import { transformResponseDataToMyQuestionsSchema } from '@/routes/assessment/question-papers/-utils/helper';
import sectionDetailsSchema from '../../../-utils/section-details-schema';
import { calculateTotalMarks } from '../../../-utils/helper';

type SectionFormType = z.infer<typeof sectionDetailsSchema>;

const POLL_MS = 3000;
/** ~30s of unbroken polling failures before we stop and tell the teacher. */
const MAX_CONSECUTIVE_POLL_ERRORS = 10;

const buildQuestionTypeOptions = (
    t: TFunction
): Array<{ value: PaperQuestionType; label: string }> => [
    { value: 'MCQS', label: t('setup.questionTypeOptions.mcqs') },
    { value: 'MCQM', label: t('setup.questionTypeOptions.mcqm') },
    { value: 'TRUE_FALSE', label: t('setup.questionTypeOptions.trueFalse') },
    { value: 'ONE_WORD', label: t('setup.questionTypeOptions.oneWord') },
    { value: 'LONG_ANSWER', label: t('setup.questionTypeOptions.longAnswer') },
    { value: 'NUMERIC', label: t('setup.questionTypeOptions.numeric') },
    { value: 'PASSAGE', label: t('setup.questionTypeOptions.passage') },
    { value: 'ASSERTION_REASON', label: t('setup.questionTypeOptions.assertionReason') },
];

const buildDifficultyOptions = (t: TFunction): Array<{ value: PaperDifficulty; label: string }> => [
    { value: 'EASY', label: t('setup.difficultyOptions.easy') },
    { value: 'MEDIUM', label: t('setup.difficultyOptions.medium') },
    { value: 'HARD', label: t('setup.difficultyOptions.hard') },
];

const setupSchema = z.object({
    count: z.coerce
        .number()
        .int()
        .min(1, i18next.t('assessmentStep2CreateFromKnowledgeBase:setup.validation.minCount'))
        .max(60, i18next.t('assessmentStep2CreateFromKnowledgeBase:setup.validation.maxCount')),
    questionType: z.enum([
        'MCQS',
        'MCQM',
        'TRUE_FALSE',
        'ONE_WORD',
        'LONG_ANSWER',
        'NUMERIC',
        'PASSAGE',
        'ASSERTION_REASON',
    ]),
    difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']),
});

type SetupValues = z.infer<typeof setupSchema>;

const errorMessage = (error: unknown, fallback: string): string => {
    const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
    return typeof detail === 'string' && detail ? detail : fallback;
};

type Step = 'kb' | 'setup' | 'generating' | 'review';

/**
 * Fill this section with questions written from the institute's own material.
 *
 * The other AI sources here start from a prompt or a file the teacher supplies
 * each time. This one starts from a knowledge base that was already ingested and
 * checked, so questions come with the page they were taken from — which is the
 * difference between a paper a teacher trusts and one they re-verify by hand.
 */
const Step2CreateFromKnowledgeBase = ({
    form,
    index,
}: {
    form: UseFormReturn<SectionFormType>;
    index: number;
}) => {
    const { t } = useTranslation('assessmentStep2CreateFromKnowledgeBase');
    const { t: tCurriculum } = useTranslation('knowledgeBaseCurriculum');
    const [open, setOpen] = useState(false);
    const [step, setStep] = useState<Step>('kb');
    const [kbId, setKbId] = useState<string | null>(null);
    const [kbName, setKbName] = useState<string>('');
    const [topics, setTopics] = useState<KbTopic[] | null>(null);
    const [selectedLeafIds, setSelectedLeafIds] = useState<Set<string>>(new Set());
    const [taskId, setTaskId] = useState<string | null>(null);
    const [generationId, setGenerationId] = useState<string | null>(null);
    const [result, setResult] = useState<PaperResult | null>(null);
    const [issues, setIssues] = useState<PaperIssue[]>([]);
    const [regeneratingNumber, setRegeneratingNumber] = useState<number | null>(null);
    const [inserting, setInserting] = useState(false);

    const { data: allKnowledgeBases, isLoading: kbsLoading } = useKnowledgeBases();
    // Curriculum libraries (NCERT…) are picked Board → Class → Subject; the
    // institute's own bases stay a plain list underneath.
    const knowledgeBases = useMemo(() => ownOnly(allKnowledgeBases), [allKnowledgeBases]);
    const curriculumBases = useMemo(() => curriculumOnly(allKnowledgeBases), [allKnowledgeBases]);

    const setupForm = useForm<SetupValues>({
        resolver: zodResolver(setupSchema),
        defaultValues: { count: 10, questionType: 'MCQS', difficulty: 'MEDIUM' },
    });

    const sectionName =
        form.getValues(`section.${index}.sectionName`) ||
        t('defaultSectionName', { number: index + 1 });

    const reset = () => {
        setStep('kb');
        setKbId(null);
        setKbName('');
        setTopics(null);
        setSelectedLeafIds(new Set());
        setTaskId(null);
        setGenerationId(null);
        setResult(null);
        setIssues([]);
        setRegeneratingNumber(null);
        setupForm.reset({ count: 10, questionType: 'MCQS', difficulty: 'MEDIUM' });
    };

    const close = (next: boolean) => {
        setOpen(next);
        if (!next) reset();
    };

    // ---- Topics for the chosen knowledge base ------------------------------
    const chooseKb = async (id: string, name: string) => {
        setKbId(id);
        setKbName(name);
        setStep('setup');
        setTopics(null);
        try {
            const list = await getTopics(id);
            setTopics(list);
            // Everything on by default: the teacher narrows down rather than
            // having to tick a whole syllabus before they can do anything.
            const allLeaves = new Set<string>();
            list.forEach((topic) => {
                if (topic.subtopics?.length) {
                    topic.subtopics.forEach((s) => allLeaves.add(s.id));
                } else {
                    allLeaves.add(topic.id);
                }
            });
            setSelectedLeafIds(allLeaves);
        } catch (error) {
            setTopics([]);
            toast.error(errorMessage(error, t('errors.loadTopics')));
        }
    };

    // ---- Generate ----------------------------------------------------------
    const startGenerating = async (values: SetupValues) => {
        if (!kbId || !topics) return;
        const nodeIds = toSelectedNodeIds(topics, selectedLeafIds);
        try {
            const response = await generateSectionFromKb(kbId, {
                selected_node_ids: nodeIds,
                count: values.count,
                question_type: values.questionType,
                difficulty: values.difficulty,
                marks_each: Number(form.getValues(`section.${index}.marks_per_question`)) || 1,
                section_title: sectionName,
            });
            setTaskId(response.task_id);
            setGenerationId(response.generation_id);
            setResult(null);
            setStep('generating');
        } catch (error) {
            toast.error(errorMessage(error, t('errors.startGenerating')));
        }
    };

    useEffect(() => {
        if (step !== 'generating' || !taskId) return;
        let cancelled = false;
        // Consecutive failed polls, not total polls: a long generation is normal and
        // must not time out, but a poll that keeps erroring used to retry forever and
        // leave this dialog spinning on "Writing questions from …" with no way out.
        let consecutiveErrors = 0;
        const tick = async () => {
            try {
                const job = await getPaperJob(taskId);
                if (cancelled) return;
                consecutiveErrors = 0;
                if (job.status === 'COMPLETED' && job.result) {
                    setResult(job.result);
                    setIssues(job.result.issues);
                    setStep('review');
                    return;
                }
                if (job.status === 'FAILED') {
                    toast.error(job.status_message || t('errors.generationFailed'));
                    setStep('setup');
                    return;
                }
                setTimeout(tick, POLL_MS);
            } catch (error) {
                if (cancelled) return;
                consecutiveErrors += 1;
                if (consecutiveErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
                    toast.error(
                        errorMessage(
                            error,
                            'Lost contact with the generator. It may still be running — check the knowledge base history.'
                        )
                    );
                    setStep('setup');
                    return;
                }
                setTimeout(tick, POLL_MS);
            }
        };
        const handle = setTimeout(tick, POLL_MS);
        return () => {
            cancelled = true;
            clearTimeout(handle);
        };
    }, [step, taskId]);

    const issuesByQuestion = useMemo(() => {
        const map = new Map<number, PaperIssue[]>();
        issues.forEach((issue) => {
            // A null number means the issue is about the paper as a whole, not
            // any one question, so there is no card to hang it on.
            if (issue.question_number === null) return;
            const list = map.get(issue.question_number) ?? [];
            list.push(issue);
            map.set(issue.question_number, list);
        });
        return map;
    }, [issues]);

    const regenerate = async (raw: RawPaperQuestion, instruction?: string) => {
        if (!kbId || !result) return;
        const rowId = raw.kb_meta?.row_id;
        const row = result.blueprint.rows.find((r) => r.id === rowId);
        if (!row) return;
        setRegeneratingNumber(raw.question_number ?? null);
        try {
            const replacement = await regenerateQuestion(kbId, {
                blueprint_row: row,
                instruction,
            });
            // Replace by index, never by question number: the formatter and the
            // raw list are paired positionally, so matching on anything else can
            // swap the wrong question.
            const position = result.raw_questions.findIndex((q) => q === raw);
            if (position < 0) return;
            const nextRaw = [...result.raw_questions];
            const nextFormatted = [...result.questions];
            nextRaw[position] = replacement.raw_question;
            nextFormatted[position] = replacement.question;
            setResult({ ...result, raw_questions: nextRaw, questions: nextFormatted });
            // A rewritten question can introduce a duplicate that did not
            // exist before, and clears warnings that no longer apply.
            try {
                const revalidated = await validatePaper(kbId, {
                    blueprint: result.blueprint,
                    questions: nextRaw,
                });
                setIssues(revalidated.issues);
            } catch {
                /* keep the previous issues rather than clearing them */
            }
        } catch (error) {
            toast.error(errorMessage(error, t('errors.regenerateQuestion')));
        } finally {
            setRegeneratingNumber(null);
        }
    };

    // ---- Insert into this section -----------------------------------------
    /**
     * An assessment section refers to questions by id, and ids only exist once
     * the questions are stored. So this saves a question paper first and then
     * links this section to what came back — the same path every other AI
     * source here takes.
     */
    const insertIntoSection = async () => {
        if (!result || result.questions.length === 0) return;
        setInserting(true);
        try {
            const title = t('insert.paperTitle', { kbName, sectionName });
            const saved = await savePaperToQuestionBank({
                title,
                questions: result.questions,
            });

            const savedId = saved?.saved_question_paper_id;
            if (!savedId) throw new Error(t('errors.paperNotSaved'));

            const stored = await getQuestionPaperById(savedId);
            const questions = transformResponseDataToMyQuestionsSchema(stored.question_dtolist);

            // The section's marks, penalty and per-question duration are applied
            // by effects that watch THOSE fields — they do not re-run when
            // questions arrive. transformResponseDataToMyQuestionsSchema also
            // returns questionMark: '' for every question. Taking the values from
            // the section here is what stops the section totalling zero marks.
            const section = form.getValues(`section.${index}`);
            const marksPerQuestion = section?.marks_per_question;
            const penalty = section?.negative_marking?.value;
            const duration = section?.question_duration;

            const added = questions.map((question) => ({
                questionId: question.questionId,
                questionName: question.questionName,
                questionType: question.questionType,
                questionMark: marksPerQuestion,
                questionPenalty: penalty,
                ...(question.questionType === 'MCQM' && {
                    correctOptionIdsCnt: question?.multipleChoiceOptions?.filter(
                        (item) => item.isSelected
                    ).length,
                }),
                questionDuration: {
                    hrs: duration?.hrs,
                    min: duration?.min,
                },
                parentRichText: question.parentRichTextContent,
            }));

            // Append. The card offers to ADD questions to this section, so
            // replacing would silently discard whatever the teacher already put
            // there — including questions from a previous run of this dialog.
            const existing = section?.adaptive_marking_for_each_question ?? [];
            const merged = [...existing, ...added];

            form.setValue(`section.${index}.adaptive_marking_for_each_question`, merged);
            form.setValue(`section.${index}.total_marks`, String(calculateTotalMarks(merged)));
            form.trigger(`section.${index}.adaptive_marking_for_each_question`);

            if (generationId) {
                // Best-effort: the questions are already in the section, so a
                // history bookkeeping failure must not read as a failed insert.
                markGenerationSaved(generationId, savedId).catch(() => undefined);
            }

            toast.success(t('insert.successToast', { count: questions.length, sectionName }));
            close(false);
        } catch (error) {
            toast.error(errorMessage(error, t('errors.insertQuestions')));
        } finally {
            setInserting(false);
        }
    };

    // ---- Render ------------------------------------------------------------
    const footer = (() => {
        if (step === 'kb') {
            return (
                <MyButton buttonType="secondary" scale="medium" onClick={() => close(false)}>
                    {t('footer.cancel')}
                </MyButton>
            );
        }
        if (step === 'setup') {
            return (
                <>
                    <MyButton buttonType="secondary" scale="medium" onClick={() => setStep('kb')}>
                        <CaretLeft className="mr-1 size-4" />
                        {t('footer.back')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        // A knowledge base with no topic tree draws on all of its
                        // material, so an empty selection is only a blocker when
                        // there were topics to choose from in the first place.
                        disable={
                            topics === null || (topics.length > 0 && selectedLeafIds.size === 0)
                        }
                        onClick={setupForm.handleSubmit(startGenerating)}
                    >
                        {t('footer.generateQuestions')}
                    </MyButton>
                </>
            );
        }
        if (step === 'review') {
            return (
                <>
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        disable={inserting}
                        onClick={() => setStep('setup')}
                    >
                        <CaretLeft className="mr-1 size-4" />
                        {t('footer.changeSelection')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        disable={inserting || !result?.questions.length}
                        onClick={insertIntoSection}
                    >
                        {inserting
                            ? t('footer.adding')
                            : t('footer.addQuestions', { count: result?.questions.length ?? 0 })}
                    </MyButton>
                </>
            );
        }
        return <></>;
    })();

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="group flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary-400 hover:shadow-md"
            >
                <div className="flex size-10 items-center justify-center rounded-lg bg-success-50 text-success-600 transition-colors group-hover:bg-success-500 group-hover:text-white">
                    <Books size={20} weight="bold" />
                </div>
                <div className="flex-1">
                    <div className="text-sm font-semibold text-neutral-800">
                        {t('trigger.title')}
                    </div>
                    <div className="text-xs text-neutral-500">{t('trigger.subtitle')}</div>
                </div>
            </button>

            <MyDialog
                heading={
                    step === 'kb'
                        ? t('dialog.headingChooseKb')
                        : t('dialog.headingKbSection', { kbName, sectionName })
                }
                open={open}
                onOpenChange={close}
                dialogWidth="max-w-4xl"
                footer={footer}
            >
                <div className="flex flex-col gap-5 p-6">
                    {step === 'kb' && (
                        <>
                            <p className="text-body text-neutral-500">{t('kbStep.intro')}</p>
                            {kbsLoading && <Skeleton className="h-24 w-full rounded-lg" />}
                            {!kbsLoading && curriculumBases.length > 0 && (
                                <div className="flex flex-col gap-3 rounded-lg border border-primary-100 bg-primary-50 p-4">
                                    <p className="text-body font-medium text-neutral-700">
                                        {tCurriculum('pickHeading')}
                                    </p>
                                    <CurriculumPicker
                                        knowledgeBases={curriculumBases}
                                        onPick={(kb) => chooseKb(kb.id, kb.name)}
                                    />
                                </div>
                            )}
                            {!kbsLoading && curriculumBases.length > 0 && knowledgeBases.length > 0 && (
                                <p className="text-caption text-neutral-500">{tCurriculum('orOwn')}</p>
                            )}
                            {!kbsLoading && knowledgeBases.length === 0 && curriculumBases.length === 0 && (
                                <div className="flex flex-col items-center gap-2 rounded-lg border border-neutral-200 p-6 text-center">
                                    <Books className="size-6 text-neutral-300" />
                                    <p className="text-body text-neutral-600">
                                        {t('kbStep.emptyTitle')}
                                    </p>
                                    <p className="text-caption text-neutral-500">
                                        {t('kbStep.emptyDescription')}
                                    </p>
                                </div>
                            )}
                            <div className="flex flex-col gap-2">
                                {knowledgeBases?.map((kb) => (
                                    <button
                                        key={kb.id}
                                        type="button"
                                        onClick={() => chooseKb(kb.id, kb.name)}
                                        className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 p-4 text-left transition-colors hover:border-primary-400 hover:bg-primary-50"
                                    >
                                        <div className="min-w-0">
                                            <p className="break-words text-body font-medium text-neutral-700">
                                                {kb.name}
                                            </p>
                                            {kb.description && (
                                                <p className="break-words text-caption text-neutral-500">
                                                    {kb.description}
                                                </p>
                                            )}
                                        </div>
                                        <span className="shrink-0 text-caption text-neutral-500">
                                            {t('kbStep.sourcesCount', {
                                                count: kb.stats?.sources ?? 0,
                                            })}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </>
                    )}

                    {step === 'setup' && (
                        <>
                            <Form {...setupForm}>
                                <form
                                    onSubmit={setupForm.handleSubmit(startGenerating)}
                                    className="grid grid-cols-1 gap-4 sm:grid-cols-3"
                                >
                                    <FormField
                                        control={setupForm.control}
                                        name="count"
                                        render={({ field, fieldState }) => (
                                            <FormItem className="w-full">
                                                <FormControl>
                                                    <MyInput
                                                        label={t('setup.numberOfQuestions')}
                                                        required
                                                        inputType="number"
                                                        input={String(field.value)}
                                                        onChangeFunction={field.onChange}
                                                        error={fieldState.error?.message}
                                                        className="w-full"
                                                    />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <SelectField
                                        label={t('setup.questionType')}
                                        name="questionType"
                                        control={setupForm.control}
                                        labelStyle="w-full"
                                        className="w-full"
                                        options={buildQuestionTypeOptions(t).map((opt, i) => ({
                                            value: opt.value,
                                            label: opt.label,
                                            _id: i,
                                        }))}
                                    />
                                    <SelectField
                                        label={t('setup.difficulty')}
                                        name="difficulty"
                                        control={setupForm.control}
                                        labelStyle="w-full"
                                        className="w-full"
                                        options={buildDifficultyOptions(t).map((opt, i) => ({
                                            value: opt.value,
                                            label: opt.label,
                                            _id: i,
                                        }))}
                                    />
                                </form>
                            </Form>

                            {topics === null && <Skeleton className="h-40 w-full rounded-lg" />}
                            {topics !== null && topics.length === 0 && (
                                <div className="flex items-start gap-2 rounded-lg border border-warning-200 bg-warning-50 p-4">
                                    <WarningCircle className="mt-0.5 size-4 shrink-0 text-warning-600" />
                                    <p className="text-caption text-neutral-600">
                                        {t('setup.noTopicsWarning')}
                                    </p>
                                </div>
                            )}
                            {topics !== null && topics.length > 0 && (
                                <TopicPicker
                                    topics={topics}
                                    selectedLeafIds={selectedLeafIds}
                                    onChange={setSelectedLeafIds}
                                />
                            )}
                        </>
                    )}

                    {step === 'generating' && (
                        <div className="flex flex-col items-center gap-3 py-12 text-center">
                            <Spinner className="size-8 animate-spin text-primary-500" />
                            <p className="text-body font-medium text-neutral-700">
                                {t('generating.writingFrom', { kbName })}
                            </p>
                            <p className="text-caption text-neutral-500">
                                {t('generating.hint')}
                            </p>
                        </div>
                    )}

                    {step === 'review' && result && (
                        <>
                            {result.delivered < result.planned && (
                                <div className="flex items-start gap-2 rounded-lg border border-warning-200 bg-warning-50 p-4">
                                    <WarningCircle className="mt-0.5 size-4 shrink-0 text-warning-600" />
                                    <p className="text-caption text-neutral-600">
                                        {t('review.partialDelivery', {
                                            delivered: result.delivered,
                                            planned: result.planned,
                                        })}
                                    </p>
                                </div>
                            )}
                            <ReviewBoard
                                result={result}
                                blueprint={result.blueprint}
                                issuesByQuestion={issuesByQuestion}
                                regeneratingNumber={regeneratingNumber}
                                onRegenerate={regenerate}
                            />
                        </>
                    )}
                </div>
            </MyDialog>
        </>
    );
};

export default Step2CreateFromKnowledgeBase;
