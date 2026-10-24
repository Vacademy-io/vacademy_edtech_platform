import { createLazyFileRoute, useSearch } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { CourseMaterial } from '@/routes/study-library/courses/-components/course-material';
import { Helmet } from 'react-helmet';
import { useTranslation } from 'react-i18next';

interface CourseSearchParams {
    selectedTab?: 'AuthoredCourses' | 'AllCourses' | 'CourseInReview' | 'CourseApproval';
    action?: string;
}

export const Route = createLazyFileRoute('/study-library/courses/')({
    component: RouteComponent,
});

function RouteComponent() {
    const { t } = useTranslation('studyLibraryCoursesIndex');
    const searchParams = useSearch({ from: '/study-library/courses/' }) as CourseSearchParams;

    return (
        <LayoutContainer>
            <Helmet>
                <title>{t('pageTitle')}</title>
                <meta name="description" content={t('pageDescription')} />
            </Helmet>
            <CourseMaterial
                initialSelectedTab={searchParams.selectedTab}
                initialAction={searchParams.action}
            />
        </LayoutContainer>
    );
}
