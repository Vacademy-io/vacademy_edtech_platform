import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { STUDENT_REPORT_URL } from "@/constants/urls";

/**
 * Opening the result straight after submit.
 *
 * Marks are calculated asynchronously after the submit call returns, and the
 * report endpoints must not be asked too early: the comparison data is cached
 * per attempt for 15 minutes in each assessment-service replica, so an early
 * read can pin an empty or partial result. Readiness is therefore read from the
 * learner's report list (uncached), which lists the attempt only once it is
 * ENDED and RELEASED.
 */

export interface InstantResultContext {
  evaluationType: string;
  playMode: string;
  resultType: string;
}

/**
 * Only tests whose result is released on submission open it right away.
 * MANUAL evaluation waits for a teacher, a survey has no marks, and the other
 * result types (after the end date, released by hand) keep the old flow.
 */
export function opensResultOnSubmit({
  evaluationType,
  playMode,
  resultType,
}: InstantResultContext): boolean {
  if ((evaluationType || "").toUpperCase() === "MANUAL") return false;
  if ((playMode || "").toUpperCase() === "SURVEY") return false;
  return (resultType || "").toUpperCase() === "AUTO_AFTER_SUBMISSION";
}

interface ReportRow {
  attempt_id?: string | null;
  report_release_status?: string | null;
}

/** One page of the learner's released reports. */
export type FetchReleasedReports = (instituteId: string) => Promise<ReportRow[]>;

// The list query has no stable order and returns the newest attempt of each
// test, so one generous page is read rather than paging.
const REPORT_PAGE_SIZE = 200;

const fetchReleasedReports: FetchReleasedReports = async (instituteId) => {
  const response = await authenticatedAxiosInstance.post(
    STUDENT_REPORT_URL,
    {
      name: "",
      status: ["ENDED"],
      release_result_status: ["RELEASED"],
      assessment_type: ["ASSESSMENT", "HOMEWORK"],
      sort_columns: {},
    },
    { params: { instituteId, pageNo: 0, pageSize: REPORT_PAGE_SIZE } },
  );
  return (response?.data?.content ?? []) as ReportRow[];
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Resolves true once the attempt's result is released, false if it is not
 * released within `timeoutMs` (the caller then falls back to the test list).
 * A failed read is retried until the timeout; it never throws.
 */
export async function waitForReleasedResult({
  attemptId,
  instituteId,
  timeoutMs = 8000,
  intervalMs = 1000,
  fetchReports = fetchReleasedReports,
}: {
  attemptId: string;
  instituteId: string;
  timeoutMs?: number;
  intervalMs?: number;
  fetchReports?: FetchReleasedReports;
}): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const rows = await fetchReports(instituteId);
      if (
        rows.some(
          (row) =>
            row.attempt_id === attemptId &&
            row.report_release_status === "RELEASED",
        )
      ) {
        return true;
      }
    } catch {
      // Network blip or a slow replica: try again until the deadline.
    }
    if (Date.now() + intervalMs > deadline) return false;
    await sleep(intervalMs);
  }
}
