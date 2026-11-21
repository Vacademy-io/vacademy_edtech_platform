import { useQuery, type QueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { getMarkingSummary } from '@/services/submission-review/api';
import { submissionKeys } from '@/services/submission-review/query-keys';
import type { AttemptMarking } from '@/services/submission-review/types';
import { useSubmissionNavStore, type SubmissionNavSource } from '@/services/submission-review/nav-store';
import { useSubmissionsListReturnStore } from './list-return-store';

/**
 * One row's Marking/Result data. The Submissions tab seeds this cache for the whole page
 * with one A10 call (seedPageMarkings); a row the seed missed falls back to its own call.
 * `null` = unknown (the cells then show the old status chip).
 */
export const useAttemptMarking = (assessmentId: string, attemptId: string | null | undefined) =>
    useQuery<AttemptMarking | null>({
        queryKey: submissionKeys.marking(attemptId ?? ''),
        queryFn: () =>
            getMarkingSummary(assessmentId, [attemptId!]).then((r) => r.attempts?.[attemptId!] ?? null),
        enabled: !!assessmentId && !!attemptId,
        // The page's one batched call (seedPageMarkings) keeps these fresh: the list re-seeds
        // whenever it loads a page. A per-row refetch on focus / mount / after 30 s would be
        // one request per row instead of one per page (acceptance 12).
        staleTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        refetchOnMount: false,
        retry: false,
    });

/**
 * After a release that touched many rows: one batched call for the rows on screen, instead
 * of invalidating every row's cache (which refetches each visible row on its own).
 */
export const reseedVisibleMarkings = (queryClient: QueryClient, assessmentId: string): Promise<void> => {
    const ids = queryClient
        .getQueryCache()
        .findAll({ queryKey: ['SUBMISSION_MARKING'], type: 'active' })
        .map((q) => q.queryKey[1])
        .filter((id): id is string => typeof id === 'string' && id.length > 0);
    return seedPageMarkings(queryClient, assessmentId, ids);
};

/**
 * One A10 call for the page's attempts, written into each row's cache. On failure each row
 * is set to null so the table does not fire one request per row (acceptance 12).
 */
export const seedPageMarkings = async (
    queryClient: QueryClient,
    assessmentId: string,
    attemptIds: string[]
): Promise<void> => {
    const ids = Array.from(new Set(attemptIds.filter(Boolean))).slice(0, 100);
    if (!assessmentId || ids.length === 0) return;
    try {
        const res = await getMarkingSummary(assessmentId, ids);
        ids.forEach((id) => queryClient.setQueryData(submissionKeys.marking(id), res.attempts?.[id] ?? null));
    } catch (error) {
        console.error('Failed to load marking status for this page:', error);
        ids.forEach((id) => {
            if (queryClient.getQueryData(submissionKeys.marking(id)) === undefined) {
                queryClient.setQueryData(submissionKeys.marking(id), null);
            }
        });
    }
};

/**
 * Opens the Submission page, remembering the list it was opened from for Prev / Next, and
 * that Back should land on the Submissions tab's saved place (list-return-store).
 */
export const useOpenSubmission = () => {
    const navigate = useNavigate();
    const setNav = useSubmissionNavStore((s) => s.set);
    const markLeaving = useSubmissionsListReturnStore((s) => s.markLeaving);
    return (
        attemptId: string,
        opts: {
            assessmentId?: string;
            attemptIds?: string[];
            source?: SubmissionNavSource;
            search?: { q?: string; mode?: 'quick'; filter?: 'all' | 'needs_marking' | 'ai' | 'changed'; sheet?: '1' };
        } = {}
    ) => {
        if (opts.assessmentId && opts.attemptIds && opts.attemptIds.length > 0) {
            setNav(opts.assessmentId, opts.attemptIds, opts.source ?? 'list');
        }
        markLeaving();
        navigate({
            to: '/assessment/submission/$attemptId',
            params: { attemptId },
            search: opts.search ?? {},
        });
    };
};
