import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { reportApiError } from '@/lib/report-api-error';
import {
    AssessmentFolder,
    createAssessmentFolder,
    updateAssessmentFolder,
    useInvalidateAssessmentFolders,
} from '@/services/assessment-folders';
import { EMPTY_FOLDER_DRAFT, FolderDraft, FolderFormFields } from './FolderFormFields';

const draftFrom = (folder: AssessmentFolder | null): FolderDraft =>
    folder
        ? {
              name: folder.name,
              description: folder.description ?? '',
              image_url: folder.image_url ?? '',
              visible: folder.status !== 'HIDDEN',
          }
        : EMPTY_FOLDER_DRAFT;

/** Create (folder = null) or edit an assessment folder. */
export const AssessmentFolderFormDialog = ({
    open,
    onOpenChange,
    folder,
    onSaved,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    folder: AssessmentFolder | null;
    onSaved?: (folder: AssessmentFolder) => void;
}) => {
    const { t } = useTranslation('assessmentFolders');
    const invalidate = useInvalidateAssessmentFolders();
    const [draft, setDraft] = useState<FolderDraft>(draftFrom(folder));
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (open) setDraft(draftFrom(folder));
    }, [open, folder]);

    const handleSave = async () => {
        const name = draft.name.trim();
        if (!name) {
            toast.error(t('form.nameRequired'));
            return;
        }
        setSaving(true);
        try {
            const input = {
                name,
                description: draft.description.trim() || null,
                image_url: draft.image_url.trim() || null,
                status: draft.visible ? ('ACTIVE' as const) : ('HIDDEN' as const),
            };
            const saved = folder
                ? await updateAssessmentFolder(folder.id, input)
                : await createAssessmentFolder(input);
            await invalidate();
            toast.success(folder ? t('toast.updated') : t('toast.created', { name: saved.name }));
            onSaved?.(saved);
            onOpenChange(false);
        } catch (error) {
            reportApiError(error, {
                feature: 'assessment-folders',
                fallbackMessage: t('toast.error'),
            });
        } finally {
            setSaving(false);
        }
    };

    return (
        <MyDialog
            open={open}
            onOpenChange={onOpenChange}
            heading={folder ? t('form.editTitle') : t('form.createTitle')}
            dialogWidth="max-w-lg"
            footer={
                <div className="flex w-full justify-end gap-2">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('form.cancel')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        disable={saving || !draft.name.trim()}
                        onClick={handleSave}
                    >
                        {saving ? t('form.saving') : folder ? t('form.save') : t('form.create')}
                    </MyButton>
                </div>
            }
        >
            <FolderFormFields
                value={draft}
                onChange={(patch) => setDraft((prev) => ({ ...prev, ...patch }))}
            />
        </MyDialog>
    );
};
