import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { getInstituteId } from '@/constants/helper';
import { DISCUSSION_ADMIN_POSTS, DISCUSSION_ADMIN_THREAD } from '@/constants/urls';
import type {
    DiscussionModerationAction,
    DiscussionPostView,
    DiscussionThreadView,
} from './discussion-types';

/** React-query key root; invalidate `[DISCUSSION_THREAD_KEY, slideId]` after any write. */
export const DISCUSSION_THREAD_KEY = 'DISCUSSION_ADMIN_THREAD';

function instituteParam(): { instituteId: string } {
    return { instituteId: getInstituteId() || '' };
}

export async function fetchDiscussionThread(
    slideId: string,
    packageSessionId?: string
): Promise<DiscussionThreadView> {
    const response = await authenticatedAxiosInstance.get<DiscussionThreadView>(
        DISCUSSION_ADMIN_THREAD,
        {
            params: {
                slideId,
                ...instituteParam(),
                ...(packageSessionId ? { packageSessionId } : {}),
            },
        }
    );
    return response.data;
}

export async function createDiscussionPost(body: {
    slide_id: string;
    /** null = every batch */
    package_session_id: string | null;
    parent_id?: string | null;
    content: string;
}): Promise<DiscussionPostView> {
    const response = await authenticatedAxiosInstance.post<DiscussionPostView>(
        DISCUSSION_ADMIN_POSTS,
        body,
        { params: instituteParam() }
    );
    return response.data;
}

export async function editDiscussionPost(
    postId: string,
    content: string
): Promise<DiscussionPostView> {
    const response = await authenticatedAxiosInstance.put<DiscussionPostView>(
        `${DISCUSSION_ADMIN_POSTS}/${encodeURIComponent(postId)}`,
        { content },
        { params: instituteParam() }
    );
    return response.data;
}

export async function moderateDiscussionPost(
    postId: string,
    action: DiscussionModerationAction
): Promise<DiscussionPostView> {
    const response = await authenticatedAxiosInstance.post<DiscussionPostView>(
        `${DISCUSSION_ADMIN_POSTS}/${encodeURIComponent(postId)}/moderate`,
        { action },
        { params: instituteParam() }
    );
    return response.data;
}

/** Best human-readable message from a failed admin-core call. */
export function discussionErrorMessage(error: unknown, fallback: string): string {
    const data = (error as { response?: { data?: { ex?: string; message?: string } } })?.response
        ?.data;
    return data?.ex || data?.message || fallback;
}
