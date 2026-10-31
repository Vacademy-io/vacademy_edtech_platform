import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import {
    CATALOGUE_BLOG_POST,
    CATALOGUE_BLOG_POSTS,
    CATALOGUE_BLOG_POST_ARCHIVE,
    CATALOGUE_BLOG_POST_PUBLISH,
    CATALOGUE_BLOG_POST_UNPUBLISH,
} from '@/constants/urls';

/**
 * Blog posts of the institute — the rows the `blog` page section reads live.
 * Every call is institute-scoped server-side (the caller's membership is
 * checked), so a wrong instituteId fails rather than leaks.
 */

export type BlogPostStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

/** How the learner site lays out the article. Absent = CLASSIC. */
export type BlogPostTemplate = 'CLASSIC' | 'SIDEBAR_TOC' | 'MAGAZINE' | 'FOCUS';

/** Most courses a post can recommend under the article. */
export const BLOG_MAX_RECOMMENDED_COURSES = 6;

export interface BlogPost {
    id: string;
    institute_id: string;
    slug: string;
    title: string;
    excerpt?: string | null;
    /** Only the single-post read fills this. */
    content_html?: string | null;
    cover_image_url?: string | null;
    author_name?: string | null;
    author_user_id?: string | null;
    category?: string | null;
    tags: string[];
    status: BlogPostStatus;
    published_at?: string | null;
    seo_title?: string | null;
    seo_description?: string | null;
    source: 'EDITOR' | 'MCP' | 'AI';
    template?: BlogPostTemplate | null;
    /** Course (package) ids shown as cards after the article, in order. */
    recommended_course_ids?: string[] | null;
    reading_minutes?: number | null;
    created_at?: string | null;
    updated_at?: string | null;
}

export interface BlogPostPage {
    content: BlogPost[];
    page: number;
    size: number;
    total_elements: number;
    total_pages: number;
    categories: string[];
}

/** Every field optional: a null/undefined field is "leave as is" on update. */
export interface BlogPostInput {
    title?: string;
    slug?: string;
    excerpt?: string;
    content_html?: string;
    cover_image_url?: string;
    author_name?: string;
    category?: string;
    tags?: string[];
    status?: BlogPostStatus;
    published_at?: string | null;
    seo_title?: string;
    seo_description?: string;
    template?: BlogPostTemplate;
    /** In display order, at most 6; an empty array clears. */
    recommended_course_ids?: string[];
}

export const listBlogPosts = async (
    instituteId: string,
    opts: { status?: BlogPostStatus | 'ALL'; category?: string; q?: string; page?: number; size?: number } = {}
): Promise<BlogPostPage> => {
    const res = await authenticatedAxiosInstance.get<BlogPostPage>(CATALOGUE_BLOG_POSTS(instituteId), {
        params: {
            status: opts.status && opts.status !== 'ALL' ? opts.status : undefined,
            category: opts.category || undefined,
            q: opts.q || undefined,
            page: opts.page ?? 0,
            size: opts.size ?? 20,
        },
    });
    return res.data;
};

export const getBlogPost = async (instituteId: string, postId: string): Promise<BlogPost> => {
    const res = await authenticatedAxiosInstance.get<BlogPost>(CATALOGUE_BLOG_POST(instituteId, postId));
    return res.data;
};

export const createBlogPost = async (instituteId: string, input: BlogPostInput): Promise<BlogPost> => {
    const res = await authenticatedAxiosInstance.post<BlogPost>(CATALOGUE_BLOG_POST(instituteId), input);
    return res.data;
};

export const updateBlogPost = async (instituteId: string, postId: string, input: BlogPostInput): Promise<BlogPost> => {
    const res = await authenticatedAxiosInstance.put<BlogPost>(CATALOGUE_BLOG_POST(instituteId, postId), input);
    return res.data;
};

export const publishBlogPost = async (instituteId: string, postId: string): Promise<BlogPost> => {
    const res = await authenticatedAxiosInstance.post<BlogPost>(CATALOGUE_BLOG_POST_PUBLISH(instituteId, postId));
    return res.data;
};

export const unpublishBlogPost = async (instituteId: string, postId: string): Promise<BlogPost> => {
    const res = await authenticatedAxiosInstance.post<BlogPost>(CATALOGUE_BLOG_POST_UNPUBLISH(instituteId, postId));
    return res.data;
};

export const archiveBlogPost = async (instituteId: string, postId: string): Promise<BlogPost> => {
    const res = await authenticatedAxiosInstance.post<BlogPost>(CATALOGUE_BLOG_POST_ARCHIVE(instituteId, postId));
    return res.data;
};

export const deleteBlogPost = async (instituteId: string, postId: string): Promise<void> => {
    await authenticatedAxiosInstance.delete(CATALOGUE_BLOG_POST(instituteId, postId));
};

/** Client-side mirror of the server slug rule, for the live preview under the title field. */
export const slugifyTitle = (raw: string): string =>
    (raw || '')
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 120)
        .replace(/-+$/g, '');
