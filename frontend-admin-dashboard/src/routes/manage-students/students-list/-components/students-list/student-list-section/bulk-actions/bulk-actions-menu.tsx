// components/BulkActionsMenu.tsx
import { MyDropdown } from '@/components/design-system/dropdown';
import { DropdownItem } from '@/components/design-system/utils/types/dropdown-types';
import { useDialogStore } from '@/routes/manage-students/students-list/-hooks/useDialogStore';
import { BulkActionInfo } from '@/routes/manage-students/students-list/-types/bulk-actions-types';
import { StudentTable } from '@/types/student-table-types';
import { ReactNode } from 'react';
import { useRouter } from '@tanstack/react-router';
import { useEnrollRequestsDialogStore } from '@/routes/manage-students/enroll-requests/-components/bulk-actions/bulk-actions-store';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { toast } from 'sonner';
import { BulkAwardBadgeDialog } from './bulk-award-badge-dialog';

// Internal action-type constants used for dispatch logic. These must never be
// swapped for translated display text — handleMenuOptionsChange switches on
// these values, not on the (locale-dependent) label shown in the dropdown.
const MENU_ACTION = {
    ACCEPT_REQUEST: 'ACCEPT_REQUEST',
    CHANGE_BATCH: 'CHANGE_BATCH',
    EXTEND_COURSE_ACCESS: 'EXTEND_COURSE_ACCESS',
    RE_REGISTER: 'RE_REGISTER',
    TERMINATE_REGISTRATION: 'TERMINATE_REGISTRATION',
    DELETE: 'DELETE',
    SHARE_CREDENTIALS: 'SHARE_CREDENTIALS',
    SEND_WHATSAPP_MESSAGE: 'SEND_WHATSAPP_MESSAGE',
    SEND_EMAIL: 'SEND_EMAIL',
    CREATE_CERTIFICATE: 'CREATE_CERTIFICATE',
    AWARD_BADGE: 'AWARD_BADGE',
} as const;

/**
 * Actions that act on an ENROLMENT, and so cannot run without the batch the learner is
 * enrolled in.
 *
 * <p>Everything else in this menu acts on the PERSON — credentials, a WhatsApp message, an
 * email, a certificate — and needs nothing but a user id. Requiring a package_session_id for
 * those too silently excluded audience-only contacts (people who filled an audience form but
 * are not enrolled in anything: the learner list returns them with a null package_session_id).
 * A selection of them plus enrolled learners quietly sent to a subset; a selection made up
 * entirely of them made "Share Credentials" do nothing at all — no dialog, no request, no
 * message.
 */
const BATCH_SCOPED_ACTIONS: ReadonlySet<string> = new Set([
    MENU_ACTION.ACCEPT_REQUEST,
    MENU_ACTION.CHANGE_BATCH,
    MENU_ACTION.EXTEND_COURSE_ACCESS,
    MENU_ACTION.RE_REGISTER,
    MENU_ACTION.TERMINATE_REGISTRATION,
    MENU_ACTION.DELETE,
]);

// Was a module-scope `BulkActionDropdownList` string array (imported from
// -constants/bulk-actions-menu-options). Converted to a factory so the labels
// can be translated while the dispatch value stays a stable, locale-independent
// MENU_ACTION key.
const buildBulkActionDropdownList = (t: TFunction): DropdownItem[] => [
    { label: t('menu.changeBatch'), value: MENU_ACTION.CHANGE_BATCH },
    { label: t('menu.extendCourseAccess'), value: MENU_ACTION.EXTEND_COURSE_ACCESS },
    { label: t('menu.reRegisterForNextSession'), value: MENU_ACTION.RE_REGISTER },
    { label: t('menu.terminateRegistration'), value: MENU_ACTION.TERMINATE_REGISTRATION },
    { label: t('menu.shareCredentials'), value: MENU_ACTION.SHARE_CREDENTIALS },
    { label: t('menu.sendWhatsappMessage'), value: MENU_ACTION.SEND_WHATSAPP_MESSAGE },
    { label: t('menu.sendEmail'), value: MENU_ACTION.SEND_EMAIL },
    { label: t('menu.createCertificate'), value: MENU_ACTION.CREATE_CERTIFICATE },
    // Person-scoped (needs only user_id) — deliberately NOT in BATCH_SCOPED_ACTIONS.
    { label: t('menu.awardBadge'), value: MENU_ACTION.AWARD_BADGE },
];

interface BulkActionsMenuProps {
    selectedCount: number;
    selectedStudentIds: string[];
    selectedStudents: StudentTable[];
    trigger: ReactNode;
    // When the Approval Status filter (Pending for Approval / Invited) is active,
    // expose the bulk "Accept Request" action so pending learners can be approved
    // in bulk instead of one-by-one from each row's menu.
    showApprovalActions?: boolean;
}

export const BulkActionsMenu = ({
    selectedStudents,
    trigger,
    showApprovalActions = false,
}: BulkActionsMenuProps) => {
    const router = useRouter();
    const { t } = useTranslation('manageStudentsBulkActionsMenu');
    const {
        openBulkChangeBatchDialog,
        openBulkExtendAccessDialog,
        openBulkReRegisterDialog,
        openBulkTerminateRegistrationDialog,
        openBulkDeleteDialog,
        openBulkShareCredentialsDialog,
        openBulkSendMessageDialog,
        openBulkSendEmailDialog,
        openBulkAwardBadgeDialog,
    } = useDialogStore();
    // The Accept flow is owned by the enroll-requests dialog store (the same store the
    // row-level "Accept Request" menu uses); its AcceptRequestDialog is already mounted
    // on this page and handles bulk approval.
    const { openBulkAcceptRequestDialog } = useEnrollRequestsDialogStore();

    const dropdownList: DropdownItem[] = showApprovalActions
        ? [
              { label: t('menu.acceptRequest'), value: MENU_ACTION.ACCEPT_REQUEST },
              ...buildBulkActionDropdownList(t),
          ]
        : buildBulkActionDropdownList(t);

    const handleMenuOptionsChange = (value: string) => {
        const needsBatch = BATCH_SCOPED_ACTIONS.has(value);
        const withUser = selectedStudents.filter((student) => student && student.user_id);
        const validStudents = needsBatch
            ? withUser.filter((student) => student.package_session_id)
            : withUser;

        if (validStudents.length === 0) {
            // Never return silently: a dropdown item that does nothing at all reads as a broken
            // page, and the reason (the selection is not enrolled in a batch) is not something
            // the admin can see from the table.
            toast.error(needsBatch ? t('errors.noneEnrolled') : t('errors.noneActionable'));
            return;
        }

        // A partial run is still a surprise — say which learners were left out rather than
        // quietly acting on a smaller selection than the one on screen.
        const excluded = selectedStudents.length - validStudents.length;
        if (excluded > 0) {
            toast.warning(
                t(needsBatch ? 'errors.someNotEnrolled' : 'errors.someNoAccount', {
                    count: excluded,
                })
            );
        }

        const bulkActionInfo: BulkActionInfo = {
            selectedStudentIds: validStudents.map((student) => student.id),
            selectedStudents: validStudents,
            displayText: t('actionInfo.selectedStudents', { count: validStudents.length }),
        };

        switch (value) {
            case MENU_ACTION.ACCEPT_REQUEST:
                openBulkAcceptRequestDialog(bulkActionInfo);
                break;
            case MENU_ACTION.CHANGE_BATCH:
                openBulkChangeBatchDialog(bulkActionInfo);
                break;
            case MENU_ACTION.EXTEND_COURSE_ACCESS:
                openBulkExtendAccessDialog(bulkActionInfo);
                break;
            case MENU_ACTION.RE_REGISTER:
                openBulkReRegisterDialog(bulkActionInfo);
                break;
            case MENU_ACTION.TERMINATE_REGISTRATION:
                openBulkTerminateRegistrationDialog(bulkActionInfo);
                break;
            case MENU_ACTION.DELETE:
                openBulkDeleteDialog(bulkActionInfo);
                break;
            case MENU_ACTION.SHARE_CREDENTIALS:
                openBulkShareCredentialsDialog(bulkActionInfo);
                break;
            case MENU_ACTION.SEND_WHATSAPP_MESSAGE:
                openBulkSendMessageDialog(bulkActionInfo);
                break;
            case MENU_ACTION.SEND_EMAIL:
                openBulkSendEmailDialog(bulkActionInfo);
                break;
            case MENU_ACTION.AWARD_BADGE:
                openBulkAwardBadgeDialog(bulkActionInfo);
                break;
            case MENU_ACTION.CREATE_CERTIFICATE:
                // Navigate to certificate generation with selected students
                router.navigate({
                    to: '/certificate-generation/student-data',
                    search: {
                        students: encodeURIComponent(
                            JSON.stringify(validStudents.map((s) => s.user_id))
                        ),
                    },
                });
                break;
        }
    };

    return (
        <>
            <MyDropdown dropdownList={dropdownList} onSelect={handleMenuOptionsChange}>
                {trigger}
            </MyDropdown>
            {/* Mounted here, next to the menu, rather than in students-list-section or MyTable:
                the same menu is reused by the course-details student list and the live-session
                learner tab, where the section-level dialogs are NOT mounted (their Share
                Credentials item flips a store flag and nothing opens). Rendering the dialog as a
                sibling of the dropdown means "Award badge" works on every list that shows it. */}
            <BulkAwardBadgeDialog />
        </>
    );
};
