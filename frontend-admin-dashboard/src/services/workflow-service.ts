import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import {
    BASE_URL,
    GET_WORKFLOW_DIAGRAM,
    LIST_WORKFLOWS_WITH_SCHEDULES,
    WHATSAPP_TEMPLATE_BASE,
    WORKFLOW_SERVICE_BASE,
} from '@/constants/urls';
import {
    Workflow,
    AutomationDiagram,
    WorkflowSchedule,
    WorkflowTrigger,
    WorkflowBuilderDTO,
    ValidationError,
    WorkflowExecutionLogDTO,
    ExecutionSummary,
    EnrollmentWorkflowRun,
    PagedUserWorkflowRuns,
    WorkflowRetryResponse,
    AiDraftRequest,
    AiDraftResponse,
} from '@/types/workflow/workflow-types';
import { queryOptions } from '@tanstack/react-query';

// New API response types
interface WorkflowWithScheduleRow {
    workflow_id: string;
    workflow_name: string;
    workflow_description: string;
    workflow_status: string;
    workflow_type: string;
    created_by_user_id: string;
    institute_id: string;
    workflow_created_at: string;
    workflow_updated_at: string;
    // schedule fields (nullable when not present)
    schedule_id: string | null;
    schedule_type: string | null;
    cron_expression: string | null;
    interval_minutes: number | null;
    day_of_month: number | null;
    timezone: string | null;
    schedule_start_date: string | null;
    schedule_end_date: string | null;
    schedule_status: string | null;
    last_run_at: string | null;
    next_run_at: string | null;
    schedule_created_at: string | null;
    schedule_updated_at: string | null;
    // trigger fields (nullable when not present)
    trigger_id: string | null;
    trigger_event_name: string | null;
    trigger_description: string | null;
    event_applied_type: string | null;
    event_id: string | null;
    trigger_status: string | null;
    trigger_created_at: string | null;
    trigger_updated_at: string | null;
}

interface WorkflowsWithSchedulesResponse {
    content: WorkflowWithScheduleRow[];
    page_number: number;
    page_size: number;
    total_elements: number;
    total_pages: number;
    last: boolean;
    first: boolean;
}

/** Workflow lifecycle statuses. A workflow only fires when it is ACTIVE. */
export const WORKFLOW_STATUSES = ['ACTIVE', 'DRAFT', 'INACTIVE'] as const;
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

export const fetchWorkflows = async (
    instituteId: string,
    statuses: readonly WorkflowStatus[] = ['ACTIVE']
): Promise<Workflow[]> => {
    // Anything not listed here is invisible to the caller — the backend filters on
    // workflow.status, so omitting DRAFT is why "Save Draft" workflows used to disappear.
    const workflowStatuses = statuses.length > 0 ? [...statuses] : [...WORKFLOW_STATUSES];
    // schedule_statuses / trigger_statuses gate the LEFT JOINs. Constraining them to ACTIVE
    // makes sense when we're only showing live workflows, but a DRAFT workflow's schedule or
    // trigger rows are usually non-ACTIVE too — keeping the filter would join them to null
    // and the card would claim "No schedule added" / "No trigger details". So drop the
    // filter (backend reads an absent list as "no constraint") whenever we ask for more
    // than just ACTIVE.
    const activeOnly = workflowStatuses.length === 1 && workflowStatuses[0] === 'ACTIVE';

    // Use new POST endpoint that returns workflows along with schedules (paginated)
    const response = await authenticatedAxiosInstance<WorkflowsWithSchedulesResponse>({
        method: 'POST',
        url: `${LIST_WORKFLOWS_WITH_SCHEDULES}`,
        params: {
            pageNo: 0,
            pageSize: 100,
        },
        data: {
            institute_id: instituteId,
            workflow_statuses: workflowStatuses,
            ...(activeOnly ? { schedule_statuses: ['ACTIVE'] } : {}),
        },
    });

    const rows = response.data?.content ?? [];

    // Group by workflow_id and aggregate schedules
    const workflowIdToWorkflow: Record<string, Workflow> = {};

    rows.forEach((row) => {
        if (!workflowIdToWorkflow[row.workflow_id]) {
            workflowIdToWorkflow[row.workflow_id] = {
                id: row.workflow_id,
                name: row.workflow_name,
                description: row.workflow_description,
                status: row.workflow_status,
                workflow_type: row.workflow_type,
                created_by_user_id: row.created_by_user_id,
                institute_id: row.institute_id,
                created_at: row.workflow_created_at,
                updated_at: row.workflow_updated_at,
                schedules: [],
            };
        }

        // If schedule details exist, push into schedules array
        const hasScheduleDetails =
            row.schedule_id !== null ||
            row.schedule_type !== null ||
            row.cron_expression !== null ||
            row.interval_minutes !== null ||
            row.day_of_month !== null ||
            row.timezone !== null;

        if (hasScheduleDetails) {
            const schedule: WorkflowSchedule = {
                schedule_id: row.schedule_id,
                schedule_type: row.schedule_type,
                cron_expression: row.cron_expression,
                interval_minutes: row.interval_minutes,
                day_of_month: row.day_of_month,
                timezone: row.timezone,
                schedule_start_date: row.schedule_start_date,
                schedule_end_date: row.schedule_end_date,
                schedule_status: row.schedule_status,
                last_run_at: row.last_run_at,
                next_run_at: row.next_run_at,
                schedule_created_at: row.schedule_created_at,
                schedule_updated_at: row.schedule_updated_at,
            };
            const wf = workflowIdToWorkflow[row.workflow_id];
            if (wf && wf.schedules) {
                wf.schedules.push(schedule);
            }
        }

        // Attach trigger details if present (for EVENT_DRIVEN / TRIGGER workflows)
        const hasTriggerDetails =
            row.trigger_id !== null ||
            row.trigger_event_name !== null ||
            row.trigger_status !== null;
        if (hasTriggerDetails) {
            const trigger: WorkflowTrigger = {
                trigger_id: row.trigger_id,
                trigger_event_name: row.trigger_event_name,
                trigger_description: row.trigger_description,
                event_applied_type: row.event_applied_type,
                event_id: row.event_id,
                trigger_status: row.trigger_status,
                trigger_created_at: row.trigger_created_at,
                trigger_updated_at: row.trigger_updated_at,
            };
            const wf2 = workflowIdToWorkflow[row.workflow_id];
            if (wf2) {
                wf2.trigger = trigger;
            }
        }
    });

    return Object.values(workflowIdToWorkflow);
};

/**
 * Shared cache-key prefix for every workflow-list query, whatever statuses it asks for.
 * Callers that save/delete a workflow invalidate on this prefix alone, so each status
 * variant must hang off it — TanStack matches query keys by prefix.
 */
export const WORKFLOWS_WITH_SCHEDULES_QUERY_KEY = 'GET_ACTIVE_WORKFLOWS_WITH_SCHEDULES';

/**
 * Workflows in the given lifecycle statuses — for management surfaces (the list page and the
 * detail page) that must be able to reach DRAFT and INACTIVE workflows, not just live ones.
 */
export const getWorkflowsByStatusQuery = (
    instituteId: string,
    statuses: readonly WorkflowStatus[]
) =>
    queryOptions({
        queryKey: [
            WORKFLOWS_WITH_SCHEDULES_QUERY_KEY,
            instituteId,
            [...statuses].sort().join(','),
        ],
        queryFn: () => fetchWorkflows(instituteId, statuses),
        staleTime: 300000, // 5 minutes
        enabled: !!instituteId,
    });

/**
 * ACTIVE workflows only — for pickers that link a workflow to an audience, batch or
 * enrollment, where offering a DRAFT would silently do nothing (a DRAFT workflow's triggers
 * are skipped by findSpecificTriggers/findGlobalTriggers, which require workflow.status='ACTIVE').
 */
export const getActiveWorkflowsQuery = (instituteId: string) =>
    getWorkflowsByStatusQuery(instituteId, ['ACTIVE']);

export const fetchWorkflowDiagram = async (workflowId: string): Promise<AutomationDiagram> => {
    const response = await authenticatedAxiosInstance<AutomationDiagram>({
        method: 'GET',
        url: `${GET_WORKFLOW_DIAGRAM}/${workflowId}/diagram`,
    });
    return response.data;
};

export const getWorkflowDiagramQuery = (workflowId: string) =>
    queryOptions({
        queryKey: ['GET_WORKFLOW_DIAGRAM', workflowId],
        queryFn: () => fetchWorkflowDiagram(workflowId),
        staleTime: 300000, // 5 minutes
        enabled: !!workflowId,
    });

// Builder API functions
export const createWorkflow = async (
    dto: WorkflowBuilderDTO,
    userId: string
): Promise<WorkflowBuilderDTO> => {
    const response = await authenticatedAxiosInstance<WorkflowBuilderDTO>({
        method: 'POST',
        url: `${WORKFLOW_SERVICE_BASE}`,
        params: { userId },
        data: dto,
    });
    return response.data;
};

/**
 * Update an existing workflow IN PLACE (reuses the same workflow id — not a clone).
 * Use this when saving edits from the visual builder; createWorkflow always inserts a new workflow.
 */
export const updateWorkflow = async (
    workflowId: string,
    dto: WorkflowBuilderDTO,
    userId: string
): Promise<WorkflowBuilderDTO> => {
    const response = await authenticatedAxiosInstance<WorkflowBuilderDTO>({
        method: 'PUT',
        url: `${WORKFLOW_SERVICE_BASE}/${workflowId}`,
        params: { userId },
        data: dto,
    });
    return response.data;
};

export const getWorkflowForEditing = async (
    workflowId: string
): Promise<WorkflowBuilderDTO> => {
    const response = await authenticatedAxiosInstance<WorkflowBuilderDTO>({
        method: 'GET',
        url: `${WORKFLOW_SERVICE_BASE}/${workflowId}/edit`,
    });
    return response.data;
};

export const deleteWorkflow = async (workflowId: string): Promise<void> => {
    await authenticatedAxiosInstance({
        method: 'DELETE',
        url: `${WORKFLOW_SERVICE_BASE}/${workflowId}`,
    });
};

export const validateWorkflow = async (
    dto: WorkflowBuilderDTO
): Promise<ValidationError[]> => {
    const response = await authenticatedAxiosInstance<ValidationError[]>({
        method: 'POST',
        url: `${WORKFLOW_SERVICE_BASE}/validate`,
        data: dto,
    });
    return response.data;
};

/**
 * AI-assisted drafting: turn a natural-language goal into a builder-shaped workflow draft
 * (see WORKFLOW_AI_ASSIST_DESIGN.md). The draft is NOT persisted — the caller loads it into
 * the builder canvas for review, then publishes via createWorkflow.
 */
export const draftWorkflowWithAi = async (
    request: AiDraftRequest,
    signal?: AbortSignal
): Promise<AiDraftResponse> => {
    const response = await authenticatedAxiosInstance<AiDraftResponse>({
        method: 'POST',
        url: `${WORKFLOW_SERVICE_BASE}/ai-draft`,
        data: request,
        // The backend does up to 3 sequential LLM calls; cap the wait so the UI can't hang forever.
        timeout: 150000,
        signal,
    });
    return response.data;
};

export const testRunWorkflow = async (
    workflowId: string,
    sampleContext?: Record<string, unknown>
): Promise<Record<string, unknown>> => {
    const response = await authenticatedAxiosInstance<Record<string, unknown>>({
        method: 'POST',
        url: `${WORKFLOW_SERVICE_BASE}/${workflowId}/test-run`,
        data: sampleContext ?? {},
    });
    return response.data;
};

/**
 * Trigger a workflow on demand in PRODUCTION mode (real emails are sent).
 * Use this to fire a scheduled workflow without waiting for its next run,
 * or to re-fire an event-driven workflow with a custom context payload.
 *
 * Unlike testRunWorkflow, this does NOT set dryRun, so SendEmail and other
 * handlers perform their real side effects.
 */
export const triggerWorkflowNow = async (
    workflowId: string,
    sampleContext?: Record<string, unknown>
): Promise<Record<string, unknown>> => {
    const response = await authenticatedAxiosInstance<Record<string, unknown>>({
        method: 'POST',
        url: `${WORKFLOW_SERVICE_BASE}/${workflowId}/trigger-now`,
        data: sampleContext ?? {},
    });
    return response.data;
};

export interface WorkflowTemplateItem {
    id: string;
    name: string;
    description: string;
    category: string;
    template_json: string;
    is_system: boolean;
}

export const fetchWorkflowTemplates = async (instituteId: string): Promise<WorkflowTemplateItem[]> => {
    const response = await authenticatedAxiosInstance<WorkflowTemplateItem[]>({
        method: 'GET',
        url: `${WORKFLOW_SERVICE_BASE}/templates`,
        params: { instituteId },
    });
    return response.data;
};

export const getWorkflowTemplatesQuery = (instituteId: string) =>
    queryOptions({
        queryKey: ['GET_WORKFLOW_TEMPLATES', instituteId],
        queryFn: () => fetchWorkflowTemplates(instituteId),
        staleTime: 600000, // 10 minutes (templates don't change often)
        enabled: !!instituteId,
    });

export const applyWorkflowTemplate = async (
    templateId: string,
    instituteId: string,
    userId: string,
    workflowName?: string
): Promise<WorkflowBuilderDTO> => {
    const response = await authenticatedAxiosInstance<WorkflowBuilderDTO>({
        method: 'POST',
        url: `${WORKFLOW_SERVICE_BASE}/templates/apply`,
        params: { templateId, instituteId, userId, workflowName },
    });
    return response.data;
};

// Execution logs
export async function fetchExecutionLogs(executionId: string): Promise<WorkflowExecutionLogDTO[]> {
    const response = await authenticatedAxiosInstance.get(
        `${BASE_URL}/admin-core-service/workflow/logs/execution/${executionId}`
    );
    return response.data;
}

export function getExecutionLogsQuery(executionId: string) {
    return queryOptions({
        queryKey: ['EXECUTION_LOGS', executionId],
        queryFn: () => fetchExecutionLogs(executionId),
        staleTime: 60_000,
        enabled: !!executionId,
    });
}

// Execution summary
export async function fetchExecutionSummary(
    workflowId: string,
    startDate?: string,
    endDate?: string
): Promise<ExecutionSummary> {
    const params = new URLSearchParams({ workflowId });
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);
    const response = await authenticatedAxiosInstance.get(
        `${BASE_URL}/admin-core-service/v1/workflow-execution/summary?${params.toString()}`
    );
    return response.data;
}

export function getExecutionSummaryQuery(workflowId: string, startDate?: string, endDate?: string) {
    return queryOptions({
        queryKey: ['EXECUTION_SUMMARY', workflowId, startDate, endDate],
        queryFn: () => fetchExecutionSummary(workflowId, startDate, endDate),
        staleTime: 60_000,
        enabled: !!workflowId,
    });
}

// Enrollment workflow runs (per-learner / per-course tick-cross checklist)
/**
 * Fetch the enrollment workflow runs (and their per-node steps) attached to a
 * learner's enrollment(s) or to a course's package sessions. Backed by
 * GET /admin-core-service/workflow/enrollment-runs.
 */
export async function fetchEnrollmentWorkflowRuns(
    instituteId: string,
    packageSessionIds: string[]
): Promise<EnrollmentWorkflowRun[]> {
    const ids = (packageSessionIds ?? []).filter(Boolean);
    if (!instituteId || ids.length === 0) return [];
    const response = await authenticatedAxiosInstance.get(
        `${BASE_URL}/admin-core-service/workflow/enrollment-runs`,
        { params: { instituteId, packageSessionIds: ids.join(',') } }
    );
    return response.data ?? [];
}

export function getEnrollmentWorkflowRunsQuery(instituteId: string, packageSessionIds: string[]) {
    const ids = (packageSessionIds ?? []).filter(Boolean);
    return queryOptions({
        queryKey: ['ENROLLMENT_WORKFLOW_RUNS', instituteId, [...ids].sort().join(',')],
        queryFn: () => fetchEnrollmentWorkflowRuns(instituteId, ids),
        staleTime: 30_000,
        enabled: !!instituteId && ids.length > 0,
    });
}

// Per-learner automation runs (learner side-view "Workflows" tab)
/**
 * The automations that ran FOR one learner/lead, newest first.
 *
 * Only runs whose subject was recorded at dispatch are returned — runs that
 * pre-date that are invisible here rather than guessed at, so the tab never
 * claims someone else's automation ran for this person.
 */
export async function fetchUserWorkflowRuns(
    userId: string,
    instituteId: string,
    pageNo = 0,
    pageSize = 20
): Promise<PagedUserWorkflowRuns> {
    const response = await authenticatedAxiosInstance.get(
        `${BASE_URL}/admin-core-service/v1/workflow-execution/user/${userId}`,
        { params: { instituteId, pageNo, pageSize } }
    );
    return response.data;
}

export function getUserWorkflowRunsQuery(
    userId: string,
    instituteId: string,
    pageNo = 0,
    pageSize = 20
) {
    return queryOptions({
        queryKey: ['USER_WORKFLOW_RUNS', userId, instituteId, pageNo, pageSize],
        queryFn: () => fetchUserWorkflowRuns(userId, instituteId, pageNo, pageSize),
        staleTime: 15_000,
        enabled: !!userId && !!instituteId,
    });
}

/**
 * Re-run a past execution with the inputs it originally started from. The backend
 * creates a NEW execution and dispatches it asynchronously, so this resolves as
 * soon as the run is queued — poll the run list to watch it finish.
 */
export async function retryWorkflowExecution(
    executionId: string,
    instituteId: string
): Promise<WorkflowRetryResponse> {
    const response = await authenticatedAxiosInstance.post(
        `${BASE_URL}/admin-core-service/v1/workflow-execution/${executionId}/retry`,
        null,
        { params: { instituteId } }
    );
    return response.data;
}

// Context schema for variable picker
export interface ContextVariableDTO {
    key: string;
    type: string;
    source_node_id: string;
    source_node_name: string;
    source_node_type: string;
    description: string;
    spel_expression: string;
}

export interface ContextSchemaRequest {
    target_node_id: string;
    upstream_nodes: Array<{
        node_id: string;
        node_name: string;
        node_type: string;
        config: Record<string, unknown>;
    }>;
}

export async function fetchContextSchema(request: ContextSchemaRequest): Promise<ContextVariableDTO[]> {
    const response = await authenticatedAxiosInstance.post(
        `${WORKFLOW_SERVICE_BASE}/context-schema`,
        request
    );
    return response.data;
}

// Catalog types
export interface CatalogItem {
    key: string;
    label: string;
    description: string;
    category: string;
    required_params: string[];
    optional_params?: string[];
    event_applied_type?: string;
}

export interface TemplateItem {
    id: string;
    name: string;
    subject?: string;
    content?: string;
    dynamic_parameters?: string; // JSON string
    status: string;
    type: string;
}

// Catalog fetch functions
export async function fetchQueryKeys(): Promise<CatalogItem[]> {
    const response = await authenticatedAxiosInstance.get(
        `${WORKFLOW_SERVICE_BASE}/catalog/query-keys`
    );
    return response.data;
}

export function getQueryKeysQuery() {
    return queryOptions({
        queryKey: ['WORKFLOW_CATALOG_QUERY_KEYS'],
        queryFn: fetchQueryKeys,
        staleTime: 600_000,
    });
}

export async function fetchTriggerEventsCatalog(): Promise<CatalogItem[]> {
    const response = await authenticatedAxiosInstance.get(
        `${WORKFLOW_SERVICE_BASE}/catalog/trigger-events`
    );
    return response.data;
}

export function getTriggerEventsCatalogQuery() {
    return queryOptions({
        queryKey: ['WORKFLOW_CATALOG_TRIGGER_EVENTS'],
        queryFn: fetchTriggerEventsCatalog,
        staleTime: 600_000,
    });
}

/** A single context variable available to a lead trigger event (for the template token picker). */
export interface TriggerContextVariable {
    key: string;
    label: string;
}

/**
 * Per-event context variables for lead triggers — powers the "Create sample template" token
 * palette. Returns a map of event name → variables. Events without lead-specific variables
 * are omitted. Backed by GET /workflow/catalog/trigger-context-variables.
 */
export async function fetchTriggerContextVariables(): Promise<Record<string, TriggerContextVariable[]>> {
    const response = await authenticatedAxiosInstance.get(
        `${WORKFLOW_SERVICE_BASE}/catalog/trigger-context-variables`
    );
    return response.data ?? {};
}

export function getTriggerContextVariablesQuery() {
    return queryOptions({
        queryKey: ['WORKFLOW_CATALOG_TRIGGER_CONTEXT_VARS'],
        queryFn: fetchTriggerContextVariables,
        staleTime: 600_000,
    });
}

export async function fetchEventAppliedTypesCatalog(): Promise<CatalogItem[]> {
    const response = await authenticatedAxiosInstance.get(
        `${WORKFLOW_SERVICE_BASE}/catalog/event-applied-types`
    );
    return response.data;
}

export function getEventAppliedTypesCatalogQuery() {
    return queryOptions({
        queryKey: ['WORKFLOW_CATALOG_EVENT_APPLIED_TYPES'],
        queryFn: fetchEventAppliedTypesCatalog,
        staleTime: 600_000,
    });
}

export async function fetchActionTypes(): Promise<CatalogItem[]> {
    const response = await authenticatedAxiosInstance.get(
        `${WORKFLOW_SERVICE_BASE}/catalog/actions`
    );
    return response.data;
}

export function getActionTypesQuery() {
    return queryOptions({
        queryKey: ['WORKFLOW_CATALOG_ACTIONS'],
        queryFn: fetchActionTypes,
        staleTime: 600_000,
    });
}

/** Row shape returned by notification-service's whatsapp-templates/list. */
type WhatsAppTemplateRow = {
    id?: string;
    name: string;
    bodyText?: string;
    status?: string;
    bodyVariableNames?: string[];
    bodySampleValues?: string[];
};

function toTemplateItem(t: WhatsAppTemplateRow): TemplateItem {
    const names = Array.isArray(t.bodyVariableNames) ? t.bodyVariableNames : [];
    const samples = Array.isArray(t.bodySampleValues) ? t.bodySampleValues : [];
    const placeholders: string[] = Array.from(
        (t.bodyText ?? '').matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)
    ).map((m) => m[1] ?? '');
    const keys = placeholders.length
        ? placeholders
        : names.length
            ? names
            : samples.map((_, i) => `${i + 1}`);
    const dynamicParams: Record<string, string> = {};
    keys.forEach((k, i) => {
        dynamicParams[k] = names[i] ?? samples[i] ?? k;
    });
    return {
        id: t.id ?? t.name,
        name: t.name,
        content: t.bodyText,
        status: t.status ?? 'APPROVED',
        type: 'WHATSAPP',
        dynamic_parameters: Object.keys(dynamicParams).length
            ? JSON.stringify(dynamicParams)
            : undefined,
    };
}

/**
 * WhatsApp templates for this institute. `approvedOnly` is right for pickers —
 * you can only send on an approved template — but wrong for message previews:
 * a template that is still in review (or was created straight in Meta and only
 * just synced) has a perfectly good body worth showing the admin.
 */
export async function fetchWhatsAppTemplates(
    instituteId: string,
    { approvedOnly }: { approvedOnly: boolean }
): Promise<TemplateItem[]> {
    const response = await authenticatedAxiosInstance.get(`${WHATSAPP_TEMPLATE_BASE}/list`, {
        params: { instituteId },
    });
    const list: WhatsAppTemplateRow[] = Array.isArray(response.data) ? response.data : [];
    const rows = approvedOnly
        ? list.filter((t) => (t.status ?? '').toUpperCase() === 'APPROVED')
        : list;
    return rows.map(toTemplateItem);
}

/**
 * Pull the institute's templates down from Meta into notification-service.
 * Templates authored directly in Meta Business Manager are otherwise unknown
 * here — messages still send by name, but nothing can render their body.
 * Returns how many templates were synced.
 */
export async function syncWhatsAppTemplatesFromMeta(instituteId: string): Promise<number> {
    const response = await authenticatedAxiosInstance.post(
        `${WHATSAPP_TEMPLATE_BASE}/sync`,
        null,
        { params: { instituteId } }
    );
    return Number(response.data?.synced ?? 0);
}

/**
 * The body placeholders a WhatsApp template actually declares, in order.
 *
 * Meta validates the parameter COUNT exactly: send six body params to a
 * template that declares none and the whole send fails with
 * `(#132000) number of localizable_params (6) does not match the expected
 * number of params (0)`. So anything auto-filling templateVars for a
 * SEND_WHATSAPP node has to intersect its guesses with this list first.
 *
 * Returns [] for a template with no body variables, which is a meaningful
 * answer ("send no params"), not a failure.
 */
export function whatsappTemplateParamKeys(template: TemplateItem | undefined): string[] {
    if (!template?.dynamic_parameters) return [];
    try {
        const parsed = JSON.parse(template.dynamic_parameters) as Record<string, string>;
        return Object.keys(parsed);
    } catch {
        return [];
    }
}

/**
 * Narrow a set of placeholder→field mappings to only the placeholders a given
 * WhatsApp template declares. Returns undefined when nothing is left, so the
 * caller can omit `templateVars` from the node config entirely.
 *
 * Placeholders the template declares but we have no mapping for are reported
 * in `unmapped` — Meta needs a value for every one of them, so the caller
 * should tell the admin to finish the mapping in the workflow builder rather
 * than guess (a wrong guess sends real, wrong text to a real person).
 */
export function restrictVarsToWhatsappTemplate(
    vars: Record<string, string> | undefined,
    paramKeys: string[]
): { templateVars?: Record<string, string>; unmapped: string[] } {
    const mapped: Record<string, string> = {};
    const unmapped: string[] = [];
    for (const key of paramKeys) {
        const value = vars?.[key];
        if (value) mapped[key] = value;
        else unmapped.push(key);
    }
    return {
        templateVars: Object.keys(mapped).length > 0 ? mapped : undefined,
        unmapped,
    };
}

/** Templates for read-only preview — includes ones still awaiting Meta approval. */
export function getWhatsAppTemplatesForPreviewQuery(instituteId: string) {
    return queryOptions({
        queryKey: ['WHATSAPP_TEMPLATES_PREVIEW', instituteId],
        queryFn: () => fetchWhatsAppTemplates(instituteId, { approvedOnly: false }),
        staleTime: 300_000,
        enabled: !!instituteId,
    });
}

export async function fetchTemplatesByType(instituteId: string, type: string): Promise<TemplateItem[]> {
    // WhatsApp templates live in notification-service (whatsapp-templates/list).
    // admin-core-service template endpoint is for legacy email/in-app templates and returns
    // [] for WhatsApp — route accordingly and adapt the DTO to the TemplateItem shape.
    // Exact-match on 'WHATSAPP' (not toUpperCase) so the parallel 'whatsapp' lowercase
    // query in node-config-panel falls through to the legacy endpoint and returns [],
    // avoiding duplicate template entries in the dropdown.
    if (type === 'WHATSAPP') {
        return fetchWhatsAppTemplates(instituteId, { approvedOnly: true });
    }
    const response = await authenticatedAxiosInstance.get(
        `${BASE_URL}/admin-core-service/institute/template/v1/institute/${instituteId}/type/${type}`
    );
    return response.data;
}

export function getTemplatesByTypeQuery(instituteId: string, type: string) {
    return queryOptions({
        queryKey: ['TEMPLATES_BY_TYPE', instituteId, type],
        queryFn: () => fetchTemplatesByType(instituteId, type),
        staleTime: 300_000,
        enabled: !!instituteId,
    });
}

// ─── Raw node-config editor (workflow detail "Configuration" tab) ───
// Loss-less view + in-place update of a workflow's node templates. Unlike the visual builder
// (GET /edit + POST, which strips routing and clones the workflow), these endpoints expose each
// node's raw config_json (routing included) and update the existing node_template row in place.

export interface WorkflowRawNode {
    mapping_id: string;
    node_template_id: string;
    node_name: string;
    node_type: string;
    status: string;
    version: number;
    /** Raw config JSON string, exactly as persisted — routing lives inside this. */
    config_json: string;
    retry_config: string | null;
    node_order: number;
    is_start_node: boolean | null;
    is_end_node: boolean | null;
}

export interface WorkflowRaw {
    id: string;
    name: string;
    description: string;
    status: string;
    workflow_type: string;
    institute_id: string;
    created_at: string | null;
    updated_at: string | null;
    nodes: WorkflowRawNode[];
}

/** Partial update — only the fields you set are applied. */
export interface NodeTemplateUpdate {
    config_json?: string;
    node_name?: string;
    node_type?: string;
    status?: string;
    retry_config?: string | null;
    is_start_node?: boolean;
    is_end_node?: boolean;
}

export const fetchWorkflowRaw = async (workflowId: string): Promise<WorkflowRaw> => {
    const response = await authenticatedAxiosInstance<WorkflowRaw>({
        method: 'GET',
        url: `${WORKFLOW_SERVICE_BASE}/${workflowId}/raw`,
    });
    return response.data;
};

export const getWorkflowRawQuery = (workflowId: string) =>
    queryOptions({
        queryKey: ['WORKFLOW_RAW', workflowId],
        queryFn: () => fetchWorkflowRaw(workflowId),
        staleTime: 0, // always fetch fresh — this is an editor surface
        enabled: !!workflowId,
    });

export const updateNodeTemplate = async (
    workflowId: string,
    nodeTemplateId: string,
    update: NodeTemplateUpdate
): Promise<WorkflowRawNode> => {
    const response = await authenticatedAxiosInstance<WorkflowRawNode>({
        method: 'PUT',
        url: `${WORKFLOW_SERVICE_BASE}/${workflowId}/node-template/${nodeTemplateId}`,
        data: update,
    });
    return response.data;
};
