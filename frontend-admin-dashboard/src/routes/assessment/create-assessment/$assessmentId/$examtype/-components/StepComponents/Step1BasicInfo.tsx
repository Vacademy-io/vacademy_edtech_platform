import { MyButton } from '@/components/design-system/button';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent } from '@/components/ui/card';
import {
    Info,
    CalendarBlank,
    Gear,
    Eye,
    ArrowsLeftRight,
    Sparkle,
    ListChecks,
} from '@phosphor-icons/react';
import { StepContentProps } from '@/types/assessments/step-content-props';
import { zodResolver } from '@hookform/resolvers/zod';
import React, { useEffect, useMemo, useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { z } from 'zod';
import { useFilterDataForAssesment } from '../../../../../assessment-list/-utils.ts/useFiltersData';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { MyInput } from '@/components/design-system/input';
import SelectField from '@/components/design-system/select-field';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { timeLimit } from '@/constants/dummy-data';
import { BasicInfoFormSchema } from '../../-utils/basic-info-form-schema';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { getAssessmentDetailsData, handlePostStep1Data } from '../../-services/assessment-services';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import {
    convertDateFormat,
    defaultResultTypeFor,
    defaultSubmissionTypeFor,
    flattenFormErrors,
    getStepKey,
    isBasicInfoStepComplete,
    resultTypeForEdit,
    showsResultReleaseSettings,
    getTimeLimitString,
    isOpenEndedExamType,
    syncStep1DataWithStore,
} from '../../-utils/helper';
import { RichTextEditor } from '@/components/editor/RichTextEditor';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import { useSavedAssessmentStore } from '../../-utils/global-states';
import { useBasicInfoStore } from '../../-utils/zustand-global-states/step1-basic-info';
import { toast } from 'sonner';
import { reportApiError } from '@/lib/report-api-error';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { CaretLeft } from '@phosphor-icons/react';
import { useParams } from '@tanstack/react-router';
import { ContentTerms, RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { cn, convertCapitalToTitleCase } from '@/lib/utils';
import { unresolvedSubjectIds, useSubjectNamesByIds } from '@/services/subject-names';
import { useTranslation } from 'react-i18next';
import { DEFAULT_PROCTORING_FORM, proctoringFormFromWire } from '@/types/assessments/proctoring';
import { ProctoringSettingsCard } from './-components/ProctoringSettingsCard';
import { isApiSourced } from '../../../../../assessment-list/-utils.ts/assessment-source';

// convertDateFormat lives in -utils/helper; Step 3 still imports it from here.
export { convertDateFormat } from '../../-utils/helper';

/** One result-type radio card; `locked` = the exam is managed by the AI Evaluation API. */
const resultTypeOptionClass = (selected: boolean, locked: boolean) =>
    cn(
        'flex gap-3 rounded-lg border p-4 transition-colors',
        locked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
        selected
            ? 'border-primary-400 bg-primary-50'
            : cn(
                  'border-neutral-200 bg-white',
                  !locked && 'hover:border-primary-200 hover:bg-primary-50/40'
              )
    );

/** Shown above the result type of an exam created through the AI Evaluation API (spec §12). */
const ManagedByApiNote = () => {
    const { t } = useTranslation('assessmentStep1BasicInfo');
    return (
        <p className="flex items-center gap-1.5 text-xs text-neutral-500">
            <Info className="size-3.5 shrink-0 text-primary-500" />
            {t('attemptSettingsSection.resultEvaluationType.managedByApi')}
        </p>
    );
};

const SectionCard = ({
    icon: Icon,
    title,
    description,
    children,
}: {
    icon: React.ComponentType<{ className?: string }>;
    title: string;
    description?: string;
    children: React.ReactNode;
}) => (
    <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-5 sm:p-6">
            <div className="mb-5 flex items-start gap-3 border-b border-slate-100 pb-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-500">
                    <Icon className="h-4 w-4" />
                </div>
                <div className="flex flex-col">
                    <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
                    {description && (
                        <p className="text-xs text-slate-500">{description}</p>
                    )}
                </div>
            </div>
            <div className="flex flex-col gap-5">{children}</div>
        </CardContent>
    </Card>
);

// Helper component for navigation header
const NavigationHeader = ({ examType, isUpdate = false }: { examType: string; isUpdate?: boolean }) => {
    const { t } = useTranslation('assessmentStep1BasicInfo');
    const handleBack = () => {
                    useBasicInfoStore.getState().reset();
                    window.history.back();
    };

    return (
        <div className="flex items-center gap-4">
            <CaretLeft onClick={handleBack} className="cursor-pointer" />
            <h1 className="text-lg">
                {isUpdate
                    ? (examType === 'SURVEY' ? t('navigation.updateSurvey') : t('navigation.updateAssessment'))
                    : (examType === 'SURVEY' ? t('navigation.createSurvey') : t('navigation.createAssessment'))
                }
            </h1>
        </div>
    );
};

// Helper component for test creation form fields
const TestCreationFields = ({ control, form, examType, instituteDetails }: any) => {
    const { t } = useTranslation('assessmentStep1BasicInfo');
    return (
        <div className="flex w-full items-start justify-start gap-4">
            <div className="" id={'assessment-details'}>
                <FormField
                    control={control}
                    name="testCreation.assessmentName"
                    render={({ field: { ...field } }) => (
                        <FormItem>
                            <FormControl>
                                <MyInput
                                    inputType="text"
                                    inputPlaceholder={t('unusedFields.testCreation.titlePlaceholder')}
                                    input={field.value}
                                    labelStyle="font-thin"
                                    onChangeFunction={field.onChange}
                                    error={
                                        form.formState.errors.testCreation
                                            ?.assessmentName?.message
                                    }
                                    required={true}
                                    size="large"
                                    label={
                                        examType === 'SURVEY'
                                            ? t('unusedFields.testCreation.nameLabelSurvey')
                                            : t('unusedFields.testCreation.nameLabelAssessment')
                                    }
                                    {...field}
                                />
                            </FormControl>
                        </FormItem>
                    )}
                />
            </div>
            <div className="" id={'subject-selection'}>
                <FormField
                    control={control}
                    name="testCreation.subject"
                    render={({ field: { ...field } }) => (
                        <FormItem>
                            <FormControl>
                                <SelectField
                                    label={getTerminology(ContentTerms.Subjects, SystemTerms.Subjects)}
                                    name="testCreation.subject"
                                    options={[]}
                                    control={control}
                                    required
                                />
                            </FormControl>
                        </FormItem>
                    )}
                />
            </div>
        </div>
    );
};

// Helper component for live date range fields
const LiveDateRangeFields = ({ control, form }: any) => {
    const { t } = useTranslation('assessmentStep1BasicInfo');
    return (
        <div className="flex w-full items-start justify-start gap-4">
            <div className="" id={'live-date-range-start'}>
                <FormField
                    control={control}
                    name="testCreation.liveDateRange.startDate"
                    render={({ field: { ...field } }) => (
                        <FormItem>
                            <FormControl>
                                <MyInput
                                    inputType="datetime-local"
                                    input={field.value}
                                    labelStyle="font-thin"
                                    onChangeFunction={field.onChange}
                                    error={
                                        form.formState.errors.testCreation?.liveDateRange
                                            ?.startDate?.message
                                    }
                                    required={true}
                                    size="large"
                                    label={t('unusedFields.liveDateRange.startDateLabel')}
                                    {...field}
                                />
                            </FormControl>
                        </FormItem>
                    )}
                />
            </div>
            <div className="" id={'live-date-range-end'}>
                <FormField
                    control={control}
                    name="testCreation.liveDateRange.endDate"
                    render={({ field: { ...field } }) => (
                        <FormItem>
                            <FormControl>
                                <MyInput
                                    inputType="datetime-local"
                                    input={field.value}
                                    labelStyle="font-thin"
                                    onChangeFunction={field.onChange}
                                    error={
                                        form.formState.errors.testCreation?.liveDateRange
                                            ?.endDate?.message
                                    }
                                    required={true}
                                    size="large"
                                    label={t('unusedFields.liveDateRange.endDateLabel')}
                                    {...field}
                                />
                            </FormControl>
                        </FormItem>
                    )}
                />
            </div>
        </div>
    );
};

// Helper component for assessment instructions
const AssessmentInstructionsField = ({ control, form, examType }: any) => {
    const { t } = useTranslation('assessmentStep1BasicInfo');
    return (
        <div className="flex w-full items-start justify-start">
            <div className="w-full" id={'assessment-instructions'}>
                <FormField
                    control={control}
                    name="testCreation.assessmentInstructions"
                    render={({ field: { ...field } }) => (
                        <FormItem>
                            <FormControl>
                                <div>
                                    <FormLabel>
                                        {examType === 'SURVEY'
                                            ? t('unusedFields.assessmentInstructions.labelSurvey')
                                            : t('unusedFields.assessmentInstructions.labelAssessment')}
                                    </FormLabel>
                                    <RichTextEditor
                                        value={field.value}
                                        onChange={field.onChange}
                                        placeholder={
                                            examType === 'SURVEY'
                                                ? t('unusedFields.assessmentInstructions.placeholderSurvey')
                                                : t('unusedFields.assessmentInstructions.placeholderAssessment')
                                        }
                                    />
                                </div>
                            </FormControl>
                        </FormItem>
                    )}
                />
            </div>
        </div>
    );
};

// Helper component for assessment preview settings
const AssessmentPreviewSettings = ({ control, form, timeLimit }: any) => {
    const { t } = useTranslation('assessmentStep1BasicInfo');
    return (
        <div className="flex w-full items-start justify-start gap-4">
            <div className="" id={'assessment-preview-checkbox'}>
                <FormField
                    control={control}
                    name="assessmentPreview.checked"
                    render={({ field: { ...field } }) => (
                        <FormItem>
                            <FormControl>
                                <div className="flex items-center space-x-2">
                                    <Checkbox
                                        checked={field.value}
                                        onCheckedChange={field.onChange}
                                        {...field}
                                    />
                                    <FormLabel>{t('unusedFields.assessmentPreview.enableLabel')}</FormLabel>
                                </div>
                            </FormControl>
                        </FormItem>
                    )}
                />
            </div>
            <div className="" id={'assessment-preview-time-limit'}>
                <FormField
                    control={control}
                    name="assessmentPreview.previewTimeLimit"
                    render={({ field: { ...field } }) => (
                        <FormItem>
                            <FormControl>
                                <SelectField
                                    label={t('unusedFields.assessmentPreview.timeLimitLabel')}
                                    name="assessmentPreview.previewTimeLimit"
                                    options={timeLimit}
                                    control={control}
                                    required
                                />
                            </FormControl>
                        </FormItem>
                    )}
                />
            </div>
        </div>
    );
};

// Helper component for reattempt count
const ReattemptCountField = ({ control, form }: any) => {
    const { t } = useTranslation('assessmentStep1BasicInfo');
    return (
        <div className="flex w-full items-start justify-start">
            <div className="" id={'reattempt-count'}>
                <FormField
                    control={control}
                    name="reattemptCount"
                    render={({ field: { ...field } }) => (
                        <FormItem>
                            <FormControl>
                                <MyInput
                                    inputType="number"
                                    inputPlaceholder={t('unusedFields.reattemptCount.placeholder')}
                                    input={field.value}
                                    labelStyle="font-thin"
                                    onChangeFunction={field.onChange}
                                    error={form.formState.errors.reattemptCount?.message}
                                    required={true}
                                    size="large"
                                    label={t('unusedFields.reattemptCount.label')}
                                    {...field}
                                />
                            </FormControl>
                        </FormItem>
                    )}
                />
            </div>
        </div>
    );
};

// Helper component for submission type
const SubmissionTypeField = ({ control, form, examType }: any) => {
    const { t } = useTranslation('assessmentStep1BasicInfo');
    return (
        <div className="flex w-full items-start justify-start">
            <div className="" id={'submission-type'}>
                <FormField
                    control={control}
                    name="submissionType"
                    render={({ field: { ...field } }) => (
                        <FormItem>
                            <FormControl>
                                <SelectField
                                    label={t('unusedFields.submissionType.label')}
                                    name="submissionType"
                                    options={[
                                        {
                                            value: 'AUTO_SUBMIT',
                                            label: t('unusedFields.submissionType.options.autoSubmit'),
                                            _id: 1,
                                        },
                                        {
                                            value: 'MANUAL_SUBMIT',
                                            label: t('unusedFields.submissionType.options.manualSubmit'),
                                            _id: 2,
                                        },
                                    ]}
                                    control={control}
                                    required
                                />
                            </FormControl>
                        </FormItem>
                    )}
                />
            </div>
        </div>
    );
};

// Helper component for duration distribution
const DurationDistributionField = ({ control, form }: any) => {
    const { t } = useTranslation('assessmentStep1BasicInfo');
    return (
        <div className="flex w-full items-start justify-start">
            <div className="" id={'duration-distribution'}>
                <FormField
                    control={control}
                    name="durationDistribution"
                    render={({ field: { ...field } }) => (
                        <FormItem>
                            <FormControl>
                                <SelectField
                                    label={t('unusedFields.durationDistribution.label')}
                                    name="durationDistribution"
                                    options={[
                                        {
                                            value: 'ASSESSMENT',
                                            label: t(
                                                'unusedFields.durationDistribution.options.entireAssessment'
                                            ),
                                            _id: 1,
                                        },
                                        {
                                            value: 'SECTION',
                                            label: t(
                                                'unusedFields.durationDistribution.options.sectionWise'
                                            ),
                                            _id: 2,
                                        },
                                        {
                                            value: 'QUESTION',
                                            label: t(
                                                'unusedFields.durationDistribution.options.questionWise'
                                            ),
                                            _id: 3,
                                        },
                                    ]}
                                    control={control}
                                    required
                                />
                                <p className="mt-1 text-xs text-muted-foreground">
                                    {t('unusedFields.durationDistribution.helper')}
                                </p>
                            </FormControl>
                        </FormItem>
                    )}
                />
            </div>
        </div>
    );
};

// Helper component for evaluation type
const EvaluationTypeField = ({ control, form }: any) => {
    const { t } = useTranslation('assessmentStep1BasicInfo');
    return (
        <div className="flex w-full items-start justify-start">
            <div className="" id={'evaluation-type'}>
                <FormField
                    control={control}
                    name="evaluationType"
                    render={({ field: { ...field } }) => (
                        <FormItem>
                            <FormControl>
                                <SelectField
                                    label={t('unusedFields.evaluationType.label')}
                                    name="evaluationType"
                                    options={[
                                        {
                                            value: 'AUTO',
                                            label: t('unusedFields.evaluationType.options.auto'),
                                            _id: 1,
                                        },
                                        {
                                            value: 'MANUAL',
                                            label: t('unusedFields.evaluationType.options.manual'),
                                            _id: 2,
                                        },
                                    ]}
                                    control={control}
                                    required
                                />
                            </FormControl>
                        </FormItem>
                    )}
                />
            </div>
        </div>
    );
};

// Helper component for switch sections checkbox
const SwitchSectionsField = ({ control }: any) => {
    const { t } = useTranslation('assessmentStep1BasicInfo');
    return (
        <div className="flex w-full items-start justify-start">
            <div className="" id={'switch-sections'}>
                <FormField
                    control={control}
                    name="switchSections"
                    render={({ field: { ...field } }) => (
                        <FormItem>
                            <FormControl>
                                <div className="flex items-center space-x-2">
                                    <Checkbox
                                        checked={field.value}
                                        onCheckedChange={field.onChange}
                                        {...field}
                                    />
                                    <FormLabel>{t('unusedFields.switchSections.label')}</FormLabel>
                                </div>
                            </FormControl>
                        </FormItem>
                    )}
                />
            </div>
        </div>
    );
};

// Helper component for reattempt request checkbox
const ReattemptRequestField = ({ control }: any) => {
    const { t } = useTranslation('assessmentStep1BasicInfo');
    return (
        <div className="flex w-full items-start justify-start">
            <div className="" id={'raise-reattempt-request'}>
                <FormField
                    control={control}
                    name="raiseReattemptRequest"
                    render={({ field: { ...field } }) => (
                        <FormItem>
                            <FormControl>
                                <div className="flex items-center space-x-2">
                                    <Checkbox
                                        checked={field.value}
                                        onCheckedChange={field.onChange}
                                        {...field}
                                    />
                                    <FormLabel>{t('unusedFields.reattemptRequest.label')}</FormLabel>
                                </div>
                            </FormControl>
                        </FormItem>
                    )}
                />
            </div>
        </div>
    );
};

// Helper component for time increase request checkbox
const TimeIncreaseRequestField = ({ control }: any) => {
    const { t } = useTranslation('assessmentStep1BasicInfo');
    return (
        <div className="flex w-full items-start justify-start">
            <div className="" id={'raise-time-increase-request'}>
                <FormField
                    control={control}
                    name="raiseTimeIncreaseRequest"
                    render={({ field: { ...field } }) => (
                        <FormItem>
                            <FormControl>
                                <div className="flex items-center space-x-2">
                                    <Checkbox
                                        checked={field.value}
                                        onCheckedChange={field.onChange}
                                        {...field}
                                    />
                                    <FormLabel>{t('unusedFields.timeIncreaseRequest.label')}</FormLabel>
                                </div>
                            </FormControl>
                        </FormItem>
                    )}
                />
            </div>
        </div>
    );
};

const Step1BasicInfo: React.FC<StepContentProps> = ({
    currentStep,
    handleCompleteCurrentStep,
    completedSteps,
}) => {
    const { t } = useTranslation('assessmentStep1BasicInfo');
    const queryClient = useQueryClient();
    const params = useParams({ strict: false });
    const examType = params.examtype || 'EXAM';
    const assessmentId = params.assessmentId;
    const { setNavHeading } = useNavHeadingStore();
    const storeDataStep1 = useBasicInfoStore((state) => state);
    const { setSavedAssessmentId } = useSavedAssessmentStore();
    const { data: instituteDetails } = useSuspenseQuery(useInstituteQuery());

    const { SubjectFilterData } = useFilterDataForAssesment(instituteDetails);

    const form = useForm<z.infer<typeof BasicInfoFormSchema>>({
        resolver: zodResolver(BasicInfoFormSchema),
        defaultValues: {
            status: completedSteps[currentStep] ? 'COMPLETE' : 'INCOMPLETE',
            testCreation: {
                assessmentName: storeDataStep1.testCreation?.assessmentName || '',
                subject: storeDataStep1.testCreation?.subject || '',
                assessmentInstructions: storeDataStep1.testCreation?.assessmentInstructions || '',
                liveDateRange: {
                    startDate: storeDataStep1.testCreation?.liveDateRange?.startDate || '', // Default start date
                    endDate: storeDataStep1.testCreation?.liveDateRange?.endDate || '', // Default end date
                },
            },
            assessmentPreview: {
                // Off by default, and `??` not `||`: with `||` a stored `false` was
                // coerced straight back to `true`, so once this had ever been on the
                // toggle could not be turned off again — every remount re-enabled it.
                // (The three flags below still have that coercion bug; two of them are
                // stuck on the opposite of what their own comment says they default to.)
                checked: storeDataStep1.assessmentPreview?.checked ?? false,
                previewTimeLimit:
                    storeDataStep1.assessmentPreview?.previewTimeLimit || timeLimit[0], // Default preview time
            },
            reattemptCount: storeDataStep1.reattemptCount || '1',
            submissionType: storeDataStep1.submissionType || defaultSubmissionTypeFor(examType),
            durationDistribution: storeDataStep1.durationDistribution || '',
            evaluationType: storeDataStep1.evaluationType || '',
            // Preselected by assessment type so the radio never sits empty and
            // silently saves as MANUAL (Mock/Practice/Exam/Survey grade themselves).
            resultType: storeDataStep1.resultType || defaultResultTypeFor(examType),
            // `??` not `||`: a stored `false` must survive a remount. Off by default
            // because AI evaluation charges institute credits per graded question.
            aiEvaluationEnabled: storeDataStep1.aiEvaluationEnabled ?? false,
            // `??` for the same reason: a stored `false` must stay off.
            omrMode: storeDataStep1.omrMode ?? false,
            proctoring: storeDataStep1.proctoring ?? DEFAULT_PROCTORING_FORM,
            switchSections: storeDataStep1.switchSections || true, // Default to false
            raiseReattemptRequest: storeDataStep1.raiseReattemptRequest || true, // Default to true
            raiseTimeIncreaseRequest: storeDataStep1.raiseTimeIncreaseRequest || true, // Default to false
        },
        mode: 'onChange', // Validate as user types
    });

    const { handleSubmit, control, watch } = form;

    // Watch form fields
    const selectedSubjectId = watch('testCreation.subject');
    // The dropdown comes from a list admin_core deduplicates by subject name, so a
    // perfectly valid saved subject id is often absent from it — its name lost the dedup,
    // or its course was deleted. Radix renders a value with no matching item as the empty
    // placeholder, which is what made an already-chosen subject look unset on reopening
    // the wizard. Resolve the name and keep the saved id as an option of its own.
    const missingSubjectNames = useSubjectNamesByIds(
        unresolvedSubjectIds(instituteDetails?.subjects, [selectedSubjectId])
    );
    const subjectOptions = useMemo(() => {
        const options = SubjectFilterData.map((option, index) => ({
            value: option.id,
            label: convertCapitalToTitleCase(option.name),
            _id: index,
        }));
        if (selectedSubjectId && !options.some((option) => option.value === selectedSubjectId)) {
            const savedName = missingSubjectNames[selectedSubjectId];
            if (savedName) {
                options.push({
                    value: selectedSubjectId,
                    label: convertCapitalToTitleCase(savedName),
                    _id: options.length,
                });
            }
        }
        return options;
    }, [SubjectFilterData, selectedSubjectId, missingSubjectNames]);

    const assessmentName = watch('testCreation.assessmentName');
    const liveDateRangeStartDate = watch('testCreation.liveDateRange.startDate');
    const liveDateRangeEndDate = watch('testCreation.liveDateRange.endDate');
    const reattemptCount = watch('reattemptCount');

    const handleSubmitStep1Form = useMutation({
        mutationFn: ({
            data,
            assessmentId,
            instituteId,
            type,
        }: {
            data: z.infer<typeof BasicInfoFormSchema>;
            assessmentId: string | null | undefined;
            instituteId: string | undefined;
            type: string | undefined;
        }) => handlePostStep1Data(data, assessmentId, instituteId, type),
        onSuccess: async (data) => {
            if (assessmentId !== 'defaultId') {
                useBasicInfoStore.getState().reset();
                window.history.back();
                toast.success(t('toasts.updateSuccess'), {
                    className: 'success-toast',
                    duration: 2000,
                });
                queryClient.invalidateQueries({ queryKey: ['GET_ASSESSMENT_DETAILS'] });
            } else {
                setSavedAssessmentId(data.assessment_id);
                syncStep1DataWithStore(form);
                toast.success(t('toasts.saveSuccess'), {
                    className: 'success-toast',
                    duration: 2000,
                });
                handleCompleteCurrentStep();
            }
        },
        onError: (error: unknown) => {
            reportApiError(error, {
                feature: 'assessment-step1-basic-info',
                tags: { actionType: assessmentId !== 'defaultId' ? 'update' : 'create' },
                extra: { assessmentId, instituteId: instituteDetails?.id, examType },
                fallbackMessage: t('errors.saveFailed'),
            });
        },
    });

    const onSubmit = (data: z.infer<typeof BasicInfoFormSchema>) => {
        // The field already holds the subject *id*. It used to hold the name and be
        // converted here, which meant an unselected subject was posted as the literal
        // string "N/A" (448 assessments in production carry that as their subject_id),
        // and a selected one resolved through a name-deduplicated lookup whose winner
        // Postgres is free to change — after which the saved id no longer matched
        // anything and the subject read "N/A" again.
        const modifiedData = {
            ...data,
            testCreation: {
                ...data.testCreation,
                subject: data.testCreation.subject === 'N/A' ? '' : data.testCreation.subject,
            },
        };
        handleSubmitStep1Form.mutate({
            data: modifiedData,
            assessmentId: assessmentId !== 'defaultId' ? assessmentId : null,
            instituteId: instituteDetails?.id,
            type: examType,
        });
    };

    const onInvalid = (errors: unknown) => {
        // Name the failing rules. Several of this form's fields are hidden for
        // some assessment types, so "fix the highlighted fields" could point at
        // nothing on screen and the Update button just looked dead.
        const problems = flattenFormErrors(errors);
        const shown = problems.slice(0, 3).map((p) => p.message);
        toast.error(
            shown.length
                ? `${t('validation.cannotSave')}: ${shown.join(' · ')}`
                : t('validation.cannotSaveGeneric'),
            { className: 'error-toast', duration: 6000 }
        );
        const firstPath = problems[0]?.path;
        if (firstPath) {
            const target =
                document.querySelector(`[name="${firstPath}"]`) ??
                document.querySelector(`[name="${firstPath.split('.')[0]}"]`);
            target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    };

    const [assessmentDetails, setAssessmentDetails] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    // Bumped once the edit data is loaded and the form is reset, so the rich-text
    // editor remounts and initializes with the fetched instructions. Without this,
    // TipTap mounts empty (before the async fetch) and never picks up the value that
    // arrives via form.reset — so saved instructions look blank when editing.
    const [editorHydrationKey, setEditorHydrationKey] = useState(0);

    // The live-window card renders only when the backend declares either
    // boundation date for this assessment type (see the SectionCard below), and
    // SURVEY declares neither — AssessmentBasicDetail.getStepsForSurvey lists
    // only subject/visibility/expected-participants/reattempt. Demanding the
    // dates unconditionally therefore left "Next" permanently disabled on a new
    // survey, with nothing on screen to fill in. Require them only when they are
    // actually on screen. (The zod schema already treats both as optional.)
    // A survey renders both dates as OPTIONAL, an exam as REQUIRED. Gate the
    // "Next" rule on REQUIRED only — keying it off mere presence would make a
    // survey's optional dates mandatory again.
    const liveDateRule = (key: string) => getStepKey({ assessmentDetails, currentStep, key });
    const requiresLiveDateRange =
        liveDateRule('boundation_start_date') === 'REQUIRED' ||
        liveDateRule('boundation_end_date') === 'REQUIRED';

    // Determine if all fields are filled
    const isFormValid = isBasicInfoStepComplete({
        examType,
        isNewAssessment: assessmentId === 'defaultId',
        requiresLiveDateRange,
        assessmentName,
        liveDateRangeStartDate,
        liveDateRangeEndDate,
        reattemptCount,
        errorCount: Object.entries(form.formState.errors).length,
    });

    useEffect(() => {
        setIsLoading(true);
        const fetchAssessmentDetails = async () => {
            try {
                const response = await getAssessmentDetailsData({
                    assessmentId,
                    instituteId: instituteDetails?.id,
                    type: examType,
                });
                setAssessmentDetails(response);
            } catch (err) {
                // Handle error silently
            } finally {
                setIsLoading(false);
            }
        };

        fetchAssessmentDetails();
    }, [assessmentId, instituteDetails?.id, examType]);

    useEffect(() => {
        if (assessmentId !== 'defaultId') {
            setNavHeading(<NavigationHeader examType={examType} isUpdate={true} />);
        } else {
            setNavHeading(<NavigationHeader examType={examType} isUpdate={false} />);
        }
    }, [assessmentId, examType, setNavHeading]);

    // Helper function to get test creation data
    const getTestCreationData = () => {
        const savedData = assessmentDetails[currentStep]?.saved_data;

        return {
            assessmentName: savedData?.name || '',
            // Raw id: the select is keyed by id, so no name round-trip is needed.
            // A stored "N/A" is an older save with no real subject — treat it as empty
            // rather than feeding the sentinel back into the next update.
            subject:
                savedData?.subject_selection && savedData.subject_selection !== 'N/A'
                    ? savedData.subject_selection
                    : '',
            assessmentInstructions: savedData?.instructions?.content || '',
            // A mock/practice test has no live window (the server regenerates
            // "now until 9999" on every save), so the form carries none: a
            // stale one here can only fail the date rule behind a hidden field.
            liveDateRange: isOpenEndedExamType(examType)
                ? { startDate: '', endDate: '' }
                : {
                      startDate: convertDateFormat(savedData?.boundation_start_date || '') || '',
                      endDate: convertDateFormat(savedData?.boundation_end_date || '') || '',
                  },
        };
    };

    // Helper function to get assessment preview data
    const getAssessmentPreviewData = () => {
        const assessmentPreview = assessmentDetails[currentStep]?.saved_data?.assessment_preview;

        return {
            checked: (assessmentPreview ?? 0) > 0,
            previewTimeLimit: assessmentPreview !== undefined
                ? getTimeLimitString(assessmentPreview ?? 0, timeLimit)
                : timeLimit[0],
        };
    };

    // Helper function to get form reset data
    const getFormResetData = () => {
        const savedData = assessmentDetails[currentStep]?.saved_data;

        return {
            status: assessmentDetails[currentStep]?.status,
            testCreation: getTestCreationData(),
            assessmentPreview: getAssessmentPreviewData(),
            reattemptCount: String(savedData?.reattempt_count) || '1',
            submissionType: savedData?.submission_type || '',
            durationDistribution: savedData?.duration_distribution || '',
            evaluationType: savedData?.evaluation_type || '',
            aiEvaluationEnabled: savedData?.ai_evaluation_enabled ?? false,
            omrMode: savedData?.omr_mode === true,
            proctoring: proctoringFormFromWire(savedData?.proctoring_config),
            // 27 older exams carry no result_type; they are all AUTO-evaluated,
            // and preselecting MANUAL for them (the old fallback) flipped a working
            // exam to teacher-checked on any Step 1 edit.
            resultType: resultTypeForEdit(
                examType,
                savedData?.result_type ||
                    (savedData?.evaluation_type === 'MANUAL' ? 'MANUAL' : undefined)
            ),
            switchSections: savedData?.can_switch_section,
            raiseReattemptRequest: savedData?.reattempt_consent,
            raiseTimeIncreaseRequest: savedData?.add_time_consent,
        };
    };

    useEffect(() => {
        if (assessmentId !== 'defaultId') {
            const formData = getFormResetData();
            form.reset(formData);
            // Remount the rich-text editor so it re-initializes with the freshly
            // loaded instructions (TipTap only reads `content` on mount).
            setEditorHydrationKey((k) => k + 1);
        }
    }, [assessmentDetails, currentStep, instituteDetails?.subjects, assessmentId]);

    // Exams created through the AI Evaluation API keep their result type (Manual):
    // the API owns release (finalize), and the server refuses a change for
    // source = 'API'. Absent on older payloads, so dashboard exams are unaffected.
    const isApiManaged = isApiSourced(assessmentDetails[currentStep]?.saved_data?.source);

    if (isLoading || handleSubmitStep1Form.status === 'pending') return <DashboardLoader />;

    return (
        <FormProvider {...form}>
            <form>
                <div className="m-0 flex items-center justify-between p-0">
                    <div>
                        <h1>{t('header.title')}</h1>
                        <p className="mt-1 text-sm text-muted-foreground">
                            {t('header.description')}
                        </p>
                    </div>
                    <MyButton
                        type="button"
                        scale="large"
                        buttonType="primary"
                        disable={assessmentId === 'defaultId' ? !isFormValid : false}
                        onClick={handleSubmit(onSubmit, onInvalid)}
                    >
                        {assessmentId !== 'defaultId' ? t('header.updateButton') : t('header.nextButton')}
                    </MyButton>
                </div>
                <Separator className="my-4" />
                <div className="flex flex-col gap-5">
                    <SectionCard
                        icon={Info}
                        title={
                            examType === 'SURVEY'
                                ? t('basicInfoSection.titleSurvey')
                                : t('basicInfoSection.titleAssessment')
                        }
                        description={t('basicInfoSection.description')}
                    >
                        <div
                            className="flex flex-wrap items-start gap-4"
                            id={'assessment-details'}
                        >
                            <FormField
                                control={control}
                                name="testCreation.assessmentName"
                                render={({ field: { ...field } }) => (
                                    <FormItem className="w-full sm:w-80">
                                        <FormControl>
                                            <MyInput
                                                inputType="text"
                                                inputPlaceholder={t('basicInfoSection.titlePlaceholder')}
                                                input={field.value}
                                                labelStyle="font-thin"
                                                onChangeFunction={field.onChange}
                                                error={
                                                    form.formState.errors.testCreation
                                                        ?.assessmentName?.message
                                                }
                                                required={true}
                                                size="large"
                                                label={
                                                    examType === 'SURVEY'
                                                        ? t('basicInfoSection.nameLabelSurvey')
                                                        : t('basicInfoSection.nameLabelAssessment')
                                                }
                                                {...field}
                                                className="!w-full"
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                            <div className="w-full sm:w-72">
                                <SelectField
                                    label={getTerminology(
                                        ContentTerms.Subjects,
                                        SystemTerms.Subjects
                                    )}
                                    name="testCreation.subject"
                                    labelStyle="font-thin"
                                    options={subjectOptions}
                                    control={form.control}
                                    className="!w-full font-thin"
                                />
                            </div>
                        </div>
                        <div className="flex flex-col gap-2" id="assessment-instructions">
                            <label className="text-sm font-medium text-slate-700">
                                {examType === 'SURVEY'
                                    ? t('basicInfoSection.instructionsLabelSurvey')
                                    : t('basicInfoSection.instructionsLabelAssessment')}
                            </label>
                            <FormField
                                control={control}
                                name="testCreation.assessmentInstructions"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormControl>
                                            <RichTextEditor
                                                key={`assessment-instructions-${editorHydrationKey}`}
                                                onChange={field.onChange}
                                                onBlur={field.onBlur}
                                                value={field.value}
                                                placeholder={
                                                    examType === 'SURVEY'
                                                        ? t(
                                                              'basicInfoSection.instructionsPlaceholderSurvey'
                                                          )
                                                        : t(
                                                              'basicInfoSection.instructionsPlaceholderAssessment'
                                                          )
                                                }
                                                minHeight={160}
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                        </div>
                    </SectionCard>

                    {(getStepKey({
                        assessmentDetails,
                        currentStep,
                        key: 'boundation_start_date',
                    }) ||
                        getStepKey({
                            assessmentDetails,
                            currentStep,
                            key: 'boundation_end_date',
                        })) && (
                        <SectionCard
                            icon={CalendarBlank}
                            title={t('liveDateRangeSection.title')}
                            description={t('liveDateRangeSection.description')}
                        >
                            <div
                                className="flex flex-wrap items-start gap-4"
                                id="date-range"
                            >
                                {getStepKey({
                                    assessmentDetails,
                                    currentStep,
                                    key: 'boundation_start_date',
                                }) && (
                                    <FormField
                                        control={control}
                                        name="testCreation.liveDateRange.startDate"
                                        // onChange mode only re-validates the edited field;
                                        // the ordering error lives on endDate, so re-check it
                                        // too or it stays stale and keeps Next disabled.
                                        rules={{ deps: ['testCreation.liveDateRange.endDate'] }}
                                        render={({ field: { ...field } }) => (
                                            <FormItem className="w-full sm:w-72">
                                                <FormControl>
                                                    <MyInput
                                                        inputType="datetime-local"
                                                        input={field.value}
                                                        onChangeFunction={field.onChange}
                                                        error={
                                                            form.formState.errors.testCreation
                                                                ?.liveDateRange?.startDate?.message
                                                        }
                                                        required={
                                                            getStepKey({
                                                                assessmentDetails,
                                                                currentStep,
                                                                key: 'boundation_start_date',
                                                            }) === 'REQUIRED'
                                                        }
                                                        size="large"
                                                        label={t('liveDateRangeSection.startDateLabel')}
                                                        labelStyle="font-thin"
                                                        {...field}
                                                        className="!w-full"
                                                    />
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
                                )}
                                {getStepKey({
                                    assessmentDetails,
                                    currentStep,
                                    key: 'boundation_end_date',
                                }) && (
                                    <FormField
                                        control={control}
                                        name="testCreation.liveDateRange.endDate"
                                        render={({ field: { ...field } }) => (
                                            <FormItem className="w-full sm:w-72">
                                                <FormControl>
                                                    <MyInput
                                                        inputType="datetime-local"
                                                        input={field.value}
                                                        onChangeFunction={field.onChange}
                                                        error={
                                                            form.formState.errors.testCreation
                                                                ?.liveDateRange?.endDate?.message
                                                        }
                                                        required={
                                                            getStepKey({
                                                                assessmentDetails,
                                                                currentStep,
                                                                key: 'boundation_end_date',
                                                            }) === 'REQUIRED'
                                                        }
                                                        size="large"
                                                        label={t('liveDateRangeSection.endDateLabel')}
                                                        labelStyle="font-thin"
                                                        {...field}
                                                        className="!w-full"
                                                    />
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
                                )}
                            </div>
                        </SectionCard>
                    )}

                    <SectionCard
                        icon={Gear}
                        title={t('attemptSettingsSection.title')}
                        description={t('attemptSettingsSection.description')}
                    >
                    {(examType === 'EXAM' || examType === 'SURVEY') && (
                        <FormField
                            control={control}
                            name="reattemptCount"
                            render={({ field: { ...field } }) => (
                                <FormItem>
                                    <FormControl>
                                        <MyInput
                                            inputType="number"
                                            inputPlaceholder={t(
                                                'attemptSettingsSection.reattemptCountPlaceholder'
                                            )}
                                            input={field.value}
                                            labelStyle="text-xs"
                                            onChangeFunction={field.onChange}
                                            error={form.formState.errors?.reattemptCount?.message}
                                            required={true}
                                            size="large"
                                            label={t('attemptSettingsSection.reattemptCountLabel')}
                                            {...field}
                                            min={0}
                                            onKeyDown={(e) => {
                                                if (e.key === '-' || e.key === 'e') {
                                                    e.preventDefault();
                                                }
                                            }}
                                        />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                    )}
                    {showsResultReleaseSettings(examType) && (
                    <div className="flex flex-col gap-6" id="evaluation-type">
                        <div className="flex flex-col gap-3">
                            <p className="text-sm font-medium">
                                {t('attemptSettingsSection.resultEvaluationType.label')}
                                <span className="ml-0.5 text-danger-500">*</span>
                            </p>
                            {isApiManaged && <ManagedByApiNote />}
                            <FormField
                                control={form.control}
                                name="resultType"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormControl>
                                            <RadioGroup
                                                value={field.value}
                                                onValueChange={field.onChange}
                                                disabled={isApiManaged}
                                                className="flex flex-col gap-3"
                                            >
                                                {[
                                                    {
                                                        value: 'AUTO_AFTER_SUBMISSION',
                                                        label: t(
                                                            'attemptSettingsSection.resultEvaluationType.options.autoAfterSubmission.label'
                                                        ),
                                                        help: t(
                                                            'attemptSettingsSection.resultEvaluationType.options.autoAfterSubmission.help'
                                                        ),
                                                    },
                                                    {
                                                        value: 'AUTO_AFTER_ASSESSMENT_END',
                                                        label: t(
                                                            'attemptSettingsSection.resultEvaluationType.options.autoAfterAssessmentEnd.label'
                                                        ),
                                                        help: t(
                                                            'attemptSettingsSection.resultEvaluationType.options.autoAfterAssessmentEnd.help'
                                                        ),
                                                    },
                                                    {
                                                        value: 'NO_AUTO_RELEASE',
                                                        label: t(
                                                            'attemptSettingsSection.resultEvaluationType.options.noAutoRelease.label'
                                                        ),
                                                        help: t(
                                                            'attemptSettingsSection.resultEvaluationType.options.noAutoRelease.help'
                                                        ),
                                                    },
                                                    {
                                                        value: 'MANUAL',
                                                        label: t(
                                                            'attemptSettingsSection.resultEvaluationType.options.manual.label'
                                                        ),
                                                        help: t(
                                                            'attemptSettingsSection.resultEvaluationType.options.manual.help'
                                                        ),
                                                    },
                                                ]
                                                    // A mock/practice test never ends, so "after the
                                                    // assessment ends" would mean never: not offered.
                                                    .filter(
                                                        (option) =>
                                                            !(
                                                                isOpenEndedExamType(examType) &&
                                                                option.value ===
                                                                    'AUTO_AFTER_ASSESSMENT_END'
                                                            )
                                                    )
                                                    .map((option) => (
                                                    <label
                                                        key={option.value}
                                                        className={resultTypeOptionClass(field.value === option.value, isApiManaged)}
                                                    >
                                                        <RadioGroupItem
                                                            value={option.value}
                                                            className="mt-0.5 shrink-0"
                                                        />
                                                        <div className="flex flex-col gap-0.5">
                                                            <span className="text-sm font-medium text-neutral-800">
                                                                {option.label}
                                                            </span>
                                                            <span className="text-xs text-neutral-500">
                                                                {option.help}
                                                            </span>
                                                        </div>
                                                    </label>
                                                ))}
                                            </RadioGroup>
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>
                        {watch('resultType') === 'MANUAL' &&
                            getStepKey({
                                assessmentDetails,
                                currentStep,
                                key: 'submission_type',
                            }) && (
                                <div>
                                    <SelectField
                                        label={t('attemptSettingsSection.submissionType.label')}
                                        name="submissionType"
                                        options={
                                            assessmentDetails[
                                                currentStep
                                            ]?.field_options?.submission_type?.map(
                                                (distribution: any, index: number) => ({
                                                    value: distribution.value,
                                                    label: distribution.value,
                                                    _id: index,
                                                })
                                            ) || []
                                        }
                                        control={form.control}
                                        className="w-56 font-thin"
                                        required={
                                            getStepKey({
                                                assessmentDetails,
                                                currentStep,
                                                key: 'submission_type',
                                            }) === 'REQUIRED'
                                        }
                                    />
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        {t('attemptSettingsSection.submissionType.helper')}
                                    </p>
                                </div>
                            )}
                    </div>
                    )}

                    <div className="flex flex-col gap-6" id="attempt-settings">
                        {/*
                          * Automatic AI evaluation. Deliberately OFF by default and shown
                          * with its cost stated: every submission that this grades charges
                          * institute credits per question, so it must be a decision someone
                          * made, not something that happens because a default said so.
                          */}
                        <FormField
                            control={form.control}
                            name="aiEvaluationEnabled"
                            render={({ field }) => (
                                <FormItem className="flex items-start justify-between gap-4 space-y-0 rounded-lg border border-slate-200 bg-white p-4 transition-colors hover:border-primary-200 hover:bg-primary-50/20">
                                    <div className="flex items-start gap-3">
                                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary-50 text-primary-500">
                                            <Sparkle className="h-4 w-4" />
                                        </div>
                                        <div className="flex flex-col">
                                            <FormLabel className="text-sm font-semibold text-slate-900">
                                                {t('attemptSettingsSection.aiEvaluation.label')}
                                            </FormLabel>
                                            <span className="text-xs text-slate-500">
                                                {t('attemptSettingsSection.aiEvaluation.description')}
                                            </span>
                                        </div>
                                    </div>
                                    <FormControl>
                                        <Switch
                                            checked={field.value}
                                            onCheckedChange={field.onChange}
                                        />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                        {/*
                          * OMR sheet (pen & paper) mode: learners answer on a printed
                          * bubble sheet that is scanned and graded here. Surveys are not
                          * graded, so they never get it.
                          */}
                        {examType !== 'SURVEY' && (
                            <FormField
                                control={form.control}
                                name="omrMode"
                                render={({ field }) => (
                                    <FormItem className="flex items-start justify-between gap-4 space-y-0 rounded-lg border border-slate-200 bg-white p-4 transition-colors hover:border-primary-200 hover:bg-primary-50/20">
                                        <div className="flex items-start gap-3">
                                            <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary-50 text-primary-500">
                                                <ListChecks className="size-4" />
                                            </div>
                                            <div className="flex flex-col">
                                                <FormLabel className="text-sm font-semibold text-slate-900">
                                                    {t('attemptSettingsSection.omrMode.label')}
                                                </FormLabel>
                                                <span className="text-xs text-slate-500">
                                                    {t('attemptSettingsSection.omrMode.description')}
                                                </span>
                                            </div>
                                        </div>
                                        <FormControl>
                                            <Switch
                                                checked={field.value}
                                                onCheckedChange={field.onChange}
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                        )}
                        {/* Surveys have nothing to cheat on. */}
                        {examType !== 'SURVEY' && <ProctoringSettingsCard control={form.control} />}
                        {getStepKey({
                            assessmentDetails,
                            currentStep,
                            key: 'assessment_preview',
                        }) && (
                            <FormField
                                control={form.control}
                                name="assessmentPreview.checked"
                                render={({ field }) => (
                                    <FormItem className="flex items-start justify-between gap-4 rounded-lg border border-slate-200 bg-white p-4 transition-colors hover:border-primary-200 hover:bg-primary-50/20 space-y-0">
                                        <div className="flex items-start gap-3">
                                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary-50 text-primary-500">
                                                <Eye className="h-4 w-4" />
                                            </div>
                                            <div className="flex flex-col">
                                                <FormLabel className="text-sm font-semibold text-slate-900">
                                                    {examType === 'SURVEY'
                                                        ? t(
                                                              'attemptSettingsSection.assessmentPreview.labelSurvey'
                                                          )
                                                        : t(
                                                              'attemptSettingsSection.assessmentPreview.labelAssessment'
                                                          )}
                                                    {getStepKey({
                                                        assessmentDetails,
                                                        currentStep,
                                                        key: 'assessment_preview',
                                                    }) === 'REQUIRED' && (
                                                        <span className="ml-0.5 text-danger-600">
                                                            *
                                                        </span>
                                                    )}
                                                </FormLabel>
                                                <span className="text-xs text-slate-500">
                                                    {t(
                                                        'attemptSettingsSection.assessmentPreview.description'
                                                    )}
                                                </span>
                                            </div>
                                        </div>
                                        <FormControl>
                                            <Switch
                                                checked={field.value}
                                                onCheckedChange={field.onChange}
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                        )}
                        {watch('assessmentPreview.checked') && examType !== 'SURVEY' && (
                            <SelectField
                                label={t('attemptSettingsSection.assessmentPreview.timeLimitLabel')}
                                labelStyle="font-thin"
                                name="assessmentPreview.previewTimeLimit"
                                options={timeLimit.map((option, index) => ({
                                    value: option,
                                    label: option,
                                    _id: index,
                                }))}
                                control={form.control}
                                required
                                className="w-56 font-thin"
                            />
                        )}
                        {getStepKey({
                            assessmentDetails,
                            currentStep,
                            key: 'can_switch_section',
                        }) && (
                            <FormField
                                control={form.control}
                                name="switchSections"
                                render={({ field }) => (
                                    <FormItem className="flex items-start justify-between gap-4 rounded-lg border border-slate-200 bg-white p-4 transition-colors hover:border-primary-200 hover:bg-primary-50/20 space-y-0">
                                        <div className="flex items-start gap-3">
                                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary-50 text-primary-500">
                                                <ArrowsLeftRight className="h-4 w-4" />
                                            </div>
                                            <div className="flex flex-col">
                                                <FormLabel className="text-sm font-semibold text-slate-900">
                                                    {t('attemptSettingsSection.switchSections.label', {
                                                        role: getTerminology(
                                                            RoleTerms.Learner,
                                                            SystemTerms.Learner
                                                        ).toLocaleLowerCase(),
                                                    })}
                                                    {getStepKey({
                                                        assessmentDetails,
                                                        currentStep,
                                                        key: 'can_switch_section',
                                                    }) === 'REQUIRED' && (
                                                        <span className="ml-0.5 text-danger-600">
                                                            *
                                                        </span>
                                                    )}
                                                </FormLabel>
                                                <span className="text-xs text-slate-500">
                                                    {t(
                                                        'attemptSettingsSection.switchSections.description'
                                                    )}
                                                </span>
                                            </div>
                                        </div>
                                        <FormControl>
                                            <Switch
                                                checked={field.value}
                                                onCheckedChange={field.onChange}
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                        )}
                        {/* will be adding this later
                        {getStepKey({
                            assessmentDetails,
                            currentStep,
                            key: "reattempt_consent",
                        }) && (
                            <FormField
                                control={form.control}
                                name="raiseReattemptRequest"
                                render={({ field }) => (
                                    <FormItem className="flex w-1/2 items-center justify-between">
                                        <FormLabel>
                                            Allow students to raise reattempt request
                                            {getStepKey({
                                                assessmentDetails,
                                                currentStep,
                                                key: "reattempt_consent",
                                            }) === "REQUIRED" && (
                                                <span className="text-subtitle text-danger-600">
                                                    *
                                                </span>
                                            )}
                                        </FormLabel>
                                        <FormControl>
                                            <Switch
                                                checked={field.value}
                                                onCheckedChange={field.onChange}
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                        )}
                        {getStepKey({
                            assessmentDetails,
                            currentStep,
                            key: "add_time_consent",
                        }) && (
                            <FormField
                                control={form.control}
                                name="raiseTimeIncreaseRequest"
                                render={({ field }) => (
                                    <FormItem className="flex w-1/2 items-center justify-between">
                                        <FormLabel>
                                            Allow students to raise time increase request
                                            {getStepKey({
                                                assessmentDetails,
                                                currentStep,
                                                key: "add_time_consent",
                                            }) === "REQUIRED" && (
                                                <span className="text-subtitle text-danger-600">
                                                    *
                                                </span>
                                            )}
                                        </FormLabel>
                                        <FormControl>
                                            <Switch
                                                checked={field.value}
                                                onCheckedChange={field.onChange}
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                        )} */}
                    </div>
                    </SectionCard>
                </div>
            </form>
        </FormProvider>
    );
};

export default Step1BasicInfo;
