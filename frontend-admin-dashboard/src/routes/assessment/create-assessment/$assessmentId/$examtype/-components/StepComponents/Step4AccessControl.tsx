import { StepContentProps } from '@/types/assessments/step-content-props';
import React, { Dispatch, SetStateAction, useEffect, useRef, useState } from 'react';
import { FormProvider, useForm, UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { AccessControlFormSchema } from '../../-utils/access-control-form-schema';
import { MyButton } from '@/components/design-system/button';
import { Separator } from '@/components/ui/separator';
import { Info, Plus, X } from '@phosphor-icons/react';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import {
    getAssessmentDetails,
    handlePostStep4Data,
    publishAssessment,
} from '../../-services/assessment-services';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { getStepKey, syncStep4DataWithStore } from '../../-utils/helper';
import { zodResolver } from '@hookform/resolvers/zod';
import { useSavedAssessmentStore } from '../../-utils/global-states';
import { toast } from 'sonner';
import { reportApiError } from '@/lib/report-api-error';
import { useAccessControlStore } from '../../-utils/zustand-global-states/step4-access-control';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useSectionDetailsStore } from '../../-utils/zustand-global-states/step2-add-questions';
import { useTestAccessStore } from '../../-utils/zustand-global-states/step3-adding-participants';
import { useBasicInfoStore } from '../../-utils/zustand-global-states/step1-basic-info';
import { getInstituteId } from '@/constants/helper';
import {
    fetchInstituteDashboardUsers,
    handleDeleteDisableDashboardUsers,
} from '@/routes/dashboard/-services/dashboard-services';
import { RoleTypeUserIcon } from '@/svgs';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import RoleTypeFilterButtons from '@/routes/dashboard/-components/RoleTypeFilterButtons';
import { ScheduleTestFilters } from '@/routes/assessment/assessment-list/-components/ScheduleTestFilters';
import { RoleType } from '@/constants/dummy-data';
import { MyFilterOption } from '@/types/assessments/my-filter';
import { RoleTypeSelectedFilter } from '@/routes/dashboard/-components/RoleTypeComponent';
import { UserRolesDataEntry } from '@/types/dashboard/user-roles';
import Step4InviteUsers from './-components/Step4InviteUsers';
import { usePendingFolderPrompt } from '@/components/common/assessment-folders/pending-folder-prompt';

interface Role {
    roleId: string;
    roleName: string;
}

// User Interface
interface InvitedUsersInterface {
    userId: string;
    email: string;
    name: string;
    roles: Role[];
    status: string;
}

// Define the type from the schema for better TypeScript inference
type AccessControlFormValues = z.infer<typeof AccessControlFormSchema>;
const Step4AccessControl: React.FC<StepContentProps> = ({
    currentStep,
    handleCompleteCurrentStep,
    completedSteps,
}) => {
    const { t } = useTranslation('assessmentStep4AccessControl');
    const instituteId = getInstituteId();
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const params = useParams({ strict: false });
    const examType = params.examtype ?? ''; // Ensure it's a string
    const assessmentId = params.assessmentId ?? null; // Ensure it's string | null
    const { savedAssessmentId, setSavedAssessmentId } = useSavedAssessmentStore();
    const { instituteDetails } = useInstituteDetailsStore();
    const { data: assessmentDetails, isLoading } = useSuspenseQuery(
        getAssessmentDetails({
            assessmentId: assessmentId !== 'defaultId' ? assessmentId : savedAssessmentId,
            instituteId: instituteDetails?.id,
            type: examType,
        })
    );
    const [isAdminLoading, setIsAdminLoading] = useState(false);
    // A ref, not state: the step-4 save's onSuccess reads this synchronously during the
    // same tick the publish flow sets it, which a state update would not guarantee.
    const isPublishingRef = useRef(false);
    const [existingInstituteUsersData, setExistingInstituteUsersData] = useState<
        InvitedUsersInterface[]
    >([]);
    const form = useForm<AccessControlFormValues>({
        resolver: zodResolver(AccessControlFormSchema),
        defaultValues: {
            status: completedSteps[currentStep] ? 'COMPLETE' : 'INCOMPLETE',
            assessment_creation_access: [],
            live_assessment_notification: [],
            assessment_submission_and_report_access: [],
            evaluation_process: [],
        },
        mode: 'onChange',
    });
    const { handleSubmit } = form;

    const handleSubmitStep4Form = useMutation({
        mutationFn: ({
            data,
            assessmentId,
            instituteId,
            type,
        }: {
            data: z.infer<typeof AccessControlFormSchema>;
            assessmentId: string | null;
            instituteId: string | undefined;
            type: string | undefined;
        }) => handlePostStep4Data(data, assessmentId, instituteId, type),
        onSuccess: async () => {
            queryClient.invalidateQueries({ queryKey: ['GET_QUESTIONS_DATA_FOR_SECTIONS'] });
            // Publishing runs this same save first. Let the publish mutation own the
            // toast, the store reset and the navigation, so the two do not both fire
            // and the user does not see "saved" flash past on the way to "published".
            if (isPublishingRef.current) return;
            if (assessmentId !== 'defaultId') {
                useAccessControlStore.getState().reset();
                window.history.back();
                toast.success(t('toasts.updateSuccess'), {
                    className: 'success-toast',
                    duration: 2000,
                });
                queryClient.invalidateQueries({ queryKey: ['GET_ASSESSMENT_DETAILS'] });
            } else {
                syncStep4DataWithStore(form);
                setSavedAssessmentId('');
                useBasicInfoStore.getState().reset();
                useSectionDetailsStore.getState().reset();
                useTestAccessStore.getState().reset();
                useAccessControlStore.getState().reset();
                toast.success(t('toasts.saveSuccess'), {
                    className: 'success-toast',
                    duration: 2000,
                });
                handleCompleteCurrentStep();
                navigate({
                    to: '/assessment/assessment-list',
                    params: {
                        selectedTab: 'liveTests',
                    },
                });
            }
        },
        onError: (error: unknown) => {
            reportApiError(error, {
                feature: 'assessment-step4-access-control',
                tags: { actionType: assessmentId !== 'defaultId' ? 'update' : 'create' },
                extra: { assessmentId, instituteId: instituteDetails?.id, examType },
                fallbackMessage: t('errors.saveFailed'),
            });
        },
    });

    const onSubmit = (data: z.infer<typeof AccessControlFormSchema>) => {
        handleSubmitStep4Form.mutate({
            data: data,
            assessmentId: assessmentId !== 'defaultId' ? assessmentId : savedAssessmentId,
            instituteId: instituteDetails?.id,
            type: examType,
        });
    };

    const handlePublishAssessmentMutation = useMutation({
        mutationFn: ({
            assessmentId,
            instituteId,
            type,
        }: {
            assessmentId: string | null;
            instituteId: string | undefined;
            type: string | undefined;
        }) => publishAssessment({ assessmentId, instituteId, type }),
        onSuccess: async (_data, variables) => {
            queryClient.invalidateQueries({ queryKey: ['GET_QUESTIONS_DATA_FOR_SECTIONS'] });
            if (assessmentId !== 'defaultId') {
                useAccessControlStore.getState().reset();
                window.history.back();
                toast.success(t('toasts.updatePublishSuccess'), {
                    className: 'success-toast',
                    duration: 2000,
                });
                queryClient.invalidateQueries({ queryKey: ['GET_ASSESSMENT_DETAILS'] });
            } else {
                // Read before the stores reset below.
                const publishedName =
                    useBasicInfoStore.getState().testCreation?.assessmentName ?? '';
                syncStep4DataWithStore(form);
                setSavedAssessmentId('');
                useBasicInfoStore.getState().reset();
                useSectionDetailsStore.getState().reset();
                useTestAccessStore.getState().reset();
                useAccessControlStore.getState().reset();
                toast.success(t('toasts.publishSuccess'), {
                    className: 'success-toast',
                    duration: 2000,
                });
                handleCompleteCurrentStep();
                queryClient.invalidateQueries({ queryKey: ['GET_ASSESSMENT_DETAILS'] });
                // With assessment folders on, the list asks which folder this goes in.
                if (variables.assessmentId) {
                    usePendingFolderPrompt.getState().setPending({
                        assessmentId: variables.assessmentId,
                        name: publishedName,
                    });
                }
                navigate({
                    to: '/assessment/assessment-list',
                });
            }
        },
        onError: (error: unknown) => {
            reportApiError(error, {
                feature: 'assessment-publish',
                tags: { actionType: assessmentId !== 'defaultId' ? 'update' : 'create' },
                extra: { assessmentId, instituteId: instituteDetails?.id, examType },
                fallbackMessage: t('errors.publishFailed'),
            });
        },
    });

    /**
     * Save the access-control step, THEN publish.
     *
     * This used to wrap the fire-and-forget `onSubmit(formData)` in a promise that
     * resolved immediately, so publish was dispatched while the step-4 save was still
     * in flight — the assessment could go live before its access rules had landed, and
     * whichever mutation finished second re-ran the toast/reset/navigate.
     */
    const handlePublishAssessment = async () => {
        if (isPublishingRef.current) return;
        isPublishingRef.current = true;
        try {
            await handleSubmitStep4Form.mutateAsync({
                data: form.getValues(),
                assessmentId: assessmentId !== 'defaultId' ? assessmentId : savedAssessmentId,
                instituteId: instituteDetails?.id,
                type: examType,
            });

            await handlePublishAssessmentMutation.mutateAsync({
                assessmentId: assessmentId !== 'defaultId' ? assessmentId : savedAssessmentId,
                instituteId: instituteDetails?.id,
                type: examType,
            });
        } catch (error) {
            // Both mutations report through reportApiError in their own onError; nothing
            // to add here beyond not publishing when the save failed.
        } finally {
            isPublishingRef.current = false;
        }
    };
    const onInvalid = (errors: unknown) => {
        // Surface the first problem instead of leaving the button looking dead.
        const firstField = Object.keys((errors as Record<string, unknown>) ?? {})[0];
        toast.error('Please fix the highlighted fields before continuing.', {
            className: 'error-toast',
            duration: 3000,
        });
        if (firstField) {
            document
                .querySelector(`[name="${firstField}"]`)
                ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    };

    useEffect(() => {
        const timeoutId = setTimeout(() => {
            setIsAdminLoading(true);
            fetchInstituteDashboardUsers(instituteId, {
                roles: [
                    { id: '1', name: 'ADMIN' },
                    { id: '2', name: 'CONTENT CREATOR' },
                    { id: '3', name: 'ASSESSMENT CREATOR' },
                    { id: '4', name: 'EVALUATOR' },
                    { id: '5', name: 'TEACHER' },
                ],
                status: [
                    { id: '1', name: 'ACTIVE' },
                    { id: '2', name: 'DISABLED' },
                    { id: '3', name: 'INVITED' },
                ],
            })
                .then((data) => {
                    const filteredData = data.map((user: UserRolesDataEntry) => ({
                        userId: user.id,
                        email: user.email,
                        name: user.full_name,
                        roles: Array.from(
                            new Map(
                                user.roles.map((role) => [
                                    role.role_id,
                                    {
                                        roleId: role.role_id,
                                        roleName: role.role_name,
                                    },
                                ])
                            ).values()
                        ),
                        status: user.status,
                    }));
                    setExistingInstituteUsersData(filteredData);
                    if (assessmentId !== 'defaultId') {
                        form.reset({
                            status: assessmentDetails[currentStep]?.status,
                            assessment_creation_access: filteredData.filter(
                                (user: InvitedUsersInterface) =>
                                    assessmentDetails[
                                        currentStep
                                    ]?.saved_data.creation_access.user_ids.includes(user.userId)
                            ),
                            live_assessment_notification: filteredData.filter(
                                (user: InvitedUsersInterface) =>
                                    assessmentDetails[
                                        currentStep
                                    ]?.saved_data.live_assessment_access.user_ids.includes(
                                        user.userId
                                    )
                            ),
                            assessment_submission_and_report_access: filteredData.filter(
                                (user: InvitedUsersInterface) =>
                                    assessmentDetails[
                                        currentStep
                                    ]?.saved_data.report_and_submission_access.user_ids.includes(
                                        user.userId
                                    )
                            ),
                            evaluation_process: filteredData.filter((user: InvitedUsersInterface) =>
                                assessmentDetails[
                                    currentStep
                                ]?.saved_data.evaluation_access.user_ids.includes(user.userId)
                            ),
                        });
                    }
                })
                .catch((error) => {
                    // Handle error silently
                })
                .finally(() => {
                    setIsAdminLoading(false);
                });
        }, 0);

        return () => clearTimeout(timeoutId);
    }, []);

    if (isLoading) return <DashboardLoader />;

    // Publishing now shows the loader too. Previously only the step-4 save did, so the
    // page stayed interactive during a publish and the button could be clicked again.
    // This unmounts both buttons for the whole publish, which — together with the
    // isPublishingRef re-entry guard — is what makes a double-click a no-op.
    if (
        isLoading ||
        handleSubmitStep4Form.status === 'pending' ||
        handlePublishAssessmentMutation.status === 'pending' ||
        isAdminLoading
    )
        return <DashboardLoader />;

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
                    <div className="flex items-center gap-6">
                        <MyButton
                            type="button"
                            scale="large"
                            buttonType="secondary"
                            onClick={handleSubmit(onSubmit, onInvalid)}
                        >
                            {assessmentId !== 'defaultId' ? t('header.update') : t('header.save')}
                        </MyButton>
                        <MyButton
                            type="button"
                            scale="large"
                            buttonType="primary"
                            onClick={handlePublishAssessment}
                        >
                            {t('header.publish')}
                        </MyButton>
                    </div>
                </div>
                <Separator className="my-4" />
                <div className="flex flex-col gap-4" id="access-users">
                    {getStepKey({
                        assessmentDetails,
                        currentStep,
                        key: 'creation_access',
                    }) === 'REQUIRED' && (
                        <AccessControlCards
                            heading={
                                examType === 'SURVEY'
                                    ? t('sections.creationAccessSurvey')
                                    : t('sections.creationAccess')
                            }
                            keyVal="assessment_creation_access"
                            form={form}
                            existingInstituteUsersData={existingInstituteUsersData}
                            setExistingInstituteUsersData={setExistingInstituteUsersData}
                        />
                    )}
                    {getStepKey({
                        assessmentDetails,
                        currentStep,
                        key: 'live_assessment_access',
                    }) === 'REQUIRED' && (
                        <AccessControlCards
                            heading={
                                examType === 'SURVEY'
                                    ? t('sections.liveNotificationSurvey')
                                    : t('sections.liveNotification')
                            }
                            keyVal="live_assessment_notification"
                            form={form}
                            existingInstituteUsersData={existingInstituteUsersData}
                            setExistingInstituteUsersData={setExistingInstituteUsersData}
                        />
                    )}
                    {getStepKey({
                        assessmentDetails,
                        currentStep,
                        key: 'report_and_submission_access',
                    }) === 'REQUIRED' && (
                        <AccessControlCards
                            heading={
                                examType === 'SURVEY'
                                    ? t('sections.submissionReportAccessSurvey')
                                    : t('sections.submissionReportAccess')
                            }
                            keyVal="assessment_submission_and_report_access"
                            form={form}
                            existingInstituteUsersData={existingInstituteUsersData}
                            setExistingInstituteUsersData={setExistingInstituteUsersData}
                        />
                    )}
                    {getStepKey({
                        assessmentDetails,
                        currentStep,
                        key: 'evaluation_access',
                    }) === 'REQUIRED' && (
                        <AccessControlCards
                            heading={t('sections.evaluationProcess')}
                            keyVal="evaluation_process"
                            form={form}
                            existingInstituteUsersData={existingInstituteUsersData}
                            setExistingInstituteUsersData={setExistingInstituteUsersData}
                        />
                    )}
                </div>
            </form>
        </FormProvider>
    );
};

const AccessControlCards = ({
    heading,
    keyVal,
    form,
    existingInstituteUsersData,
    setExistingInstituteUsersData,
}: {
    heading: string;
    keyVal:
        | 'assessment_creation_access'
        | 'live_assessment_notification'
        | 'assessment_submission_and_report_access'
        | 'evaluation_process';
    form: UseFormReturn<AccessControlFormValues>;
    existingInstituteUsersData: InvitedUsersInterface[];
    setExistingInstituteUsersData: Dispatch<SetStateAction<InvitedUsersInterface[]>>;
}) => {
    const { t } = useTranslation('assessmentStep4AccessControl');
    const [selectedUsers, setSelectedUsers] = useState<string[]>(
        form.getValues(keyVal).map((user) => user.userId)
    );
    const [isSelectAllChecked, setIsSelectAllChecked] = useState(
        existingInstituteUsersData.length > 0 &&
            existingInstituteUsersData.every((user) => selectedUsers.includes(user.userId))
    );
    const [open, setOpen] = useState(false);
    const instituteId = getInstituteId();
    const getDashboardUsersData = useMutation({
        mutationFn: ({
            instituteId,
            selectedFilter,
        }: {
            instituteId: string | undefined;
            selectedFilter: RoleTypeSelectedFilter;
        }) => fetchInstituteDashboardUsers(instituteId, selectedFilter),
        onSuccess: (data) => {
            const filteredData = data.map((user: UserRolesDataEntry) => ({
                userId: user.id,
                email: user.email,
                name: user.full_name,
                roles: Array.from(
                    new Map(
                        user.roles.map((role) => [
                            role.role_id,
                            {
                                roleId: role.role_id,
                                roleName: role.role_name,
                            },
                        ])
                    ).values()
                ),
                status: user.status,
            }));
            setExistingInstituteUsersData(filteredData);
        },
        onError: (error: unknown) => {
            throw error;
        },
    });

    const [selectedFilter, setSelectedFilter] = useState({
        roles: [],
        status: [],
    });

    const { watch, getValues } = form;
    watch(keyVal);
    const getKeyVal = getValues(keyVal);

    const handleFilterChange = (filterKey: string, selectedItems: MyFilterOption[]) => {
        setSelectedFilter((prev) => {
            const updatedFilters = { ...prev, [filterKey]: selectedItems };
            return updatedFilters;
        });
    };

    const handleSubmitFilters = () => {
        getDashboardUsersData.mutate({
            instituteId,
            selectedFilter: {
                roles: selectedFilter.roles,
                status: [
                    { id: '1', name: 'ACTIVE' },
                    { id: '2', name: 'DISABLED' },
                    { id: '3', name: 'INVITED' },
                ],
            },
        });
    };

    const handleResetFilters = () => {
        setSelectedFilter({
            roles: [],
            status: [],
        });
        getDashboardUsersData.mutate({
            instituteId,
            selectedFilter: {
                roles: [
                    { id: '1', name: 'ADMIN' },
                    { id: '2', name: 'CONTENT CREATOR' },
                    { id: '3', name: 'ASSESSMENT CREATOR' },
                    { id: '4', name: 'EVALUATOR' },
                    { id: '5', name: 'TEACHER' },
                ],
                status: [
                    { id: '1', name: 'ACTIVE' },
                    { id: '2', name: 'DISABLED' },
                    { id: '3', name: 'INVITED' },
                ],
            },
        });
    };

    const handleRefetchData = () => {
        getDashboardUsersData.mutate({
            instituteId,
            selectedFilter: {
                roles: [
                    { id: '1', name: 'ADMIN' },
                    { id: '2', name: 'CONTENT CREATOR' },
                    { id: '3', name: 'ASSESSMENT CREATOR' },
                    { id: '4', name: 'EVALUATOR' },
                    { id: '5', name: 'TEACHER' },
                ],
                status: [
                    { id: '1', name: 'ACTIVE' },
                    { id: '2', name: 'DISABLED' },
                    { id: '3', name: 'INVITED' },
                ],
            },
        });
    };

    const handleDisableUserMutation = useMutation({
        mutationFn: ({
            instituteId,
            status,
            userId,
        }: {
            instituteId: string | undefined;
            status: string;
            userId: string;
        }) => handleDeleteDisableDashboardUsers(instituteId, status, userId),
        onSuccess: (_, { userId }) => {
            // Remove user from all access control arrays
            form.setValue(
                'assessment_creation_access',
                form
                    .getValues('assessment_creation_access')
                    .filter((user) => user.userId !== userId)
            );
            form.setValue(
                'live_assessment_notification',
                form
                    .getValues('live_assessment_notification')
                    .filter((user) => user.userId !== userId)
            );
            form.setValue(
                'assessment_submission_and_report_access',
                form
                    .getValues('assessment_submission_and_report_access')
                    .filter((user) => user.userId !== userId)
            );
            form.setValue(
                'evaluation_process',
                form.getValues('evaluation_process').filter((user) => user.userId !== userId)
            );

            // Refetch data to update the user list
            handleRefetchData();
            toast.success(t('toasts.cancelInviteSuccess'), {
                className: 'success-toast',
                duration: 2000,
            });
        },
        onError: (error: unknown) => {
            throw error;
        },
    });

    const handlCancelInviteUser = (userId: string) => {
        handleDisableUserMutation.mutate({
            instituteId,
            status: 'CANCEL',
            userId: userId,
        });
    };

    const handleUserSelect = (userId: string) => {
        const newSelectedUsers = selectedUsers.includes(userId)
            ? selectedUsers.filter((id) => id !== userId)
            : [...selectedUsers, userId];

        setSelectedUsers(newSelectedUsers);
    };

    const handleSelectAll = () => {
        const newSelectAllState = !isSelectAllChecked;
        setIsSelectAllChecked(newSelectAllState);

        if (newSelectAllState) {
            const allUserIds = existingInstituteUsersData.map((user) => user.userId);
            setSelectedUsers(allUserIds);
        } else {
            setSelectedUsers([]);
        }
    };

    const handleDone = () => {
        // Update the form values with selected users for this specific key
        const selectedUserDetails = existingInstituteUsersData.filter((user) =>
            selectedUsers.includes(user.userId)
        );

        form.setValue(keyVal, selectedUserDetails);

        // Close the dialog
        const dialogCloseButton = document.querySelector(
            '[data-radix-dialog-close]'
        ) as HTMLButtonElement;
        if (dialogCloseButton) {
            dialogCloseButton.click();
        }
        setOpen(false);
    };

    const handleDeleteUserFromList = (userId: string) => {
        form.setValue(
            keyVal,
            form.getValues(keyVal).filter((user) => user.userId !== userId)
        );
    };

    useEffect(() => {
        // Update isSelectAllChecked whenever selectedUsers or existingInstituteUsersData changes
        setIsSelectAllChecked(
            existingInstituteUsersData.length > 0 &&
                existingInstituteUsersData.every((user) => selectedUsers.includes(user.userId))
        );
    }, [selectedUsers, existingInstituteUsersData]);

    return (
        <div className="flex flex-col gap-4 rounded-xl border p-4">
            <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                    <h1>{heading}</h1>
                    <Dialog open={open} onOpenChange={setOpen}>
                        <DialogTrigger>
                            <MyButton type="button" scale="medium" buttonType="secondary">
                                <Plus size={32} />
                                {t('card.addButton')}
                            </MyButton>
                        </DialogTrigger>
                        <DialogContent className="no-scrollbar !m-0 flex max-h-dialog-tall w-dialog-xl flex-col overflow-hidden !p-0">
                            {/* Header */}
                            <h1 className="sticky top-0 z-10 rounded-t-lg bg-primary-50 p-4 text-primary-500">
                                {t('card.addUserTitle')}
                            </h1>

                            {/* Scrollable Middle Section */}
                            <div className="flex grow flex-col gap-6 overflow-y-auto px-6 pb-6 pt-0">
                                {/* Filters */}
                                <div className="flex items-center justify-between pt-6">
                                    <div className="flex items-center gap-6">
                                        <ScheduleTestFilters
                                            label={t('card.roleTypeLabel')}
                                            data={RoleType}
                                            selectedItems={selectedFilter['roles'] || []}
                                            onSelectionChange={(items) =>
                                                handleFilterChange('roles', items)
                                            }
                                        />
                                        <RoleTypeFilterButtons
                                            selectedQuestionPaperFilters={selectedFilter}
                                            handleSubmitFilters={handleSubmitFilters}
                                            handleResetFilters={handleResetFilters}
                                        />
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Checkbox
                                            checked={isSelectAllChecked}
                                            onCheckedChange={handleSelectAll}
                                        />
                                        <span className="font-thin">{t('card.selectAll')}</span>
                                    </div>
                                </div>

                                {/* User List */}
                                <div className="flex flex-col gap-6">
                                    {existingInstituteUsersData?.map((user) => {
                                        const isSelected = selectedUsers.includes(user.userId);
                                        return (
                                            <div
                                                key={user.userId}
                                                className="flex items-center justify-between gap-4"
                                            >
                                                <div className="flex items-center gap-4">
                                                    <Checkbox
                                                        checked={isSelected}
                                                        onCheckedChange={() =>
                                                            handleUserSelect(user.userId)
                                                        }
                                                    />
                                                    {user.status !== 'INVITED' && (
                                                        <RoleTypeUserIcon />
                                                    )}
                                                    <div className="flex flex-col gap-2">
                                                        <div className="flex items-center gap-4">
                                                            <p>{user.name}</p>
                                                            <div className="flex items-center gap-4">
                                                                {user.roles.map((role) => (
                                                                    <Badge
                                                                        key={role.roleId}
                                                                        className={`whitespace-nowrap rounded-lg border border-neutral-300 ${
                                                                            role.roleName ===
                                                                            'ADMIN'
                                                                                ? 'bg-info-50'
                                                                                : role.roleName ===
                                                                                    'CONTENT CREATOR'
                                                                                  ? 'bg-success-50'
                                                                                  : role.roleName ===
                                                                                      'ASSESSMENT CREATOR'
                                                                                    ? 'bg-danger-50'
                                                                                    : 'bg-purple-50'
                                                                        } py-1.5 font-thin shadow-none`}
                                                                    >
                                                                        {role.roleName}
                                                                    </Badge>
                                                                ))}
                                                            </div>
                                                        </div>
                                                        <p className="text-xs">{user.email}</p>
                                                    </div>
                                                </div>

                                                {/* Cancel Invitation Dialog */}
                                                {user.status === 'INVITED' && (
                                                    <Dialog>
                                                        <DialogTrigger className="text-sm font-semibold text-primary-500">
                                                            {t('card.cancelInvitation')}
                                                        </DialogTrigger>
                                                        <DialogContent className="flex w-dialog-md flex-col p-0">
                                                            <h1 className="rounded-lg bg-primary-50 p-4 text-primary-500">
                                                                {t('card.cancelInvitation')}
                                                            </h1>
                                                            <div className="flex flex-col gap-4 p-4 pt-3">
                                                                <div className="flex items-center gap-1">
                                                                    <span className="text-danger-600">
                                                                        {t('card.attention')}
                                                                    </span>
                                                                    <Info
                                                                        size={18}
                                                                        className="text-danger-600"
                                                                    />
                                                                </div>
                                                                <h1 className="-mt-2 font-thin">
                                                                    {t('card.confirmCancel.prefix')}
                                                                    <span className="text-primary-500">
                                                                        &nbsp;{user.name}
                                                                    </span>
                                                                    {t('card.confirmCancel.suffix')}
                                                                </h1>
                                                                <div className="mt-2 flex justify-end">
                                                                    <MyButton
                                                                        type="button"
                                                                        scale="large"
                                                                        buttonType="primary"
                                                                        onClick={() =>
                                                                            handlCancelInviteUser(
                                                                                user.userId
                                                                            )
                                                                        }
                                                                    >
                                                                        {t('card.yes')}
                                                                    </MyButton>
                                                                </div>
                                                            </div>
                                                        </DialogContent>
                                                    </Dialog>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Footer */}
                            <footer className="sticky bottom-0 left-0 z-10 flex items-center justify-between bg-white p-6">
                                <Step4InviteUsers refetchData={handleRefetchData} />
                                <MyButton
                                    type="button"
                                    scale="large"
                                    buttonType="primary"
                                    layoutVariant="default"
                                    className="mb-0"
                                    onClick={handleDone}
                                >
                                    {t('card.done')}
                                </MyButton>
                            </footer>
                        </DialogContent>
                    </Dialog>
                </div>
                <div className="flex flex-wrap items-center gap-8">
                    {getKeyVal?.map((user) => {
                        return (
                            <div
                                key={user.userId}
                                className="flex items-center justify-between gap-4"
                            >
                                <div className="flex items-center gap-4">
                                    {user.status !== 'INVITED' && <RoleTypeUserIcon />}
                                    <div className="flex flex-col gap-2">
                                        <div className="flex items-center gap-4">
                                            <p>{user.name}</p>
                                            <div className="flex items-start gap-4">
                                                <div className="flex items-center gap-4">
                                                    {user.roles.map((role) => {
                                                        return (
                                                            <Badge
                                                                key={role.roleId}
                                                                className={`whitespace-nowrap rounded-lg border border-neutral-300 ${
                                                                    role.roleName === 'ADMIN'
                                                                        ? 'bg-info-50'
                                                                        : role.roleName ===
                                                                            'CONTENT CREATOR'
                                                                          ? 'bg-success-50'
                                                                          : role.roleName ===
                                                                              'ASSESSMENT CREATOR'
                                                                            ? 'bg-danger-50'
                                                                            : 'bg-purple-50'
                                                                } py-1.5 font-thin shadow-none`}
                                                            >
                                                                {role.roleName}
                                                            </Badge>
                                                        );
                                                    })}
                                                </div>
                                                <X
                                                    onClick={() =>
                                                        handleDeleteUserFromList(user.userId)
                                                    }
                                                    className="cursor-pointer"
                                                />
                                            </div>
                                        </div>
                                        <p className="text-xs">{user.email}</p>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default Step4AccessControl;
