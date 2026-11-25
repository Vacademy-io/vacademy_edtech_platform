import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
    ArrowBendUpRight,
    CaretDown,
    Check,
    CheckCircle,
    Circle,
    CircleHalf,
    NotePencil,
    type Icon,
} from "@phosphor-icons/react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { SyllabusBlock, SyllabusBlockStatus } from "../-services/syllabus-progress-service";
import { blockLabel, donePointSeqs, formatCompletedOn } from "../-utils/syllabus";

const STATUS_ICON: Record<SyllabusBlockStatus, { icon: Icon; className: string; weight: "fill" | "duotone" | "regular" }> = {
    COMPLETED: { icon: CheckCircle, className: "text-success-600", weight: "fill" },
    IN_PROGRESS: { icon: CircleHalf, className: "text-primary-500", weight: "fill" },
    SKIPPED: { icon: ArrowBendUpRight, className: "text-warning-600", weight: "regular" },
    NOT_STARTED: { icon: Circle, className: "text-muted-foreground", weight: "regular" },
};

export function SyllabusBlockRow({
    block,
    isCurrent,
}: {
    block: SyllabusBlock;
    isCurrent: boolean;
}) {
    const { t, i18n } = useTranslation("syllabusProgress");
    // The current block opens by default; every other block starts collapsed.
    const [open, setOpen] = useState(isCurrent);

    const status = STATUS_ICON[block.status] ?? STATUS_ICON.NOT_STARTED;
    const StatusIcon = status.icon;
    const points = [...(block.points ?? [])].sort((a, b) => a.seq - b.seq);
    const done = donePointSeqs(block);
    const doneCount = points.filter((p) => done.has(p.seq)).length;
    const completedOn = formatCompletedOn(block.completed_on, i18n.language);

    const statusText =
        block.status === "COMPLETED"
            ? completedOn
                ? t("status.completedOn", { date: completedOn })
                : t("status.completed")
            : block.status === "IN_PROGRESS"
              ? t("status.inProgress")
              : block.status === "SKIPPED"
                ? t("status.skipped")
                : t("status.notStarted");

    return (
        <Collapsible
            open={open}
            onOpenChange={setOpen}
            className={cn(
                "rounded-xl border bg-card transition-colors",
                isCurrent ? "border-primary-300 bg-primary-50 shadow-sm" : "border-border"
            )}
        >
            <CollapsibleTrigger
                className="flex min-h-14 w-full items-center gap-3 rounded-xl px-4 py-3 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                aria-current={isCurrent ? "step" : undefined}
            >
                <StatusIcon size={22} weight={status.weight} className={cn("shrink-0", status.className)} aria-hidden />
                <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex flex-wrap items-center gap-2">
                        <span className="text-body font-semibold text-foreground">{blockLabel(block, t)}</span>
                        {isCurrent && (
                            <span className="rounded-full bg-primary-500 px-2 py-0.5 text-caption font-medium text-primary-foreground">
                                {t("block.current")}
                            </span>
                        )}
                    </span>
                    <span
                        className={cn(
                            "text-caption",
                            block.status === "COMPLETED"
                                ? "text-success-700"
                                : block.status === "SKIPPED"
                                  ? "text-warning-700"
                                  : "text-muted-foreground"
                        )}
                    >
                        {statusText}
                        {points.length > 0 && block.status !== "NOT_STARTED" && (
                            <span className="text-muted-foreground">
                                {" · "}
                                {t("block.pointsProgress", { done: doneCount, total: points.length })}
                            </span>
                        )}
                    </span>
                </span>
                {block.teacher_note && !open && (
                    <NotePencil size={18} className="shrink-0 text-muted-foreground" aria-hidden />
                )}
                <CaretDown
                    size={18}
                    className={cn("shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
                    aria-hidden
                />
            </CollapsibleTrigger>

            <CollapsibleContent className="flex flex-col gap-3 px-4 pb-4">
                {points.length > 0 ? (
                    <ul className="flex flex-col gap-2">
                        {points.map((point) => {
                            const ticked = done.has(point.seq);
                            return (
                                <li key={point.seq} className="flex items-start gap-3">
                                    <span
                                        className={cn(
                                            "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border",
                                            ticked
                                                ? "border-success-500 bg-success-500 text-white"
                                                : "border-border bg-card"
                                        )}
                                    >
                                        {ticked && <Check size={12} weight="bold" aria-hidden />}
                                    </span>
                                    <span
                                        className={cn(
                                            "text-body",
                                            ticked ? "text-foreground" : "text-muted-foreground"
                                        )}
                                    >
                                        {point.text}
                                        <span className="sr-only">
                                            {" — "}
                                            {ticked ? t("block.pointDone") : t("block.pointPending")}
                                        </span>
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
                ) : (
                    <p className="text-caption text-muted-foreground">{t("block.noPoints")}</p>
                )}

                {block.teacher_note && (
                    <div className="flex gap-3 rounded-lg bg-muted p-3">
                        <NotePencil size={18} className="mt-0.5 shrink-0 text-primary-500" aria-hidden />
                        <div className="flex min-w-0 flex-col gap-0.5">
                            <span className="text-caption font-medium text-muted-foreground">
                                {block.marked_by_name
                                    ? t("note.from", { name: block.marked_by_name })
                                    : t("note.fallback")}
                            </span>
                            <p className="whitespace-pre-line break-words text-body text-foreground">
                                {block.teacher_note}
                            </p>
                        </div>
                    </div>
                )}
            </CollapsibleContent>
        </Collapsible>
    );
}
