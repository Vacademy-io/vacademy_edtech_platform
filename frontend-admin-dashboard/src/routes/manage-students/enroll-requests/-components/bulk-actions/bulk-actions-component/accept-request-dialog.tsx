import { MyDialog } from '@/components/design-system/dialog';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useEnrollRequestsDialogStore } from '../bulk-actions-store';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { getApproveEnrollmentRequestsData } from '../../../-services/get-enroll-requests';

// Interface to match the actual data structure from bulkActionInfo.selectedStudents
interface EnrollRequestItem {
    packageSessionIds: string[];
    userId: string;
    // null for learners added directly (no enroll invite). Backend tolerates null.
    enrollInviteId: string | null;
}

export interface EnrollRequestAcceptData {
    items: EnrollRequestItem[];
}

export const AcceptRequestDialog = () => {
    const { t } = useTranslation('manageStudentsAcceptRequestDialog');
    const { isAcceptRequestOpen, bulkActionInfo, selectedStudent, closeAllDialogs } =
        useEnrollRequestsDialogStore();
    const queryClient = useQueryClient();

    const pendingForApprovalStudentsBulk = bulkActionInfo?.selectedStudents?.filter(
        (student) => student.payment_status === 'PAYMENT_PENDING'
    );

    const enrollRequestData = {
        items: selectedStudent
            ? [
                  {
                      packageSessionIds: [selectedStudent.destination_package_session_id],
                      userId: selectedStudent.user_id,
                      enrollInviteId: selectedStudent.enroll_invite_id,
                  },
              ]
            : bulkActionInfo?.selectedStudents?.map((student) => ({
                  packageSessionIds: [student.destination_package_session_id],
                  userId: student.user_id,
                  enrollInviteId: student.enroll_invite_id,
              })) || [],
    };

    const handleEnrollRequestMutation = useMutation({
        mutationFn: async ({
            enrollRequestData,
        }: {
            enrollRequestData: EnrollRequestAcceptData;
        }) => {
            return getApproveEnrollmentRequestsData({ enrollRequestData });
        },
        onSuccess: () => {
            toast.success(t('toasts.acceptSuccess'));
            // Refresh the students list so approved learners drop out of the
            // "Pending for Approval" view (matches the useBulkOperations convention).
            queryClient.invalidateQueries({ queryKey: ['students'] });
            closeAllDialogs();
        },
        onError: (error: unknown) => {
            if (error instanceof AxiosError) {
                toast.error(t('toasts.acceptFailed'));
            } else {
                toast.error(t('toasts.unexpectedError'), {
                    className: 'error-toast',
                    duration: 2000,
                });
            }
        },
    });

    const handleAcceptRequestBulk = async () => {
        if (!bulkActionInfo) return;
        handleEnrollRequestMutation.mutate({
            enrollRequestData,
        });
    };

    const handleAcceptRequest = async () => {
        if (!selectedStudent) return;
        handleEnrollRequestMutation.mutate({
            enrollRequestData,
        });
    };

    return (
        <MyDialog
            heading={t('dialog.title')}
            open={isAcceptRequestOpen}
            onOpenChange={closeAllDialogs}
            footer={
                <div className="flex w-full justify-between gap-2">
                    <button
                        className="rounded-lg border border-neutral-300 px-4 py-2 text-neutral-600 hover:bg-neutral-100"
                        onClick={closeAllDialogs}
                    >
                        {t('buttons.cancel')}
                    </button>
                    <button
                        className="hover:bg-primary-600 rounded-lg bg-primary-500 px-4 py-2 text-white"
                        onClick={selectedStudent ? handleAcceptRequest : handleAcceptRequestBulk}
                    >
                        {t('buttons.accept')}
                    </button>
                </div>
            }
        >
            <div className="flex flex-col gap-4">
                <p className="text-neutral-600">
                    {t('dialog.confirmText', {
                        name: selectedStudent?.full_name || bulkActionInfo?.displayText,
                    })}
                </p>
                {pendingForApprovalStudentsBulk && pendingForApprovalStudentsBulk?.length > 0 && (
                    <p className="text-sm text-red-500">
                        {t('dialog.paymentPendingBulk', {
                            count: pendingForApprovalStudentsBulk?.length,
                        })}
                    </p>
                )}
                {selectedStudent && selectedStudent.payment_status === 'PAYMENT_PENDING' && (
                    <p className="text-sm text-red-500">{t('dialog.paymentPendingSingle')}</p>
                )}
                <p className="text-sm text-neutral-500">{t('dialog.emailNotice')}</p>
            </div>
        </MyDialog>
    );
};
