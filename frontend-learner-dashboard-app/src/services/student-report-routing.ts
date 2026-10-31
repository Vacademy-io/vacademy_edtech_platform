import { getUserId } from "@/constants/getUserId";
import { GET_AI_PROCESSED_LOGS } from "@/constants/urls";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";

/**
 * One report per attempt: the AI report once it has been generated, otherwise the normal
 * report. The AI report includes everything the normal one has (its "Questions & marks"
 * tab is the normal report), so a learner never needs both buttons.
 */

// An AI report never disappears once generated, so a positive answer is cached for the
// session. A negative one is not: it may be generated a minute later.
const knownAiReports = new Set<string>();

export async function hasAiReport(assessmentId: string): Promise<boolean> {
  if (knownAiReports.has(assessmentId)) return true;
  try {
    const userId = await getUserId();
    if (!userId) return false;
    const response = await authenticatedAxiosInstance({
      method: "GET",
      url: GET_AI_PROCESSED_LOGS,
      params: { userId, sourceId: assessmentId },
    });
    const json: string | undefined = response.data?.activity_logs?.[0]?.processed_json;
    const exists = !!json && json.trim().length > 2;
    if (exists) knownAiReports.add(assessmentId);
    return exists;
  } catch {
    // Unknown → the normal report, which always exists for a released attempt.
    return false;
  }
}

export interface ReportTarget {
  assessmentId: string;
  assessmentName?: string;
  attemptId?: string;
  evaluationType?: string;
  /** Extra router state the normal report page reads (e.g. the list row). */
  state?: Record<string, unknown>;
}

type Navigate = (opts: {
  to: string;
  search?: Record<string, unknown>;
  state?: unknown;
}) => unknown;

export async function openStudentReport(navigate: Navigate, target: ReportTarget): Promise<void> {
  const manual = (target.evaluationType || "").toUpperCase() === "MANUAL";
  if (!manual && (await hasAiReport(target.assessmentId))) {
    navigate({
      to: "/assessment/reports/ai-report",
      search: {
        assessmentId: target.assessmentId,
        assessmentName: target.assessmentName ?? "",
        ...(target.attemptId ? { attemptId: target.attemptId } : {}),
      },
    });
    return;
  }
  navigate({
    to: "/assessment/reports/comparison",
    search: { assessmentId: target.assessmentId, attemptId: target.attemptId ?? "" },
    state: {
      ...(target.state ?? {}),
      assessmentName: target.assessmentName,
      evaluationType: target.evaluationType,
    },
  });
}
