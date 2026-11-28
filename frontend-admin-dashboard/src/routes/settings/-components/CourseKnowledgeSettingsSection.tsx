import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Brain, FloppyDisk, Info, LockSimple, Trash, WarningCircle } from '@phosphor-icons/react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { MyDialog } from '@/components/design-system/dialog';
import { SettingToggleRow } from '@/components/settings/shell';
import { cn } from '@/lib/utils';
import {
    courseKnowledgeErrorDetail,
    useCourseKnowledgeStatus,
    useDeleteCourseKnowledgeData,
    useUpdateCourseKnowledgeSettings,
    type CourseKnowledgeSettingsPatch,
    type CourseKnowledgeStatus,
} from '@/services/course-knowledge-settings';

/**
 * Settings → AI → Course knowledge: lets the student AI answer from the
 * institute's own lessons (with links to the exact page or minute).
 *
 * Renders nothing until GET /course-knowledge/v1/status says the feature is
 * available to this institute, so non-pilot institutes see no change. Teachers
 * and other staff see the settings read-only; only admins (`can_manage`) can
 * change them or delete the course AI data — the API re-checks both.
 */

type FormValues = {
    enabled: boolean;
    learner_answers_enabled: boolean;
    auto_paid_enabled: boolean;
    monthly_auto_cap_credits: string;
    allow_ocr: boolean;
    allow_transcription: boolean;
};

const toFormValues = (status: CourseKnowledgeStatus): FormValues => ({
    enabled: status.enabled,
    learner_answers_enabled: status.learner_answers_enabled,
    auto_paid_enabled: status.auto_paid_enabled,
    monthly_auto_cap_credits: String(status.monthly_auto_cap_credits ?? 0),
    allow_ocr: status.allow_ocr,
    allow_transcription: status.allow_transcription,
});

const PAID_FIELDS: ReadonlyArray<keyof FormValues> = [
    'auto_paid_enabled',
    'monthly_auto_cap_credits',
    'allow_ocr',
    'allow_transcription',
];

/**
 * Only the fields the admin changed go to PUT /settings (the server keeps the
 * rest). Paid fields are never sent while the platform has paid processing
 * off — their controls are hidden then, so the stored values must stand.
 */
const buildPatch = (
    values: FormValues,
    dirty: Partial<Record<keyof FormValues, boolean>>,
    paidAvailable: boolean
): CourseKnowledgeSettingsPatch => {
    const patch: Record<string, boolean | number> = {};
    (Object.keys(values) as Array<keyof FormValues>).forEach((name) => {
        if (!dirty[name]) return;
        if (!paidAvailable && PAID_FIELDS.includes(name)) return;
        const value = values[name];
        patch[name] = typeof value === 'string' ? Number(value) : value;
    });
    return patch as CourseKnowledgeSettingsPatch;
};

export const CourseKnowledgeSettingsSection = () => {
    const { data: status } = useCourseKnowledgeStatus();
    // Loading, failed, or not available for this institute: the section stays
    // invisible, exactly as before the feature existed.
    if (!status?.available) return null;
    return <CourseKnowledgeSettingsCard status={status} />;
};

const CourseKnowledgeSettingsCard = ({ status }: { status: CourseKnowledgeStatus }) => {
    const { t, i18n } = useTranslation('settingsCourseKnowledge');
    const updateSettings = useUpdateCourseKnowledgeSettings();
    const deleteData = useDeleteCourseKnowledgeData();
    const [saveError, setSaveError] = useState<string | null>(null);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);

    const readOnly = !status.can_manage;
    const maxCap = Math.max(0, Math.floor(status.max_monthly_auto_cap ?? 0));

    const formatNumber = useMemo(() => {
        let formatter: Intl.NumberFormat;
        try {
            formatter = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 });
        } catch {
            // A language tag Intl does not know (e.g. 'cimode') falls back to English.
            formatter = new Intl.NumberFormat('en', { maximumFractionDigits: 2 });
        }
        return (value: number) => formatter.format(Number.isFinite(value) ? value : 0);
    }, [i18n.language]);

    const schema = useMemo(
        () =>
            z.object({
                enabled: z.boolean(),
                learner_answers_enabled: z.boolean(),
                auto_paid_enabled: z.boolean(),
                monthly_auto_cap_credits: z
                    .string()
                    .trim()
                    .regex(/^\d+$/, t('validation.capWholeNumber'))
                    .refine((value) => Number(value) <= maxCap, {
                        message: t('validation.capMax', { max: formatNumber(maxCap) }),
                    }),
                allow_ocr: z.boolean(),
                allow_transcription: z.boolean(),
            }),
        [t, maxCap, formatNumber]
    );

    const form = useForm<FormValues>({
        resolver: zodResolver(schema),
        defaultValues: toFormValues(status),
    });
    const { isDirty } = form.formState;

    // Follow the server's answer (a refetch, another admin's save) unless the
    // admin is in the middle of editing.
    useEffect(() => {
        if (!form.formState.isDirty) form.reset(toFormValues(status));
    }, [status, form]);

    const enabled = form.watch('enabled');
    const autoPaid = form.watch('auto_paid_enabled');
    const saving = updateSettings.isPending;
    const locked = readOnly || saving;

    const handleSave = async (values: FormValues) => {
        if (readOnly) return;
        setSaveError(null);
        const patch = buildPatch(values, form.formState.dirtyFields, status.paid_available);
        if (Object.keys(patch).length === 0) {
            form.reset(values);
            return;
        }
        try {
            const next = await updateSettings.mutateAsync(patch);
            form.reset(toFormValues(next));
            toast.success(t('toasts.saved'));
        } catch (error) {
            const message = courseKnowledgeErrorDetail(error)?.message || t('errors.saveFailed');
            setSaveError(message);
            toast.error(message);
        }
    };

    const handleDelete = async () => {
        setDeleteError(null);
        try {
            await deleteData.mutateAsync();
            form.reset(toFormValues({ ...status, enabled: false }));
            setDeleteOpen(false);
            toast.success(t('toasts.deleted'));
        } catch (error) {
            setDeleteError(courseKnowledgeErrorDetail(error)?.message || t('errors.deleteFailed'));
        }
    };

    const spent = Number(status.month_auto_spent_credits) || 0;
    const cap = Number(status.monthly_auto_cap_credits) || 0;
    const meterValue = cap > 0 ? Math.min(100, (spent / cap) * 100) : spent > 0 ? 100 : 0;
    const overCap = cap > 0 ? spent >= cap : spent > 0;

    return (
        <Card className="border-neutral-200 shadow-sm">
            <CardHeader className="border-b border-neutral-100 bg-primary-50">
                <div className="flex items-center gap-2">
                    <div className="rounded-lg bg-primary-500 p-2 text-white">
                        <Brain className="size-5" />
                    </div>
                    <CardTitle className="text-subtitle">{t('title')}</CardTitle>
                </div>
                <CardDescription className="text-body text-neutral-600">
                    {t('intro')}
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 pt-6">
                {readOnly && (
                    <div className="flex items-start gap-2 rounded-md border border-neutral-200 bg-neutral-50 p-3 text-caption text-neutral-600">
                        <LockSimple className="mt-0.5 size-4 shrink-0" />
                        <span>{t('readOnlyNotice')}</span>
                    </div>
                )}

                <Form {...form}>
                    <form onSubmit={form.handleSubmit(handleSave)} className="space-y-4" noValidate>
                        <FormField
                            control={form.control}
                            name="enabled"
                            render={({ field }) => (
                                <FormItem>
                                    <SettingToggleRow
                                        label={
                                            <Label htmlFor="ck-enabled" className="text-body">
                                                {t('enabled.label')}
                                            </Label>
                                        }
                                        description={t('enabled.hint')}
                                        control={
                                            <FormControl>
                                                <Switch
                                                    id="ck-enabled"
                                                    checked={field.value}
                                                    onCheckedChange={field.onChange}
                                                    disabled={locked}
                                                />
                                            </FormControl>
                                        }
                                    />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="learner_answers_enabled"
                            render={({ field }) => (
                                <FormItem>
                                    <SettingToggleRow
                                        className={cn(!enabled && 'opacity-60')}
                                        label={
                                            <Label
                                                htmlFor="ck-learner-answers"
                                                className="text-body"
                                            >
                                                {t('learnerAnswers.label')}
                                            </Label>
                                        }
                                        description={
                                            enabled
                                                ? t('learnerAnswers.hint')
                                                : t('learnerAnswers.needsEnabled')
                                        }
                                        control={
                                            <FormControl>
                                                <Switch
                                                    id="ck-learner-answers"
                                                    checked={field.value}
                                                    onCheckedChange={field.onChange}
                                                    disabled={locked || !enabled}
                                                />
                                            </FormControl>
                                        }
                                    />
                                </FormItem>
                            )}
                        />

                        {status.paid_available && (
                            <div className="space-y-4 rounded-md border border-border p-3">
                                <FormField
                                    control={form.control}
                                    name="auto_paid_enabled"
                                    render={({ field }) => (
                                        <FormItem>
                                            <div className="flex items-center justify-between gap-4">
                                                <div className="min-w-0 space-y-0.5">
                                                    <Label
                                                        htmlFor="ck-auto-paid"
                                                        className="text-body text-neutral-700"
                                                    >
                                                        {t('autoPaid.label')}
                                                    </Label>
                                                    <p className="text-caption text-neutral-500">
                                                        {t('autoPaid.hint')}
                                                    </p>
                                                </div>
                                                <FormControl>
                                                    <Switch
                                                        id="ck-auto-paid"
                                                        checked={field.value}
                                                        onCheckedChange={field.onChange}
                                                        disabled={locked}
                                                    />
                                                </FormControl>
                                            </div>
                                        </FormItem>
                                    )}
                                />

                                <div
                                    className={cn(
                                        'space-y-4 border-t border-neutral-100 pt-4',
                                        !autoPaid && 'opacity-60'
                                    )}
                                >
                                    <FormField
                                        control={form.control}
                                        name="monthly_auto_cap_credits"
                                        render={({ field, fieldState }) => (
                                            <FormItem>
                                                <div className="flex flex-wrap items-center gap-2 text-body text-neutral-700">
                                                    <span>{t('autoPaid.capPrefix')}</span>
                                                    <FormControl>
                                                        <MyInput
                                                            inputType="number"
                                                            size="medium"
                                                            className={cn(
                                                                'sm:w-32',
                                                                fieldState.error &&
                                                                    'border-danger-600'
                                                            )}
                                                            min={0}
                                                            max={maxCap}
                                                            step={1}
                                                            inputMode="numeric"
                                                            aria-label={t('autoPaid.capAria')}
                                                            input={field.value}
                                                            onChangeFunction={(e) =>
                                                                field.onChange(e.target.value)
                                                            }
                                                            onBlur={field.onBlur}
                                                            name={field.name}
                                                            ref={field.ref}
                                                            disabled={locked || !autoPaid}
                                                        />
                                                    </FormControl>
                                                    <span>{t('autoPaid.capSuffix')}</span>
                                                </div>
                                                <p className="text-caption text-neutral-500">
                                                    {t('autoPaid.capHint', {
                                                        max: formatNumber(maxCap),
                                                    })}
                                                </p>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={form.control}
                                        name="allow_ocr"
                                        render={({ field }) => (
                                            <FormItem className="flex items-start gap-2 space-y-0">
                                                <FormControl>
                                                    <Checkbox
                                                        id="ck-allow-ocr"
                                                        className="mt-0.5"
                                                        checked={field.value}
                                                        onCheckedChange={(checked) =>
                                                            field.onChange(checked === true)
                                                        }
                                                        disabled={locked || !autoPaid}
                                                    />
                                                </FormControl>
                                                <Label
                                                    htmlFor="ck-allow-ocr"
                                                    className="text-body font-regular text-neutral-700"
                                                >
                                                    {t('autoPaid.allowOcr')}
                                                </Label>
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={form.control}
                                        name="allow_transcription"
                                        render={({ field }) => (
                                            <FormItem className="flex items-start gap-2 space-y-0">
                                                <FormControl>
                                                    <Checkbox
                                                        id="ck-allow-transcription"
                                                        className="mt-0.5"
                                                        checked={field.value}
                                                        onCheckedChange={(checked) =>
                                                            field.onChange(checked === true)
                                                        }
                                                        disabled={locked || !autoPaid}
                                                    />
                                                </FormControl>
                                                <Label
                                                    htmlFor="ck-allow-transcription"
                                                    className="text-body font-regular text-neutral-700"
                                                >
                                                    {t('autoPaid.allowTranscription')}
                                                </Label>
                                            </FormItem>
                                        )}
                                    />
                                </div>

                                <div className="space-y-1.5 border-t border-neutral-100 pt-4">
                                    <div className="flex items-center justify-between gap-4 text-caption">
                                        <span className="text-neutral-600">
                                            {t('autoPaid.meter', {
                                                used: formatNumber(spent),
                                                cap: formatNumber(cap),
                                            })}
                                        </span>
                                        {overCap && (
                                            <span className="flex items-center gap-1 text-warning-700">
                                                <WarningCircle className="size-4" />
                                                {t('autoPaid.capReached')}
                                            </span>
                                        )}
                                    </div>
                                    <Progress
                                        value={meterValue}
                                        aria-label={t('autoPaid.meterAria')}
                                        className={cn(
                                            'h-2 border border-neutral-200',
                                            overCap && '[&>div]:bg-warning-500'
                                        )}
                                    />
                                </div>
                            </div>
                        )}

                        <div className="flex items-start gap-2 text-caption text-neutral-500">
                            <Info className="mt-0.5 size-4 shrink-0" />
                            <span>{t('footer')}</span>
                        </div>

                        {saveError && (
                            <p
                                role="alert"
                                className="flex items-center gap-1 text-caption text-danger-600"
                            >
                                <WarningCircle className="size-4 shrink-0" />
                                {saveError}
                            </p>
                        )}

                        {!readOnly && (
                            <div className="flex flex-wrap justify-end gap-3">
                                {isDirty && (
                                    <MyButton
                                        type="button"
                                        buttonType="secondary"
                                        scale="medium"
                                        disable={saving}
                                        onClick={() => {
                                            setSaveError(null);
                                            form.reset(toFormValues(status));
                                        }}
                                    >
                                        {t('discard')}
                                    </MyButton>
                                )}
                                <MyButton
                                    type="submit"
                                    buttonType="primary"
                                    scale="medium"
                                    disable={!isDirty || saving}
                                >
                                    <FloppyDisk size={16} />
                                    {saving ? t('saving') : t('save')}
                                </MyButton>
                            </div>
                        )}
                    </form>
                </Form>

                {status.can_manage && (
                    <div className="space-y-3 rounded-md border border-danger-200 bg-danger-50 p-4">
                        <div className="space-y-0.5">
                            <p className="text-body font-semibold text-danger-700">
                                {t('danger.title')}
                            </p>
                            <p className="text-caption text-neutral-600">
                                {t('danger.description')}
                            </p>
                        </div>
                        <MyDialog
                            heading={t('danger.dialogTitle')}
                            open={deleteOpen}
                            onOpenChange={(open) => {
                                if (deleteData.isPending) return;
                                setDeleteOpen(open);
                                if (!open) setDeleteError(null);
                            }}
                            dialogWidth="max-w-md"
                            trigger={
                                <MyButton
                                    type="button"
                                    buttonType="secondary"
                                    scale="medium"
                                    className="border-danger-300 !text-danger-600 hover:border-danger-500 hover:bg-danger-50"
                                >
                                    <Trash size={16} />
                                    {t('danger.button')}
                                </MyButton>
                            }
                            footer={
                                <>
                                    <MyButton
                                        type="button"
                                        buttonType="secondary"
                                        scale="medium"
                                        disable={deleteData.isPending}
                                        onClick={() => setDeleteOpen(false)}
                                    >
                                        {t('danger.cancel')}
                                    </MyButton>
                                    <MyButton
                                        type="button"
                                        buttonType="primary"
                                        scale="medium"
                                        className="bg-danger-600 hover:bg-danger-700 active:bg-danger-700"
                                        onAsyncClick={handleDelete}
                                        loadingText={t('danger.deleting')}
                                    >
                                        {t('danger.confirm')}
                                    </MyButton>
                                </>
                            }
                        >
                            <div className="space-y-3 text-body text-neutral-700">
                                <p>{t('danger.dialogBody')}</p>
                                <ul className="list-disc space-y-1 ps-5 text-caption text-neutral-600">
                                    <li>{t('danger.dialogPointIndex')}</li>
                                    <li>{t('danger.dialogPointOff')}</li>
                                    <li>{t('danger.dialogPointCredits')}</li>
                                </ul>
                                {deleteError && (
                                    <p
                                        role="alert"
                                        className="flex items-center gap-1 text-caption text-danger-600"
                                    >
                                        <WarningCircle className="size-4 shrink-0" />
                                        {deleteError}
                                    </p>
                                )}
                            </div>
                        </MyDialog>
                    </div>
                )}
            </CardContent>
        </Card>
    );
};
