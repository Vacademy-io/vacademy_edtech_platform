import React from 'react';
import { useTranslation } from 'react-i18next';
import { MyDialog } from '@/components/design-system/dialog';
import { CreateEnquiryForm } from './CreateEnquiryForm';

interface CreateEnquiryDialogProps {
    isOpen: boolean;
    onClose: () => void;
}

export const CreateEnquiryDialog: React.FC<CreateEnquiryDialogProps> = ({ isOpen, onClose }) => {
    const { t } = useTranslation('admissionsCreateEnquiryDialog');

    return (
        <MyDialog
            open={isOpen}
            onOpenChange={(open) => !open && onClose()}
            heading={t('heading')}
            dialogWidth="max-w-3xl"
        >
            <CreateEnquiryForm onSuccess={onClose} />
        </MyDialog>
    );
};
