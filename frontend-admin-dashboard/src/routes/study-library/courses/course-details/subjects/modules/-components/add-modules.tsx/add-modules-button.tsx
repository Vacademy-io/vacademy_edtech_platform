import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AddModulesForm } from './add-modules-form';
import { Module } from '@/stores/study-library/use-modules-with-chapters-store';
import { Plus } from '@phosphor-icons/react';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { getActiveRoleDisplaySettingsKey } from '@/lib/auth/instituteUtils';
import { getDisplaySettingsFromCache } from '@/services/display-settings';

interface AddModuleButtonProps {
    onAddModule?: (module: Module) => void;
    onAddModuleBySubjectId?: (subjectId: string, module: Module) => void;
    isTextButton?: boolean;
    subjectId?: string;
}

export const AddModulesButton = ({
    onAddModule,
    isTextButton = false,
    onAddModuleBySubjectId,
    subjectId,
}: AddModuleButtonProps) => {
    const { t } = useTranslation('studyLibraryAddModulesButton');
    const [openDialog, setOpenDialog] = useState(false);

    // Per-role visibility: admin can hide the "Add Module" button for a role
    // from Display Settings → Course Page. Default (undefined/true) shows it.
    const roleDisplay = getDisplaySettingsFromCache(getActiveRoleDisplaySettingsKey());
    if (roleDisplay?.coursePage?.showAddModule === false) return null;

    const triggerButton = isTextButton ? (
        <MyButton
            scale="large"
            buttonType="text"
            className="!m-0 flex w-fit cursor-pointer flex-row items-center justify-start gap-2 px-0 pl-2 text-primary-500"
            id="add-chapters"
        >
            <Plus /> {t('addPrefix')} {getTerminology(ContentTerms.Modules, SystemTerms.Modules)}
        </MyButton>
    ) : (
        <MyButton buttonType="primary" scale="large" layoutVariant="default" id="add-modules">
            {t('addPrefix')} {getTerminology(ContentTerms.Modules, SystemTerms.Modules)}
        </MyButton>
    );
    const handleOpenChange = () => {
        setOpenDialog(!openDialog);
    };

    return (
        <MyDialog
            trigger={triggerButton}
            heading={`${t('addPrefix')} ${getTerminology(ContentTerms.Modules, SystemTerms.Modules)}`}
            dialogWidth="w-[400px]"
            open={openDialog}
            onOpenChange={handleOpenChange}
        >
            <AddModulesForm
                onSubmitSuccess={(module) => {
                    if (subjectId && onAddModuleBySubjectId) {
                        onAddModuleBySubjectId(subjectId, module);
                    } else if (onAddModule) {
                        onAddModule(module);
                    }

                    handleOpenChange();
                }}
            />
        </MyDialog>
    );
};
