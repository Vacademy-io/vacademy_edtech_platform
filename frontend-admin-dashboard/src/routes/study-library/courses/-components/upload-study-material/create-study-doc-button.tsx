import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { FileDoc } from '@phosphor-icons/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CreateStudyDocForm } from './create-study-doc-form';

export const CreateStudyDocButton = () => {
    const { t } = useTranslation('studyLibraryCreateStudyDocButton');
    const [openDialog, setOpenDialog] = useState(false);

    const handleOpenChange = () => {
        setOpenDialog(!openDialog);
    };

    const triggerButton = (
        <MyButton
            buttonType="secondary"
            scale="large"
            layoutVariant="default"
            className="flex items-center gap-2"
        >
            <span>
                <FileDoc />
            </span>
            <p>{t('createStudyDoc')}</p>
        </MyButton>
    );

    return (
        <MyDialog
            trigger={triggerButton}
            heading={t('createStudyDoc')}
            dialogWidth="min-w-[400px]"
            open={openDialog}
            onOpenChange={handleOpenChange}
        >
            <CreateStudyDocForm />
        </MyDialog>
    );
};
