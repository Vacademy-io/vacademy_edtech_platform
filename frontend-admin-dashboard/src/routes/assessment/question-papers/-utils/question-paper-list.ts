import { useQuery } from '@tanstack/react-query';
import { FilterOption } from '@/types/assessments/question-paper-filter';
import { PaginatedResponse } from '@/types/assessments/question-paper-template';
import { getQuestionPaperDataWithFilters } from './question-paper-services';

export type PaperSort = 'NEWEST' | 'OLDEST' | 'NAME';
export const PAPER_SORTS: PaperSort[] = ['NEWEST', 'OLDEST', 'NAME'];

// Keys must match the SELECT aliases of the native query behind /get-with-filters.
export const PAPER_SORT_COLUMNS: Record<PaperSort, Record<string, string>> = {
    NEWEST: { createdOn: 'DESC' },
    OLDEST: { createdOn: 'ASC' },
    NAME: { title: 'ASC' },
};

/**
 * Statuses a tab asks the server for. "All" (ACTIVE) must include FAVOURITE: starring a
 * paper flips its status to FAVOURITE, and asking for ACTIVE alone made starred papers
 * vanish from All.
 */
export const statusesForTab = (tab: string): FilterOption[] =>
    tab === 'FAVOURITE'
        ? [{ id: 'FAVOURITE', name: 'FAVOURITE' }]
        : [
              { id: 'ACTIVE', name: 'ACTIVE' },
              { id: 'FAVOURITE', name: 'FAVOURITE' },
          ];

export const QUESTION_PAPER_STATS_KEY = 'GET_QUESTION_PAPER_STATS';
const RECENT_WINDOW = 50;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface QuestionPaperStats {
    total: number;
    favourites: number;
    thisWeek: number;
    lastWeek: number;
    /** thisWeek hit the sample size, so the real number may be higher. */
    thisWeekCapped: boolean;
    /** The sample covers both weeks completely, so a week-on-week delta is meaningful. */
    deltaKnown: boolean;
}

/**
 * Header figures for the Question Papers page. Two small list calls: the newest 50
 * papers (total + how many landed this week / last week) and a 1-row favourites
 * call for its total. No new endpoint needed.
 */
export const useQuestionPaperStats = (instituteId: string | undefined) =>
    useQuery({
        queryKey: [QUESTION_PAPER_STATS_KEY, instituteId],
        enabled: !!instituteId,
        staleTime: 60 * 1000,
        queryFn: async (): Promise<QuestionPaperStats> => {
            const [recent, favourites]: [PaginatedResponse, PaginatedResponse] = await Promise.all([
                getQuestionPaperDataWithFilters(0, RECENT_WINDOW, instituteId, {
                    statuses: statusesForTab('ACTIVE'),
                }),
                getQuestionPaperDataWithFilters(0, 1, instituteId, {
                    statuses: statusesForTab('FAVOURITE'),
                }),
            ]);
            const now = Date.now();
            let thisWeek = 0;
            let lastWeek = 0;
            (recent?.content ?? []).forEach((paper) => {
                const age = now - new Date(paper.created_on).getTime();
                if (age < WEEK_MS) thisWeek += 1;
                else if (age < 2 * WEEK_MS) lastWeek += 1;
            });
            const sampled = recent?.content?.length ?? 0;
            const sampleFull = sampled >= RECENT_WINDOW;
            return {
                total: recent?.total_elements ?? 0,
                favourites: favourites?.total_elements ?? 0,
                thisWeek,
                lastWeek,
                thisWeekCapped: sampleFull && thisWeek === sampled,
                deltaKnown: !sampleFull || thisWeek + lastWeek < sampled,
            };
        },
    });

const startOfDay = (date: Date) => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
};

/** Whole calendar days between `date` and today (0 = today). */
export const daysAgo = (date: Date, now = new Date()) =>
    Math.round((startOfDay(now).getTime() - startOfDay(date).getTime()) / (24 * 60 * 60 * 1000));

/** Group key for the date headers: today / yesterday / thisWeek / `YYYY-MM`. */
export const dateGroupKey = (iso: string, now = new Date()): string => {
    const date = new Date(iso);
    const days = daysAgo(date, now);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 7) return 'thisWeek';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};
