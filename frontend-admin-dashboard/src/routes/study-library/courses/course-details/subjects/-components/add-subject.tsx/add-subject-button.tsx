import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AddSubjectForm } from './add-subject-form';
import { SubjectType } from '@/stores/study-library/use-study-library-store';
import { Plus } from '@phosphor-icons/react';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { getActiveRoleDisplaySettingsKey } from '@/lib/auth/instituteUtils';
import { getDisplaySettingsFromCache } from '@/services/display-settings';

interface AddSubjectButtonProps {
    onAddSubject: (subject: SubjectType) => void;
    isTextButton?: boolean;
}

export const AddSubjectButton = ({ onAddSubject, isTextButton = false }: AddSubjectButtonProps) => {
    const { t } = useTranslation('studyLibraryAddSubjectButton');
    const [openDialog, setOpenDialog] = useState(false);

    // Per-role visibility: admin can hide the "Add Subject" button for a role
    // from Display Settings → Course Page. Default (undefined/true) shows it.
    const roleDisplay = getDisplaySettingsFromCache(getActiveRoleDisplaySettingsKey());
    if (roleDisplay?.coursePage?.showAddSubject === false) return null;
    const subjectTerm = getTerminology(ContentTerms.Subjects, SystemTerms.Subjects);
    const triggerButton = isTextButton ? (
        <MyButton
            scale="large"
            buttonType="text"
            className="!m-0 flex w-fit cursor-pointer flex-row items-center justify-start gap-2 px-0 pl-2 text-primary-500"
            id="add-chapters"
        >
            <Plus /> {t('addSubject', { subject: subjectTerm })}
        </MyButton>
    ) : (
        <MyButton buttonType="primary" layoutVariant="default" scale="large" id="add-subject">
            {t('addSubject', { subject: subjectTerm })}
        </MyButton>
    );

    const handleOpenChange = () => {
        setOpenDialog(!openDialog);
    };

    return (
        <MyDialog
            trigger={triggerButton}
            heading={t('addSubject', { subject: subjectTerm })}
            dialogWidth="w-[400px]"
            open={openDialog}
            onOpenChange={handleOpenChange}
        >
            <AddSubjectForm
                onSubmitSuccess={(subject) => {
                    onAddSubject(subject);
                    handleOpenChange();
                }}
            />
        </MyDialog>
    );
};
