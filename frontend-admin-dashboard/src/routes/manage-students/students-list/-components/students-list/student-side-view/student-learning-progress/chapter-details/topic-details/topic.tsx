// components/topic.tsx
import { MyButton } from '@/components/design-system/button';
import { useActivityStatsStore } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-stores/activity-stats-store';
import { SlideWithStatusType } from '@/routes/manage-students/students-list/-types/student-slides-progress-type';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityLogDialog } from '../../../../../../../../../components/common/student-slide-tracking/activity-log-dialog';
import { useStudentSidebar } from '@/routes/manage-students/students-list/-context/selected-student-sidebar-context';
import { FileDoc } from '@phosphor-icons/react';
import { FilePdf } from '@phosphor-icons/react';
import { PlayCircle } from '@phosphor-icons/react';
import { InlineProgress } from '../../inline-progress';

interface TopicProps {
    slideData: SlideWithStatusType;
    status?: 'done' | 'pending';
}

export const SlideIcon = ({ slideData, status }: TopicProps) => {
    const className = status == 'done' ? 'text-success-600' : 'text-neutral-500';
    if (slideData.source_type == 'DOCUMENT') {
        if (slideData.document_type == 'PDF') {
            return <FilePdf className={`${className}`} size={20} />;
        } else {
            return <FileDoc className={`${className}`} size={20} />;
        }
    } else if (slideData.source_type == 'VIDEO') {
        return <PlayCircle className={`${className}`} size={20} />;
    }
    return <></>;
};

export const Topic = ({ slideData }: TopicProps) => {
    const { t } = useTranslation('manageStudentsTopic');
    const store = useActivityStatsStore.getState();
    const [chapterCompletionStatus, setChapterCompletionStatus] = useState<'done' | 'pending'>(
        'pending'
    );
    const { selectedStudent } = useStudentSidebar();

    const handleOpenDialog = () => {
        store.openDialog(selectedStudent?.user_id || '');
    };

    useEffect(() => {
        // Unified completion across every slide type (video/document/quiz/question/
        // assignment/assessment/scorm/audio). Replaces the old per-type check that
        // read PERCENTAGE_DOCUMENT_WATCHED — a near-empty operation, so completed
        // documents wrongly showed as pending.
        const status: 'done' | 'pending' =
            (slideData.percentage_completed ?? 0) >= 90 ? 'done' : 'pending';
        setChapterCompletionStatus(status);
    }, [slideData]);

    return (
        <div className="flex items-center justify-between">
            <div className="flex flex-col gap-2 text-body">
                <div className="flex gap-2">
                    <SlideIcon slideData={slideData} status={chapterCompletionStatus} />
                    <div>{slideData.slide_title}</div>
                </div>
                <div>
                    {t('lastViewedOn', {
                        date:
                            slideData.video_url == null
                                ? slideData.document_last_updated
                                : slideData.video_last_updated,
                    })}
                </div>
            </div>
            <div className="flex items-center gap-3">
                <InlineProgress percentage={slideData.percentage_completed} />
                <MyButton
                    buttonType="secondary"
                    layoutVariant="default"
                    scale="small"
                    onClick={handleOpenDialog}
                >
                    {t('activityLog')}
                </MyButton>
                <ActivityLogDialog selectedUser={selectedStudent} slideData={slideData} />
            </div>
        </div>
    );
};
