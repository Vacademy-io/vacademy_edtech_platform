import { createFileRoute } from "@tanstack/react-router";
import * as Sentry from "@sentry/react";
import { useTranslation } from "react-i18next";
import { CourseDetailsPage } from "./-components/course-details-page";
import { LayoutContainer } from "@/components/common/layout-container/layout-container";
import { Button } from "@/components/ui/button";

interface CourseSearchParams {
    courseId: string;
    packageSessionId?: string;
    selectedTab?: string;
    percentageCompleted?: number;
}

export const Route = createFileRoute("/study-library/courses/course-details/")({
    component: () => (
        <LayoutContainer>
            <CourseDetailsPage />
        </LayoutContainer>
    ),
    errorComponent: ({ error }) => {
        const { t } = useTranslation("courseDetailsC");
        if (error && import.meta.env.VITE_ENABLE_SENTRY === "true") {
            Sentry.captureException(error);
        }
        console.error("Course load error:", error);
        return (
            <LayoutContainer>
                <div className="flex flex-col items-center justify-center p-12 text-center h-screen-70">
                    <div className="w-20 h-20 bg-muted rounded-full flex items-center justify-center mb-6">
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                    </div>
                    <h2 className="text-2xl font-bold mb-2">{t("errorPage.title")}</h2>
                    <p className="text-muted-foreground max-w-md mb-8">
                        {t("errorPage.description")}
                    </p>
                    <Button onClick={() => window.history.back()} variant="default">
                        {t("common.goBack")}
                    </Button>
                </div>
            </LayoutContainer>
        );
    },
    validateSearch: (search: Record<string, unknown>): CourseSearchParams => {
        const s = search as { [k: string]: unknown };
        const rawPct = s["percentageCompleted"] ?? s["percentage_completed"];
        const parsedPct =
            typeof rawPct === "string"
                ? Number(rawPct)
                : typeof rawPct === "number"
                ? rawPct
                : undefined;
        return {
            courseId: search.courseId as string,
            packageSessionId: search.packageSessionId as string,
            selectedTab: search.selectedTab as string,
            percentageCompleted:
                typeof parsedPct === "number" && Number.isFinite(parsedPct) ? parsedPct : undefined,
        };
    },
});
