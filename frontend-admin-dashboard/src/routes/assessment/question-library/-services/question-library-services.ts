import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL } from '@/constants/urls';
import type { QuestionResponse } from '@/types/assessments/question-paper-template';
import type {
    QuestionBankFilters,
    QuestionBankQuestion,
} from '@/routes/assessment/question-papers/-utils/question-bank-services';

/**
 * Question Library: the questions and papers the platform provides, in a topic tree.
 * One institute manages it (LibraryTree.can_manage); every other one reads and copies.
 * Backend: assessment_service QuestionLibraryController.
 */
const LIBRARY_BASE = `${BASE_URL}/assessment-service/question-library/v1`;

export const LIBRARY_TREE_KEY = 'QUESTION_LIBRARY_TREE';
export const LIBRARY_QUESTIONS_KEY = 'QUESTION_LIBRARY_QUESTIONS';
export const LIBRARY_PAPERS_KEY = 'QUESTION_LIBRARY_PAPERS';
export const LIBRARY_AVAILABILITY_KEY = 'QUESTION_LIBRARY_AVAILABILITY';
export const LIBRARY_TAGS_KEY = 'QUESTION_LIBRARY_SUBJECT_TAGS';

export interface LibraryNode {
    id: string;
    parent_id: string | null;
    name: string;
    description?: string | null;
    display_order: number;
    /** 1 for a top-level topic. */
    depth: number;
    /** Distinct live questions here and in every topic below. */
    question_count: number;
    easy_count: number;
    medium_count: number;
    hard_count: number;
}

export interface LibrarySummary {
    total_questions: number;
    unsorted_questions: number;
    added_last_week: number;
    topic_count: number;
    by_difficulty: Record<string, number>;
    by_type: Record<string, number>;
}

export interface LibraryTree {
    nodes: LibraryNode[];
    summary: LibrarySummary;
    max_depth: number;
    /** True for staff of the institute that owns the library. Everyone else reads and copies. */
    can_manage: boolean;
}

/** A whole question paper kept under a topic. */
export interface LibraryPaper {
    id: string;
    title: string;
    node_id: string;
    question_count: number;
}

export interface LibraryCopiedQuestion {
    source_question_id: string;
    question_id: string;
    question_type?: string | null;
    text?: string | null;
}

export interface LibraryCopyResult {
    copied: LibraryCopiedQuestion[];
    /** Skipped because the section already has a copy of them. */
    already_in_section: number;
    failed: number;
}

export interface LibraryQuestion {
    question: QuestionBankQuestion;
    node_ids: string[];
    assessment_count: number;
}

export interface LibraryQuestionPage {
    content: LibraryQuestion[];
    total_elements?: number;
    total_pages?: number;
    /** A Spring Page may name its envelope either way: see pageTotals. */
    totalElements?: number;
    totalPages?: number;
    number?: number;
}

export interface LibraryRandomPickBody {
    library_node_ids?: string[];
    question_types?: string[];
    exclude_question_ids?: string[];
    easy?: number;
    medium?: number;
    hard?: number;
}

export interface LibraryRandomPickResult {
    /** EASY, MEDIUM and HARD, always all three. */
    available: Record<string, number>;
    questions: LibraryQuestion[];
}

/** The bank filter; library_node_ids / unsorted_only live on it so the assessment picker can use them too. */
export type LibraryFilters = QuestionBankFilters;

export interface LibrarySubjectTag {
    tag_id: string;
    tag_name: string;
    question_count: number;
}

export interface LibraryActionResult {
    nodes_created: number;
    affected: number;
}

export interface LibraryEditResult {
    question_id: string;
    versioned: boolean;
    previous_question_id?: string | null;
    assessment_count?: number;
}

/** A node with its children, built from the flat list the API returns. */
export interface LibraryTreeNode extends LibraryNode {
    children: LibraryTreeNode[];
}

export const buildTree = (nodes: LibraryNode[]): LibraryTreeNode[] => {
    const byId = new Map<string, LibraryTreeNode>();
    nodes.forEach((node) => byId.set(node.id, { ...node, children: [] }));
    const roots: LibraryTreeNode[] = [];
    byId.forEach((node) => {
        const parent = node.parent_id ? byId.get(node.parent_id) : undefined;
        if (parent) parent.children.push(node);
        else roots.push(node);
    });
    const sort = (list: LibraryTreeNode[]) => {
        list.sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name));
        list.forEach((child) => sort(child.children));
    };
    sort(roots);
    return roots;
};

/** The topics whose name matches, with the folders that lead to them. A matching folder keeps all it holds. */
export const filterTree = (roots: LibraryTreeNode[], query: string): LibraryTreeNode[] => {
    const needle = query.trim().toLowerCase();
    if (!needle) return roots;
    return roots.flatMap((node) => {
        if (node.name.toLowerCase().includes(needle)) return [node];
        const children = filterTree(node.children, needle);
        return children.length ? [{ ...node, children }] : [];
    });
};

/** Totals of a question page, whichever way the envelope spells them. */
export const pageTotals = (page: LibraryQuestionPage | undefined) => ({
    elements: page?.total_elements ?? page?.totalElements ?? 0,
    pages: page?.total_pages ?? page?.totalPages ?? 0,
});

/** "Physics › Mechanics › Friction" for a node id. */
export const nodePath = (nodeId: string, nodes: LibraryNode[]): string => {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const parts: string[] = [];
    let current = byId.get(nodeId);
    const seen = new Set<string>();
    while (current && !seen.has(current.id)) {
        seen.add(current.id);
        parts.unshift(current.name);
        current = current.parent_id ? byId.get(current.parent_id) : undefined;
    }
    return parts.join(' › ');
};

/** Depth-first order with each node's depth, for indented pickers. */
export const flattenTree = (roots: LibraryTreeNode[]): LibraryTreeNode[] => {
    const out: LibraryTreeNode[] = [];
    const walk = (list: LibraryTreeNode[]) =>
        list.forEach((node) => {
            out.push(node);
            walk(node.children);
        });
    walk(roots);
    return out;
};

/** Ids of a node and everything below it. */
export const subtreeIds = (nodeId: string, nodes: LibraryNode[]): Set<string> => {
    const children = new Map<string, string[]>();
    nodes.forEach((node) => {
        if (!node.parent_id) return;
        children.set(node.parent_id, [...(children.get(node.parent_id) ?? []), node.id]);
    });
    const result = new Set<string>();
    const queue = [nodeId];
    while (queue.length) {
        const id = queue.shift() as string;
        if (result.has(id)) continue;
        result.add(id);
        queue.push(...(children.get(id) ?? []));
    }
    return result;
};

/** Levels in the subtree rooted at nodeId (1 = no children). */
export const subtreeHeight = (nodeId: string, nodes: LibraryNode[]): number => {
    const kids = nodes.filter((node) => node.parent_id === nodeId);
    return 1 + kids.reduce((best, kid) => Math.max(best, subtreeHeight(kid.id, nodes)), 0);
};

// ------------------------------------------------------------------ API

export const fetchLibraryTree = async (instituteId: string): Promise<LibraryTree> => {
    const { data } = await authenticatedAxiosInstance.get<LibraryTree>(`${LIBRARY_BASE}/tree`, {
        params: { instituteId },
    });
    return data;
};

export const fetchLibraryQuestions = async (
    instituteId: string,
    filters: LibraryFilters,
    pageNo: number,
    pageSize: number
): Promise<LibraryQuestionPage> => {
    const { data } = await authenticatedAxiosInstance.post<LibraryQuestionPage>(
        `${LIBRARY_BASE}/questions/filter`,
        filters,
        { params: { instituteId, pageNo, pageSize } }
    );
    return data;
};

const post = async <T>(path: string, instituteId: string, body: unknown): Promise<T> => {
    const { data } = await authenticatedAxiosInstance.post<T>(`${LIBRARY_BASE}${path}`, body, {
        params: { instituteId },
    });
    return data;
};

export const createLibraryNode = (
    instituteId: string,
    body: { name: string; description?: string; parent_id?: string | null }
) => post<LibraryNode>('/nodes', instituteId, body);

export const updateLibraryNode = async (
    instituteId: string,
    nodeId: string,
    body: { name?: string; description?: string }
) => {
    const { data } = await authenticatedAxiosInstance.put<string>(`${LIBRARY_BASE}/nodes`, body, {
        params: { instituteId, nodeId },
    });
    return data;
};

export const moveLibraryNode = (instituteId: string, nodeId: string, parentId: string | null) =>
    post<string>('/nodes/move', instituteId, { node_id: nodeId, parent_id: parentId });

export const reorderLibraryNodes = (
    instituteId: string,
    parentId: string | null,
    orderedNodeIds: string[]
) =>
    post<string>('/nodes/reorder', instituteId, {
        parent_id: parentId,
        ordered_node_ids: orderedNodeIds,
    });

export const deleteLibraryNode = async (instituteId: string, nodeId: string) => {
    const { data } = await authenticatedAxiosInstance.delete<LibraryActionResult>(
        `${LIBRARY_BASE}/nodes`,
        { params: { instituteId, nodeId } }
    );
    return data;
};

export const assignLibraryQuestions = (
    instituteId: string,
    body: {
        question_ids: string[];
        node_ids: string[];
        mode?: 'ADD' | 'MOVE';
        from_node_id?: string | null;
    }
) => post<LibraryActionResult>('/questions/assign', instituteId, body);

export const removeLibraryQuestions = (
    instituteId: string,
    body: { question_ids: string[]; node_id: string }
) => post<LibraryActionResult>('/questions/remove', instituteId, body);

export const editLibraryQuestion = (instituteId: string, question: unknown) =>
    post<LibraryEditResult>('/questions/edit', instituteId, question);

export const addPaperToLibraryNode = (
    instituteId: string,
    body: { question_paper_id: string; node_id: string }
) => post<LibraryActionResult>('/papers/add-to-node', instituteId, body);

export const removeLibraryPaper = (
    instituteId: string,
    body: { question_paper_id: string; node_id: string }
) => post<LibraryActionResult>('/papers/remove', instituteId, body);

export const fetchLibraryPapers = async (instituteId: string, nodeId?: string) => {
    const { data } = await authenticatedAxiosInstance.get<LibraryPaper[]>(
        `${LIBRARY_BASE}/papers`,
        {
            params: { instituteId, nodeId },
        }
    );
    return data;
};

/**
 * Copies picked questions, or one whole paper, into the caller's institute. A test links
 * to the returned copies, never to the library rows, so editing them stays in that test.
 */
export const copyLibraryQuestions = (
    instituteId: string,
    body: {
        question_ids?: string[];
        question_paper_id?: string;
        exclude_question_ids?: string[];
    }
) => post<LibraryCopyResult>('/questions/copy', instituteId, body);

/** Random questions per difficulty. Reads only: adding them still goes through the copy call. */
export const randomPickLibraryQuestions = (instituteId: string, body: LibraryRandomPickBody) =>
    post<LibraryRandomPickResult>('/questions/random-pick', instituteId, body);

/** One of this institute's copies. Its test may not have been saved yet. */
export const fetchLibraryCopy = async (instituteId: string, questionId: string) => {
    const { data } = await authenticatedAxiosInstance.get<QuestionResponse>(
        `${LIBRARY_BASE}/copies`,
        { params: { instituteId, questionId } }
    );
    return data;
};

/** Saves an edit to one of this institute's copies. The server refuses anything else. */
export const editLibraryCopy = (instituteId: string, question: unknown) =>
    post<boolean>('/copies/edit', instituteId, question);

export const fetchLibrarySubjectTags = async (instituteId: string) => {
    const { data } = await authenticatedAxiosInstance.get<LibrarySubjectTag[]>(
        `${LIBRARY_BASE}/subject-tags`,
        { params: { instituteId } }
    );
    return data;
};

export const importLibrarySubjectTags = (
    instituteId: string,
    body: { tag_ids: string[]; parent_id?: string | null }
) => post<LibraryActionResult>('/subject-tags/import', instituteId, body);

// ------------------------------------------------------------------ hooks

export const useLibraryTree = (instituteId: string | undefined) =>
    useQuery({
        queryKey: [LIBRARY_TREE_KEY, instituteId],
        queryFn: () => fetchLibraryTree(instituteId as string),
        enabled: !!instituteId,
        staleTime: 30 * 1000,
    });

export const useLibraryQuestions = (
    instituteId: string | undefined,
    filters: LibraryFilters,
    pageNo: number,
    pageSize: number
) =>
    useQuery({
        queryKey: [LIBRARY_QUESTIONS_KEY, instituteId, filters, pageNo, pageSize],
        queryFn: () => fetchLibraryQuestions(instituteId as string, filters, pageNo, pageSize),
        enabled: !!instituteId,
        placeholderData: (previous) => previous,
    });

export const useLibraryPapers = (instituteId: string | undefined, nodeId?: string) =>
    useQuery({
        queryKey: [LIBRARY_PAPERS_KEY, instituteId, nodeId],
        queryFn: () => fetchLibraryPapers(instituteId as string, nodeId),
        enabled: !!instituteId,
    });

/** How many questions random pick can offer per difficulty. */
export const useLibraryAvailability = (
    instituteId: string | undefined,
    body: LibraryRandomPickBody
) =>
    useQuery({
        queryKey: [LIBRARY_AVAILABILITY_KEY, instituteId, body],
        queryFn: () => randomPickLibraryQuestions(instituteId as string, body),
        enabled: !!instituteId,
    });

export const useLibrarySubjectTags = (instituteId: string | undefined, enabled: boolean) =>
    useQuery({
        queryKey: [LIBRARY_TAGS_KEY, instituteId],
        queryFn: () => fetchLibrarySubjectTags(instituteId as string),
        enabled: !!instituteId && enabled,
    });

/** Any write: refresh the tree counts and the question list. */
export const useLibraryMutation = <TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: fn,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [LIBRARY_TREE_KEY] });
            queryClient.invalidateQueries({ queryKey: [LIBRARY_QUESTIONS_KEY] });
        },
    });
};

/** Refresh the tree counts and the question list after a write. */
export const useLibraryRefresh = () => {
    const queryClient = useQueryClient();
    return () => {
        queryClient.invalidateQueries({ queryKey: [LIBRARY_TREE_KEY] });
        queryClient.invalidateQueries({ queryKey: [LIBRARY_QUESTIONS_KEY] });
        queryClient.invalidateQueries({ queryKey: [LIBRARY_PAPERS_KEY] });
    };
};

/** Server message for a failed call, so the admin sees "Topic not found" instead of a 500. */
export const libraryErrorMessage = (error: unknown, fallback: string): string => {
    const response = (error as { response?: { data?: { ex?: string; message?: string } } })
        ?.response?.data;
    const detail = response?.ex || response?.message;
    return typeof detail === 'string' && detail ? detail : fallback;
};
