import {
    ADD_QUESTION_PAPER,
    GET_QUESTION_PAPER_BY_ID,
    GET_QUESTION_PAPER_FILTERED_DATA,
    GET_QUESTION_TAGS,
    MARK_QUESTION_PAPER_STATUS,
    UPDATE_QUESTION_PAPER,
} from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import {
    transformFilterData,
    transformQuestionPaperData,
    transformQuestionPaperDataAI,
    transformQuestionPaperEditData,
} from './helper';
import { FilterOption } from '@/types/assessments/question-paper-filter';
import type { PaperFolderFilter } from '@/services/question-paper-folders';
import {
    MyQuestionPaperFormEditInterface,
    MyQuestionPaperFormInterface,
} from '../../../../types/assessments/question-paper-form';

export const addQuestionPaper = async (
    data: MyQuestionPaperFormInterface,
    isAddingAIQuestions?: boolean
) => {
    try {
        const response = await authenticatedAxiosInstance({
            method: 'POST',
            url: `${ADD_QUESTION_PAPER}`,
            data: isAddingAIQuestions
                ? transformQuestionPaperDataAI(data as MyQuestionPaperFormInterface)
                : transformQuestionPaperData(data as MyQuestionPaperFormInterface),
        });
        return response?.data;
    } catch (error: unknown) {
        throw new Error(`${error}`);
    }
};

export const updateQuestionPaper = async (
    data: MyQuestionPaperFormInterface,
    previousQuestionPaperData: MyQuestionPaperFormEditInterface
) => {
    try {
        const response = await authenticatedAxiosInstance({
            method: 'PATCH',
            url: `${UPDATE_QUESTION_PAPER}`,
            data: transformQuestionPaperEditData(data, previousQuestionPaperData),
        });
        return response?.data;
    } catch (error: unknown) {
        throw new Error(`${error}`);
    }
};

export const markQuestionPaperStatus = async (
    status: string,
    questionPaperId: string,
    instituteId: string | undefined
) => {
    try {
        const response = await authenticatedAxiosInstance({
            method: 'POST',
            url: `${MARK_QUESTION_PAPER_STATUS}`,
            data: { status, question_paper_id: questionPaperId, institute_id: instituteId },
        });
        return response?.data;
    } catch (error: unknown) {
        throw new Error(`${error}`);
    }
};

export interface QuestionTag {
    tag_id: string;
    tag_name: string;
}

export const getQuestionTags = async (
    instituteId: string | undefined,
    search?: string
): Promise<QuestionTag[]> => {
    try {
        const response = await authenticatedAxiosInstance({
            method: 'GET',
            url: `${GET_QUESTION_TAGS}`,
            params: { instituteId, ...(search ? { search } : {}) },
        });
        return response?.data ?? [];
    } catch (error: unknown) {
        throw new Error(`${error}`);
    }
};

export const getQuestionTagsQuery = (instituteId: string | undefined) => ({
    queryKey: ['GET_QUESTION_TAGS', instituteId],
    queryFn: () => getQuestionTags(instituteId),
    staleTime: 5 * 60 * 1000,
    enabled: !!instituteId,
});

export const getQuestionPaperById = async (questionPaperId: string | undefined) => {
    try {
        const response = await authenticatedAxiosInstance({
            method: 'GET',
            url: `${GET_QUESTION_PAPER_BY_ID}`,
            params: {
                questionPaperId,
            },
        });
        return response?.data;
    } catch (error: unknown) {
        throw new Error(`${error}`);
    }
};

export const handleGetQuestionPaperById = (questionPaperId: string | undefined) => {
    return {
        queryKey: ['GET_QUESTION_PAPER_BY_ID', questionPaperId],
        queryFn: () => getQuestionPaperById(questionPaperId),
        staleTime: 60 * 60 * 1000,
    };
};

// Newest papers first. The key must match the SELECT alias of the native query
// backing /get-with-filters (`qp.created_on AS createdOn`).
export const QUESTION_PAPER_DEFAULT_SORT: Record<string, string> = { createdOn: 'DESC' };

export const getQuestionPaperDataWithFilters = async (
    pageNo: number,
    pageSize: number,
    instituteId: string | undefined,
    data: Record<string, FilterOption[]>,
    sortColumns: Record<string, string> = QUESTION_PAPER_DEFAULT_SORT,
    /** Question Papers page with folders on: one folder, or the papers in no folder. */
    folderFilter?: PaperFolderFilter
) => {
    try {
        const response = await authenticatedAxiosInstance({
            method: 'POST',
            url: `${GET_QUESTION_PAPER_FILTERED_DATA}`,
            params: {
                pageNo,
                instituteId,
                pageSize,
            },
            data: {
                ...transformFilterData(data),
                sort_columns: sortColumns,
                // Sent only when set, so every other list's request body is unchanged.
                ...(folderFilter?.folder_id ? { folder_id: folderFilter.folder_id } : {}),
                ...(folderFilter?.unfiled_only ? { unfiled_only: true } : {}),
            },
        });
        return response?.data;
    } catch (error: unknown) {
        throw new Error(`${error}`);
    }
};

export const getQuestionPaperFilteredData = (
    pageNo: number,
    pageSize: number,
    instituteId: string,
    data: Record<string, FilterOption[]>
) => {
    return {
        queryKey: ['GET_QUESTION_PAPER_FILTERED_DATA', pageNo, pageSize, instituteId, data],
        queryFn: () => getQuestionPaperDataWithFilters(pageNo, pageSize, instituteId, data),
        staleTime: Infinity, // Prevent query from becoming stale
        cacheTime: Infinity, // Keep the query in the cache indefinitely
    };
};
