import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { CATALOGUE_REVIEW, CATALOGUE_REVIEWS, CATALOGUE_REVIEW_STATUS } from '@/constants/urls';

/**
 * Reviews site visitors sent through a `reviewCollector` block. Every call is
 * institute-scoped server-side (the caller's membership is checked).
 * Approving one makes it public: testimonials sections set to show reviews
 * pick it up on their next load, no republish needed.
 */

export type ReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface SiteReview {
    id: string;
    rating: number;
    review_text?: string | null;
    reviewer_name: string;
    city?: string | null;
    course_name?: string | null;
    designation?: string | null;
    status: ReviewStatus;
    catalogue_tag?: string | null;
    page_route?: string | null;
    created_at?: string | null;
    reviewed_at?: string | null;
    /** Answers to the form's custom fields, with the label the visitor saw. */
    answers?: { key: string; label: string; value: string }[] | null;
}

export interface SiteReviewPage {
    content: SiteReview[];
    page: number;
    size: number;
    total_elements: number;
    total_pages: number;
    counts?: Partial<Record<ReviewStatus, number>>;
}

/** Admin edit; a field left undefined stays as it is. */
export interface SiteReviewInput {
    rating?: number;
    review_text?: string;
    reviewer_name?: string;
    city?: string;
    course_name?: string;
    designation?: string;
}

export const listSiteReviews = async (
    instituteId: string,
    opts: { status?: ReviewStatus | 'ALL'; q?: string; page?: number; size?: number } = {}
): Promise<SiteReviewPage> => {
    const res = await authenticatedAxiosInstance.get<SiteReviewPage>(CATALOGUE_REVIEWS(instituteId), {
        params: {
            status: opts.status && opts.status !== 'ALL' ? opts.status : undefined,
            q: opts.q || undefined,
            page: opts.page ?? 0,
            size: opts.size ?? 20,
        },
    });
    return res.data;
};

export const setSiteReviewStatus = async (
    instituteId: string,
    reviewId: string,
    status: ReviewStatus
): Promise<SiteReview> => {
    const res = await authenticatedAxiosInstance.post<SiteReview>(CATALOGUE_REVIEW_STATUS(instituteId, reviewId, status));
    return res.data;
};

export const updateSiteReview = async (
    instituteId: string,
    reviewId: string,
    input: SiteReviewInput
): Promise<SiteReview> => {
    const res = await authenticatedAxiosInstance.put<SiteReview>(CATALOGUE_REVIEW(instituteId, reviewId), input);
    return res.data;
};

export const deleteSiteReview = async (instituteId: string, reviewId: string): Promise<void> => {
    await authenticatedAxiosInstance.delete(CATALOGUE_REVIEW(instituteId, reviewId));
};
