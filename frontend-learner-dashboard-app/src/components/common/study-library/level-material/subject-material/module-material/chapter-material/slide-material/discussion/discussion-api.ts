import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import {
  DISCUSSION_POST,
  DISCUSSION_POST_REACTIONS,
  DISCUSSION_POST_REPORT,
  DISCUSSION_POSTS,
  GET_DISCUSSION_THREAD,
} from "@/constants/urls";

/**
 * Learner side of a discussion slide (DOCUMENT type "DISCUSSION").
 * Contract: admin_core_service/.../features/discussion/DISCUSSION_FORUM.md.
 * Every field is snake_case and null fields are omitted, so optional fields
 * really can be missing.
 */

export type DiscussionVisibility = "OPEN" | "AFTER_REPLY" | "PRIVATE";

export type DiscussionReaction =
  | "HEART"
  | "HUG"
  | "THANKS"
  | "INSIGHT"
  | "RELATE"
  | "STRENGTH";

export interface DiscussionSettings {
  visibility: DiscussionVisibility;
  allow_comments: boolean;
  allow_reactions: boolean;
  reactions: string[];
  allow_anonymous: boolean;
  require_approval: boolean;
  allow_edit_own: boolean;
  locked: boolean;
  care_note?: string | null;
}

export interface DiscussionViewer {
  user_id: string;
  staff: boolean;
  has_responded: boolean;
  can_see_others: boolean;
  can_respond: boolean;
  can_comment_on_others: boolean;
}

export interface DiscussionReactionCount {
  reaction: string;
  count: number;
  reacted_by_me: boolean;
}

export type DiscussionPostStatus = "PUBLISHED" | "PENDING" | "HIDDEN";

export interface DiscussionPost {
  id: string;
  parent_id?: string;
  content: string;
  /** ISO string or epoch millis; `new Date(x)` reads both. */
  created_at: string | number;
  edited_at?: string | number;
  author_name: string;
  author_user_id?: string;
  author_role: "LEARNER" | "STAFF";
  anonymous: boolean;
  mine: boolean;
  status: DiscussionPostStatus;
  pinned: boolean;
  reactions?: DiscussionReactionCount[];
  reported_by_me?: boolean;
  comments?: DiscussionPost[];
}

export interface DiscussionThread {
  slide_id: string;
  package_session_id?: string;
  settings: DiscussionSettings;
  viewer: DiscussionViewer;
  stats: { responses: number; participants: number };
  posts: DiscussionPost[];
}

export interface DiscussionContextIds {
  slideId: string;
  packageSessionId?: string;
  chapterId?: string;
  moduleId?: string;
  subjectId?: string;
}

/** Posts can be at most this long (the server refuses longer). */
export const DISCUSSION_MAX_CHARS = 5000;
/** Report reasons are trimmed to this on the server. */
export const DISCUSSION_MAX_REPORT_CHARS = 500;

export const fetchDiscussionThread = async (
  ids: DiscussionContextIds
): Promise<DiscussionThread> => {
  const res = await authenticatedAxiosInstance.get<DiscussionThread>(
    GET_DISCUSSION_THREAD,
    {
      params: {
        slideId: ids.slideId,
        ...(ids.packageSessionId && { packageSessionId: ids.packageSessionId }),
        ...(ids.chapterId && { chapterId: ids.chapterId }),
      },
    }
  );
  return res.data;
};

export const createDiscussionPost = async (
  ids: DiscussionContextIds,
  body: { content: string; anonymous: boolean; parentId?: string }
): Promise<DiscussionPost> => {
  const res = await authenticatedAxiosInstance.post<DiscussionPost>(
    DISCUSSION_POSTS,
    {
      slide_id: ids.slideId,
      package_session_id: ids.packageSessionId,
      chapter_id: ids.chapterId,
      module_id: ids.moduleId,
      subject_id: ids.subjectId,
      parent_id: body.parentId,
      content: body.content,
      anonymous: body.anonymous,
    }
  );
  return res.data;
};

export const editDiscussionPost = async (
  postId: string,
  content: string
): Promise<DiscussionPost> => {
  const res = await authenticatedAxiosInstance.put<DiscussionPost>(
    DISCUSSION_POST(postId),
    { content }
  );
  return res.data;
};

export const deleteDiscussionPost = async (postId: string): Promise<void> => {
  await authenticatedAxiosInstance.delete(DISCUSSION_POST(postId));
};

/** Toggles one reaction; answers with the post's counts afterwards. */
export const toggleDiscussionReaction = async (
  postId: string,
  reaction: string
): Promise<DiscussionReactionCount[]> => {
  const res = await authenticatedAxiosInstance.post<DiscussionReactionCount[]>(
    DISCUSSION_POST_REACTIONS(postId),
    { reaction }
  );
  return Array.isArray(res.data) ? res.data : [];
};

export const reportDiscussionPost = async (
  postId: string,
  reason?: string
): Promise<void> => {
  await authenticatedAxiosInstance.post(DISCUSSION_POST_REPORT(postId), {
    reason: reason?.trim() || undefined,
  });
};
