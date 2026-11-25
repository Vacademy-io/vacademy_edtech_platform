import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { BookOpenText } from "@phosphor-icons/react";
import { LayoutContainer } from "@/components/common/layout-container/layout-container";
import { EmptyState, LoadErrorState } from "@/components/design-system/states";
import { Skeleton } from "@/components/ui/skeleton";
import { useNavHeadingStore } from "@/stores/layout-container/useNavHeadingStore";
import { hasSyllabus, useMySyllabus } from "./-services/syllabus-progress-service";
import { SyllabusCourseSection } from "./-components/SyllabusCourseSection";

/**
 * `/syllabus-progress`: "My syllabus" — the learner's course-stage syllabus,
 * week block by week block, as their teacher marks it. Switched on per
 * institute; with the feature off (or no syllabus yet) the page shows a
 * gentle empty state and the nav entry stays hidden.
 */
export const Route = createFileRoute("/syllabus-progress/")({
    component: SyllabusProgressRoute,
});

function SyllabusProgressRoute() {
    return (
        <LayoutContainer>
            <SyllabusProgressPage />
        </LayoutContainer>
    );
}

function SyllabusSkeleton() {
    return (
        <div className="flex flex-col gap-4" role="status" aria-live="polite">
            <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-card sm:p-card-lg">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-2 w-full rounded-full" />
                <Skeleton className="h-4 w-40" />
            </div>
            <Skeleton className="h-5 w-28" />
            {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-14 w-full rounded-xl" />
            ))}
        </div>
    );
}

function SyllabusProgressPage() {
    const { t } = useTranslation("syllabusProgress");
    const { setNavHeading } = useNavHeadingStore();
    const query = useMySyllabus();

    useEffect(() => {
        setNavHeading(t("page.title"));
    }, [setNavHeading, t]);

    const data = query.data;
    const courses = hasSyllabus(data) ? data?.courses ?? [] : [];

    return (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-section">
            <header className="flex flex-col gap-1">
                <h1 className="text-h2 font-semibold text-foreground">{t("page.title")}</h1>
                <p className="text-body text-muted-foreground">{t("page.subtitle")}</p>
            </header>

            {query.isError ? (
                <LoadErrorState title={t("error.title")} onRetry={() => void query.refetch()} />
            ) : query.isLoadingSyllabus ? (
                <SyllabusSkeleton />
            ) : courses.length === 0 ? (
                <EmptyState
                    icon={BookOpenText}
                    title={t("empty.title")}
                    description={t("empty.description")}
                />
            ) : (
                <div className="flex flex-col gap-section">
                    {courses.map((course) => (
                        <SyllabusCourseSection key={course.package_session_id} course={course} />
                    ))}
                </div>
            )}
        </div>
    );
}
