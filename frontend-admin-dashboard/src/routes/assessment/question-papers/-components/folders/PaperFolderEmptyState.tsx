import { useTranslation } from 'react-i18next';
import { FolderOpen } from '@phosphor-icons/react';

/**
 * The All tab of one folder (or of "Not in a folder") when it holds no paper and no filter
 * is set. Replaces the "No question papers yet" first-paper screen there: the bank is not
 * empty, only this folder is.
 */
export const PaperFolderEmptyState = ({ unfiled }: { unfiled: boolean }) => {
    const { t } = useTranslation('questionPaperFolders');
    return (
        <div className="mt-6 flex flex-col items-center gap-2 rounded-lg border border-dashed border-neutral-300 bg-white p-10 text-center">
            <FolderOpen size={32} className="text-neutral-400" />
            <p className="text-subtitle font-semibold text-neutral-700">
                {unfiled ? t('banner.unfiledEmptyTitle') : t('banner.folderEmptyTitle')}
            </p>
            <p className="max-w-md text-body text-neutral-500">
                {unfiled ? t('banner.unfiledEmptyHint') : t('banner.folderEmptyHint')}
            </p>
        </div>
    );
};
