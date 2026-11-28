import { SubjectType } from '@/stores/study-library/use-study-library-store';
import { getPublicUrl } from '@/services/upload_file';
import { convertCapitalToTitleCase } from '@/lib/utils';

type DataItem = {
    total_read_time_minutes: number | null;
    slide_count: number;
    source_type: string;
};

export interface Instructor {
    id: string;
    username: string;
    email: string;
    full_name: string;
    address_line: string | null;
    city: string | null;
    region: string | null;
    pin_code: string | null;
    mobile_number: string | null;
    date_of_birth: string | null;
    gender: string | null;
    password: string | null;
    profile_pic_file_id: string | null;
    author_subtitle?: string;
    author_description?: string;
    /** This person's display role in this course; absent when none is set. */
    role_label?: string;
    roles: string[];
    root_user: boolean;
}

export interface Session {
    session_dto: {
        id: string;
        session_name: string;
        status: string;
        start_date: string;
        new_session: boolean;
    };
    level_with_details: Array<{
        id: string;
        name: string;
        duration_in_days: number;
        instructors: Instructor[];
        subjects: SubjectType[];
        new_level: boolean;
    }>;
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
        /** Course page extras JSON string; null when nothing is stored (course-init only). */
        course_page_json?: string | null;
    };
    sessions: Session[];
}

const createDefaultSubject = (): SubjectType => ({
    id: 'DEFAULT',
    subject_name: 'DEFAULT',
    subject_code: 'DEFAULT',
    credit: 0,
    thumbnail_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
});

function isJson(str: string): boolean {
    try {
        const parsed = JSON.parse(str);
        return typeof parsed === 'object' && parsed !== null;
    } catch {
        return false;
    }
}

// Detect whether a resolved media URL points at a video, so a legacy bare
// file-id (stored by flows that saved a plain id instead of the {type,id}
// JSON) still renders in the correct player on edit. Defaults to image.
function isVideoUrl(url: string): boolean {
    return /\.(mp4|mov|m4v|webm|avi|ogg|ogv|mkv)(\?|#|$)/i.test(url);
}

function isYouTubeUrl(url: string): boolean {
    return /(?:youtube\.com|youtu\.be)/i.test(url);
}

// Normalize course_media_id into the {type,id} shape the edit dialog expects.
// The stored value is inconsistent across historical flows, so tolerate all of:
//   - {"type":"...","id":"..."} JSON  (AddCourseStep1 — the canonical shape)
//   - a bare YouTube watch/share URL   (older youtube saves)
//   - a JSON-quoted or raw media URL   (AI/bulk flows: "https://.../foo.jpg")
//   - a bare uploaded file id          (package edit, bulk create)
// Without this, any non-{type,id} value collapses to {type:'',id:''} and the
// media shows an empty upload box on edit; worse, a bare YouTube URL would be
// treated as an image and render as a broken <img>. We map each to the right
// type so the dialog renders the correct player (iframe / video / img).
function resolveCourseMediaId(
    rawCourseMediaId: string | null | undefined,
    resolvedPreviewUrl: string
): { type: string; id: string } {
    let raw = (rawCourseMediaId ?? '').trim();
    if (!raw || raw === 'null' || raw === 'undefined') return { type: '', id: '' };

    // Canonical {type,id} JSON.
    if (isJson(raw)) {
        const parsed = JSON.parse(raw);
        return { type: parsed?.type ?? '', id: parsed?.id ?? '' };
    }

    // Bare value. Strip any surrounding quotes (JSON-encoded string) so the id
    // round-trips cleanly — getPublicUrl / extractYouTubeVideoId do the same.
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
        raw = raw.slice(1, -1);
    }
    if (!raw || raw === 'null' || raw === 'undefined') return { type: '', id: '' };

    if (isYouTubeUrl(raw)) return { type: 'youtube', id: raw };
    return {
        type: isVideoUrl(raw) || isVideoUrl(resolvedPreviewUrl) ? 'video' : 'image',
        id: raw,
    };
}

export const transformApiDataToCourseData = async (apiData: CourseWithSessionsType) => {
    if (!apiData) return null;

    // Local cache for fileId -> publicUrl
    const fileUrlCache: Record<string, string> = {};
    async function getUrlOnce(fileId: string | null | undefined): Promise<string> {
        if (!fileId) return '';
        if (fileUrlCache[fileId] !== undefined) return fileUrlCache[fileId] ?? '';
        try {
            const url = (await getPublicUrl(fileId)) ?? '';
            fileUrlCache[fileId] = url;
            return url;
        } catch (error) {
            // If media files are missing or GET_PUBLIC_URL fails (e.g., 404),
            // don't fail the entire course-init transform. Just log and fall
            // back to an empty URL so the rest of the course data (sessions,
            // levels, subjects) can still render.
            console.error('Error fetching public URL for fileId', fileId, error);
            fileUrlCache[fileId] = '';
            return '';
        }
    }

    try {
        const courseMediaImage = isJson(apiData.course.course_media_id)
            ? JSON.parse(apiData.course.course_media_id)
            : apiData.course.course_media_id;

        const coursePreviewImageMediaId = await getUrlOnce(
            apiData.course.course_preview_image_media_id ?? ''
        );
        const courseBannerMediaId = await getUrlOnce(apiData.course.course_banner_media_id ?? '');

        let courseMediaPreview = '';
        if (isJson(apiData.course.course_media_id) && courseMediaImage.type === 'youtube') {
            courseMediaPreview = courseMediaImage.id;
        } else {
            courseMediaPreview = await getUrlOnce(
                isJson(apiData.course.course_media_id)
                    ? courseMediaImage.id ?? ''
                    : apiData.course.course_media_id ?? ''
            );
        }

        return {
            id: apiData.course.id,
            title: convertCapitalToTitleCase(apiData.course.package_name),
            description: apiData.course.course_html_description, // Remove HTML tags
            tags: apiData.course.tags?.split(',').map((tag) => tag.trim()) || [],
            imageUrl: '', // Use the preview image as the main image
            courseStructure: apiData.course.course_depth,
            whatYoullLearn: apiData.course.why_learn,
            whyLearn: apiData.course.why_learn,
            whoShouldLearn: apiData.course.who_should_learn,
            aboutTheCourse: apiData.course.about_the_course,
            packageName: convertCapitalToTitleCase(apiData.course.package_name),
            status: apiData.course.status,
            isCoursePublishedToCatalaouge: apiData.course.is_course_published_to_catalaouge,
            coursePreviewImageMediaId: apiData.course.course_preview_image_media_id,
            courseBannerMediaId: apiData.course.course_banner_media_id,
            courseMediaId: resolveCourseMediaId(apiData.course.course_media_id, courseMediaPreview),
            coursePreviewImageMediaPreview: coursePreviewImageMediaId,
            courseBannerMediaPreview: courseBannerMediaId,
            courseMediaPreview: courseMediaPreview ?? '',
            courseHtmlDescription: apiData.course.course_html_description,
            // Raw string (or null/undefined when nothing is stored or the payload does not
            // load it) — parsed by the edit form; only a string lets an edit clear it.
            coursePageJson: apiData.course.course_page_json,
            instructors: [], // This should be populated from your API if available
            sessions: (Array.isArray(apiData.sessions) ? apiData.sessions : []).map((session) => ({
                levelDetails: (Array.isArray(session.level_with_details)
                    ? session.level_with_details
                    : []
                ).map((level) => {
                    // For course structure 4, add a default subject if no subjects exist
                    let subjects = level.subjects;
                    if (apiData.course.course_depth === 4) {
                        if (!subjects || (Array.isArray(subjects) && subjects.length === 0)) {
                            subjects = [createDefaultSubject()];
                        }
                    }

                    return {
                        id: level.id,
                        name: convertCapitalToTitleCase(level.name),
                        duration_in_days: level.duration_in_days,
                        newLevel: level.new_level,
                        instructors: (Array.isArray(level.instructors)
                            ? level.instructors.filter(Boolean)
                            : []
                        ).map((inst) => ({
                            id: inst.id,
                            name: inst.full_name,
                            email: inst.email,
                            profilePicId: inst.profile_pic_file_id,
                            roles: inst.roles,
                            authorSubtitle: inst.author_subtitle,
                            authorDescription: inst.author_description,
                            roleLabel: inst.role_label || undefined,
                        })),
                        subjects: (Array.isArray(subjects) ? subjects : []).map((subject) => ({
                            id: subject.id,
                            subject_name: convertCapitalToTitleCase(subject.subject_name),
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
                    session_name: convertCapitalToTitleCase(session.session_dto.session_name),
                    status: session.session_dto.status,
                    start_date: session.session_dto.start_date,
                    newSession: session.session_dto.new_session,
                },
            })),
        };
    } catch (error) {
        console.error('Error getting public URLs:', error);
        return null;
    }
};

export const transformApiDataToCourseDataForInvite = async (apiData: CourseWithSessionsType) => {
    if (!apiData) return null;

    // Local cache for fileId -> publicUrl
    const fileUrlCache: Record<string, string> = {};
    async function getUrlOnce(fileId: string | null | undefined): Promise<string> {
        if (!fileId) return '';
        if (fileUrlCache[fileId] !== undefined) return fileUrlCache[fileId] ?? '';
        try {
            const url = (await getPublicUrl(fileId)) ?? '';
            fileUrlCache[fileId] = url;
            return url;
        } catch (error) {
            console.error('Error fetching public URL for fileId (invite)', fileId, error);
            fileUrlCache[fileId] = '';
            return '';
        }
    }

    try {
        const courseMediaImage = isJson(apiData.course.course_media_id)
            ? JSON.parse(apiData.course.course_media_id)
            : apiData.course.course_media_id;

        const coursePreviewImageMediaId = await getUrlOnce(
            apiData.course.course_preview_image_media_id ?? ''
        );
        const courseBannerMediaId = await getUrlOnce(apiData.course.course_banner_media_id ?? '');

        let courseMediaPreview = '';
        if (isJson(apiData.course.course_media_id) && courseMediaImage.type === 'youtube') {
            courseMediaPreview = courseMediaImage.id;
        } else {
            courseMediaPreview = await getUrlOnce(
                isJson(apiData.course.course_media_id)
                    ? courseMediaImage.id ?? ''
                    : apiData.course.course_media_id ?? ''
            );
        }

        return {
            id: apiData.course.id,
            title: apiData.course.package_name,
            description: apiData.course.course_html_description, // Remove HTML tags
            tags: apiData.course.tags?.split(',').map((tag) => tag.trim()) || [],
            imageUrl: '', // Use the preview image as the main image
            courseStructure: apiData.course.course_depth,
            whatYoullLearn: apiData.course.why_learn,
            whyLearn: apiData.course.why_learn,
            whoShouldLearn: apiData.course.who_should_learn,
            aboutTheCourse: apiData.course.about_the_course,
            packageName: apiData.course.package_name,
            coursePreviewImageMediaId: apiData.course.course_preview_image_media_id,
            courseBannerMediaId: apiData.course.course_banner_media_id,
            courseMediaId: resolveCourseMediaId(apiData.course.course_media_id, courseMediaPreview),
            coursePreviewImageMediaPreview: coursePreviewImageMediaId,
            courseBannerMediaPreview: courseBannerMediaId,
            courseMediaPreview: courseMediaPreview ?? '',
        };
    } catch (error) {
        console.error('Error getting public URLs:', error);
        return null;
    }
};

// Function to get instructors by sessionId and levelId
export function getInstructorsBySessionAndLevel(
    sessionsData: Session[],
    sessionId: string,
    levelId: string
) {
    if (!sessionsData) return [];
    for (const session of sessionsData) {
        if (session.session_dto.id === sessionId) {
            for (const level of session.level_with_details) {
                if (level.id === levelId) {
                    return (level.instructors || []).filter(Boolean).map((inst: Instructor) => ({
                        id: inst.id,
                        name: inst.full_name,
                        email: inst.email,
                        profilePicId: inst.profile_pic_file_id || '',
                        authorSubtitle: inst.author_subtitle,
                        authorDescription: inst.author_description,
                        roleLabel: inst.role_label || undefined,
                    }));
                }
            }
        }
    }
    return [];
}

export function calculateTotalTimeForCourseDuration(data: DataItem[]): {
    hours: number;
    minutes: number;
} {
    if (!data) return { hours: 0, minutes: 0 };
    const totalMinutes = data.reduce((sum, item) => {
        return sum + (item.total_read_time_minutes ?? 0);
    }, 0);

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    return { hours, minutes };
}
