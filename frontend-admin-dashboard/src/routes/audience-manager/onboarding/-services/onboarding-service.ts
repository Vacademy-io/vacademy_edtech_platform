/**
 * Onboarding Flows — data layer.
 *
 * Onboarding Flows are institute-defined ordered checklists (v1: FORM steps
 * built from institute custom fields) a lead/student goes through between
 * "agreed to join" and "fully enrolled". Backed by admin-core-service's
 * /onboarding/* controllers (OnboardingFlowController, OnboardingStepController,
 * OnboardingInstanceController, OnboardingStepInstanceController).
 *
 * Request/response payloads are snake_case (backend @JsonNaming contract).
 * Auth (`user`) is injected automatically by authenticatedAxiosInstance's
 * interceptor — never add it here.
 */
import type { TFunction } from 'i18next';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import {
    ONBOARDING_FLOWS_BASE,
    ONBOARDING_INSTANCES_BASE,
    ONBOARDING_SIDE_VIEW,
    ONBOARDING_STEP_INSTANCES_BASE,
    ONBOARDING_STEP_FEATURE_FIELDS,
    COURSE_CATALOG_URL,
    ROLES_BASE,
} from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { getInstituteId } from '@/constants/helper';

// ── Shared enums / literals ─────────────────────────────────────────────────

export type OnboardingFlowStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
export type OnboardingStartMode = 'MANUAL' | 'AUTO' | 'BOTH';
export type OnboardingStepType = 'FORM';
/**
 * A role in a step's / field's access grid. ADMIN, STUDENT and PARENT are the three the
 * LEARNER surface resolves itself to and are always present in the grid; beyond those, a grid
 * entry may name ANY institute role from auth_service (COUNSELLOR, a custom role, …) — that is
 * how a non-admin staff member is given a step to work on. Hence `string`, not a closed union.
 */
export type OnboardingRoleKey = 'ADMIN' | 'STUDENT' | 'PARENT' | (string & {});
export type OnboardingInstanceStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED' | string;
export type OnboardingStepInstanceStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED';

/** The three built-ins, always shown in the grid and never removable. */
export const ONBOARDING_BUILTIN_ROLE_KEYS = ['ADMIN', 'STUDENT', 'PARENT'] as const;
/** @deprecated Use {@link ONBOARDING_BUILTIN_ROLE_KEYS} — the grid is no longer limited to these. */
export const ONBOARDING_ROLE_KEYS: OnboardingRoleKey[] = [...ONBOARDING_BUILTIN_ROLE_KEYS];

// ── Role access ──────────────────────────────────────────────────────────────

export interface OnboardingRoleAccess {
    role_key: OnboardingRoleKey;
    can_view: boolean;
    can_edit: boolean;
}

/** Default role-access grid: ADMIN full access, STUDENT can view only, PARENT no access. */
export function defaultRoleAccess(): OnboardingRoleAccess[] {
    return [
        { role_key: 'ADMIN', can_view: true, can_edit: true },
        { role_key: 'STUDENT', can_view: true, can_edit: false },
        { role_key: 'PARENT', can_view: false, can_edit: false },
    ];
}

/**
 * Institute roles offered by the grid's "Add role" picker — auth_service's system roles
 * (institute_id IS NULL) plus this institute's own custom roles, from
 * GET /auth-service/v1/institute/{instituteId}/roles.
 *
 * The backend matches a grid entry against the caller's JWT role NAMES, so `role_key` is the
 * role's name (uppercased), never its id — an id would never match anything. Matching is
 * case-insensitive server-side, but we normalise here so stored grids stay consistent.
 */
export interface OnboardingAssignableRole {
    role_key: string;
    label: string;
    /** True for auth_service system roles (shared across institutes) rather than custom ones. */
    is_system: boolean;
}

export const onboardingAssignableRolesKey = (instituteId: string) =>
    ['onboarding-assignable-roles', instituteId] as const;

export async function fetchOnboardingAssignableRoles(
    instituteId: string
): Promise<OnboardingAssignableRole[]> {
    const { data } = await authenticatedAxiosInstance.get(`${ROLES_BASE}/${instituteId}/roles`);
    const rows: Array<{ id?: string; name?: string; instituteId?: string | null }> = Array.isArray(data)
        ? data
        : [];
    const seen = new Set<string>();
    const roles: OnboardingAssignableRole[] = [];
    for (const row of rows) {
        const name = (row?.name ?? '').trim();
        if (!name) continue;
        const key = name.toUpperCase();
        // The endpoint concatenates system + custom roles, so a custom role sharing a system
        // role's name would otherwise appear twice in the picker.
        if (seen.has(key)) continue;
        seen.add(key);
        roles.push({ role_key: key, label: name, is_system: !row?.instituteId });
    }
    return roles.sort((a, b) => a.label.localeCompare(b.label));
}

// ── Step field config ────────────────────────────────────────────────────────

export interface OnboardingNewFieldInput {
    field_name: string;
    field_type: string;
    default_value?: string;
    config?: string;
}

export interface OnboardingStepFieldConfig {
    id?: string;
    /** Existing institute_custom_fields.id to attach. */
    institute_custom_field_id?: string;
    /** Inline field creation — ignored if institute_custom_field_id is set. */
    new_field?: OnboardingNewFieldInput;
    field_order?: number;
    is_mandatory: boolean;
    is_hidden: boolean;
    role_access?: OnboardingRoleAccess[];
}

// ── Step ───────────────────────────────────────────────────────────────────

export interface OnboardingStepDTO {
    id: string;
    flow_id: string;
    step_order: number;
    step_name: string;
    step_type: OnboardingStepType;
    step_type_config?: Record<string, unknown> | null;
    is_optional: boolean;
    grants_student_role: boolean;
    sends_login_credentials: boolean;
    status: OnboardingFlowStatus | string;
    created_at?: string;
    updated_at?: string;
    // Parsed from the step's own fields_config / role_access JSON by
    // OnboardingStepDTO.fromEntity — null only when the step has none stored.
    // This is the AUTHORITY for a field's order / mandatory / hidden / role access;
    // fetchStepFields below supplies display names only.
    fields?: OnboardingStepFieldConfig[] | null;
    role_access?: OnboardingRoleAccess[] | null;
}

export interface CreateOrUpdateStepPayload {
    step_order?: number;
    step_name: string;
    step_type: OnboardingStepType;
    step_type_config?: Record<string, unknown>;
    is_optional: boolean;
    grants_student_role: boolean;
    sends_login_credentials: boolean;
    fields?: OnboardingStepFieldConfig[];
    role_access?: OnboardingRoleAccess[];
}

// ── Flow ─────────────────────────────────────────────────────────────────────

export interface OnboardingFlowDTO {
    id: string;
    institute_id: string;
    name: string;
    description: string | null;
    status: OnboardingFlowStatus;
    start_mode: OnboardingStartMode;
    created_by_user_id: string | null;
    created_at?: string;
    updated_at?: string;
    steps?: OnboardingStepDTO[] | null;
}

export interface CreateFlowPayload {
    name: string;
    description?: string;
    start_mode?: OnboardingStartMode;
}

export interface UpdateFlowPayload {
    name?: string;
    description?: string;
    status?: OnboardingFlowStatus;
    start_mode?: OnboardingStartMode;
}

// ── Instance ─────────────────────────────────────────────────────────────────

export interface OnboardingStepInstanceDTO {
    id: string;
    onboarding_instance_id: string;
    step_id: string;
    step_name: string;
    step_type: OnboardingStepType | string;
    status: OnboardingStepInstanceStatus;
    entered_at?: string | null;
    completed_at?: string | null;
    completed_by_user_id?: string | null;
    skip_reason?: string | null;
}

export interface OnboardingInstanceDTO {
    id: string;
    flow_id: string;
    institute_id: string;
    subject_user_id: string;
    /** Set once a "filled by a parent" step resolves the real student — the instance stays
     *  visible under subject_user_id's profile throughout; this is who role/credentials/
     *  enrollment actually went to. */
    resolved_subject_user_id?: string | null;
    resolved_subject_name?: string | null;
    resolved_subject_email?: string | null;
    current_step_id: string | null;
    status: OnboardingInstanceStatus;
    started_by: string | null;
    started_at?: string | null;
    completed_at?: string | null;
    step_instances?: OnboardingStepInstanceDTO[] | null;
}

// ── Query keys ───────────────────────────────────────────────────────────────

export const onboardingFlowsKey = (instituteId: string, status?: string) =>
    ['onboarding-flows', instituteId, status ?? null] as const;
export const onboardingFlowKey = (flowId: string) => ['onboarding-flow', flowId] as const;
export const onboardingStepsKey = (flowId: string) => ['onboarding-steps', flowId] as const;
export const onboardingStepFieldsKey = (instituteId: string, stepId: string) =>
    ['onboarding-step-fields', instituteId, stepId] as const;
export const onboardingSideViewKey = (subjectUserId: string, instituteId: string) =>
    ['onboarding-side-view', subjectUserId, instituteId] as const;

// ── Flow endpoints ───────────────────────────────────────────────────────────

export async function createOnboardingFlow(
    instituteId: string,
    payload: CreateFlowPayload
): Promise<OnboardingFlowDTO> {
    const { data } = await authenticatedAxiosInstance.post(ONBOARDING_FLOWS_BASE, payload, {
        params: { instituteId },
    });
    return data;
}

export async function fetchOnboardingFlows(
    instituteId: string,
    status?: OnboardingFlowStatus
): Promise<OnboardingFlowDTO[]> {
    const { data } = await authenticatedAxiosInstance.get(ONBOARDING_FLOWS_BASE, {
        params: { instituteId, status },
    });
    return Array.isArray(data) ? data : [];
}

export async function fetchOnboardingFlow(flowId: string): Promise<OnboardingFlowDTO> {
    const { data } = await authenticatedAxiosInstance.get(`${ONBOARDING_FLOWS_BASE}/${flowId}`);
    return data;
}

export async function updateOnboardingFlow(
    flowId: string,
    payload: UpdateFlowPayload
): Promise<OnboardingFlowDTO> {
    const { data } = await authenticatedAxiosInstance.put(
        `${ONBOARDING_FLOWS_BASE}/${flowId}`,
        payload
    );
    return data;
}

/** Archives the flow (soft delete). */
export async function archiveOnboardingFlow(flowId: string): Promise<void> {
    await authenticatedAxiosInstance.delete(`${ONBOARDING_FLOWS_BASE}/${flowId}`);
}

// ── Step endpoints ───────────────────────────────────────────────────────────

export async function createOnboardingStep(
    instituteId: string,
    flowId: string,
    payload: CreateOrUpdateStepPayload
): Promise<OnboardingStepDTO> {
    const { data } = await authenticatedAxiosInstance.post(
        `${ONBOARDING_FLOWS_BASE}/${flowId}/steps`,
        payload,
        { params: { instituteId } }
    );
    return data;
}

/**
 * Each step carries its own `fields`/`role_access` (parsed from its fields_config /
 * role_access JSON) — that is what the step builder must hydrate its field rows from.
 * {@link fetchStepFields} is still needed alongside it, purely to resolve each
 * `institute_custom_field_id` to a display name.
 */
export async function fetchOnboardingSteps(flowId: string): Promise<OnboardingStepDTO[]> {
    const { data } = await authenticatedAxiosInstance.get(
        `${ONBOARDING_FLOWS_BASE}/${flowId}/steps`
    );
    return Array.isArray(data) ? data : [];
}

export async function updateOnboardingStep(
    instituteId: string,
    flowId: string,
    stepId: string,
    payload: CreateOrUpdateStepPayload
): Promise<OnboardingStepDTO> {
    const { data } = await authenticatedAxiosInstance.put(
        `${ONBOARDING_FLOWS_BASE}/${flowId}/steps/${stepId}`,
        payload,
        { params: { instituteId } }
    );
    return data;
}

/** Archives the step (soft delete). */
export async function deleteOnboardingStep(flowId: string, stepId: string): Promise<void> {
    await authenticatedAxiosInstance.delete(`${ONBOARDING_FLOWS_BASE}/${flowId}/steps/${stepId}`);
}

export interface StepOrderEntry {
    step_id: string;
    order: number;
}

export async function reorderOnboardingSteps(
    flowId: string,
    steps: StepOrderEntry[]
): Promise<void> {
    await authenticatedAxiosInstance.put(`${ONBOARDING_FLOWS_BASE}/${flowId}/steps/reorder`, {
        steps,
    });
}

// ── Step field config (institute custom fields attached to a FORM step) ─────

/**
 * The InstituteCustomFieldDTO shape returned by
 * GET /common/custom-fields/feature-fields?type=ONBOARDING_STEP&typeId={stepId}
 * — the same endpoint CampaignCustomFieldsCard's AUDIENCE_FORM picker uses,
 * scoped here to type=ONBOARDING_STEP.
 *
 * The OUTER row (`InstituteCustomFieldDTO` on the backend) is
 * `@JsonNaming(SnakeCaseStrategy)`, but its nested `custom_field`
 * (`CustomFieldDTO`) has NO such annotation, so Jackson serializes it with
 * its declared camelCase field names — same quirk already documented for
 * `InstituteDefaultField.custom_field` in `services/custom-field-mappings.ts`
 * and the learner app's onboarding service. Do NOT snake_case this nested
 * object.
 *
 * NOTE (gap): this endpoint returns is_mandatory + the custom_field payload,
 * but NOT per-field role_access — that isn't independently fetchable from the
 * backend today. The step builder re-collects role_access from the admin
 * every time a step's fields are (re)saved rather than round-tripping it.
 */
export interface InstituteCustomFieldDTO {
    id: string;
    field_id: string;
    institute_id: string;
    type: string;
    type_id: string;
    group_name: string | null;
    custom_field: {
        id: string;
        fieldKey?: string;
        fieldName: string;
        fieldType: string;
        defaultValue?: string | null;
        config?: string | null;
        formOrder?: number | null;
    } | null;
    individual_order: number | null;
    group_internal_order: number | null;
    is_mandatory: boolean | null;
    status: string;
}

const ONBOARDING_STEP_FEATURE_TYPE = 'ONBOARDING_STEP';

/**
 * One FORM-step field resolved for the ADMIN role, from
 * GET .../step-instances/{id}/fields — the shape the admin's own "Complete step" FORM must
 * render from, as opposed to {@link fetchStepFields}'s catalog view:
 *  - ordered by the step builder's own `field_order` (the catalog endpoint orders by the
 *    institute-wide catalog order, so a reordered step rendered in creation order);
 *  - `is_mandatory` from the step's fields_config (the catalog row's is_mandatory is never
 *    written by this domain, so it always came back null → no required marker on the admin
 *    form, while the server still rejected the submit);
 *  - `field_type` + `config`, so a dropdown/date/checkbox/file/phone field renders as itself
 *    instead of degrading to a plain text box;
 *  - `is_hidden` fields already dropped server-side.
 * Fully snake_case (unlike InstituteCustomFieldDTO's nested camelCase `custom_field`).
 */
export interface OnboardingResolvedFieldDTO {
    institute_custom_field_id: string;
    field_name: string | null;
    /** text | dropdown | number | email | url | date | phone | textarea | checkbox | radio | file | multi_select */
    field_type: string | null;
    /** custom_fields.config JSON verbatim — dropdown/radio options, min/max, allowedFileTypes, … */
    config: string | null;
    default_value: string | null;
    field_order: number | null;
    is_mandatory: boolean | null;
    can_edit: boolean | null;
    value: string | null;
}

export const onboardingStepInstanceFieldsKey = (stepInstanceId: string) =>
    ['onboarding-step-instance-fields', stepInstanceId] as const;

/** The step's fields, resolved + ordered for the admin form — see {@link OnboardingResolvedFieldDTO}. */
export async function fetchStepInstanceFields(
    stepInstanceId: string
): Promise<OnboardingResolvedFieldDTO[]> {
    const { data } = await authenticatedAxiosInstance.get(
        `${ONBOARDING_STEP_INSTANCES_BASE}/${stepInstanceId}/fields`
    );
    return Array.isArray(data) ? data : [];
}

/** Existing fields attached to one onboarding step (edit-time hydration). */
export async function fetchStepFields(
    instituteId: string,
    stepId: string
): Promise<InstituteCustomFieldDTO[]> {
    const { data } = await authenticatedAxiosInstance.get(ONBOARDING_STEP_FEATURE_FIELDS, {
        params: { instituteId, type: ONBOARDING_STEP_FEATURE_TYPE, typeId: stepId },
    });
    return Array.isArray(data) ? data : [];
}

/** Every DEFAULT_CUSTOM_FIELD the institute has defined — the "attach existing field" picker source. */
export async function fetchInstituteCustomFieldCatalog(
    instituteId: string
): Promise<InstituteCustomFieldDTO[]> {
    const { data } = await authenticatedAxiosInstance.get(
        `${ONBOARDING_STEP_FEATURE_FIELDS.replace('/feature-fields', '')}`,
        { params: { instituteId } }
    );
    return Array.isArray(data) ? data : [];
}

// ── Instance endpoints (student side-view) ──────────────────────────────────

export async function startOnboardingInstance(
    instituteId: string,
    flowId: string,
    subjectUserId: string
): Promise<OnboardingInstanceDTO> {
    const { data } = await authenticatedAxiosInstance.post(
        ONBOARDING_INSTANCES_BASE,
        { flow_id: flowId, subject_user_id: subjectUserId },
        { params: { instituteId } }
    );
    return data;
}

export async function fetchOnboardingInstance(instanceId: string): Promise<OnboardingInstanceDTO> {
    const { data } = await authenticatedAxiosInstance.get(
        `${ONBOARDING_INSTANCES_BASE}/${instanceId}`
    );
    return data;
}

/** All onboarding instances for one subject (a subject can have instances from multiple flows). */
export async function fetchOnboardingSideView(
    subjectUserId: string,
    instituteId: string
): Promise<OnboardingInstanceDTO[]> {
    const { data } = await authenticatedAxiosInstance.get(ONBOARDING_SIDE_VIEW, {
        params: { subjectUserId, instituteId },
    });
    return Array.isArray(data) ? data : [];
}

// ── Management dashboard (every instance across every subject) ─────────────

/** One row of the onboarding management dashboard — enriched names, not just raw ids. */
export interface OnboardingInstanceSummaryDTO {
    id: string;
    flow_id: string;
    flow_name: string | null;
    subject_user_id: string;
    subject_name: string | null;
    subject_email: string | null;
    /** Set once a "filled by a parent" step resolved the real student. */
    resolved_subject_name: string | null;
    current_step_id: string | null;
    current_step_name: string | null;
    status: OnboardingInstanceStatus;
    started_by: string | null;
    started_at: string | null;
    completed_at: string | null;
}

/** MyTable / MyPagination page shape (see call-log-service.ts's CallPage for the same convention). */
export interface OnboardingDashboardPage {
    content: OnboardingInstanceSummaryDTO[];
    total_pages: number;
    page_no: number;
    page_size: number;
    total_elements: number;
    last: boolean;
}

export const onboardingDashboardKey = (
    instituteId: string,
    flowId: string | undefined,
    status: string | undefined,
    pageNo: number
) => ['onboarding-dashboard', instituteId, flowId ?? null, status ?? null, pageNo] as const;

/** Instance counts per status plus ALL, for the dashboard count cards (one grouped query). */
export async function fetchOnboardingStatusCounts(
    instituteId: string,
    flowId?: string
): Promise<Record<string, number>> {
    const { data } = await authenticatedAxiosInstance.get(
        `${ONBOARDING_INSTANCES_BASE}/dashboard/status-counts`,
        { params: { instituteId, flowId: flowId || undefined } }
    );
    return (data ?? {}) as Record<string, number>;
}

/** Every onboarding instance for the institute (optionally filtered), for the management dashboard. */
export async function fetchOnboardingDashboard(
    instituteId: string,
    opts: { flowId?: string; status?: string; pageNo?: number; pageSize?: number } = {}
): Promise<OnboardingDashboardPage> {
    const pageNo = opts.pageNo ?? 0;
    const pageSize = opts.pageSize ?? 20;
    const { data } = await authenticatedAxiosInstance.get(`${ONBOARDING_INSTANCES_BASE}/dashboard`, {
        params: {
            instituteId,
            flowId: opts.flowId || undefined,
            status: opts.status || undefined,
            pageNo,
            pageSize,
        },
    });
    // Spring Page envelope is camelCase; map into the table page shape.
    return {
        content: Array.isArray(data?.content) ? data.content : [],
        total_pages: data?.totalPages ?? 0,
        page_no: data?.number ?? pageNo,
        page_size: data?.size ?? pageSize,
        total_elements: data?.totalElements ?? 0,
        last: data?.last ?? true,
    };
}

// ── Step-instance endpoints (admin completes/skips a step) ─────────────────

export async function completeStepInstance(
    stepInstanceId: string,
    payload: Record<string, unknown>
): Promise<OnboardingStepInstanceDTO> {
    const { data } = await authenticatedAxiosInstance.post(
        `${ONBOARDING_STEP_INSTANCES_BASE}/${stepInstanceId}/complete`,
        { payload }
    );
    return data;
}

/**
 * Saves whatever fields the admin filled in WITHOUT requiring every mandatory field on the
 * step and WITHOUT completing/advancing -- e.g. recording a delivery's tracking id/vendor while
 * the step's own "did the student receive it?" field is the student's to fill in later.
 * completeStepInstance sees this saved data too, once someone actually completes.
 */
export async function saveStepInstanceProgress(
    stepInstanceId: string,
    payload: Record<string, unknown>
): Promise<OnboardingStepInstanceDTO> {
    const { data } = await authenticatedAxiosInstance.post(
        `${ONBOARDING_STEP_INSTANCES_BASE}/${stepInstanceId}/save`,
        { payload }
    );
    return data;
}

export async function skipStepInstance(
    stepInstanceId: string,
    reason: string
): Promise<OnboardingStepInstanceDTO> {
    const { data } = await authenticatedAxiosInstance.post(
        `${ONBOARDING_STEP_INSTANCES_BASE}/${stepInstanceId}/skip`,
        { reason }
    );
    return data;
}

/**
 * One field's actual submitted value for a completed FORM step instance.
 *
 * `field_type`/`config` ride along so a read-only view can render the value AS ITS TYPE: a
 * `file` field's value is the uploaded object's URL, and printing that raw leaves the viewer a
 * URL to copy-paste instead of a file to open.
 */
export interface OnboardingSubmittedFieldDTO {
    institute_custom_field_id: string;
    field_name: string | null;
    field_type: string | null;
    config: string | null;
    value: string | null;
}

/** Actual submitted answers for a step instance — not just the attached field names. */
export async function fetchSubmittedFieldValues(
    stepInstanceId: string
): Promise<OnboardingSubmittedFieldDTO[]> {
    const { data } = await authenticatedAxiosInstance.get(
        `${ONBOARDING_STEP_INSTANCES_BASE}/${stepInstanceId}/submitted-values`
    );
    return Array.isArray(data) ? data : [];
}

// ── Package session picker (for the FORM step "create student" target) ─────

export interface PackageSessionOption {
    package_session_id: string;
    label: string;
}

/** One page of package-session options for AsyncSearchableSelect, searched by course/batch name. */
export async function searchPackageSessions(
    search: string,
    page: number,
    pageSize = 20
): Promise<{ options: PackageSessionOption[]; hasMore: boolean }> {
    const instituteId = getCurrentInstituteId() || getInstituteId() || '';
    const { data } = await authenticatedAxiosInstance.post(
        COURSE_CATALOG_URL,
        {
            status: ['ACTIVE'],
            level_ids: [],
            faculty_ids: [],
            package_types: [],
            search_by_name: search.trim() || null,
            tag: [],
            created_by_user_id: null,
            min_percentage_completed: 0,
            max_percentage_completed: 100,
            sort_columns: { created_at: 'DESC' },
            type: null,
            package_ids: [],
            package_session_ids: [],
            session_ids: [],
            package_view: true,
        },
        { params: { instituteId, page, size: pageSize } }
    );
    const content = Array.isArray(data?.content) ? data.content : [];
    const options: PackageSessionOption[] = content.map(
        (s: {
            package_session_id: string;
            package_name?: string;
            level_name?: string;
            session_name?: string;
            package_session_name?: string;
        }) => {
            const parts = [s.package_name, s.level_name, s.session_name ?? s.package_session_name].filter(
                Boolean
            );
            return { package_session_id: s.package_session_id, label: parts.join(' · ') || s.package_session_id };
        }
    );
    return { options, hasMore: data?.last === false };
}

/**
 * Broad batch of package-session options for the step builder's course-POOL multi-select
 * (not paginated like the single-course search — the admin picks from a client-filtered list).
 * v1 limitation: caps at 200 courses; institutes with more won't see every course in this
 * picker. Acceptable for now since the "no pool selected" (open choice) path always covers
 * every course via the side-view's own searchable picker at completion time.
 */
export async function fetchPackageSessionPoolOptions(): Promise<PackageSessionOption[]> {
    const { options } = await searchPackageSessions('', 0, 200);
    return options;
}

// ── Per-step workflow triggers (run a workflow on step entered/completed/skipped) ──

export type OnboardingStepTriggerEvent =
    | 'ONBOARDING_STEP_ENTERED'
    | 'ONBOARDING_STEP_COMPLETED'
    | 'ONBOARDING_STEP_SKIPPED';

/** UI labels for the fixed ONBOARDING_STEP_* trigger-event set (StepWorkflowTriggersCard's event picker). */
export function buildOnboardingStepTriggerEvents(
    t: TFunction
): { key: OnboardingStepTriggerEvent; label: string }[] {
    return [
        {
            key: 'ONBOARDING_STEP_ENTERED',
            label: t('audienceManagerOnboardingService:triggerEvents.entered'),
        },
        {
            key: 'ONBOARDING_STEP_COMPLETED',
            label: t('audienceManagerOnboardingService:triggerEvents.completed'),
        },
        {
            key: 'ONBOARDING_STEP_SKIPPED',
            label: t('audienceManagerOnboardingService:triggerEvents.skipped'),
        },
    ];
}

export interface OnboardingStepTrigger {
    trigger_event_name: OnboardingStepTriggerEvent | string;
    workflow_id: string;
    workflow_name?: string;
}

export const onboardingStepTriggersKey = (stepId: string) => ['onboarding-step-triggers', stepId] as const;

export async function fetchOnboardingStepTriggers(
    flowId: string,
    stepId: string
): Promise<OnboardingStepTrigger[]> {
    const { data } = await authenticatedAxiosInstance.get(
        `${ONBOARDING_FLOWS_BASE}/${flowId}/steps/${stepId}/workflow-triggers`
    );
    return Array.isArray(data) ? data : [];
}

export async function saveOnboardingStepTriggers(
    instituteId: string,
    flowId: string,
    stepId: string,
    triggers: OnboardingStepTrigger[]
): Promise<{ created: number; removed: number }> {
    const { data } = await authenticatedAxiosInstance.post(
        `${ONBOARDING_FLOWS_BASE}/${flowId}/steps/${stepId}/workflow-triggers`,
        triggers,
        { params: { instituteId } }
    );
    return { created: data?.created ?? 0, removed: data?.removed ?? 0 };
}
