import { useCallback, useEffect, useState } from "react";
import { BlogService } from "../-services/blog-service";

/**
 * Likes on blog posts, for the `blog` section when its `allowLikes` is on.
 *
 * Sites are public and most readers never log in, so a like belongs to this
 * browser: a random visitor id kept in localStorage is sent with every like,
 * and the server counts each (post, visitor) once. The ids of posts this
 * browser liked are kept too, so the heart is already filled on the next visit.
 *
 * The public lists are edge-cached for a few minutes, so a card can carry an
 * older total than the one the server just returned. The last total seen here
 * wins over the cached one, and every button for the same post (a card and
 * the open article) is kept in step through one window event.
 */

const VISITOR_KEY = "catalogue-blog-visitor";
const LIKED_KEY = "catalogue-blog-liked";
const LIKE_EVENT = "catalogueBlogLiked";
/** Enough for any reader; the oldest likes fall off first. */
const MAX_REMEMBERED = 500;

/** Fresh totals from like requests made on this page, by post id. */
const knownCounts = new Map<string, number>();

interface LikeEventDetail {
  postId: string;
  liked: boolean;
  count: number;
}

const readLiked = (): string[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = JSON.parse(window.localStorage.getItem(LIKED_KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

const writeLiked = (postId: string, liked: boolean) => {
  try {
    const rest = readLiked().filter((id) => id !== postId);
    const next = liked ? [...rest, postId].slice(-MAX_REMEMBERED) : rest;
    window.localStorage.setItem(LIKED_KEY, JSON.stringify(next));
  } catch {
    // Private mode / storage disabled: the like still counts on the server.
  }
};

const newVisitorId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
};

const visitorId = (): string => {
  try {
    const existing = window.localStorage.getItem(VISITOR_KEY);
    if (existing) return existing;
    const created = newVisitorId();
    window.localStorage.setItem(VISITOR_KEY, created);
    return created;
  } catch {
    return newVisitorId();
  }
};

const announce = (detail: LikeEventDetail) => {
  knownCounts.set(detail.postId, detail.count);
  window.dispatchEvent(new CustomEvent<LikeEventDetail>(LIKE_EVENT, { detail }));
};

/**
 * Like state of one post. `disabled` (the page editor's preview) shows the
 * button but never writes a like.
 */
export const useBlogLike = (
  postId: string,
  instituteId: string,
  serverCount: number | null | undefined,
  disabled = false
) => {
  const [liked, setLiked] = useState(false);
  const [count, setCount] = useState(() => knownCounts.get(postId) ?? serverCount ?? 0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setLiked(readLiked().includes(postId));
    setCount(knownCounts.get(postId) ?? serverCount ?? 0);
  }, [postId, serverCount]);

  useEffect(() => {
    const onLike = (e: Event) => {
      const detail = (e as CustomEvent<LikeEventDetail>).detail;
      if (!detail || detail.postId !== postId) return;
      setLiked(detail.liked);
      setCount(detail.count);
    };
    window.addEventListener(LIKE_EVENT, onLike);
    return () => window.removeEventListener(LIKE_EVENT, onLike);
  }, [postId]);

  const toggle = useCallback(async () => {
    if (disabled || busy || !postId || !instituteId) return;
    const next = !liked;
    const before = { liked, count };
    // Show it at once; the server's total replaces the guess when it answers.
    setLiked(next);
    setCount((c) => Math.max(0, c + (next ? 1 : -1)));
    writeLiked(postId, next);
    setBusy(true);
    try {
      const res = await BlogService.setLike(instituteId, postId, visitorId(), next);
      announce({ postId, liked: res.liked, count: res.like_count });
    } catch {
      setLiked(before.liked);
      setCount(before.count);
      writeLiked(postId, before.liked);
    } finally {
      setBusy(false);
    }
  }, [busy, count, disabled, instituteId, liked, postId]);

  return { liked, count, busy, toggle };
};
