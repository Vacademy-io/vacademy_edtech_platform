// StudentMenuOptions.tsx
import { DotsThree } from '@phosphor-icons/react';
import { StudentTable } from '@/types/student-table-types';
import { useEnrollRequestsDialogStore } from './bulk-actions-store';
import { MyDropdown } from '@/components/design-system/dropdown';
import { DropdownItem } from '@/components/design-system/utils/types/dropdown-types';
import { MyButton } from '@/components/design-system/button';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

// Internal action-type constants used for dispatch logic. These must never be
// swapped for translated display text — see handleMenuOptionsChange below.
const MENU_ACTION = {
    SHARE_CREDENTIALS: 'SHARE_CREDENTIALS',
    SEND_WHATSAPP_MESSAGE: 'SEND_WHATSAPP_MESSAGE',
    SEND_EMAIL: 'SEND_EMAIL',
    ACCEPT_REQUEST: 'ACCEPT_REQUEST',
    DECLINE_REQUEST: 'DECLINE_REQUEST',
} as const;

const buildMenuOptions = (t: TFunction): DropdownItem[] => [
    { label: t('menu.shareCredentials'), value: MENU_ACTION.SHARE_CREDENTIALS },
    { label: t('menu.sendWhatsappMessage'), value: MENU_ACTION.SEND_WHATSAPP_MESSAGE },
    { label: t('menu.sendEmail'), value: MENU_ACTION.SEND_EMAIL },
    { label: t('menu.acceptRequest'), value: MENU_ACTION.ACCEPT_REQUEST },
    { label: t('menu.declineRequest'), value: MENU_ACTION.DECLINE_REQUEST },
];

export const EnrollRequestsStudentMenuOptions = ({ student }: { student: StudentTable }) => {
    const { t } = useTranslation('manageStudentsEnrollRequestIndividualOptions');
    const {
        openIndividualShareCredentialsDialog,
        openIndividualSendMessageDialog,
        openIndividualSendEmailDialog,
        openIndividualAcceptRequestDialog,
        openIndividualDeclineRequestDialog,
    } = useEnrollRequestsDialogStore();

    const handleMenuOptionsChange = (value: string) => {
        switch (value) {
            case MENU_ACTION.SHARE_CREDENTIALS:
                openIndividualShareCredentialsDialog(student);
                break;
            case MENU_ACTION.SEND_WHATSAPP_MESSAGE:
                openIndividualSendMessageDialog(student);
                break;
            case MENU_ACTION.SEND_EMAIL:
                openIndividualSendEmailDialog(student);
                break;
            case MENU_ACTION.ACCEPT_REQUEST:
                openIndividualAcceptRequestDialog(student);
                break;
            case MENU_ACTION.DECLINE_REQUEST:
                openIndividualDeclineRequestDialog(student);
                break;
        }
    };

    return (
        <MyDropdown dropdownList={buildMenuOptions(t)} onSelect={handleMenuOptionsChange}>
            <MyButton
                buttonType="secondary"
                scale="small"
                layoutVariant="icon"
                className="flex items-center justify-center"
            >
                <DotsThree />
            </MyButton>
        </MyDropdown>
    );
};
