import { useMemo } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { AxiosError } from 'axios';
import { toast } from 'sonner';
import { Info, WarningCircle } from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Form, FormControl, FormField, FormItem } from '@/components/ui/form';
import { getInstituteId } from '@/constants/helper';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import BatchMultiSelect, {
    useBatchOptions,
} from '@/routes/study-library/reports/-components/batchMultiSelect';
import type { TestContent } from '@/types/assessments/schedule-test-list';
import { duplicateAssessment } from '../../-services/duplicate-assessment';
import {
    buildDuplicatePayload,
    defaultDuplicateValues,
    duplicateAssessmentSchema,
    isInPast,
    requiresSchedule,
    showsRegistrationWindow,
    showsSchedule,
    type DuplicateAssessmentValues,
} from './duplicate-assessment-form';

interface DuplicateAssessmentDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    scheduleTestContent: TestContent;
    handleRefetchData: () => void;
}

/**
 * "Duplicate Assessment" from the assessment list: the admin picks what to copy and the
 * new dates / batches, the backend saves the copy as a draft, and the admin lands in its
 * wizard to review and publish it. The original is never changed.
 */
export const DuplicateAssessmentDialog = ({
    open,
    onOpenChange,
    scheduleTestContent,
    handleRefetchData,
}: DuplicateAssessmentDialogProps) => {
    const { t } = useTranslation('assessmentScheduleTestDetailsDropdownMenu');
    const navigate = useNavigate();
    const batchOptions = useBatchOptions();
    const batchTermPlural = getTerminologyPlural(ContentTerms.Batch, SystemTerms.Batch);
    const batchTerm = getTerminology(ContentTerms.Batch, SystemTerms.Batch);
    const playMode = scheduleTestContent.play_mode;
    const withSchedule = showsSchedule(playMode);
    const scheduleRequired = requiresSchedule(playMode);
    const withRegistration = showsRegistrationWindow(scheduleTestContent);

    const schema = useMemo(() => duplicateAssessmentSchema(playMode), [playMode]);
    const defaultValues = useMemo(
        () =>
            defaultDuplicateValues(
                scheduleTestContent,
                t('duplicate.defaultName', { name: scheduleTestContent.name }),
                new Set(batchOptions.map((option) => option.value))
            ),
        // The form is created once per opening; later store refreshes must not reset it.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        []
    );
    const form = useForm<DuplicateAssessmentValues>({
        resolver: zodResolver(schema),
        defaultValues,
        mode: 'onChange',
    });
    const [copyQuestions, startDate, endDate] = useWatch({
        control: form.control,
        name: ['copyQuestions', 'startDate', 'endDate'],
    });

    const mutation = useMutation({
        mutationFn: (values: DuplicateAssessmentValues) =>
            duplicateAssessment(
                scheduleTestContent.assessment_id,
                getInstituteId(),
                buildDuplicatePayload(values, scheduleTestContent)
            ),
        onSuccess: (copy) => {
            toast.success(t('duplicate.toasts.success', { name: copy.name }), {
                className: 'success-toast',
                duration: 4000,
            });
            handleRefetchData();
            onOpenChange(false);
            navigate({
                to: '/assessment/create-assessment/$assessmentId/$examtype',
                params: { assessmentId: copy.assessment_id, examtype: copy.play_mode || playMode },
                search: { currentStep: 0 },
            });
        },
        onError: (error: unknown) => {
            const message =
                error instanceof AxiosError
                    ? (error.response?.data as { ex?: string } | undefined)?.ex || error.message
                    : undefined;
            toast.error(message || t('duplicate.toasts.failed'), {
                className: 'error-toast',
                duration: 5000,
            });
        },
    });

    const onSubmit = form.handleSubmit((values) => mutation.mutate(values));
    const errorText = (message: string | undefined) => (message ? t(message) : undefined);

    const dateField = (
        name: 'startDate' | 'endDate' | 'registrationOpenDate' | 'registrationCloseDate',
        label: string,
        required: boolean
    ) => (
        <FormField
            control={form.control}
            name={name}
            render={({ field, fieldState }) => (
                <FormItem className="flex flex-col gap-1">
                    <FormControl>
                        <MyInput
                            inputType="datetime-local"
                            input={field.value}
                            onChangeFunction={field.onChange}
                            onBlur={field.onBlur}
                            name={field.name}
                            ref={field.ref}
                            label={label}
                            labelStyle="font-thin"
                            required={required}
                            size="large"
                            className="sm:w-full"
                            error={errorText(fieldState.error?.message)}
                            data-testid={`duplicate-${name}`}
                        />
                    </FormControl>
                    {!fieldState.error && isInPast(field.value) && (
                        <span className="flex items-center gap-1 text-caption text-warning-600">
                            <WarningCircle size={14} />
                            {t('duplicate.pastWarning')}
                        </span>
                    )}
                </FormItem>
            )}
        />
    );

    const optionRow = (
        name: 'copyQuestions' | 'copyMarking' | 'copyIndividualParticipants',
        label: string,
        hint: string,
        disabled = false
    ) => (
        <FormField
            control={form.control}
            name={name}
            render={({ field }) => (
                <FormItem>
                    <label
                        className={
                            disabled
                                ? 'flex cursor-not-allowed items-start gap-3 opacity-50'
                                : 'flex cursor-pointer items-start gap-3'
                        }
                    >
                        <FormControl>
                            <Checkbox
                                className="mt-0.5"
                                checked={field.value}
                                disabled={disabled}
                                onCheckedChange={(checked) => field.onChange(checked === true)}
                                data-testid={`duplicate-${name}`}
                            />
                        </FormControl>
                        <span className="flex flex-col gap-0.5">
                            <span className="text-body font-semibold text-neutral-700">
                                {label}
                            </span>
                            <span className="text-caption text-neutral-500">{hint}</span>
                        </span>
                    </label>
                </FormItem>
            )}
        />
    );

    return (
        <MyDialog
            open={open}
            onOpenChange={(next) => {
                if (!mutation.isPending) onOpenChange(next);
            }}
            heading={t('duplicate.title')}
            dialogWidth="max-w-2xl"
            dialogId="duplicate-assessment"
            footer={
                <>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        disable={mutation.isPending}
                        onClick={() => onOpenChange(false)}
                    >
                        {t('duplicate.cancel')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        disable={mutation.isPending}
                        onClick={onSubmit}
                        data-testid="duplicate-submit"
                    >
                        {mutation.isPending ? t('duplicate.creating') : t('duplicate.create')}
                    </MyButton>
                </>
            }
        >
            <Form {...form}>
                <form
                    className="flex flex-col gap-6"
                    onSubmit={(event) => {
                        event.preventDefault();
                        onSubmit();
                    }}
                >
                    <div className="flex items-start gap-2 rounded-lg bg-primary-50 p-3 text-body text-neutral-700">
                        <Info size={18} className="mt-0.5 shrink-0 text-primary-500" />
                        <span>{t('duplicate.intro', { name: scheduleTestContent.name })}</span>
                    </div>

                    <FormField
                        control={form.control}
                        name="name"
                        render={({ field, fieldState }) => (
                            <FormItem>
                                <FormControl>
                                    <MyInput
                                        inputType="text"
                                        input={field.value}
                                        onChangeFunction={field.onChange}
                                        onBlur={field.onBlur}
                                        name={field.name}
                                        ref={field.ref}
                                        label={t('duplicate.nameLabel')}
                                        labelStyle="font-thin"
                                        required
                                        size="large"
                                        className="sm:w-full"
                                        error={errorText(fieldState.error?.message)}
                                        data-testid="duplicate-name"
                                    />
                                </FormControl>
                            </FormItem>
                        )}
                    />

                    <section className="flex flex-col gap-3">
                        <h3 className="text-subtitle font-semibold text-neutral-700">
                            {t('duplicate.whatToCopy')}
                        </h3>
                        <div className="flex flex-col gap-4 rounded-lg border border-neutral-200 p-4">
                            {optionRow(
                                'copyQuestions',
                                t('duplicate.questions'),
                                t('duplicate.questionsHint')
                            )}
                            {optionRow(
                                'copyMarking',
                                t('duplicate.marking'),
                                t('duplicate.markingHint'),
                                !copyQuestions
                            )}
                        </div>
                    </section>

                    {withSchedule && (
                        <section className="flex flex-col gap-3">
                            <div className="flex flex-col gap-0.5">
                                <h3 className="text-subtitle font-semibold text-neutral-700">
                                    {t('duplicate.schedule')}
                                </h3>
                                <p className="text-caption text-neutral-500">
                                    {t('duplicate.scheduleHint')}
                                </p>
                            </div>
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                {dateField(
                                    'startDate',
                                    t('duplicate.startLabel'),
                                    scheduleRequired
                                )}
                                {dateField('endDate', t('duplicate.endLabel'), scheduleRequired)}
                            </div>
                            {!scheduleRequired && !startDate && !endDate && (
                                <p className="text-caption text-neutral-500">
                                    {t('duplicate.scheduleOptional')}
                                </p>
                            )}
                        </section>
                    )}

                    {withRegistration && (
                        <section className="flex flex-col gap-3">
                            <h3 className="text-subtitle font-semibold text-neutral-700">
                                {t('duplicate.registration')}
                            </h3>
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                {dateField(
                                    'registrationOpenDate',
                                    t('duplicate.registrationOpenLabel'),
                                    false
                                )}
                                {dateField(
                                    'registrationCloseDate',
                                    t('duplicate.registrationCloseLabel'),
                                    false
                                )}
                            </div>
                        </section>
                    )}

                    <section className="flex flex-col gap-3">
                        <div className="flex flex-col gap-0.5">
                            <h3 className="text-subtitle font-semibold text-neutral-700">
                                {t('duplicate.participants')}
                            </h3>
                            <p className="text-caption text-neutral-500">
                                {t('duplicate.batchesHint', {
                                    term: batchTermPlural.toLowerCase(),
                                })}
                            </p>
                        </div>
                        <FormField
                            control={form.control}
                            name="batchIds"
                            render={({ field }) => (
                                <FormItem data-testid="duplicate-batches">
                                    <BatchMultiSelect
                                        selected={field.value}
                                        onChange={field.onChange}
                                        hideLabel
                                        hint={t('duplicate.noBatches', {
                                            term: batchTermPlural.toLowerCase(),
                                        })}
                                    />
                                </FormItem>
                            )}
                        />
                        {optionRow(
                            'copyIndividualParticipants',
                            t('duplicate.individuals'),
                            t('duplicate.individualsHint', { term: batchTerm.toLowerCase() })
                        )}
                    </section>
                </form>
            </Form>
        </MyDialog>
    );
};
