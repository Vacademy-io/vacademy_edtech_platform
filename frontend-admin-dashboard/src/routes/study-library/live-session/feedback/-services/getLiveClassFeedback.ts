import { useQuery, keepPreviousData } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { LIVE_SESSION_FEEDBACK_SEARCH, LIVE_SESSION_FEEDBACK_SUBJECTS } from '@/constants/urls';
import type { TableData } from '@/components/design-system/table';
import type { LiveClassFeedbackRow, LiveClassFeedbackSearchParams } from '../-types/types';

// Spring Data Page shape returned by the backend.
interface SpringPage<T> {
    content: T[];
    totalPages: number;
    totalElements: number;
    number: number;
    size: number;
    last: boolean;
}

// One paginated POST to the feedback search endpoint.
const postFeedbackSearch = async (
    params: LiveClassFeedbackSearchParams,
    page: number,
    size: number
): Promise<SpringPage<LiveClassFeedbackRow>> => {
    const response = await authenticatedAxiosInstance.post<SpringPage<LiveClassFeedbackRow>>(
        LIVE_SESSION_FEEDBACK_SEARCH,
        {
            institute_id: params.instituteId,
            batch_ids: params.batchIds,
            subjects: params.subjects,
            start_date: params.startDate,
            end_date: params.endDate,
            search_query: params.searchQuery || null,
            rating_below: params.ratingBelow ?? null,
            page,
            size,
        }
    );
    return response.data;
};

const toTableData = (page: SpringPage<LiveClassFeedbackRow>): TableData<LiveClassFeedbackRow> => ({
    content: page.content ?? [],
    total_pages: page.totalPages ?? 0,
    page_no: page.number ?? 0,
    page_size: page.size ?? 0,
    total_elements: page.totalElements ?? 0,
    last: page.last ?? true,
});

/** Cross-session live-class feedback search, mapped to MyTable's TableData shape. */
export const useLiveClassFeedback = (params: LiveClassFeedbackSearchParams) =>
    useQuery({
        queryKey: ['live-class-feedback', params],
        queryFn: async () => toTableData(await postFeedbackSearch(params, params.page, params.size)),
        enabled: !!params.instituteId && !!params.startDate && !!params.endDate,
        placeholderData: keepPreviousData,
        staleTime: 30_000,
    });

const EXPORT_PAGE_SIZE = 500;
const MAX_EXPORT_ROWS = 20_000;

/**
 * Fetches every feedback row matching the current filter (across all pages) for
 * CSV export. Caps at {@link MAX_EXPORT_ROWS}; `truncated` flags when the filter
 * matched more than were exported.
 */
export const fetchAllLiveClassFeedback = async (
    params: LiveClassFeedbackSearchParams
): Promise<{ rows: LiveClassFeedbackRow[]; total: number; truncated: boolean }> => {
    const first = await postFeedbackSearch(params, 0, EXPORT_PAGE_SIZE);
    const rows = [...first.content];
    const total = first.totalElements ?? rows.length;

    const maxPages = Math.ceil(MAX_EXPORT_ROWS / EXPORT_PAGE_SIZE);
    const pagesToFetch = Math.min(first.totalPages ?? 1, maxPages);

    if (pagesToFetch > 1) {
        const requests = [];
        for (let p = 1; p < pagesToFetch; p++) {
            requests.push(postFeedbackSearch(params, p, EXPORT_PAGE_SIZE));
        }
        const pages = await Promise.all(requests);
        pages.forEach((pg) => rows.push(...(pg.content ?? [])));
    }

    return { rows, total, truncated: rows.length < total };
};

/**
 * Aggregate over ALL filtered feedback (every page), for the summary strip.
 * Keyed by the filters only (not page/size) so paging doesn't refetch.
 */
export const useFeedbackSummary = (params: LiveClassFeedbackSearchParams) =>
    useQuery({
        queryKey: [
            'live-class-feedback-summary',
            {
                instituteId: params.instituteId,
                batchIds: params.batchIds,
                subjects: params.subjects,
                startDate: params.startDate,
                endDate: params.endDate,
                searchQuery: params.searchQuery,
                ratingBelow: params.ratingBelow,
            },
        ],
        queryFn: () => fetchAllLiveClassFeedback(params),
        enabled: !!params.instituteId && !!params.startDate && !!params.endDate,
        staleTime: 30_000,
    });

/** Distinct live-class subjects for the subject filter, narrowed to the given batches. */
export const useFeedbackSubjects = (instituteId: string, batchIds: string[]) =>
    useQuery({
        queryKey: ['live-class-feedback-subjects', instituteId, batchIds],
        queryFn: async () => {
            const response = await authenticatedAxiosInstance.get<string[]>(
                LIVE_SESSION_FEEDBACK_SUBJECTS,
                {
                    params: { instituteId, batchIds: batchIds.length ? batchIds : undefined },
                    paramsSerializer: { indexes: null },
                }
            );
            return response.data ?? [];
        },
        enabled: !!instituteId,
        staleTime: 60_000,
    });
