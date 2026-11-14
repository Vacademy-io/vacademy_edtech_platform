import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_INSITITUTE_SETTINGS } from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { DoubtStatusKind } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-types/add-doubt-type';
import i18n from '@/i18n';

/** One configurable workflow status (mirrors the backend WorkflowStatusConfig). */
export interface WorkflowStatusConfig {
    key: string;
    label: string;
    learner_label?: string | null;
    kind: DoubtStatusKind;
    color?: string | null;
    enabled?: boolean;
    is_system?: boolean;
}

export const PENDING_STATUS_KEY = 'PENDING';
export const RESOLVED_STATUS_KEY = 'RESOLVED';

const SETTING_KEY = 'DOUBT_MANAGEMENT_SETTING';
const SAVE_URL = GET_INSITITUTE_SETTINGS.replace('/get', '/save-setting');
export const DOUBT_STATUSES_QUERY_KEY = 'DOUBT_WORKFLOW_STATUSES';

/** The two built-ins that always exist (mirrors DoubtStatusCatalog.defaults on the backend). */
export const systemStatuses = (): WorkflowStatusConfig[] => [
    {
        key: PENDING_STATUS_KEY,
        label: i18n.t('studyLibraryDoubtStatus:builtIn.pending'),
        kind: 'OPEN',
        enabled: true,
        is_system: true,
    },
    {
        key: RESOLVED_STATUS_KEY,
        label: i18n.t('studyLibraryDoubtStatus:builtIn.resolved'),
        kind: 'RESOLVED',
        enabled: true,
        is_system: true,
    },
];

const KINDS: DoubtStatusKind[] = ['OPEN', 'IN_PROGRESS', 'RESOLVED'];

/**
 * Same normalisation as the backend catalog: keys upper-cased, blanks dropped, kind defaulted,
 * PENDING first / RESOLVED last when the stored blob lacks them.
 */
export const normalizeStatuses = (stored: unknown): WorkflowStatusConfig[] => {
    const raw = Array.isArray(stored) ? (stored as Partial<WorkflowStatusConfig>[]) : [];
    const [pending, resolved] = systemStatuses() as [WorkflowStatusConfig, WorkflowStatusConfig];
    const out: WorkflowStatusConfig[] = [];
    let hasPending = false;
    let hasResolved = false;
    raw.forEach((s) => {
        const key = (s?.key ?? '').trim().toUpperCase();
        if (!key) return;
        if (key === PENDING_STATUS_KEY) hasPending = true;
        if (key === RESOLVED_STATUS_KEY) hasResolved = true;
        const kindRaw = (s.kind ?? '').toString().toUpperCase() as DoubtStatusKind;
        out.push({
            key,
            label: s.label?.trim() || key,
            learner_label: s.learner_label ?? null,
            // Built-ins have a fixed meaning; anything else keeps its stored kind (default OPEN).
            kind:
                key === PENDING_STATUS_KEY
                    ? 'OPEN'
                    : key === RESOLVED_STATUS_KEY
                      ? 'RESOLVED'
                      : KINDS.includes(kindRaw)
                        ? kindRaw
                        : 'OPEN',
            color: s.color ?? null,
            enabled: s.enabled !== false,
            is_system: key === PENDING_STATUS_KEY || key === RESOLVED_STATUS_KEY || !!s.is_system,
        });
    });
    if (!hasPending) out.unshift(pending);
    if (!hasResolved) out.push(resolved);
    return out;
};

const fetchStatuses = async (): Promise<WorkflowStatusConfig[]> => {
    const instituteId = getCurrentInstituteId();
    if (!instituteId) return systemStatuses();
    try {
        const response = await authenticatedAxiosInstance({
            method: 'GET',
            url: GET_INSITITUTE_SETTINGS,
            params: { instituteId, settingKey: SETTING_KEY },
        });
        return normalizeStatuses(response.data?.data?.statuses);
    } catch {
        return systemStatuses();
    }
};

/** The effective status key of a doubt — stored key, else derived from the coarse status. */
export const effectiveStatusKey = (doubt: {
    workflow_status?: string | null;
    status: string;
}): string =>
    doubt.workflow_status?.trim().toUpperCase() ||
    (doubt.status === 'RESOLVED' ? RESOLVED_STATUS_KEY : PENDING_STATUS_KEY);

/**
 * The institute's configurable doubt statuses (DOUBT_MANAGEMENT_SETTING.statuses) with the two
 * built-ins guaranteed. Powers the Status filter, the status picker, the board's status columns
 * and every status chip.
 */
export const useDoubtStatuses = () => {
    const query = useQuery({
        queryKey: [DOUBT_STATUSES_QUERY_KEY],
        queryFn: fetchStatuses,
        staleTime: 5 * 60 * 1000,
    });
    // Stable references: callers put these in effect/memo deps (the Status filter re-syncs the
    // store from enabledStatuses), so a fresh array per render would loop.
    const statuses = useMemo(() => query.data ?? systemStatuses(), [query.data]);
    const enabledStatuses = useMemo(() => statuses.filter((s) => s.enabled !== false), [statuses]);
    const byKey = useCallback(
        (key?: string | null): WorkflowStatusConfig | undefined =>
            key ? statuses.find((s) => s.key === key.trim().toUpperCase()) : undefined,
        [statuses]
    );
    const labelByKey = useCallback(
        (key?: string | null): string => {
            const match = byKey(key);
            if (match) return match.label;
            // A status removed from settings after use: humanise the key rather than show raw snake.
            return (key ?? '')
                .toLowerCase()
                .split(/[_\s]+/)
                .filter(Boolean)
                .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                .join(' ');
        },
        [byKey]
    );
    const kindByKey = useCallback(
        (key?: string | null): DoubtStatusKind =>
            byKey(key)?.kind ?? (key === RESOLVED_STATUS_KEY ? 'RESOLVED' : 'OPEN'),
        [byKey]
    );
    return {
        statuses,
        enabledStatuses,
        byKey,
        labelByKey,
        kindByKey,
        isLoading: query.isLoading,
        isError: query.isError,
    };
};

/** Stable UPPER_SNAKE key from a label — same rule the Settings page applies on save. */
export const statusKeyFromLabel = (label: string): string =>
    label
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'STATUS';

export interface NewDoubtStatus {
    label: string;
    kind: DoubtStatusKind;
    color?: string | null;
    learner_label?: string | null;
}

export class DuplicateStatusError extends Error {
    constructor(public readonly key: string) {
        super(`Duplicate status key ${key}`);
    }
}

/**
 * Add one custom status from wherever the admin is (board column strip, status picker) without a
 * trip to Settings. The generic save endpoint REPLACES the setting blob, so this reads the current
 * DOUBT_MANAGEMENT_SETTING, appends the status just before RESOLVED, and writes the whole blob
 * back — routing, notification and learner-query prefs travel through untouched.
 */
export const useAddDoubtStatus = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (input: NewDoubtStatus): Promise<WorkflowStatusConfig> => {
            const instituteId = getCurrentInstituteId();
            if (!instituteId) throw new Error('No institute');
            const current = await authenticatedAxiosInstance({
                method: 'GET',
                url: GET_INSITITUTE_SETTINGS,
                params: { instituteId, settingKey: SETTING_KEY },
            });
            const raw: Record<string, unknown> =
                current.data?.data && typeof current.data.data === 'object'
                    ? { ...(current.data.data as Record<string, unknown>) }
                    : {};
            const existing = normalizeStatuses(raw.statuses);
            const key = statusKeyFromLabel(input.label);
            if (existing.some((s) => s.key === key)) throw new DuplicateStatusError(key);
            const created: WorkflowStatusConfig = {
                key,
                label: input.label.trim(),
                learner_label: input.learner_label?.trim() || null,
                kind: input.kind,
                color: input.color?.trim() || null,
                enabled: true,
                is_system: false,
            };
            const resolvedIdx = existing.findIndex((s) => s.key === RESOLVED_STATUS_KEY);
            const statuses = [...existing];
            statuses.splice(resolvedIdx < 0 ? statuses.length : resolvedIdx, 0, created);
            await authenticatedAxiosInstance.post(
                SAVE_URL,
                { setting_name: 'Doubt Management Settings', setting_data: { ...raw, statuses } },
                { params: { instituteId, settingKey: SETTING_KEY } }
            );
            return created;
        },
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: [DOUBT_STATUSES_QUERY_KEY] });
        },
    });
};
