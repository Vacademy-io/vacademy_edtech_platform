import { MyDialog } from '@/components/design-system/dialog';
import {
    CopyMoveDestinationPicker,
    type CopyMoveDestination,
} from '@/components/common/study-library/copy-move/copy-move-destination-picker';
import { useCopyChapter } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/-services/copy-move-chapter';
import { ChapterWithSlides } from '@/stores/study-library/use-modules-with-chapters-store';
import { Dispatch, SetStateAction, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

interface CopyTo {
    openDialog: 'copy' | 'move' | 'delete' | 'edit' | null;
    setOpenDialog: Dispatch<SetStateAction<'copy' | 'move' | 'delete' | 'edit' | null>>;
    chapter: ChapterWithSlides;
}

export const CopyToDialog = ({ openDialog, setOpenDialog, chapter }: CopyTo) => {
    const { t } = useTranslation('studyLibraryCopyDialog');
    const copyChapterMutation = useCopyChapter();
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleCopyChapter = async (destinations: CopyMoveDestination[]) => {
        setIsSubmitting(true);
        const failed: CopyMoveDestination[] = [];
        for (const destination of destinations) {
            try {
                await copyChapterMutation.mutateAsync({
                    packageSessionId: destination.packageSessionId,
                    moduleId: destination.moduleId,
                    chapterId: chapter.chapter.id,
                });
            } catch {
                failed.push(destination);
            }
        }
        setIsSubmitting(false);

        const succeeded = destinations.length - failed.length;
        if (failed.length === 0) {
            toast.success(
                succeeded === 1
                    ? t('copiedSuccessfully')
                    : t('copiedToLocations', { count: succeeded })
            );
            setOpenDialog(null);
            return;
        }
        if (succeeded === 0) {
            toast.error(t('copyFailed'));
        } else {
            toast.warning(
                t('partialCopySummary', { succeeded, total: destinations.length })
            );
        }
        // The source chapter is untouched, so retrying just these is safe.
        return failed;
    };

    return (
        <MyDialog
            heading={t('copyTo')}
            dialogWidth="max-w-2xl"
            open={openDialog == 'copy'}
            onOpenChange={() => setOpenDialog(null)}
        >
            <CopyMoveDestinationPicker
                leaf="module"
                submitLabel={t('copy')}
                busyLabel={t('copying')}
                isSubmitting={isSubmitting}
                onSubmit={handleCopyChapter}
            />
        </MyDialog>
    );
};
