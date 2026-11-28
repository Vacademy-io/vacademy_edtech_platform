import { MyDialog } from '@/components/design-system/dialog';
import {
    CopyMoveDestinationPicker,
    type CopyMoveDestination,
} from '@/components/common/study-library/copy-move/copy-move-destination-picker';
import {
    useCopyChapter,
    useMoveChapter,
} from '@/routes/study-library/courses/course-details/subjects/modules/chapters/-services/copy-move-chapter';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useSelectedSessionStore } from '@/stores/study-library/selected-session-store';
import { ChapterWithSlides } from '@/stores/study-library/use-modules-with-chapters-store';
import { useRouter } from '@tanstack/react-router';
import { Dispatch, SetStateAction, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

interface MoveTo {
    openDialog: 'copy' | 'move' | 'delete' | 'edit' | null;
    setOpenDialog: Dispatch<SetStateAction<'copy' | 'move' | 'delete' | 'edit' | null>>;
    chapter: ChapterWithSlides;
}

export const MoveToDialog = ({ openDialog, setOpenDialog, chapter }: MoveTo) => {
    const { t } = useTranslation('studyLibraryMoveDialog');
    const moveChapterMutation = useMoveChapter();
    const copyChapterMutation = useCopyChapter();
    const { getPackageSessionId } = useInstituteDetailsStore();
    const { selectedSession } = useSelectedSessionStore();
    const router = useRouter();
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleMoveChapter = async (destinations: CopyMoveDestination[]) => {
        const searchParams = router.state.location.search;
        const existingPackageSessionId =
            getPackageSessionId({
                courseId: searchParams.courseId || '',
                sessionId: selectedSession?.id || '',
                levelId: searchParams.levelId || '',
            }) || '';

        // Only one destination can be the move target — the rest get a copy, made
        // before the chapter leaves its current batch.
        const [moveTarget, ...copyTargets] = [...destinations].reverse();
        if (!moveTarget) return;

        setIsSubmitting(true);
        const failed: CopyMoveDestination[] = [];
        for (const destination of copyTargets) {
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

        let moved = false;
        try {
            await moveChapterMutation.mutateAsync({
                existingPackageSessionId,
                newPackageSessionId: moveTarget.packageSessionId,
                moduleId: moveTarget.moduleId,
                chapterId: chapter.chapter.id,
            });
            moved = true;
        } catch {
            failed.push(moveTarget);
        }
        setIsSubmitting(false);

        const done = destinations.length - failed.length;
        if (failed.length === 0) {
            toast.success(
                destinations.length === 1
                    ? t('movedSuccessfully')
                    : t('movedWithCopies', { count: destinations.length - 1 })
            );
            setOpenDialog(null);
            return;
        }
        if (moved) {
            // The chapter has left its original batch, so this dialog's source is
            // stale — close instead of offering a retry that would move it again.
            toast.warning(
                t('movedWithFailedCopies', {
                    count: failed.length,
                    locations: failed.map((d) => d.label).join(', '),
                })
            );
            setOpenDialog(null);
            return;
        }
        // Nothing moved — the chapter is still in place, so retrying the failed
        // destinations from here is safe.
        if (done === 0) {
            toast.error(t('moveFailed'));
        } else {
            toast.warning(t('partialMoveSummary', { done, total: destinations.length }));
        }
        return failed;
    };

    return (
        <MyDialog
            heading={t('moveTo')}
            dialogWidth="max-w-2xl"
            open={openDialog == 'move'}
            onOpenChange={() => setOpenDialog(null)}
        >
            <CopyMoveDestinationPicker
                leaf="module"
                submitLabel={t('move')}
                busyLabel={t('moving')}
                isSubmitting={isSubmitting}
                onSubmit={handleMoveChapter}
                multiHint={t('multiHint')}
            />
        </MyDialog>
    );
};
