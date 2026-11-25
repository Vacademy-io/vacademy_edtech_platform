import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CaretDown, MapPin } from "@phosphor-icons/react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { SyllabusCourse } from "../-services/syllabus-progress-service";
import {
    currentPositionLabel,
    groupByTrimester,
    progressPercent,
    type TrimesterGroup,
} from "../-utils/syllabus";
import { SyllabusBlockRow } from "./SyllabusBlockRow";

/** Course name, stage and batch with the overall progress bar and current position. */
export function SyllabusCourseSummary({
    course,
    headingLevel = "h2",
    className,
}: {
    course: SyllabusCourse;
    headingLevel?: "h2" | "h3";
    className?: string;
}) {
    const { t } = useTranslation("syllabusProgress");
    const Heading = headingLevel;
    const percent = progressPercent(course);
    const meta = [course.level_name, course.batch_name].filter(Boolean).join(" · ");
    const done = Math.min(course.completed_blocks, course.total_blocks);

    return (
        <div className={cn("flex flex-col gap-3", className)}>
            <div className="flex flex-col gap-0.5">
                <Heading className="text-title font-semibold text-foreground">
                    {course.course_name || t("page.title")}
                </Heading>
                {meta && <p className="text-caption text-muted-foreground">{meta}</p>}
            </div>
            <div className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-2">
                    <span className="text-caption text-muted-foreground">
                        {t("course.blocksDone", { done, total: course.total_blocks })}
                    </span>
                    <span className="text-caption font-semibold tabular-nums text-foreground">{percent}%</span>
                </div>
                <Progress value={percent} aria-label={t("course.progressLabel")} />
            </div>
            <p className="flex items-center gap-2 text-body font-medium text-foreground">
                <MapPin size={18} weight="duotone" className="shrink-0 text-primary-500" aria-hidden />
                {currentPositionLabel(course, t)}
            </p>
        </div>
    );
}

function TrimesterSection({
    group,
    currentBlockId,
    defaultOpen,
}: {
    group: TrimesterGroup;
    currentBlockId: string | null;
    defaultOpen: boolean;
}) {
    const { t } = useTranslation("syllabusProgress");
    const [open, setOpen] = useState(defaultOpen);
    const done = group.blocks.filter((b) => b.status === "COMPLETED").length;
    const title =
        group.trimester == null ? t("trimester.other") : t("trimester.label", { number: group.trimester });

    return (
        <Collapsible open={open} onOpenChange={setOpen} className="flex flex-col gap-2">
            <CollapsibleTrigger className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-1 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300">
                <span className="text-subtitle font-semibold text-foreground">{title}</span>
                <span className="flex items-center gap-2">
                    <span className="text-caption tabular-nums text-muted-foreground">
                        {t("trimester.summary", { done, total: group.blocks.length })}
                    </span>
                    <CaretDown
                        size={18}
                        className={cn("text-muted-foreground transition-transform", open && "rotate-180")}
                        aria-hidden
                    />
                </span>
            </CollapsibleTrigger>
            <CollapsibleContent className="flex flex-col gap-2">
                {group.blocks.map((block) => (
                    <SyllabusBlockRow key={block.id} block={block} isCurrent={block.id === currentBlockId} />
                ))}
            </CollapsibleContent>
        </Collapsible>
    );
}

/** One course stage: summary card, then its week blocks grouped by trimester. */
export function SyllabusCourseSection({ course }: { course: SyllabusCourse }) {
    const { t } = useTranslation("syllabusProgress");
    const groups = groupByTrimester(course);
    const currentId = course.current_block_id;
    const hasCurrent = !!currentId && groups.some((g) => g.blocks.some((b) => b.id === currentId));
    // Open the trimester holding the current block; with none, the first one still in progress.
    const firstUnfinished = groups.findIndex((g) => g.blocks.some((b) => b.status !== "COMPLETED"));

    return (
        <section className="flex flex-col gap-4">
            <div className="rounded-2xl border border-border bg-card p-card shadow-sm sm:p-card-lg">
                <SyllabusCourseSummary course={course} />
            </div>
            {groups.length === 0 ? (
                <p className="px-1 text-body text-muted-foreground">{t("course.noBlocks")}</p>
            ) : (
                <div className="flex flex-col gap-4">
                    {groups.map((group, index) => (
                        <TrimesterSection
                            key={group.trimester ?? "none"}
                            group={group}
                            currentBlockId={currentId}
                            defaultOpen={
                                hasCurrent
                                    ? group.blocks.some((b) => b.id === currentId)
                                    : index === firstUnfinished
                            }
                        />
                    ))}
                </div>
            )}
        </section>
    );
}
