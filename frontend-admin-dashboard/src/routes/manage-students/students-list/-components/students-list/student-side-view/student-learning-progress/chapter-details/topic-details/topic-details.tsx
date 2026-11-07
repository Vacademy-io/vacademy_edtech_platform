import { useTranslation } from 'react-i18next';
import { ChapterWithProgress } from '@/routes/manage-students/students-list/-types/student-subjects-details-types';
import { useStudentSidebar } from '@/routes/manage-students/students-list/-context/selected-student-sidebar-context';
import { useStudentSlidesProgressQuery } from '@/routes/manage-students/students-list/-services/getStudentChapterSlides';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { SlideWithStatusType } from '@/routes/manage-students/students-list/-types/student-slides-progress-type';
import { Topic } from './topic';

export interface slideType {
    id: string;
    name: string;
    slides: SlideWithStatusType[] | null;
}

export const TopicDetails = ({ chapterDetails }: { chapterDetails: ChapterWithProgress }) => {
    const { t } = useTranslation('manageStudentsTopicDetails');
    const { selectedStudent } = useStudentSidebar();
    const {
        data: SlideWithProgress,
        isLoading,
        isError,
        error,
    } = useStudentSlidesProgressQuery({
        userId: selectedStudent?.user_id || '',
        chapterId: chapterDetails.id,
    });

    if (isLoading) return <DashboardLoader />;
    if (isError || error) return <p>{t('errorGettingSlides')}</p>;

    return (
        <>
            {SlideWithProgress == null || SlideWithProgress == undefined ? (
                <p>{t('noSlidesCreated')}</p>
            ) : (
                <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-3">
                        {SlideWithProgress?.map((slide, index) => (
                            <Topic key={index} slideData={slide} />
                        ))}
                    </div>
                </div>
            )}
        </>
    );
};
