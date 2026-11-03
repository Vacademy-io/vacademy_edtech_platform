import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useForm, useWatch, type UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
    ChalkboardTeacher,
    Coins,
    FilePdf,
    Sparkle,
    Spinner,
    UploadSimple,
    WarningCircle,
    X,
} from '@phosphor-icons/react';

import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { FileUploadComponent } from '@/components/design-system/file-upload';
import { Form, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { RichTextEditor } from '@/components/editor/RichTextEditor';
import BatchMultiSelect from '@/routes/study-library/reports/-components/batchMultiSelect';
import { getInstituteId } from '@/constants/helper';
import { TokenKey } from '@/constants/auth/tokens';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { UploadFileInS3, getPublicUrl } from '@/services/upload_file';
import {
    estimatePaperDigitise,
    paperDigitiseErrorMessage,
    type PaperDigitiseEstimate,
} from '@/services/paper-digitise';
import { usePaperDigitise } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-hooks/use-paper-digitise';
import { cn } from '@/lib/utils';
import {
    OFFLINE_EXAM_TYPE,
    createOfflineTest,
    offlineTestSubmissionsPath,
    type UploadedPdf,
} from '../../-utils/offline-test';

/** The server reads PDFs of up to 25 MB; refuse bigger ones before uploading them. */
const MAX_PDF_MB = 25;

const pdfSchema = z.object({ url: z.string().min(1), name: z.string() }).nullable();

const buildSchema = (t: TFunction) =>
    z
        .object({
            name: z.string().trim().min(1, t('errors.nameRequired')),
            startDate: z.string().min(1, t('errors.startRequired')),
            endDate: z.string().min(1, t('errors.endRequired')),
            duration: z.coerce.number().int().min(1, t('errors.durationMin')),
            totalMarks: z.coerce.number().min(1, t('errors.marksMin')),
            batchIds: z.array(z.string()).min(1, t('errors.batchRequired')),
            description: z.string(),
            paper: pdfSchema.refine((value) => value !== null, t('errors.paperRequired')),
            checkMode: z.enum(['AI', 'TEACHER']),
            answerKey: pdfSchema,
            keyHasScheme: z.boolean(),
            markingScheme: pdfSchema,
        })
        .refine((v) => !v.startDate || !v.endDate || new Date(v.endDate) > new Date(v.startDate), {
            path: ['endDate'],
            message: t('errors.endAfterStart'),
        });

type FormValues = z.infer<ReturnType<typeof buildSchema>>;
type PdfField = 'paper' | 'answerKey' | 'markingScheme';

/** Upload a PDF where learners and the paper reader can both fetch it. */
const uploadPublicPdf = async (file: File): Promise<UploadedPdf | null> => {
    const data = getTokenDecodedData(getTokenFromCookie(TokenKey.accessToken));
    const userId =
        (data as unknown as { userId?: string; sub?: string } | null)?.userId ||
        data?.sub ||
        'your-user-id';
    const fileId = await UploadFileInS3(file, () => {}, userId, getInstituteId(), 'STUDENTS', true);
    if (!fileId) return null;
    const url = await getPublicUrl(fileId);
    return url ? { url, name: file.name } : null;
};

const isPdf = (file: File) =>
    file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

/** One PDF slot: drop / pick a file, see its name, remove it. */
const PdfSlot = ({
    form,
    name,
    label,
    hint,
    required = false,
}: {
    form: UseFormReturn<FormValues>;
    name: PdfField;
    label: string;
    hint: string;
    required?: boolean;
}) => {
    const { t } = useTranslation('assessmentOfflineQuickCreate');
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const value = useWatch({ control: form.control, name });

    const onFile = async (file: File) => {
        setError(null);
        if (!isPdf(file)) {
            setError(t('errors.notPdf'));
            return;
        }
        if (file.size > MAX_PDF_MB * 1024 * 1024) {
            setError(t('errors.tooBig', { mb: MAX_PDF_MB }));
            return;
        }
        setUploading(true);
        try {
            const uploaded = await uploadPublicPdf(file);
            if (!uploaded) throw new Error('upload');
            form.setValue(name, uploaded, { shouldValidate: true, shouldDirty: true });
        } catch {
            setError(t('errors.uploadFailed'));
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className="flex flex-col gap-1.5">
            <span className="text-body font-medium text-neutral-700">
                {label}
                {required && <span className="ms-1 text-danger-600">*</span>}
            </span>
            {value ? (
                <div className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2">
                    <FilePdf className="size-5 shrink-0 text-danger-500" weight="fill" />
                    <a
                        href={value.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-w-0 flex-1 truncate text-body text-neutral-800 hover:underline"
                    >
                        {value.name}
                    </a>
                    <MyButton
                        type="button"
                        buttonType="text"
                        scale="small"
                        layoutVariant="icon"
                        aria-label={t('slot.remove')}
                        onClick={() => form.setValue(name, null, { shouldValidate: true })}
                    >
                        <X className="size-4" />
                    </MyButton>
                </div>
            ) : (
                <FileUploadComponent
                    fileInputRef={inputRef}
                    onFileSubmit={(file) => void onFile(file)}
                    control={form.control}
                    name={name}
                    acceptedFileTypes="application/pdf"
                    isUploading={uploading}
                    className="rounded-lg border border-dashed border-neutral-300 px-4 py-3 hover:border-primary-400"
                >
                    <div className="flex items-center gap-3 text-neutral-600">
                        {uploading ? (
                            <Spinner className="size-5 animate-spin text-primary-500" />
                        ) : (
                            <UploadSimple className="size-5 text-primary-500" />
                        )}
                        <span className="text-body">
                            {uploading ? t('slot.uploading') : t('slot.choose')}
                        </span>
                    </div>
                </FileUploadComponent>
            )}
            {error ? (
                <span className="text-caption text-danger-600">{error}</span>
            ) : (
                <span className="text-caption text-neutral-500">{hint}</span>
            )}
            <FormField
                control={form.control}
                name={name}
                render={() => (
                    <FormItem>
                        <FormMessage />
                    </FormItem>
                )}
            />
        </div>
    );
};

type EstimateState =
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'ready'; data: PaperDigitiseEstimate }
    | { status: 'error'; message: string };

/**
 * Written-paper test in one screen: title, live window, duration, batches,
 * instructions, the question paper (+ answer key / marking scheme for the AI),
 * and who checks the copies. Creates and publishes the test, then — when the AI
 * checks — reads the paper in the background; the teacher reviews the questions
 * on the test's Submissions tab, where AI checking is switched on.
 */
export const QuickOfflineTestDialog = ({
    open,
    onOpenChange,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) => {
    const { t } = useTranslation('assessmentOfflineQuickCreate');
    const { t: tSlide } = useTranslation('studyLibraryAssessmentCreateForm');
    const navigate = useNavigate();
    const { starting, start: startRead } = usePaperDigitise();
    const [creating, setCreating] = useState(false);

    const form = useForm<FormValues>({
        resolver: zodResolver(buildSchema(t)),
        defaultValues: {
            name: '',
            startDate: '',
            endDate: '',
            duration: 30,
            totalMarks: 100,
            batchIds: [],
            description: '',
            paper: null,
            checkMode: 'AI',
            answerKey: null,
            keyHasScheme: false,
            markingScheme: null,
        },
        mode: 'onSubmit',
        reValidateMode: 'onChange',
    });

    const [paper, answerKey, markingScheme, keyHasScheme, checkMode] = useWatch({
        control: form.control,
        name: ['paper', 'answerKey', 'markingScheme', 'keyHasScheme', 'checkMode'],
    });
    const aiCheck = checkMode === 'AI';
    const answerKeyUrl = answerKey?.url ?? null;
    const markingSchemeUrl = keyHasScheme ? answerKeyUrl : markingScheme?.url ?? null;

    // Price the read as soon as there is something to price; a read that cannot
    // happen (bad PDF, AI service down) leaves the teacher-checked path open.
    const [estimate, setEstimate] = useState<EstimateState>({ status: 'idle' });
    useEffect(() => {
        if (!aiCheck || !paper?.url) {
            setEstimate({ status: 'idle' });
            return;
        }
        let cancelled = false;
        setEstimate({ status: 'loading' });
        const handle = setTimeout(() => {
            estimatePaperDigitise(paper.url, { answerKeyUrl, markingSchemeUrl })
                .then((data) => {
                    if (!cancelled) setEstimate({ status: 'ready', data });
                })
                .catch((error: unknown) => {
                    if (!cancelled)
                        setEstimate({
                            status: 'error',
                            message: paperDigitiseErrorMessage(error, t('ai.estimateFailed')),
                        });
                });
        }, 400);
        return () => {
            cancelled = true;
            clearTimeout(handle);
        };
    }, [aiCheck, paper?.url, answerKeyUrl, markingSchemeUrl, t]);

    const estimateData = estimate.status === 'ready' ? estimate.data : null;
    // Only these hold Create back while the AI is chosen: a price still loading, a
    // balance that cannot pay for the read, or a document the reader refused.
    const aiBlocked =
        aiCheck &&
        (estimate.status === 'loading' ||
            estimate.status === 'error' ||
            estimateData?.estimate.sufficient === false);

    const reset = () => {
        form.reset();
        setEstimate({ status: 'idle' });
    };

    const close = (next: boolean) => {
        if (creating || starting) return;
        if (!next) reset();
        onOpenChange(next);
    };

    const openFullSetup = () => {
        close(false);
        navigate({
            to: '/assessment/create-assessment/$assessmentId/$examtype',
            params: { assessmentId: 'defaultId', examtype: OFFLINE_EXAM_TYPE },
            search: { currentStep: 0 },
        });
    };

    const submit = async (values: FormValues) => {
        if (!values.paper || creating) return;
        if (values.checkMode === 'AI' && aiBlocked) return;
        setCreating(true);
        let assessmentId: string;
        try {
            assessmentId = await createOfflineTest(
                {
                    name: values.name,
                    descriptionHtml: values.description,
                    paper: values.paper,
                    noteHtml: tSlide('createLogic.noteHtml', { count: values.duration }),
                    startIso: new Date(values.startDate).toISOString(),
                    endIso: new Date(values.endDate).toISOString(),
                    durationMinutes: values.duration,
                    totalMarks: values.totalMarks,
                    batchIds: values.batchIds,
                },
                getInstituteId()
            );
        } catch (error) {
            console.error('Quick offline test: create failed', error);
            toast.error(t('toasts.createFailed'));
            setCreating(false);
            return;
        }

        const path = offlineTestSubmissionsPath(assessmentId);
        if (values.checkMode === 'AI') {
            const keyUrl = values.answerKey?.url ?? null;
            const started = await startRead({
                pdfUrl: values.paper.url,
                answerKeyUrl: keyUrl,
                markingSchemeUrl: values.keyHasScheme ? keyUrl : values.markingScheme?.url ?? null,
                expectedTotalMarks: values.totalMarks,
                title: values.name.trim(),
                assessmentId,
                name: values.name.trim(),
                returnPath: path,
            });
            if (started) {
                toast.success(
                    t('toasts.createdReading', { credits: started.estimate.estimated_credits }),
                    { duration: 10_000 }
                );
            } else {
                toast.warning(t('toasts.createdReadNotStarted'), { duration: 10_000 });
            }
        } else {
            toast.success(t('toasts.created'));
        }

        setCreating(false);
        reset();
        onOpenChange(false);
        navigate({
            to: '/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab',
            params: {
                assessmentId,
                examType: OFFLINE_EXAM_TYPE,
                assesssmentType: 'PRIVATE',
                assessmentTab: 'submissions',
            },
        });
    };

    const busy = creating || starting;
    const primaryLabel = busy
        ? t('actions.creating')
        : aiCheck
          ? estimateData
              ? t('actions.createAndRead', { credits: estimateData.estimate.estimated_credits })
              : t('actions.createAndReadNoEstimate')
          : t('actions.create');

    return (
        <MyDialog
            heading={t('heading')}
            open={open}
            onOpenChange={close}
            dialogWidth="max-w-3xl"
            footerLeft={
                <MyButton type="button" buttonType="text" scale="small" onClick={openFullSetup}>
                    {t('actions.fullSetup')}
                </MyButton>
            }
            footer={
                <>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        disable={busy}
                        onClick={() => close(false)}
                    >
                        {t('actions.cancel')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        disable={busy || aiBlocked}
                        onClick={() => void form.handleSubmit(submit)()}
                    >
                        {primaryLabel}
                    </MyButton>
                </>
            }
        >
            <Form {...form}>
                <form
                    className="flex flex-col gap-5"
                    onSubmit={(e) => {
                        e.preventDefault();
                        void form.handleSubmit(submit)();
                    }}
                >
                    <p className="text-body text-neutral-600">{t('intro')}</p>

                    <FormField
                        control={form.control}
                        name="name"
                        render={({ field, fieldState }) => (
                            <FormItem>
                                <MyInput
                                    inputType="text"
                                    label={t('fields.name')}
                                    required
                                    inputPlaceholder={t('fields.namePlaceholder')}
                                    input={field.value}
                                    onChangeFunction={(e) => field.onChange(e.target.value)}
                                    error={fieldState.error?.message}
                                    size="large"
                                    className="w-full sm:w-full"
                                />
                            </FormItem>
                        )}
                    />

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <FormField
                            control={form.control}
                            name="startDate"
                            render={({ field, fieldState }) => (
                                <FormItem>
                                    <MyInput
                                        inputType="datetime-local"
                                        label={t('fields.start')}
                                        required
                                        input={field.value}
                                        onChangeFunction={(e) => field.onChange(e.target.value)}
                                        error={fieldState.error?.message}
                                        size="large"
                                        className="w-full sm:w-full"
                                    />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="endDate"
                            render={({ field, fieldState }) => (
                                <FormItem>
                                    <MyInput
                                        inputType="datetime-local"
                                        label={t('fields.end')}
                                        required
                                        input={field.value}
                                        onChangeFunction={(e) => field.onChange(e.target.value)}
                                        error={fieldState.error?.message}
                                        size="large"
                                        className="w-full sm:w-full"
                                    />
                                </FormItem>
                            )}
                        />
                    </div>
                    <p className="-mt-3 text-caption text-neutral-500">{t('fields.liveHint')}</p>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <FormField
                            control={form.control}
                            name="duration"
                            render={({ field, fieldState }) => (
                                <FormItem>
                                    <MyInput
                                        inputType="number"
                                        label={t('fields.duration')}
                                        required
                                        input={String(field.value ?? '')}
                                        onChangeFunction={(e) => field.onChange(e.target.value)}
                                        error={fieldState.error?.message}
                                        size="large"
                                        className="w-full sm:w-full"
                                        min={1}
                                        onWheel={(e) => e.currentTarget.blur()}
                                    />
                                    <p className="text-caption text-neutral-500">
                                        {t('fields.durationHint')}
                                    </p>
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="totalMarks"
                            render={({ field, fieldState }) => (
                                <FormItem>
                                    <MyInput
                                        inputType="number"
                                        label={t('fields.totalMarks')}
                                        required
                                        input={String(field.value ?? '')}
                                        onChangeFunction={(e) => field.onChange(e.target.value)}
                                        error={fieldState.error?.message}
                                        size="large"
                                        className="w-full sm:w-full"
                                        min={1}
                                        onWheel={(e) => e.currentTarget.blur()}
                                    />
                                    <p className="text-caption text-neutral-500">
                                        {t('fields.totalMarksHint')}
                                    </p>
                                </FormItem>
                            )}
                        />
                    </div>

                    <FormField
                        control={form.control}
                        name="batchIds"
                        render={({ field, fieldState }) => (
                            <FormItem>
                                <BatchMultiSelect
                                    selected={field.value}
                                    onChange={field.onChange}
                                    error={fieldState.error?.message}
                                    hint={t('fields.batchHint')}
                                />
                            </FormItem>
                        )}
                    />

                    <FormField
                        control={form.control}
                        name="description"
                        render={({ field }) => (
                            <FormItem className="flex flex-col gap-1.5">
                                <span className="text-body font-medium text-neutral-700">
                                    {t('fields.instructions')}
                                </span>
                                <RichTextEditor
                                    value={field.value}
                                    onChange={field.onChange}
                                    placeholder={t('fields.instructionsPlaceholder')}
                                    minHeight={120}
                                />
                            </FormItem>
                        )}
                    />

                    <PdfSlot
                        form={form}
                        name="paper"
                        label={t('slot.paper')}
                        hint={t('slot.paperHint')}
                        required
                    />

                    {/* Who checks the answer sheets */}
                    <FormField
                        control={form.control}
                        name="checkMode"
                        render={({ field }) => (
                            <FormItem className="flex flex-col gap-2">
                                <span className="text-body font-medium text-neutral-700">
                                    {t('check.heading')}
                                </span>
                                <RadioGroup
                                    value={field.value}
                                    onValueChange={field.onChange}
                                    className="grid grid-cols-1 gap-3 sm:grid-cols-2"
                                >
                                    {(
                                        [
                                            { value: 'AI', Icon: Sparkle, key: 'ai' },
                                            {
                                                value: 'TEACHER',
                                                Icon: ChalkboardTeacher,
                                                key: 'teacher',
                                            },
                                        ] as const
                                    ).map(({ value, Icon, key }) => (
                                        <label
                                            key={value}
                                            className={cn(
                                                'flex cursor-pointer items-start gap-3 rounded-lg border p-3',
                                                field.value === value
                                                    ? 'border-primary-300 bg-primary-50'
                                                    : 'border-neutral-200 bg-white'
                                            )}
                                        >
                                            <RadioGroupItem value={value} className="mt-0.5" />
                                            <div className="flex flex-col gap-0.5">
                                                <span className="flex items-center gap-1.5 text-body font-semibold text-neutral-800">
                                                    <Icon className="size-4 text-primary-500" />
                                                    {t(`check.${key}.title`)}
                                                </span>
                                                <span className="text-caption text-neutral-500">
                                                    {t(`check.${key}.description`)}
                                                </span>
                                            </div>
                                        </label>
                                    ))}
                                </RadioGroup>
                            </FormItem>
                        )}
                    />

                    {aiCheck && (
                        <div className="flex flex-col gap-4 rounded-lg border border-primary-200 bg-primary-50/40 p-4">
                            <PdfSlot
                                form={form}
                                name="answerKey"
                                label={t('slot.answerKey')}
                                hint={t('slot.answerKeyHint')}
                            />
                            {answerKey && (
                                <FormField
                                    control={form.control}
                                    name="keyHasScheme"
                                    render={({ field }) => (
                                        <FormItem className="-mt-2 flex items-center gap-2 space-y-0">
                                            <Checkbox
                                                id="offline-key-has-scheme"
                                                checked={field.value}
                                                onCheckedChange={(checked) =>
                                                    field.onChange(checked === true)
                                                }
                                            />
                                            <label
                                                htmlFor="offline-key-has-scheme"
                                                className="cursor-pointer text-body text-neutral-700"
                                            >
                                                {t('slot.keyHasScheme')}
                                            </label>
                                        </FormItem>
                                    )}
                                />
                            )}
                            {!(answerKey && keyHasScheme) && (
                                <PdfSlot
                                    form={form}
                                    name="markingScheme"
                                    label={t('slot.markingScheme')}
                                    hint={t('slot.markingSchemeHint')}
                                />
                            )}
                            <p className="text-caption text-neutral-600">{t('ai.privateNote')}</p>

                            {!paper && (
                                <p className="flex items-center gap-2 text-caption text-neutral-600">
                                    <FilePdf className="size-4 shrink-0 text-neutral-400" />
                                    {t('ai.uploadPaperFirst')}
                                </p>
                            )}
                            {estimate.status === 'loading' && (
                                <p className="flex items-center gap-2 text-caption text-neutral-500">
                                    <Spinner className="size-4 animate-spin" />
                                    {t('ai.estimating')}
                                </p>
                            )}
                            {estimate.status === 'error' && (
                                <p className="flex items-start gap-2 text-caption text-danger-600">
                                    <WarningCircle className="mt-0.5 size-4 shrink-0" />
                                    {t('ai.cannotRead', { reason: estimate.message })}
                                </p>
                            )}
                            {estimateData && (
                                <div className="flex flex-col gap-1 text-caption text-neutral-700">
                                    <p className="flex flex-wrap items-center gap-2 font-medium">
                                        <Coins className="size-4 text-primary-500" weight="bold" />
                                        {t('ai.estimateLine', {
                                            credits: estimateData.estimate.estimated_credits,
                                            count: estimateData.pages,
                                        })}
                                        {estimateData.estimate.current_balance != null && (
                                            <span className="font-normal text-neutral-500">
                                                ·{' '}
                                                {t('ai.balance', {
                                                    balance: estimateData.estimate.current_balance,
                                                })}
                                            </span>
                                        )}
                                    </p>
                                    {estimateData.estimate.sufficient === false ? (
                                        <p className="text-danger-600">{t('ai.insufficient')}</p>
                                    ) : (
                                        <p className="text-neutral-500">{t('ai.howItWorks')}</p>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {!aiCheck && (
                        <p className="text-caption text-neutral-600">{t('check.teacher.later')}</p>
                    )}
                </form>
            </Form>
        </MyDialog>
    );
};

export default QuickOfflineTestDialog;
