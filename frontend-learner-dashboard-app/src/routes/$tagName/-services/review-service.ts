import axios from "axios";
import { BASE_URL } from "@/constants/urls";

/**
 * Site reviews: what a `reviewCollector` block submits (always lands PENDING
 * for the admin to moderate) and what a testimonials section reads back
 * (APPROVED only — pending and rejected reviews are unreachable here).
 */

const publicAxios = axios.create({ withCredentials: false });

const API_BASE = `${BASE_URL}/admin-core-service/public/catalogue-review/v1`;

export interface ApprovedReview {
  id: string;
  rating: number;
  review_text?: string | null;
  reviewer_name: string;
  city?: string | null;
  course_name?: string | null;
  designation?: string | null;
  created_at?: string | null;
}

export interface ApprovedReviewPage {
  content: ApprovedReview[];
  page: number;
  size: number;
  total_elements: number;
  total_pages: number;
  /** Average stars over every approved review (one decimal). */
  average_rating?: number | null;
  approved_count?: number | null;
}

export interface ReviewSubmission {
  instituteId: string;
  catalogueTag?: string;
  pageRoute?: string;
  rating: number;
  reviewText?: string;
  reviewerName: string;
  city?: string;
  courseName?: string;
  designation?: string;
  visitorKey?: string;
  /** Answers to the form's custom fields, with the label the visitor saw. */
  answers?: { key: string; label: string; value: string }[];
  /** Honeypot: hidden from people, so only a bot fills it. */
  website?: string;
}

export class ReviewService {
  static async submit(review: ReviewSubmission): Promise<void> {
    await publicAxios.post(`${API_BASE}/submit`, {
      institute_id: review.instituteId,
      catalogue_tag: review.catalogueTag || null,
      page_route: review.pageRoute || null,
      rating: review.rating,
      review_text: review.reviewText || null,
      reviewer_name: review.reviewerName,
      city: review.city || null,
      course_name: review.courseName || null,
      designation: review.designation || null,
      visitor_key: review.visitorKey || null,
      answers: review.answers && review.answers.length ? review.answers : null,
      website: review.website || null,
    });
  }

  static async listApproved(
    instituteId: string,
    opts: { size?: number; minRating?: number } = {}
  ): Promise<ApprovedReviewPage> {
    const res = await publicAxios.get<ApprovedReviewPage>(`${API_BASE}/approved`, {
      params: { instituteId, page: 0, size: opts.size ?? 12, minRating: opts.minRating ?? 1 },
    });
    return res.data;
  }
}
