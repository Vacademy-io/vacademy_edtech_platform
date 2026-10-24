import { LayoutContainer } from "@/components/common/layout-container/layout-container";
import { SubjectMaterial } from "@/components/common/study-library/level-material/subject-material/subject-material";
import { InitStudyLibraryProvider } from "@/providers/study-library/init-study-library-provider";
import { createFileRoute } from "@tanstack/react-router";
import { Helmet } from "react-helmet";
import { useTranslation } from "react-i18next";

interface LevelSearchParams {
    courseId: string;
    subjectId: string;
}

export const Route = createFileRoute(
    "/study-library/courses/course-details/subjects/"
)({
    component: RouteComponent,
    validateSearch: (search: Record<string, unknown>): LevelSearchParams => {
        return {
            courseId: search.courseId as string,
            subjectId: search.subjectId as string,
        };
    },
});

function RouteComponent() {
    const { t } = useTranslation("courseDetailsC");
    return (
        <LayoutContainer>
            <Helmet>
                <title>{document?.title || t("subjectsRoute.title")}</title>
                <meta name="description" content={t("subjectsRoute.metaDescription")} />
            </Helmet>
            <InitStudyLibraryProvider>
                <SubjectMaterial />
            </InitStudyLibraryProvider>
        </LayoutContainer>
    );
}
