import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { BookOpenText, CaretRight } from "@phosphor-icons/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MyButton } from "@/components/design-system/button";
import { hasSyllabus, useMySyllabus } from "../-services/syllabus-progress-service";
import { SyllabusCourseSummary } from "./SyllabusCourseSection";

/**
 * Dashboard rail card: overall syllabus progress and "You are on Weeks X–Y" per
 * course stage, with a way into /syllabus-progress. Renders nothing unless the
 * institute has the feature on and the learner has a syllabus.
 */
export function SyllabusProgressWidget() {
    const { t } = useTranslation("syllabusProgress");
    const navigate = useNavigate();
    const { data } = useMySyllabus({ retry: false });

    if (!hasSyllabus(data)) return null;
    const courses = data?.courses ?? [];

    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                    <BookOpenText size={18} weight="duotone" className="text-primary-500" aria-hidden />
                    {t("card.title")}
                </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-stack">
                {courses.slice(0, 2).map((course, index) => (
                    <SyllabusCourseSummary
                        key={course.package_session_id}
                        course={course}
                        headingLevel="h3"
                        className={index > 0 ? "border-t border-border pt-4" : undefined}
                    />
                ))}
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="medium"
                    className="w-full"
                    onClick={() => navigate({ to: "/syllabus-progress" })}
                >
                    {t("card.open")}
                    <CaretRight size={16} className="rtl:rotate-180" aria-hidden />
                </MyButton>
            </CardContent>
        </Card>
    );
}
