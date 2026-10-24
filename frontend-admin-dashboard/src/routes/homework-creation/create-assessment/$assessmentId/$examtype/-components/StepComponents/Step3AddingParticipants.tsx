import { StepContentProps } from '@/types/assessments/step-content-props';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormProvider, useForm } from 'react-hook-form';
import { MyButton } from '@/components/design-system/button';
import {
    buildTestAccessSchema,
    type TestAccessFormValues,
} from '../../-utils/add-participants-schema';
import { Separator } from '@/components/ui/separator';
import { FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { MyInput } from '@/components/design-system/input';
import {
    Copy,
    DotsSixVertical,
    DownloadSimple,
    Plus,
    PencilSimple,
    TrashSimple,
} from '@phosphor-icons/react';
import QRCode from 'react-qr-code';
import {
    copyToClipboard,
    getAllSessions,
    convertToCustomFieldsData,
    getCustomFieldsWhileEditStep3,
    getStepKey,
    handleDownloadQRCode,
    syncStep3DataWithStore,
    transformAllBatchData,
    transformBatchData,
} from '../../-utils/helper';
import { Switch } from '@/components/ui/switch';
import {
    FormFieldRow,
    FormFieldRowHeader,
} from '@/components/common/custom-fields/FormFieldRow';
import { Checkbox } from '@/components/ui/checkbox';
import SelectField from '@/components/design-system/select-field';
import { timeLimit } from '@/constants/dummy-data';
import { AddingParticipantsTab } from '../AddingParticipantsTab';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import { getAssessmentJoinUrl } from '@/lib/learner-portal-url';
import { RichTextEditor } from '@/components/editor/RichTextEditor';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { getAssessmentDetails, handlePostStep3Data } from '../../-services/assessment-services';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { toast } from 'sonner';
import { reportApiError } from '@/lib/report-api-error';
import { useSavedAssessmentStore } from '../../-utils/global-states';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTestAccessStore } from '../../-utils/zustand-global-states/step3-adding-participants';
import { diffBaseForSave } from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-utils/step3-registration-fields';
import { useParams } from '@tanstack/react-router';
import useIntroJsTour, { Step } from '@/hooks/use-intro';
import { IntroKey } from '@/constants/storage/introKey';
import { createAssesmentSteps } from '@/constants/intro/steps';
import { convertDateFormat } from './Step1BasicInfo';
import { handleGetIndividualStudentList } from '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-services/assessment-details-services';
import { getInstituteId } from '@/constants/helper';
import { Step3ParticipantsListIndiviudalStudentInterface } from '@/types/assessments/student-questionwise-status';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { AddCustomFieldDialog as SharedAddCustomFieldDialog } from '@/components/common/custom-fields/AddCustomFieldDialog';
import type {
    CustomFieldConfig,
    DropdownOption,
} from '@/components/common/custom-fields/AddCustomFieldDialog';
import { CustomFieldRenderer } from '@/components/common/custom-fields/CustomFieldRenderer';
type TestAccessFormType = TestAccessFormValues;

const Step3AddingParticipants: React.FC<StepContentProps> = ({
    currentStep,
    handleCompleteCurrentStep,
    completedSteps,
}) => {
    const { t } = useTranslation('homeworkCreationStep3AddingParticipants');
    const { t: tHelper } = useTranslation('homeworkCreationCreateAssessmentHelper');
    const { t: tSchema } = useTranslation('homeworkCreationAddParticipantsSchema');
    const queryClient = useQueryClient();
    const params = useParams({ strict: false });
    const examType = params.examtype ?? '';
    const assessmentId = params.assessmentId ?? '';
    const instituteId = getInstituteId();
    const storeDataStep3 = useTestAccessStore((state) => state);
    const { savedAssessmentId } = useSavedAssessmentStore();

    const { data: instituteDetails } = useSuspenseQuery(useInstituteQuery());
    const { batches_for_sessions } = instituteDetails || {};
    const { data: assessmentDetails, isLoading } = useSuspenseQuery(
        getAssessmentDetails({
            assessmentId: assessmentId !== 'defaultId' ? assessmentId : savedAssessmentId,
            instituteId: instituteDetails?.id,
            type: examType,
        })
    );

    const sectionsInfo = getAllSessions(batches_for_sessions || []);

    const [selectedSection, setSelectedSection] = useState(sectionsInfo ? sectionsInfo[0]?.id : '');

    const [editingFieldId, setEditingFieldId] = useState<string | null>(null);

    // Extract batch IDs from preBatchData
    const batchIds = new Set(
        assessmentDetails[currentStep]?.saved_data.pre_batch_registrations.map(
            (batch) => batch.batchId
        )
    );

    // Filter matching batches
    const matchedBatches = batches_for_sessions?.filter((batch: any) => batchIds.has(batch.id));
    const transformedBatches =
        assessmentId !== 'defaultId'
            ? transformAllBatchData(matchedBatches || [])
            : transformBatchData(batches_for_sessions || [], selectedSection!);

    const oldFormData = useRef<TestAccessFormType | null>(null);

    const testAccessSchema = buildTestAccessSchema(tSchema);

    const form = useForm<TestAccessFormType>({
        resolver: zodResolver(testAccessSchema),
        defaultValues: {
            status: completedSteps[currentStep] ? 'COMPLETE' : 'INCOMPLETE',
            closed_test:
                storeDataStep3?.open_test?.checked ||
                assessmentDetails[0]?.saved_data?.assessment_visibility === 'PUBLIC'
                    ? false
                    : true,
            open_test: storeDataStep3?.open_test || {
                checked: false,
                start_date: '',
                end_date: '',
                instructions: '',
                custom_fields: [
                    {
                        id: '0',
                        type: 'textfield',
                        name: 'Full Name',
                        oldKey: true,
                        isRequired: true,
                        key: 'full_name',
                    },
                    {
                        id: '1',
                        type: 'textfield',
                        name: 'Email',
                        oldKey: true,
                        isRequired: true,
                        key: 'email',
                    },
                    {
                        id: '2',
                        type: 'textfield',
                        name: 'Phone Number',
                        oldKey: true,
                        isRequired: true,
                        key: 'phone_number',
                    },
                ],
            },
            select_batch: storeDataStep3?.select_batch || {
                checked: false,
                batch_details: {},
            },
            select_individually: storeDataStep3?.select_individually || {
                checked: false,
                student_details: [],
            },
            join_link:
                storeDataStep3?.join_link ||
                getAssessmentJoinUrl(
                    assessmentDetails[0]?.saved_data.assessment_url,
                    instituteDetails?.learner_portal_base_url
                ),
            show_leaderboard: storeDataStep3?.show_leaderboard || true,
            notify_student: storeDataStep3?.notify_student || {
                when_assessment_created: true,
                before_assessment_goes_live: {
                    checked: true,
                    value: '1 min',
                },
                when_assessment_live: true,
                when_assessment_report_generated: true,
            },
            notify_parent: storeDataStep3?.notify_parent || {
                when_assessment_created: true,
                before_assessment_goes_live: {
                    checked: true,
                    value: '1 min',
                },
                when_assessment_live: true,
                when_student_appears: true,
                when_student_finishes_test: true,
                when_assessment_report_generated: true,
            },
        },
        mode: 'onChange',
    });

    const { handleSubmit, getValues, control, watch, setValue } = form;
    const customFields = getValues('open_test.custom_fields');
    watch('open_test.custom_fields');

    /** The row whose pencil was clicked — drives the prefilled edit dialog. */
    const editingField = customFields?.find((field) => field.id === editingFieldId);

    const handleSubmitStep3Form = useMutation({
        mutationFn: ({
            oldFormData,
            data,
            assessmentId,
            instituteId,
            type,
            actionType,
        }: {
            oldFormData: TestAccessFormType | null;
            data: TestAccessFormValues;
            assessmentId: string | null;
            instituteId: string | undefined;
            type: string | undefined;
            actionType: string;
        }) => handlePostStep3Data(oldFormData, data, assessmentId, instituteId, type, actionType),
        onSuccess: () => {
            if (assessmentId !== 'defaultId') {
                useTestAccessStore.getState().reset();
                window.history.back();
                toast.success(t('toasts.updateSuccess'), {
                    className: 'success-toast',
                    duration: 2000,
                });
                queryClient.invalidateQueries({ queryKey: ['GET_ASSESSMENT_DETAILS'] });
                queryClient.invalidateQueries({ queryKey: ['GET_INDIVIDUAL_STUDENT_DETAILS'] });
            } else {
                syncStep3DataWithStore(form);
                toast.success(t('toasts.saveSuccess'), {
                    className: 'success-toast',
                    duration: 2000,
                });
                handleCompleteCurrentStep();
            }
        },
        onError: (error: unknown) => {
            reportApiError(error, {
                feature: 'homework-step3-add-participants',
                tags: { actionType: assessmentId !== 'defaultId' ? 'update' : 'create' },
                extra: { assessmentId, instituteId: instituteDetails?.id, examType },
                fallbackMessage: t('errors.saveFailed'),
            });
        },
    });

    const onSubmit = (data: TestAccessFormValues) => {
        handleSubmitStep3Form.mutate({
            oldFormData: diffBaseForSave(
                oldFormData.current,
                convertToCustomFieldsData(
                    assessmentDetails[2]?.saved_data?.registration_form_fields
                ),
                data.open_test.checked
            ),
            data: data,
            assessmentId: assessmentId !== 'defaultId' ? assessmentId : savedAssessmentId,
            instituteId: instituteDetails?.id,
            type: examType,
            actionType: assessmentId !== 'defaultId' ? 'update' : 'create',
        });
    };

    const onInvalid = (err: unknown) => {
        console.log(err);
    };

    const toggleIsRequired = (id: string) => {
        const updatedFields = customFields?.map((field) =>
            field.id === id ? { ...field, isRequired: !field.isRequired } : field
        );
        setValue('open_test.custom_fields', updatedFields);
    };

    const patchField = (id: string, patch: Record<string, unknown>) => {
        const updatedFields = customFields?.map((field) =>
            field.id === id ? { ...field, ...patch } : field
        );
        setValue('open_test.custom_fields', updatedFields);
    };

    // Editing reuses the "Add Custom Field" dialog, prefilled. The id is kept so the
    // save-time diff still reads this as an update rather than an add + remove.
    const handleEditCustomField = (
        id: string,
        type: string,
        name: string,
        options?: DropdownOption[],
        config?: CustomFieldConfig
    ) => {
        patchField(id, {
            type,
            name,
            isRequired: config?.isRequired ?? true,
            // Dropping the options on a switch to a non-choice type stops stale
            // values from reappearing if the admin switches back.
            options: options?.map((opt, index) => ({
                id: String(index),
                value: opt.value,
            })),
        });
        setEditingFieldId(null);
    };

    const handleAddOpenFieldValues = (type: string, name: string, oldKey: boolean) => {
        // Add the new field to the array
        const updatedFields = [
            ...customFields,
            {
                id: String(customFields.length), // Use the current array length as the new ID
                type,
                name,
                oldKey,
                isRequired: true,
                key: '',
                order: customFields.length,
            },
        ];

        // Update the form state with the new array
        setValue('open_test.custom_fields', updatedFields);
    };

    const handleDeleteOpenField = (id: string) => {
        const updatedFields = customFields?.filter((field) => field.id !== id);
        setValue('open_test.custom_fields', updatedFields);
    };
    const handleAddCustomField = (
        type: string,
        name: string,
        oldKey: boolean,
        options?: DropdownOption[],
    ) => {
        const convertedOptions = options?.map((opt) => ({
            id: String(opt.id),
            value: opt.value,
        }));
        const newField = {
            id: String(customFields.length),
            type,
            name,
            oldKey,
            ...((type === 'dropdown' || type === 'radio') && convertedOptions && { options: convertedOptions }),
            isRequired: true,
            key: '',
            order: customFields.length,
        };

        const updatedFields = [...customFields, newField];
        setValue('open_test.custom_fields', updatedFields);
    };

    useIntroJsTour({
        key: IntroKey.assessmentStep3Participants,
        steps: createAssesmentSteps
            .filter((step) => step.element === '#add-participants') // design-lint-ignore: DOM id selector for intro.js targeting, not a color literal
            .flatMap((step) => step.subStep || [])
            .filter((subStep): subStep is Step => subStep !== undefined),
    });

    const { data: studentList } = useSuspenseQuery(
        handleGetIndividualStudentList({ instituteId, assessmentId })
    );

    useEffect(() => {
        if (assessmentId !== 'defaultId') {
            const checkedStudentList = studentList
                .filter(
                    (user: Step3ParticipantsListIndiviudalStudentInterface) =>
                        user.source === 'ADMIN_PRE_REGISTRATION'
                )
                .map((user: Step3ParticipantsListIndiviudalStudentInterface) => {
                    return {
                        username: user.username,
                        user_id: user.userId,
                        email: user.userEmail,
                        full_name: user.participantName,
                        mobile_number: user.phoneNumber,
                        guardian_email: '',
                        guardian_mobile_number: '',
                        file_id: user.faceFileId,
                        reattempt_count: user.reattemptCount,
                    };
                });
            const initialValues = {
                status: completedSteps[currentStep] ? 'COMPLETE' : 'INCOMPLETE',
                closed_test:
                    assessmentDetails[0]?.saved_data?.assessment_visibility === 'PRIVATE'
                        ? true
                        : false,
                open_test: {
                    checked:
                        assessmentDetails[0]?.saved_data?.assessment_visibility === 'PUBLIC'
                            ? true
                            : false,
                    start_date: assessmentDetails[currentStep]?.saved_data?.registration_open_date
                        ? convertDateFormat(
                              assessmentDetails[currentStep]?.saved_data?.registration_open_date ||
                                  ''
                          )
                        : '',
                    end_date: assessmentDetails[currentStep]?.saved_data?.registration_close_date
                        ? convertDateFormat(
                              assessmentDetails[currentStep]?.saved_data?.registration_close_date ||
                                  ''
                          )
                        : '',
                    instructions: '',
                    custom_fields: getCustomFieldsWhileEditStep3(assessmentDetails),
                },
                select_batch: {
                    checked: true,
                    batch_details: Object.fromEntries(
                        Object.entries(transformedBatches).map(([key, value]) => [
                            key,
                            value.map((item) => item.id),
                        ])
                    ),
                },
                select_individually: {
                    checked: false,
                    student_details: checkedStudentList,
                },
                join_link: getAssessmentJoinUrl(
                    assessmentDetails[0]?.saved_data.assessment_url,
                    instituteDetails?.learner_portal_base_url
                ),
                show_leaderboard:
                    assessmentDetails[currentStep]?.saved_data?.notifications
                        ?.participant_show_leaderboard || false,
                notify_student: {
                    when_assessment_created:
                        assessmentDetails[currentStep]?.saved_data?.notifications
                            ?.participant_when_assessment_created || false,
                    before_assessment_goes_live: {
                        checked:
                            assessmentDetails[currentStep]?.saved_data?.notifications
                                ?.participant_before_assessment_goes_live === 0
                                ? false
                                : true,
                        value: assessmentDetails[currentStep]?.saved_data?.notifications
                            ?.participant_before_assessment_goes_live
                            ? String(
                                  assessmentDetails[currentStep]?.saved_data?.notifications
                                      ?.participant_before_assessment_goes_live
                              ) + ' min'
                            : '1 min',
                    },
                    when_assessment_live:
                        assessmentDetails[currentStep]?.saved_data?.notifications
                            ?.participant_when_assessment_live || false,
                    when_assessment_report_generated:
                        assessmentDetails[currentStep]?.saved_data?.notifications
                            ?.participant_when_assessment_report_generated || false,
                },
                notify_parent: {
                    when_assessment_created:
                        assessmentDetails[currentStep]?.saved_data?.notifications
                            ?.parent_when_assessment_created || false,
                    before_assessment_goes_live: {
                        checked:
                            assessmentDetails[currentStep]?.saved_data?.notifications
                                ?.parent_before_assessment_goes_live === 0
                                ? false
                                : true,
                        value: assessmentDetails[currentStep]?.saved_data?.notifications
                            ?.parent_before_assessment_goes_live
                            ? String(
                                  assessmentDetails[currentStep]?.saved_data?.notifications
                                      ?.parent_before_assessment_goes_live
                              ) + ' min'
                            : '1 min',
                    },
                    when_assessment_live:
                        assessmentDetails[currentStep]?.saved_data?.notifications
                            ?.parent_when_assessment_live || false,
                    when_student_appears: true,
                    when_student_finishes_test: true,
                    when_assessment_report_generated:
                        assessmentDetails[currentStep]?.saved_data?.notifications
                            ?.parent_when_assessment_report_generated || false,
                },
            };
            // Store the initial values in the ref
            oldFormData.current = JSON.parse(JSON.stringify(initialValues));

            // Reset form with these values
            form.reset(initialValues);
        }
    }, [assessmentId, assessmentDetails, storeDataStep3, selectedSection]);

    if (isLoading) return <DashboardLoader />;

    return (
        <FormProvider {...form}>
            <form>
                <div className="m-0 flex items-center justify-between p-0">
                    <h1>{t('header.title')}</h1>
                    <MyButton
                        type="button"
                        scale="large"
                        buttonType="primary"
                        onClick={handleSubmit(onSubmit, onInvalid)}
                    >
                        {assessmentId !== 'defaultId' ? t('header.update') : t('header.next')}
                    </MyButton>
                </div>
                <Separator className="my-4" />
                <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-3" id="open-assessment">
                        <h1>{t('participantAccess.heading')}</h1>
                        <FormField
                            control={form.control}
                            name="closed_test" // Use the parent key to handle both fields
                            render={() => (
                                <FormItem className="space-y-3">
                                    <FormControl>
                                        <RadioGroup
                                            onValueChange={(value) => {
                                                form.setValue(
                                                    'closed_test',
                                                    value === 'CLOSE_TEST'
                                                );
                                                form.setValue(
                                                    'open_test.checked',
                                                    value === 'OPEN_TEST'
                                                );
                                            }}
                                            defaultValue={
                                                getValues('closed_test')
                                                    ? 'CLOSE_TEST'
                                                    : 'OPEN_TEST'
                                            }
                                            className="flex flex-col gap-3"
                                        >
                                            {getStepKey({
                                                assessmentDetails,
                                                currentStep,
                                                key: 'closed_link',
                                            }) === 'REQUIRED' && (
                                                <FormItem className="flex items-center space-x-3 space-y-0">
                                                    <FormControl>
                                                        <RadioGroupItem value="CLOSE_TEST" />
                                                    </FormControl>
                                                    <FormLabel className="font-semibold">
                                                        {t('participantAccess.closedTest.label')}{' '}
                                                        <span className="font-thin">
                                                            {t(
                                                                'participantAccess.closedTest.description',
                                                                {
                                                                    term: getTerminology(
                                                                        RoleTerms.Learner,
                                                                        SystemTerms.Learner
                                                                    ).toLocaleLowerCase(),
                                                                }
                                                            )}
                                                        </span>
                                                    </FormLabel>
                                                </FormItem>
                                            )}
                                            {getStepKey({
                                                assessmentDetails,
                                                currentStep,
                                                key: 'open_link',
                                            }) === 'REQUIRED' && (
                                                <FormItem className="flex items-center space-x-3 space-y-0">
                                                    <FormControl>
                                                        <RadioGroupItem value="OPEN_TEST" />
                                                    </FormControl>
                                                    <FormLabel className="font-semibold">
                                                        {t('participantAccess.openTest.label')}{' '}
                                                        <span className="font-thin">
                                                            {t(
                                                                'participantAccess.openTest.description',
                                                                {
                                                                    term: getTerminology(
                                                                        RoleTerms.Learner,
                                                                        SystemTerms.Learner
                                                                    ).toLocaleLowerCase(),
                                                                }
                                                            )}
                                                        </span>
                                                    </FormLabel>
                                                </FormItem>
                                            )}
                                        </RadioGroup>
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                    </div>
                    {watch('open_test.checked') && (
                        <>
                            <div className="mt-2 flex flex-col gap-4">
                                <h1>{t('registration.heading')}</h1>
                                <div className="-mt-2 flex items-start gap-4">
                                    {getStepKey({
                                        assessmentDetails,
                                        currentStep,
                                        key: 'registration_open_date',
                                    }) === 'REQUIRED' && (
                                        <FormField
                                            control={control}
                                            name="open_test.start_date"
                                            render={({ field: { ...field } }) => (
                                                <FormItem>
                                                    <FormControl>
                                                        <MyInput
                                                            inputType="datetime-local"
                                                            input={field.value}
                                                            onChangeFunction={field.onChange}
                                                            error={
                                                                form.formState.errors.open_test
                                                                    ?.start_date?.message
                                                            }
                                                            required
                                                            size="large"
                                                            label={t('registration.startDateLabel')}
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
                                        key: 'registration_close_date',
                                    }) === 'REQUIRED' && (
                                        <FormField
                                            control={control}
                                            name="open_test.end_date"
                                            render={({ field: { ...field } }) => (
                                                <FormItem>
                                                    <FormControl>
                                                        <MyInput
                                                            inputType="datetime-local"
                                                            input={field.value}
                                                            onChangeFunction={field.onChange}
                                                            error={
                                                                form.formState.errors.open_test
                                                                    ?.end_date?.message
                                                            }
                                                            required
                                                            size="large"
                                                            label={t('registration.endDateLabel')}
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
                            </div>
                            <div className="mt-2 flex flex-col gap-6">
                                <h1 className="-mb-5">{t('registration.aboutHeading')}</h1>
                                <FormField
                                    control={control}
                                    name="open_test.instructions"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormControl>
                                                <RichTextEditor
                                                    onChange={field.onChange}
                                                    onBlur={field.onBlur}
                                                    value={field.value}
                                                    placeholder={t(
                                                        'registration.instructionsPlaceholder'
                                                    )}
                                                    minHeight={120}
                                                />
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />
                            </div>
                            {getStepKey({
                                assessmentDetails,
                                currentStep,
                                key: 'registration_form_fields',
                            }) === 'REQUIRED' && (
                                <div className="flex w-full flex-col gap-4">
                                    <div className="flex flex-col">
                                        <h1>{t('registration.fields.heading')}</h1>
                                        <p className="text-caption text-neutral-500">
                                            {t('registration.fields.helperText')}
                                        </p>
                                    </div>
                                    <FormFieldRowHeader />
                                    <div className="flex flex-col gap-4">
                                        {customFields?.map((fields, index) => {
                                            const isEditingField = editingFieldId === fields.id;
                                            return (
                                                <FormFieldRow
                                                    key={index}
                                                    position={index + 1}
                                                    name={fields.name}
                                                    type={fields.type}
                                                    isRequired={fields.isRequired}
                                                    isEditing={isEditingField}
                                                    onToggleRequired={() =>
                                                        toggleIsRequired(fields.id)
                                                    }
                                                    onEdit={() => setEditingFieldId(fields.id)}
                                                    onDelete={() =>
                                                        handleDeleteOpenField(fields.id)
                                                    }
                                                    dragHandle={null}
                                                />
                                            );
                                        })}
                                    </div>
                                    <div className="mt-2 flex items-center gap-6">
                                        {!customFields?.some(
                                            (field) => field.name === 'Gender'
                                        ) && (
                                            <MyButton
                                                type="button"
                                                scale="medium"
                                                buttonType="secondary"
                                                onClick={() =>
                                                    handleAddOpenFieldValues(
                                                        'textfield',
                                                        'Gender',
                                                        false
                                                    )
                                                }
                                            >
                                                <Plus size={32} />{' '}
                                                {t('registration.fields.addGenderButton')}
                                            </MyButton>
                                        )}
                                        {!customFields?.some((field) => field.name === 'State') && (
                                            <MyButton
                                                type="button"
                                                scale="medium"
                                                buttonType="secondary"
                                                onClick={() =>
                                                    handleAddOpenFieldValues(
                                                        'textfield',
                                                        'State',
                                                        false
                                                    )
                                                }
                                            >
                                                <Plus size={32} />{' '}
                                                {t('registration.fields.addStateButton')}
                                            </MyButton>
                                        )}
                                        {!customFields?.some((field) => field.name === 'City') && (
                                            <MyButton
                                                type="button"
                                                scale="medium"
                                                buttonType="secondary"
                                                onClick={() =>
                                                    handleAddOpenFieldValues(
                                                        'textfield',
                                                        'City',
                                                        false
                                                    )
                                                }
                                            >
                                                <Plus size={32} />{' '}
                                                {t('registration.fields.addCityButton')}
                                            </MyButton>
                                        )}
                                        {!customFields?.some(
                                            (field) => field.name === 'School/College'
                                        ) && (
                                            <MyButton
                                                type="button"
                                                scale="medium"
                                                buttonType="secondary"
                                                onClick={() =>
                                                    handleAddOpenFieldValues(
                                                        'textfield',
                                                        'School/College',
                                                        false
                                                    )
                                                }
                                            >
                                                <Plus size={32} />{' '}
                                                {t('registration.fields.addSchoolCollegeButton')}
                                            </MyButton>
                                        )}
                                        <SharedAddCustomFieldDialog
                                            trigger={
                                                <MyButton
                                                    type="button"
                                                    scale="medium"
                                                    buttonType="secondary"
                                                >
                                                    <Plus size={32} />{' '}
                                                    {t('registration.fields.addCustomFieldButton')}
                                                </MyButton>
                                            }
                                            onAddField={handleAddCustomField}
                                            existingFieldNames={
                                                customFields
                                                    ?.filter((f) => (f as any).status !== 'DELETED')
                                                    .map((f) => f.name) ?? []
                                            }
                                        />
                                    </div>
                                    {/* Editing reuses the add dialog, prefilled. Keyed by field id
                                        so opening a different row re-runs the prefill. */}
                                    {editingField && (
                                        <SharedAddCustomFieldDialog
                                            key={editingField.id}
                                            mode="edit"
                                            open
                                            onOpenChange={(isOpen) => {
                                                if (!isOpen) setEditingFieldId(null);
                                            }}
                                            initialField={{
                                                type: editingField.type,
                                                name: editingField.name,
                                                options: (editingField.options ?? []).map(
                                                    (o) => o.value
                                                ),
                                                isRequired: editingField.isRequired,
                                            }}
                                            onAddField={(type, name, _oldKey, options, config) =>
                                                handleEditCustomField(
                                                    editingField.id,
                                                    type,
                                                    name,
                                                    options,
                                                    config
                                                )
                                            }
                                            // Its own name must stay available, or saving an
                                            // unchanged label would be blocked as a duplicate.
                                            existingFieldNames={
                                                customFields
                                                    ?.filter(
                                                        (f) =>
                                                            f.id !== editingField.id &&
                                                            (f as any).status !== 'DELETED'
                                                    )
                                                    .map((f) => f.name) ?? []
                                            }
                                        />
                                    )}
                                    <Dialog>
                                        <DialogTrigger className="flex justify-start">
                                            <MyButton
                                                type="button"
                                                scale="medium"
                                                buttonType="secondary"
                                                className="mt-4 w-fit"
                                            >
                                                {t('registration.preview.triggerButton')}
                                            </MyButton>
                                        </DialogTrigger>
                                        <DialogContent className="p-0">
                                            <h1 className="rounded-md bg-primary-50 p-4 font-semibold text-primary-500">
                                                {t('registration.preview.heading')}
                                            </h1>
                                            <div className="flex max-h-dialog-tall flex-col gap-4 overflow-y-auto px-4 py-2">
                                                {customFields?.map((testInputFields, idx) => {
                                                    return (
                                                        <div
                                                            className="flex w-full flex-col items-start gap-1.5"
                                                            key={idx}
                                                        >
                                                            <h1 className="text-sm">
                                                                {testInputFields.name}
                                                                {testInputFields.isRequired && (
                                                                    <span className="text-subtitle text-danger-600">
                                                                        *
                                                                    </span>
                                                                )}
                                                            </h1>
                                                            <CustomFieldRenderer
                                                                type={testInputFields.type}
                                                                name={testInputFields.name}
                                                                value=""
                                                                disabled={true}
                                                                options={testInputFields.options?.map(
                                                                    (o) => o.value
                                                                )}
                                                                required={
                                                                    testInputFields.isRequired
                                                                }
                                                            />
                                                        </div>
                                                    );
                                                })}
                                                <div className="mb-6 flex justify-center">
                                                    <MyButton
                                                        type="button"
                                                        scale="medium"
                                                        buttonType="primary"
                                                        className="mt-4 w-fit"
                                                        disable
                                                    >
                                                        {t('registration.preview.registerNowButton')}
                                                    </MyButton>
                                                </div>
                                            </div>
                                        </DialogContent>
                                    </Dialog>
                                </div>
                            )}
                        </>
                    )}
                    <AddingParticipantsTab
                        batches={transformedBatches}
                        form={form}
                        totalBatches={transformBatchData(
                            batches_for_sessions || [],
                            selectedSection!
                        )}
                        selectedSection={selectedSection ?? ''}
                        setSelectedSection={setSelectedSection}
                        sectionsInfo={sectionsInfo}
                    />
                    <Separator className="my-4" />
                    <div className="flex items-center justify-between" id="join-link-qr-code">
                        <div className="flex flex-col gap-2">
                            <h1>{t('joinLink.heading')}</h1>
                            <div className="flex items-center gap-8">
                                <div className="flex items-center gap-4">
                                    <FormField
                                        control={control}
                                        name="join_link"
                                        render={({ field: { ...field } }) => (
                                            <FormItem>
                                                <FormControl>
                                                    <MyInput
                                                        inputType="text"
                                                        inputPlaceholder={t('joinLink.placeholder')}
                                                        input={field.value}
                                                        onChangeFunction={field.onChange}
                                                        error={
                                                            form.formState.errors.join_link?.message
                                                        }
                                                        size="large"
                                                        {...field}
                                                    />
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
                                    <MyButton
                                        type="button"
                                        scale="small"
                                        buttonType="secondary"
                                        className="h-10 min-w-10"
                                        onClick={() => copyToClipboard(getValues('join_link'))}
                                    >
                                        <Copy size={32} />
                                    </MyButton>
                                </div>
                            </div>
                        </div>
                        <div className="flex flex-col gap-2">
                            <h1>{t('qrCode.heading')}</h1>
                            <div className="flex items-center gap-8">
                                <div className="flex items-center gap-4">
                                    <FormField
                                        control={control}
                                        name="join_link"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormControl>
                                                    <QRCode
                                                        value={field.value ?? ''}
                                                        className="size-16"
                                                        id="qr-code-svg"
                                                    />
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
                                    <MyButton
                                        type="button"
                                        scale="small"
                                        buttonType="secondary"
                                        className="h-10 min-w-10"
                                        onClick={() => handleDownloadQRCode('qr-code-svg', tHelper)}
                                    >
                                        <DownloadSimple size={32} />
                                    </MyButton>
                                </div>
                            </div>
                        </div>
                    </div>
                    <Separator className="my-4" />
                    {/* will be added later
                    <FormField
                        control={form.control}
                        name="show_leaderboard"
                        render={({ field }) => (
                            <FormItem className="my-2 flex w-1/2 items-center justify-between">
                                <FormLabel>Show Leaderboard to Participants</FormLabel>
                                <FormControl>
                                    <Switch
                                        checked={field.value}
                                        onCheckedChange={field.onChange}
                                    />
                                </FormControl>
                            </FormItem>
                        )}
                    /> */}
                    <div className="flex w-3/4 justify-between" id="notify-via-email">
                        {getStepKey({
                            assessmentDetails,
                            currentStep,
                            key: 'notify_participants',
                        }) === 'REQUIRED' && (
                            <div className="flex flex-col gap-4">
                                <h1>{t('notifyParticipants.heading')}</h1>
                                <FormField
                                    control={control}
                                    name={`notify_student.when_assessment_created`}
                                    render={({ field }) => (
                                        <FormItem className="flex items-end gap-2">
                                            <FormControl>
                                                <Checkbox
                                                    checked={field.value}
                                                    onCheckedChange={field.onChange}
                                                    className={`size-5 rounded-sm border-2 shadow-none ${
                                                        field.value
                                                            ? 'border-none bg-primary-500 text-white' // Blue background and red tick when checked
                                                            : '' // Default styles when unchecked
                                                    }`}
                                                />
                                            </FormControl>
                                            <FormLabel className="!mb-1 font-thin">
                                                {t('notifyParticipants.whenAssessmentCreated')}
                                            </FormLabel>
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={control}
                                    name={`notify_student.before_assessment_goes_live.checked`}
                                    render={({ field }) => (
                                        <FormItem className="flex items-end gap-2">
                                            <FormControl>
                                                <Checkbox
                                                    checked={field.value}
                                                    onCheckedChange={field.onChange}
                                                    className={`size-5 rounded-sm border-2 shadow-none ${
                                                        field.value
                                                            ? 'border-none bg-primary-500 text-white' // Blue background and red tick when checked
                                                            : '' // Default styles when unchecked
                                                    }`}
                                                />
                                            </FormControl>
                                            <FormLabel className="!mb-1 font-thin">
                                                {t('notifyParticipants.beforeAssessmentGoesLive')}
                                            </FormLabel>
                                        </FormItem>
                                    )}
                                />
                                {watch('notify_student.before_assessment_goes_live')?.checked && (
                                    <SelectField
                                        label={t('notifyParticipants.notifyBeforeLabel')}
                                        labelStyle="font-thin"
                                        name="notify_student.before_assessment_goes_live.value"
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
                                <FormField
                                    control={control}
                                    name={`notify_student.when_assessment_live`}
                                    render={({ field }) => (
                                        <FormItem className="flex items-end gap-2">
                                            <FormControl>
                                                <Checkbox
                                                    checked={field.value}
                                                    onCheckedChange={field.onChange}
                                                    className={`size-5 rounded-sm border-2 shadow-none ${
                                                        field.value
                                                            ? 'border-none bg-primary-500 text-white' // Blue background and red tick when checked
                                                            : '' // Default styles when unchecked
                                                    }`}
                                                />
                                            </FormControl>
                                            <FormLabel className="!mb-1 font-thin">
                                                {t('notifyParticipants.whenAssessmentLive')}
                                            </FormLabel>
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={control}
                                    name={`notify_student.when_assessment_report_generated`}
                                    render={({ field }) => (
                                        <FormItem className="flex items-end gap-2">
                                            <FormControl>
                                                <Checkbox
                                                    checked={field.value}
                                                    onCheckedChange={field.onChange}
                                                    className={`size-5 rounded-sm border-2 shadow-none ${
                                                        field.value
                                                            ? 'border-none bg-primary-500 text-white' // Blue background and red tick when checked
                                                            : '' // Default styles when unchecked
                                                    }`}
                                                />
                                            </FormControl>
                                            <FormLabel className="!mb-1 font-thin">
                                                {t('notifyParticipants.whenReportGenerated')}
                                            </FormLabel>
                                        </FormItem>
                                    )}
                                />
                            </div>
                        )}
                        {/* will be added later
                        {getStepKey({
                            assessmentDetails,
                            currentStep,
                            key: "notify_parents",
                        }) === "REQUIRED" && (
                            <div className="flex flex-col gap-4">
                                <h1>Notify Parents via Email:</h1>
                                <FormField
                                    control={control}
                                    name={`notify_parent.when_assessment_created`}
                                    render={({ field }) => (
                                        <FormItem className="flex items-end gap-2">
                                            <FormControl>
                                                <Checkbox
                                                    checked={field.value}
                                                    onCheckedChange={field.onChange}
                                                    className={`size-5 rounded-sm border-2 shadow-none ${
                                                        field.value
                                                            ? "border-none bg-primary-500 text-white" // Blue background and red tick when checked
                                                            : "" // Default styles when unchecked
                                                    }`}
                                                />
                                            </FormControl>
                                            <FormLabel className="!mb-1 font-thin">
                                                When Assessment is created
                                            </FormLabel>
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={control}
                                    name={`notify_parent.before_assessment_goes_live.checked`}
                                    render={({ field }) => (
                                        <FormItem className="flex items-end gap-2">
                                            <FormControl>
                                                <Checkbox
                                                    checked={field.value}
                                                    onCheckedChange={field.onChange}
                                                    className={`size-5 rounded-sm border-2 shadow-none ${
                                                        field.value
                                                            ? "border-none bg-primary-500 text-white" // Blue background and red tick when checked
                                                            : "" // Default styles when unchecked
                                                    }`}
                                                />
                                            </FormControl>
                                            <FormLabel className="!mb-1 font-thin">
                                                Before Assessment goes live
                                            </FormLabel>
                                        </FormItem>
                                    )}
                                />
                                {watch("notify_parent.before_assessment_goes_live").checked && (
                                    <SelectField
                                        label="Notify Before"
                                        labelStyle="font-thin"
                                        name="notify_parent.before_assessment_goes_live.value"
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
                                <FormField
                                    control={control}
                                    name={`notify_parent.when_assessment_live`}
                                    render={({ field }) => (
                                        <FormItem className="flex items-end gap-2">
                                            <FormControl>
                                                <Checkbox
                                                    checked={field.value}
                                                    onCheckedChange={field.onChange}
                                                    className={`size-5 rounded-sm border-2 shadow-none ${
                                                        field.value
                                                            ? "border-none bg-primary-500 text-white" // Blue background and red tick when checked
                                                            : "" // Default styles when unchecked
                                                    }`}
                                                />
                                            </FormControl>
                                            <FormLabel className="!mb-1 font-thin">
                                                When Assessment goes live
                                            </FormLabel>
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={control}
                                    name={`notify_parent.when_student_appears`}
                                    render={({ field }) => (
                                        <FormItem className="flex items-end gap-2">
                                            <FormControl>
                                                <Checkbox
                                                    checked={field.value}
                                                    onCheckedChange={field.onChange}
                                                    className={`size-5 rounded-sm border-2 shadow-none ${
                                                        field.value
                                                            ? "border-none bg-primary-500 text-white" // Blue background and red tick when checked
                                                            : "" // Default styles when unchecked
                                                    }`}
                                                />
                                            </FormControl>
                                            <FormLabel className="!mb-1 font-thin">
                                                When students appears for the Assessment
                                            </FormLabel>
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={control}
                                    name={`notify_parent.when_student_finishes_test`}
                                    render={({ field }) => (
                                        <FormItem className="flex items-end gap-2">
                                            <FormControl>
                                                <Checkbox
                                                    checked={field.value}
                                                    onCheckedChange={field.onChange}
                                                    className={`size-5 rounded-sm border-2 shadow-none ${
                                                        field.value
                                                            ? "border-none bg-primary-500 text-white" // Blue background and red tick when checked
                                                            : "" // Default styles when unchecked
                                                    }`}
                                                />
                                            </FormControl>
                                            <FormLabel className="!mb-1 font-thin">
                                                When students finishes the Assessment
                                            </FormLabel>
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={control}
                                    name={`notify_parent.when_assessment_report_generated`}
                                    render={({ field }) => (
                                        <FormItem className="flex items-end gap-2">
                                            <FormControl>
                                                <Checkbox
                                                    checked={field.value}
                                                    onCheckedChange={field.onChange}
                                                    className={`size-5 rounded-sm border-2 shadow-none ${
                                                        field.value
                                                            ? "border-none bg-primary-500 text-white" // Blue background and red tick when checked
                                                            : "" // Default styles when unchecked
                                                    }`}
                                                />
                                            </FormControl>
                                            <FormLabel className="!mb-1 font-thin">
                                                When assessment reports are generated
                                            </FormLabel>
                                        </FormItem>
                                    )}
                                />
                            </div>
                        )} */}
                    </div>
                </div>
            </form>
        </FormProvider>
    );
};

export default Step3AddingParticipants;
