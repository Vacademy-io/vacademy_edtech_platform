import type { TFunction } from "i18next";
import type { SyllabusBlock, SyllabusCourse } from "../-services/syllabus-progress-service";

/** Blocks in teaching order (block_order, then week). */
export const sortedBlocks = (course: SyllabusCourse): SyllabusBlock[] =>
    [...(course.blocks ?? [])].sort(
        (a, b) =>
            (a.block_order ?? 0) - (b.block_order ?? 0) ||
            (a.week_from ?? 0) - (b.week_from ?? 0)
    );

/** "Weeks 5–8", "Week 3", "Month 2" or "Block 4", whichever the block carries. */
export const blockLabel = (block: SyllabusBlock, t: TFunction): string => {
    const from = block.week_from;
    const to = block.week_to;
    if (from != null && to != null && to !== from) return t("block.weeks", { from, to });
    if (from != null || to != null) return t("block.week", { week: from ?? to });
    if (block.month_no != null) return t("block.month", { month: block.month_no });
    return t("block.fallback", { order: (block.block_order ?? 0) + 1 });
};

/** "You are on Weeks 5–8" for the course's current block, or a done / not-started line. */
export const currentPositionLabel = (course: SyllabusCourse, t: TFunction): string => {
    const current = (course.blocks ?? []).find((b) => b.id === course.current_block_id);
    if (current) {
        const { week_from: from, week_to: to } = current;
        if (from != null && to != null && to !== from) return t("course.onWeeks", { from, to });
        if (from != null || to != null) return t("course.onWeek", { week: from ?? to });
        return t("course.onBlock", { label: blockLabel(current, t) });
    }
    if (course.total_blocks > 0 && course.completed_blocks >= course.total_blocks) {
        return t("course.allDone");
    }
    return t("course.notStarted");
};

export const progressPercent = (course: SyllabusCourse): number =>
    course.total_blocks > 0
        ? Math.round((Math.min(course.completed_blocks, course.total_blocks) / course.total_blocks) * 100)
        : 0;

export interface TrimesterGroup {
    /** null = blocks without a trimester. */
    trimester: number | null;
    blocks: SyllabusBlock[];
}

/** Blocks grouped by trimester (ascending, blocks without one last), each in teaching order. */
export const groupByTrimester = (course: SyllabusCourse): TrimesterGroup[] => {
    const groups = new Map<number | null, SyllabusBlock[]>();
    for (const block of sortedBlocks(course)) {
        const key = block.trimester ?? null;
        const list = groups.get(key);
        if (list) list.push(block);
        else groups.set(key, [block]);
    }
    return [...groups.entries()]
        .sort(([a], [b]) => (a == null ? 1 : b == null ? -1 : a - b))
        .map(([trimester, blocks]) => ({ trimester, blocks }));
};

/**
 * Points the learner should see ticked. A block the teacher marked COMPLETED
 * without ticking individual points counts every point as covered.
 */
export const donePointSeqs = (block: SyllabusBlock): Set<number> => {
    const done = block.points_done ?? [];
    if (block.status === "COMPLETED" && done.length === 0) {
        return new Set((block.points ?? []).map((p) => p.seq));
    }
    return new Set(done);
};

/** Parses a date-only "YYYY-MM-DD" as a local date (no UTC day shift); other strings as-is. */
const parseDate = (value: string): Date | null => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
};

/** "20 Nov" (adds the year when it is not this year), in the learner's language. */
export const formatCompletedOn = (value: string | null, locale: string): string => {
    if (!value) return "";
    const d = parseDate(value);
    if (!d) return "";
    return new Intl.DateTimeFormat(locale, {
        day: "numeric",
        month: "short",
        ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}),
    }).format(d);
};

/** The block the learner is on (the first one not done), or null when none is. */
export const currentBlock = (course: SyllabusCourse): SyllabusBlock | null =>
    (course.blocks ?? []).find((b) => b.id === course.current_block_id) ?? null;

const markedAt = (block: SyllabusBlock): number => {
    const v = block.updated_at;
    if (v == null) return 0;
    const ms = typeof v === "number" ? v : Date.parse(v);
    return Number.isFinite(ms) ? ms : 0;
};

/**
 * The teacher's most recent note on any block: the latest marked one, else (an
 * older server without marking times) the note on the furthest block.
 */
export const latestTeacherNote = (
    course: SyllabusCourse
): { note: string; by: string | null; block: SyllabusBlock } | null => {
    const withNotes = (course.blocks ?? []).filter((b) => b.teacher_note?.trim());
    if (withNotes.length === 0) return null;
    const latest = [...withNotes].sort(
        (a, b) => markedAt(b) - markedAt(a) || (b.block_order ?? 0) - (a.block_order ?? 0)
    )[0]!;
    return { note: latest.teacher_note!.trim(), by: latest.marked_by_name?.trim() || null, block: latest };
};
