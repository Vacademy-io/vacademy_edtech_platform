// hooks/use-slides.ts
import { useQuery } from "@tanstack/react-query";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { GET_SLIDES, GET_SLIDES_BY_PACKAGE_SESSION } from "@/constants/urls";

export interface TextData {
  id: string;
  type: string;
  content: string;
}

export interface Option {
  id: string;
  text: TextData;
  explanation_text_data: TextData;
  media_id: string;
}

export interface QuestionSlideOption extends Option {
  question_slide_id: string;
}

// Video question interface
export interface VideoQuestion {
  id: string;
  parent_rich_text: TextData;
  text_data: TextData;
  explanation_text_data: TextData;
  media_id: string;
  question_response_type: string;
  question_type: string;
  access_level: string;
  auto_evaluation_json: string;
  evaluation_type: string;
  question_time_in_millis: number;
  question_order: number;
  status: string;
  options: Option[];
  new_question: boolean;
}

// Video slide interface
export interface VideoSlide {
  id: string;
  description: string;
  title: string;
  url: string;
  video_length_in_millis: number;
  published_url: string;
  published_video_length_in_millis: number;
  source_type: string;
  questions: VideoQuestion[];
  embedded_type?: "CODE" | "SCRATCH" | "JUPYTER";
  embedded_data?: string;
}

// Document slide interface
export interface DocumentSlide {
  id: string;
  type: string;
  data: string;
  title: string;
  cover_file_id: string;
  total_pages: number;
  published_data: string;
  published_document_total_pages: number;
}

// Question slide interface
export interface QuestionSlide {
  id: string;
  parent_rich_text: TextData;
  text_data: TextData;
  explanation_text_data: TextData;
  media_id: string;
  question_response_type: string;
  question_type: string;
  access_level: string;
  auto_evaluation_json: string;
  evaluation_type: string;
  default_question_time_mins: number;
  re_attempt_count: number;
  points: number;
  options: QuestionSlideOption[];
  source_type: string;
}

export interface QuizSlide {
  questions: (Omit<QuestionSlide, "text_data"> & { text: TextData })[];
}

// Assignment slide interface
export interface AssignmentSlide {
  id: string;
  parent_rich_text: TextData;
  text_data: TextData;
  live_date: string; // ISO 8601 date format
  end_date: string; // ISO 8601 date format
  re_attempt_count: number;
  comma_separated_media_ids: string;
}

// HTML Video slide interface (for HTML_VIDEO source_type)
export interface HtmlVideoSlide {
  id: string;
  ai_gen_video_id: string; // Video ID needed to fetch URLs from API
  url?: string;
  video_length_in_millis?: number;
}

// Audio slide interface
export interface AudioSlide {
  id: string;
  source_type: "FILE" | "URL";
  published_audio_file_id: string;
  published_audio_length_in_millis: number;
  thumbnail_file_id?: string;
  transcript?: string;
  external_url?: string | null;
}

// SCORM slide interface
export interface ScormSlide {
  id: string;
  original_file_id?: string;
  launch_path?: string;
  launch_url?: string;
  scorm_version?: string;
}

// Assessment slide interface — slide that links to an existing assessment
export interface AssessmentSlide {
  id: string;
  assessment_id: string;
  allow_reattempt?: boolean;
  show_result?: boolean;
}

// AI Video Data interface
export interface AIVideoData {
  status: 'COMPLETED' | 'GENERATING' | 'FAILED';
  timelineUrl: string;
  audioUrl: string;
  progress?: number;
}

// Main slide interface
export interface Slide {
  id: string;
  source_id: string;
  source_type: string;
  title: string;
  image_file_id: string;
  description: string;
  status: string;
  slide_order: number;
  video_slide?: VideoSlide;
  document_slide?: DocumentSlide;
  question_slide?: QuestionSlide;
  quiz_slide?: QuizSlide;
  assignment_slide?: AssignmentSlide;
  audio_slide?: AudioSlide;
  audioSlide?: AudioSlide;
  html_video_slide?: HtmlVideoSlide; // For HTML_VIDEO source_type slides
  scorm_slide?: ScormSlide | null; // For SCORM source_type slides
  assessment_slide?: AssessmentSlide | null; // For ASSESSMENT source_type slides
  aiVideoData?: AIVideoData;
  is_loaded: boolean;
  new_slide: boolean;
  percentage_completed: number;
  progress_marker: number;
  drip_condition_json?: string | null;
  drip_condition?: string | null; // JSON string from API
}

export const fetchSlidesByChapterId = async (
  chapterId: string,
  signal?: AbortSignal
): Promise<Slide[]> => {
  const response = await authenticatedAxiosInstance.get(
    `${GET_SLIDES}?chapterId=${chapterId}`,
    { signal }
  );
  return response.data;
};

export interface ChapterSlides {
  chapter_id: string;
  slides: Slide[];
}

// Bulk form of fetchSlidesByChapterId: every chapter of the package session in
// one round trip, grouped per chapter. Callers should fall back to per-chapter
// fetches when this fails (e.g. backend not yet deployed).
export const fetchSlidesByPackageSession = async (
  packageSessionId: string
): Promise<ChapterSlides[]> => {
  const response = await authenticatedAxiosInstance.get(
    `${GET_SLIDES_BY_PACKAGE_SESSION}?packageSessionId=${packageSessionId}`
  );
  // A non-array 200 (e.g. a gateway rewriting the response) must NOT count as
  // "course has no slides" — throw so callers run the per-chapter fallback.
  if (!Array.isArray(response.data)) {
    throw new Error("slides-by-package-session: unexpected response shape");
  }
  return response.data;
};

export const useSlides = (chapterId: string) => {
  const getSlidesQuery = useQuery({
    queryKey: ["slides", chapterId],
    queryFn: async () => {
      try {
        return await fetchSlidesOnline(chapterId);
      } catch (error) {
        // Offline (or genuinely unreachable) fallback (plan §B4): hydrate
        // from the last persisted manifest snapshot rather than surfacing an
        // error screen. Returns null (not []) when nothing is persisted, so
        // callers can still distinguish "no offline copy" from "empty chapter".
        const offlineSlides = await tryHydrateOffline(chapterId);
        if (offlineSlides) return offlineSlides;
        throw error;
      }
    },
    staleTime: 60_000,
  });

  return {
    slides: getSlidesQuery.data,
    isLoading: getSlidesQuery.isLoading,
    error: getSlidesQuery.error,
    refetch: getSlidesQuery.refetch,
  };
};

async function fetchSlidesOnline(chapterId: string) {
  const response = await authenticatedAxiosInstance.get(
    `${GET_SLIDES}?chapterId=${chapterId}`
  );

      // Debug: Log HTML_VIDEO slides to see their structure
      if (response.data && Array.isArray(response.data)) {
        const htmlVideoSlides = response.data.filter((slide: any) => 
          slide.source_type === 'HTML_VIDEO' || slide.source_type === 'html_video'
        );
        if (htmlVideoSlides.length > 0) {
          console.log('[useSlides] Found HTML_VIDEO slides:', {
            count: htmlVideoSlides.length,
            slides: htmlVideoSlides.map((slide: any) => ({
              id: slide.id,
              source_type: slide.source_type,
              title: slide.title,
              // Log all possible field names
              html_video_slide: slide.html_video_slide,
              htmlVideoSlide: slide.htmlVideoSlide,
              html_video: slide.html_video,
              htmlVideo: slide.htmlVideo,
              // Log all keys to see what's available
              allKeys: Object.keys(slide),
              // Log the entire slide object
              fullSlide: slide,
            })),
          });
        }
      }

      return response.data;
}

async function tryHydrateOffline(chapterId: string): Promise<Slide[] | null> {
  try {
    const [{ getUserId }, { getPackageSessionId }, { hydrateOfflineSlides }, { getOfflineDb }, { nodesDao }] =
      await Promise.all([
        import("@/constants/getUserId"),
        import("@/utils/study-library/get-list-from-stores/getPackageSessionId"),
        import("@/lib/offline/hydrate-slides"),
        import("@/lib/offline/db/connection"),
        import("@/lib/offline/db/dao/nodes-dao"),
      ]);
    const userId = await getUserId();
    if (!userId) return null;

    // Resolve the batch from the chapter the learner actually opened. This used
    // to come from Preferences' StudentDetails, which holds only the learner's
    // PRIMARY batch — so for anyone enrolled in more than one, opening a
    // downloaded chapter from a different course looked up the wrong manifest,
    // found nothing, and the viewer rendered "No content" over content sitting
    // on disk. The chapter's node row carries its own package_session_id.
    const db = await getOfflineDb();
    const chapterNode = await nodesDao.get(db, userId, chapterId);
    const packageSessionId = chapterNode?.package_session_id ?? (await getPackageSessionId());
    if (!packageSessionId) return null;

    return await hydrateOfflineSlides(userId, packageSessionId, chapterId);
  } catch {
    return null;
  }
}
