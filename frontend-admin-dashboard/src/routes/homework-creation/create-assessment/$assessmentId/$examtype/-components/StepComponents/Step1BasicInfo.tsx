import { MyButton } from '@/components/design-system/button';
import { Separator } from '@/components/ui/separator';
import { StepContentProps } from '@/types/assessments/step-content-props';
import { zodResolver } from '@hookform/resolvers/zod';
import React, { useEffect, useMemo } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { useFilterDataForAssesment } from '../../../../../assessment-list/-utils.ts/useFiltersData';
import { unresolvedSubjectIds, useSubjectNamesByIds } from '@/services/subject-names';
import { FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form';
import { MyInput } from '@/components/design-system/input';
import SelectField from '@/components/design-system/select-field';
import { Switch } from '@/components/ui/switch';
import { timeLimit } from '@/constants/dummy-data';
import {
    buildBasicInfoFormSchema,
    type BasicInfoFormSchemaType,
} from '../../-utils/basic-info-form-schema';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { getAssessmentDetails, handlePostStep1Data } from '../../-services/assessment-services';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { getStepKey, getTimeLimitString, syncStep1DataWithStore } from '../../-utils/helper';
import { RichTextEditor } from '@/components/editor/RichTextEditor';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import { useSavedAssessmentStore } from '../../-utils/global-states';
import { useBasicInfoStore } from '../../-utils/zustand-global-states/step1-basic-info';
import { toast } from 'sonner';
import { reportApiError } from '@/lib/report-api-error';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { CaretLeft } from '@phosphor-icons/react';
import { useParams } from '@tanstack/react-router';
import useIntroJsTour, { Step } from '@/hooks/use-intro';
import { IntroKey } from '@/constants/storage/introKey';
import { createAssesmentSteps } from '@/constants/intro/steps';
import { useSectionDetailsStore } from '../../-utils/zustand-global-states/step2-add-questions';
import { useTestAccessStore } from '../../-utils/zustand-global-states/step3-adding-participants';
import { useAccessControlStore } from '../../-utils/zustand-global-states/step4-access-control';
import { ContentTerms, RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

export function convertDateFormat(dateStr: string) {
    if (!dateStr) return '';

    // Backend sends timestamps as UTC but sometimes omits the trailing 'Z'.
    // `new Date("2026-07-11T12:37:00")` without a zone marker is parsed as
    // *local* time by browsers, silently shifting the instant. Force UTC
    // interpretation when no zone marker is present.
    const hasTimezone = /Z$|[+-]\d{2}:?\d{2}$/i.test(dateStr);
    const normalized = hasTimezone ? dateStr : `${dateStr.replace(' ', 'T')}Z`;
    const date = new Date(normalized);
    if (isNaN(date.getTime())) return '';
    // "Open until 9999-12-31 UTC" is the year 10000 east of Greenwich - a value
    // no datetime-local input can hold. It means "never closes", not a date.
    if (date.getFullYear() >= 9000) return '';

    // Emit LOCAL wall-clock components for the datetime-local input, which
    // interprets its value as local time. Using toISOString() here would leak
    // UTC digits into the form, shifting the shown time by the TZ offset and
    // corrupting the stored instant on re-save.
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const buildHeading = (t: TFunction) => (
    <div className="flex items-center gap-4">
        <CaretLeft
            onClick={() => {
                useBasicInfoStore.getState().reset();
                useSectionDetailsStore.getState().reset();
                useTestAccessStore.getState().reset();
                useAccessControlStore.getState().reset();
                window.history.back();
            }}
            className="cursor-pointer"
        />
        <h1 className="text-lg">{t('heading.createHomework')}</h1>
    </div>
);

const buildHeadingUpdate = (t: TFunction) => (
    <div className="flex items-center gap-4">
        <CaretLeft
            onClick={() => {
                useBasicInfoStore.getState().reset();
                useSectionDetailsStore.getState().reset();
                useTestAccessStore.getState().reset();
                useAccessControlStore.getState().reset();
                window.history.back();
            }}
            className="cursor-pointer"
        />
        <h1 className="text-lg">{t('heading.updateHomework')}</h1>
    </div>
);

const Step1BasicInfo: React.FC<StepContentProps> = ({
    currentStep,
    handleCompleteCurrentStep,
    completedSteps,
}) => {
    const { t } = useTranslation([
        'homeworkCreationStep1BasicInfo',
        'homeworkCreationBasicInfoFormSchema',
    ]);
    const basicInfoFormSchema = buildBasicInfoFormSchema(t);
    const queryClient = useQueryClient();
    const params = useParams({ strict: false });
    const examType = params.examtype;
    const assessmentId = params.assessmentId;
    const { setNavHeading } = useNavHeadingStore();
    const storeDataStep1 = useBasicInfoStore((state) => state);
    const { setSavedAssessmentId } = useSavedAssessmentStore();
    const { data: instituteDetails } = useSuspenseQuery(useInstituteQuery());
    const { data: assessmentDetails, isLoading } = useSuspenseQuery(
        getAssessmentDetails({
            assessmentId: assessmentId !== 'defaultId' ? assessmentId : null,
            instituteId: instituteDetails?.id,
            type: examType,
        })
    );
    const { SubjectFilterData } = useFilterDataForAssesment(instituteDetails);

    const form = useForm<BasicInfoFormSchemaType>({
        resolver: zodResolver(basicInfoFormSchema),
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
                checked: storeDataStep1.assessmentPreview?.checked || true, // Default to true
                previewTimeLimit:
                    storeDataStep1.assessmentPreview?.previewTimeLimit || timeLimit[0], // Default preview time
            },
            reattemptCount: storeDataStep1.reattemptCount || '1',
            submissionType: storeDataStep1.submissionType || '',
            durationDistribution: storeDataStep1.durationDistribution || '',
            evaluationType: storeDataStep1.evaluationType || '',
            switchSections: storeDataStep1.switchSections || true, // Default to false
            raiseReattemptRequest: storeDataStep1.raiseReattemptRequest || true, // Default to true
            raiseTimeIncreaseRequest: storeDataStep1.raiseTimeIncreaseRequest || true, // Default to false
        },
        mode: 'onChange', // Validate as user types
    });

    const { handleSubmit, control, watch } = form;

    // The dropdown comes from a list admin_core deduplicates by subject name, so a
    // perfectly valid saved subject id is often absent from it — its name lost the dedup,
    // or its course was deleted. Radix renders a value with no matching item as the empty
    // placeholder, which is what made an already-chosen subject look unset on reopening
    // the wizard. Resolve the name and keep the saved id as an option of its own.
    const selectedSubjectId = watch('testCreation.subject');
    const missingSubjectNames = useSubjectNamesByIds(
        unresolvedSubjectIds(instituteDetails?.subjects, [selectedSubjectId])
    );
    const subjectOptions = useMemo(() => {
        const options = SubjectFilterData.map((option, index) => ({
            value: option.id,
            label: option.name,
            _id: index,
        }));
        if (selectedSubjectId && !options.some((option) => option.value === selectedSubjectId)) {
            const savedName = missingSubjectNames[selectedSubjectId];
            if (savedName) {
                options.push({ value: selectedSubjectId, label: savedName, _id: options.length });
            }
        }
        return options;
    }, [SubjectFilterData, selectedSubjectId, missingSubjectNames]);

    // Watch form fields
    const assessmentName = watch('testCreation.assessmentName');
    const liveDateRangeStartDate = watch('testCreation.liveDateRange.startDate');
    const liveDateRangeEndDate = watch('testCreation.liveDateRange.endDate');
    const reattemptCount = watch('reattemptCount');

    // Determine if all fields are filled
    const isFormValid =
        (examType === 'EXAM' || examType === 'SURVEY') && assessmentId === 'defaultId'
            ? !!assessmentName &&
              !!liveDateRangeStartDate &&
              !!liveDateRangeEndDate &&
              !!Number(reattemptCount) &&
              Object.entries(form.formState.errors).length === 0
            : !!assessmentName && Object.entries(form.formState.errors).length === 0;

    const handleSubmitStep1Form = useMutation({
        mutationFn: ({
            data,
            assessmentId,
            instituteId,
            type,
        }: {
            data: BasicInfoFormSchemaType;
            assessmentId: string | null | undefined;
            instituteId: string | undefined;
            type: string | undefined;
        }) => handlePostStep1Data(data, assessmentId, instituteId, type),
        onSuccess: async (data) => {
            if (assessmentId !== 'defaultId') {
                useBasicInfoStore.getState().reset();
                window.history.back();
                toast.success(t('toast.updateSuccess'), {
                    className: 'success-toast',
                    duration: 2000,
                });
                queryClient.invalidateQueries({ queryKey: ['GET_ASSESSMENT_DETAILS'] });
            } else {
                setSavedAssessmentId(data.assessment_id);
                syncStep1DataWithStore(form);
                toast.success(t('toast.saveSuccess'), {
                    className: 'success-toast',
                    duration: 2000,
                });
                handleCompleteCurrentStep();
            }
        },
        onError: (error: unknown) => {
            reportApiError(error, {
                feature: 'homework-step1-basic-info',
                tags: { actionType: assessmentId !== 'defaultId' ? 'update' : 'create' },
                extra: { assessmentId, instituteId: instituteDetails?.id, examType },
                fallbackMessage: t('errors.saveFailed'),
            });
        },
    });

    const onSubmit = (data: BasicInfoFormSchemaType) => {
        const modifiedData = {
            ...data,
            testCreation: {
                ...data.testCreation,
                // The field holds the subject *id*. It used to hold the name and be
                // converted here, which posted the literal string "N/A" whenever nothing
                // was selected and, when something was, resolved through a
                // name-deduplicated lookup whose winner Postgres may change at any time.
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

    const onInvalid = (err: unknown) => {
        console.log(err);
    };

    useIntroJsTour({
        key: IntroKey.assessmentStep1BasicInfo,
        steps: createAssesmentSteps
            .filter((step) => step.element === '#basic-info')
            .flatMap((step) => step.subStep || [])
            .filter((subStep): subStep is Step => subStep !== undefined),
    });

    useEffect(() => {
        if (assessmentId !== 'defaultId') {
            setNavHeading(buildHeadingUpdate(t));
        } else {
            setNavHeading(buildHeading(t));
        }
    }, []);

    useEffect(() => {
        if (assessmentId !== 'defaultId') {
            form.reset({
                status: assessmentDetails[currentStep]?.status,
                testCreation: {
                    assessmentName: assessmentDetails[currentStep]?.saved_data?.name || '',
                    subject:
                        assessmentDetails[currentStep]?.saved_data?.subject_selection &&
                        assessmentDetails[currentStep]?.saved_data?.subject_selection !== 'N/A'
                            ? assessmentDetails[currentStep]?.saved_data?.subject_selection
                            : '',
                    assessmentInstructions:
                        assessmentDetails[currentStep]?.saved_data?.instructions.content || '',
                    liveDateRange: {
                        startDate:
                            convertDateFormat(
                                assessmentDetails[currentStep]?.saved_data?.boundation_start_date ||
                                    ''
                            ) || '',
                        endDate:
                            convertDateFormat(
                                assessmentDetails[currentStep]?.saved_data?.boundation_end_date ||
                                    ''
                            ) || '',
                    },
                },
                assessmentPreview: {
                    checked:
                        (assessmentDetails[currentStep]?.saved_data?.assessment_preview ?? 0) > 0
                            ? true
                            : false, // Default to false if undefined or 0
                    previewTimeLimit:
                        assessmentDetails[currentStep]?.saved_data?.assessment_preview !== undefined
                            ? getTimeLimitString(
                                  assessmentDetails[currentStep]?.saved_data?.assessment_preview ??
                                      0, // Default to 0 if undefined
                                  timeLimit
                              )
                            : timeLimit[0], // Default preview time
                },
                reattemptCount:
                    String(assessmentDetails[currentStep]?.saved_data?.reattempt_count) || '1',
                submissionType: assessmentDetails[currentStep]?.saved_data?.submission_type || '',
                durationDistribution:
                    assessmentDetails[currentStep]?.saved_data?.duration_distribution || '',
                evaluationType: assessmentDetails[currentStep]?.saved_data?.evaluation_type || '',
                switchSections: assessmentDetails[currentStep]?.saved_data?.can_switch_section, // Default to false
                raiseReattemptRequest:
                    assessmentDetails[currentStep]?.saved_data?.reattempt_consent, // Default to true
                raiseTimeIncreaseRequest:
                    assessmentDetails[currentStep]?.saved_data?.add_time_consent, // Default to false
            });
        }
    }, []);

    if (isLoading || handleSubmitStep1Form.status === 'pending') return <DashboardLoader />;

    return (
        <FormProvider {...form}>
            <form>
                <div className="m-0 flex items-center justify-between p-0">
                    <h1>{t('page.title')}</h1>
                    <MyButton
                        type="button"
                        scale="large"
                        buttonType="primary"
                        disable={assessmentId === 'defaultId' ? !isFormValid : false}
                        onClick={handleSubmit(onSubmit, onInvalid)}
                    >
                        {assessmentId !== 'defaultId' ? t('page.updateButton') : t('page.nextButton')}
                    </MyButton>
                </div>
                <Separator className="my-4" />
                <div className="flex flex-col gap-6">
                    <div className="flex w-full items-start gap-4">
                        <FormField
                            control={control}
                            name="testCreation.assessmentName"
                            render={({ field: { ...field } }) => (
                                <FormItem>
                                    <FormControl>
                                        <MyInput
                                            inputType="text"
                                            inputPlaceholder={t('fields.assessmentName.placeholder')}
                                            input={field.value}
                                            labelStyle="font-thin"
                                            onChangeFunction={field.onChange}
                                            error={
                                                form.formState.errors.testCreation?.assessmentName
                                                    ?.message
                                            }
                                            required={true}
                                            size="large"
                                            label={t('fields.assessmentName.label')}
                                            {...field}
                                        />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                        {getStepKey({
                            assessmentDetails,
                            currentStep,
                            key: 'subject_selection',
                        }) && (
                            <SelectField
                                label={getTerminology(ContentTerms.Subjects, SystemTerms.Subjects)}
                                name="testCreation.subject"
                                labelStyle="font-thin"
                                options={subjectOptions}
                                control={form.control}
                                className="mt-2 w-56 font-thin"
                                required={
                                    getStepKey({
                                        assessmentDetails,
                                        currentStep,
                                        key: 'subject_selection',
                                    }) === 'REQUIRED'
                                }
                            />
                        )}
                    </div>
                    <div className="flex flex-col gap-6" id="assessment-instructions">
                        <h1 className="-mb-5 font-thin">
                            {t('fields.assessmentInstructions.sectionTitle')}
                        </h1>
                        <FormField
                            control={control}
                            name="testCreation.assessmentInstructions"
                            render={({ field }) => (
                                <FormItem>
                                    <FormControl>
                                        <RichTextEditor
                                            onChange={field.onChange}
                                            onBlur={field.onBlur}
                                            value={field.value}
                                            placeholder={t('fields.assessmentInstructions.placeholder')}
                                            minHeight={160}
                                        />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                    </div>

                    {getStepKey({
                        assessmentDetails,
                        currentStep,
                        key: 'boundation_start_date',
                    }) &&
                        getStepKey({
                            assessmentDetails,
                            currentStep,
                            key: 'boundation_end_date',
                        }) && <h1>{t('fields.liveDateRange.sectionTitle')}</h1>}
                    <div className="-mt-2 flex items-start gap-4" id="date-range">
                        {getStepKey({
                            assessmentDetails,
                            currentStep,
                            key: 'boundation_start_date',
                        }) && (
                            <FormField
                                control={control}
                                name="testCreation.liveDateRange.startDate"
                                render={({ field: { ...field } }) => (
                                    <FormItem>
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
                                                label={t('fields.liveDateRange.startDateLabel')}
                                                labelStyle="font-thin"
                                                {...field}
                                                className="w-full"
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
                                    <FormItem>
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
                                                label={t('fields.liveDateRange.endDateLabel')}
                                                labelStyle="font-thin"
                                                {...field}
                                                className="w-full"
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                        )}
                    </div>
                    <Separator />
                    <h1>{t('fields.attemptSettings.sectionTitle')}</h1>
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
                                                'fields.attemptSettings.reattemptCountPlaceholder'
                                            )}
                                            input={field.value}
                                            labelStyle="text-caption"
                                            onChangeFunction={field.onChange}
                                            error={form.formState.errors?.reattemptCount?.message}
                                            required={true}
                                            size="large"
                                            label={t('fields.attemptSettings.reattemptCountLabel')}
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
                    <div className="flex flex-col gap-6" id="evaluation-type">
                        {getStepKey({
                            assessmentDetails,
                            currentStep,
                            key: 'evaluation_type',
                        }) && (
                            <SelectField
                                label={t('fields.evaluationType.label')}
                                name="evaluationType"
                                options={
                                    assessmentDetails[
                                        currentStep
                                    ]?.field_options?.evaluation_type?.map(
                                        (distribution, index) => ({
                                            value: distribution.value,
                                            label: distribution.value,
                                            _id: index,
                                        })
                                    ) || [] // Fallback to an empty array if undefined
                                }
                                control={form.control}
                                className="w-56 font-thin"
                                required={
                                    getStepKey({
                                        assessmentDetails,
                                        currentStep,
                                        key: 'evaluation_type',
                                    }) === 'REQUIRED'
                                }
                            />
                        )}
                        {watch('evaluationType') === 'MANUAL' &&
                            getStepKey({
                                assessmentDetails,
                                currentStep,
                                key: 'submission_type',
                            }) && (
                                <SelectField
                                    label={t('fields.submissionType.label')}
                                    name="submissionType"
                                    options={
                                        assessmentDetails[
                                            currentStep
                                        ]?.field_options?.submission_type?.map(
                                            (distribution, index) => ({
                                                value: distribution.value,
                                                label: distribution.value,
                                                _id: index,
                                            })
                                        ) || [] // Fallback to an empty array if undefined
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
                            )}
                    </div>

                    <div className="flex flex-col gap-6" id="attempt-settings">
                        {getStepKey({
                            assessmentDetails,
                            currentStep,
                            key: 'assessment_preview',
                        }) && (
                            <FormField
                                control={form.control}
                                name="assessmentPreview.checked"
                                render={({ field }) => (
                                    <FormItem className="flex w-1/2 items-center justify-between">
                                        <FormLabel>
                                            {t('fields.assessmentPreview.allowLabel')}
                                            {getStepKey({
                                                assessmentDetails,
                                                currentStep,
                                                key: 'assessment_preview',
                                            }) === 'REQUIRED' && (
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
                        {watch('assessmentPreview.checked') && (
                            <SelectField
                                label={t('fields.assessmentPreview.previewTimeLimitLabel')}
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
                                    <FormItem className="flex w-1/2 items-center justify-between">
                                        <FormLabel>
                                            {t('fields.switchSections.label', {
                                                term: getTerminology(
                                                    RoleTerms.Learner,
                                                    SystemTerms.Learner
                                                ).toLocaleLowerCase(),
                                            })}
                                            {getStepKey({
                                                assessmentDetails,
                                                currentStep,
                                                key: 'can_switch_section',
                                            }) === 'REQUIRED' && (
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
                </div>
            </form>
        </FormProvider>
    );
};

export default Step1BasicInfo;
