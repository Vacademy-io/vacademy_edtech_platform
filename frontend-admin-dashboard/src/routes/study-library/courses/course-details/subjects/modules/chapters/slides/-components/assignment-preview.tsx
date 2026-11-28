import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Slide } from '../-hooks/use-slides';
import { useContentStore } from '../-stores/chapter-sidebar-store';
import {
    ALL_FILES_VALUE,
    ALLOWED_FILE_TYPE_OPTIONS,
    assignmentFormSchema,
    AssignmentFormType,
} from '../-form-schemas/assignmentFormSchema';
import { Checkbox } from '@/components/ui/checkbox';
import { FormProvider, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { FormControl, FormField, FormItem } from '@/components/ui/form';
import { MyInput } from '@/components/design-system/input';
import { RichTextEditor } from '@/components/editor/RichTextEditor';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import useDialogStore from '@/routes/assessment/question-papers/-global-states/question-paper-dialogue-close';
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { MyButton } from '@/components/design-system/button';
import { X, Copy, Check } from '@phosphor-icons/react';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { BASE_URL_LEARNER_DASHBOARD } from '@/constants/urls';
import { toast } from 'sonner';
import { QuestionPaperUpload } from '@/routes/assessment/question-papers/-components/QuestionPaperUpload';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { QuestionPapersTabs } from '@/routes/assessment/question-papers/-components/QuestionPapersTabs';
import { Badge } from '@/components/ui/badge';
// import { ReverseProgressBar } from '@/components/ui/progress';
import { RichContentRenderer } from '@/routes/assessment/assessment-list/offline-entry/$assessmentId/-components/RichContentRenderer';
import { useQuery } from '@tanstack/react-query';
import { getSlideActivityStats } from '@/services/study-library/slide-operations/slide-activity-stats';
import type { TFunction } from 'i18next';

const buildQuestionTypeLabels = (t: TFunction): Record<string, string> => ({
    MCQS: t('questionTypes.mcqs'),
    MCQM: t('questionTypes.mcqm'),
    TRUE_FALSE: t('questionTypes.trueFalse'),
    ONE_WORD: t('questionTypes.oneWord'),
    LONG_ANSWER: t('questionTypes.longAnswer'),
    NUMERIC: t('questionTypes.numeric'),
    CMCQS: t('questionTypes.cmcqs'),
    CMCQM: t('questionTypes.cmcqm'),
});

const ShareAssignmentLink = ({ slideId }: { slideId: string }) => {
    const { t } = useTranslation('studyLibraryAssignmentPreview');
    const { instituteDetails } = useInstituteDetailsStore();
    const [copied, setCopied] = useState(false);
    const learnerBaseUrl = instituteDetails?.learner_portal_base_url || BASE_URL_LEARNER_DASHBOARD;
    const withProtocol = learnerBaseUrl.startsWith('http') ? learnerBaseUrl : `https://${learnerBaseUrl}`;
    const normalizedBase = withProtocol.replace(/\/+$/, '');
    const assignmentLink = `${normalizedBase}/assignment/${slideId}`;

    const handleCopy = () => {
        navigator.clipboard
            .writeText(assignmentLink)
            .then(() => {
                setCopied(true);
                toast.success(t('toasts.linkCopied'));
                setTimeout(() => setCopied(false), 2000);
            })
            .catch(() => toast.error(t('toasts.copyFailed')));
    };

    return (
        <div className="flex flex-col gap-2">
            <h1 className="font-semibold">{t('shareAssignment.heading')}</h1>
            <div className="flex items-center gap-3">
                <span className="max-w-sm truncate rounded-md border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-sm text-neutral-600">
                    {assignmentLink}
                </span>
                <MyButton
                    type="button"
                    scale="small"
                    buttonType="secondary"
                    layoutVariant="icon"
                    onClick={handleCopy}
                    title={t('shareAssignment.copyLinkTitle')}
                >
                    {copied ? <Check size={16} className="text-green-500" /> : <Copy size={16} />}
                </MyButton>
            </div>
        </div>
    );
};

const StudyLibraryAssignmentPreview = ({ activeItem }: { activeItem: Slide }) => {
    const { t } = useTranslation('studyLibraryAssignmentPreview');
    const questionTypeLabels = buildQuestionTypeLabels(t);
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const { setItems, setActiveItem, items } = useContentStore();
    const {
        isManualQuestionPaperDialogOpen,
        isUploadFromDeviceDialogOpen,
        setIsManualQuestionPaperDialogOpen,
        setIsUploadFromDeviceDialogOpen,
        isSavedQuestionPaperDialogOpen,
        setIsSavedQuestionPaperDialogOpen,
    } = useDialogStore();

    const defaultValues = activeItem.assignment_slide;
    const form = useForm<AssignmentFormType>({
        resolver: zodResolver(assignmentFormSchema),
        defaultValues: defaultValues || {},
    });

    const adaptive_marking_for_each_question = form.getValues('adaptive_marking_for_each_question');
    const { watch } = form;

    // Fetch live participant stats from activity API
    const { data: activityStats } = useQuery({
        ...getSlideActivityStats({
            slideId: activeItem.id,
            page: 0,
            size: 1,
        }),
        enabled: !!activeItem.id,
    });

    const totalParticipants = activityStats?.totalElements ?? 0;

    useEffect(() => {
        const subscription = watch(() => {
            setActiveItem({
                ...activeItem,
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-expect-error
                assignment_slide: form.getValues(),
            });
        });

        return () => subscription.unsubscribe(); // cleanup
    }, [watch, items, activeItem, form, setItems]);

    return (
        <div key={`assignment-${activeItem.id}`} className="flex size-full flex-col gap-8">
            <FormProvider {...form}>
                {/* Task Description */}
                <div className="flex flex-col gap-6">
                    <h1 className="-mb-5">{t('taskDescription.heading')}</h1>
                    <FormField
                        control={form.control}
                        name="taskDescription"
                        render={({ field }) => (
                            <FormItem>
                                <FormControl>
                                    <RichTextEditor
                                        onChange={field.onChange}
                                        onBlur={field.onBlur}
                                        value={field.value}
                                    />
                                </FormControl>
                            </FormItem>
                        )}
                    />
                </div>

                {/* Live Date Range */}
                <div>
                    <div className="mb-3 flex items-center gap-3">
                        <h1 className="font-semibold">{t('liveDateRange.heading')}</h1>
                        <FormField
                            control={form.control}
                            name="hasDateRange"
                            render={({ field }) => (
                                <FormItem>
                                    <FormControl>
                                        <Switch
                                            checked={field.value ?? false}
                                            onCheckedChange={(checked) => {
                                                field.onChange(checked);
                                                if (!checked) {
                                                    form.setValue('startDate', '');
                                                    form.setValue('endDate', '');
                                                }
                                            }}
                                        />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                    </div>
                    {form.watch('hasDateRange') && (
                        <>
                            <p className="text-caption text-neutral-500">
                                {t('liveDateRange.description')}
                            </p>
                            <div className="flex items-center gap-6">
                            <FormField
                                control={form.control}
                                name="startDate"
                                render={({ field: { ...field } }) => (
                                    <FormItem>
                                        <FormControl>
                                            <MyInput
                                                inputType="datetime-local"
                                                input={field.value}
                                                onChangeFunction={field.onChange}
                                                required
                                                size="large"
                                                label={t('liveDateRange.startDateLabel')}
                                                labelStyle="font-normal"
                                                {...field}
                                                className="w-full"
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="endDate"
                                render={({ field: { ...field } }) => (
                                    <FormItem>
                                        <FormControl>
                                            <MyInput
                                                inputType="datetime-local"
                                                input={field.value}
                                                onChangeFunction={field.onChange}
                                                required
                                                size="large"
                                                label={t('liveDateRange.endDateLabel')}
                                                labelStyle="font-normal"
                                                {...field}
                                                className="w-full"
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                            </div>
                        </>
                    )}
                </div>

                {/* Reattempt Count */}
                <FormField
                    control={form.control}
                    name="reattemptCount"
                    render={({ field: { onChange, value, ...field } }) => (
                        <FormItem>
                            <FormControl>
                                <MyInput
                                    inputType="number"
                                    label={t('reattemptCount.label')}
                                    inputPlaceholder={t('reattemptCount.label')}
                                    input={value}
                                    onChangeFunction={onChange}
                                    required={false}
                                    size="large"
                                    className="w-96"
                                    {...field}
                                    min={0}
                                    onKeyDown={(e) => {
                                        if (['e', 'E', '-', '+'].includes(e.key)) {
                                            e.preventDefault();
                                        }
                                    }}
                                    onWheel={(e) => e.currentTarget.blur()}
                                />
                            </FormControl>
                        </FormItem>
                    )}
                />

                {/* Allowed Submission File Types */}
                <FormField
                    control={form.control}
                    name="allowedFileTypes"
                    render={({ field }) => {
                        const selected: string[] = field.value ?? [];
                        const toggle = (value: string, checked: boolean) => {
                            if (value === ALL_FILES_VALUE) {
                                field.onChange(checked ? [ALL_FILES_VALUE] : []);
                                return;
                            }
                            const withoutAll = selected.filter((v) => v !== ALL_FILES_VALUE);
                            const next = checked
                                ? Array.from(new Set([...withoutAll, value]))
                                : withoutAll.filter((v) => v !== value);
                            field.onChange(next);
                        };
                        return (
                            <FormItem>
                                <div className="flex flex-col gap-3">
                                    <div>
                                        <h1 className="font-semibold">{t('allowedFileTypes.heading')}</h1>
                                        <p className="text-sm text-neutral-500">
                                            {t('allowedFileTypes.description')}
                                        </p>
                                    </div>
                                    <FormControl>
                                        <div className="flex flex-wrap gap-4">
                                            {ALLOWED_FILE_TYPE_OPTIONS.map((opt) => {
                                                const checked = selected.includes(opt.value);
                                                const disabledByAll =
                                                    opt.value !== ALL_FILES_VALUE &&
                                                    selected.includes(ALL_FILES_VALUE);
                                                return (
                                                    <label
                                                        key={opt.value}
                                                        className="flex cursor-pointer items-center gap-2 rounded-md border border-neutral-200 px-3 py-2 text-sm hover:bg-neutral-50"
                                                    >
                                                        <Checkbox
                                                            checked={checked}
                                                            disabled={disabledByAll}
                                                            onCheckedChange={(c) =>
                                                                toggle(opt.value, c === true)
                                                            }
                                                        />
                                                        <span>{opt.label}</span>
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    </FormControl>
                                </div>
                            </FormItem>
                        );
                    }}
                />

                {/* Marks Configuration */}
                <div>
                    <h1 className="mb-3 font-semibold">{t('marks.heading')}</h1>
                    <div className="flex items-center gap-6">
                        <FormField
                            control={form.control}
                            name="totalMarks"
                            render={({ field: { onChange, value, ...field } }) => (
                                <FormItem>
                                    <FormControl>
                                        <MyInput
                                            inputType="number"
                                            label={t('marks.totalMarksLabel')}
                                            inputPlaceholder={t('marks.totalMarksPlaceholder')}
                                            input={value?.toString() ?? ''}
                                            onChangeFunction={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
                                            required={false}
                                            size="large"
                                            className="w-48"
                                            {...field}
                                            min={0}
                                            onKeyDown={(e) => {
                                                if (['e', 'E', '-', '+'].includes(e.key)) {
                                                    e.preventDefault();
                                                }
                                            }}
                                            onWheel={(e) => e.currentTarget.blur()}
                                        />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="passingMarks"
                            render={({ field: { onChange, value, ...field } }) => (
                                <FormItem>
                                    <FormControl>
                                        <MyInput
                                            inputType="number"
                                            label={t('marks.passingMarksLabel')}
                                            inputPlaceholder={t('marks.passingMarksPlaceholder')}
                                            input={value?.toString() ?? ''}
                                            onChangeFunction={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
                                            required={false}
                                            size="large"
                                            className="w-48"
                                            {...field}
                                            min={0}
                                            onKeyDown={(e) => {
                                                if (['e', 'E', '-', '+'].includes(e.key)) {
                                                    e.preventDefault();
                                                }
                                            }}
                                            onWheel={(e) => e.currentTarget.blur()}
                                        />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                    </div>
                </div>

                {/* Share Assignment Link */}
                <ShareAssignmentLink slideId={activeItem.id} />

                {/* Upload Question Paper */}
                <div className="flex flex-wrap items-center justify-start gap-5">
                    <h3>{t('uploadQuestionPaper.heading')}</h3>
                    <AlertDialog
                        open={isUploadFromDeviceDialogOpen}
                        onOpenChange={setIsUploadFromDeviceDialogOpen}
                    >
                        <AlertDialogTrigger>
                            <MyButton
                                type="button"
                                scale="large"
                                buttonType="secondary"
                                className="font-thin"
                            >
                                {t('uploadQuestionPaper.uploadFromDevice')}
                            </MyButton>
                        </AlertDialogTrigger>
                        <AlertDialogContent className="p-0">
                            <div className="flex items-center justify-between rounded-md bg-primary-50">
                                <h1 className="rounded-sm p-4 font-bold text-primary-500">
                                    {t('uploadQuestionPaper.uploadFromDeviceDialogTitle')}
                                </h1>
                                <AlertDialogCancel
                                    className="border-none bg-primary-50 shadow-none hover:bg-primary-50"
                                    onClick={() => setIsUploadFromDeviceDialogOpen(false)}
                                >
                                    <X className="text-neutral-600" />
                                </AlertDialogCancel>
                            </div>
                            <QuestionPaperUpload
                                isManualCreated={false}
                                studyLibraryAssignmentForm={form}
                                isStudyLibraryAssignment={true}
                                currentQuestionIndex={currentQuestionIndex}
                                setCurrentQuestionIndex={setCurrentQuestionIndex}
                            />
                        </AlertDialogContent>
                    </AlertDialog>
                    <AlertDialog
                        open={isManualQuestionPaperDialogOpen}
                        onOpenChange={setIsManualQuestionPaperDialogOpen}
                    >
                        <AlertDialogTrigger>
                            <MyButton
                                type="button"
                                scale="large"
                                buttonType="secondary"
                                className="font-thin"
                            >
                                {t('uploadQuestionPaper.createManually')}
                            </MyButton>
                        </AlertDialogTrigger>
                        <AlertDialogContent className="p-0">
                            <div className="flex items-center justify-between rounded-md bg-primary-50">
                                <h1 className="rounded-sm p-4 font-bold text-primary-500">
                                    {t('uploadQuestionPaper.createManuallyDialogTitle')}
                                </h1>
                                <AlertDialogCancel
                                    className="border-none bg-primary-50 shadow-none hover:bg-primary-50"
                                    onClick={() => setIsManualQuestionPaperDialogOpen(false)}
                                >
                                    <X className="text-neutral-600" />
                                </AlertDialogCancel>
                            </div>
                            <QuestionPaperUpload
                                isManualCreated={true}
                                studyLibraryAssignmentForm={form}
                                isStudyLibraryAssignment={true}
                                currentQuestionIndex={currentQuestionIndex}
                                setCurrentQuestionIndex={setCurrentQuestionIndex}
                            />
                        </AlertDialogContent>
                    </AlertDialog>
                    <Dialog
                        open={isSavedQuestionPaperDialogOpen}
                        onOpenChange={setIsSavedQuestionPaperDialogOpen}
                    >
                        <DialogTrigger>
                            <MyButton
                                type="button"
                                scale="large"
                                buttonType="secondary"
                                className="font-thin"
                            >
                                {t('uploadQuestionPaper.chooseSavedPaper')}
                            </MyButton>
                        </DialogTrigger>
                        <DialogContent className="no-scrollbar !m-0 flex h-[90vh] !w-full !max-w-[90vw] flex-col items-start !gap-0 overflow-y-auto !p-0 [&>button]:hidden">{/* design-lint-ignore: vh/vw-based dialog height matches MyDialog primitive */}
                            <div className="flex h-14 w-full items-center justify-between rounded-md bg-primary-50">
                                <h1 className="rounded-sm p-4 font-bold text-primary-500">
                                    {t('uploadQuestionPaper.chooseSavedPaperDialogTitle')}
                                </h1>
                                <DialogClose
                                    className="mr-4 !border-none bg-primary-50 shadow-none hover:bg-primary-50"
                                    onClick={() => setIsSavedQuestionPaperDialogOpen(false)}
                                >
                                    <X className="text-neutral-600" />
                                </DialogClose>
                            </div>
                            <div className="h-full w-screen overflow-y-auto p-8">
                                <QuestionPapersTabs
                                    isAssessment={true}
                                    studyLibraryAssignmentForm={form}
                                    isStudyLibraryAssignment={true}
                                    currentQuestionIndex={currentQuestionIndex}
                                    setCurrentQuestionIndex={setCurrentQuestionIndex}
                                />
                            </div>
                        </DialogContent>
                    </Dialog>
                </div>

                {/* Questions List */}
                {Boolean(adaptive_marking_for_each_question?.length) && (
                    <div className="flex flex-col gap-4">
                        <div className="flex items-center justify-between">
                            <h1 className="font-semibold text-primary-500">
                                {t('questionsList.heading', {
                                    count: adaptive_marking_for_each_question.length,
                                })}
                            </h1>
                        </div>
                        <div className="flex flex-col gap-4">
                            {adaptive_marking_for_each_question.map((question, idx) => (
                                <div
                                    key={idx}
                                    className="rounded-lg border border-neutral-200 bg-white shadow-sm"
                                >
                                    {/* Question header */}
                                    <div className="flex items-start justify-between gap-3 border-b border-neutral-100 px-4 py-3">
                                        <div className="flex gap-3">
                                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-100 text-sm font-semibold text-primary-600">
                                                {idx + 1}
                                            </span>
                                            <RichContentRenderer
                                                html={question.questionName || ''}
                                                className="whitespace-pre-line pt-0.5 text-sm leading-relaxed text-neutral-800"
                                            />
                                        </div>
                                        {question.questionType && (
                                            <Badge
                                                variant="outline"
                                                className="shrink-0 border-primary-200 bg-primary-50 text-xs text-primary-600"
                                            >
                                                {questionTypeLabels[question.questionType] ||
                                                    question.questionType}
                                            </Badge>
                                        )}
                                    </div>

                                    {/* Options */}
                                    {question.options && question.options.length > 0 && (
                                        <div className="grid grid-cols-1 gap-2 px-4 py-3 sm:grid-cols-2">
                                            {question.options.map((opt, optIdx) => (
                                                <div
                                                    key={opt.id || optIdx}
                                                    className="flex items-start gap-2 rounded-md border border-neutral-100 bg-neutral-50 px-3 py-2"
                                                >
                                                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-xs font-medium text-neutral-600">
                                                        {String.fromCharCode(65 + optIdx)}
                                                    </span>
                                                    <RichContentRenderer
                                                        html={opt.text.content || ''}
                                                        className="text-sm text-neutral-700"
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <Separator />

                {/* Responses */}
                <div className="flex flex-col gap-4">
                    <h1 className="font-semibold">{t('responses.heading')}</h1>
                    <div className="flex flex-col gap-2 text-sm">
                        <span>{t('responses.totalParticipants', { count: totalParticipants })}</span>
                    </div>
                </div>
            </FormProvider>
        </div>
    );
};

export default StudyLibraryAssignmentPreview;
