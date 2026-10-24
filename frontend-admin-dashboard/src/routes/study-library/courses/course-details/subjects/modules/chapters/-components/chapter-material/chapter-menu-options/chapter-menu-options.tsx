import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { MyDropdown } from '@/components/design-system/dropdown';
import { DotsThree } from '@phosphor-icons/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { dropdownList } from '@/constants/study-library/chapter-menu-options-list';
import { MoveToDialog } from './move-dialog';
import { CopyToDialog } from './copy-dialog';
import { AddChapterForm } from '../add-chapters/add-chapter-form';
import { ChapterWithSlides } from '@/stores/study-library/use-modules-with-chapters-store';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

interface ChapterMenuOptionsProps {
    chapter: ChapterWithSlides;
    onDelete: () => void;
    viewChapterDetails: () => void;
}

export const ChapterMenuOptions = ({
    chapter,
    onDelete,
    viewChapterDetails,
}: ChapterMenuOptionsProps) => {
    const { t } = useTranslation('studyLibraryChapterMenuOptions');
    const [openDialog, setOpenDialog] = useState<'copy' | 'move' | 'delete' | 'edit' | null>(null);
    const [openDeleteChapterDialog, setOpenDeleteChapterDialog] = useState(false);

    const handleSelect = (value: string) => {
        switch (value) {
            case 'view':
                viewChapterDetails();
                break;
            case 'edit':
                setOpenDialog('edit');
                break;
            case 'delete':
                setOpenDeleteChapterDialog(true);
                break;
            case 'copy':
                setOpenDialog('copy');
                break;
            case 'move':
                setOpenDialog('move');
                break;
        }
    };

    const handleEditSuccess = () => {
        setOpenDialog(null);
    };

    return (
        <>
            <MyDropdown dropdownList={dropdownList} onSelect={handleSelect}>
                <MyButton
                    buttonType="secondary"
                    scale="small"
                    layoutVariant="icon"
                    className="flex items-center justify-center"
                >
                    <DotsThree />
                </MyButton>
            </MyDropdown>

            {/* Edit Dialog */}
            <MyDialog
                heading={t('editDialogHeading', {
                    term: getTerminology(ContentTerms.Chapter, SystemTerms.Chapter),
                })}
                dialogWidth="min-w-[800px]"
                open={openDialog === 'edit'}
                onOpenChange={() => setOpenDialog(null)}
            >
                <AddChapterForm
                    mode="edit"
                    initialValues={chapter}
                    onSubmitSuccess={handleEditSuccess}
                />
            </MyDialog>

            {/* Copy Dialog */}
            <CopyToDialog openDialog={openDialog} setOpenDialog={setOpenDialog} chapter={chapter} />

            {/* Move Dialog */}
            <MoveToDialog openDialog={openDialog} setOpenDialog={setOpenDialog} chapter={chapter} />

            <MyDialog
                heading={t('deleteDialogHeading', {
                    term: getTerminology(ContentTerms.Chapter, SystemTerms.Chapter),
                })}
                open={openDeleteChapterDialog}
                onOpenChange={() => setOpenDeleteChapterDialog(!openDeleteChapterDialog)}
                footer={
                    <div className="flex w-full items-center justify-between py-2">
                        <MyButton
                            buttonType="secondary"
                            onClick={() => setOpenDeleteChapterDialog(false)}
                        >
                            {t('cancel')}
                        </MyButton>
                        <MyButton buttonType="primary" onClick={() => onDelete()}>
                            {t('confirmDelete')}
                        </MyButton>
                    </div>
                }
            >
                {t('deleteConfirmMessage', { chapterName: chapter.chapter.chapter_name })}
            </MyDialog>
        </>
    );
};
