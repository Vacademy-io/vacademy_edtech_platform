import { useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_DOUBTS } from '@/constants/urls';
import {
    Doubt,
    PaginatedDoubtResponse,
} from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-types/get-doubts-type';
import { useGetUserBasicDetails, UserBasicDetails } from '@/services/get_user_basic_details';
import { useDoubtFilters } from '../-stores/filter-store';

/**
 * Board pages are bigger than the inbox's 10 because every doubt on the board is grouped
 * client-side (the list endpoint has no assignee filter), so one page has to cover several
 * columns' worth. Further pages load on demand from the board footer.
 */
export const BOARD_PAGE_SIZE = 50;

/**
 * Data for the doubt Kanban: the same filtered list the inbox shows, fetched in larger pages
 * and flattened, plus learner names for the cards. Shares the 'GET_DOUBTS' key prefix so the
 * existing reply / resolve / assign mutations (which invalidate that prefix) refresh the board
 * as well.
 */
export const useDoubtBoard = () => {
    const { filters } = useDoubtFilters();

    const query = useInfiniteQuery({
        queryKey: ['GET_DOUBTS', 'board', filters],
        queryFn: async ({ pageParam }) => {
            const response = await authenticatedAxiosInstance.post<PaginatedDoubtResponse>(
                `${GET_DOUBTS}?pageNo=${pageParam}&pageSize=${BOARD_PAGE_SIZE}`,
                { ...filters }
            );
            return response.data;
        },
        initialPageParam: 0,
        getNextPageParam: (lastPage) => (lastPage.last ? undefined : lastPage.page_no + 1),
        // Same gate as the inbox: an unscoped admin query returns an empty page, so wait for
        // the institute id rather than flashing an empty board.
        enabled: !!filters?.institute_id,
    });

    // Flatten and dedupe by id — a doubt that moves between pages while the user is loading
    // more (e.g. one was resolved and the sort shifted) must not render twice.
    const doubts = useMemo<Doubt[]>(() => {
        const seen = new Set<string>();
        const list: Doubt[] = [];
        (query.data?.pages ?? []).forEach((page) => {
            (page.content ?? []).forEach((doubt) => {
                if (seen.has(doubt.id)) return;
                seen.add(doubt.id);
                list.push(doubt);
            });
        });
        return list;
    }, [query.data]);

    // Guest queries have a null user_id — drop falsy ids so we never POST nulls to auth_service.
    const userIds = useMemo(
        () => [...new Set(doubts.map((d) => d.user_id).filter(Boolean))],
        [doubts]
    );
    const { data: userDetails } = useGetUserBasicDetails(userIds);
    const userDetailsRecord = useMemo<Record<string, UserBasicDetails>>(
        () =>
            (userDetails ?? []).reduce(
                (acc, curr) => {
                    acc[curr.id] = curr;
                    return acc;
                },
                {} as Record<string, UserBasicDetails>
            ),
        [userDetails]
    );

    return {
        doubts,
        totalElements: query.data?.pages[0]?.total_elements ?? 0,
        isLoading: query.isLoading,
        error: query.error,
        refetch: query.refetch,
        fetchNextPage: query.fetchNextPage,
        hasNextPage: query.hasNextPage,
        isFetchingNextPage: query.isFetchingNextPage,
        userDetailsRecord,
    };
};
