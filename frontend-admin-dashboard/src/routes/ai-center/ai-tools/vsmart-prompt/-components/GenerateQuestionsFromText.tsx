import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    handleGetQuestionsFromText,
    handleQueryGetListIndividualTopics,
} from '../../../-services/ai-center-service';
import { useForm, UseFormReturn, Controller } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { useAICenter } from '../../../-contexts/useAICenterContext';
import AITasksList from '@/routes/ai-center/-components/AITasksList';
import { languageSupport } from '@/constants/dummy-data';
import { SectionFormType } from '@/types/assessments/assessment-steps';
import { getRandomTaskName } from '@/routes/ai-center/-utils/helper';
import { ArrowRight, PencilSimple, Sparkle } from '@phosphor-icons/react';
import { AITaskIndividualListInterface } from '@/types/ai/generate-assessment/generate-complete-assessment';
import {
    relativeTime,
    statusLabel,
    statusStyles,
    taskDisplayName,
} from '@/routes/ai-center/-utils/format';
import { GeneratingState } from '@/routes/ai-center/-components/GeneratingState';
import AIQuestionsPreview from '@/routes/ai-center/-components/AIQuestionsPreview';
import { RecentFilesPanel } from '@/routes/ai-center/-components/RecentFilesPanel';
import { ToolCostBadge } from '@/components/common/ai-credits/ToolCostBadge';
import { ToolCostConfirmDialog } from '@/components/common/ai-credits/ToolCostConfirmDialog';
import { useToolCostPreview } from '@/components/common/ai-credits/useToolCostPreview';

const QUESTION_TYPES = ['MCQ', 'True/False', 'Numeric', 'Short answer', 'Mixed'];

// QUESTION_TYPES holds the literal values submitted to the API (and compared
// against the form's current value); this maps each one to its translation
// key so the *displayed* label can be localized without touching the value.
const QUESTION_TYPE_LABEL_KEYS: Record<string, string> = {
    MCQ: 'mcq',
    'True/False': 'trueFalse',
    Numeric: 'numeric',
    'Short answer': 'shortAnswer',
    Mixed: 'mixed',
};

// languageSupport (shared constant) holds raw enum values like 'ENGLISH' /
// 'HINDI'; map them to translation keys for display only.
const LANGUAGE_LABEL_KEYS: Record<string, string> = {
    ENGLISH: 'english',
    HINDI: 'hindi',
};

// Above this estimated credit cost (or if the balance would go low), we surface a
// confirmation step before spending. Preview-only in Phase 1 (nothing is deducted).
const CONFIRM_COST_THRESHOLD = 20;

const formSchema = z.object({
    taskName: z.string().min(1),
    text: z.string().min(1),
    num: z.number().min(1),
    class_level: z.string().min(1),
    topics: z.string().min(1),
    question_type: z.string().min(1),
    question_language: z.string().min(1),
    preferredModel: z.string().optional(),
});

export type QuestionsFromTextData = z.infer<typeof formSchema>;

export const GenerateQuestionsFromText = ({
    form: parentForm,
    currentSectionIndex,
    initialTopic,
}: {
    form?: UseFormReturn<SectionFormType>;
    currentSectionIndex?: number;
    initialTopic?: string;
}) => {
    const { t } = useTranslation('aiCenterGenerateQuestionsFromText');
    const queryClient = useQueryClient();
    const { setLoader, setKey } = useAICenter();
    const [enableTasksDialog, setEnableTasksDialog] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
    const [readyTask, setReadyTask] = useState<AITaskIndividualListInterface | null>(null);
    const [openPreviewDialog, setOpenPreviewDialog] = useState(false);

    const form = useForm<QuestionsFromTextData>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            taskName: getRandomTaskName(),
            text: initialTopic?.trim() ?? '',
            num: 10,
            class_level: '',
            topics: '',
            question_type: 'MCQ',
            question_language: languageSupport[0],
            preferredModel: undefined,
        },
    });

    useEffect(() => {
        const topic = initialTopic?.trim();
        if (topic && !form.getValues('text')) {
            form.setValue('text', topic);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialTopic]);

    // Live "≈ N credits" preview driven by the number-of-questions field.
    const numQuestions = form.watch('num');
    const costPreview = useToolCostPreview('assessment', { num_questions: numQuestions });
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [pendingValues, setPendingValues] = useState<QuestionsFromTextData | null>(null);

    const generateMutation = useMutation({
        mutationFn: async ({ data, taskId }: { data: QuestionsFromTextData; taskId: string }) => {
            setLoader(true);
            setKey('text');
            return handleGetQuestionsFromText(
                data.taskName,
                data.text,
                data.num,
                data.class_level,
                data.topics,
                data.question_type,
                data.question_language,
                taskId,
                data.preferredModel
            );
        },
        onSuccess: (response: unknown) => {
            setLoader(false);
            setKey(null);
            const taskId = (response as { taskId?: string } | null)?.taskId ?? null;
            setPendingTaskId(taskId);
            setReadyTask(null);
            setTimeout(() => {
                queryClient.invalidateQueries({ queryKey: ['GET_INDIVIDUAL_AI_LIST_DATA'] });
            }, 100);
        },
        onError: (error: unknown) => {
            console.error(error);
            setLoader(false);
            setKey(null);
            setErrorMessage(t('errors.generateFailed'));
        },
    });

    const runGenerate = (values: QuestionsFromTextData) => {
        setErrorMessage(null);
        setReadyTask(null);
        setPendingTaskId(null);
        generateMutation.mutate({
            data: { ...values, taskName: getRandomTaskName() },
            taskId: '',
        });
    };

    const onSubmit = (values: QuestionsFromTextData) => {
        const needsConfirm =
            (costPreview.credits != null && costPreview.credits >= CONFIRM_COST_THRESHOLD) ||
            costPreview.isLowBalanceAfter;
        if (needsConfirm) {
            setPendingValues(values);
            setConfirmOpen(true);
            return;
        }
        runGenerate(values);
    };

    const pollGenerateQuestionsFromText = (data: QuestionsFromTextData) => {
        onSubmit(data);
    };

    const { data: recentTasksData } = useQuery({
        ...handleQueryGetListIndividualTopics('TEXT_TO_QUESTIONS'),
        staleTime: 30 * 1000,
        refetchInterval:
            pendingTaskId !== null && readyTask === null ? 5000 : false,
    });

    useEffect(() => {
        if (!pendingTaskId || !Array.isArray(recentTasksData)) return;
        const match = recentTasksData.find(
            (task: AITaskIndividualListInterface) => task.id === pendingTaskId
        );
        if (!match) return;
        if (match.status === 'COMPLETED') {
            setReadyTask(match);
        } else if (match.status === 'FAILED') {
            setErrorMessage(t('errors.taskFailed'));
            setPendingTaskId(null);
        }
    }, [recentTasksData, pendingTaskId]);

    const recentTasks = useMemo(() => {
        const list: AITaskIndividualListInterface[] = Array.isArray(recentTasksData)
            ? recentTasksData
            : [];
        return [...list].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)).slice(0, 3);
    }, [recentTasksData]);

    const isWorking =
        generateMutation.status === 'pending' ||
        (pendingTaskId !== null && readyTask === null);

    return (
        <div className="flex w-full flex-col gap-10 px-4 pb-12 sm:px-8">
            <header className="flex flex-col gap-1">
                <h1 className="text-2xl font-semibold text-gray-900 sm:text-3xl">
                    {t('header.title')}
                </h1>
                <p className="text-sm text-gray-500">{t('header.subtitle')}</p>
            </header>

            <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-8">
                <Section step={1} title={t('sections.topic')}>
                    <div className="flex flex-col gap-4">
                        <Controller
                            control={form.control}
                            name="topics"
                            render={({ field, fieldState }) => (
                                <Field
                                    label={t('fields.topicName.label')}
                                    error={fieldState.error ? t('fields.topicName.error') : null}
                                >
                                    <input
                                        {...field}
                                        placeholder={t('fields.topicName.placeholder')}
                                        disabled={isWorking}
                                        className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm placeholder:text-neutral-400 focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:bg-neutral-50"
                                    />
                                </Field>
                            )}
                        />
                        <Controller
                            control={form.control}
                            name="text"
                            render={({ field, fieldState }) => (
                                <Field
                                    label={t('fields.learningGoal.label')}
                                    error={
                                        fieldState.error ? t('fields.learningGoal.error') : null
                                    }
                                >
                                    <textarea
                                        {...field}
                                        placeholder={t('fields.learningGoal.placeholder')}
                                        rows={4}
                                        disabled={isWorking}
                                        className="w-full resize-y rounded-xl border border-neutral-200 bg-white p-3 text-sm placeholder:text-neutral-400 focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:bg-neutral-50"
                                    />
                                </Field>
                            )}
                        />
                    </div>
                </Section>

                <Section step={2} title={t('sections.audience')}>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <Controller
                            control={form.control}
                            name="class_level"
                            render={({ field, fieldState }) => (
                                <Field
                                    label={t('fields.classLevel.label')}
                                    error={fieldState.error ? t('fields.classLevel.error') : null}
                                >
                                    <input
                                        {...field}
                                        placeholder={t('fields.classLevel.placeholder')}
                                        disabled={isWorking}
                                        className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm placeholder:text-neutral-400 focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:bg-neutral-50"
                                    />
                                </Field>
                            )}
                        />
                        <Controller
                            control={form.control}
                            name="num"
                            render={({ field, fieldState }) => (
                                <Field
                                    label={t('fields.numQuestions.label')}
                                    error={
                                        fieldState.error ? t('fields.numQuestions.error') : null
                                    }
                                >
                                    <input
                                        value={String(field.value ?? '')}
                                        onChange={(e) => {
                                            const cleaned = e.target.value.replace(/\D/g, '');
                                            field.onChange(cleaned === '' ? 0 : Number(cleaned));
                                        }}
                                        inputMode="numeric"
                                        placeholder={t('fields.numQuestions.placeholder')}
                                        disabled={isWorking}
                                        className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm placeholder:text-neutral-400 focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:bg-neutral-50"
                                    />
                                </Field>
                            )}
                        />
                        <Controller
                            control={form.control}
                            name="question_type"
                            render={({ field }) => (
                                <Field label={t('fields.questionType.label')}>
                                    <div className="flex flex-wrap gap-1.5">
                                        {QUESTION_TYPES.map((q) => (
                                            <button
                                                key={q}
                                                type="button"
                                                onClick={() => field.onChange(q)}
                                                disabled={isWorking}
                                                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                                                    field.value === q
                                                        ? 'border-primary-300 bg-primary-50 text-primary-600'
                                                        : 'border-neutral-200 bg-white text-neutral-600 hover:border-primary-200'
                                                } disabled:opacity-50`}
                                            >
                                                {t(`questionTypes.${QUESTION_TYPE_LABEL_KEYS[q] ?? q}`)}
                                            </button>
                                        ))}
                                    </div>
                                </Field>
                            )}
                        />
                        <Controller
                            control={form.control}
                            name="question_language"
                            render={({ field }) => (
                                <Field label={t('fields.language.label')}>
                                    <select
                                        {...field}
                                        disabled={isWorking}
                                        className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:bg-neutral-50"
                                    >
                                        {languageSupport.map((lang) => (
                                            <option key={lang} value={lang}>
                                                {LANGUAGE_LABEL_KEYS[lang]
                                                    ? t(`languages.${LANGUAGE_LABEL_KEYS[lang]}`)
                                                    : lang.charAt(0) + lang.slice(1).toLowerCase()}
                                            </option>
                                        ))}
                                    </select>
                                </Field>
                            )}
                        />
                    </div>
                </Section>

                {errorMessage && (
                    <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">
                        {errorMessage}
                    </div>
                )}

                {isWorking ? (
                    <GeneratingState
                        title={t('progress.title')}
                        subtitle={t('progress.subtitle')}
                    />
                ) : readyTask ? (
                    <div className="relative overflow-hidden rounded-2xl border border-primary-100 bg-gradient-to-br from-primary-50 via-white to-blue-50 p-6">
                        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex items-start gap-4">
                                <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary-500 text-white shadow-lg shadow-primary-500/20">
                                    <Sparkle size={22} weight="fill" />
                                </div>
                                <div className="flex flex-col gap-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <p className="text-base font-semibold text-gray-900">
                                            {t('result.heading')}
                                        </p>
                                        <span className="inline-flex items-center gap-1 rounded-md bg-primary-50 px-2 py-0.5 text-2xs font-medium text-primary-600 ring-1 ring-inset ring-primary-200">
                                            <Sparkle size={10} weight="fill" />
                                            {t('result.aiGeneratedBadge')}
                                        </span>
                                    </div>
                                    <p className="text-sm text-neutral-600">
                                        {t('result.description')}
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 self-end sm:self-auto">
                                <AIQuestionsPreview
                                    task={readyTask}
                                    openQuestionsPreview={openPreviewDialog}
                                    setOpenQuestionsPreview={setOpenPreviewDialog}
                                    heading={t('taskListHeading')}
                                    pollGenerateQuestionsFromText={
                                        pollGenerateQuestionsFromText
                                    }
                                    sectionsForm={parentForm}
                                    currentSectionIndex={currentSectionIndex}
                                />
                                <button
                                    type="button"
                                    onClick={() => {
                                        setReadyTask(null);
                                        setPendingTaskId(null);
                                        form.reset({
                                            taskName: getRandomTaskName(),
                                            text: '',
                                            num: 10,
                                            class_level: '',
                                            topics: '',
                                            question_type: 'MCQ',
                                            question_language: languageSupport[0],
                                            preferredModel: undefined,
                                        });
                                        setErrorMessage(null);
                                    }}
                                    className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:border-primary-200 hover:bg-primary-50"
                                >
                                    {t('result.draftAnother')}
                                </button>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-wrap items-center gap-3">
                        <button
                            type="submit"
                            className="inline-flex w-fit items-center gap-2 rounded-xl bg-primary-500 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-600"
                        >
                            {t('actions.draftQuestions')}
                            <ArrowRight size={16} weight="bold" />
                        </button>
                        <ToolCostBadge
                            credits={costPreview.credits}
                            sufficient={costPreview.sufficient}
                            coverage={costPreview.coverage}
                            loading={costPreview.isLoading}
                        />
                    </div>
                )}
            </form>

            <ToolCostConfirmDialog
                open={confirmOpen}
                onOpenChange={setConfirmOpen}
                credits={costPreview.credits}
                currentBalance={costPreview.currentBalance}
                balanceAfter={costPreview.balanceAfter}
                sufficient={costPreview.sufficient}
                coverage={costPreview.coverage}
                confirmLabel={t('actions.draftQuestions')}
                onConfirm={() => {
                    if (pendingValues) runGenerate(pendingValues);
                }}
            />

            <RecentFilesPanel
                tasks={recentTasks}
                title={t('recentDrafts.title')}
                fallbackLabel={t('recentDrafts.fallbackLabel')}
                emptyHint={t('recentDrafts.emptyHint')}
                onOpenAll={() => setEnableTasksDialog(true)}
                overrideIcon={
                    <PencilSimple size={18} weight="fill" className="text-primary-500" />
                }
            />

            <AITasksList
                heading={t('taskListHeading')}
                enableDialog={enableTasksDialog}
                setEnableDialog={setEnableTasksDialog}
                sectionsForm={parentForm}
                currentSectionIndex={currentSectionIndex}
            />
        </div>
    );
};

const Section = ({
    step,
    title,
    children,
}: {
    step: number;
    title: string;
    children: React.ReactNode;
}) => (
    <section className="flex flex-col gap-3">
        <div className="flex items-baseline gap-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-50 text-xs font-semibold text-primary-600">
                {step}
            </span>
            <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        </div>
        <div className="pl-9">{children}</div>
    </section>
);

const Field = ({
    label,
    error,
    children,
}: {
    label: string;
    error?: string | null;
    children: React.ReactNode;
}) => (
    <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-neutral-600">{label}</label>
        {children}
        {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
);
