import { createLazyFileRoute, getRouteApi } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { InitStudyLibraryProvider } from '@/providers/study-library/init-study-library-provider';
import { ModulesWithChaptersProvider } from '@/providers/study-library/modules-with-chapters-provider';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { CaretLeft } from '@phosphor-icons/react';
import { getSubjectName } from '@/utils/helpers/study-library-helpers.ts/get-name-by-id/getSubjectNameById';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { SubjectType } from '@/stores/study-library/use-study-library-store';
import { getSubjectsByLevelAndSession } from '@/utils/courseUtils';
import { useStudyLibraryStore } from '@/stores/study-library/use-study-library-store';
import { ModuleMaterial } from './-components/module-material';
import { getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

const routeApi = getRouteApi('/study-library/courses/course-details/subjects/modules/');

export const Route = createLazyFileRoute('/study-library/courses/course-details/subjects/modules/')(
    {
        component: RouteComponent,
    }
);

function RouteComponent() {
    const { t } = useTranslation('studyLibraryModulesIndex');
    const queryClient = useQueryClient();

    const { setNavHeading } = useNavHeadingStore();

    const { courseId, levelId, subjectId, sessionId } = routeApi.useSearch();
    const subjectName = getSubjectName(subjectId);

    const invalidateModulesQuery = () => {
        queryClient.invalidateQueries({
            queryKey: ['GET_MODULES_WITH_CHAPTERS', subjectId],
        });
    };

    const heading = (
        <div className="flex items-center gap-4">
            <CaretLeft onClick={() => window.history.back()} className="cursor-pointer" />
            <div>{t('heading', { subject: subjectName })}</div>
        </div>
    );

    useEffect(() => {
        setNavHeading(heading);
        invalidateModulesQuery();
    }, []);

    const [subjects, setSubjects] = useState<SubjectType[]>([]);

    const { studyLibraryData } = useStudyLibraryStore();

    useEffect(() => {
        const subjects = getSubjectsByLevelAndSession(studyLibraryData, levelId, sessionId);
        setSubjects(subjects);
    }, [levelId, sessionId, studyLibraryData]);

    return (
        <LayoutContainer
            internalSideBar
            sideBarList={subjects.map((subject) => {
                return {
                    value: subject.subject_name,
                    id: subject.id,
                };
            })}
            sideBarData={{ title: getTerminologyPlural(ContentTerms.Subjects, SystemTerms.Subjects), listIconText: 'S', searchParam: 'subjectId' }}
        >
            <InitStudyLibraryProvider courseId={courseId}>
                <ModulesWithChaptersProvider>
                    <ModuleMaterial />
                </ModulesWithChaptersProvider>
            </InitStudyLibraryProvider>
        </LayoutContainer>
    );
}
