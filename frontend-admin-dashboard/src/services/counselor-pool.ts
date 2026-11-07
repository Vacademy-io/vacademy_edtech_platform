/**
 * API client + React Query hooks for the counselor pool feature.
 * Wraps the 12 endpoints exposed by CounselorPoolController.
 *
 * Pool data model (mirrors backend DTOs):
 *   CounselorPool ──< PoolAudience    (one campaign per pool)
 *                  ──< PoolMember     (per-(audience, counselor) config)
 *                  ──< PoolShift      (only used when mode = TIME_BASED)
 *                        ──< PoolShiftMember
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import {
    COUNSELOR_POOL_AUDIENCE,
    COUNSELOR_POOL_AUDIENCE_ASSIGNMENT,
    COUNSELOR_POOL_AUDIENCES,
    COUNSELOR_POOL_AUDIENCE_ORDER,
    COUNSELOR_POOL_BASE,
    COUNSELOR_POOL_BY_AUDIENCE,
    COUNSELOR_POOL_BY_ID,
    COUNSELOR_POOL_COUNSELOR,
    COUNSELOR_POOL_COUNSELORS,
    COUNSELOR_POOL_COUNSELOR_MEMBERSHIPS,
    COUNSELOR_POOL_COUNSELOR_MONTHLY_TARGET,
    COUNSELOR_POOL_COUNSELOR_STATUS,
    COUNSELOR_POOL_COUNSELOR_STATUS_MULTI,
    COUNSELOR_POOL_SCHEDULE,
} from '@/constants/urls';

// ─── Types ───────────────────────────────────────────────────────────────────

export type AssignmentMode = 'MANUAL' | 'ROUND_ROBIN' | 'TIME_BASED';
export type PoolStatus = 'ACTIVE' | 'INACTIVE';
export type DayOfWeek = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';
/**
 * How the admin authored a pool's weekly schedule. Drives which editor the
 * Schedule tab renders. Routing engine ignores this — it reads flat shift rows.
 */
export type SchedulePattern = 'PER_DAY' | 'SAME_HOURS_ALL_DAYS';

export const DAYS_OF_WEEK: DayOfWeek[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

export interface PoolAudienceDTO {
    id: string;
    pool_id: string;
    audience_id: string;
    last_assigned_counselor_id?: string | null;
    last_assigned_at?: string | null;
    added_at?: string;
    /**
     * When this list hands out a counsellor. `true` (default) = the moment a lead arrives.
     * `false` = AI-first: the lead stays unowned so the AI call runs, and the pool assigns only
     * once the call outcome (or the exhausted-retries hand-off) asks for a counsellor.
     */
    assign_on_intake?: boolean;
}

export interface PoolMemberDTO {
    id: string;
    pool_id: string;
    audience_id: string;
    counselor_user_id: string;
    display_order: number;
    monthly_target?: number | null;
    status: PoolStatus;
    backup_counselor_user_id?: string | null;
    added_by?: string;
    added_at?: string;
    updated_at?: string;
}

export interface PoolShiftMemberDTO {
    id: string;
    shift_id: string;
    counselor_user_id: string;
    status: PoolStatus;
    added_at?: string;
}

export interface PoolShiftDTO {
    id: string;
    pool_id: string;
    day_of_week: DayOfWeek;
    /** Wall-clock time in institute timezone, formatted "HH:mm:ss". */
    start_time: string;
    end_time: string;
    label?: string;
    status: PoolStatus;
    created_at?: string;
    updated_at?: string;
    members?: PoolShiftMemberDTO[];
}

export interface CounselorPoolDTO {
    id: string;
    institute_id: string;
    name: string;
    description?: string;
    assignment_mode: AssignmentMode;
    /** PER_DAY | SAME_HOURS_ALL_DAYS — drives which Schedule editor renders. */
    schedule_pattern?: SchedulePattern;
    /** ROUND_ROBIN opt-in: rotate only among counsellors on shift right now. */
    shift_aware?: boolean;
    /** Rotation follows one pool-wide order; per-campaign orders are ignored. */
    unified_rotation_order?: boolean;
    created_by?: string;
    created_at?: string;
    updated_at?: string;
    audiences?: PoolAudienceDTO[];
    members?: PoolMemberDTO[];
    shifts?: PoolShiftDTO[];
}

export interface CreatePoolRequest {
    institute_id: string;
    name: string;
    description?: string;
    assignment_mode: AssignmentMode;
    /** Optional: defaults to PER_DAY on the backend. */
    schedule_pattern?: SchedulePattern;
    /** Optional ROUND_ROBIN opt-in: gate rotation to on-shift counsellors. */
    shift_aware?: boolean;
    audience_ids?: string[];
    counselor_user_ids?: string[];
}

export interface UpdatePoolRequest {
    name?: string;
    description?: string;
    assignment_mode?: AssignmentMode;
    /**
     * Changing pattern with shifts already configured is rejected backend-side.
     * Admin must clear the schedule (delete all shifts) before switching.
     */
    schedule_pattern?: SchedulePattern;
    /** ROUND_ROBIN opt-in: gate rotation to on-shift counsellors. Omit to leave unchanged. */
    shift_aware?: boolean;
    /** Rotate in one pool-wide order instead of each campaign's own. Omit to leave unchanged. */
    unified_rotation_order?: boolean;
}

export interface UpdateMemberStatusRequest {
    status: PoolStatus;
    /** Required when status = INACTIVE. */
    backup_counselor_user_id?: string | null;
    /**
     * INACTIVE only. When true, also move the counselor's currently open
     * (conversion_status = LEAD) leads — scoped to this pool's audiences —
     * over to the backup. Leads stay with the backup after reactivation
     * (no rollback, no history).
     */
    reassign_existing_leads?: boolean;
}

/**
 * One pool the counselor currently belongs to (powered by GET
 * /counselors/{id}/memberships). Backend filters to pools where status =
 * ACTIVE — pools where they're already inactive aren't returned.
 */
export interface CounselorPoolMembershipDTO {
    pool_id: string;
    pool_name: string;
    status: PoolStatus;
}

/**
 * Body for PATCH /counselors/{id}/status-multi — flips a counselor across
 * multiple pools at once. Same backup + reassign flag apply to every pool.
 * Backend wraps the whole batch in one @Transactional: any failure rolls
 * back all the pools.
 */
export interface BulkUpdateMemberStatusRequest {
    pool_ids: string[];
    status: PoolStatus;
    backup_counselor_user_id?: string | null;
    reassign_existing_leads?: boolean;
}

/**
 * One cell of the audience × counsellor matrix the admin filled in the
 * "Set monthly targets" dialog. `monthly_target` is null when admin
 * cleared the cell, otherwise a non-negative integer.
 */
export interface MonthlyTargetEntry {
    audience_id: string;
    monthly_target: number | null;
}

export interface UpdateMemberMonthlyTargetsRequest {
    targets: MonthlyTargetEntry[];
}

export interface ShiftBlockRequest {
    day_of_week: DayOfWeek;
    /** "HH:mm:ss" — wall-clock in institute timezone. */
    start_time: string;
    end_time: string;
    label?: string;
    counselor_user_ids: string[];
}

export interface WeeklyScheduleRequest {
    shifts: ShiftBlockRequest[];
}

// ─── API functions ───────────────────────────────────────────────────────────

export const fetchPools = async (): Promise<CounselorPoolDTO[]> => {
    const instituteId = getCurrentInstituteId();
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: COUNSELOR_POOL_BASE,
        params: { instituteId },
    });
    return response.data ?? [];
};

export const fetchPool = async (poolId: string): Promise<CounselorPoolDTO> => {
    const response = await authenticatedAxiosInstance.get(COUNSELOR_POOL_BY_ID(poolId));
    return response.data;
};

export const createPool = async (request: CreatePoolRequest): Promise<CounselorPoolDTO> => {
    const response = await authenticatedAxiosInstance.post(COUNSELOR_POOL_BASE, request);
    return response.data;
};

export const updatePool = async (
    poolId: string,
    request: UpdatePoolRequest
): Promise<CounselorPoolDTO> => {
    const response = await authenticatedAxiosInstance.patch(COUNSELOR_POOL_BY_ID(poolId), request);
    return response.data;
};

export const deletePool = async (poolId: string): Promise<void> => {
    await authenticatedAxiosInstance.delete(COUNSELOR_POOL_BY_ID(poolId));
};

// Atomic bulk attach — backend rolls back the whole batch if any id fails.
export const addAudiencesToPool = async (
    poolId: string,
    audienceIds: string[]
): Promise<void> => {
    await authenticatedAxiosInstance.post(COUNSELOR_POOL_AUDIENCES(poolId), {
        audience_ids: audienceIds,
    });
};

export const removeAudienceFromPool = async (poolId: string, audienceId: string): Promise<void> => {
    await authenticatedAxiosInstance.delete(COUNSELOR_POOL_AUDIENCE(poolId, audienceId));
};

export const updateAudienceAssignOnIntake = async (
    poolId: string,
    audienceId: string,
    assignOnIntake: boolean
): Promise<void> => {
    await authenticatedAxiosInstance.patch(COUNSELOR_POOL_AUDIENCE_ASSIGNMENT(poolId, audienceId), {
        assign_on_intake: assignOnIntake,
    });
};

// Atomic bulk add — backend rolls back the whole batch if any id fails.
export const addCounselorsToPool = async (
    poolId: string,
    counselorUserIds: string[]
): Promise<void> => {
    await authenticatedAxiosInstance.post(COUNSELOR_POOL_COUNSELORS(poolId), {
        counselor_user_ids: counselorUserIds,
    });
};

export const removeCounselorFromPool = async (
    poolId: string,
    counselorUserId: string
): Promise<void> => {
    await authenticatedAxiosInstance.delete(COUNSELOR_POOL_COUNSELOR(poolId, counselorUserId));
};

export const updateMemberStatus = async (
    poolId: string,
    counselorUserId: string,
    request: UpdateMemberStatusRequest
): Promise<void> => {
    await authenticatedAxiosInstance.patch(
        COUNSELOR_POOL_COUNSELOR_STATUS(poolId, counselorUserId),
        request
    );
};

export const fetchCounselorMemberships = async (
    counselorUserId: string
): Promise<CounselorPoolMembershipDTO[]> => {
    const instituteId = getCurrentInstituteId();
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: COUNSELOR_POOL_COUNSELOR_MEMBERSHIPS(counselorUserId),
        params: { instituteId },
    });
    return response.data ?? [];
};

export const bulkUpdateMemberStatus = async (
    counselorUserId: string,
    request: BulkUpdateMemberStatusRequest
): Promise<void> => {
    await authenticatedAxiosInstance.patch(
        COUNSELOR_POOL_COUNSELOR_STATUS_MULTI(counselorUserId),
        request
    );
};

/**
 * Set monthly_target per audience for one counsellor in one pool. Each entry
 * is one cell of the audience × counsellor matrix. Null clears the cell;
 * non-null must be >= 0 (backend rejects negatives).
 */
export const updateMemberMonthlyTargets = async (
    poolId: string,
    counselorUserId: string,
    request: UpdateMemberMonthlyTargetsRequest
): Promise<void> => {
    await authenticatedAxiosInstance.patch(
        COUNSELOR_POOL_COUNSELOR_MONTHLY_TARGET(poolId, counselorUserId),
        request
    );
};

/**
 * Replace the rotation order for one (pool, audience). The list must contain
 * every existing member's user_id in the desired order. Backend assigns
 * display_order = 1..N based on position.
 */
export const updateAudienceOrder = async (
    poolId: string,
    audienceId: string,
    counselorUserIds: string[]
): Promise<void> => {
    await authenticatedAxiosInstance.put(COUNSELOR_POOL_AUDIENCE_ORDER(poolId, audienceId), {
        counselor_user_ids: counselorUserIds,
    });
};

export const fetchWeeklySchedule = async (poolId: string): Promise<PoolShiftDTO[]> => {
    const response = await authenticatedAxiosInstance.get(COUNSELOR_POOL_SCHEDULE(poolId));
    return response.data ?? [];
};

export const setWeeklySchedule = async (
    poolId: string,
    request: WeeklyScheduleRequest
): Promise<PoolShiftDTO[]> => {
    const response = await authenticatedAxiosInstance.put(COUNSELOR_POOL_SCHEDULE(poolId), request);
    return response.data ?? [];
};

// ─── React Query hooks ───────────────────────────────────────────────────────

const POOL_LIST_KEY = ['counselor-pools'];
const poolDetailKey = (poolId: string) => ['counselor-pool', poolId];
const poolScheduleKey = (poolId: string) => ['counselor-pool-schedule', poolId];

export const useCounselorPools = () =>
    useQuery({
        queryKey: POOL_LIST_KEY,
        queryFn: fetchPools,
        staleTime: 30 * 1000,
    });

export const useCounselorPool = (poolId: string | undefined) =>
    useQuery({
        queryKey: poolDetailKey(poolId ?? ''),
        queryFn: () => fetchPool(poolId!),
        enabled: !!poolId,
    });

/**
 * The pool a lead list feeds, or null when it feeds none.
 *
 * A list with no pool is the normal case (only auto-assigned lists have one), so a
 * 204 is an answer, not an error — it resolves to null and the caller renders nothing.
 */
export const fetchPoolForAudience = async (
    audienceId: string
): Promise<CounselorPoolDTO | null> => {
    const res = await authenticatedAxiosInstance.get(COUNSELOR_POOL_BY_AUDIENCE(audienceId));
    return res.status === 204 || !res.data ? null : (res.data as CounselorPoolDTO);
};

export const usePoolForAudience = (audienceId: string | undefined) =>
    useQuery({
        queryKey: ['counselor-pool-for-audience', audienceId ?? ''],
        queryFn: () => fetchPoolForAudience(audienceId!),
        enabled: !!audienceId,
        staleTime: 60 * 1000,
    });

export const useWeeklySchedule = (poolId: string | undefined) =>
    useQuery({
        queryKey: poolScheduleKey(poolId ?? ''),
        queryFn: () => fetchWeeklySchedule(poolId!),
        enabled: !!poolId,
    });

/** Invalidate all caches for a pool after a mutation. */
export const useInvalidatePool = () => {
    const qc = useQueryClient();
    return (poolId?: string) => {
        qc.invalidateQueries({ queryKey: POOL_LIST_KEY });
        if (poolId) {
            qc.invalidateQueries({ queryKey: poolDetailKey(poolId) });
            qc.invalidateQueries({ queryKey: poolScheduleKey(poolId) });
        }
    };
};

export const useCreatePool = () => {
    const invalidate = useInvalidatePool();
    return useMutation({
        mutationFn: createPool,
        onSuccess: (pool) => invalidate(pool.id),
    });
};

export const useUpdatePool = (poolId: string) => {
    const invalidate = useInvalidatePool();
    return useMutation({
        mutationFn: (request: UpdatePoolRequest) => updatePool(poolId, request),
        onSuccess: () => invalidate(poolId),
    });
};

export const useDeletePool = () => {
    const invalidate = useInvalidatePool();
    return useMutation({
        mutationFn: deletePool,
        onSuccess: () => invalidate(),
    });
};

export const useAddAudiencesToPool = (poolId: string) => {
    const invalidate = useInvalidatePool();
    return useMutation({
        mutationFn: (audienceIds: string[]) => addAudiencesToPool(poolId, audienceIds),
        onSuccess: () => invalidate(poolId),
    });
};

export const useRemoveAudienceFromPool = (poolId: string) => {
    const invalidate = useInvalidatePool();
    return useMutation({
        mutationFn: (audienceId: string) => removeAudienceFromPool(poolId, audienceId),
        onSuccess: () => invalidate(poolId),
    });
};

export const useUpdateAudienceAssignOnIntake = (poolId: string) => {
    const invalidate = useInvalidatePool();
    return useMutation({
        mutationFn: ({ audienceId, assignOnIntake }: { audienceId: string; assignOnIntake: boolean }) =>
            updateAudienceAssignOnIntake(poolId, audienceId, assignOnIntake),
        onSuccess: () => invalidate(poolId),
    });
};

export const useAddCounselorsToPool = (poolId: string) => {
    const invalidate = useInvalidatePool();
    return useMutation({
        mutationFn: (counselorUserIds: string[]) => addCounselorsToPool(poolId, counselorUserIds),
        onSuccess: () => invalidate(poolId),
    });
};

export const useRemoveCounselorFromPool = (poolId: string) => {
    const invalidate = useInvalidatePool();
    return useMutation({
        mutationFn: (counselorUserId: string) => removeCounselorFromPool(poolId, counselorUserId),
        onSuccess: () => invalidate(poolId),
    });
};

export const useUpdateAudienceOrder = (poolId: string) => {
    const invalidate = useInvalidatePool();
    return useMutation({
        mutationFn: (args: { audienceId: string; counselorUserIds: string[] }) =>
            updateAudienceOrder(poolId, args.audienceId, args.counselorUserIds),
        onSuccess: () => invalidate(poolId),
    });
};

export const useUpdateMemberStatus = (poolId: string) => {
    const invalidate = useInvalidatePool();
    return useMutation({
        mutationFn: (args: { counselorUserId: string; request: UpdateMemberStatusRequest }) =>
            updateMemberStatus(poolId, args.counselorUserId, args.request),
        onSuccess: () => invalidate(poolId),
    });
};

export const useUpdateMemberMonthlyTargets = (poolId: string) => {
    const invalidate = useInvalidatePool();
    return useMutation({
        mutationFn: (args: {
            counselorUserId: string;
            request: UpdateMemberMonthlyTargetsRequest;
        }) => updateMemberMonthlyTargets(poolId, args.counselorUserId, args.request),
        onSuccess: () => invalidate(poolId),
    });
};

/**
 * Fetch a counselor's ACTIVE pool memberships. Pools where the counselor is
 * already INACTIVE are filtered out backend-side and won't appear here.
 *
 * Disabled when {@code counselorUserId} is falsy so the hook can sit in a
 * component that opens its dialog on demand without firing a wasted request.
 */
export const useCounselorMemberships = (counselorUserId: string | undefined) =>
    useQuery({
        queryKey: ['counselor-pool-memberships', counselorUserId ?? ''],
        queryFn: () => fetchCounselorMemberships(counselorUserId!),
        enabled: !!counselorUserId,
        staleTime: 30 * 1000,
    });

/**
 * Multi-pool status flip. On success, invalidates every pool the call touched
 * so member lists refresh — plus the institute-wide pool list. Both the
 * current pool view and any sibling pool detail caches are kept in sync.
 */
export const useBulkUpdateMemberStatus = () => {
    const invalidate = useInvalidatePool();
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (args: { counselorUserId: string; request: BulkUpdateMemberStatusRequest }) =>
            bulkUpdateMemberStatus(args.counselorUserId, args.request),
        onSuccess: (_data, variables) => {
            for (const poolId of variables.request.pool_ids) {
                invalidate(poolId);
            }
            qc.invalidateQueries({
                queryKey: ['counselor-pool-memberships', variables.counselorUserId],
            });
        },
    });
};

export const useSetWeeklySchedule = (poolId: string) => {
    const invalidate = useInvalidatePool();
    return useMutation({
        mutationFn: (request: WeeklyScheduleRequest) => setWeeklySchedule(poolId, request),
        onSuccess: () => invalidate(poolId),
    });
};
