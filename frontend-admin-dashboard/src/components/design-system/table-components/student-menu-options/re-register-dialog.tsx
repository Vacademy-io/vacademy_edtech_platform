// re-register-dialog.tsx
import { MyDialog } from '../../dialog';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { useDialogStore } from '../../../../routes/manage-students/students-list/-hooks/useDialogStore';
import { MyButton } from '../../button';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { SessionWithAccessDays } from '../../sessionWithAccessDays';
import { useForm, FormProvider } from 'react-hook-form';
import { AddSessionDialog } from '@/routes/manage-institute/sessions/-components/session-operations/add-session/add-session-dialog';
import { useAddSession } from '@/services/study-library/session-management/addSession';
import { AddSessionDataType } from '@/routes/manage-institute/sessions/-components/session-operations/add-session/add-session-form';
import { toast } from 'sonner';
import { ArrowUpRight, Plus } from '@phosphor-icons/react';
import { useRouter } from '@tanstack/react-router';
import {
    ReRegisterStudentRequestType,
    useReRegisterStudent,
} from '@/routes/manage-students/students-list/-services/reRegisterStudent';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

interface ReRegisterDialogProps {
    trigger: ReactNode;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

interface Package {
    id: string;
    name: string;
    days: number;
}

interface SelectedPackage {
    id: string;
    days: number;
}

export const ReRegisterDialog = ({ trigger, open, onOpenChange }: ReRegisterDialogProps) => {
    const { selectedStudent, bulkActionInfo, isBulkAction, closeAllDialogs } = useDialogStore();
    const [packageSessionId, setPackageSessionId] = useState<string | null>(null);
    const { instituteDetails } = useInstituteDetailsStore();
    const [packages, setPackages] = useState<Package[]>([]);
    const form = useForm({
        defaultValues: {
            selectedPackages: [] as SelectedPackage[],
        },
    });
    const [isAddSessionDiaogOpen, setIsAddSessionDiaogOpen] = useState(false);
    const [disableAddButton, setDisableAddButton] = useState(true);
    const formSubmitRef = useRef(() => {});
    const addSessionMutation = useAddSession();
    const reRegisterMutation = useReRegisterStudent();
    const router = useRouter();
    const accessToken = getTokenFromCookie(TokenKey.accessToken);
    const data = getTokenDecodedData(accessToken);
    const INSTITUTE_ID = data && Object.keys(data.authorities)[0];

    // Bulk action: the learners come from bulkActionInfo (selectedStudent is only set by the row menu).
    const bulkStudents = isBulkAction ? bulkActionInfo?.selectedStudents ?? [] : [];
    const sourceBatchId = isBulkAction
        ? bulkStudents[0]?.package_session_id
        : selectedStudent?.package_session_id;
    // the session list below is "other sessions of this course", so a bulk selection must be from one course
    const bulkCourseIds = new Set(
        bulkStudents
            .map(
                (student) =>
                    instituteDetails?.batches_for_sessions.find(
                        (batch) => batch.id === student.package_session_id
                    )?.package_dto.id
            )
            .filter(Boolean)
    );
    const mixedCourses = isBulkAction && bulkCourseIds.size > 1;

    useEffect(() => {
        if (sourceBatchId) {
            setPackageSessionId(sourceBatchId);
        }
    }, [sourceBatchId]);

    useEffect(() => {
        if (instituteDetails && packageSessionId) {
            const filteredBatch = instituteDetails.batches_for_sessions.find(
                (batch) => batch.id === packageSessionId
            );

            if (filteredBatch) {
                const mappedPackages = instituteDetails.batches_for_sessions
                    .filter(
                        (batch) =>
                            batch.id !== packageSessionId &&
                            batch.package_dto.id === filteredBatch.package_dto.id
                    )
                    .map((mappedBatch) => ({
                        id: mappedBatch.id,
                        name: `${mappedBatch.level.level_name} ${mappedBatch.session.session_name}`,
                        days: 0,
                    }));
                setPackages(mappedPackages);
            }
        }
    }, [instituteDetails, packageSessionId]);

    const handleReRegister = async () => {
        const selectedPackages = form.getValues('selectedPackages') || [];
        console.log('Selected packages with days:', selectedPackages);
        // TODO: Implement re-registration logic with selectedPackages

        const values = form.getValues('selectedPackages');
        const userIds =
            isBulkAction && bulkActionInfo?.selectedStudents
                ? bulkActionInfo?.selectedStudents.map((student) => student.user_id)
                : [selectedStudent?.user_id || ''];
        const request: ReRegisterStudentRequestType = {
            user_ids: userIds,
            institute_id: INSTITUTE_ID || '',
            learner_batch_register_infos: values.map((value) => ({
                package_session_id: value.id,
                access_days: value.days,
            })),
            access_days: 0,
        };
        try {
            await reRegisterMutation.mutateAsync({ request: request });
            toast.success('Learner re-registered successfully');
            closeAllDialogs();
        } catch {
            toast.error('Failed to re-register learner');
        }
    };

    const handleOpenAddSessionDialog = () => {
        setIsAddSessionDiaogOpen(!isAddSessionDiaogOpen);
    };

    const dialogFooter = (
        <div className="flex w-full justify-between">
            <MyButton buttonType="secondary" onClick={() => onOpenChange(false)} type="button">
                Cancel
            </MyButton>
            <MyButton onClick={handleReRegister} type="submit" disable={mixedCourses}>
                Re-register
            </MyButton>
        </div>
    );

    const submitFn = (fn: () => void) => {
        formSubmitRef.current = fn;
    };

    const submitButton = (
        <div className="flex items-center justify-end">
            <MyButton
                type="submit"
                buttonType="primary"
                layoutVariant="default"
                scale="large"
                className="w-[140px]"
                disable={disableAddButton}
                onClick={() => formSubmitRef.current()}
            >
                Add
            </MyButton>
        </div>
    );

    const handleAddSession = (sessionData: AddSessionDataType) => {
        const processedData = structuredClone(sessionData);

        const transformedData = {
            ...processedData,
            levels: processedData.levels.map((level) => ({
                id: level.level_dto.id,
                new_level: level.level_dto.new_level === true,
                level_name: level.level_dto.level_name,
                duration_in_days: level.level_dto.duration_in_days,
                thumbnail_file_id: level.level_dto.thumbnail_file_id,
                package_id: level.level_dto.package_id,
            })),
        };

        // Use type assertion since we know this is the correct format for the API
        addSessionMutation.mutate(
            { requestData: transformedData as unknown as AddSessionDataType },
            {
                onSuccess: () => {
                    toast.success(
                        ` ${getTerminology(
                            ContentTerms.Session,
                            SystemTerms.Session
                        )} added successfully`
                    );
                    setIsAddSessionDiaogOpen(false);
                },
                onError: (error) => {
                    toast.error(
                        error.message ||
                            `Failed to add ${getTerminology(
                                ContentTerms.Session,
                                SystemTerms.Session
                            ).toLocaleLowerCase()}`
                    );
                },
            }
        );
    };

    const handleUpdateExistingSessions = () => {
        router.navigate({
            to: '/manage-institute/sessions',
        });
    };

    const heading =
        isBulkAction && bulkActionInfo?.selectedStudents
            ? `Re-register for Next Session for ${bulkActionInfo?.selectedStudents.length} students`
            : `Re-register for Next Session for ${selectedStudent?.full_name}`;

    if ((isBulkAction ? bulkStudents.length === 0 : !selectedStudent) || !instituteDetails) {
        return null;
    }

    return (
        <MyDialog
            trigger={trigger}
            heading={heading}
            dialogWidth="w-[500px]"
            open={open}
            onOpenChange={onOpenChange}
            footer={dialogFooter}
        >
            {open && (
                <div>
                    <FormProvider {...form}>
                        <div className="flex flex-col gap-4 p-4">
                            {mixedCourses && (
                                <p className="text-body text-danger-600">
                                    The selected learners are in different courses. Select learners
                                    from one course to re-register them together.
                                </p>
                            )}
                            <SessionWithAccessDays
                                form={form}
                                control={form.control}
                                name="selectedPackages"
                                label="Select Sessions"
                                options={packages}
                                required={true}
                            />
                        </div>
                    </FormProvider>
                    <div className="flex items-center justify-between">
                        <AddSessionDialog
                            isAddSessionDiaogOpen={isAddSessionDiaogOpen}
                            handleOpenAddSessionDialog={handleOpenAddSessionDialog}
                            handleSubmit={handleAddSession}
                            trigger={
                                <MyButton buttonType="text" className="text-primary-500">
                                    <Plus /> Add New Session
                                </MyButton>
                            }
                            submitButton={submitButton}
                            setDisableAddButton={setDisableAddButton}
                            submitFn={submitFn}
                        />
                        <MyButton
                            buttonType="text"
                            className="text-primary-500"
                            onClick={handleUpdateExistingSessions}
                        >
                            Update existing sessions
                            <ArrowUpRight className="-ml-2" />
                        </MyButton>
                    </div>
                </div>
            )}
        </MyDialog>
    );
};
