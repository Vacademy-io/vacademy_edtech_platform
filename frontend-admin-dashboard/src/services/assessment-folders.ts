import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL } from '@/constants/urls';
import { getInstituteId } from '@/constants/helper';
import { getAssessmentSettings } from '@/services/assessment-settings';

/**
 * Assessment folders (assessment_service, /assessment/folder/v1): named groups of
 * assessments, e.g. "English", shown as a rail on the admin assessment list and as
 * folder cards in the learner app. One assessment sits in at most one folder.
 */

const FOLDER_BASE = `${BASE_URL}/assessment-service/assessment/folder/v1`;

/** Search-param value of the "not in any folder" view. */
export const UNFILED_FOLDER_ID = 'unfiled';

export interface AssessmentFolder {
    id: string;
    name: string;
    description: string | null;
    image_url: string | null;
    display_order: number;
    status: 'ACTIVE' | 'HIDDEN';
    parent_id: string | null;
    assessment_count: number;
}

export interface AssessmentFolderInput {
    name: string;
    description?: string | null;
    image_url?: string | null;
    status?: 'ACTIVE' | 'HIDDEN';
    /** Put these assessments in the folder as soon as it is created. */
    assessment_ids?: string[];
}

export interface AssessmentFolderLink {
    assessment_id: string;
    folder_id: string;
}

export const ASSESSMENT_FOLDERS_QUERY_KEY = ['ASSESSMENT_FOLDERS'] as const;
export const ASSESSMENT_FOLDER_LINKS_QUERY_KEY = ['ASSESSMENT_FOLDER_LINKS'] as const;

const instituteParams = () => ({ instituteId: getInstituteId() });

export const fetchAssessmentFolders = async (): Promise<AssessmentFolder[]> => {
    const res = await authenticatedAxiosInstance.get<AssessmentFolder[]>(`${FOLDER_BASE}/list`, {
        params: instituteParams(),
    });
    return Array.isArray(res.data) ? res.data : [];
};

export const createAssessmentFolder = async (
    input: AssessmentFolderInput
): Promise<AssessmentFolder> => {
    const res = await authenticatedAxiosInstance.post<AssessmentFolder>(
        `${FOLDER_BASE}/create`,
        input,
        { params: instituteParams() }
    );
    return res.data;
};

export const updateAssessmentFolder = async (
    folderId: string,
    input: AssessmentFolderInput
): Promise<AssessmentFolder> => {
    const res = await authenticatedAxiosInstance.put<AssessmentFolder>(
        `${FOLDER_BASE}/update`,
        input,
        { params: { ...instituteParams(), folderId } }
    );
    return res.data;
};

export const deleteAssessmentFolder = async (folderId: string): Promise<void> => {
    await authenticatedAxiosInstance.delete(`${FOLDER_BASE}/delete`, {
        params: { ...instituteParams(), folderId },
    });
};

export const reorderAssessmentFolders = async (folderIds: string[]): Promise<void> => {
    await authenticatedAxiosInstance.post(
        `${FOLDER_BASE}/reorder`,
        { folder_ids: folderIds },
        { params: instituteParams() }
    );
};

/** folderId null takes the assessments out of their folder. */
export const moveAssessmentsToFolder = async (
    folderId: string | null,
    assessmentIds: string[]
): Promise<void> => {
    await authenticatedAxiosInstance.post(
        `${FOLDER_BASE}/move-assessments`,
        { folder_id: folderId, assessment_ids: assessmentIds },
        { params: instituteParams() }
    );
};

export const fetchFolderLinks = async (
    assessmentIds: string[]
): Promise<AssessmentFolderLink[]> => {
    if (assessmentIds.length === 0) return [];
    const res = await authenticatedAxiosInstance.post<AssessmentFolderLink[]>(
        `${FOLDER_BASE}/by-assessments`,
        assessmentIds,
        { params: instituteParams() }
    );
    return Array.isArray(res.data) ? res.data : [];
};

/**
 * How students see a folder's tests: NAME = by name, A to Z (new tests take their place);
 * CUSTOM = the order an admin arranged (new tests go to the end).
 */
export type FolderTestOrderMode = 'NAME' | 'CUSTOM';

export interface FolderTestOrderItem {
    assessment_id: string;
    name: string;
    status: 'PUBLISHED' | 'DRAFT';
}

export interface FolderTestOrder {
    folder_id: string;
    mode: FolderTestOrderMode;
    /** Draft and published tests of the folder, in the order students see them. */
    assessments: FolderTestOrderItem[];
}

export const FOLDER_TEST_ORDER_QUERY_KEY = ['ASSESSMENT_FOLDER_TEST_ORDER'] as const;

export const fetchFolderTestOrder = async (folderId: string): Promise<FolderTestOrder> => {
    const res = await authenticatedAxiosInstance.get<FolderTestOrder>(`${FOLDER_BASE}/test-order`, {
        params: { ...instituteParams(), folderId },
    });
    return res.data;
};

/** CUSTOM: `assessmentIds` is the new order. NAME: back to A to Z (ids are ignored). */
export const saveFolderTestOrder = async (
    folderId: string,
    mode: FolderTestOrderMode,
    assessmentIds: string[]
): Promise<FolderTestOrder> => {
    const res = await authenticatedAxiosInstance.post<FolderTestOrder>(
        `${FOLDER_BASE}/test-order`,
        { folder_id: folderId, mode, assessment_ids: mode === 'CUSTOM' ? assessmentIds : [] },
        { params: instituteParams() }
    );
    return res.data;
};

export const useFolderTestOrder = (folderId: string | undefined) =>
    useQuery({
        queryKey: [...FOLDER_TEST_ORDER_QUERY_KEY, getInstituteId(), folderId],
        queryFn: () => fetchFolderTestOrder(folderId as string),
        enabled: Boolean(folderId),
        staleTime: 0,
    });

/** Natural A to Z, like the server: "Test 7" before "Test 10", case ignored. */
export const compareTestNames = (a: string, b: string) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/** Relative admin route of one folder — what a sidebar sub-tab points at. */
export const assessmentFolderRoute = (folderId: string) =>
    `/assessment/assessment-list?folderId=${encodeURIComponent(folderId)}`;

export const useAssessmentFolders = (enabled = true) =>
    useQuery({
        queryKey: [...ASSESSMENT_FOLDERS_QUERY_KEY, getInstituteId()],
        queryFn: fetchAssessmentFolders,
        enabled,
        staleTime: 30 * 1000,
    });

export const useAssessmentFolderLinks = (assessmentIds: string[], enabled = true) =>
    useQuery({
        queryKey: [...ASSESSMENT_FOLDER_LINKS_QUERY_KEY, assessmentIds],
        queryFn: () => fetchFolderLinks(assessmentIds),
        enabled: enabled && assessmentIds.length > 0,
        staleTime: 30 * 1000,
    });

/** Invalidates folder counts, card chips and test orders after any folder change. */
export const useInvalidateAssessmentFolders = () => {
    const queryClient = useQueryClient();
    return () =>
        Promise.all([
            queryClient.invalidateQueries({ queryKey: ASSESSMENT_FOLDERS_QUERY_KEY }),
            queryClient.invalidateQueries({ queryKey: ASSESSMENT_FOLDER_LINKS_QUERY_KEY }),
            queryClient.invalidateQueries({ queryKey: FOLDER_TEST_ORDER_QUERY_KEY }),
        ]);
};

export const useMoveAssessmentsMutation = () => {
    const invalidate = useInvalidateAssessmentFolders();
    return useMutation({
        mutationFn: ({
            folderId,
            assessmentIds,
        }: {
            folderId: string | null;
            assessmentIds: string[];
        }) => moveAssessmentsToFolder(folderId, assessmentIds),
        onSuccess: () => invalidate(),
    });
};

/**
 * Whether the institute turned folders on (Settings → Assessment Settings);
 * undefined while the setting loads.
 */
export const useAssessmentFoldersEnabled = (): boolean | undefined => {
    const { data, isError } = useQuery({
        queryKey: ['ASSESSMENT_SETTINGS_FOLDERS_FLAG', getInstituteId()],
        // Reads the 24h localStorage copy first, so refetching on every mount is
        // cheap and picks up a toggle made a moment ago in Settings.
        queryFn: () => getAssessmentSettings(),
        staleTime: 0,
    });
    if (isError) return false;
    if (!data) return undefined;
    return data.assessmentFolders?.enabled === true;
};
