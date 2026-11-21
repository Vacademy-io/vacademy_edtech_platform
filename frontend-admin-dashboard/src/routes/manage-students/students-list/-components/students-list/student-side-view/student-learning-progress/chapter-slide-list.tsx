import { useStudentSlidesProgressQuery } from '@/routes/manage-students/students-list/-services/getStudentChapterSlides';
import { SlideWithStatusType } from '@/routes/manage-students/students-list/-types/student-slides-progress-type';
import { InlineProgress } from './inline-progress';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { FilePdf, FileDoc, PlayCircle, FileText } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';

const SlideTypeIcon = ({ slide }: { slide: SlideWithStatusType }) => {
    const cls = 'size-4 shrink-0 text-muted-foreground';
    if (slide.source_type === 'VIDEO') return <PlayCircle className={cls} weight="duotone" />;
    if (slide.source_type === 'DOCUMENT') {
        return slide.document_type === 'PDF' ? (
            <FilePdf className={cls} weight="duotone" />
        ) : (
            <FileDoc className={cls} weight="duotone" />
        );
    }
    // quiz / question / assignment / assessment / scorm / audio
    return <FileText className={cls} weight="duotone" />;
};

/**
 * Slide-level breakdown for a single chapter in the side-view Progress tab. Fetches
 * the learner's per-slide completion and shows a percentage on each slide row — so
 * the tab drills all the way down: module % → chapter % → slide %. The per-slide
 * number comes from the unified `percentage_completed` field (all slide types),
 * which needs the admin_core_service deploy to be populated.
 */
export const ChapterSlideList = ({ userId, chapterId }: { userId: string; chapterId: string }) => {
    const { t } = useTranslation('manageStudentsChapterSlideList');
    const { data: slides, isLoading, isError } = useStudentSlidesProgressQuery({ userId, chapterId });

    if (isLoading)
        return (
            <div className="py-2 pl-9">
                <DashboardLoader />
            </div>
        );
    if (isError)
        return (
            <p className="py-2 pl-9 text-caption italic text-muted-foreground">
                {t('loadError')}
            </p>
        );
    if (!slides || slides.length === 0)
        return (
            <p className="py-2 pl-9 text-caption italic text-muted-foreground">
                {t('empty')}
            </p>
        );

    return (
        <div className="mt-1 flex flex-col gap-2 border-l border-neutral-100 pb-1 pl-8 pt-1">
            {slides.map((slide, i) => (
                <div key={slide.slide_id ?? i} className="flex items-center gap-3">
                    <SlideTypeIcon slide={slide} />
                    <span className="min-w-0 flex-1 truncate text-caption text-card-foreground">
                        {slide.slide_title}
                    </span>
                    <InlineProgress percentage={slide.percentage_completed} />
                </div>
            ))}
        </div>
    );
};
