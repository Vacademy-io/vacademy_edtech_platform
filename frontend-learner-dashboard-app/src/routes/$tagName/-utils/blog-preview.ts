import { useSyncExternalStore } from "react";
import type { BlogPostSummary, BlogTemplate } from "../-services/blog-service";

/**
 * The blog editor's Preview: the admin frames the post's own address with
 * `?preview=true&blogPreview=1` and posts the unsaved draft as
 * BLOG_POST_PREVIEW {post} (accepted only through isEditorMessage, like every
 * other preview message). BlogArticle then shows that draft instead of the
 * published post, so a DRAFT — which the public API does not return — is seen
 * on the real site, with the real header, theme and the section's layout.
 *
 * The body still goes through sanitizeBlogArticle at render time, exactly as a
 * published post does; text fields are rendered as text.
 */

const TEMPLATES: BlogTemplate[] = ["CLASSIC", "SIDEBAR_TOC", "MAGAZINE", "FOCUS", "FULL_WIDTH"];

let current: BlogPostSummary | null = null;
const listeners = new Set<() => void>();

export const setBlogPreviewPost = (post: BlogPostSummary | null): void => {
  current = post;
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** The draft the editor posted, or null (always null outside a blog preview). */
export const useBlogPreviewPost = (): BlogPostSummary | null =>
  useSyncExternalStore(
    subscribe,
    () => current,
    () => null
  );

/** `?blogPreview=1`: the frame is the blog editor's Preview, not the page editor. */
export const isBlogPreviewSearch = (search: string): boolean =>
  new URLSearchParams(search || "").get("blogPreview") === "1";

const str = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** The posted draft, kept only as the fields a post has, with their types. */
export const toBlogPreviewPost = (raw: unknown): BlogPostSummary | null => {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const template = str(p.template);
  const minutes = typeof p.reading_minutes === "number" && Number.isFinite(p.reading_minutes) ? p.reading_minutes : null;
  return {
    id: str(p.id) || "preview",
    slug: str(p.slug) || "preview",
    title: str(p.title) || "",
    excerpt: str(p.excerpt),
    content_html: str(p.content_html) || "",
    cover_image_url: str(p.cover_image_url),
    author_name: str(p.author_name),
    category: str(p.category),
    tags: Array.isArray(p.tags) ? p.tags.filter((t): t is string => typeof t === "string") : [],
    published_at: str(p.published_at),
    seo_title: str(p.seo_title),
    seo_description: str(p.seo_description),
    reading_minutes: minutes,
    template: template && (TEMPLATES as string[]).includes(template) ? (template as BlogTemplate) : null,
    recommended_course_ids: Array.isArray(p.recommended_course_ids)
      ? p.recommended_course_ids.filter((id): id is string => typeof id === "string" && !!id)
      : [],
    like_count: 0,
  };
};
