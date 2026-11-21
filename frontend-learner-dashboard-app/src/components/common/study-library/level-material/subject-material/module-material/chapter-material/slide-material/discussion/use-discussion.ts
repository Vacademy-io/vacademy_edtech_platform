import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useContentStore } from "@/stores/study-library/chapter-sidebar-store";
import { getPackageSessionId } from "@/utils/study-library/get-list-from-stores/getPackageSessionId";
import { getBackendErrorMessage } from "@/utils/error-message";
import {
  createDiscussionPost,
  deleteDiscussionPost,
  editDiscussionPost,
  fetchDiscussionThread,
  reportDiscussionPost,
  toggleDiscussionReaction,
  type DiscussionContextIds,
  type DiscussionPost,
  type DiscussionReactionCount,
  type DiscussionThread,
} from "./discussion-api";

const asId = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value : undefined;

/**
 * The ids a discussion post needs, read the way the neighbouring slides read
 * them: chapter / module / subject from the slides route's search params, the
 * batch from `sessionId` (the URL's name for packageSessionId), then the
 * course the store says is open, then the batch cached at login. Read live
 * (not baked into the slide JSX) so a batch resolved after the slide mounted
 * still reaches the request.
 */
export function useDiscussionContext(slideId: string): {
  ids: DiscussionContextIds;
  ready: boolean;
} {
  const search = useRouterState({
    select: (state) => state.location.search as Record<string, unknown>,
  });
  const { currentPackageSessionId } = useContentStore();
  const chapterId = asId(search.chapterId);
  const moduleId = asId(search.moduleId);
  const subjectId = asId(search.subjectId);
  const fromRoute =
    asId(search.sessionId) ?? asId(search.packageSessionId) ?? asId(currentPackageSessionId);

  // Same key and source as the slides route, so this is normally a cache hit.
  const cached = useQuery({
    queryKey: ["packageSessionId"],
    queryFn: getPackageSessionId,
    enabled: !fromRoute,
  });
  const packageSessionId = fromRoute ?? asId(cached.data);

  const ids = useMemo(
    () => ({ slideId, packageSessionId, chapterId, moduleId, subjectId }),
    [slideId, packageSessionId, chapterId, moduleId, subjectId]
  );
  return { ids, ready: !!slideId && (!!fromRoute || !cached.isLoading) };
}

export const discussionThreadKey = (ids: DiscussionContextIds): QueryKey => [
  "discussion-thread",
  ids.slideId,
  ids.packageSessionId ?? "",
];

export function useDiscussionThread(ids: DiscussionContextIds, enabled: boolean) {
  return useQuery({
    queryKey: discussionThreadKey(ids),
    queryFn: () => fetchDiscussionThread(ids),
    enabled,
    // Replies come in while the learner reads; a light refresh when they come
    // back to the tab is enough, no polling.
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  });
}

/** Applies `fn` to the post with `postId`, wherever it sits (response or comment). */
const mapPost = (
  posts: DiscussionPost[],
  postId: string,
  fn: (post: DiscussionPost) => DiscussionPost
): DiscussionPost[] =>
  posts.map((post) => {
    if (post.id === postId) return fn(post);
    if (post.comments?.some((c) => c.id === postId)) {
      return {
        ...post,
        comments: post.comments.map((c) => (c.id === postId ? fn(c) : c)),
      };
    }
    return post;
  });

const toggleLocally = (
  reactions: DiscussionReactionCount[] | undefined,
  reaction: string
): DiscussionReactionCount[] => {
  const list = reactions ?? [];
  const existing = list.find((r) => r.reaction === reaction);
  if (!existing) {
    return [...list, { reaction, count: 1, reacted_by_me: true }];
  }
  return list.map((r) =>
    r.reaction === reaction
      ? {
          ...r,
          reacted_by_me: !r.reacted_by_me,
          count: Math.max(0, r.count + (r.reacted_by_me ? -1 : 1)),
        }
      : r
  );
};

/** Every write the learner can make, each refreshing what it changed. */
export function useDiscussionActions(ids: DiscussionContextIds) {
  const { t } = useTranslation("studyContent");
  const queryClient = useQueryClient();
  const key = discussionThreadKey(ids);
  const refetchThread = () => queryClient.invalidateQueries({ queryKey: key });
  const showError = (error: unknown) =>
    toast.error(getBackendErrorMessage(error, t("discussion.errors.generic")));

  const create = useMutation({
    mutationFn: (body: { content: string; anonymous: boolean; parentId?: string }) =>
      createDiscussionPost(ids, body),
    onSuccess: (post, body) => {
      const thread = queryClient.getQueryData<DiscussionThread>(key);
      const firstResponse = !body.parentId && !thread?.viewer.has_responded;
      // The server marks the slide complete on the first response; refresh
      // the slide list so the sidebar tick and chapter progress follow.
      if (firstResponse && ids.chapterId) {
        queryClient.invalidateQueries({ queryKey: ["slides", ids.chapterId] });
      }
      if (!body.parentId) {
        toast.success(
          post.status === "PENDING"
            ? t("discussion.toast.sentForReview")
            : t("discussion.toast.shared")
        );
      }
    },
    onError: showError,
    onSettled: refetchThread,
  });

  const edit = useMutation({
    mutationFn: ({ postId, content }: { postId: string; content: string }) =>
      editDiscussionPost(postId, content),
    onError: showError,
    onSettled: refetchThread,
  });

  const remove = useMutation({
    mutationFn: (postId: string) => deleteDiscussionPost(postId),
    onError: showError,
    onSettled: refetchThread,
  });

  const react = useMutation({
    mutationFn: ({ postId, reaction }: { postId: string; reaction: string }) =>
      toggleDiscussionReaction(postId, reaction),
    // Optimistic: the chip answers the tap at once, then settles on the
    // server's counts (which also carry everyone else's reactions).
    onMutate: async ({ postId, reaction }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<DiscussionThread>(key);
      if (previous) {
        queryClient.setQueryData<DiscussionThread>(key, {
          ...previous,
          posts: mapPost(previous.posts, postId, (p) => ({
            ...p,
            reactions: toggleLocally(p.reactions, reaction),
          })),
        });
      }
      return { previous };
    },
    onSuccess: (counts, { postId }) => {
      const current = queryClient.getQueryData<DiscussionThread>(key);
      if (!current) return;
      queryClient.setQueryData<DiscussionThread>(key, {
        ...current,
        posts: mapPost(current.posts, postId, (p) => ({ ...p, reactions: counts })),
      });
    },
    onError: (error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      showError(error);
    },
  });

  const report = useMutation({
    mutationFn: ({ postId, reason }: { postId: string; reason?: string }) =>
      reportDiscussionPost(postId, reason),
    onSuccess: (_data, { postId }) => {
      const current = queryClient.getQueryData<DiscussionThread>(key);
      if (current) {
        queryClient.setQueryData<DiscussionThread>(key, {
          ...current,
          posts: mapPost(current.posts, postId, (p) => ({ ...p, reported_by_me: true })),
        });
      }
      toast.success(t("discussion.toast.reported"));
    },
    onError: showError,
  });

  return { create, edit, remove, react, report };
}

export type DiscussionActions = ReturnType<typeof useDiscussionActions>;
