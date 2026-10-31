import axios from "axios";
import { BASE_URL } from "@/constants/urls";

/**
 * Public reads of an institute's blog posts, for the catalogue `blog` section.
 * Only PUBLISHED posts past their publish time exist on this endpoint — drafts
 * are unreachable here by construction (see PublicCatalogueBlogController).
 */

const publicAxios = axios.create({ withCredentials: false });

const API_BASE = `${BASE_URL}/admin-core-service/public/catalogue-blog/v1`;

export interface BlogPostSummary {
  id: string;
  slug: string;
  title: string;
  excerpt?: string | null;
  /** Only the single-post endpoint fills this. */
  content_html?: string | null;
  cover_image_url?: string | null;
  author_name?: string | null;
  category?: string | null;
  tags?: string[];
  published_at?: string | null;
  seo_title?: string | null;
  seo_description?: string | null;
  reading_minutes?: number | null;
  /** Article layout; absent on posts saved before layouts existed. */
  template?: BlogTemplate | null;
  /** Course (package) ids shown as cards under the article, in order. */
  recommended_course_ids?: string[] | null;
  /** Likes from site visitors; absent on servers older than likes. */
  like_count?: number | null;
}

export type BlogTemplate = "CLASSIC" | "SIDEBAR_TOC" | "MAGAZINE" | "FOCUS";

export interface BlogPostPage {
  content: BlogPostSummary[];
  page: number;
  size: number;
  total_elements: number;
  total_pages: number;
  categories: string[];
}

export interface BlogLikeResult {
  liked: boolean;
  like_count: number;
}

export class BlogService {
  static async listPosts(
    instituteId: string,
    opts: { page?: number; size?: number; category?: string; excludeCategories?: string } = {}
  ): Promise<BlogPostPage> {
    const params: Record<string, string | number> = {
      instituteId,
      page: opts.page ?? 0,
      size: opts.size ?? 12,
    };
    if (opts.category) params.category = opts.category;
    // Comma-separated, sent as one plain param (no array brackets).
    if (opts.excludeCategories) params.excludeCategories = opts.excludeCategories;
    const res = await publicAxios.get<BlogPostPage>(`${API_BASE}/posts`, { params });
    return res.data;
  }

  /** null when the slug is unknown, unpublished or scheduled for later. */
  static async getPost(instituteId: string, slug: string): Promise<BlogPostSummary | null> {
    try {
      const res = await publicAxios.get<BlogPostSummary>(`${API_BASE}/post`, {
        params: { instituteId, slug },
      });
      return res.data ?? null;
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 404) return null;
      throw err;
    }
  }

  /** Like (liked = true) or unlike a post as this browser's visitor id. */
  static async setLike(
    instituteId: string,
    postId: string,
    visitorKey: string,
    liked: boolean
  ): Promise<BlogLikeResult> {
    const res = await publicAxios.post<BlogLikeResult>(`${API_BASE}/post/like`, {
      institute_id: instituteId,
      post_id: postId,
      visitor_key: visitorKey,
      liked,
    });
    return res.data;
  }
}
