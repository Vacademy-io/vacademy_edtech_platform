import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { FOLDER_LIBRARY_BASE_URL } from '@/constants/urls';

/**
 * Folder libraries of the institute — the trees the `folderBrowser` page
 * section reads live. Every call is staff-only and institute-scoped
 * server-side; each node mutation answers with the fresh tree.
 */

export type FolderNodeType = 'FOLDER' | 'PRODUCT_PAGE';
export type FolderNodeStatus = 'ACTIVE' | 'HIDDEN';

/** How a folder lays out its children. The section sets the default; a folder may override it. */
export type FolderLayout = 'cards' | 'tiles' | 'list';
export type FolderImageShape = 'landscape' | 'square' | 'portrait' | 'none';

export interface FolderView {
    layout?: FolderLayout;
    imageShape?: FolderImageShape;
    columns?: number;
    showDescription?: boolean;
    showCounts?: boolean;
}

export interface FolderLibrary {
    id: string;
    institute_id: string;
    name: string;
    description?: string | null;
    node_count: number;
    created_at?: string | null;
    updated_at?: string | null;
}

export interface FolderNode {
    id: string;
    parent_id?: string | null;
    node_type: FolderNodeType;
    title?: string | null;
    description?: string | null;
    image_url?: string | null;
    product_page_id?: string | null;
    product_page_code?: string | null;
    product_page_name?: string | null;
    /** ACTIVE | DRAFT | DELETED from the product page, or MISSING when it no longer exists. */
    product_page_status?: string | null;
    display_order: number;
    status: FolderNodeStatus;
    view?: FolderView | null;
    /** URL-safe id used in links (?stream=shiksha). Unique within the library. */
    slug?: string | null;
    /** The course tag this folder stands for (filters the Courses page); defaults to the slug. */
    course_tag?: string | null;
    /** Second line under the title — e.g. the English name under a Hindi title ("EDUCATION"). */
    subtitle?: string | null;
    /** Headline shown when the folder is featured (mega menu detail panel). */
    tagline?: string | null;
    /** Call-to-action label, e.g. "Explore Education". */
    cta_label?: string | null;
    /** Where the folder (or its CTA) links: a site route like /courses?stream=shiksha, or a full URL. */
    link_url?: string | null;
    /** Hex colour behind the folder's image/icon. */
    accent_color?: string | null;
    /** Shown but not open yet: clicking collects the visitor's email for audience_id. */
    coming_soon?: boolean;
    /** Audience (lead campaign) that collects "notify me" sign-ups for a coming-soon folder. */
    audience_id?: string | null;
    children: FolderNode[];
}

export interface FolderTree {
    library: FolderLibrary;
    roots: FolderNode[];
}

/** Create and update. On update, an omitted field is left as is; '' clears it. */
export interface FolderNodeInput {
    parent_id?: string | null;
    node_type?: FolderNodeType;
    title?: string;
    description?: string;
    image_url?: string;
    product_page_id?: string;
    status?: FolderNodeStatus;
    /** {} clears the folder's display override. */
    view?: FolderView;
    /** '' clears a text field; coming_soon false/true sets the flag. */
    slug?: string;
    course_tag?: string;
    subtitle?: string;
    tagline?: string;
    cta_label?: string;
    link_url?: string;
    accent_color?: string;
    coming_soon?: boolean;
    audience_id?: string;
}

const params = (instituteId: string, extra: Record<string, string> = {}) => ({ instituteId, ...extra });

export const listFolderLibraries = async (instituteId: string): Promise<FolderLibrary[]> =>
    (await authenticatedAxiosInstance.get<FolderLibrary[]>(`${FOLDER_LIBRARY_BASE_URL}/libraries`, {
        params: params(instituteId),
    })).data || [];

export const createFolderLibrary = async (
    instituteId: string,
    body: { name: string; description?: string }
): Promise<FolderLibrary> =>
    (await authenticatedAxiosInstance.post<FolderLibrary>(`${FOLDER_LIBRARY_BASE_URL}/library`, body, {
        params: params(instituteId),
    })).data;

export const updateFolderLibrary = async (
    instituteId: string,
    libraryId: string,
    body: { name?: string; description?: string }
): Promise<FolderLibrary> =>
    (await authenticatedAxiosInstance.put<FolderLibrary>(`${FOLDER_LIBRARY_BASE_URL}/library`, body, {
        params: params(instituteId, { libraryId }),
    })).data;

export const deleteFolderLibrary = async (instituteId: string, libraryId: string): Promise<void> => {
    await authenticatedAxiosInstance.delete(`${FOLDER_LIBRARY_BASE_URL}/library`, {
        params: params(instituteId, { libraryId }),
    });
};

export const getFolderTree = async (instituteId: string, libraryId: string): Promise<FolderTree> =>
    (await authenticatedAxiosInstance.get<FolderTree>(`${FOLDER_LIBRARY_BASE_URL}/tree`, {
        params: params(instituteId, { libraryId }),
    })).data;

export const createFolderNode = async (
    instituteId: string,
    libraryId: string,
    body: FolderNodeInput
): Promise<FolderTree> =>
    (await authenticatedAxiosInstance.post<FolderTree>(`${FOLDER_LIBRARY_BASE_URL}/node`, body, {
        params: params(instituteId, { libraryId }),
    })).data;

export const updateFolderNode = async (
    instituteId: string,
    nodeId: string,
    body: FolderNodeInput
): Promise<FolderTree> =>
    (await authenticatedAxiosInstance.put<FolderTree>(`${FOLDER_LIBRARY_BASE_URL}/node`, body, {
        params: params(instituteId, { nodeId }),
    })).data;

export const moveFolderNode = async (
    instituteId: string,
    nodeId: string,
    /** Omit `index` to append at the end of the destination. */
    body: { parent_id: string | null; index?: number }
): Promise<FolderTree> =>
    (await authenticatedAxiosInstance.post<FolderTree>(`${FOLDER_LIBRARY_BASE_URL}/node/move`, body, {
        params: params(instituteId, { nodeId }),
    })).data;

export const deleteFolderNode = async (
    instituteId: string,
    nodeId: string
): Promise<{ deleted: number; tree: FolderTree }> =>
    (await authenticatedAxiosInstance.delete<{ deleted: number; tree: FolderTree }>(
        `${FOLDER_LIBRARY_BASE_URL}/node`,
        { params: params(instituteId, { nodeId }) }
    )).data;

export const folderTreeQueryKey = (instituteId: string | undefined, libraryId: string | undefined) =>
    ['FOLDER_LIBRARY_TREE', instituteId, libraryId] as const;
export const folderLibrariesQueryKey = (instituteId: string | undefined) =>
    ['FOLDER_LIBRARIES', instituteId] as const;

/* ── tree helpers (pure) ─────────────────────────────────────────────── */

/** Path from the top level down to `id`, inclusive; [] when not found. */
export const pathTo = (roots: FolderNode[], id: string | null | undefined): FolderNode[] => {
    if (!id) return [];
    const walk = (nodes: FolderNode[], trail: FolderNode[]): FolderNode[] | null => {
        for (const n of nodes) {
            const next = [...trail, n];
            if (n.id === id) return next;
            const hit = walk(n.children || [], next);
            if (hit) return hit;
        }
        return null;
    };
    return walk(roots, []) || [];
};

export const findNode = (roots: FolderNode[], id: string | null | undefined): FolderNode | null => {
    const trail = pathTo(roots, id);
    return trail.length ? trail[trail.length - 1]! : null;
};

/** Every folder in display order with its depth, for "Move to…" and start-folder pickers. */
export const flattenFolders = (roots: FolderNode[]): { node: FolderNode; depth: number }[] => {
    const out: { node: FolderNode; depth: number }[] = [];
    const walk = (nodes: FolderNode[], depth: number) => {
        for (const n of nodes) {
            if (n.node_type !== 'FOLDER') continue;
            out.push({ node: n, depth });
            walk(n.children || [], depth + 1);
        }
    };
    walk(roots, 0);
    return out;
};

/** Ids of a node and everything below it — the folders it cannot be moved into. */
export const subtreeIds = (node: FolderNode): Set<string> => {
    const ids = new Set<string>();
    const walk = (n: FolderNode) => {
        ids.add(n.id);
        (n.children || []).forEach(walk);
    };
    walk(node);
    return ids;
};

/** What a learner sees as the item's name: its own title, else the product page's. */
export const nodeLabel = (n: FolderNode): string =>
    (n.title || '').trim() || (n.product_page_name || '').trim() || (n.node_type === 'FOLDER' ? 'Untitled folder' : 'Product page');

/** The folder's link key as the site reads it: its slug, else a slug made from its subtitle or title, else its id. */
export const folderSlug = (n: Pick<FolderNode, 'slug' | 'subtitle' | 'title' | 'id'>): string => {
    const explicit = (n.slug || '').trim();
    if (explicit) return explicit;
    const fromText = (n.subtitle || n.title || '')
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return fromText || n.id;
};

/** The course tag a folder filters by on the site: its explicit tag, else its link key. */
export const folderCourseTag = (n: Pick<FolderNode, 'slug' | 'course_tag' | 'subtitle' | 'title' | 'id'>): string =>
    (n.course_tag || '').trim() || folderSlug(n);
