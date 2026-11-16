import { useQueries } from "@tanstack/react-query";

/*
 * The names that tell two batches of one course apart, for the Fun course tiles and
 * Learn rows. The learner's enrolment list carries the batch id and the level, but
 * not the session or batch name, so two batches of one course at the same level read
 * the same. The course's batch list (the one the course page already asks for) has
 * both, keyed by the same batch id. It is asked for only for course names that show
 * up more than once and lack those names, and the request code loads on first use.
 */

/** A batch's own names, blank where it has none (placeholders are blank too). */
export interface BatchNames {
  level: string;
  session: string;
  batch: string;
}

/** One row of the course batch list, as far as names go. */
export interface CourseBatchNamesRow {
  id?: string | null;
  package_dto?: { package_name?: string | null } | null;
  level?: { level_name?: string | null } | null;
  session?: { session_name?: string | null } | null;
  /** "<course name> <batch name>" when the batch has a name, else null. */
  package_session_name?: string | null;
}

const PLACEHOLDER_NAMES = new Set(["default", "untitled", "n/a", "-"]);

/** The name as shown, or "" for a blank or a platform placeholder ("default"). */
export const shownName = (name: string | null | undefined): string => {
  const text = (name ?? "").trim();
  return text && !PLACEHOLDER_NAMES.has(text.toLowerCase()) ? text : "";
};

const nameKey = (name: string | null | undefined): string => (name ?? "").trim().toLocaleLowerCase();

/** Batch id → its names. The batch name loses the course name the list puts in front of it. */
export function batchNamesOf(rows: readonly CourseBatchNamesRow[] | null | undefined): Map<string, BatchNames> {
  const out = new Map<string, BatchNames>();
  for (const row of rows ?? []) {
    if (!row?.id) continue;
    const course = (row.package_dto?.package_name ?? "").trim();
    let batch = (row.package_session_name ?? "").trim();
    if (course && batch.toLocaleLowerCase().startsWith(`${course.toLocaleLowerCase()} `)) {
      batch = batch.slice(course.length).trim();
    }
    out.set(row.id, {
      level: shownName(row.level?.level_name),
      session: shownName(row.session?.session_name),
      batch: shownName(batch),
    });
  }
  return out;
}

/** A course row, as far as deciding whether its batch names are needed goes. */
export interface BatchNameNeed {
  courseId?: string | null;
  name?: string | null;
  session?: string | null;
  batch?: string | null;
}

/**
 * The course ids whose batch names are worth asking for: rows whose course name
 * another row shares and that lack a session or a batch name. Sorted and distinct,
 * so the same list asks the same questions.
 */
export function courseIdsNeedingBatchNames(rows: readonly BatchNameNeed[]): string[] {
  const count = new Map<string, number>();
  for (const row of rows) {
    const key = nameKey(row.name);
    if (key) count.set(key, (count.get(key) ?? 0) + 1);
  }
  const ids = new Set<string>();
  for (const row of rows) {
    if (!row.courseId || (count.get(nameKey(row.name)) ?? 0) < 2) continue;
    if (!shownName(row.session) || !shownName(row.batch)) ids.add(row.courseId);
  }
  return [...ids].sort();
}

/** Fills the blanks in a row's names from its batch's, keeping what the row has. */
export function withBatchNames<T extends { level?: string | null; session?: string | null; batch?: string | null }>(
  row: T,
  names: BatchNames | undefined,
): T {
  if (!names) return row;
  return {
    ...row,
    level: shownName(row.level) || names.level,
    session: shownName(row.session) || names.session,
    batch: shownName(row.batch) || names.batch,
  };
}

const BATCH_NAMES_STALE_MS = 5 * 60_000;

/**
 * Batch id → names for these courses' batches. Empty until the lists answer; a
 * course whose list fails adds nothing, so its rows keep the names they had.
 */
export function useBatchNames(courseIds: readonly string[]): Map<string, BatchNames> {
  const results = useQueries({
    queries: courseIds.map((courseId) => ({
      queryKey: ["fun-course-batch-names", courseId],
      queryFn: async () => {
        const { fetchBatchesForCourse } = await import("@/services/courseBatches");
        return (await fetchBatchesForCourse(courseId)) as unknown as CourseBatchNamesRow[];
      },
      staleTime: BATCH_NAMES_STALE_MS,
      retry: false,
    })),
  });
  const out = new Map<string, BatchNames>();
  for (const result of results) {
    for (const [id, names] of batchNamesOf(result.data)) out.set(id, names);
  }
  return out;
}
