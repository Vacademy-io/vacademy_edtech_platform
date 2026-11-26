/**
 * Syllabus progress.
 *
 * A course stage carries a syllabus of week blocks (e.g. Weeks 1–4 of trimester "Bija"), each
 * with numbered points. Teachers mark each learner's progress per block for their batch; the
 * learner app shows it to the learner.
 *
 * Off per institute until Settings → Syllabus progress is switched on
 * (SYLLABUS_PROGRESS_SETTING.enabled); `useSyllabusProgressGate` is the nav gate.
 */
import { useQuery } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import {
    GET_INSITITUTE_SETTINGS,
    SYLLABUS_PROGRESS_BATCH,
    SYLLABUS_PROGRESS_BATCHES,
    SYLLABUS_PROGRESS_LEARNER,
    SYLLABUS_PROGRESS_LEARNERS,
    SYLLABUS_PROGRESS_MARK,
} from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { getBackendErrorBody } from '@/lib/report-api-error';

// ── Types (snake_case, as the API sends them) ────────────────────────────────

export type SyllabusStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED';

export const SYLLABUS_STATUSES: readonly SyllabusStatus[] = [
    'NOT_STARTED',
    'IN_PROGRESS',
    'COMPLETED',
    'SKIPPED',
];

export interface SyllabusBatchSummary {
    package_session_id: string;
    course_name: string;
    level_name: string;
    batch_name: string;
    learners: number;
    blocks: number;
}

/** ALL = an admin sees every batch; ASSIGNED = a teacher sees only the batches they teach. */
export type SyllabusScope = 'ALL' | 'ASSIGNED';

export interface SyllabusBatchList {
    enabled: boolean;
    scope: SyllabusScope;
    batches: SyllabusBatchSummary[];
}

export interface SyllabusPoint {
    seq: number;
    text: string;
}

export interface SyllabusBlock {
    id: string;
    trimester: string | null;
    month_no: number | null;
    week_from: number;
    week_to: number;
    block_order: number;
    points: SyllabusPoint[];
}

export interface SyllabusLearner {
    user_id: string;
    full_name: string;
    enrollment_number: string | null;
}

export interface SyllabusProgressEntry {
    user_id: string;
    block_id: string;
    status: SyllabusStatus;
    started_on: string | null;
    completed_on: string | null;
    points_done: number[] | null;
    teacher_note: string | null;
    marked_by_name: string | null;
    updated_at: string | null;
}

export interface SyllabusBatchDetail {
    package_session_id: string;
    course_name: string;
    level_name: string;
    batch_name: string;
    blocks: SyllabusBlock[];
    learners: SyllabusLearner[];
    progress: SyllabusProgressEntry[];
}

/** A search hit: one learner and their batches that have a syllabus. */
export interface SyllabusLearnerMatch {
    user_id: string;
    full_name: string;
    username: string | null;
    enrollment_number: string | null;
    batches: {
        package_session_id: string;
        course_name: string;
        level_name: string;
        batch_name: string;
        total_blocks: number;
        completed_blocks: number;
    }[];
}

/** A week block with this learner's status in it (the learner app's shape). */
export interface SyllabusLearnerBlock extends SyllabusBlock {
    status: SyllabusStatus;
    started_on: string | null;
    completed_on: string | null;
    points_done: number[];
    teacher_note: string | null;
    marked_by_name: string | null;
    updated_at: string | null;
}

export interface SyllabusLearnerCourse {
    package_session_id: string;
    course_name: string;
    level_name: string;
    batch_name: string;
    total_blocks: number;
    completed_blocks: number;
    current_block_id: string | null;
    blocks: SyllabusLearnerBlock[];
}

export interface SyllabusLearnerDetail {
    user_id: string;
    full_name: string;
    enrollment_number: string | null;
    courses: SyllabusLearnerCourse[];
}

export interface SyllabusMarkRequest {
    package_session_id: string;
    block_ids: string[];
    user_ids: string[];
    status: SyllabusStatus;
    /** Only meaningful when exactly one block is marked. */
    points_done?: number[];
    note?: string;
}

export interface SyllabusMarkResponse {
    updated: number;
}

// ── Query keys ───────────────────────────────────────────────────────────────

export const SYLLABUS_PROGRESS_QUERY_KEY = 'syllabus-progress';
export const SYLLABUS_PROGRESS_SETTINGS_QUERY_KEY = 'syllabus-progress-settings';

export const syllabusProgressKeys = {
    all: [SYLLABUS_PROGRESS_QUERY_KEY] as const,
    batches: (instituteId: string) =>
        [SYLLABUS_PROGRESS_QUERY_KEY, 'batches', instituteId] as const,
    batch: (instituteId: string, packageSessionId: string) =>
        [SYLLABUS_PROGRESS_QUERY_KEY, 'batch', instituteId, packageSessionId] as const,
    learnerSearch: (instituteId: string, q: string) =>
        [SYLLABUS_PROGRESS_QUERY_KEY, 'learner-search', instituteId, q] as const,
    learner: (instituteId: string, userId: string) =>
        [SYLLABUS_PROGRESS_QUERY_KEY, 'learner', instituteId, userId] as const,
    settings: (scope: 'page' | 'gate') => [SYLLABUS_PROGRESS_SETTINGS_QUERY_KEY, scope] as const,
};

// ── API ──────────────────────────────────────────────────────────────────────

export const fetchSyllabusBatches = async (instituteId: string): Promise<SyllabusBatchList> => {
    const res = await authenticatedAxiosInstance.get<SyllabusBatchList>(SYLLABUS_PROGRESS_BATCHES, {
        params: { instituteId },
    });
    return {
        enabled: Boolean(res.data?.enabled),
        scope: res.data?.scope === 'ASSIGNED' ? 'ASSIGNED' : 'ALL',
        batches: res.data?.batches ?? [],
    };
};

/** Learners whose name, username or enrolment number contains `q` (2+ letters), in the caller's batches. */
export const searchSyllabusLearners = async (
    instituteId: string,
    q: string
): Promise<SyllabusLearnerMatch[]> => {
    const res = await authenticatedAxiosInstance.get<{ learners: SyllabusLearnerMatch[] }>(
        SYLLABUS_PROGRESS_LEARNERS,
        { params: { instituteId, q } }
    );
    return res.data?.learners ?? [];
};

/** One learner's progress in each of their batches (only the caller's batches for a teacher). */
export const fetchSyllabusLearner = async (
    instituteId: string,
    userId: string
): Promise<SyllabusLearnerDetail> => {
    const res = await authenticatedAxiosInstance.get<SyllabusLearnerDetail>(
        SYLLABUS_PROGRESS_LEARNER,
        { params: { instituteId, userId } }
    );
    const data = res.data;
    return {
        ...data,
        courses: (data?.courses ?? []).map((c) => ({
            ...c,
            blocks: [...(c.blocks ?? [])].sort((a, b) => a.block_order - b.block_order),
        })),
    };
};

export const fetchSyllabusBatch = async (
    instituteId: string,
    packageSessionId: string
): Promise<SyllabusBatchDetail> => {
    const res = await authenticatedAxiosInstance.get<SyllabusBatchDetail>(SYLLABUS_PROGRESS_BATCH, {
        params: { instituteId, packageSessionId },
    });
    const data = res.data;
    return {
        ...data,
        blocks: [...(data?.blocks ?? [])].sort((a, b) => a.block_order - b.block_order),
        learners: data?.learners ?? [],
        progress: data?.progress ?? [],
    };
};

export const markSyllabusProgress = async (
    instituteId: string,
    body: SyllabusMarkRequest
): Promise<SyllabusMarkResponse> => {
    const res = await authenticatedAxiosInstance.post<SyllabusMarkResponse>(
        SYLLABUS_PROGRESS_MARK,
        body,
        { params: { instituteId } }
    );
    return res.data;
};

export const useSyllabusBatches = (instituteId: string | undefined) =>
    useQuery({
        queryKey: syllabusProgressKeys.batches(instituteId ?? ''),
        queryFn: () => fetchSyllabusBatches(instituteId as string),
        enabled: Boolean(instituteId),
        staleTime: 60_000,
    });

export const useSyllabusBatch = (instituteId: string | undefined, packageSessionId: string) =>
    useQuery({
        queryKey: syllabusProgressKeys.batch(instituteId ?? '', packageSessionId),
        queryFn: () => fetchSyllabusBatch(instituteId as string, packageSessionId),
        enabled: Boolean(instituteId) && Boolean(packageSessionId),
        staleTime: 30_000,
    });

export const useSyllabusLearnerSearch = (instituteId: string | undefined, q: string) =>
    useQuery({
        queryKey: syllabusProgressKeys.learnerSearch(instituteId ?? '', q),
        queryFn: () => searchSyllabusLearners(instituteId as string, q),
        enabled: Boolean(instituteId) && q.length >= 2,
        staleTime: 30_000,
    });

export const useSyllabusLearner = (instituteId: string | undefined, userId: string) =>
    useQuery({
        queryKey: syllabusProgressKeys.learner(instituteId ?? '', userId),
        queryFn: () => fetchSyllabusLearner(instituteId as string, userId),
        enabled: Boolean(instituteId) && Boolean(userId),
        staleTime: 30_000,
    });

/** The server's sentence for a failed call (`message`, else ErrorInfo `ex`), else the fallback. */
export const syllabusErrorMessage = (error: unknown, fallback: string): string => {
    const body = getBackendErrorBody(error);
    const message = body?.message?.trim() || body?.ex?.trim();
    return message || fallback;
};

// ── Institute switch ─────────────────────────────────────────────────────────

export const SYLLABUS_PROGRESS_SETTING_KEY = 'SYLLABUS_PROGRESS_SETTING';
const SAVE_SETTING_URL = GET_INSITITUTE_SETTINGS.replace('/get', '/save-setting');

export interface SyllabusProgressSettings {
    enabled: boolean;
}

export const SYLLABUS_PROGRESS_SETTINGS_DEFAULTS: SyllabusProgressSettings = { enabled: false };

/** The stored setting_data as saved (other fields included), or null when never saved. */
const fetchRawSetting = async (instituteId: string): Promise<Record<string, unknown> | null> => {
    const res = await authenticatedAxiosInstance.get(GET_INSITITUTE_SETTINGS, {
        params: { instituteId, settingKey: SYLLABUS_PROGRESS_SETTING_KEY },
    });
    // GET returns the SettingDto ({key, name, data}); the content is at .data.
    const data = res.data?.data;
    return data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
};

/** Throws on failure: the Settings page must show an error, not a false "off". */
export const fetchSyllabusProgressSettingsStrict = async (): Promise<SyllabusProgressSettings> => {
    const instituteId = getCurrentInstituteId();
    if (!instituteId) return SYLLABUS_PROGRESS_SETTINGS_DEFAULTS;
    const data = await fetchRawSetting(instituteId);
    return { enabled: data?.enabled === true };
};

/** For the gate only: any failure reads as "off", so a broken lookup never shows the feature. */
export const fetchSyllabusProgressSettings = async (): Promise<SyllabusProgressSettings> => {
    try {
        return await fetchSyllabusProgressSettingsStrict();
    } catch {
        return SYLLABUS_PROGRESS_SETTINGS_DEFAULTS;
    }
};

/**
 * Read-before-save: re-reads the stored setting and only changes `enabled`, so fields written
 * by other screens (or a newer app version) are kept.
 */
export const saveSyllabusProgressSettings = async (
    data: SyllabusProgressSettings
): Promise<void> => {
    const instituteId = getCurrentInstituteId();
    if (!instituteId) throw new Error('No institute selected');
    const current = await fetchRawSetting(instituteId);
    await authenticatedAxiosInstance.post(
        SAVE_SETTING_URL,
        {
            setting_name: 'Syllabus progress',
            setting_data: { ...(current ?? {}), enabled: data.enabled },
        },
        { params: { instituteId, settingKey: SYLLABUS_PROGRESS_SETTING_KEY } }
    );
};

/** The nav gate: the Syllabus progress entry shows only when this says enabled. */
export const useSyllabusProgressGate = () => {
    const query = useQuery({
        queryKey: syllabusProgressKeys.settings('gate'),
        queryFn: fetchSyllabusProgressSettings,
        staleTime: 5 * 60_000,
        refetchOnWindowFocus: false,
    });
    return { enabled: Boolean(query.data?.enabled), isLoading: query.isLoading };
};
