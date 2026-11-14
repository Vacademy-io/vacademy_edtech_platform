import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL } from '@/constants/urls';
import { getInstituteId } from '@/constants/helper';
import { planLifecycle } from '../-utils/format';
import type {
    EngagementPlanDTO,
    PlanOverview,
    EngagementPlanRequest,
    EngagementSlotDTO,
    EngagementSlotRequest,
    EngagementTrackingDTO,
    FlashcardCardStatsDTO,
    PlanListParams,
    PlanListResult,
    PlanListStatus,
    PlanOverviewParams,
    PlanStatus,
    TrackingOptions,
} from '../-types/types';

/** Admin/teacher API for daily engagement plans. */

const ROOT = `${BASE_URL}/admin-core-service/engagement/admin/v1`;

function instituteParams() {
    return { instituteId: getInstituteId() };
}

export async function listEngagementPlans(packageSessionId?: string): Promise<EngagementPlanDTO[]> {
    const { data } = await authenticatedAxiosInstance.get<EngagementPlanDTO[]>(
        `${ROOT}/plan/list`,
        { params: { ...instituteParams(), packageSessionId } }
    );
    return Array.isArray(data) ? data : [];
}

const DEFAULT_LIST_SIZE = 20;
const MAX_LIST_SIZE = 100;

/**
 * The plans list with an optional status/lifecycle filter, title search and paging.
 *
 * Newer servers filter and page on `/plan/list` and answer with a page object; older
 * ones ignore the params and return every plan as an array. Both shapes are handled,
 * and on the array shape the same filter and paging are applied here, so callers get
 * one result type either way.
 */
export async function listPlans(params: PlanListParams = {}): Promise<PlanListResult> {
    const page = Math.max(0, params.page ?? 0);
    const size = Math.min(MAX_LIST_SIZE, Math.max(1, params.size ?? DEFAULT_LIST_SIZE));
    const q = params.q?.trim() || undefined;
    const statuses = (Array.isArray(params.status) ? params.status : [params.status]).filter(
        (s): s is PlanListStatus => Boolean(s)
    );
    const { data } = await authenticatedAxiosInstance.get<unknown>(`${ROOT}/plan/list`, {
        params: {
            ...instituteParams(),
            packageSessionId: params.packageSessionId || undefined,
            status: statuses.length > 0 ? statuses.join(',') : undefined,
            q,
            sort: params.sort,
            // Sending page and size asks a newer server for the page object.
            page,
            size,
        },
    });

    if (Array.isArray(data)) {
        const filtered = (data as EngagementPlanDTO[]).filter((plan) =>
            matchesListQuery(plan, statuses, q)
        );
        return {
            plans: filtered.slice(page * size, page * size + size),
            page,
            size,
            totalRows: filtered.length,
            totalPages: Math.max(1, Math.ceil(filtered.length / size)),
            serverFiltered: false,
        };
    }

    const body = (data ?? {}) as {
        content?: EngagementPlanDTO[];
        plans?: EngagementPlanDTO[];
        items?: EngagementPlanDTO[];
        rows?: EngagementPlanDTO[];
        page?: number;
        number?: number;
        size?: number;
        pageSize?: number;
        totalRows?: number;
        totalElements?: number;
        total?: number;
        totalPages?: number;
    };
    const plans = body.content ?? body.plans ?? body.items ?? body.rows ?? [];
    const pageSize = body.size ?? body.pageSize ?? size;
    const totalRows = body.totalRows ?? body.totalElements ?? body.total ?? plans.length;
    return {
        plans,
        page: body.page ?? body.number ?? page,
        size: pageSize,
        totalRows,
        totalPages: body.totalPages ?? Math.max(1, Math.ceil(totalRows / Math.max(1, pageSize))),
        serverFiltered: true,
    };
}

/**
 * Client-side stand-in for the server filter, used only against older servers. Their
 * list carries no dates, so a lifecycle there is derived from what the plan does carry
 * and a published plan with unknown dates matches any "live" lifecycle.
 */
function matchesListQuery(
    plan: EngagementPlanDTO,
    statuses: PlanListStatus[],
    q: string | undefined
): boolean {
    if (q && !plan.title?.toLowerCase().includes(q.toLowerCase())) return false;
    if (statuses.length === 0) return true;
    const lifecycle = planLifecycle(plan);
    return statuses.some((status) => {
        if (status === plan.status || status === lifecycle) return true;
        const live = status === 'UPCOMING' || status === 'RUNNING' || status === 'ENDED';
        return live && lifecycle === null && plan.status === 'PUBLISHED';
    });
}

export async function getEngagementPlan(planId: string): Promise<EngagementPlanDTO> {
    const { data } = await authenticatedAxiosInstance.get<EngagementPlanDTO>(
        `${ROOT}/plan/${planId}`,
        { params: instituteParams() }
    );
    return data;
}

/** Creates one plan per selected batch; the server always answers with a list. */
export async function createEngagementPlan(
    request: EngagementPlanRequest
): Promise<EngagementPlanDTO[]> {
    const { data } = await authenticatedAxiosInstance.post<EngagementPlanDTO[] | EngagementPlanDTO>(
        `${ROOT}/plan`,
        request,
        { params: instituteParams() }
    );
    return Array.isArray(data) ? data : [data];
}

export async function updateEngagementPlan(
    planId: string,
    request: Partial<EngagementPlanRequest>
): Promise<EngagementPlanDTO> {
    const { data } = await authenticatedAxiosInstance.put<EngagementPlanDTO>(
        `${ROOT}/plan/${planId}`,
        request,
        { params: instituteParams() }
    );
    return data;
}

/** Change only the plan's status (publish, unpublish, archive, unarchive). */
export async function setPlanStatus(
    planId: string,
    status: PlanStatus
): Promise<EngagementPlanDTO> {
    // The update is a partial one: fields left out (title, slots…) are untouched.
    return updateEngagementPlan(planId, { status });
}

/** Archive a plan: learners stop seeing it, and it leaves the default list. */
export async function archivePlan(planId: string): Promise<EngagementPlanDTO> {
    return setPlanStatus(planId, 'ARCHIVED');
}

export async function deleteEngagementPlan(planId: string): Promise<void> {
    await authenticatedAxiosInstance.delete(`${ROOT}/plan/${planId}`, {
        params: instituteParams(),
    });
}

export async function upsertEngagementSlot(
    planId: string,
    request: EngagementSlotRequest
): Promise<EngagementSlotDTO> {
    const { data } = await authenticatedAxiosInstance.post<EngagementSlotDTO>(
        `${ROOT}/plan/${planId}/slot`,
        request,
        { params: instituteParams() }
    );
    return data;
}

export async function deleteEngagementSlot(slotId: string): Promise<void> {
    await authenticatedAxiosInstance.delete(`${ROOT}/slot/${slotId}`, {
        params: instituteParams(),
    });
}

/**
 * Plan progress. `params` (page, size, q, needsAttention) are honoured by newer servers;
 * older ones ignore them and return every learner row.
 */
export async function getPlanOverview(
    planId: string,
    params: PlanOverviewParams = {}
): Promise<PlanOverview> {
    const { data } = await authenticatedAxiosInstance.get<PlanOverview>(
        `${ROOT}/plan/${planId}/overview`,
        {
            params: {
                ...instituteParams(),
                page: params.page,
                size: params.size,
                q: params.q?.trim() || undefined,
                needsAttention: params.needsAttention || undefined,
            },
        }
    );
    return data;
}

/**
 * Who attempted one task. `options.status` filters the rows (NOT_DONE lists enrolled
 * learners who never finished); older servers ignore it and return attempts only.
 */
export async function getItemTracking(
    itemId: string,
    page = 0,
    size = 20,
    options: TrackingOptions = {}
): Promise<EngagementTrackingDTO> {
    const { data } = await authenticatedAxiosInstance.get<EngagementTrackingDTO>(
        `${ROOT}/item/${itemId}/tracking`,
        {
            params: {
                ...instituteParams(),
                page,
                size,
                status: options.status && options.status !== 'ALL' ? options.status : undefined,
            },
        }
    );
    return data;
}

/** Per-card outcomes of a FLASHCARDS task, across every completed attempt. */
export async function getItemCardStats(itemId: string): Promise<FlashcardCardStatsDTO> {
    const { data } = await authenticatedAxiosInstance.get<FlashcardCardStatsDTO>(
        `${ROOT}/item/${itemId}/tracking/cards`,
        { params: instituteParams() }
    );
    return {
        cards: Array.isArray(data?.cards) ? data.cards : [],
        removedOutcomes: data?.removedOutcomes ?? 0,
    };
}

/**
 * Download every attempt as CSV.
 *
 * The file is built server-side so the export covers the whole result set rather
 * than the page currently on screen.
 */
export async function downloadItemTrackingCsv(itemId: string, title: string): Promise<void> {
    const response = await authenticatedAxiosInstance.get<Blob>(
        `${ROOT}/item/${itemId}/tracking/export`,
        { params: instituteParams(), responseType: 'blob' }
    );
    saveCsv(response.data, title, 'attempts');
}

/**
 * Download the whole plan as a learner × task CSV (with a BOM, so Hindi and Arabic
 * names open correctly in Excel). Built server-side over every learner.
 */
export async function exportPlanOverview(planId: string, title: string): Promise<void> {
    const response = await authenticatedAxiosInstance.get<Blob>(
        `${ROOT}/plan/${planId}/overview/export`,
        { params: instituteParams(), responseType: 'blob' }
    );
    saveCsv(response.data, title, 'progress');
}

function saveCsv(data: Blob, title: string, suffix: string): void {
    const url = window.URL.createObjectURL(new Blob([data], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    // Letters of any script stay (a Hindi or Arabic title was reduced to "-"); marks keep
    // Devanagari vowel signs attached. Edge dashes trimmed so the fallback still applies.
    const safeTitle =
        title
            .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
            .replace(/^-+|-+$/g, '')
            .toLowerCase() || 'engagement';
    link.download = `${safeTitle}-${suffix}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Revoking immediately can cancel the download in some browsers; give it a beat.
    window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
}
