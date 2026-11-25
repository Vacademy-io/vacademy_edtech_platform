import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { REATTEMPT_REQUEST, REATTEMPT_REQUEST_MINE } from "@/constants/urls";
import { getInstituteId } from "@/constants/helper";

export type ReattemptRequestType = "REATTEMPT" | "TIME_INCREASE" | "PROBLEM_REPORT";
/** RESOLVED is how the institute closes a PROBLEM_REPORT. */
export type ReattemptRequestStatus = "PENDING" | "APPROVED" | "REJECTED" | "RESOLVED";

export interface ReattemptRequest {
  id: string;
  assessment_id: string;
  request_type: ReattemptRequestType;
  reason: string;
  status: ReattemptRequestStatus;
  granted_count?: number | null;
  /** Minutes added to the attempt when a TIME_INCREASE request was approved. */
  granted_minutes?: number | null;
  /** PROBLEM_REPORT only: the question it is about. */
  question_id?: string | null;
  review_note?: string | null;
  reviewed_at?: string | null;
  created_at?: string | null;
}

/**
 * Raise a reattempt / time-extension request, or report a problem.
 *
 * The backend de-duplicates on (assessment, learner, type) while one is still PENDING and
 * returns the existing row, so a learner tapping Submit twice while a timer runs down gets
 * their original request back rather than a second one in the admin's queue. Problem reports
 * are de-duplicated per question instead, so a learner can report several questions.
 */
export async function createReattemptRequest(params: {
  assessmentId: string;
  requestType: ReattemptRequestType;
  reason: string;
  attemptId?: string | null;
  questionId?: string | null;
}): Promise<ReattemptRequest> {
  const instituteId = await getInstituteId();
  const response = await authenticatedAxiosInstance.post(REATTEMPT_REQUEST, {
    assessment_id: params.assessmentId,
    institute_id: instituteId,
    request_type: params.requestType,
    reason: params.reason,
    attempt_id: params.attemptId ?? null,
    question_id: params.questionId ?? null,
  });
  return response.data;
}

/** Existing requests for this assessment, so the dialog can show one already in flight. */
export async function getMyReattemptRequests(
  assessmentId: string
): Promise<ReattemptRequest[]> {
  const response = await authenticatedAxiosInstance.get(REATTEMPT_REQUEST_MINE, {
    params: { assessmentId },
  });
  return Array.isArray(response.data) ? response.data : [];
}
