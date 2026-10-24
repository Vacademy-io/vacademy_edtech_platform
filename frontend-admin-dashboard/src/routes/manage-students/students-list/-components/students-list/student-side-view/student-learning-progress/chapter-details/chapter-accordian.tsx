import { CaretUp, CaretDown } from '@phosphor-icons/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TopicDetails } from './topic-details/topic-details';
import { StatusIcon } from '../status-icon';
import { InlineProgress } from '../inline-progress';
import { ChapterWithProgress } from '@/routes/manage-students/students-list/-types/student-subjects-details-types';

export const ChapterAccordian = ({
    ChapterDetails,
    key,
}: {
    ChapterDetails: ChapterWithProgress;
    key: number;
}) => {
    const { t } = useTranslation('manageStudentsChapterAccordian');
    const [expand, setExpand] = useState(false);

    const chapterCompletionStatus: 'done' | 'pending' =
        ChapterDetails.percentage_completed >= 90 ? 'done' : 'pending';

    return (
        <div className="flex">
            <div className="flex w-full cursor-pointer flex-col gap-4 rounded-lg border border-primary-300 p-4">
                <div
                    className="flex w-full items-center justify-between"
                    onClick={() => {
                        setExpand(!expand);
                    }}
                >
                    <div className="flex min-w-0 items-center gap-2">
                        <StatusIcon status={chapterCompletionStatus} />
                        <div className="truncate">
                            {t('chapterLabel', { number: key })} {ChapterDetails.chapter_name}
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <InlineProgress percentage={ChapterDetails.percentage_completed} />
                        {expand ? <CaretUp /> : <CaretDown />}
                    </div>
                </div>
                {expand && <TopicDetails chapterDetails={ChapterDetails} />}
            </div>
        </div>
    );
};
