import { useTranslation } from 'react-i18next';
import { ChapterAccordian } from './chapter-accordian';
import { ModulesWithChaptersProgressType } from '@/routes/manage-students/students-list/-types/student-subjects-details-types';

export const SubjectProgress = ({
    moduleDetails,
}: {
    moduleDetails?: ModulesWithChaptersProgressType | null;
}) => {
    const { t } = useTranslation('manageStudentsSubjectProgress');
    return (
        <>
            {moduleDetails?.chapters ? (
                <div className="flex flex-col gap-10">
                    {moduleDetails?.chapters && (
                        <div className="flex flex-col gap-6">
                            {moduleDetails.chapters.map((chapter, index) => (
                                <ChapterAccordian ChapterDetails={chapter} key={index} />
                            ))}
                        </div>
                    )}
                </div>
            ) : (
                <p>{t('noChaptersCreated')}</p>
            )}
        </>
    );
};
