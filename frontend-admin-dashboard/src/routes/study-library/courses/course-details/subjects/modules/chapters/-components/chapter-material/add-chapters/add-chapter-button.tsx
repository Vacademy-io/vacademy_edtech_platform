import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { Plus } from '@phosphor-icons/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AddChapterForm } from './add-chapter-form';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { getActiveRoleDisplaySettingsKey } from '@/lib/auth/instituteUtils';
import { getDisplaySettingsFromCache } from '@/services/display-settings';

interface AddChapterButtonProps {
    isTextButton?: boolean;
    moduleId?: string;
    sessionId?: string;
    levelId?: string;
    subjectId?: string;
    /** Optional current package_session_id (selected Batch/Subgroup) */
    packageSessionId?: string;
}

// Add Chapter Header Actions Component
const AddChapterHeaderActions = ({
    submitFn,
    isPending,
}: {
    submitFn: (() => void) | null;
    isPending: boolean;
}) => {
    const { t } = useTranslation('studyLibraryAddChapterButton');
    return (
        <>
            <MyButton
                buttonType="primary"
                scale="medium"
                layoutVariant="default"
                onClick={() => submitFn?.()}
                disabled={isPending || !submitFn}
                className="min-w-[120px]"
            >
                {isPending ? t('adding') : t('addChapter')}
            </MyButton>
        </>
    );
};

export const AddChapterButton = ({
    isTextButton = false,
    moduleId,
    sessionId,
    levelId,
    subjectId,
    packageSessionId,
}: AddChapterButtonProps) => {
    const { t } = useTranslation('studyLibraryAddChapterButton');
    const [openDialog, setOpenDialog] = useState(false);

    // Chapter form state for header button
    const [chapterFormState, setChapterFormState] = useState<{
        submitFn: (() => void) | null;
        isPending: boolean;
    }>({ submitFn: null, isPending: false });

    // Per-role visibility: admin can hide the "Add Chapter" button for a role
    // from Display Settings → Course Page. Default (undefined/true) shows it.
    const roleDisplay = getDisplaySettingsFromCache(getActiveRoleDisplaySettingsKey());
    if (roleDisplay?.coursePage?.showAddChapter === false) return null;

    const triggerButton = isTextButton ? (
        <MyButton
            scale="large"
            buttonType="text"
            className="!m-0 flex w-fit cursor-pointer flex-row items-center justify-start gap-2 px-0 pl-2 text-primary-500"
            id="add-chapters"
        >
            <Plus /> {t('addPrefix')} {getTerminology(ContentTerms.Chapters, SystemTerms.Chapters)}
        </MyButton>
    ) : (
        <MyButton scale="large" id="add-chapters">
            <Plus /> {t('addPrefix')} {getTerminology(ContentTerms.Chapters, SystemTerms.Chapters)}
        </MyButton>
    );

    const handleOpenChange = () => {
        setOpenDialog(!openDialog);
        if (!openDialog) {
            // Reset form state when closing dialog
            setChapterFormState({ submitFn: null, isPending: false });
        }
    };

    const handleSubmitSuccess = () => {
        handleOpenChange();
    };

    const handleChapterFormReady = (submitFn: () => void, isPending: boolean) => {
        setChapterFormState({ submitFn, isPending });
    };

    return (
        <MyDialog
            trigger={triggerButton}
            heading={`${t('addPrefix')} ${getTerminology(ContentTerms.Chapters, SystemTerms.Chapters)}`}
            dialogWidth="min-w-fit"
            open={openDialog}
            onOpenChange={handleOpenChange}
            headerActions={
                openDialog ? (
                    <AddChapterHeaderActions
                        submitFn={chapterFormState.submitFn}
                        isPending={chapterFormState.isPending}
                    />
                ) : undefined
            }
        >
            <AddChapterForm
                module_id={moduleId}
                session_id={sessionId}
                level_id={levelId}
                subject_id={subjectId}
                package_session_id_override={packageSessionId}
                onSubmitSuccess={handleSubmitSuccess}
                mode="create"
                hideSubmitButton={true}
                onFormReady={handleChapterFormReady}
            />
        </MyDialog>
    );
};
