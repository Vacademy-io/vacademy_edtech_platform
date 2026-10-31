import type { TFunction } from "i18next";
import { getPublicUrlWithoutLogin } from "@/services/upload_file";
import { CourseDetailsFormValues } from "../-components/course-details-schema";
import { BatchForSessionType } from "@/types/institute-details/institute-details-interface";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, RoleTerms, SystemTerms } from "@/types/naming-settings";
import { authorRole } from "@/lib/course-author-role";

// Utility functions for YouTube URL handling
export function isYouTubeUrl(url: string): boolean {
  if (!url) return false;
  return /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/.test(url);
}

// Utility functions for Vimeo URL handling
export function isVimeoUrl(url: string): boolean {
  if (!url) return false;
  return /^(https?:\/\/)?(www\.)?(player\.)?vimeo\.com\/.+/.test(url);
}

export function getVimeoVideoId(url: string): string | null {
  if (!url) return null;
  const match = url.match(/(?:vimeo\.com\/(?:video\/)?|player\.vimeo\.com\/video\/)(\d+)/);
  return match ? match[1] : null;
}

interface SubjectType {
  id: string;
  subject_name: string;
  subject_code: string;
  credit: number;
  thumbnail_id: string | null;
  created_at: string | null;
  updated_at: string | null;
  subject_order: number;
  percentage_completed: number;
}

interface CourseWithSessionsType {
  course: {
    id: string;
    package_name: string;
    thumbnail_file_id: string;
    status: string;
    is_course_published_to_catalaouge: boolean;
    course_preview_image_media_id: string;
    course_banner_media_id: string;
    course_media_id: string;
    why_learn: string;
    who_should_learn: string;
    about_the_course: string;
    tags: string;
    course_depth: number;
    course_html_description: string;
    instructors?: Array<{
      id: string;
      username?: string;
      email: string;
      full_name?: string;
      name?: string;
      profile_pic_file_id?: string | null;
      author_subtitle?: string;
      author_description?: string;
      role_label?: string | null;
    }>;
  };
  sessions: Array<{
    level_with_details: Array<{
      id: string;
      name: string;
      duration_in_days: number;
      package_session_id?: string;
      read_time_in_minutes?: number;
      subjects: SubjectType[];
    }>;
    session_dto: {
      id: string;
      session_name: string;
      status: string;
      start_date: string;
    };
  }>;
}

const createDefaultSubject = (): SubjectType => ({
  id: "DEFAULT",
  subject_name: "DEFAULT",
  subject_code: "DEFAULT",
  credit: 0,
  thumbnail_id: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  subject_order: 0,
  percentage_completed: 0,
});

const tryGetPublicUrl = async (
  mediaId: string | null | undefined
): Promise<string> => {
  if (!mediaId || String(mediaId).trim() === "") return "";
  const trimmed = String(mediaId).trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  try {
    const url = await getPublicUrlWithoutLogin(mediaId);
    return url || "";
  } catch {
    return "";
  }
};

function isJson(str: string): boolean {
  try {
    const parsed = JSON.parse(str);
    return typeof parsed === "object" && parsed !== null;
  } catch {
    return false;
  }
}

/** Extract a direct http(s) URL from a value that may be a URL or JSON-wrapped (e.g. "\"https://...\""). */
function extractDirectUrl(value: string | null | undefined): string | null {
  if (!value || typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "string") return null;
    const unquoted = parsed.replace(/^["']|["']$/g, "").trim();
    if (/^https?:\/\//i.test(unquoted)) return unquoted;
  } catch {
    const unquoted = raw.replace(/^["']|["']$/g, "").trim();
    if (/^https?:\/\//i.test(unquoted)) return unquoted;
  }
  return null;
}

// `t` is optional so existing callers that don't pass a translator keep
// getting the English fallback unchanged; pass a `coursesRouteB` TFunction
// to localize the "Unknown Instructor" fallback.
export const transformApiDataToCourseData = async (
  apiData: CourseWithSessionsType,
  t?: TFunction
) => {
  if (!apiData) return null;

  try {
    const courseMediaImage = isJson(apiData.course.course_media_id)
      ? JSON.parse(apiData.course.course_media_id)
      : apiData.course.course_media_id;

    let coursePreviewImageMediaId = await tryGetPublicUrl(
      apiData.course.course_preview_image_media_id
    );
    let courseBannerMediaId = await tryGetPublicUrl(
      apiData.course.course_banner_media_id
    );
    const course = apiData.course as Record<string, unknown>;
    const directPreview =
      (course.course_preview_image_url as string) ??
      (course.coursePreviewImageUrl as string);
    const directBanner =
      (course.course_banner_image_url as string) ??
      (course.courseBannerImageUrl as string);
    if (!coursePreviewImageMediaId && directPreview)
      coursePreviewImageMediaId = directPreview;
    if (!courseBannerMediaId && directBanner)
      courseBannerMediaId = directBanner;

    let courseMediaPreview = "";
    const rawMediaId = apiData.course.course_media_id?.trim() ?? "";
    if (rawMediaId !== "") {
      const directMediaUrl = extractDirectUrl(apiData.course.course_media_id);
      if (directMediaUrl) {
        courseMediaPreview = directMediaUrl;
      } else if (isYouTubeUrl(apiData.course.course_media_id)) {
        courseMediaPreview = apiData.course.course_media_id;
      } else if (
        isJson(apiData.course.course_media_id) &&
        courseMediaImage.type === "youtube"
      ) {
        courseMediaPreview = courseMediaImage.id || "";
      } else {
        const mediaId = isJson(apiData.course.course_media_id)
          ? courseMediaImage.id
          : apiData.course.course_media_id;
        if (mediaId && mediaId.trim() !== "") {
          courseMediaPreview = await getPublicUrlWithoutLogin(mediaId);
        }
      }
    }

    // PATCH: handle tags as string or array
    let tags: string[] = [];
    if (Array.isArray(apiData.course.tags)) {
      tags = apiData.course.tags;
    } else if (typeof apiData.course.tags === "string") {
      tags = apiData.course.tags.split(",").map((tag: string) => tag.trim());
    }

    return {
      id: apiData.course.id,
      title: apiData.course.package_name,
      description: apiData.course.course_html_description || "", // Remove HTML tags
      tags,
      imageUrl: coursePreviewImageMediaId || "", // Use the preview image as the main image
      courseStructure: apiData.course.course_depth,
      whatYoullLearn: apiData.course.why_learn,
      whyLearn: apiData.course.why_learn,
      whoShouldLearn: apiData.course.who_should_learn,
      aboutTheCourse: apiData.course.about_the_course,
      packageName: apiData.course.package_name,
      status: apiData.course.status,
      isCoursePublishedToCatalaouge:
        apiData.course.is_course_published_to_catalaouge,
      coursePreviewImageMediaId,
      courseBannerMediaId,
      courseMediaId: courseMediaPreview,
      courseHtmlDescription: apiData.course.course_html_description,
      instructors:
        (await Promise.all((apiData.course.instructors || []).map(async (instructor) => ({
          id: instructor.id,
          email: instructor.email,
          profilePicUrl: await tryGetPublicUrl(instructor.profile_pic_file_id),
          authorSubtitle: instructor.author_subtitle,
          authorDescription: instructor.author_description,
          roleLabel: authorRole(instructor),
          name:
            instructor.full_name ||
            instructor.name ||
            instructor.username ||
            (t
              ? t("courseDetailsPage.unknownInstructor", {
                  instructor: getTerminology(RoleTerms.Teacher, SystemTerms.Teacher),
                })
              : "Unknown Instructor"),
        })))),
      sessions: apiData.sessions.map((session) => ({
        levelDetails: session.level_with_details.map((level) => {
          // For course structure 4, add a default subject if no subjects exist
          let subjects = level.subjects;
          if (apiData.course.course_depth === 4) {
            if (!subjects || subjects.length === 0) {
              subjects = [createDefaultSubject()];
            }
          }

          return {
            id: level.id,
            name: level.name,
            duration_in_days: level.duration_in_days,
            package_session_id: level.package_session_id,
            subjects: subjects.map((subject) => ({
              id: subject.id,
              subject_name: subject.subject_name,
              subject_code: subject.subject_code,
              credit: subject.credit,
              thumbnail_id: subject.thumbnail_id,
              created_at: subject.created_at,
              updated_at: subject.updated_at,
              modules: [],
            })),
          };
        }),
        sessionDetails: {
          id: session.session_dto.id,
          session_name: session.session_dto.session_name,
          status: session.session_dto.status,
          start_date: session.session_dto.start_date,
        },
      })),
    };
  } catch (error) {
    console.error("Error getting public URLs:", error);
    return null;
  }
};

export function getSubjectDetails(
  courseData: CourseDetailsFormValues,
  currentSessionId: string,
  currentLevelId: string
): SubjectType[] {
  const sessions = courseData?.courseData?.sessions;
  if (!Array.isArray(sessions)) return [];

  const session = sessions.find(
    (s) => s?.sessionDetails?.id === currentSessionId
  );

  if (!session) return [];

  const levelDetails = session.levelDetails;
  if (!Array.isArray(levelDetails)) return [];

  const level = levelDetails.find((l) => l?.id === currentLevelId);

  if (!level || !level?.subjects) return [];

  return level.subjects.map(
    (subject, index): SubjectType => ({
      id: subject.id,
      subject_name: subject.subject_name,
      subject_code: subject.subject_code,
      credit: subject.credit ?? 0,
      thumbnail_id: subject.thumbnail_id ?? null,
      created_at: subject.created_at ?? null,
      updated_at: subject.updated_at ?? null,
      subject_order: index, // fallback if undefined
      percentage_completed: 0, // default initial value
    })
  );
}

export function getIdByLevelAndSession(
  data: BatchForSessionType[],
  sessionId: string,
  levelId: string,
  courseId: string
) {
  if (import.meta.env.MODE !== "production") {
    try {
      console.info("[getIdByLevelAndSession] inputs", {
        sessionId,
        levelId,
        courseId,
        total: data?.length || 0,
      });
    } catch {
      // noop
    }
  }

  const match = data?.find(
    (item) =>
      item.level?.id === levelId &&
      item.session?.id === sessionId &&
      item.package_dto?.id === courseId
  );

  if (import.meta.env.MODE !== "production") {
    try {
      if (!match) {
        const debug = (data || []).slice(0, 10).map((item) => ({
          id: item.id,
          levelIdCandidate: item.level?.id,
          sessionIdCandidate: item.session?.id,
          courseIdCandidate: item.package_dto?.id,
          levelMatch: item.level?.id === levelId,
          sessionMatch: item.session?.id === sessionId,
          courseMatch: item.package_dto?.id === courseId,
        }));
        const counts = {
          sameCourse: (data || []).filter((i) => i.package_dto?.id === courseId)
            .length,
          sameSession: (data || []).filter((i) => i.session?.id === sessionId)
            .length,
          sameLevel: (data || []).filter((i) => i.level?.id === levelId).length,
        };
        console.info("[getIdByLevelAndSession] no exact match", {
          counts,
          sample: debug,
        });
      } else {
        console.info("[getIdByLevelAndSession] match", { id: match.id });
      }
    } catch {
      // noop
    }
  }

  return match?.id || "";
}

/** Check if selected session+level has child subgroups (batches with name) */
export function hasChildSubgroups(
  batches: BatchForSessionType[],
  sessionId: string,
  levelId: string,
  courseId: string
): boolean {
  if (!batches?.length || !sessionId || !levelId) return false;
  return batches.some(
    (b) =>
      b.session?.id === sessionId &&
      b.level?.id === levelId &&
      (b.package_dto?.id === courseId || !b.package_dto?.id) &&
      (b.is_parent === false || b.parent_id != null) &&
      (b.name?.trim?.() || (b as { package_session_name?: string }).package_session_name?.trim?.())
  );
}

/** Get batch options for Session+Level dropdown (parent + children with names) */
export function getBatchOptionsForSessionLevel(
  batches: BatchForSessionType[],
  sessionId: string,
  levelId: string,
  courseId: string
): { id: string; label: string; isParent: boolean }[] {
  if (!batches?.length || !sessionId || !levelId) return [];
  const matching = batches.filter(
    (b) =>
      b.session?.id === sessionId &&
      b.level?.id === levelId &&
      (b.package_dto?.id === courseId || !b.package_dto?.id)
  );
  return matching.map((b) => {
    const name = b.name?.trim?.() || (b as { package_session_name?: string }).package_session_name?.trim?.();
    const isParent = b.is_parent === true;
    const batchFallback = getTerminology(ContentTerms.Batch, SystemTerms.Batch);
    const label = name || (isParent ? `Parent ${batchFallback.toLowerCase()}` : b.package_dto?.package_name || b.level?.level_name || batchFallback);
    return { id: b.id, label: isParent && !name ? `${label} (Parent)` : label, isParent };
  });
}

/** Resolve packageSessionId: use selectedBatchId when provided and valid; otherwise session+level mapping (prefer parent) */
export function resolvePackageSessionId(
  batches: BatchForSessionType[],
  sessionId: string,
  levelId: string,
  courseId: string,
  selectedBatchId?: string | null
): string {
  if (selectedBatchId) {
    const found = batches.find(
      (b) =>
        b.id === selectedBatchId &&
        b.session?.id === sessionId &&
        b.level?.id === levelId &&
        (b.package_dto?.id === courseId || !b.package_dto?.id)
    );
    if (found) return found.id;
  }
  const matches = (batches || []).filter(
    (b) =>
      b.session?.id === sessionId &&
      b.level?.id === levelId &&
      (b.package_dto?.id === courseId || !b.package_dto?.id)
  );
  if (matches.length === 0) return "";
  const parent = matches.find((b) => b.is_parent === true);
  return (parent || matches[0]).id;
}

export function getYouTubeVideoId(url: string): string | null {
  if (!url) return null;

  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
    /youtube\.com\/watch\?.*v=([^&\n?#]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  return null;
}

export function convertToYouTubeEmbedUrl(url: string): string {
  const videoId = getYouTubeVideoId(url);
  if (!videoId) return url;

  return `https://www.youtube.com/embed/${videoId}`;
}
