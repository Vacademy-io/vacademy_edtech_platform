import { MyDialog } from '@/components/design-system/dialog';
import { DotsSixVertical, FileDoc, FilePdf, Video } from '@phosphor-icons/react';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChapterMenuOptions } from './chapter-menu-options/chapter-menu-options';
import { SortableDragHandle } from '@/components/ui/sortable';
import { ChapterWithSlides } from '@/stores/study-library/use-modules-with-chapters-store';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

interface ChapterCardProps {
    chapter: ChapterWithSlides;
    onDelete: () => void;
}

export const ChapterCard = ({ chapter, onDelete }: ChapterCardProps) => {
    const { t } = useTranslation('studyLibraryChapterCard');
    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);

    const router = useRouter();
    const { courseId, levelId, subjectId, moduleId, sessionId } = router.state.location.search;
    const navigate = useNavigate();

    const navigateToSlidePage = () => {
        const currentPath = router.state.location.pathname;

        navigate({
            to: `${currentPath}/slides`,
            search: {
                courseId: courseId,
                levelId: levelId,
                subjectId: subjectId,
                moduleId: moduleId,
                chapterId: chapter.chapter.id,
                sessionId: sessionId,
            },
        });
    };

    const handleCardClick = (e: React.MouseEvent) => {
        if (
            (e.target as HTMLElement).closest('.menu-options-container') ||
            (e.target as HTMLElement).closest('[role="menu"]') ||
            (e.target as HTMLElement).closest('.drag-handle-container') ||
            (e.target as HTMLElement).closest('[role="dialog"]')
        ) {
            return;
        }
        navigateToSlidePage();
    };

    return (
        <div onClick={handleCardClick} className="w-full cursor-pointer">
            <div className="flex w-full flex-col justify-center gap-4 rounded-lg border border-neutral-300 bg-neutral-50 p-6 shadow-md">
                <div className="flex items-center justify-between text-subtitle font-semibold">
                    <div>{chapter.chapter.chapter_name}</div>
                    <div className="flex items-center gap-6">
                        <ChapterMenuOptions
                            chapter={chapter}
                            onDelete={onDelete}
                            viewChapterDetails={navigateToSlidePage}
                        />
                        <SortableDragHandle
                            variant="ghost"
                            size="icon"
                            className="cursor-grab hover:bg-neutral-100 active:cursor-grabbing"
                        >
                            <DotsSixVertical className="size-4" />
                        </SortableDragHandle>
                    </div>
                </div>
                <div className="flex gap-4 text-title font-semibold">
                    <div className="flex items-center gap-2">
                        <FilePdf />
                        <div className="text-primary-500">
                            {chapter.slides_count.pdf_count || 0}
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <FileDoc />
                        <div className="text-primary-500">
                            {chapter.slides_count.doc_count || 0}
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Video />
                        <div className="text-primary-500">
                            {chapter.slides_count.video_count || 0}
                        </div>
                    </div>
                </div>
            </div>

            <MyDialog
                trigger={<></>}
                heading={t('editHeading', {
                    term: getTerminology(ContentTerms.Chapters, SystemTerms.Chapters),
                })}
                dialogWidth="w-[400px]"
                open={isEditDialogOpen}
                onOpenChange={setIsEditDialogOpen}
            >
                {/* Add ChapterForm component here later */}
                {t('editHeading', {
                    term: getTerminology(ContentTerms.Chapters, SystemTerms.Chapters),
                })}
            </MyDialog>
        </div>
    );
};
