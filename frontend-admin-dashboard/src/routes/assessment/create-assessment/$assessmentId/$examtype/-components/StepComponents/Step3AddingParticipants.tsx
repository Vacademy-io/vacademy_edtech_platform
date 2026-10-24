import { StepContentProps } from '@/types/assessments/step-content-props';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormProvider, useFieldArray, useForm } from 'react-hook-form';
import { MyButton } from '@/components/design-system/button';
import { z } from 'zod';
import testAccessSchema from '../../-utils/add-participants-schema';
import { Separator } from '@/components/ui/separator';
import { FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { MyInput } from '@/components/design-system/input';
import {
    Copy,
    DotsSixVertical,
    DownloadSimple,
    PencilSimple,
    Plus,
    TrashSimple,
    Users,
    Lock,
    Globe,
    LinkSimple,
    QrCode,
    ArrowRight,
    Bell,
    Student,
    UsersFour,
} from '@phosphor-icons/react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import QRCode from 'react-qr-code';
import {
    copyToClipboard,
    getAllSessions,
    getAssessmentJoinLink,
    convertToCustomFieldsData,
    getCustomFieldsWhileEditStep3,
    getStepKey,
    handleDownloadQRCode,
    syncStep3DataWithStore,
    transformAllBatchData,
    transformBatchData,
} from '../../-utils/helper';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import SelectField from '@/components/design-system/select-field';
import { timeLimit } from '@/constants/dummy-data';
import { AddingParticipantsTab } from '../AddingParticipantsTab';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import { RichTextEditor } from '@/components/editor/RichTextEditor';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { getAssessmentDetails, handlePostStep3Data } from '../../-services/assessment-services';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { toast } from 'sonner';
import { reportApiError } from '@/lib/report-api-error';
import { useSavedAssessmentStore } from '../../-utils/global-states';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTestAccessStore } from '../../-utils/zustand-global-states/step3-adding-participants';
import { diffBaseForSave } from '../../-utils/step3-registration-fields';
import { useParams } from '@tanstack/react-router';
import { convertDateFormat } from './Step1BasicInfo';
import { handleGetIndividualStudentList } from '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-services/assessment-details-services';
import { getInstituteId } from '@/constants/helper';
import { Step3ParticipantsListIndiviudalStudentInterface } from '@/types/assessments/student-questionwise-status';
import { Sortable, SortableDragHandle, SortableItem } from '@/components/ui/sortable';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { fetchInstituteDefaultFields } from '@/services/custom-field-mappings';
import {
    isBuiltInRegistrationField,
    withBuiltInRegistrationFields,
} from '@/components/common/custom-fields/builtin-registration-fields';
import {
    parseFieldConfig,
    serializeFieldConfig,
} from '@/components/common/custom-fields/field-config';
import {
    AddCustomFieldDialog as SharedAddCustomFieldDialog,
    DropdownOption,
    CustomFieldConfig,
} from '@/components/common/custom-fields/AddCustomFieldDialog';
import { CustomFieldRenderer } from '@/components/common/custom-fields/CustomFieldRenderer';
import {
    FormFieldRow,
    FormFieldRowHeader,
} from '@/components/common/custom-fields/FormFieldRow';
type TestAccessFormType = z.infer<typeof testAccessSchema>;

// Field ids double as React keys and drag identity, so they must be unique.
// String(length) collided with seeded ids ('0','1','2') after a delete.
let newFieldSeq = 0;
const nextFieldId = () => `new-${Date.now()}-${newFieldSeq++}`;

function getInitialAssessmentCustomFields() {
    // Returns empty — the useEffect below will async-load from the live API.
    return [];
}

const Step3AddingParticipants: React.FC<StepContentProps> = ({
    currentStep,
    handleCompleteCurrentStep,
    completedSteps,
}) => {
    const { t } = useTranslation('assessmentStep3AddingParticipants');
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
                custom_fields: getInitialAssessmentCustomFields(),
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
                getAssessmentJoinLink(
                    instituteDetails?.learner_portal_base_url,
                    assessmentDetails[0]?.saved_data.assessment_url
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

    const { fields: customFieldsArray, move: moveCustomField } = useFieldArray({
        control,
        name: 'open_test.custom_fields',
        // keyName: RHF otherwise overwrites each row's `id` with a fresh uuid on
        // every array-level setValue, remounting rows (focus loss) and breaking
        // id-based matching. Keep the domain id intact.
        keyName: '_rhfKey',
    });

    /** The row whose pencil was clicked — drives the prefilled edit dialog. */
    const editingField = customFieldsArray.find((field) => field.id === editingFieldId);

    // Async-load institute defaults directly from the live backend endpoint.
    // Only for brand-new drafts — for an existing assessment, custom_fields is
    // already loaded from its saved registration_form_fields (see the
    // assessmentId !== 'defaultId' effect below), and this must not clobber it.
    useEffect(() => {
        const loadFields = async () => {
            if (!instituteId || assessmentId !== 'defaultId') return;
            const defaults = await fetchInstituteDefaultFields(instituteId);
            const SEEDED_KEYS = ['full_name', 'email', 'phone_number'];
            const loaded = (defaults ?? []).map((entry, i) => {
                const cf = entry.custom_field;
                const key = cf.fieldName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
                // Built-in by ROLE, not by a key list — "Name" / "E-mail" count too.
                const isSeeded =
                    SEEDED_KEYS.includes(key) ||
                    isBuiltInRegistrationField({ key, label: cf.fieldName, type: cf.fieldType });
                const result: any = {
                    id: String(i),
                    type: cf.fieldType === 'dropdown' ? 'dropdown' : 'textfield',
                    name: cf.fieldName,
                    oldKey: isSeeded,
                    isRequired: cf.isMandatory || isSeeded,
                    key,
                    order: entry.individual_order ?? i,
                };
                if (cf.fieldType === 'dropdown' && cf.config) {
                    try {
                        const parsed = JSON.parse(cf.config);
                        if (Array.isArray(parsed)) {
                            result.options = parsed.map((opt: any, oi: number) => ({ id: `${i}_opt_${oi}`, value: opt.value || opt.label || opt }));
                        } else if (parsed.coommaSepartedOptions) {
                            result.options = parsed.coommaSepartedOptions.split(',').map((v: string, oi: number) => ({ id: `${i}_opt_${oi}`, value: v.trim() }));
                        }
                    } catch { /* ignore */ }
                }
                return result;
            });
            // An institute with no DEFAULT set (or one missing a field) still gets Full Name /
            // Email / Phone Number, required to start with.
            const fields = withBuiltInRegistrationFields(
                loaded,
                (field) => ({ key: field.key, label: field.name, type: field.type }),
                (builtIn, index) => ({
                    id: String(index),
                    type: 'textfield',
                    name: builtIn.label,
                    oldKey: true,
                    isRequired: true,
                    key: builtIn.key,
                    order: index,
                })
            );
            const currentValues = form.getValues();
            form.reset({
                ...currentValues,
                open_test: { ...currentValues.open_test, custom_fields: fields },
            });
        };
        loadFields();
    }, [assessmentId, instituteId]);

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
            data: z.infer<typeof testAccessSchema>;
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
                toast.success(t('toasts.createSuccess'), {
                    className: 'success-toast',
                    duration: 2000,
                });
                handleCompleteCurrentStep();
            }
        },
        onError: (error: unknown) => {
            reportApiError(error, {
                feature: 'assessment-step3-add-participants',
                tags: { actionType: assessmentId !== 'defaultId' ? 'update' : 'create' },
                extra: { assessmentId, instituteId: instituteDetails?.id, examType },
                fallbackMessage: t('toasts.saveFailed'),
            });
        },
    });

    const onSubmit = (data: z.infer<typeof testAccessSchema>) => {
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
        // Scroll to the first error field
        const firstErrorField = document.querySelector('[data-error="true"]');
        if (firstErrorField) {
            firstErrorField.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    };

    const toggleIsRequired = (id: string) => {
        const updatedFields = customFieldsArray?.map((field) =>
            field.id === id ? { ...field, isRequired: !field.isRequired } : field
        );
        setValue('open_test.custom_fields', updatedFields);
    };

    const patchField = (
        id: string,
        patch: Partial<(typeof customFieldsArray)[number]>
    ) => {
        const updatedFields = customFieldsArray?.map((field) =>
            field.id === id ? { ...field, ...patch } : field
        );
        setValue('open_test.custom_fields', updatedFields);
    };

    const handleDuplicateField = (id: string) => {
        const sourceIndex = customFieldsArray.findIndex((f) => f.id === id);
        const source = customFieldsArray[sourceIndex];
        if (!source) return;
        // A fresh id keeps this an "added" row for the save-time diff, which
        // matches by id — reusing the source id would read as an edit instead.
        const newId = nextFieldId();
        const updatedFields = [
            ...customFieldsArray.slice(0, sourceIndex + 1),
            { ...source, id: newId, name: `${source.name} (copy)`, oldKey: false, key: '' },
            ...customFieldsArray.slice(sourceIndex + 1),
        ].map((f, idx) => ({ ...f, order: idx }));
        setValue('open_test.custom_fields', updatedFields);
        setEditingFieldId(newId);
    };

    const handleAddOpenFieldValues = (type: string, name: string, oldKey: boolean) => {
        // Add the new field to the array
        const updatedFields = [
            ...customFields,
            {
                id: nextFieldId(),
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
        const updatedFields = customFieldsArray
            .filter((field) => field.id !== id)
            .map((field, index) => ({
                ...field,
                order: index, // Update order of remaining fields
            }));
        setValue('open_test.custom_fields', updatedFields);
    };

    const handleAddGender = (type: string, name: string, oldKey: boolean) => {
        // Create the new field
        const newField = {
            id: nextFieldId(),
            type,
            name,
            oldKey,
            ...(type === 'dropdown' && {
                options: [
                    {
                        id: '0',
                        value: 'MALE',
                        disabled: true,
                    },
                    {
                        id: '1',
                        value: 'FEMALE',
                        disabled: true,
                    },
                    {
                        id: '2',
                        value: 'OTHER',
                        disabled: true,
                    },
                ],
            }), // Include options if type is dropdown
            isRequired: true,
            key: '',
            order: customFields.length,
        };

        // Add the new field to the array
        const updatedFields = [...customFields, newField];

        // Update the form state
        setValue('open_test.custom_fields', updatedFields);
    };

    const handleAddCustomField = (
        type: string,
        name: string,
        oldKey: boolean,
        options?: DropdownOption[],
        config?: CustomFieldConfig
    ) => {
        const newField = {
            id: nextFieldId(),
            type,
            name,
            oldKey,
            ...(options && { options: options.map((opt) => ({ id: String(opt.id), value: opt.value, disabled: true })) }),
            isRequired: config?.isRequired ?? true,
            // Help text and the rest of the per-field settings — previously dropped here,
            // which is why help text never reached the learner form.
            config: serializeFieldConfig(config),
            key: '',
            order: customFields.length,
        };
        const updatedFields = [...customFields, newField];
        setValue('open_test.custom_fields', updatedFields);
    };

    // Same dialog as "Add Custom Field", prefilled — so type, label, options and
    // required all stay editable from one place. The id is kept so the save-time
    // diff still reads this as an update rather than an add + remove.
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
            // Help text and the rest of the per-field settings. '' when there are none, so
            // clearing help text clears it server-side instead of leaving the old value.
            config: serializeFieldConfig(config),
            // Dropping the options on a switch to a non-choice type stops stale
            // values from reappearing if the admin switches back.
            options: options?.map((opt, index) => ({
                id: String(index),
                value: opt.value,
                disabled: false,
            })),
        });
        setEditingFieldId(null);
    };

    // Function that explicitly updates the order property of all fields
    const updateFieldOrders = () => {
        const currentFields = getValues('open_test.custom_fields');

        if (!currentFields) return;

        // Create a copy with updated order values matching their array positions
        const updatedFields = currentFields.map((field, index) => ({
            ...field,
            order: index,
        }));

        // Update the form values
        setValue('open_test.custom_fields', updatedFields, {
            shouldDirty: true,
            shouldTouch: true,
        });
    };

    const { data: studentList } = useSuspenseQuery(
        handleGetIndividualStudentList({ instituteId, assessmentId })
    );

    // Helper functions for student list processing
    const isAdminPreRegistered = (user: Step3ParticipantsListIndiviudalStudentInterface): boolean => {
        return user.source === 'ADMIN_PRE_REGISTRATION';
    };

    const transformUserToStudentDetails = (user: Step3ParticipantsListIndiviudalStudentInterface) => ({
        username: user.username,
        user_id: user.userId,
        email: user.userEmail,
        full_name: user.participantName,
        mobile_number: user.phoneNumber,
        guardian_email: '',
        guardian_mobile_number: '',
        file_id: user.faceFileId,
        reattempt_count: user.reattemptCount,
    });

    // Helper function to get checked student list
    const getCheckedStudentList = () => {
        return studentList
            .filter(isAdminPreRegistered)
            .map(transformUserToStudentDetails);
    };

    // Helper functions for notification settings
    const getNotificationTimeValue = (timeInMinutes: number | undefined): string => {
        return timeInMinutes ? `${timeInMinutes} min` : '1 min';
    };

    const getNotificationChecked = (timeInMinutes: number | undefined): boolean => {
        return timeInMinutes !== 0;
    };

    const getStudentNotificationSettings = (notifications: any) => ({
        when_assessment_created: notifications?.participant_when_assessment_created || false,
        before_assessment_goes_live: {
            checked: getNotificationChecked(notifications?.participant_before_assessment_goes_live),
            value: getNotificationTimeValue(notifications?.participant_before_assessment_goes_live),
        },
        when_assessment_live: notifications?.participant_when_assessment_live || false,
        when_assessment_report_generated: notifications?.participant_when_assessment_report_generated || false,
    });

    const getParentNotificationSettings = (notifications: any) => ({
        when_assessment_created: notifications?.parent_when_assessment_created || false,
        before_assessment_goes_live: {
            checked: getNotificationChecked(notifications?.parent_before_assessment_goes_live),
            value: getNotificationTimeValue(notifications?.parent_before_assessment_goes_live),
        },
        when_assessment_live: notifications?.parent_when_assessment_live || false,
        when_student_appears: true,
        when_student_finishes_test: true,
        when_assessment_report_generated: notifications?.parent_when_assessment_report_generated || false,
    });

    // Helper function to get notification settings
    const getNotificationSettings = () => {
        const notifications = assessmentDetails[currentStep]?.saved_data?.notifications;

        return {
            notify_student: getStudentNotificationSettings(notifications),
            notify_parent: getParentNotificationSettings(notifications),
        };
    };

    // Helper function to get open test settings
    const getOpenTestSettings = (savedData: any) => ({
        checked: assessmentDetails[0]?.saved_data?.assessment_visibility === 'PUBLIC',
        start_date: savedData?.registration_open_date
            ? convertDateFormat(savedData.registration_open_date)
            : '',
        end_date: savedData?.registration_close_date
            ? convertDateFormat(savedData.registration_close_date)
            : '',
        instructions: '',
        custom_fields: getCustomFieldsWhileEditStep3(assessmentDetails),
    });

    // Helper function to get batch selection settings
    const getBatchSelectionSettings = () => ({
        checked: true,
        batch_details: Object.fromEntries(
            Object.entries(transformedBatches).map(([key, value]) => [
                key,
                value.map((item) => item.id),
            ])
        ),
    });

    // Helper function to get individual selection settings
    const getIndividualSelectionSettings = () => ({
        checked: false,
        student_details: getCheckedStudentList(),
    });

    // Helper function to get initial form values
    const getInitialFormValues = () => {
        const checkedStudentList = getCheckedStudentList();
        const notificationSettings = getNotificationSettings();
        const savedData = assessmentDetails[currentStep]?.saved_data;

        return {
            status: completedSteps[currentStep] ? 'COMPLETE' : 'INCOMPLETE',
            closed_test: assessmentDetails[0]?.saved_data?.assessment_visibility === 'PRIVATE',
            open_test: getOpenTestSettings(savedData),
            select_batch: getBatchSelectionSettings(),
            select_individually: getIndividualSelectionSettings(),
            join_link: getJoinLink(),
            show_leaderboard: getShowLeaderboardSetting(savedData),
            ...notificationSettings,
        };
    };

    const getJoinLink = () => {
        return getAssessmentJoinLink(
            instituteDetails?.learner_portal_base_url,
            assessmentDetails[0]?.saved_data.assessment_url
        );
    };

    const getShowLeaderboardSetting = (savedData: any) => {
        return savedData?.notifications?.participant_show_leaderboard || false;
    };

    useEffect(() => {
        if (assessmentId !== 'defaultId') {
            const initialValues = getInitialFormValues();

            // Store the initial values in the ref
            oldFormData.current = JSON.parse(JSON.stringify(initialValues));

            // Reset form with these values
            form.reset(initialValues);
        }
    }, [assessmentId, assessmentDetails, storeDataStep3, selectedSection]);

    if (isLoading) return <DashboardLoader />;

    return (
        <FormProvider {...form}>
            <form className="flex flex-col gap-6">
                <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                        <div className="flex size-11 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-primary-400 text-white shadow-sm">
                            <Users size={22} weight="bold" />
                        </div>
                        <div>
                            <h1 className="text-h2-semibold tracking-tight">{t('header.title')}</h1>
                            <p className="mt-1 text-sm text-neutral-500">
                                {t('header.description')}
                            </p>
                        </div>
                    </div>
                    <MyButton
                        type="button"
                        scale="large"
                        buttonType="primary"
                        className="group gap-2 shadow-sm hover:shadow-md"
                        onClick={handleSubmit(onSubmit, onInvalid)}
                    >
                        {assessmentId !== 'defaultId' ? t('header.updateButton') : t('header.nextButton')}
                        <ArrowRight
                            size={18}
                            weight="bold"
                            className="transition-transform group-hover:translate-x-0.5"
                        />
                    </MyButton>
                </div>
                <div className="flex flex-col gap-6">
                    <Card className="border-neutral-200/80 shadow-sm" id="open-assessment">
                        <CardHeader className="flex flex-row items-start gap-3 space-y-0 pb-4">
                            <div className="flex size-9 items-center justify-center rounded-lg bg-primary-50 text-primary-500">
                                <Lock size={18} weight="bold" />
                            </div>
                            <div>
                                <CardTitle className="text-subtitle font-semibold">
                                    {t('accessSettings.cardTitle')}
                                </CardTitle>
                                <CardDescription>
                                    {t('accessSettings.cardDescription')}
                                </CardDescription>
                            </div>
                        </CardHeader>
                        <CardContent>
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
                                            className="grid grid-cols-1 gap-3 md:grid-cols-2"
                                        >
                                            {getStepKey({
                                                assessmentDetails,
                                                currentStep,
                                                key: 'closed_link',
                                            }) === 'REQUIRED' && (
                                                <FormItem className="space-y-0">
                                                    <label
                                                        className={cn(
                                                            'flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-all hover:border-primary-300 hover:bg-primary-50/30',
                                                            getValues('closed_test')
                                                                ? 'border-primary-500 bg-primary-50/60 shadow-sm ring-1 ring-primary-200'
                                                                : 'border-neutral-200'
                                                        )}
                                                    >
                                                        <FormControl>
                                                            <RadioGroupItem
                                                                value="CLOSE_TEST"
                                                                className="mt-1"
                                                            />
                                                        </FormControl>
                                                        <div className="flex-1">
                                                            <div className="flex items-center gap-2">
                                                                <Lock
                                                                    size={15}
                                                                    weight="bold"
                                                                    className="text-primary-500"
                                                                />
                                                                <FormLabel className="cursor-pointer text-sm font-semibold text-neutral-800">
                                                                    {t('accessSettings.closedTest.label')}
                                                                </FormLabel>
                                                            </div>
                                                            <p className="mt-1 text-xs text-neutral-500">
                                                                {t(
                                                                    examType === 'SURVEY'
                                                                        ? 'accessSettings.closedTest.descriptionSurvey'
                                                                        : 'accessSettings.closedTest.descriptionAssessment',
                                                                    {
                                                                        term: getTerminology(
                                                                            RoleTerms.Learner,
                                                                            SystemTerms.Learner
                                                                        ).toLocaleLowerCase(),
                                                                    }
                                                                )}
                                                            </p>
                                                        </div>
                                                    </label>
                                                </FormItem>
                                            )}
                                            {getStepKey({
                                                assessmentDetails,
                                                currentStep,
                                                key: 'open_link',
                                            }) === 'REQUIRED' && (
                                                <FormItem className="space-y-0">
                                                    <label
                                                        className={cn(
                                                            'flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-all hover:border-primary-300 hover:bg-primary-50/30',
                                                            watch('open_test.checked')
                                                                ? 'border-primary-500 bg-primary-50/60 shadow-sm ring-1 ring-primary-200'
                                                                : 'border-neutral-200'
                                                        )}
                                                    >
                                                        <FormControl>
                                                            <RadioGroupItem
                                                                value="OPEN_TEST"
                                                                className="mt-1"
                                                            />
                                                        </FormControl>
                                                        <div className="flex-1">
                                                            <div className="flex items-center gap-2">
                                                                <Globe
                                                                    size={15}
                                                                    weight="bold"
                                                                    className="text-primary-500"
                                                                />
                                                                <FormLabel className="cursor-pointer text-sm font-semibold text-neutral-800">
                                                                    {t('accessSettings.openTest.label')}
                                                                </FormLabel>
                                                            </div>
                                                            <p className="mt-1 text-xs text-neutral-500">
                                                                {t(
                                                                    examType === 'SURVEY'
                                                                        ? 'accessSettings.openTest.descriptionSurvey'
                                                                        : 'accessSettings.openTest.descriptionAssessment',
                                                                    {
                                                                        term: getTerminology(
                                                                            RoleTerms.Learner,
                                                                            SystemTerms.Learner
                                                                        ).toLocaleLowerCase(),
                                                                    }
                                                                )}
                                                            </p>
                                                        </div>
                                                    </label>
                                                </FormItem>
                                            )}
                                        </RadioGroup>
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                        </CardContent>
                    </Card>
                    {watch('open_test.checked') && (
                        <>
                            <div className="mt-2 flex flex-col gap-4">
                                <h1>{examType === 'SURVEY' ? t('registration.titleSurvey') : t('registration.titleAssessment')}</h1>
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
                                <h1 className="-mb-5">{examType === 'SURVEY' ? t('registration.aboutTitleSurvey') : t('registration.aboutTitleAssessment')}</h1>
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
                                                    placeholder={t('registration.instructionsPlaceholder')}
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
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div className="flex flex-col">
                                            <h1>{t('registration.formFieldsTitle')}</h1>
                                            <p className="text-caption text-neutral-500">
                                                {t('registration.formFieldsSubtitle')}
                                            </p>
                                        </div>
                                    </div>
                                    <FormFieldRowHeader />
                                    <div className="flex flex-col gap-4">
                                        <Sortable
                                            value={customFieldsArray}
                                            onMove={({ activeIndex, overIndex }) => {
                                                moveCustomField(activeIndex, overIndex);
                                                updateFieldOrders();
                                            }}
                                        >
                                            <div className="flex flex-col gap-4">
                                                {customFieldsArray.map((field, index) => {
                                                    const isEditingField =
                                                        editingFieldId === field.id;
                                                    return (
                                                        <SortableItem
                                                            key={field.id}
                                                            value={field.id}
                                                            asChild
                                                        >
                                                            <div>
                                                                <FormFieldRow
                                                                    position={index + 1}
                                                                    name={field.name}
                                                                    type={field.type}
                                                                    isRequired={field.isRequired}
                                                                    isEditing={isEditingField}
                                                                    onToggleRequired={() =>
                                                                        toggleIsRequired(field.id)
                                                                    }
                                                                    onEdit={() =>
                                                                        setEditingFieldId(field.id)
                                                                    }
                                                                    onDuplicate={() =>
                                                                        handleDuplicateField(
                                                                            field.id
                                                                        )
                                                                    }
                                                                    onDelete={() =>
                                                                        handleDeleteOpenField(
                                                                            field.id
                                                                        )
                                                                    }
                                                                    dragHandle={
                                                                        <SortableDragHandle
                                                                            variant="ghost"
                                                                            size="icon"
                                                                            className="cursor-grab"
                                                                        >
                                                                            <DotsSixVertical
                                                                                size={18}
                                                                            />
                                                                        </SortableDragHandle>
                                                                    }
                                                                />
                                                            </div>
                                                        </SortableItem>
                                                    );
                                                })}
                                            </div>
                                        </Sortable>
                                    </div>
                                    <div className="rounded-lg border border-dashed border-neutral-300 py-4 text-center text-caption text-neutral-500">
                                        {t('registration.addFieldHint')}
                                    </div>
                                    <div className="mt-2 flex flex-wrap items-center gap-6">
                                        {!customFields?.some(
                                            (field) => field.name === 'Gender'
                                        ) && (
                                            <MyButton
                                                type="button"
                                                scale="medium"
                                                buttonType="secondary"
                                                onClick={() =>
                                                    handleAddGender('dropdown', 'Gender', false)
                                                }
                                            >
                                                <Plus size={32} /> {t('registration.addGender')}
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
                                                <Plus size={32} /> {t('registration.addState')}
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
                                                <Plus size={32} /> {t('registration.addCity')}
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
                                                <Plus size={32} /> {t('registration.addSchoolCollege')}
                                            </MyButton>
                                        )}
                                        <SharedAddCustomFieldDialog
                                            trigger={
                                                <MyButton
                                                    type="button"
                                                    scale="medium"
                                                    buttonType="secondary"
                                                >
                                                    <Plus size={32} /> {t('registration.addCustomField')}
                                                </MyButton>
                                            }
                                            onAddField={handleAddCustomField}
                                            existingFieldNames={customFieldsArray
                                                .filter((f) => (f as any).status !== 'DELETED')
                                                .map((f) => f.name)}
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
                                                config: parseFieldConfig(editingField.config),
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
                                            existingFieldNames={customFieldsArray
                                                .filter(
                                                    (f) =>
                                                        f.id !== editingField.id &&
                                                        (f as any).status !== 'DELETED'
                                                )
                                                .map((f) => f.name)}
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
                                                {t('registration.previewButton')}
                                            </MyButton>
                                        </DialogTrigger>
                                        <DialogContent className="p-0">
                                            <h1 className="rounded-md bg-primary-50 p-4 font-semibold text-primary-500">
                                                {t('registration.previewDialogTitle')}
                                            </h1>
                                            <div className="flex max-h-dialog-tall flex-col gap-4 overflow-y-auto px-4 py-2">
                                                {customFields?.map((testInputFields, idx) => {
                                                    const fieldConfig = parseFieldConfig(
                                                        testInputFields.config
                                                    );
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
                                                                config={fieldConfig}
                                                            />
                                                            {/* Same hint the learner sees under
                                                                the field, so the preview matches. */}
                                                            {fieldConfig?.helpText && (
                                                                <p className="text-caption text-neutral-500">
                                                                    {fieldConfig.helpText}
                                                                </p>
                                                            )}
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
                                                        {t('registration.registerNowButton')}
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
                    {/* Display validation errors for participant selection */}
                    {form.formState.errors.select_individually?.student_details?.message && (
                        <div className="text-sm text-red-600 mt-2" data-error="true">
                            {form.formState.errors.select_individually.student_details.message}
                        </div>
                    )}
                    {form.formState.errors.select_batch?.batch_details?.message && (
                        <div className="text-sm text-red-600 mt-2" data-error="true">
                            {String(form.formState.errors.select_batch.batch_details.message)}
                        </div>
                    )}
                    <Card
                        className="border-neutral-200/80 shadow-sm"
                        id="join-link-qr-code"
                    >
                        <CardHeader className="flex flex-row items-start gap-3 space-y-0 pb-4">
                            <div className="flex size-9 items-center justify-center rounded-lg bg-info-50 text-info-600">
                                <LinkSimple size={18} weight="bold" />
                            </div>
                            <div>
                                <CardTitle className="text-subtitle font-semibold">
                                    {t('shareAccess.cardTitle')}
                                </CardTitle>
                                <CardDescription>
                                    {t('shareAccess.cardDescription')}
                                </CardDescription>
                            </div>
                        </CardHeader>
                        <CardContent className="flex flex-col items-start gap-6 md:flex-row md:items-center md:justify-between">
                            <div className="flex flex-1 flex-col gap-2">
                                <label className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                                    {t('shareAccess.joinLinkLabel')}
                                </label>
                                <div className="flex items-center gap-2">
                                    <FormField
                                        control={control}
                                        name="join_link"
                                        render={({ field: { ...field } }) => (
                                            <FormItem className="flex-1">
                                                <FormControl>
                                                    <MyInput
                                                        inputType="text"
                                                        inputPlaceholder={t('shareAccess.joinLinkPlaceholder')}
                                                        input={field.value}
                                                        onChangeFunction={field.onChange}
                                                        error={
                                                            form.formState.errors.join_link?.message
                                                        }
                                                        size="large"
                                                        {...field}
                                                        className="w-full"
                                                    />
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => copyToClipboard(getValues('join_link'))}
                                        className="flex size-10 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-600 transition-all hover:border-primary-400 hover:bg-primary-50/30 hover:text-primary-600"
                                        aria-label={t('shareAccess.copyJoinLinkAriaLabel')}
                                    >
                                        <Copy size={18} weight="bold" />
                                    </button>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <div className="flex flex-col items-center gap-1">
                                    <div className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
                                        <QrCode size={12} weight="bold" />
                                        {t('shareAccess.qrCodeLabel')}
                                    </div>
                                    <FormField
                                        control={control}
                                        name="join_link"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormControl>
                                                    <div className="rounded-lg border border-neutral-200 bg-white p-2 shadow-sm">
                                                        <QRCode
                                                            value={field.value ?? ''}
                                                            className="size-20"
                                                            id="qr-code-svg"
                                                        />
                                                    </div>
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
                                </div>
                                <button
                                    type="button"
                                    onClick={() => handleDownloadQRCode('qr-code-svg')}
                                    className="flex size-10 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-600 transition-all hover:border-primary-400 hover:bg-primary-50/30 hover:text-primary-600"
                                    aria-label={t('shareAccess.downloadQrAriaLabel')}
                                >
                                    <DownloadSimple size={18} weight="bold" />
                                </button>
                            </div>
                        </CardContent>
                    </Card>
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
                    <Card className="border-neutral-200/80 shadow-sm" id="notify-via-email">
                        <CardHeader className="flex flex-row items-start gap-3 space-y-0 pb-4">
                            <div className="flex size-9 items-center justify-center rounded-lg bg-warning-50 text-warning-600">
                                <Bell size={18} weight="bold" />
                            </div>
                            <div>
                                <CardTitle className="text-subtitle font-semibold">
                                    {t('notifications.cardTitle')}
                                </CardTitle>
                                <CardDescription>
                                    {t('notifications.cardDescription')}
                                </CardDescription>
                            </div>
                        </CardHeader>
                        <CardContent className="grid grid-cols-1 gap-6 md:grid-cols-2">
                        {getStepKey({
                            assessmentDetails,
                            currentStep,
                            key: 'notify_participants',
                        }) === 'REQUIRED' && (
                            <div className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-neutral-50/40 p-4">
                                <div className="flex items-center gap-2 pb-1">
                                    <div className="flex size-7 items-center justify-center rounded-md bg-primary-100 text-primary-600">
                                        <Student size={15} weight="bold" />
                                    </div>
                                    <h3 className="text-sm font-semibold text-neutral-800">
                                        {t('notifications.participants.sectionTitle')}
                                    </h3>
                                </div>
                                <FormField
                                    control={control}
                                    name={`notify_student.when_assessment_created`}
                                    render={({ field }) => (
                                        <FormItem className="flex items-center gap-2.5 space-y-0 rounded-lg px-2 py-1.5 transition-colors hover:bg-white">
                                            <FormControl>
                                                <Checkbox
                                                    checked={field.value}
                                                    onCheckedChange={field.onChange}
                                                    className={`size-4 rounded-sm border-2 shadow-none ${
                                                        field.value
                                                            ? 'border-none bg-primary-500 text-white'
                                                            : ''
                                                    }`}
                                                />
                                            </FormControl>
                                            <FormLabel className="!mt-0 cursor-pointer text-sm font-normal text-neutral-700">
                                                {examType === 'SURVEY' ? t('notifications.items.whenCreatedSurvey') : t('notifications.items.whenCreatedAssessment')}
                                            </FormLabel>
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={control}
                                    name={`notify_student.before_assessment_goes_live.checked`}
                                    render={({ field }) => (
                                        <FormItem className="flex items-center gap-2.5 space-y-0 rounded-lg px-2 py-1.5 transition-colors hover:bg-white">
                                            <FormControl>
                                                <Checkbox
                                                    checked={field.value}
                                                    onCheckedChange={field.onChange}
                                                    className={`size-4 rounded-sm border-2 shadow-none ${
                                                        field.value
                                                            ? 'border-none bg-primary-500 text-white'
                                                            : ''
                                                    }`}
                                                />
                                            </FormControl>
                                            <FormLabel className="!mt-0 cursor-pointer text-sm font-normal text-neutral-700">
                                                {examType === 'SURVEY' ? t('notifications.items.beforeLiveSurvey') : t('notifications.items.beforeLiveAssessment')}
                                            </FormLabel>
                                        </FormItem>
                                    )}
                                />
                                {watch('notify_student.before_assessment_goes_live')?.checked && (
                                    <SelectField
                                        label={t('notifications.notifyBeforeLabel')}
                                        labelStyle="font-thin"
                                        name="notify_student.before_assessment_goes_live.value"
                                        options={timeLimit.map((option, index) => ({
                                            value: option,
                                            label: option,
                                            _id: index,
                                        }))}
                                        control={form.control}
                                        required
                                        className="ms-2 w-full max-w-56 font-normal"
                                    />
                                )}
                                <FormField
                                    control={control}
                                    name={`notify_student.when_assessment_live`}
                                    render={({ field }) => (
                                        <FormItem className="flex items-center gap-2.5 space-y-0 rounded-lg px-2 py-1.5 transition-colors hover:bg-white">
                                            <FormControl>
                                                <Checkbox
                                                    checked={field.value}
                                                    onCheckedChange={field.onChange}
                                                    className={`size-4 rounded-sm border-2 shadow-none ${
                                                        field.value
                                                            ? 'border-none bg-primary-500 text-white'
                                                            : ''
                                                    }`}
                                                />
                                            </FormControl>
                                            <FormLabel className="!mt-0 cursor-pointer text-sm font-normal text-neutral-700">
                                                {examType === 'SURVEY' ? t('notifications.items.whenLiveSurvey') : t('notifications.items.whenLiveAssessment')}
                                            </FormLabel>
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={control}
                                    name={`notify_student.when_assessment_report_generated`}
                                    render={({ field }) => (
                                        <FormItem className="flex items-center gap-2.5 space-y-0 rounded-lg px-2 py-1.5 transition-colors hover:bg-white">
                                            <FormControl>
                                                <Checkbox
                                                    checked={field.value}
                                                    onCheckedChange={field.onChange}
                                                    className={`size-4 rounded-sm border-2 shadow-none ${
                                                        field.value
                                                            ? 'border-none bg-primary-500 text-white'
                                                            : ''
                                                    }`}
                                                />
                                            </FormControl>
                                            <FormLabel className="!mt-0 cursor-pointer text-sm font-normal text-neutral-700">
                                                {examType === 'SURVEY' ? t('notifications.items.reportGeneratedSurvey') : t('notifications.items.reportGeneratedAssessment')}
                                            </FormLabel>
                                        </FormItem>
                                    )}
                                />
                            </div>
                        )}
                        {(examType === 'SURVEY' || getStepKey({
                            assessmentDetails,
                            currentStep,
                            key: "notify_parents",
                        }) === "REQUIRED") && (
                            <div className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-neutral-50/40 p-4">
                                <div className="flex items-center gap-2 pb-1">
                                    <div className="flex size-7 items-center justify-center rounded-md bg-info-100 text-info-600">
                                        <UsersFour size={15} weight="bold" />
                                    </div>
                                    <h3 className="text-sm font-semibold text-neutral-800">
                                        {examType === 'SURVEY'
                                            ? t('notifications.parents.sectionTitleSurvey')
                                            : t('notifications.parents.sectionTitleAssessment')}
                                    </h3>
                                </div>
                                <FormField
                                    control={control}
                                    name={`notify_parent.when_assessment_created`}
                                    render={({ field }) => (
                                        <FormItem className="flex items-center gap-2.5 space-y-0 rounded-lg px-2 py-1.5 transition-colors hover:bg-white">
                                            <FormControl>
                                                <Checkbox
                                                    checked={field.value}
                                                    onCheckedChange={field.onChange}
                                                    className={`size-4 rounded-sm border-2 shadow-none ${
                                                        field.value
                                                            ? 'border-none bg-primary-500 text-white'
                                                            : ''
                                                    }`}
                                                />
                                            </FormControl>
                                            <FormLabel className="!mt-0 cursor-pointer text-sm font-normal text-neutral-700">
                                                {examType === 'SURVEY' ? t('notifications.items.whenCreatedSurvey') : t('notifications.items.whenCreatedAssessment')}
                                            </FormLabel>
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={control}
                                    name={`notify_parent.before_assessment_goes_live.checked`}
                                    render={({ field }) => (
                                        <FormItem className="flex items-center gap-2.5 space-y-0 rounded-lg px-2 py-1.5 transition-colors hover:bg-white">
                                            <FormControl>
                                                <Checkbox
                                                    checked={field.value}
                                                    onCheckedChange={field.onChange}
                                                    className={`size-4 rounded-sm border-2 shadow-none ${
                                                        field.value
                                                            ? 'border-none bg-primary-500 text-white'
                                                            : ''
                                                    }`}
                                                />
                                            </FormControl>
                                            <FormLabel className="!mt-0 cursor-pointer text-sm font-normal text-neutral-700">
                                                {examType === 'SURVEY' ? t('notifications.items.beforeLiveSurvey') : t('notifications.items.beforeLiveAssessment')}
                                            </FormLabel>
                                        </FormItem>
                                    )}
                                />
                                {watch("notify_parent.before_assessment_goes_live").checked && (
                                    <SelectField
                                        label={t('notifications.notifyBeforeLabel')}
                                        labelStyle="font-thin"
                                        name="notify_parent.before_assessment_goes_live.value"
                                        options={timeLimit.map((option, index) => ({
                                            value: option,
                                            label: option,
                                            _id: index,
                                        }))}
                                        control={form.control}
                                        required
                                        className="ms-2 w-full max-w-56 font-normal"
                                    />
                                )}
                                <FormField
                                    control={control}
                                    name={`notify_parent.when_assessment_live`}
                                    render={({ field }) => (
                                        <FormItem className="flex items-center gap-2.5 space-y-0 rounded-lg px-2 py-1.5 transition-colors hover:bg-white">
                                            <FormControl>
                                                <Checkbox
                                                    checked={field.value}
                                                    onCheckedChange={field.onChange}
                                                    className={`size-4 rounded-sm border-2 shadow-none ${
                                                        field.value
                                                            ? 'border-none bg-primary-500 text-white'
                                                            : ''
                                                    }`}
                                                />
                                            </FormControl>
                                            <FormLabel className="!mt-0 cursor-pointer text-sm font-normal text-neutral-700">
                                                {examType === 'SURVEY' ? t('notifications.items.whenLiveSurvey') : t('notifications.items.whenLiveAssessment')}
                                            </FormLabel>
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={control}
                                    name={`notify_parent.when_student_appears`}
                                    render={({ field }) => (
                                        <FormItem className="flex items-center gap-2.5 space-y-0 rounded-lg px-2 py-1.5 transition-colors hover:bg-white">
                                            <FormControl>
                                                <Checkbox
                                                    checked={field.value}
                                                    onCheckedChange={field.onChange}
                                                    className={`size-4 rounded-sm border-2 shadow-none ${
                                                        field.value
                                                            ? 'border-none bg-primary-500 text-white'
                                                            : ''
                                                    }`}
                                                />
                                            </FormControl>
                                            <FormLabel className="!mt-0 cursor-pointer text-sm font-normal text-neutral-700">
                                                {examType === 'SURVEY' ? t('notifications.parents.whenStudentAppearsSurvey') : t('notifications.parents.whenStudentAppearsAssessment')}
                                            </FormLabel>
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={control}
                                    name={`notify_parent.when_student_finishes_test`}
                                    render={({ field }) => (
                                        <FormItem className="flex items-center gap-2.5 space-y-0 rounded-lg px-2 py-1.5 transition-colors hover:bg-white">
                                            <FormControl>
                                                <Checkbox
                                                    checked={field.value}
                                                    onCheckedChange={field.onChange}
                                                    className={`size-4 rounded-sm border-2 shadow-none ${
                                                        field.value
                                                            ? 'border-none bg-primary-500 text-white'
                                                            : ''
                                                    }`}
                                                />
                                            </FormControl>
                                            <FormLabel className="!mt-0 cursor-pointer text-sm font-normal text-neutral-700">
                                                {examType === 'SURVEY' ? t('notifications.parents.whenStudentFinishesSurvey') : t('notifications.parents.whenStudentFinishesAssessment')}
                                            </FormLabel>
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={control}
                                    name={`notify_parent.when_assessment_report_generated`}
                                    render={({ field }) => (
                                        <FormItem className="flex items-center gap-2.5 space-y-0 rounded-lg px-2 py-1.5 transition-colors hover:bg-white">
                                            <FormControl>
                                                <Checkbox
                                                    checked={field.value}
                                                    onCheckedChange={field.onChange}
                                                    className={`size-4 rounded-sm border-2 shadow-none ${
                                                        field.value
                                                            ? 'border-none bg-primary-500 text-white'
                                                            : ''
                                                    }`}
                                                />
                                            </FormControl>
                                            <FormLabel className="!mt-0 cursor-pointer text-sm font-normal text-neutral-700">
                                                {examType === 'SURVEY' ? t('notifications.items.reportGeneratedSurvey') : t('notifications.items.reportGeneratedAssessment')}
                                            </FormLabel>
                                        </FormItem>
                                    )}
                                />
                            </div>
                        )}
                        </CardContent>
                    </Card>
                </div>
            </form>
        </FormProvider>
    );
};

export default Step3AddingParticipants;
