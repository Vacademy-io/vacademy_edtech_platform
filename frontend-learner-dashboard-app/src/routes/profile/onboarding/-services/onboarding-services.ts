import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { BASE_URL } from "@/constants/urls";

/**
 * Learner-facing Onboarding API client.
 *
 * These endpoints are learner-scoped: the backend resolves "who is asking"
 * from the JWT (`@RequestParam("user") CustomUserDetails`) server-side, so we
 * never send a subject/user id from here — only `instituteId` where required.
 * See admin_core_service `LearnerOnboardingController`.
 */
const ONBOARDING_BASE = `${BASE_URL}/admin-core-service/learner/onboarding`;

export type OnboardingInstanceStatus =
  | "IN_PROGRESS"
  | "COMPLETED"
  | "ABANDONED"
  | "CANCELLED";

export type OnboardingStepStatus =
  | "PENDING"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "SKIPPED";

/** v1 has exactly one step type. Kept as a union so future types type-check cleanly. */
export type OnboardingStepType = "FORM" | (string & {});

export interface OnboardingStepInstanceDTO {
  id: string;
  onboarding_instance_id: string;
  step_id: string;
  step_name: string;
  step_type: OnboardingStepType;
  status: OnboardingStepStatus;
  entered_at: string | null;
  completed_at: string | null;
  completed_by_user_id: string | null;
  skip_reason: string | null;
  /** Whether the caller (resolved STUDENT/PARENT role) can actually act on this step --
   *  false for a create_student-configured step (always admin-only) or one whose step-level
   *  role_access denies this role edit permission. Used to avoid blocking the learner on a
   *  step only an admin can complete. */
  learner_can_act: boolean | null;
}

export interface OnboardingInstanceDTO {
  id: string;
  flow_id: string;
  institute_id: string;
  subject_user_id: string;
  /** Set only when the caller isn't the subject themself (a parent viewing a linked
   *  child's instance) — lets a parent with multiple children tell their cards apart. */
  subject_full_name: string | null;
  current_step_id: string | null;
  status: OnboardingInstanceStatus;
  started_by: string | null;
  started_at: string | null;
  completed_at: string | null;
  step_instances: OnboardingStepInstanceDTO[];
}

export interface CurrentStepInfo {
  step: OnboardingStepInstanceDTO;
  /** False when there IS a current step but this caller can't act on it themself (e.g. an
   *  admin-only create_student step, or one whose role_access denies this role edit) --
   *  distinct from there being no current step at all. Lets callers show "this step is being
   *  handled by your admin" instead of just silently having nothing to show. */
  isActionable: boolean;
}

/**
 * The instance's current in-progress/pending step, if any — regardless of whether the caller
 * can act on it themself. Centralizes "which step is current" so /dashboard's gate and the
 * /onboarding page agree on the same notion of "current" and "actionable".
 */
export function getCurrentStepInfo(instance: OnboardingInstanceDTO): CurrentStepInfo | null {
  if (instance.status !== "IN_PROGRESS") return null;
  const step =
    instance.step_instances.find((s) => s.id === instance.current_step_id) ??
    instance.step_instances.find((s) => s.status === "IN_PROGRESS");
  if (!step) return null;
  if (step.status !== "IN_PROGRESS" && step.status !== "PENDING") return null;
  const isActionable = step.step_type === "FORM" && step.learner_can_act !== false;
  return { step, isActionable };
}

/** Fetches every onboarding instance in progress (or completed) for the caller. */
export const getMyOnboardingInstances = async (
  instituteId: string
): Promise<OnboardingInstanceDTO[]> => {
  const response = await authenticatedAxiosInstance.get<OnboardingInstanceDTO[]>(
    `${ONBOARDING_BASE}/instances`,
    { params: { instituteId } }
  );
  return Array.isArray(response?.data) ? response.data : [];
};

export const getStepInstance = async (
  stepInstanceId: string
): Promise<OnboardingStepInstanceDTO> => {
  const response = await authenticatedAxiosInstance.get<OnboardingStepInstanceDTO>(
    `${ONBOARDING_BASE}/step-instances/${stepInstanceId}`
  );
  return response.data;
};

/**
 * Submits a FORM step. `payload` is keyed by institute_custom_field_id.
 * The server re-validates mandatory fields and per-field edit permission on
 * every submit — a rejected submission (e.g. missing mandatory field) throws
 * (HTTP 400), it is NOT reflected as a non-2xx `data` shape. Callers must
 * catch and surface `getOnboardingApiErrorMessage(error, ...)`.
 */
export const submitStepInstance = async (
  stepInstanceId: string,
  payload: Record<string, string>
): Promise<OnboardingStepInstanceDTO> => {
  const response = await authenticatedAxiosInstance.post<OnboardingStepInstanceDTO>(
    `${ONBOARDING_BASE}/step-instances/${stepInstanceId}/submit`,
    { payload }
  );
  return response.data;
};

/**
 * One field of a FORM step, already resolved for the caller's own role: a field the caller
 * can't VIEW is simply absent from the response (not sent with some canView=false flag), and
 * `can_edit` says whether they may change `value` — a view-only field should render read-only,
 * pre-filled with `value`. Replaces the previous generic (role-unaware) feature-fields lookup,
 * which returned every field mapped to the step as if it were always editable.
 */
export interface OnboardingResolvedFieldDTO {
  institute_custom_field_id: string;
  field_name: string | null;
  /**
   * The field's configured type — text | dropdown | number | email | url | date | phone |
   * textarea | checkbox | radio | file | multi_select. Without it the form could only ever
   * render a plain text box, so a dropdown, date or file field degraded to free text.
   */
  field_type: string | null;
  /** custom_fields.config JSON verbatim — CustomFieldRenderer parses options / file limits out of it. */
  config: string | null;
  default_value: string | null;
  field_order: number | null;
  is_mandatory: boolean | null;
  can_edit: boolean | null;
  value: string | null;
}

/** Fields configured for one FORM step, resolved for the caller's own role — see `OnboardingResolvedFieldDTO`. */
export const getResolvedStepFields = async (
  stepInstanceId: string
): Promise<OnboardingResolvedFieldDTO[]> => {
  const response = await authenticatedAxiosInstance.get<OnboardingResolvedFieldDTO[]>(
    `${ONBOARDING_BASE}/step-instances/${stepInstanceId}/fields`
  );
  return Array.isArray(response?.data) ? response.data : [];
};

/** One step of the onboarding, with whatever was recorded on it. */
export interface OnboardingSubmittedStepDTO {
  step_instance_id: string;
  step_id: string;
  step_name: string;
  step_order: number | null;
  status: OnboardingStepStatus;
  completed_at: string | null;
  skip_reason: string | null;
  fields: OnboardingResolvedFieldDTO[];
}

/**
 * The whole filled-in history of one onboarding instance in a single call — what backs the
 * "my onboarding details" summary the learner can open long after the flow finished.
 * Per-step `getResolvedStepFields` is still the right call for the live FORM (one step), but
 * would turn this view into one request per step.
 *
 * Already filtered server-side to the fields this caller's role may VIEW, hidden fields
 * excluded — the same rules the form itself applies.
 */
export const getSubmittedSteps = async (
  instanceId: string
): Promise<OnboardingSubmittedStepDTO[]> => {
  const response = await authenticatedAxiosInstance.get<OnboardingSubmittedStepDTO[]>(
    `${ONBOARDING_BASE}/instances/${instanceId}/submitted-steps`
  );
  return Array.isArray(response?.data) ? response.data : [];
};

/**
 * Extracts a human-readable message from a backend error. VacademyException
 * responses carry the message in `ex` ({ url, ex, responseCode, date }); we
 * also tolerate `message`/`error` shapes, falling back to the provided text.
 */
export const getOnboardingApiErrorMessage = (
  error: unknown,
  fallback: string
): string => {
  const err = error as {
    response?: { data?: { ex?: string; message?: string; error?: string } };
  };
  return (
    err?.response?.data?.ex ||
    err?.response?.data?.message ||
    err?.response?.data?.error ||
    fallback
  );
};
