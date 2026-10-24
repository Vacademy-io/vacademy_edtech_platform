import { MyDropdown } from '@/components/design-system/dropdown';
import { DropdownItem } from '@/components/design-system/utils/types/dropdown-types';
import { MyButton } from '@/components/design-system/button';
import { DotsThree } from '@phosphor-icons/react';
import { useState, Suspense } from 'react';
import { MyDialog } from '@/components/design-system/dialog';
import { useDeleteEnrollInvites } from '../-services/delete-enroll-invites';
import { toast } from 'sonner';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { InviteLinkDataInterface } from '@/schemas/study-library/invite-links-schema';
import { useSuspenseQuery } from '@tanstack/react-query';
import { handleGetEnrollSingleInviteDetails } from './create-invite/-services/enroll-invite';
import { extractBatchesFromInviteDetails } from '../-utils/enrollInviteTransformers';
import GenerateInviteLinkDialog from './create-invite/GenerateInviteLinkDialog';
import { LoadingSpinner } from '@/components/ai-course-builder/LoadingSpinner';
import { handleGetPaymentDetails } from './create-invite/-services/get-payments';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

// Internal action-type constants used for dispatch logic. These must never be
// swapped for translated display text — see handleSelect below.
const MENU_ACTION = {
    EDIT: 'edit',
    DELETE: 'delete',
} as const;

const buildInviteCardMenuDropdownList = (t: TFunction): DropdownItem[] => [
    { label: t('menu.edit'), value: MENU_ACTION.EDIT },
    { label: t('menu.delete'), value: MENU_ACTION.DELETE },
];

interface InviteCardMenuOptionsProps {
    invite: InviteLinkDataInterface;
}

const EditInviteDialogContent = ({ invite }: { invite: InviteLinkDataInterface }) => {
    const [openEditDialog, setOpenEditDialog] = useState(true);
    const { getDetailsFromPackageSessionId } = useInstituteDetailsStore();

    // Fetch invite details
    const { data: inviteLinkDetails } = useSuspenseQuery(
        handleGetEnrollSingleInviteDetails({ inviteId: invite.id })
    );

    // Fetch payment data (needed by GenerateInviteLinkDialog internally)
    useSuspenseQuery(handleGetPaymentDetails());

    // Extract batches from invite details
    const selectedBatches = extractBatchesFromInviteDetails(
        inviteLinkDetails,
        getDetailsFromPackageSessionId
    );

    // Find the parent course
    const parentBatch = selectedBatches[0];
    const selectedCourse = parentBatch
        ? {
              id: parentBatch.package_dto.package_name,
              name: parentBatch.package_dto.package_name,
          }
        : null;

    return (
        <GenerateInviteLinkDialog
            showSummaryDialog={openEditDialog}
            setShowSummaryDialog={setOpenEditDialog}
            selectedCourse={selectedCourse}
            selectedBatches={selectedBatches
                .filter((batch) => batch !== null)
                .map((batch) => ({
                    sessionId: batch.session.id,
                    levelId: batch.level.id,
                    sessionName: batch.session.session_name,
                    levelName: batch.level.level_name,
                    courseId: batch.package_dto.id,
                    courseName: batch.package_dto.package_name,
                    isParent: false,
                }))}
            inviteLinkId={invite.id}
            singlePackageSessionId={true}
            isEditInviteLink={true}
            setDialogOpen={setOpenEditDialog}
        />
    );
};

export const InviteCardMenuOptions = ({ invite }: InviteCardMenuOptionsProps) => {
    const { t } = useTranslation('manageStudentsInviteCardMenuOptions');
    const dropdownList = buildInviteCardMenuDropdownList(t);
    const [openEditDialog, setOpenEditDialog] = useState(false);
    const [openDeleteDialog, setOpenDeleteDialog] = useState(false);
    // These cards are enroll invites, so the delete has to hit the enroll-invite
    // endpoint. The earlier learner-invitation status call matched no rows and
    // reported success — the invite never left the list.
    const deleteInvitesMutation = useDeleteEnrollInvites();

    const onDeleteInvite = async (invite: InviteLinkDataInterface) => {
        try {
            await deleteInvitesMutation.mutateAsync([invite.id]);
            toast.success(t('toast.deleteSuccess'));
            setOpenDeleteDialog(false);
        } catch {
            toast.error(t('toast.deleteError'));
        }
    };

    const handleSelect = async (value: string) => {
        if (value == MENU_ACTION.DELETE) {
            setOpenDeleteDialog(true);
        } else {
            setOpenEditDialog(true);
        }
    };

    return (
        <>
            <MyDropdown dropdownList={dropdownList} onSelect={handleSelect}>
                <MyButton buttonType="secondary" scale="medium" layoutVariant="icon">
                    <DotsThree />
                </MyButton>
            </MyDropdown>

            {openEditDialog && (
                <Suspense fallback={<LoadingSpinner />}>
                    <EditInviteDialogContent invite={invite} />
                </Suspense>
            )}

            <MyDialog
                open={openDeleteDialog}
                onOpenChange={() => setOpenDeleteDialog(!openDeleteDialog)}
                heading={t('deleteDialog.heading')}
                footer={
                    <div className="flex w-full items-center justify-between py-2">
                        <MyButton buttonType="secondary" onClick={() => setOpenDeleteDialog(false)}>
                            {t('deleteDialog.cancel')}
                        </MyButton>
                        <MyButton buttonType="primary" onClick={() => onDeleteInvite(invite)}>
                            {t('deleteDialog.confirm')}
                        </MyButton>
                    </div>
                }
            >
                {t('deleteDialog.confirmText', { name: invite.name })}
            </MyDialog>
        </>
    );
};
