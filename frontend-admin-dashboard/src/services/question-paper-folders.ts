import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL } from '@/constants/urls';
import { getInstituteId } from '@/constants/helper';
import { getAssessmentSettings } from '@/services/assessment-settings';

/**
 * Question paper folders (assessment_service, /question-paper/folder/v1): named groups of
 * papers on the Question Banks and Papers page, e.g. "Class 10 Maths". One paper sits in at
 * most one folder. Turned on per institute in Settings → Assessment Settings.
 */

const FOLDER_BASE = `${BASE_URL}/assessment-service/question-paper/folder/v1`;

/** Search-param value of the "not in any folder" view. */
export const UNFILED_PAPER_FOLDER_ID = 'unfiled';

export interface QuestionPaperFolder {
    id: string;
    name: string;
    description: string | null;
    image_url: string | null;
    display_order: number;
    status: string;
    parent_id: string | null;
    /** Papers in the folder that the All tab lists (active or favourite). */
    paper_count: number;
}

export interface QuestionPaperFolderInput {
    name: string;
    description?: string | null;
    image_url?: string | null;
    /** Put these papers in the folder as soon as it is created. */
    question_paper_ids?: string[];
}

export interface QuestionPaperFolderLink {
    question_paper_id: string;
    folder_id: string;
}

/** Folder scope sent with the paper list (get-with-filters); empty = every paper. */
export interface PaperFolderFilter {
    folder_id?: string;
    unfiled_only?: boolean;
}

export const PAPER_FOLDERS_QUERY_KEY = ['QUESTION_PAPER_FOLDERS'] as const;
export const PAPER_FOLDER_LINKS_QUERY_KEY = ['QUESTION_PAPER_FOLDER_LINKS'] as const;

const instituteParams = () => ({ instituteId: getInstituteId() });

export const fetchPaperFolders = async (): Promise<QuestionPaperFolder[]> => {
    const res = await authenticatedAxiosInstance.get<QuestionPaperFolder[]>(`${FOLDER_BASE}/list`, {
        params: instituteParams(),
    });
    return Array.isArray(res.data) ? res.data : [];
};

export const createPaperFolder = async (
    input: QuestionPaperFolderInput
): Promise<QuestionPaperFolder> => {
    const res = await authenticatedAxiosInstance.post<QuestionPaperFolder>(
        `${FOLDER_BASE}/create`,
        input,
        { params: instituteParams() }
    );
    return res.data;
};

export const updatePaperFolder = async (
    folderId: string,
    input: QuestionPaperFolderInput
): Promise<QuestionPaperFolder> => {
    const res = await authenticatedAxiosInstance.put<QuestionPaperFolder>(
        `${FOLDER_BASE}/update`,
        input,
        { params: { ...instituteParams(), folderId } }
    );
    return res.data;
};

export const deletePaperFolder = async (folderId: string): Promise<void> => {
    await authenticatedAxiosInstance.delete(`${FOLDER_BASE}/delete`, {
        params: { ...instituteParams(), folderId },
    });
};

export const reorderPaperFolders = async (folderIds: string[]): Promise<void> => {
    await authenticatedAxiosInstance.post(
        `${FOLDER_BASE}/reorder`,
        { folder_ids: folderIds },
        { params: instituteParams() }
    );
};

/** folderId null takes the papers out of their folder. */
export const movePapersToFolder = async (
    folderId: string | null,
    questionPaperIds: string[]
): Promise<void> => {
    await authenticatedAxiosInstance.post(
        `${FOLDER_BASE}/move-papers`,
        { folder_id: folderId, question_paper_ids: questionPaperIds },
        { params: instituteParams() }
    );
};

export const fetchPaperFolderLinks = async (
    questionPaperIds: string[]
): Promise<QuestionPaperFolderLink[]> => {
    if (questionPaperIds.length === 0) return [];
    const res = await authenticatedAxiosInstance.post<QuestionPaperFolderLink[]>(
        `${FOLDER_BASE}/by-papers`,
        questionPaperIds,
        { params: instituteParams() }
    );
    return Array.isArray(res.data) ? res.data : [];
};

/** Relative admin route of one folder, for "Copy link". */
export const paperFolderRoute = (folderId: string) =>
    `/assessment/question-papers?folderId=${encodeURIComponent(folderId)}`;

export const usePaperFolders = (enabled = true) =>
    useQuery({
        queryKey: [...PAPER_FOLDERS_QUERY_KEY, getInstituteId()],
        queryFn: fetchPaperFolders,
        enabled,
        staleTime: 30 * 1000,
    });

export const usePaperFolderLinks = (questionPaperIds: string[], enabled = true) =>
    useQuery({
        queryKey: [...PAPER_FOLDER_LINKS_QUERY_KEY, questionPaperIds],
        queryFn: () => fetchPaperFolderLinks(questionPaperIds),
        enabled: enabled && questionPaperIds.length > 0,
        staleTime: 30 * 1000,
    });

/** Refreshes folder counts and card chips after any folder change. */
export const useInvalidatePaperFolders = () => {
    const queryClient = useQueryClient();
    return () =>
        Promise.all([
            queryClient.invalidateQueries({ queryKey: PAPER_FOLDERS_QUERY_KEY }),
            queryClient.invalidateQueries({ queryKey: PAPER_FOLDER_LINKS_QUERY_KEY }),
        ]);
};

export const useMovePapersMutation = () => {
    const invalidate = useInvalidatePaperFolders();
    return useMutation({
        mutationFn: ({
            folderId,
            questionPaperIds,
        }: {
            folderId: string | null;
            questionPaperIds: string[];
        }) => movePapersToFolder(folderId, questionPaperIds),
        onSuccess: () => invalidate(),
    });
};

/**
 * Whether the institute turned question paper folders on (Settings → Assessment Settings);
 * undefined while the setting loads. Off unless explicitly true, so the page stays as it
 * was for every institute that never touches the switch.
 */
export const useQuestionPaperFoldersEnabled = (): boolean | undefined => {
    const { data, isError } = useQuery({
        queryKey: ['ASSESSMENT_SETTINGS_PAPER_FOLDERS_FLAG', getInstituteId()],
        // Reads the 24h localStorage copy first, so refetching on every mount is cheap
        // and picks up a toggle made a moment ago in Settings.
        queryFn: () => getAssessmentSettings(),
        staleTime: 0,
    });
    if (isError) return false;
    if (!data) return undefined;
    return data.questionPaperFolders?.enabled === true;
};
