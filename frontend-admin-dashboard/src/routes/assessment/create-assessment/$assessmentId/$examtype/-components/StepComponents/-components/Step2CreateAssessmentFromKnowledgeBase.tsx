import { useEffect, useMemo, useState } from 'react';
import { UseFormReturn, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { BookOpenText, CaretLeft, Spinner, WarningCircle } from '@phosphor-icons/react';
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
    buildBlueprint,
    getPaperJob,
    getTopics,
    markGenerationSaved,
    regenerateQuestion,
    savePaperToQuestionBank,
    startGeneration,
    validatePaper,
} from '@/routes/knowledge-base/-services/paper-service';
import { BlueprintTable } from '@/routes/knowledge-base/-components/paper/BlueprintTable';
import { ReviewBoard } from '@/routes/knowledge-base/-components/paper/ReviewBoard';
import {
    TopicPicker,
    toSelectedNodeIds,
} from '@/routes/knowledge-base/-components/paper/TopicPicker';
import type {
    Blueprint,
    CreditEstimate,
    KbTopic,
    PaperIssue,
    PaperResult,
    RawPaperQuestion,
} from '@/routes/knowledge-base/-types/paper';
import { getQuestionPaperById } from '@/routes/assessment/question-papers/-utils/question-paper-services';
import { transformResponseDataToMyQuestionsSchema } from '@/routes/assessment/question-papers/-utils/helper';
import sectionDetailsSchema from '../../../-utils/section-details-schema';
import { isUntouchedSection, sectionsFromKbPaper } from '../../../-utils/kb-paper-sections';

type SectionFormType = z.infer<typeof sectionDetailsSchema>;

const POLL_MS = 3000;
/** ~30s of unbroken polling failures before we stop and say so. */
const MAX_CONSECUTIVE_POLL_ERRORS = 10;

const DIFFICULTY_OPTIONS = [
    { value: 'EASY', label: 'Easy' },
    { value: 'MEDIUM', label: 'Medium' },
    { value: 'HARD', label: 'Hard' },
    { value: 'MIXED', label: 'Mixed' },
];

const specSchema = z.object({
    totalQuestions: z.coerce
        .number()
        .int()
        .min(1, 'At least 1 question')
        .max(120, 'At most 120 in one paper'),
    durationMinutes: z.coerce.number().int().min(5, 'At least 5 minutes').max(600, 'At most 600'),
    difficulty: z.enum(['EASY', 'MEDIUM', 'HARD', 'MIXED']),
    grade: z.string().optional(),
});

type SpecValues = z.infer<typeof specSchema>;

const errorMessage = (error: unknown, fallback: string): string => {
    const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
    if (typeof detail === 'string' && detail) return detail;
    const message = (detail as unknown as { message?: string } | undefined)?.message;
    return typeof message === 'string' && message ? message : fallback;
};

type Step = 'kb' | 'spec' | 'blueprint' | 'generating' | 'review';

/**
 * Build a WHOLE assessment from one knowledge base.
 *
 * The per-section dialog next to this one fills one section a teacher has already
 * created. That is the right shape when the paper structure is already decided —
 * and the wrong shape when it is not, because the teacher then has to invent the
 * section breakdown themselves, create each section by hand, and run that dialog
 * once per section.
 *
 * This starts from the other end: the planner reads the book's topic tree and
 * proposes the sections (topic x type x count x marks), the teacher edits that
 * table while it is still cheap, and only then are questions written. The plan is
 * what becomes the assessment's sections.
 */
const Step2CreateAssessmentFromKnowledgeBase = ({
    form,
    onSectionsCreated,
}: {
    form: UseFormReturn<SectionFormType>;
    /** Called with the number of sections added, so Step 2 can refresh its accordion. */
    onSectionsCreated?: (sectionCount: number) => void;
}) => {
    const { t: tCurriculum } = useTranslation('knowledgeBaseCurriculum');
    const [open, setOpen] = useState(false);
    const [step, setStep] = useState<Step>('kb');
    const [kbId, setKbId] = useState<string | null>(null);
    const [kbName, setKbName] = useState<string>('');
    const [topics, setTopics] = useState<KbTopic[] | null>(null);
    const [selectedLeafIds, setSelectedLeafIds] = useState<Set<string>>(new Set());
    const [blueprint, setBlueprint] = useState<Blueprint | null>(null);
    const [estimate, setEstimate] = useState<CreditEstimate | null>(null);
    const [planning, setPlanning] = useState(false);
    const [refineText, setRefineText] = useState('');
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

    const specForm = useForm<SpecValues>({
        resolver: zodResolver(specSchema),
        defaultValues: { totalQuestions: 20, durationMinutes: 60, difficulty: 'MIXED', grade: '' },
    });

    const reset = () => {
        setStep('kb');
        setKbId(null);
        setKbName('');
        setTopics(null);
        setSelectedLeafIds(new Set());
        setBlueprint(null);
        setEstimate(null);
        setPlanning(false);
        setRefineText('');
        setTaskId(null);
        setGenerationId(null);
        setResult(null);
        setIssues([]);
        setRegeneratingNumber(null);
        specForm.reset({
            totalQuestions: 20,
            durationMinutes: 60,
            difficulty: 'MIXED',
            grade: '',
        });
    };

    const close = (next: boolean) => {
        setOpen(next);
        if (!next) reset();
    };

    const chooseKb = async (id: string, name: string) => {
        setKbId(id);
        setKbName(name);
        setStep('spec');
        setTopics(null);
        try {
            const list = await getTopics(id);
            setTopics(list);
            // Everything on by default: narrowing down is easier than ticking a whole
            // syllabus before anything can happen.
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
            toast.error(errorMessage(error, 'Could not read the topics in this knowledge base'));
        }
    };

    // ---- Plan --------------------------------------------------------------
    const plan = async (values: SpecValues, instruction?: string) => {
        if (!kbId || !topics) return;
        setPlanning(true);
        try {
            const response = await buildBlueprint(kbId, {
                spec: {
                    total_questions: values.totalQuestions,
                    duration_minutes: values.durationMinutes,
                    difficulty: values.difficulty,
                    grade: values.grade || undefined,
                },
                selected_node_ids: toSelectedNodeIds(topics, selectedLeafIds),
                // On a refine the planner needs the table as it currently stands, so the
                // teacher's own edits survive the round trip.
                current_blueprint: instruction ? blueprint ?? undefined : undefined,
                instruction,
            });
            setBlueprint(response.blueprint);
            setEstimate(response.generation_estimate);
            setStep('blueprint');
            setRefineText('');
        } catch (error) {
            toast.error(errorMessage(error, 'Could not plan this paper'));
        } finally {
            setPlanning(false);
        }
    };

    // ---- Generate ----------------------------------------------------------
    const generate = async () => {
        if (!kbId || !blueprint) return;
        try {
            const response = await startGeneration(kbId, {
                blueprint,
                grade: specForm.getValues('grade') || undefined,
            });
            setTaskId(response.task_id);
            setGenerationId(response.generation_id ?? null);
            setResult(null);
            setStep('generating');
        } catch (error) {
            toast.error(errorMessage(error, 'Could not start generating'));
        }
    };

    useEffect(() => {
        if (step !== 'generating' || !taskId) return;
        let cancelled = false;
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
                    toast.error(job.status_message || 'Generation failed');
                    setStep('blueprint');
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
                    setStep('blueprint');
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
            // A null number means the issue is about the paper as a whole.
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
            // Replace by index: the raw and formatted lists are paired positionally, so
            // matching on anything else can swap the wrong question.
            const position = result.raw_questions.findIndex((q) => q === raw);
            if (position < 0) return;
            const nextRaw = [...result.raw_questions];
            const nextFormatted = [...result.questions];
            nextRaw[position] = replacement.raw_question;
            nextFormatted[position] = replacement.question;
            setResult({ ...result, raw_questions: nextRaw, questions: nextFormatted });
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
            toast.error(errorMessage(error, 'Could not rewrite that question'));
        } finally {
            setRegeneratingNumber(null);
        }
    };

    // ---- Turn the plan into sections ---------------------------------------
    /**
     * Sections come from the blueprint ROWS (see sectionsFromKbPaper): rows grouped by
     * section name, each question in the row it was written for, marks from the row.
     */
    const createSections = async () => {
        if (!result || result.questions.length === 0) return;
        setInserting(true);
        try {
            const saved = await savePaperToQuestionBank({
                title: `${kbName} — ${result.blueprint.title}`,
                questions: result.questions,
            });
            const savedId = saved?.saved_question_paper_id;
            if (!savedId) throw new Error('The question paper was not saved');

            // Questions only have ids once stored, and a section refers to them by id.
            const stored = await getQuestionPaperById(savedId);
            const questions = transformResponseDataToMyQuestionsSchema(stored.question_dtolist);

            // Keep sections the teacher built by hand — replacing them would be the same
            // silent data loss the per-section flows used to have. The blank section Step 2
            // opens with is not one of those: left in place it sat above the generated
            // sections with no questions and no marks, and Next stayed disabled without
            // saying why.
            const existingSections = (form.getValues('section') ?? []).filter(
                (section) => !isUntouchedSection(section)
            );
            const newSections = sectionsFromKbPaper(
                result.blueprint,
                result.raw_questions,
                questions,
                existingSections.length
            );

            if (newSections.length === 0) {
                toast.error('No questions could be placed into sections');
                return;
            }

            form.setValue('section', [...existingSections, ...newSections]);
            form.trigger('section');

            if (generationId) {
                // Best effort: the sections exist either way, so a history bookkeeping
                // failure must not read as a failed insert.
                markGenerationSaved(generationId, savedId).catch(() => undefined);
            }

            onSectionsCreated?.(newSections.length);
            toast.success(
                `Added ${newSections.length} section${newSections.length === 1 ? '' : 's'} with ${questions.length} questions`
            );
            close(false);
        } catch (error) {
            toast.error(errorMessage(error, 'Could not build the assessment from this plan'));
        } finally {
            setInserting(false);
        }
    };

    // ---- Render ------------------------------------------------------------
    const footer = (() => {
        if (step === 'kb') {
            return (
                <MyButton buttonType="secondary" scale="medium" onClick={() => close(false)}>
                    Cancel
                </MyButton>
            );
        }
        if (step === 'spec') {
            return (
                <>
                    <MyButton buttonType="secondary" scale="medium" onClick={() => setStep('kb')}>
                        <CaretLeft className="mr-1 size-4" />
                        Back
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        // A knowledge base with no topic tree draws on all of its
                        // material, so an empty selection only blocks when there were
                        // topics to choose from.
                        disable={
                            planning ||
                            topics === null ||
                            (topics.length > 0 && selectedLeafIds.size === 0)
                        }
                        onClick={specForm.handleSubmit((values) => plan(values))}
                    >
                        {planning ? 'Planning…' : 'Plan the paper'}
                    </MyButton>
                </>
            );
        }
        if (step === 'blueprint') {
            return (
                <>
                    <MyButton buttonType="secondary" scale="medium" onClick={() => setStep('spec')}>
                        <CaretLeft className="mr-1 size-4" />
                        Back
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        disable={planning || !blueprint || blueprint.total_questions === 0}
                        onClick={generate}
                    >
                        Generate {blueprint?.total_questions ?? 0} questions
                        {estimate ? ` (${Math.round(estimate.estimated_credits)} credits)` : ''}
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
                        onClick={() => setStep('blueprint')}
                    >
                        <CaretLeft className="mr-1 size-4" />
                        Back to the plan
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        disable={inserting || !result?.questions.length}
                        onClick={createSections}
                    >
                        {inserting ? 'Adding…' : 'Add these sections to the assessment'}
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
                <div className="flex size-10 items-center justify-center rounded-lg bg-primary-50 text-primary-500 transition-colors group-hover:bg-primary-500 group-hover:text-white">
                    <BookOpenText size={20} weight="bold" />
                </div>
                <div className="flex-1">
                    <div className="text-sm font-semibold text-neutral-800">
                        Build the whole assessment from a knowledge base
                    </div>
                    <div className="text-xs text-neutral-500">
                        Plan the sections from your book, then generate every question
                    </div>
                </div>
            </button>

            <MyDialog
                heading={step === 'kb' ? 'Choose a knowledge base' : `${kbName} — whole assessment`}
                open={open}
                onOpenChange={close}
                dialogWidth="max-w-5xl"
                footer={footer}
            >
                <div className="flex flex-col gap-5 p-6">
                    {step === 'kb' && (
                        <>
                            <p className="text-body text-neutral-500">
                                The plan and every question come only from the material in the
                                knowledge base you pick, and each question shows the page it came
                                from.
                            </p>
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
                                    <BookOpenText className="size-6 text-neutral-300" />
                                    <p className="text-body text-neutral-600">
                                        No knowledge bases yet
                                    </p>
                                    <p className="text-caption text-neutral-500">
                                        Add your books or notes under Knowledge Base first, then
                                        come back here.
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
                                            {kb.stats?.sources ?? 0} sources
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </>
                    )}

                    {step === 'spec' && (
                        <>
                            <Form {...specForm}>
                                <form
                                    onSubmit={specForm.handleSubmit((values) => plan(values))}
                                    className="grid grid-cols-1 gap-4 sm:grid-cols-4"
                                >
                                    <FormField
                                        control={specForm.control}
                                        name="totalQuestions"
                                        render={({ field, fieldState }) => (
                                            <FormItem className="w-full">
                                                <FormControl>
                                                    <MyInput
                                                        label="Total questions"
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
                                    <FormField
                                        control={specForm.control}
                                        name="durationMinutes"
                                        render={({ field, fieldState }) => (
                                            <FormItem className="w-full">
                                                <FormControl>
                                                    <MyInput
                                                        label="Duration (minutes)"
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
                                        label="Difficulty"
                                        name="difficulty"
                                        control={specForm.control}
                                        labelStyle="w-full"
                                        className="w-full"
                                        options={DIFFICULTY_OPTIONS.map((opt, i) => ({
                                            value: opt.value,
                                            label: opt.label,
                                            _id: i,
                                        }))}
                                    />
                                    <FormField
                                        control={specForm.control}
                                        name="grade"
                                        render={({ field, fieldState }) => (
                                            <FormItem className="w-full">
                                                <FormControl>
                                                    <MyInput
                                                        label="Class / level"
                                                        inputType="text"
                                                        input={field.value ?? ''}
                                                        onChangeFunction={field.onChange}
                                                        error={fieldState.error?.message}
                                                        className="w-full"
                                                    />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </form>
                            </Form>

                            {topics === null && <Skeleton className="h-40 w-full rounded-lg" />}
                            {topics !== null && topics.length === 0 && (
                                <div className="flex items-start gap-2 rounded-lg border border-warning-200 bg-warning-50 p-4">
                                    <WarningCircle className="mt-0.5 size-4 shrink-0 text-warning-600" />
                                    <p className="text-caption text-neutral-600">
                                        This knowledge base has no topics yet. The paper will be
                                        planned from all of its material.
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

                    {step === 'blueprint' && blueprint && (
                        <>
                            <p className="text-body text-neutral-500">
                                This is the plan, not the questions. Change it here — it is free to
                                edit and expensive to fix after generating. Each row becomes part of
                                a section.
                            </p>
                            {blueprint.notes?.length > 0 && (
                                <div className="flex items-start gap-2 rounded-lg border border-warning-200 bg-warning-50 p-4">
                                    <WarningCircle className="mt-0.5 size-4 shrink-0 text-warning-600" />
                                    <ul className="flex flex-col gap-1">
                                        {blueprint.notes.map((note) => (
                                            <li
                                                key={note}
                                                className="text-caption text-neutral-600"
                                            >
                                                {note}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            <BlueprintTable
                                blueprint={blueprint}
                                onChange={setBlueprint}
                                disabled={planning}
                            />
                            <div className="flex items-end gap-3">
                                <MyInput
                                    label="Ask for a change"
                                    inputType="text"
                                    inputPlaceholder="e.g. add a numerical section on rotational motion"
                                    input={refineText}
                                    onChangeFunction={(e) => setRefineText(e.target.value)}
                                    className="w-full"
                                />
                                <MyButton
                                    buttonType="secondary"
                                    scale="medium"
                                    disable={planning || !refineText.trim()}
                                    onClick={() =>
                                        plan(specForm.getValues(), refineText.trim() || undefined)
                                    }
                                >
                                    {planning ? 'Revising…' : 'Revise plan'}
                                </MyButton>
                            </div>
                        </>
                    )}

                    {step === 'generating' && (
                        <div className="flex flex-col items-center gap-3 py-12 text-center">
                            <Spinner className="size-8 animate-spin text-primary-500" />
                            <p className="text-body font-medium text-neutral-700">
                                Writing {blueprint?.total_questions ?? 0} questions from {kbName}
                            </p>
                            <p className="text-caption text-neutral-500">
                                Questions are written a few at a time, so a longer paper takes
                                longer. This run is kept in the knowledge base&apos;s history even
                                if you close this.
                            </p>
                        </div>
                    )}

                    {step === 'review' && result && (
                        <>
                            {result.delivered < result.planned && (
                                <div className="flex items-start gap-2 rounded-lg border border-warning-200 bg-warning-50 p-4">
                                    <WarningCircle className="mt-0.5 size-4 shrink-0 text-warning-600" />
                                    <p className="text-caption text-neutral-600">
                                        {result.delivered} of {result.planned} questions could be
                                        written from the material. Add more sources or widen the
                                        topic selection for the rest.
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

export default Step2CreateAssessmentFromKnowledgeBase;
