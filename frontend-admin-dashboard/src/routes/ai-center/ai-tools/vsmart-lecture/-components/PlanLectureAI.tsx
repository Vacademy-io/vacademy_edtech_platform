import AITasksList from '@/routes/ai-center/-components/AITasksList';
import { useAICenter } from '@/routes/ai-center/-contexts/useAICenterContext';
import { PlanLectureAIFormSchema, planLectureFormSchema } from '@/routes/ai-center/-utils/plan-lecture-schema';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    handleGetPlanLecture,
    handleQueryGetListIndividualTopics,
} from '@/routes/ai-center/-services/ai-center-service';
import { getRandomTaskName } from '@/routes/ai-center/-utils/helper';
import { useEffect, useMemo, useState } from 'react';
import { useForm, FormProvider, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { languageSupport, teachingMethod } from '@/constants/dummy-data';
import {
    relativeTime,
    statusLabel,
    statusStyles,
    taskDisplayName,
} from '@/routes/ai-center/-utils/format';
import { GeneratingState } from '@/routes/ai-center/-components/GeneratingState';
import { DraftingDonePanel } from '@/routes/ai-center/-components/DraftingDonePanel';
import { RecentFilesPanel } from '@/routes/ai-center/-components/RecentFilesPanel';
import { AITaskIndividualListInterface } from '@/types/ai/generate-assessment/generate-complete-assessment';
import { ArrowRight, ChalkboardSimple, Sparkle } from '@phosphor-icons/react';
import { Switch } from '@/components/ui/switch';
import { ToolCostBadge } from '@/components/common/ai-credits/ToolCostBadge';
import { ToolCostConfirmDialog } from '@/components/common/ai-credits/ToolCostConfirmDialog';
import { useToolCostPreview } from '@/components/common/ai-credits/useToolCostPreview';

const DEFAULT_METHOD = teachingMethod[0];
const DEFAULT_LANGUAGE = languageSupport[0];

// Confirm before spending when the estimate is high or the balance would go low.
const CONFIRM_COST_THRESHOLD = 20;

const methodShortLabel = (full: string): string => {
    const idx = full.indexOf('–');
    return idx > 0 ? full.slice(0, idx).trim() : full;
};

// `teachingMethod` / `languageSupport` (from '@/constants/dummy-data') are
// shared enum-like data values submitted to the backend as-is and consumed
// by several other ai-center tools — they are NOT translated here. Only the
// locally-rendered display label is translated, via a lookup keyed by the
// (English) constant value, falling back to the original text for any
// value the map doesn't recognize (e.g. a future addition to the shared
// constant).
const buildTeachingMethodLabels = (t: TFunction): Record<string, string> => ({
    'Concept-First': t('teachingMethodOptions.conceptFirst'),
    Storytelling: t('teachingMethodOptions.storytelling'),
    'Problem-Solution': t('teachingMethodOptions.problemSolution'),
    'Question-Led': t('teachingMethodOptions.questionLed'),
    'Step-by-Step Tutorial': t('teachingMethodOptions.stepByStepTutorial'),
    Gamified: t('teachingMethodOptions.gamified'),
    'Case-Based Learning': t('teachingMethodOptions.caseBasedLearning'),
});

const buildLanguageLabels = (t: TFunction): Record<string, string> => ({
    ENGLISH: t('languageOptions.english'),
    HINDI: t('languageOptions.hindi'),
});

const PlanLectureAI = () => {
    const { t } = useTranslation('aiCenterPlanLectureAI');
    const queryClient = useQueryClient();
    const { setLoader, setKey } = useAICenter();
    const [enableTasksDialog, setEnableTasksDialog] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
    const [readyTask, setReadyTask] = useState<AITaskIndividualListInterface | null>(null);
    const [openPreviewDialog, setOpenPreviewDialog] = useState(false);

    const teachingMethodLabels = useMemo(() => buildTeachingMethodLabels(t), [t]);
    const languageLabels = useMemo(() => buildLanguageLabels(t), [t]);
    const teachingMethodDisplayLabel = (full: string): string =>
        teachingMethodLabels[methodShortLabel(full)] ?? methodShortLabel(full);
    const languageDisplayLabel = (lang: string): string =>
        languageLabels[lang] ?? lang.charAt(0) + lang.slice(1).toLowerCase();

    const form = useForm<PlanLectureAIFormSchema>({
        resolver: zodResolver(planLectureFormSchema),
        defaultValues: {
            taskName: getRandomTaskName(),
            prompt: '',
            level: '',
            teachingMethod: DEFAULT_METHOD,
            language: DEFAULT_LANGUAGE,
            lectureDuration: { hrs: '0', min: '40' },
            isQuestionGenerated: false,
            isAssignmentHomeworkGenerated: false,
            preferredModel: undefined,
        },
    });

    const planLectureMutation = useMutation({
        mutationFn: async (data: PlanLectureAIFormSchema) => {
            setLoader(true);
            setKey('planLecture');
            return handleGetPlanLecture(
                data.taskName,
                data.prompt,
                data.level,
                data.teachingMethod,
                data.language,
                data.lectureDuration,
                data.isQuestionGenerated,
                data.isAssignmentHomeworkGenerated,
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

    // Live "≈ N credits" preview driven by the homework / question toggles.
    const watchQuestions = form.watch('isQuestionGenerated');
    const watchHomework = form.watch('isAssignmentHomeworkGenerated');
    const costPreview = useToolCostPreview('lecture', {
        generate_questions: watchQuestions,
        generate_homework: watchHomework,
    });
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [pendingValues, setPendingValues] = useState<PlanLectureAIFormSchema | null>(null);

    const runGenerate = (values: PlanLectureAIFormSchema) => {
        setErrorMessage(null);
        setReadyTask(null);
        setPendingTaskId(null);
        planLectureMutation.mutate({
            ...values,
            taskName: getRandomTaskName(),
        });
    };

    const onSubmit = (values: PlanLectureAIFormSchema) => {
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

    const { data: recentTasksData } = useQuery({
        ...handleQueryGetListIndividualTopics('LECTURE_PLANNER'),
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
    }, [recentTasksData, pendingTaskId, t]);

    const recentTasks = useMemo(() => {
        const list: AITaskIndividualListInterface[] = Array.isArray(recentTasksData)
            ? recentTasksData
            : [];
        return [...list]
            .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
            .slice(0, 3);
    }, [recentTasksData]);

    const isWorking =
        planLectureMutation.status === 'pending' ||
        (pendingTaskId !== null && readyTask === null);

    return (
        <div className="flex w-full flex-col gap-10 px-4 pb-12 sm:px-8">
            <header className="flex flex-col gap-1">
                <h1 className="text-2xl font-semibold text-gray-900 sm:text-3xl">
                    {t('header.title')}
                </h1>
                <p className="text-sm text-gray-500">{t('header.subtitle')}</p>
            </header>

            <FormProvider {...form}>
                <form
                    onSubmit={form.handleSubmit(onSubmit)}
                    className="flex flex-col gap-8"
                >
                    <Section
                        step={1}
                        title={t('steps.goal.title')}
                        hint={t('steps.goal.hint')}
                    >
                        <Controller
                            control={form.control}
                            name="prompt"
                            render={({ field, fieldState }) => (
                                <div className="flex flex-col gap-1">
                                    <textarea
                                        {...field}
                                        placeholder={t('steps.goal.placeholder')}
                                        rows={4}
                                        className="w-full resize-y rounded-xl border border-neutral-200 bg-white p-3 text-sm text-gray-900 placeholder:text-neutral-400 focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-100"
                                    />
                                    {fieldState.error && (
                                        <span className="text-xs text-red-600">
                                            {t('steps.goal.requiredError')}
                                        </span>
                                    )}
                                </div>
                            )}
                        />
                    </Section>

                    <Section
                        step={2}
                        title={t('steps.audience.title')}
                    >
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <Controller
                                control={form.control}
                                name="level"
                                render={({ field, fieldState }) => (
                                    <Field
                                        label={t('steps.audience.classLabel')}
                                        error={
                                            fieldState.error
                                                ? t('steps.audience.classRequiredError')
                                                : null
                                        }
                                    >
                                        <input
                                            {...field}
                                            placeholder={t('steps.audience.classPlaceholder')}
                                            className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-neutral-400 focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-100"
                                        />
                                    </Field>
                                )}
                            />
                            <Field label={t('steps.audience.durationLabel')}>
                                <div className="flex items-center gap-2">
                                    <Controller
                                        control={form.control}
                                        name="lectureDuration.hrs"
                                        render={({ field }) => (
                                            <input
                                                {...field}
                                                inputMode="numeric"
                                                onChange={(e) =>
                                                    field.onChange(
                                                        e.target.value.replace(/\D/g, '')
                                                    )
                                                }
                                                className="w-14 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-center text-sm focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-100"
                                                placeholder={t('steps.audience.hoursPlaceholder')}
                                            />
                                        )}
                                    />
                                    <span className="text-xs text-neutral-500">
                                        {t('steps.audience.hoursUnit')}
                                    </span>
                                    <Controller
                                        control={form.control}
                                        name="lectureDuration.min"
                                        render={({ field }) => (
                                            <input
                                                {...field}
                                                inputMode="numeric"
                                                onChange={(e) =>
                                                    field.onChange(
                                                        e.target.value.replace(/\D/g, '')
                                                    )
                                                }
                                                className="w-14 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-center text-sm focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-100"
                                                placeholder={t('steps.audience.minutesPlaceholder')}
                                            />
                                        )}
                                    />
                                    <span className="text-xs text-neutral-500">
                                        {t('steps.audience.minutesUnit')}
                                    </span>
                                </div>
                            </Field>
                        </div>
                    </Section>

                    <Section
                        step={3}
                        title={t('steps.refine.title')}
                        hint={t('steps.refine.hint')}
                    >
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <Controller
                                control={form.control}
                                name="teachingMethod"
                                render={({ field }) => (
                                    <Field label={t('steps.refine.teachingStyleLabel')}>
                                        <select
                                            {...field}
                                            className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-100"
                                        >
                                            {teachingMethod.map((method) => (
                                                <option key={method} value={method}>
                                                    {teachingMethodDisplayLabel(method)}
                                                </option>
                                            ))}
                                        </select>
                                    </Field>
                                )}
                            />
                            <Controller
                                control={form.control}
                                name="language"
                                render={({ field }) => (
                                    <Field label={t('steps.refine.languageLabel')}>
                                        <select
                                            {...field}
                                            className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-100"
                                        >
                                            {languageSupport.map((lang) => (
                                                <option key={lang} value={lang}>
                                                    {languageDisplayLabel(lang)}
                                                </option>
                                            ))}
                                        </select>
                                    </Field>
                                )}
                            />
                        </div>
                        <div className="flex flex-col gap-3">
                            <Controller
                                control={form.control}
                                name="isQuestionGenerated"
                                render={({ field }) => (
                                    <ToggleRow
                                        label={t('steps.refine.questionsToggleLabel')}
                                        description={t('steps.refine.questionsToggleDescription')}
                                        checked={field.value}
                                        onCheckedChange={field.onChange}
                                    />
                                )}
                            />
                            <Controller
                                control={form.control}
                                name="isAssignmentHomeworkGenerated"
                                render={({ field }) => (
                                    <ToggleRow
                                        label={t('steps.refine.homeworkToggleLabel')}
                                        description={t('steps.refine.homeworkToggleDescription')}
                                        checked={field.value}
                                        onCheckedChange={field.onChange}
                                    />
                                )}
                            />
                        </div>
                    </Section>

                    {errorMessage && (
                        <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">
                            {errorMessage}
                        </div>
                    )}

                    {readyTask ? (
                        <DraftingDonePanel
                            readyTask={readyTask}
                            openPreview={openPreviewDialog}
                            setOpenPreview={setOpenPreviewDialog}
                            heading={t('productName')}
                            title={t('draftingDone.title')}
                            subtitle={t('draftingDone.subtitle')}
                            onDraftAnother={() => {
                                setReadyTask(null);
                                setPendingTaskId(null);
                                setErrorMessage(null);
                                form.reset({
                                    taskName: getRandomTaskName(),
                                    prompt: '',
                                    level: '',
                                    teachingMethod: DEFAULT_METHOD,
                                    language: DEFAULT_LANGUAGE,
                                    lectureDuration: { hrs: '0', min: '40' },
                                    isQuestionGenerated: false,
                                    isAssignmentHomeworkGenerated: false,
                                    preferredModel: undefined,
                                });
                            }}
                        />
                    ) : isWorking ? (
                        <GeneratingState
                            title={t('generating.title')}
                            subtitle={t('generating.subtitle')}
                        />
                    ) : (
                        <div className="flex flex-wrap items-center gap-3">
                            <button
                                type="submit"
                                className="inline-flex w-fit items-center gap-2 rounded-xl bg-primary-500 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-600"
                            >
                                {t('actions.draftMyPlan')}
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
            </FormProvider>

            <ToolCostConfirmDialog
                open={confirmOpen}
                onOpenChange={setConfirmOpen}
                credits={costPreview.credits}
                currentBalance={costPreview.currentBalance}
                balanceAfter={costPreview.balanceAfter}
                sufficient={costPreview.sufficient}
                coverage={costPreview.coverage}
                confirmLabel={t('actions.draftMyPlan')}
                onConfirm={() => {
                    if (pendingValues) runGenerate(pendingValues);
                }}
            />

            <RecentFilesPanel
                tasks={recentTasks}
                title={t('recentFiles.title')}
                fallbackLabel={t('recentFiles.fallbackLabel')}
                emptyHint={t('recentFiles.emptyHint')}
                onOpenAll={() => setEnableTasksDialog(true)}
                overrideIcon={
                    <ChalkboardSimple size={18} weight="fill" className="text-primary-500" />
                }
            />

            <AITasksList
                heading={t('productName')}
                enableDialog={enableTasksDialog}
                setEnableDialog={setEnableTasksDialog}
            />
        </div>
    );
};

const Section = ({
    step,
    title,
    hint,
    children,
}: {
    step: number;
    title: string;
    hint?: string;
    children: React.ReactNode;
}) => (
    <section className="flex flex-col gap-3">
        <div className="flex items-baseline gap-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-50 text-xs font-semibold text-primary-600">
                {step}
            </span>
            <div className="flex flex-col gap-0.5">
                <h2 className="text-base font-semibold text-gray-900">{title}</h2>
                {hint && <p className="text-xs text-neutral-500">{hint}</p>}
            </div>
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

const ToggleRow = ({
    label,
    description,
    checked,
    onCheckedChange,
}: {
    label: string;
    description: string;
    checked: boolean;
    onCheckedChange: (v: boolean) => void;
}) => (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-neutral-200 bg-white p-4">
        <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-gray-900">{label}</span>
            <span className="text-xs text-neutral-500">{description}</span>
        </div>
        <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
);

export default PlanLectureAI;
