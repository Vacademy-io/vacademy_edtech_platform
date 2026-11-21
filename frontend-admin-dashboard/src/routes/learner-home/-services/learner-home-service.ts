/**
 * Every network call the Learner home editor makes, in one place.
 *
 * - The builder API (`/admin-core-service/v1/learner-home/admin`) goes through
 *   `authenticatedAxiosInstance`, which adds the bearer token and the clientId
 *   header the server's admin check compares with `instituteId`.
 * - The picker lists (live classes, assessments, product pages, learner tags)
 *   reuse the endpoints the rest of the admin already calls.
 * - With `VITE_LEARNER_HOME_MOCK=true` (local development only) the builder API
 *   is answered by the in-memory mock in `learner-home-mock.ts`.
 */
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL, GET_ASSESSMENT_LISTS, GET_UPCOMING_SESSIONS } from '@/constants/urls';
import { getAllTags } from '@/services/tag-management';
import { getAllProductPages } from '@/routes/manage-pages/product-pages/-services/product-pages-service';
import { getCatalogueTags } from '@/routes/manage-pages/-services/catalogue-service';
import type {
    AcksResponse,
    AnalyticsResponse,
    CreateDraftRequest,
    DraftResponse,
    Layout,
    PreviewRequest,
    PublishChecksResponse,
    PublishResponse,
    ResolvedHome,
    SaveDraftRequest,
    SaveDraftResponse,
    VersionRow,
} from '../-types/learner-home-types';
import { normalizeDraftResponse, normalizeLayout } from '../-utils/normalize';
import { createMockLearnerHomeApi } from './learner-home-mock';
import { readIssues, toLearnerHomeError } from './learner-home-errors';

export {
    LearnerHomeApiError,
    toLearnerHomeError,
    type LearnerHomeErrorCode,
} from './learner-home-errors';

const asString = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

export const LEARNER_HOME_ADMIN_BASE = `${BASE_URL}/admin-core-service/v1/learner-home/admin`;

// ─── Builder API ─────────────────────────────────────────────────────────────

export interface LearnerHomeApi {
    getDraft(instituteId: string): Promise<DraftResponse>;
    createDraft(instituteId: string, body: CreateDraftRequest): Promise<Layout>;
    createDraftFromPublished(instituteId: string): Promise<Layout>;
    saveDraft(instituteId: string, body: SaveDraftRequest): Promise<SaveDraftResponse>;
    deleteDraft(instituteId: string): Promise<void>;
    /** Dry run of the publish checks over the SAVED draft (contract deviation 2). */
    getPublishChecks(instituteId: string): Promise<PublishChecksResponse>;
    publish(instituteId: string, revision: number): Promise<PublishResponse>;
    unpublish(instituteId: string): Promise<void>;
    listVersions(instituteId: string): Promise<VersionRow[]>;
    restoreVersion(instituteId: string, version: number, force: boolean): Promise<Layout>;
    preview(instituteId: string, body: PreviewRequest): Promise<ResolvedHome>;
    getAnalytics(instituteId: string, from: string, to: string): Promise<AnalyticsResponse>;
    getAcks(
        instituteId: string,
        blockKey: string,
        page: number,
        size: number
    ): Promise<AcksResponse>;
}

async function call<T>(run: () => Promise<{ data: T }>): Promise<T> {
    try {
        const res = await run();
        return res.data;
    } catch (error) {
        throw toLearnerHomeError(error);
    }
}

const params = (instituteId: string, extra?: Record<string, unknown>) => ({
    params: { instituteId, ...extra },
});

const httpApi: LearnerHomeApi = {
    getDraft: async (instituteId) =>
        normalizeDraftResponse(
            await call(() =>
                authenticatedAxiosInstance.get<unknown>(
                    `${LEARNER_HOME_ADMIN_BASE}/draft`,
                    params(instituteId)
                )
            )
        ),
    createDraft: async (instituteId, body) =>
        normalizeLayout(
            await call(() =>
                authenticatedAxiosInstance.post<unknown>(
                    `${LEARNER_HOME_ADMIN_BASE}/draft`,
                    body,
                    params(instituteId)
                )
            )
        ),
    createDraftFromPublished: async (instituteId) =>
        normalizeLayout(
            await call(() =>
                authenticatedAxiosInstance.post<unknown>(
                    `${LEARNER_HOME_ADMIN_BASE}/draft/from-published`,
                    null,
                    params(instituteId)
                )
            )
        ),
    saveDraft: (instituteId, body) =>
        call(() =>
            authenticatedAxiosInstance.put<SaveDraftResponse>(
                `${LEARNER_HOME_ADMIN_BASE}/draft`,
                body,
                params(instituteId)
            )
        ),
    deleteDraft: async (instituteId) => {
        await call(() =>
            authenticatedAxiosInstance.delete(
                `${LEARNER_HOME_ADMIN_BASE}/draft`,
                params(instituteId)
            )
        );
    },
    getPublishChecks: async (instituteId) => {
        const data = await call(() =>
            authenticatedAxiosInstance.get<{ errors?: unknown; warnings?: unknown }>(
                `${LEARNER_HOME_ADMIN_BASE}/publish-checks`,
                params(instituteId)
            )
        );
        return {
            errors: readIssues(data?.errors, 'error'),
            warnings: readIssues(data?.warnings, 'warning'),
        };
    },
    publish: async (instituteId, revision) => {
        const data = await call(() =>
            authenticatedAxiosInstance.post<Partial<PublishResponse>>(
                `${LEARNER_HOME_ADMIN_BASE}/publish`,
                { revision },
                params(instituteId)
            )
        );
        return {
            version: typeof data?.version === 'number' ? data.version : 0,
            warnings: readIssues(data?.warnings, 'warning'),
        };
    },
    unpublish: async (instituteId) => {
        await call(() =>
            authenticatedAxiosInstance.post(
                `${LEARNER_HOME_ADMIN_BASE}/unpublish`,
                null,
                params(instituteId)
            )
        );
    },
    listVersions: async (instituteId) => {
        const data = await call(() =>
            authenticatedAxiosInstance.get<unknown>(
                `${LEARNER_HOME_ADMIN_BASE}/versions`,
                params(instituteId)
            )
        );
        const rows = Array.isArray(data)
            ? data
            : Array.isArray((data as { versions?: unknown })?.versions)
              ? (data as { versions: unknown[] }).versions
              : [];
        return rows as VersionRow[];
    },
    restoreVersion: async (instituteId, version, force) =>
        normalizeLayout(
            await call(() =>
                authenticatedAxiosInstance.post<unknown>(
                    `${LEARNER_HOME_ADMIN_BASE}/versions/${version}/restore`,
                    null,
                    params(instituteId, { force })
                )
            )
        ),
    preview: (instituteId, body) =>
        call(() =>
            authenticatedAxiosInstance.post<ResolvedHome>(
                `${LEARNER_HOME_ADMIN_BASE}/preview`,
                body,
                params(instituteId)
            )
        ),
    getAnalytics: async (instituteId, from, to) => {
        const data = await call(() =>
            authenticatedAxiosInstance.get<Partial<AnalyticsResponse>>(
                `${LEARNER_HOME_ADMIN_BASE}/analytics`,
                params(instituteId, { from, to })
            )
        );
        return { blocks: Array.isArray(data?.blocks) ? data.blocks : [] };
    },
    getAcks: async (instituteId, blockKey, page, size) => {
        const data = await call(() =>
            authenticatedAxiosInstance.get<Partial<AcksResponse>>(
                `${LEARNER_HOME_ADMIN_BASE}/acks`,
                params(instituteId, { block_key: blockKey, page, size })
            )
        );
        return {
            total: typeof data?.total === 'number' ? data.total : 0,
            rows: Array.isArray(data?.rows) ? data.rows : [],
        };
    },
};

const useMock = import.meta.env.VITE_LEARNER_HOME_MOCK === 'true';

export const learnerHomeApi: LearnerHomeApi = useMock ? createMockLearnerHomeApi() : httpApi;

// ─── Picker lists ────────────────────────────────────────────────────────────

export interface PickerOption {
    value: string;
    label: string;
    /** Second line in the picker (date, status). */
    hint?: string;
}

/** Public live classes with a coming schedule (Event source and Live class links). */
export async function fetchPublicLiveSessions(instituteId: string): Promise<PickerOption[]> {
    const res = await authenticatedAxiosInstance.get<unknown>(GET_UPCOMING_SESSIONS, {
        params: { instituteId },
    });
    const days = Array.isArray(res.data) ? res.data : [];
    const seen = new Map<string, PickerOption>();
    for (const day of days as Array<{ sessions?: unknown }>) {
        const sessions = Array.isArray(day?.sessions) ? day.sessions : [];
        for (const s of sessions as Array<Record<string, unknown>>) {
            const id = asString(s.session_id);
            const access = asString(s.access_level)?.toLowerCase();
            if (!id || access !== 'public' || seen.has(id)) continue;
            const date = asString(s.meeting_date);
            const time = asString(s.start_time);
            seen.set(id, {
                value: id,
                label: asString(s.title) ?? id,
                hint: [date, time].filter(Boolean).join(' '),
            });
        }
    }
    return [...seen.values()];
}

/** Published assessments, live and upcoming, for Assessment links. */
export async function fetchAssessmentOptions(instituteId: string): Promise<PickerOption[]> {
    const body = (flag: 'get_live_assessments' | 'get_upcoming_assessments') => ({
        name: '',
        batch_ids: [],
        subjects_ids: [],
        tag_ids: [],
        get_live_assessments: flag === 'get_live_assessments',
        get_passed_assessments: false,
        get_upcoming_assessments: flag === 'get_upcoming_assessments',
        institute_ids: [instituteId],
        assessment_statuses: ['PUBLISHED'],
        assessment_modes: [],
        access_statuses: [],
        evaluation_types: [],
        assessment_types: ['ASSESSMENT'],
    });
    const fetchOne = async (flag: 'get_live_assessments' | 'get_upcoming_assessments') => {
        const res = await authenticatedAxiosInstance.post<{ content?: unknown }>(
            GET_ASSESSMENT_LISTS,
            body(flag),
            { params: { pageNo: 0, pageSize: 100, instituteId } }
        );
        return Array.isArray(res.data?.content)
            ? (res.data.content as Array<Record<string, unknown>>)
            : [];
    };
    const [live, upcoming] = await Promise.all([
        fetchOne('get_live_assessments'),
        fetchOne('get_upcoming_assessments'),
    ]);
    const out = new Map<string, PickerOption>();
    for (const a of [...live, ...upcoming]) {
        const id = asString(a.assessment_id);
        if (id && !out.has(id)) out.set(id, { value: id, label: asString(a.name) ?? id });
    }
    return [...out.values()];
}

/** Active product pages, by code (Product page links). */
export async function fetchProductPageOptions(instituteId: string): Promise<PickerOption[]> {
    const pages = await getAllProductPages(instituteId);
    return pages
        .filter((p) => p.status === 'ACTIVE')
        .map((p) => ({ value: p.code, label: p.name || p.code }));
}

/**
 * True when the institute has a live catalogue site tagged `collections`, the
 * page the store shortcuts open (spec 6.3, decision Q15: hide them otherwise).
 */
export async function fetchHasStoreSite(instituteId: string): Promise<boolean> {
    const tags = await getCatalogueTags(instituteId);
    return tags.some((t) => t.tagName === 'collections' && t.status === 'ACTIVE');
}

/** Learner tags (`user_tags`), institute and default, active only. */
export async function fetchLearnerTagOptions(): Promise<PickerOption[]> {
    const tags = await getAllTags();
    return (tags ?? [])
        .filter((t) => t.status === 'ACTIVE')
        .map((t) => ({ value: t.id, label: t.tagName }));
}
