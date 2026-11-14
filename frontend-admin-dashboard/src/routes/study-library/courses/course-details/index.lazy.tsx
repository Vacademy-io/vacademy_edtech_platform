import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { CourseDetailsPage } from '@/routes/study-library/courses/course-details/-components/course-details-page';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { InitStudyLibraryProvider } from '@/providers/study-library/init-study-library-provider';

import { createLazyFileRoute, getRouteApi } from '@tanstack/react-router';
import { CaretLeft } from '@phosphor-icons/react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

const routeApi = getRouteApi('/study-library/courses/course-details/');

export const Route = createLazyFileRoute('/study-library/courses/course-details/')({
    component: RouteComponent,
});

function RouteComponent() {
    const { t } = useTranslation('studyLibraryCourseDetailsIndex');
    const { setNavHeading } = useNavHeadingStore();
    const { courseId } = routeApi.useSearch();

    const heading = (
        <div className="flex items-center gap-4">
            <CaretLeft onClick={() => window.history.back()} className="cursor-pointer" />
            <div>
                {t('detailsHeading', { term: getTerminology(ContentTerms.Course, SystemTerms.Course) })}
            </div>
        </div>
    );

    useEffect(() => {
        setNavHeading(heading);
    }, []);

    return (
        <LayoutContainer>
            <InitStudyLibraryProvider courseId={courseId}>
                <CourseDetailsPage />
            </InitStudyLibraryProvider>
        </LayoutContainer>
    );
}
