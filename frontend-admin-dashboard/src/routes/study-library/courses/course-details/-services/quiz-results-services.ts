import {
    QUIZ_RESULTS_LEARNER,
    QUIZ_RESULTS_LEARNER_ANSWERS,
    QUIZ_RESULTS_LEARNERS,
    QUIZ_RESULTS_OVERVIEW,
    QUIZ_RESULTS_QUESTIONS,
    QUIZ_RESULTS_QUIZ,
} from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import type {
    LearnerQuizAnswersResponse,
    LearnerQuizDetailResponse,
    LearnerQuizOverviewResponse,
    QuizLearnerResultsResponse,
    QuizOverviewResponse,
    QuizQuestionAnalysisResponse,
} from '../-types/quiz-results-types';

export const getQuizResultsOverview = async (batchId: string): Promise<QuizOverviewResponse> => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: QUIZ_RESULTS_OVERVIEW,
        params: { batchId },
    });
    return response.data;
};

/**
 * The tab is not a live view, so these do not poll. Results only move when a learner
 * submits, and the tab has an explicit Refresh for that; `staleTime` keeps flipping
 * between the list and a quiz free of refetches.
 */
export const quizResultsOverviewQueryOptions = (batchId: string) => ({
    queryKey: ['quiz-results-overview', batchId],
    queryFn: () => getQuizResultsOverview(batchId),
    enabled: !!batchId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
});

export const getQuizLearnerResults = async (
    batchId: string,
    slideId: string
): Promise<QuizLearnerResultsResponse> => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: QUIZ_RESULTS_QUIZ,
        params: { batchId, slideId },
    });
    return response.data;
};

export const quizLearnerResultsQueryOptions = (batchId: string, slideId: string) => ({
    queryKey: ['quiz-results-learners', batchId, slideId],
    queryFn: () => getQuizLearnerResults(batchId, slideId),
    enabled: !!batchId && !!slideId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
});

export const getQuizQuestionAnalysis = async (
    batchId: string,
    slideId: string
): Promise<QuizQuestionAnalysisResponse> => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: QUIZ_RESULTS_QUESTIONS,
        params: { batchId, slideId },
    });
    return response.data;
};

/** Only fetched once the Questions view is opened — the list view never needs it. */
export const quizQuestionAnalysisQueryOptions = (
    batchId: string,
    slideId: string,
    enabled: boolean
) => ({
    queryKey: ['quiz-results-questions', batchId, slideId],
    queryFn: () => getQuizQuestionAnalysis(batchId, slideId),
    enabled: enabled && !!batchId && !!slideId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
});

/* -------------------------------------------------------------------------- */
/* Learner-wise views                                                          */
/* -------------------------------------------------------------------------- */

export const getLearnerQuizOverview = async (
    batchId: string
): Promise<LearnerQuizOverviewResponse> => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: QUIZ_RESULTS_LEARNERS,
        params: { batchId },
    });
    return response.data;
};

export const learnerQuizOverviewQueryOptions = (batchId: string, enabled: boolean) => ({
    queryKey: ['quiz-results-learner-overview', batchId],
    queryFn: () => getLearnerQuizOverview(batchId),
    enabled: enabled && !!batchId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
});

export const getLearnerQuizDetail = async (
    batchId: string,
    userId: string
): Promise<LearnerQuizDetailResponse> => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: QUIZ_RESULTS_LEARNER,
        params: { batchId, userId },
    });
    return response.data;
};

/** Only fetched once a learner's side view is opened. */
export const learnerQuizDetailQueryOptions = (batchId: string, userId: string | null) => ({
    queryKey: ['quiz-results-learner-detail', batchId, userId],
    queryFn: () => getLearnerQuizDetail(batchId, userId as string),
    enabled: !!batchId && !!userId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
});

export const getLearnerQuizAnswers = async (
    batchId: string,
    slideId: string,
    userId: string
): Promise<LearnerQuizAnswersResponse> => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: QUIZ_RESULTS_LEARNER_ANSWERS,
        params: { batchId, slideId, userId },
    });
    return response.data;
};

/** Only fetched when a quiz row inside the side view is expanded. */
export const learnerQuizAnswersQueryOptions = (
    batchId: string,
    slideId: string | null,
    userId: string | null
) => ({
    queryKey: ['quiz-results-learner-answers', batchId, slideId, userId],
    queryFn: () => getLearnerQuizAnswers(batchId, slideId as string, userId as string),
    enabled: !!batchId && !!slideId && !!userId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
});
