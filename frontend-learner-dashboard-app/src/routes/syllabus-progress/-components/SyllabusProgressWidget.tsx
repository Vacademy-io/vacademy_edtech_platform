import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { BookOpenText, CaretRight, Quotes } from "@phosphor-icons/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { MyButton } from "@/components/design-system/button";
import { cn } from "@/lib/utils";
import { hasSyllabus, useMySyllabus, type SyllabusCourse } from "../-services/syllabus-progress-service";
import { blockLabel, currentBlock, latestTeacherNote, progressPercent, sortedBlocks } from "../-utils/syllabus";

/** How many of the current block's points the card lists. */
const POINTS_SHOWN = 3;

/** The course's stages in order, the learner's own marked. Shown only for two or more stages. */
function StagePath({ course }: { course: SyllabusCourse }) {
    const { t } = useTranslation("syllabusProgress");
    const levels = (course.levels ?? []).filter((l) => l.name?.trim());
    if (levels.length < 2) return null;
    const currentIndex = levels.findIndex(
        (l) => l.id === course.level_id || (!course.level_id && l.name === course.level_name)
    );
    return (
        <ol className="flex flex-wrap items-center gap-x-1 gap-y-2" aria-label={t("card.stagesLabel")}>
            {levels.map((level, index) => {
                const isCurrent = index === currentIndex;
                const isPast = currentIndex >= 0 && index < currentIndex;
                return (
                    <li key={level.id} className="flex items-center gap-1" aria-current={isCurrent ? "step" : undefined}>
                        {index > 0 && (
                            <span
                                aria-hidden
                                className={cn("h-0.5 w-3 rounded-full", isPast || isCurrent ? "bg-primary-300" : "bg-border")}
                            />
                        )}
                        <span
                            className={cn(
                                "rounded-full px-2.5 py-1 text-caption",
                                isCurrent
                                    ? "bg-primary-500 font-semibold text-primary-foreground"
                                    : isPast
                                      ? "bg-primary-50 text-primary-500"
                                      : "bg-muted text-muted-foreground"
                            )}
                        >
                            <bdi>{level.name}</bdi>
                            {isCurrent && <span className="sr-only"> {t("card.currentStage")}</span>}
                        </span>
                    </li>
                );
            })}
        </ol>
    );
}

/** One course: stage path, week blocks done, this week's points and the teacher's latest note. */
function CourseCardBody({ course, showName }: { course: SyllabusCourse; showName: boolean }) {
    const { t } = useTranslation("syllabusProgress");
    const percent = progressPercent(course);
    const done = Math.min(course.completed_blocks, course.total_blocks);
    const current = currentBlock(course);
    const allDone = !current && course.total_blocks > 0 && done >= course.total_blocks;
    const points = (current?.points ?? []).slice().sort((a, b) => a.seq - b.seq);
    const note = latestTeacherNote(course);
    const hasStages = (course.levels ?? []).filter((l) => l.name?.trim()).length >= 2;
    // The course name, and its stage when no stage path shows it (never the batch's code name).
    const heading = [course.course_name, hasStages ? null : course.level_name].filter(Boolean).join(" · ");

    return (
        <div className="flex flex-col gap-3">
            {showName && heading && <h3 className="text-subtitle font-semibold text-foreground">{heading}</h3>}
            <StagePath course={course} />
            <div className="flex flex-col gap-1.5">
                <p className="text-caption text-muted-foreground">
                    {t("card.blocksDone", { done, count: course.total_blocks, percent })}
                </p>
                <Progress value={percent} aria-label={t("course.progressLabel")} />
            </div>
            {allDone ? (
                <p className="text-body font-medium text-foreground">{t("course.allDone")}</p>
            ) : current ? (
                <div className="flex flex-col gap-1.5">
                    <p className="text-body font-semibold text-foreground">
                        {t("card.thisWeek", { label: blockLabel(current, t) })}
                    </p>
                    {points.length > 0 ? (
                        <ul className="flex list-disc flex-col gap-1 ps-5 text-caption text-muted-foreground">
                            {points.slice(0, POINTS_SHOWN).map((p) => (
                                <li key={p.seq} className="line-clamp-2">
                                    {p.text}
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-caption text-muted-foreground">{t("block.noPoints")}</p>
                    )}
                    {points.length > POINTS_SHOWN && (
                        <p className="text-caption text-muted-foreground">
                            {t("card.morePoints", { count: points.length - POINTS_SHOWN })}
                        </p>
                    )}
                </div>
            ) : (
                <p className="text-body text-muted-foreground">{t("course.notStarted")}</p>
            )}
            {note && (
                <figure className="flex flex-col gap-1 rounded-lg bg-muted p-3">
                    <figcaption className="flex items-center gap-1.5 text-caption font-semibold text-foreground">
                        <Quotes size={14} weight="fill" className="text-primary-500" aria-hidden />
                        {note.by ? t("note.from", { name: note.by }) : t("note.fallback")}
                    </figcaption>
                    <blockquote className="line-clamp-3 text-caption text-muted-foreground">{note.note}</blockquote>
                </figure>
            )}
        </div>
    );
}

/**
 * Dashboard card: the learner's syllabus for their course stage, with a way into
 * /syllabus-progress. Renders nothing unless the institute has the feature on and
 * the learner has a syllabus.
 */
export function SyllabusProgressWidget() {
    const { t } = useTranslation("syllabusProgress");
    const navigate = useNavigate();
    const { data } = useMySyllabus({ retry: false });

    if (!hasSyllabus(data)) return null;
    const courses = (data?.courses ?? []).map((c) => ({ ...c, blocks: sortedBlocks(c) }));
    const shown = courses.slice(0, 2);

    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                    <BookOpenText size={18} weight="duotone" className="text-primary-500" aria-hidden />
                    {t("card.title")}
                </CardTitle>
                {shown.length === 1 && shown[0]?.course_name && (
                    <p className="text-caption text-muted-foreground">
                        {[shown[0].course_name, (shown[0].levels?.length ?? 0) >= 2 ? null : shown[0].level_name]
                            .filter(Boolean)
                            .join(" · ")}
                    </p>
                )}
            </CardHeader>
            <CardContent className="flex flex-col gap-stack">
                {shown.map((course, index) => (
                    <div key={course.package_session_id} className={index > 0 ? "border-t border-border pt-4" : undefined}>
                        <CourseCardBody course={course} showName={shown.length > 1} />
                    </div>
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
