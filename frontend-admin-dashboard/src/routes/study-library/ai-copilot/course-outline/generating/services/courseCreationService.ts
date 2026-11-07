import type { TFunction } from 'i18next';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { getInstituteId } from '@/constants/helper';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import {
    ADD_COURSE,
    ADD_SUBJECT,
    ADD_MODULE,
    ADD_CHAPTER,
    ADD_UPDATE_DOCUMENT_SLIDE,
    ADD_UPDATE_VIDEO_SLIDE,
    ADD_UPDATE_HTML_VIDEO_SLIDE,
    ADD_UPDATE_QUIZ_SLIDE,
    GET_COURSE_BATCHES,
} from '@/constants/urls';
import { SlideGeneration, SessionProgress } from '../../../shared/types';
import { fetchInstituteDetails } from '@/services/student-list-section/getInstituteDetails';
import { BatchForSessionType } from '@/schemas/student/student-list/institute-schema';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey, type IAccessToken } from '@/constants/auth/tokens';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { markdownToHtml } from '../../../shared/utils/markdownToHtml';

interface CreateCourseParams {
    courseName: string;
    durationInDays?: number;
    sessions: SessionProgress[];
    status?: 'ACTIVE' | 'DRAFT';
    levelId?: string; // levelId to use for the course
    courseMetadata?: {
        aboutCourse?: string;
        learningOutcome?: string;
        targetAudience?: string;
        description?: string;
        coursePreview?: string;
        courseBanner?: string;
        courseMedia?: any;
        tags?: string[];
        levelStructure?: number;
    };
}

interface CreateCourseResult {
    courseId: string;
    packageSessionIds: string;
    subjectId: string;
    moduleId: string;
    chapterIds: string[];
}

/**
 * Helper function to find package session IDs by package ID
 */
function findIdByPackageId(data: BatchForSessionType[], packageId: string): string {
    return data
        .filter((item) => item.package_dto?.id === packageId)
        .map((item) => item.id)
        .join(',');
}

// This is a plain service function (not a component/hook), so it cannot call
// useTranslation() itself — the guide's convention is to thread the caller's
// `t` in as a parameter. `t` is optional here because this service is also
// invoked from a sibling file (useCourseCreation.ts) that is wired for i18n
// in a separate batch of this rollout; until that caller passes its own
// `t`, this fallback resolves each call's defaultValue string so behavior
// (and the English copy) stays exactly as before.
const fallbackT: TFunction = ((
    _key: string,
    defaultValue?: unknown,
    _options?: unknown
) => (typeof defaultValue === 'string' ? defaultValue : String(_key))) as unknown as TFunction;

/**
 * Creates a course with all its content
 * Flow: Create Course -> Get PackageSessionIds -> Create Subject -> Module -> Chapters -> Slides
 */
export async function createCourseWithContent(
    params: CreateCourseParams,
    t: TFunction = fallbackT
): Promise<CreateCourseResult> {
    const { courseName, sessions, courseMetadata, levelId } = params;

    // Remove unused variable
    // const instituteId = getInstituteId(); // Not needed, using INSTITUTE_ID instead

    // Step 1: Create Course (Package)
    // Get INSTITUTE_ID - use getCurrentInstituteId which handles localStorage and token fallback
    let INSTITUTE_ID = getCurrentInstituteId();

    // Fallback to getInstituteId if getCurrentInstituteId fails
    if (!INSTITUTE_ID) {
        INSTITUTE_ID = getInstituteId();
    }

    // Get token data for user info and institute ID
    const accessToken = getTokenFromCookie(TokenKey.accessToken);
    if (!accessToken) {
        throw new Error(
            t('courseCreation.errors.accessTokenNotFound', 'Access token not found. Please log in again.')
        );
    }

    const tokenData = getTokenDecodedData(accessToken);
    if (!tokenData) {
        throw new Error(
            t('courseCreation.errors.tokenDecodeFailed', 'Failed to decode token data. Please log in again.')
        );
    }

    // If INSTITUTE_ID not found yet, try to get from token
    if (!INSTITUTE_ID && tokenData.authorities) {
        INSTITUTE_ID = Object.keys(tokenData.authorities)[0];
    }

    if (!INSTITUTE_ID) {
        throw new Error(
            t(
                'courseCreation.errors.instituteIdNotFound',
                'Institute ID not found. Please ensure you are logged in and have selected an institute.'
            )
        );
    }

    // Get user data for approval workflow
    const isAdmin =
        tokenData?.authorities &&
        Object.values(tokenData.authorities).some((auth: any) => auth?.roles?.includes('ADMIN'));

    // Helper function to validate file IDs (should be UUIDs, not filenames)
    // Helper function to validate file IDs (should be UUIDs, not filenames, but we also allow URLs now)
    const isValidFileId = (fileId: string | undefined | null): boolean => {
        if (!fileId || typeof fileId !== 'string') return false;
        if (fileId.trim() === '') return false;

        // We accept any non-empty string as a potential ID or URL to ensure we don't block valid values
        // ideally checking for UUID or URL format, but backend might accept other formats or we might need to debug what's being passed
        return true;
    };

    const isUuid = (id: string) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

    const previewImage =
        courseMetadata?.coursePreview && isValidFileId(courseMetadata.coursePreview)
            ? courseMetadata.coursePreview
            : '';
    const bannerImage =
        courseMetadata?.courseBanner && isValidFileId(courseMetadata.courseBanner)
            ? courseMetadata.courseBanner
            : '';

    // Build add_faculty_to_course in same shape as study-library add-course (convertToApiCourseFormat)
    // so instructor names show correctly. Use current logged-in user from token.
    const currentUserId = tokenData?.user || '';
    const token = tokenData as IAccessToken | undefined;
    const addFacultyToCourse =
        currentUserId && token?.email != null
            ? [
                {
                    user: {
                        id: currentUserId,
                        username: token?.username ?? '',
                        email: token?.email ?? '',
                        full_name: token?.fullname ?? token?.username ?? '',
                        address_line: '',
                        city: '',
                        region: '',
                        pin_code: '',
                        mobile_number: '',
                        date_of_birth: '',
                        gender: '',
                        password: '',
                        profile_pic_file_id: '',
                        roles: [],
                        root_user: true,
                    },
                    new_user: false,
                },
            ]
            : [];

    const coursePayload = {
        id: '',
        new_course: true, // Required by backend - indicates this is a new course
        // AI course names are deterministic (derived from the source material),
        // so without this the backend would find the previous run's same-named
        // course and silently append the new chapters into it. TRUE = always
        // create a fresh course, uniquifying the name with " (n)" if taken.
        force_new_course: true,
        course_name: courseName,
        // Only use UUID for thumbnail_file_id as it strictly expects a file ID
        thumbnail_file_id: isUuid(previewImage) ? previewImage : '',
        contain_levels: !!levelId, // true when using existing level, false when creating DEFAULT
        // Course metadata fields
        about_the_course_html: courseMetadata?.aboutCourse || '',
        why_learn_html: courseMetadata?.learningOutcome || '',
        who_should_learn_html: courseMetadata?.targetAudience || '',
        course_html_description: courseMetadata?.description || '',
        course_preview_image_media_id: previewImage,
        course_banner_media_id: bannerImage,
        course_media_id: courseMetadata?.courseMedia
            ? JSON.stringify(courseMetadata.courseMedia)
            : '',
        tags: courseMetadata?.tags || [],
        course_depth: courseMetadata?.levelStructure || 2,
        // Required fields for course creation
        status: params.status || (isAdmin ? 'ACTIVE' : 'DRAFT'),
        created_by_user_id: currentUserId,
        original_course_id: null,
        version_number: 1,
        is_course_published_to_catalaouge: true,
        sessions: [
            {
                id: 'DEFAULT',
                session_name: 'DEFAULT',
                status: 'ACTIVE',
                start_date: '',
                new_session: !levelId, // false when using existing level, true when creating new
                levels: [
                    {
                        id: levelId || 'DEFAULT',
                        new_level: !levelId, // false when using existing level, true when creating DEFAULT
                        level_name: levelId ? undefined : 'DEFAULT', // Only set level_name for new levels
                        duration_in_days: 0,
                        thumbnail_file_id: '',
                        package_id: '',
                        add_faculty_to_course: addFacultyToCourse,
                        group: {
                            id: 'DEFAULT',
                            group_name: 'DEFAULT',
                            group_value: '',
                            new_group: true,
                        },
                    },
                ],
            },
        ],
    };

    if (setCreationProgress) {
        setCreationProgress(t('courseCreation.progress.creatingCourse', 'Creating course...'));
    }

    // Debug logging
    console.log('[Course Creation] INSTITUTE_ID:', INSTITUTE_ID);
    console.log('[Course Creation] Course payload:', coursePayload);
    console.log('[Course Creation] API URL:', `${ADD_COURSE}/${INSTITUTE_ID}`);
    console.log('[Course Creation] Access token found, length:', accessToken.length);

    try {
        let courseResponse;
        try {
            courseResponse = await authenticatedAxiosInstance.post(
                `${ADD_COURSE}/${INSTITUTE_ID}`,
                coursePayload
            );
        } catch (error: any) {
            // Log detailed error information
            console.error('[Course Creation] API Error Details:', {
                status: error?.response?.status,
                statusText: error?.response?.statusText,
                data: error?.response?.data,
                url: error?.config?.url,
                method: error?.config?.method,
                headers: error?.config?.headers,
            });

            // Check if it's a 511 error that might actually be a backend error
            if (error?.response?.status === 511) {
                const responseData = error.response?.data;
                console.error('[Course Creation] 511 Response Data:', responseData);

                // Check if it's actually a backend error message disguised as 511
                if (responseData?.ex || responseData?.responseCode || responseData?.message) {
                    const backendError =
                        responseData.ex || responseData.responseCode || responseData.message;
                    console.error('[Course Creation] Backend error (511):', backendError);
                    // Don't logout on backend errors - just throw the error
                    throw new Error(
                        t('courseCreation.errors.backendError', 'Backend Error: {{message}}', {
                            message: backendError,
                        })
                    );
                }

                // If it's a real 511, check if INSTITUTE_ID is valid
                if (!INSTITUTE_ID || INSTITUTE_ID === 'undefined' || INSTITUTE_ID === 'null') {
                    throw new Error(
                        t(
                            'courseCreation.errors.invalidInstituteId',
                            'Invalid Institute ID: {{instituteId}}. Please ensure you are logged in and have selected an institute.',
                            { instituteId: INSTITUTE_ID }
                        )
                    );
                }

                // If it's a real 511 with valid INSTITUTE_ID, provide more context
                throw new Error(
                    t(
                        'courseCreation.errors.networkAuthRequired',
                        'Network authentication required. Please check your connection or contact support. INSTITUTE_ID: {{instituteId}}',
                        { instituteId: INSTITUTE_ID }
                    )
                );
            }

            // For other errors, provide the error message
            const errorMessage =
                error?.response?.data?.ex ||
                error?.response?.data?.message ||
                error?.message ||
                t('courseCreation.errors.unknownError', 'Unknown error');
            throw new Error(
                t('courseCreation.errors.createCourseFailed', 'Failed to create course: {{message}}', {
                    message: errorMessage,
                })
            );
        }

        const courseId =
            courseResponse.data?.id || courseResponse.data?.data || courseResponse.data;
        console.log('[Course Creation] Course created successfully, courseId:', courseId);
        console.log('[Course Creation] Full response data:', courseResponse.data);
        if (!courseId) {
            throw new Error(
                t('courseCreation.errors.noCourseIdReturned', 'Failed to create course: No course ID returned')
            );
        }

        // Step 2: Get Package Session IDs for the created course
        if (setCreationProgress) {
            setCreationProgress(t('courseCreation.progress.fetchingCourseDetails', 'Fetching course details...'));
        }

        let packageSessionIds = '';

        try {
            // First try to directly fetch the batches for the created course
            // The course creation might process asynchronously, so a small delay helps
            await new Promise((resolve) => setTimeout(resolve, 1500));
            const batchesResponse = await authenticatedAxiosInstance.get(
                `${GET_COURSE_BATCHES}/${courseId}/batches`
            );

            if (batchesResponse.data && batchesResponse.data.length > 0) {
                packageSessionIds = batchesResponse.data.map((batch: any) => batch.id).join(',');
                console.log('[Course Creation] Got packageSessionIds directly from course batches API:', packageSessionIds);
            }
        } catch (error) {
            console.warn('[Course Creation] Failed to get course batches directly, falling back to institute details:', error);
        }

        // Fallback logic if direct fetching fails
        if (!packageSessionIds) {
            let batchesForSessions: BatchForSessionType[] = [];

            try {
                // Try to get from store first
                const storeState = useInstituteDetailsStore.getState();
                if (storeState.instituteDetails?.batches_for_sessions) {
                    batchesForSessions = storeState.instituteDetails.batches_for_sessions;
                } else {
                    // If not in store, fetch from API
                    const instituteDetails = await fetchInstituteDetails();
                    batchesForSessions = instituteDetails?.batches_for_sessions || [];
                }
            } catch (error) {
                console.warn('Failed to fetch institute details, trying alternative approach:', error);
                // If fetch fails, try to get from store as fallback
                const storeState = useInstituteDetailsStore.getState();
                batchesForSessions = storeState.instituteDetails?.batches_for_sessions || [];
            }

            if (!batchesForSessions || batchesForSessions.length === 0) {
                throw new Error(
                    t(
                        'courseCreation.errors.instituteDetailsNotLoaded',
                        'Institute details not loaded. Please refresh the page and try again.'
                    )
                );
            }

            // Step 3: Find Package Session IDs for the created course
            packageSessionIds = findIdByPackageId(batchesForSessions, courseId);

            if (!packageSessionIds) {
                // If not found immediately, wait a bit and retry (course might need a moment to be fully created)
                if (setCreationProgress) {
                    setCreationProgress(
                        t('courseCreation.progress.waitingForCourse', 'Waiting for course to be fully created...')
                    );
                }
                await new Promise((resolve) => setTimeout(resolve, 2000));

                // Try fetching again to get updated batches
                try {
                    const instituteDetails = await fetchInstituteDetails();
                    const updatedBatches = instituteDetails?.batches_for_sessions || batchesForSessions;
                    packageSessionIds = findIdByPackageId(updatedBatches, courseId);
                } catch (error) {
                    console.warn('Failed to refetch institute details:', error);
                }

                if (!packageSessionIds) {
                    throw new Error(
                        t(
                            'courseCreation.errors.packageSessionIdsNotFound',
                            'Package session IDs not found for the created course. The course may need a moment to be fully created. Please try again in a few seconds.'
                        )
                    );
                }
            }
        }

        // Step 4: Create Subject
        if (setCreationProgress) {
            setCreationProgress(t('courseCreation.progress.creatingSubject', 'Creating subject...'));
        }
        console.log('[Course Creation] Creating subject:', courseName);
        const subjectPayload = {
            id: crypto.randomUUID(),
            subject_name: courseName,
            subject_code: courseName.substring(0, 3).toUpperCase(),
            credit: 0,
            thumbnail_id: null,
            created_at: '',
            updated_at: '',
        };

        const subjectResponse = await authenticatedAxiosInstance.post(
            `${ADD_SUBJECT}?commaSeparatedPackageSessionIds=${packageSessionIds}`,
            subjectPayload
        );

        const subjectId = subjectResponse.data?.id || subjectResponse.data?.data?.id;
        console.log('[Course Creation] Subject response:', subjectResponse.data);
        if (!subjectId) {
            throw new Error(
                t('courseCreation.errors.noSubjectIdReturned', 'Failed to create subject: No subject ID returned')
            );
        }
        console.log('[Course Creation] Subject created successfully:', subjectId);

        // Step 5: Create Module
        if (setCreationProgress) {
            setCreationProgress(t('courseCreation.progress.creatingModule', 'Creating module...'));
        }
        console.log('[Course Creation] Creating module...');
        const modulePayload = {
            id: crypto.randomUUID(),
            module_name: 'Module 1',
            status: 'ACTIVE',
            description: '',
            thumbnail_id: null,
        };

        const moduleResponse = await authenticatedAxiosInstance.post(
            `${ADD_MODULE}?subjectId=${subjectId}&packageSessionId=${packageSessionIds}`,
            modulePayload
        );

        const moduleId = moduleResponse.data?.id || moduleResponse.data?.data?.id;
        console.log('[Course Creation] Module response:', moduleResponse.data);
        if (!moduleId) {
            throw new Error(
                t('courseCreation.errors.noModuleIdReturned', 'Failed to create module: No module ID returned')
            );
        }
        console.log('[Course Creation] Module created successfully:', moduleId);

        // Step 6: Create Chapters and Slides for each session
        // Chapters are created sequentially (need ordered IDs), but slides within
        // each chapter are created in parallel for ~4× speedup.
        if (setCreationProgress) {
            setCreationProgress(
                t('courseCreation.progress.creatingChaptersAndSlides', 'Creating chapters and slides...')
            );
        }
        const chapterIds: string[] = [];

        console.log(`[Course Creation] Creating ${sessions.length} chapters with slides (parallel slide creation)...`);

        for (let sessionIndex = 0; sessionIndex < sessions.length; sessionIndex++) {
            const session = sessions[sessionIndex];
            if (!session) continue;

            // Skip sessions that have no real slides (only placeholders or completely empty)
            const realSlides = session.slides.filter(
                (s) => s && s.slideTitle !== '_placeholder_'
            );
            if (realSlides.length === 0) {
                console.log(
                    `[Course Creation] Skipping empty session "${session.sessionTitle}" (no real slides)`
                );
                continue;
            }

            console.log(
                `[Course Creation] Processing session ${sessionIndex + 1}/${sessions.length}: "${session.sessionTitle}" with ${realSlides.length} slides`
            );

            // Create Chapter
            const chapterPayload = {
                id: crypto.randomUUID(),
                chapter_name: session.sessionTitle,
                status: 'ACTIVE',
                file_id: null,
                description: '',
                chapter_order: sessionIndex,
            };

            try {
                const chapterResponse = await authenticatedAxiosInstance.post(
                    `${ADD_CHAPTER}?subjectId=${subjectId}&moduleId=${moduleId}&commaSeparatedPackageSessionIds=${packageSessionIds}`,
                    chapterPayload
                );

                const chapterId = chapterResponse.data?.id || chapterResponse.data?.data?.id;
                if (!chapterId) {
                    console.error(
                        `[Course Creation] Failed to create chapter for session: ${session.sessionTitle}`,
                        chapterResponse.data
                    );
                    continue;
                }

                console.log(
                    `[Course Creation] Chapter created successfully: ${chapterId} for session "${session.sessionTitle}"`
                );
                console.log(`[Course Creation] Chapter response full data:`, chapterResponse.data);
                chapterIds.push(chapterId);

                // Step 7: Create ALL slides for this chapter in PARALLEL
                // Slides within a chapter have no inter-dependencies
                console.log(
                    `[Course Creation] Creating ${realSlides.length} slides in parallel for chapter "${session.sessionTitle}"...`
                );
                if (setCreationProgress) {
                    setCreationProgress(
                        t(
                            'courseCreation.progress.creatingSlidesInChapter',
                            'Creating {{count}} slides in "{{chapter}}"...',
                            { count: realSlides.length, chapter: session.sessionTitle }
                        )
                    );
                }

                const slidePromises = realSlides
                    .filter((slide) => !!slide)
                    .map((slide, slideIndex) => {
                        console.log(
                            `[Course Creation] Queuing slide ${slideIndex + 1}/${realSlides.length}: "${slide.slideTitle}" (type: ${slide.slideType})`
                        );
                        return createSlide({
                            slide,
                            chapterId,
                            moduleId,
                            subjectId,
                            packageSessionIds,
                            instituteId: INSTITUTE_ID || '',
                            slideOrder: slideIndex,
                            topicTag: `${session.sessionTitle} > ${slide.slideTitle} > ${slideKindLabel(slide.slideType, t)}`,
                        })
                            .then(() => {
                                console.log(
                                    `[Course Creation] ✓ Slide "${slide.slideTitle}" (type: ${slide.slideType}) created successfully`
                                );
                            })
                            .catch((slideError) => {
                                console.error(
                                    `[Course Creation] ❌ Failed to create slide "${slide.slideTitle}" (type: ${slide.slideType}):`,
                                    slideError
                                );
                                if (slideError instanceof Error) {
                                    console.error(`[Course Creation] Error details:`, {
                                        message: slideError.message,
                                        stack: slideError.stack,
                                    });
                                }
                                // Don't re-throw — let other slides continue
                            });
                    });

                // Wait for all slides in this chapter to complete
                await Promise.allSettled(slidePromises);
                console.log(
                    `[Course Creation] ✓ All slides created for chapter "${session.sessionTitle}"`
                );
            } catch (chapterError) {
                console.error(
                    `[Course Creation] Failed to create chapter for session "${session.sessionTitle}":`,
                    chapterError
                );
                // Continue with next session instead of failing entire process
            }
        }

        console.log(`[Course Creation] Completed creating ${chapterIds.length} chapters`);

        return {
            courseId,
            packageSessionIds,
            subjectId,
            moduleId,
            chapterIds,
        };
    } catch (error) {
        console.error('Error in createCourseWithContent:', error);
        throw error;
    }
}

// Global progress setter (will be set by the hook)
let setCreationProgress: (progress: string) => void = () => { };

export function setProgressCallback(callback: (progress: string) => void) {
    setCreationProgress = callback;
}

interface CreateSlideParams {
    slide: SlideGeneration;
    chapterId: string;
    moduleId: string;
    subjectId: string;
    packageSessionIds: string;
    instituteId: string;
    slideOrder: number;
    // Breadcrumb tag ("Chapter > Topic > Asset kind") persisted into
    // slide.description so generated assets stay traceable to their source
    // topic (client round-2 ask). For KB courses the chapter/slide titles are
    // the source material's own topic/subtopic names.
    topicTag?: string;
}

// Human label for the asset kind, for the topic-tag breadcrumb.
function slideKindLabel(slideType: string, t: TFunction): string {
    switch (slideType) {
        case 'quiz':
        case 'assessment':
            return t('courseCreation.slideKind.quiz', 'Quiz');
        case 'video':
        case 'video-code':
            return t('courseCreation.slideKind.video', 'Video');
        case 'ai-video':
        case 'ai-video-code':
            return t('courseCreation.slideKind.aiVideo', 'AI Video');
        case 'ai-slides':
            return t('courseCreation.slideKind.aiSlides', 'AI Slides');
        case 'ai-storybook':
            return t('courseCreation.slideKind.storybook', 'Storybook');
        default:
            return t('courseCreation.slideKind.notes', 'Notes');
    }
}

/**
 * Creates a slide based on its type
 */
async function createSlide(params: CreateSlideParams): Promise<void> {
    const { slide, chapterId, moduleId, subjectId, packageSessionIds, instituteId, slideOrder } =
        params;

    console.log(
        `[Course Creation] createSlide called for: "${slide.slideTitle}" (type: ${slide.slideType})`
    );

    try {
        switch (slide.slideType) {
            case 'doc':
            case 'objectives':
                console.log(
                    `[Course Creation] Routing to createDocumentSlide for: ${slide.slideTitle}`
                );
                await createDocumentSlide(params);
                break;
            case 'video':
                console.log(
                    `[Course Creation] Routing to createVideoSlide for: ${slide.slideTitle}`
                );
                await createVideoSlide(params);
                break;
            case 'ai-video':
            case 'ai-slides':
            case 'ai-storybook':
                // ai-video, ai-slides, and ai-storybook all use the HTML_VIDEO slide type
                // and render via the same player on the frontend
                console.log(
                    `[Course Creation] Routing to createHtmlVideoSlide for: ${slide.slideTitle} (type: ${slide.slideType})`
                );
                await createHtmlVideoSlide(params);
                break;
            case 'quiz':
            case 'assessment':
                console.log(
                    `[Course Creation] Routing to createQuizSlide for: ${slide.slideTitle}`
                );
                await createQuizSlide(params);
                break;
            case 'video-code':
                // For regular video-code (YouTube), use the existing method
                console.log(
                    `[Course Creation] Routing to createVideoCodeSlide for: ${slide.slideTitle}`
                );
                await createVideoCodeSlide(params);
                break;
            case 'ai-video-code':
                // For ai-video-code, ALWAYS create HTML_VIDEO slide with code_editor_config
                // Allow creation after script generation, video can generate in background
                console.log(
                    `[Course Creation] Routing to createHtmlVideoSlideWithCode for: ${slide.slideTitle}`
                );
                console.log(`[Course Creation] AI Video Data:`, {
                    hasVideoId: !!slide.aiVideoData?.videoId,
                    hasScriptUrl: !!slide.aiVideoData?.scriptUrl,
                    videoId: slide.aiVideoData?.videoId,
                    scriptUrl: slide.aiVideoData?.scriptUrl,
                });
                await createHtmlVideoSlideWithCode(params);
                break;
            default:
                // Default to document slide for unknown types
                console.log(
                    `[Course Creation] Unknown slide type "${slide.slideType}", routing to createDocumentSlide for: ${slide.slideTitle}`
                );
                await createDocumentSlide(params);
                break;
        }
        console.log(
            `[Course Creation] ✓ Successfully completed createSlide for: "${slide.slideTitle}"`
        );
    } catch (error) {
        console.error(
            `[Course Creation] ❌ Failed to create slide "${slide.slideTitle}" (type: ${slide.slideType}):`,
            error
        );
        if (error instanceof Error) {
            console.error(`[Course Creation] Error message: ${error.message}`);
            console.error(`[Course Creation] Error stack: ${error.stack}`);
        }
        // Re-throw the error so it can be caught by the calling function
        throw error;
    }
}

/**
 * Creates a document slide
 */
async function createDocumentSlide(params: CreateSlideParams): Promise<void> {
    const { slide, chapterId, moduleId, subjectId, packageSessionIds, instituteId, slideOrder } =
        params;

    // Get slide content (may be markdown or HTML)
    let slideContent = slide.content || '';

    console.log(`[Course Creation] Document slide raw content for "${slide.slideTitle}":`, {
        hasContent: !!slideContent,
        contentLength: slideContent?.length || 0,
        contentPreview: slideContent?.substring(0, 100) || 'No content',
    });

    // Document slides are now creative, self-contained HTML (type 'HTML',
    // rendered in a sandboxed iframe). If the model already returned HTML,
    // store it VERBATIM — running it through markdownToHtml would mangle the
    // inline <style>/<script> and escape the markup. Only convert when the
    // content still looks like markdown (defensive fallback).
    const looksLikeHtml = /<!doctype html|<html|<style|<body|<section|<div|<h[1-6]|<p[ >]/i.test(
        slideContent.trim()
    );
    if (!looksLikeHtml) {
        try {
            slideContent = markdownToHtml(slideContent);
            console.log(`[Course Creation] Converted markdown to HTML, length: ${slideContent.length}`);
        } catch (error) {
            console.error('[Course Creation] Error converting markdown to HTML:', error);
        }
    }

    // Determine slide status - use PUBLISHED for active slides so they're visible
    const slideStatus = 'PUBLISHED';

    const payload = {
        id: crypto.randomUUID(),
        title: slide.slideTitle,
        image_file_id: '',
        // Topic breadcrumb — slide.description was unused (null) on this path.
        description: params.topicTag || null,
        slide_order: slideOrder,
        document_slide: {
            id: crypto.randomUUID(),
            // 'HTML' = the Tiptap-based document type. AI content is generated
            // as HTML, so it round-trips losslessly here (the legacy Yoopta
            // 'DOC' type re-parsed the HTML through a lossy deserializer).
            type: 'HTML',
            data: slideContent, // Now in HTML format
            title: slide.slideTitle,
            cover_file_id: '',
            total_pages: 1,
            // Set published_data to content if status is PUBLISHED, otherwise null
            published_data: slideStatus === 'PUBLISHED' ? slideContent : null,
            published_document_total_pages: 1,
        },
        status: slideStatus,
        new_slide: true,
        notify: false,
    };

    const apiUrl = `${ADD_UPDATE_DOCUMENT_SLIDE}?chapterId=${chapterId}&moduleId=${moduleId}&subjectId=${subjectId}&packageSessionId=${packageSessionIds}&instituteId=${instituteId}`;
    console.log(`[Course Creation] Creating document slide API URL:`, apiUrl);
    console.log(
        `[Course Creation] Document slide - chapterId: ${chapterId}, slideOrder: ${slideOrder}, contentLength: ${slideContent.length}`
    );
    console.log(`[Course Creation] Document slide payload:`, {
        id: payload.id,
        title: payload.title,
        slide_order: payload.slide_order,
        status: payload.status,
        document_slide_type: payload.document_slide.type,
        document_slide_data_length: payload.document_slide.data?.length || 0,
        document_slide_has_published_data: !!payload.document_slide.published_data,
        document_slide_published_data_length: payload.document_slide.published_data?.length || 0,
    });

    const response = await authenticatedAxiosInstance.post(apiUrl, payload);
    console.log(`[Course Creation] Document slide API response:`, response.data);

    // Verify the response contains the slide ID
    const slideId = response.data?.id || response.data?.data?.id || response.data;
    if (!slideId) {
        console.warn(
            `[Course Creation] Warning: Document slide created but no ID returned in response`
        );
    } else {
        console.log(`[Course Creation] Document slide created with ID: ${slideId}`);
    }
}

/**
 * Creates a video slide
 */
async function createVideoSlide(params: CreateSlideParams): Promise<void> {
    const { slide, chapterId, moduleId, subjectId, packageSessionIds, instituteId, slideOrder } =
        params;

    // Strict truncation to 250 to avoid backend 511 error (character varying(255))
    const truncate = (str: string, max: number = 250) =>
        str ? (str.length > max ? str.substring(0, max - 3) + '...' : str) : '';

    // Extract video URL from content or use aiVideoData
    let videoUrl = '';

    if (slide.slideType === 'ai-video' && slide.aiVideoData) {
        videoUrl = slide.aiVideoData.videoId || '';
    } else if (slide.content) {
        const textContent = slide.content.toString();
        const youtubeMatch = textContent.match(
            /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
        );

        if (youtubeMatch && youtubeMatch[1]) {
            videoUrl = `https://www.youtube.com/watch?v=${youtubeMatch[1]}`;
        }
    }

    const safeTitle = truncate(slide.slideTitle);
    const safeDescription = truncate(slide.content || '');

    // Build payload to match VideoSlidePayload interface
    const payload = {
        id: crypto.randomUUID(),
        title: safeTitle,
        description: safeDescription,
        image_file_id: '',
        slide_order: slideOrder,
        video_slide: {
            id: crypto.randomUUID(),
            title: safeTitle,
            description: safeDescription,
            url: videoUrl,
            video_length_in_millis: 0,
            published_url: videoUrl,
            published_video_length_in_millis: 0,
            source_type: 'VIDEO',
            embedded_type: slide.slideType === 'ai-video' ? 'AI_VIDEO' : 'YOUTUBE',
            embedded_data:
                slide.slideType === 'ai-video' && slide.aiVideoData
                    ? JSON.stringify(slide.aiVideoData)
                    : null,
            questions: [],
        },
        status: 'PUBLISHED',
        new_slide: true,
        notify: false,
    };

    const apiUrl = `${ADD_UPDATE_VIDEO_SLIDE}?chapterId=${chapterId}&instituteId=${instituteId}&packageSessionId=${packageSessionIds}&moduleId=${moduleId}&subjectId=${subjectId}`;
    console.log(`[Course Creation] Creating video slide API URL:`, apiUrl);
    console.log(
        `[Course Creation] Video slide - chapterId: ${chapterId}, slideOrder: ${slideOrder}, videoUrl: ${videoUrl}`
    );

    const response = await authenticatedAxiosInstance.post(apiUrl, payload);
    console.log(`[Course Creation] Video slide API response:`, response.data);
}

/**
 * Creates an HTML_VIDEO slide for AI-generated videos
 */
async function createHtmlVideoSlide(params: CreateSlideParams): Promise<void> {
    const { slide, chapterId, moduleId, subjectId, packageSessionIds, instituteId, slideOrder } =
        params;

    // Strict truncation to 250 to avoid backend 511 error (character varying(255))
    const truncate = (str: string, max: number = 250) =>
        str ? (str.length > max ? str.substring(0, max - 3) + '...' : str) : '';

    const safeTitle = truncate(slide.slideTitle);
    const safeDescription = truncate(slide.content || '');
    // Use videoId if available, otherwise use scriptUrl, or a placeholder that will be updated when video is ready
    // For AI_VIDEO slides, we always create HTML_VIDEO type even if video isn't ready yet
    const videoId = slide.aiVideoData?.videoId || slide.aiVideoData?.scriptUrl || 'pending';

    // Get video length from aiVideoData if available, otherwise default to 0
    // Note: videoLengthInMillis might not be in the type, so we use any access
    const videoLengthInMillis = slide.aiVideoData
        ? (slide.aiVideoData as any).videoLengthInMillis || 0
        : 0;

    // Build payload for HTML_VIDEO slide
    // Note: The backend should accept this structure with source_type: 'HTML_VIDEO'
    const payload = {
        id: crypto.randomUUID(),
        title: safeTitle,
        name: safeTitle, // Also include name field for backend compatibility
        description: safeDescription,
        image_file_id: '',
        slide_order: slideOrder,
        source_type: 'HTML_VIDEO',
        html_video_slide: {
            id: crypto.randomUUID(),
            url: videoId, // Using videoId as the URL identifier
            video_length_in_millis: videoLengthInMillis,
            ai_gen_video_id: videoId,
        },
        status: 'PUBLISHED',
        new_slide: true,
        notify: false,
    };

    // Use the HTML_VIDEO slide endpoint
    const apiUrl = `${ADD_UPDATE_HTML_VIDEO_SLIDE}?chapterId=${chapterId}&instituteId=${instituteId}&packageSessionId=${packageSessionIds}&moduleId=${moduleId}&subjectId=${subjectId}`;
    console.log(`[Course Creation] ========== Creating HTML_VIDEO slide ==========`);
    console.log(`[Course Creation] API URL:`, apiUrl);
    console.log(`[Course Creation] Slide details:`, {
        title: safeTitle,
        chapterId,
        slideOrder,
        videoId,
    });
    console.log(`[Course Creation] Full payload:`, JSON.stringify(payload, null, 2));

    try {
        const response = await authenticatedAxiosInstance.post(apiUrl, payload);
        console.log(`[Course Creation] ✓ HTML_VIDEO slide API response:`, response.data);
        console.log(`[Course Creation] Response status: ${response.status}`);
    } catch (apiError: any) {
        console.error(`[Course Creation] ❌ API Error creating HTML_VIDEO slide:`, apiError);
        console.error(`[Course Creation] Error response:`, apiError.response?.data);
        console.error(`[Course Creation] Error status:`, apiError.response?.status);
        console.error(`[Course Creation] Error message:`, apiError.message);
        throw apiError; // Re-throw to be caught by createSlide
    }
}

/**
 * Creates an HTML_VIDEO slide with code editor config for AI-generated videos with code
 */
async function createHtmlVideoSlideWithCode(params: CreateSlideParams): Promise<void> {
    const { slide, chapterId, moduleId, subjectId, packageSessionIds, instituteId, slideOrder } =
        params;

    // Strict truncation to 250 to avoid backend 511 error (character varying(255))
    const truncate = (str: string, max: number = 250) =>
        str ? (str.length > max ? str.substring(0, max - 3) + '...' : str) : '';

    const safeTitle = truncate(slide.slideTitle);
    const safeDescription = truncate(slide.content || '');

    // Extract videoId from multiple possible sources:
    // 1. slide.aiVideoData.videoId (primary source)
    // 2. slide.aiVideoData.scriptUrl (fallback)
    // 3. slide.content parsed as JSON with video.videoId (for AI_VIDEO_CODE structure)
    // 4. 'pending' as last resort
    let videoId = slide.aiVideoData?.videoId || slide.aiVideoData?.scriptUrl || null;

    // Get video length from aiVideoData if available, otherwise default to 0
    const videoLengthInMillis = slide.aiVideoData
        ? (slide.aiVideoData as any).videoLengthInMillis || 0
        : 0;

    // Code editor starts blank — learner writes code themselves
    let codeContent = '';
    let codeLanguage = 'python';
    let codeTheme = 'dark';
    let layout = 'split-right';

    try {
        if (slide.content) {
            try {
                const parsed = JSON.parse(slide.content);

                // Check if videoId is in parsed.video.videoId (for AI_VIDEO_CODE structure)
                if (!videoId && parsed.video?.videoId) {
                    videoId = parsed.video.videoId;
                    console.log(
                        `[Course Creation] Extracted videoId from content.video.videoId: ${videoId}`
                    );
                }

                // Also check parsed.video.scriptUrl as fallback
                if (!videoId && parsed.video?.scriptUrl) {
                    videoId = parsed.video.scriptUrl;
                    console.log(
                        `[Course Creation] Extracted videoId from content.video.scriptUrl: ${videoId}`
                    );
                }

                if (parsed.code) {
                    codeLanguage = parsed.code.language || 'python';
                    codeTheme = parsed.code.theme || 'dark';
                    layout = parsed.code.layout || 'split-right';
                }
            } catch (e) {
                // If content is not JSON, try to extract language hint from text/HTML
                const textContent = slide.content.toString();

                const codeMatch = textContent.match(
                    /```(python|javascript|typescript|java|html|css)/
                );
                if (codeMatch && codeMatch[1]) {
                    codeLanguage = codeMatch[1];
                }
            }
        }
    } catch (error) {
        console.warn('[Course Creation] Error extracting code metadata:', error);
    }

    // Final fallback: if videoId is still not found, use 'pending'
    if (!videoId) {
        videoId = 'pending';
        console.warn(
            `[Course Creation] videoId not found for slide "${slide.slideTitle}", using 'pending'`
        );
    }

    console.log(`[Course Creation] Final videoId for HTML_VIDEO+CODE slide:`, videoId);

    // Build code_editor_config JSON string
    const codeEditorConfig = JSON.stringify({
        enabled: true,
        layout: layout, // 'split-right' or 'split-left'
        language: codeLanguage,
        initial_code: codeContent,
        theme: codeTheme,
    });

    // Build payload for HTML_VIDEO slide with code_editor_config
    const payload = {
        id: crypto.randomUUID(),
        title: safeTitle,
        name: safeTitle,
        description: safeDescription,
        image_file_id: '',
        slide_order: slideOrder,
        source_type: 'HTML_VIDEO',
        html_video_slide: {
            id: crypto.randomUUID(),
            url: videoId,
            video_length_in_millis: videoLengthInMillis,
            ai_gen_video_id: videoId,
            code_editor_config: codeEditorConfig,
        },
        status: 'PUBLISHED',
        new_slide: true,
        notify: false,
    };

    // Use the HTML_VIDEO slide endpoint
    const apiUrl = `${ADD_UPDATE_HTML_VIDEO_SLIDE}?chapterId=${chapterId}&instituteId=${instituteId}&packageSessionId=${packageSessionIds}&moduleId=${moduleId}&subjectId=${subjectId}`;
    console.log(
        `[Course Creation] ========== Creating HTML_VIDEO slide with code editor ==========`
    );
    console.log(`[Course Creation] API URL:`, apiUrl);
    console.log(`[Course Creation] Slide details:`, {
        title: safeTitle,
        chapterId,
        slideOrder,
        videoId,
        codeLanguage,
        codeContentLength: codeContent.length,
        codeEditorConfig,
    });
    console.log(`[Course Creation] Full payload:`, JSON.stringify(payload, null, 2));

    try {
        const response = await authenticatedAxiosInstance.post(apiUrl, payload);
        console.log(`[Course Creation] ✓ HTML_VIDEO slide with code API response:`, response.data);
        console.log(`[Course Creation] Response status: ${response.status}`);
    } catch (apiError: any) {
        console.error(
            `[Course Creation] ❌ API Error creating HTML_VIDEO slide with code:`,
            apiError
        );
        console.error(`[Course Creation] Error response:`, apiError.response?.data);
        console.error(`[Course Creation] Error status:`, apiError.response?.status);
        console.error(`[Course Creation] Error message:`, apiError.message);
        throw apiError; // Re-throw to be caught by createSlide
    }
}

/**
 * Creates a quiz slide
 */
async function createQuizSlide(params: CreateSlideParams): Promise<void> {
    const { slide, chapterId, moduleId, subjectId, packageSessionIds, instituteId, slideOrder } =
        params;

    let questions: any[] = [];
    try {
        if (slide.content) {
            // First check if it's already JSON
            try {
                const parsedContent = JSON.parse(slide.content);
                if (parsedContent.questions && Array.isArray(parsedContent.questions)) {
                    // Map to backend complex structure
                    questions = parsedContent.questions.map((q: any) => {
                        const questionId = crypto.randomUUID();
                        const questionText =
                            q.question?.content || q.question?.text || q.question || 'Question';

                        // Format options
                        const optionsList = (q.options || []).map((opt: any) => ({
                            id: crypto.randomUUID(),
                            quiz_slide_question_id: questionId,
                            text: {
                                id: crypto.randomUUID(),
                                type: 'TEXT',
                                content: opt.content || opt.text || opt || '',
                            },
                            explanation_text: {
                                id: crypto.randomUUID(),
                                type: 'TEXT',
                                content: '',
                            },
                            explanation_text_data: {
                                id: crypto.randomUUID(),
                                type: 'TEXT',
                                content: '',
                            },
                            media_id: '',
                        }));

                        // Determine correct answer index
                        let correctIndex = 0;
                        if (q.correct_options && q.correct_options.length > 0) {
                            const correctOptionId = q.correct_options[0];
                            const found = q.options?.findIndex(
                                (opt: any) =>
                                    opt.preview_id === correctOptionId || opt.id === correctOptionId
                            );
                            if (found !== -1) correctIndex = found;
                        } else if (typeof q.correctAnswerIndex === 'number') {
                            correctIndex = q.correctAnswerIndex;
                        }

                        const autoEvalJson = JSON.stringify({ correctAnswers: [correctIndex] });

                        return {
                            id: questionId,
                            parent_rich_text: {
                                id: crypto.randomUUID(),
                                type: 'TEXT',
                                content: '',
                            },
                            text: { id: crypto.randomUUID(), type: 'TEXT', content: questionText },
                            text_data: {
                                id: crypto.randomUUID(),
                                type: 'TEXT',
                                content: questionText,
                            },
                            explanation_text: {
                                id: crypto.randomUUID(),
                                type: 'TEXT',
                                content: '',
                            },
                            explanation_text_data: {
                                id: crypto.randomUUID(),
                                type: 'TEXT',
                                content: '',
                            },
                            media_id: '',
                            status: 'ACTIVE',
                            question_response_type: 'OPTION',
                            question_type: 'MCQS',
                            questionType: 'MCQS',
                            access_level: 'INSTITUTE',
                            auto_evaluation_json: autoEvalJson,
                            evaluation_type: 'AUTO',
                            question_time_in_millis: 0,
                            question_order: 1, // Updated by backend
                            quiz_slide_id: '',
                            can_skip: false,
                            new_question: true,
                            options: optionsList,
                        };
                    });
                }
            } catch {
                // If not JSON, it might be the HTML format we generate
                console.warn('Could not parse quiz content as JSON, trying HTML parsing.');

                // Fallback: Parse HTML content to extract questions
                if (
                    slide.content &&
                    (slide.content.includes('<h3>') || slide.content.includes('Question'))
                ) {
                    try {
                        const tempDiv = document.createElement('div');
                        tempDiv.innerHTML = slide.content;
                        const questionHeaders = tempDiv.querySelectorAll('h3');

                        if (questionHeaders.length > 0) {
                            questions = Array.from(questionHeaders)
                                .map((header, index) => {
                                    let questionText = '';
                                    let currentElement = header.nextElementSibling;
                                    let listElement: Element | null = null;

                                    // Extract question text
                                    while (currentElement) {
                                        if (currentElement.tagName === 'OL') {
                                            listElement = currentElement;
                                            break;
                                        }
                                        if (currentElement.tagName !== 'HR') {
                                            questionText +=
                                                (questionText ? '\n' : '') +
                                                (currentElement.textContent?.trim() || '');
                                        }
                                        currentElement = currentElement.nextElementSibling;
                                    }

                                    const rawOptions: string[] = [];
                                    let correctIndex = 0;

                                    if (listElement) {
                                        listElement.querySelectorAll('li').forEach((li) => {
                                            const text = li.textContent?.trim() || '';
                                            if (text) rawOptions.push(text);
                                        });

                                        let nextElement = listElement.nextElementSibling;
                                        while (nextElement) {
                                            const text = nextElement.textContent || '';
                                            if (
                                                nextElement.tagName === 'HR' ||
                                                nextElement.tagName === 'H3'
                                            )
                                                break;

                                            const correctAnswerMatch =
                                                text.match(/Correct Answer:\s*(.+)/i);
                                            if (correctAnswerMatch?.[1]) {
                                                const correctAnswerText =
                                                    correctAnswerMatch[1].trim();
                                                const foundIndex = rawOptions.findIndex(
                                                    (opt) => opt.trim() === correctAnswerText
                                                );
                                                if (foundIndex !== -1) correctIndex = foundIndex;
                                                break;
                                            }
                                            nextElement = nextElement.nextElementSibling;
                                        }
                                    }

                                    // Construct complex object from HTML parse result
                                    const questionId = crypto.randomUUID();
                                    const optionsList = rawOptions.map((optText) => ({
                                        id: crypto.randomUUID(),
                                        quiz_slide_question_id: questionId,
                                        text: {
                                            id: crypto.randomUUID(),
                                            type: 'TEXT',
                                            content: optText,
                                        },
                                        explanation_text: {
                                            id: crypto.randomUUID(),
                                            type: 'TEXT',
                                            content: '',
                                        },
                                        explanation_text_data: {
                                            id: crypto.randomUUID(),
                                            type: 'TEXT',
                                            content: '',
                                        },
                                        media_id: '',
                                    }));

                                    const autoEvalJson = JSON.stringify({
                                        correctAnswers: [correctIndex],
                                    });

                                    return {
                                        id: questionId,
                                        parent_rich_text: {
                                            id: crypto.randomUUID(),
                                            type: 'TEXT',
                                            content: '',
                                        },
                                        text: {
                                            id: crypto.randomUUID(),
                                            type: 'TEXT',
                                            content:
                                                questionText || header.textContent || 'Question',
                                        },
                                        text_data: {
                                            id: crypto.randomUUID(),
                                            type: 'TEXT',
                                            content:
                                                questionText || header.textContent || 'Question',
                                        },
                                        explanation_text: {
                                            id: crypto.randomUUID(),
                                            type: 'TEXT',
                                            content: '',
                                        },
                                        explanation_text_data: {
                                            id: crypto.randomUUID(),
                                            type: 'TEXT',
                                            content: '',
                                        },
                                        media_id: '',
                                        status: 'ACTIVE',
                                        question_response_type: 'OPTION',
                                        question_type: 'MCQS',
                                        questionType: 'MCQS',
                                        access_level: 'INSTITUTE',
                                        auto_evaluation_json: autoEvalJson,
                                        evaluation_type: 'AUTO',
                                        question_time_in_millis: 0,
                                        question_order: index + 1,
                                        quiz_slide_id: '',
                                        can_skip: false,
                                        new_question: true,
                                        options: optionsList,
                                    };
                                })
                                .filter((q) => q.options.length > 0);

                            console.log(
                                `[Course Creation] Successfully parsed ${questions.length} questions from HTML`
                            );
                        }
                    } catch (htmlError) {
                        console.error('Error parsing quiz HTML:', htmlError);
                    }
                }
            }
        }
    } catch (e) {
        console.error('Error parsing quiz questions for payload', e);
    }

    // Create quiz slide payload - use quiz_slide not question_slide
    const payload = {
        id: crypto.randomUUID(),
        title: slide.slideTitle,
        image_file_id: '',
        description: slide.content || '',
        status: 'PUBLISHED', // Use PUBLISHED status so slides are visible
        slide_order: slideOrder,
        quiz_slide: {
            id: crypto.randomUUID(),
            questions: questions,
        },
        new_slide: true,
    };

    console.log(
        `[Course Creation] Creating quiz slide "${slide.slideTitle}" with payload:`,
        payload
    );

    const apiUrl = `${ADD_UPDATE_QUIZ_SLIDE}?chapterId=${chapterId}&instituteId=${instituteId}&packageSessionId=${packageSessionIds}&subjectId=${subjectId}&moduleId=${moduleId}`;
    console.log(`[Course Creation] Quiz slide API URL:`, apiUrl);

    const response = await authenticatedAxiosInstance.post(apiUrl, payload);
    console.log(`[Course Creation] Quiz slide API response:`, response.data);
}

/**
 * Creates a video+code slide (video slide + split screen code editor)
 */
async function createVideoCodeSlide(params: CreateSlideParams): Promise<void> {
    const { slide, chapterId, moduleId, subjectId, packageSessionIds, instituteId, slideOrder } =
        params;

    let videoUrl = '';
    // Code editor starts blank — learner writes code themselves
    let codeContent = '';
    let codeLanguage = 'python';
    let aiVideoData: any = null;

    try {
        // Parse content to extract video URL and language (but not code content)
        if (slide.content) {
            try {
                const parsed = JSON.parse(slide.content);
                if (parsed.video) {
                    const rawUrl = parsed.video.embedUrl || parsed.video.url || '';
                    console.log(`[createVideoCodeSlide] Parsed JSON video URL (raw):`, rawUrl);

                    // Extract video ID and convert to /watch?v= format
                    const videoIdMatch = rawUrl.match(
                        /(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
                    );
                    if (videoIdMatch && videoIdMatch[1]) {
                        videoUrl = `https://www.youtube.com/watch?v=${videoIdMatch[1]}`;
                        console.log(`[createVideoCodeSlide] Converted to watch format:`, videoUrl);
                    } else {
                        videoUrl = rawUrl; // Use as-is if we can't extract ID
                        console.warn(
                            `[createVideoCodeSlide] Could not extract video ID from:`,
                            rawUrl
                        );
                    }
                }
                if (parsed.code) {
                    codeLanguage = parsed.code.language || 'python';
                }
            } catch (e) {
                // If content is not JSON, it might be just text/html
                const textContent = slide.content.toString();
                console.log(
                    `[createVideoCodeSlide] Content is not JSON, parsing as text. Length:`,
                    textContent.length
                );
                console.log(
                    `[createVideoCodeSlide] Content preview:`,
                    textContent.substring(0, 200)
                );

                // Try to extract YouTube URL from content - MATCH EXACT FORMAT FROM createVideoSlide
                // Only match /watch?v= or /youtu.be/ formats (NOT /embed/)
                const youtubeMatch = textContent.match(
                    /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/
                );
                if (youtubeMatch) {
                    videoUrl = `https://www.youtube.com/watch?v=${youtubeMatch[1]}`;
                    console.log(
                        `[createVideoCodeSlide] Extracted from /watch or /youtu.be:`,
                        videoUrl
                    );
                }

                // If no match yet, try to extract from iframe and convert to /watch format
                if (!videoUrl) {
                    const iframeMatch = textContent.match(/<iframe[^>]*src="([^"]*)"[^>]*>/i);
                    if (iframeMatch && iframeMatch[1]) {
                        const iframeSrc = iframeMatch[1];
                        console.log(`[createVideoCodeSlide] Found iframe src:`, iframeSrc);
                        // Extract video ID from iframe embed URL
                        const embedMatch = iframeSrc.match(
                            /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]+)/
                        );
                        if (embedMatch && embedMatch[1]) {
                            videoUrl = `https://www.youtube.com/watch?v=${embedMatch[1]}`;
                            console.log(
                                `[createVideoCodeSlide] Converted embed to watch URL:`,
                                videoUrl
                            );
                        }
                    }
                }

                // Last resort: try to find ANY YouTube video ID in the content
                if (!videoUrl) {
                    const anyYoutubeMatch = textContent.match(
                        /(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
                    );
                    if (anyYoutubeMatch && anyYoutubeMatch[1]) {
                        videoUrl = `https://www.youtube.com/watch?v=${anyYoutubeMatch[1]}`;
                        console.log(
                            `[createVideoCodeSlide] Extracted video ID from any format:`,
                            videoUrl
                        );
                    }
                }

                // Check for AI Video marker if no standard video found
                if (!videoUrl) {
                    const aiVideoMatch = textContent.match(/\[AI Video: ([^\]]+)\]/);
                    if (aiVideoMatch && aiVideoMatch[1]) {
                        // AI video ID found
                        aiVideoData = { videoId: aiVideoMatch[1] };
                    }
                }

                // Extract language hint only
                const codeMatch = textContent.match(
                    /```(python|javascript|typescript|java|html|css)/
                );
                if (codeMatch && codeMatch[1]) {
                    codeLanguage = codeMatch[1];
                }
            }
        }

        // IMPORTANT: For video+code, we create ONE VIDEO slide with integrated split-screen data
        // The backend expects it in the video_slide.embedded_data field
        // This will show up as a Video slide in the list but render with a split-screen editor

        console.log(`[Course Creation] ========== Creating Integrated VIDEO+CODE slide ==========`);
        console.log(`[Course Creation] Title: "${slide.slideTitle}"`);
        console.log(`[Course Creation] Video URL:`, videoUrl || 'none');
        console.log(
            `[Course Creation] Code:`,
            codeContent ? `${codeContent.length} chars` : 'none'
        );

        // Strict truncation to 250 for DB character varying(255)
        const truncate = (str: string, max: number = 250) =>
            str ? (str.length > max ? str.substring(0, max - 3) + '...' : str) : '';

        const safeTitle = truncate(slide.slideTitle);
        const synchronisedVideoId = crypto.randomUUID();

        const splitScreenData = {
            splitScreen: true,
            videoSlideId: synchronisedVideoId,
            originalVideoData: {
                id: synchronisedVideoId,
                title: safeTitle,
                description: '',
                url: videoUrl,
                published_url: videoUrl,
                source_type: 'VIDEO',
            },
            language: codeLanguage,
            code: codeContent,
            theme: 'light',
            viewMode: 'edit',
            allLanguagesData: {
                python: {
                    code: codeLanguage === 'python' ? codeContent : '',
                    lastEdited: Date.now(),
                },
                javascript: {
                    code: codeLanguage === 'javascript' ? codeContent : '',
                    lastEdited: Date.now(),
                },
            },
            timestamp: Date.now(),
            splitType: 'CODE',
        };

        const videoPayload = {
            id: crypto.randomUUID(),
            title: safeTitle,
            description: '',
            image_file_id: '',
            slide_order: slideOrder,
            video_slide: {
                id: synchronisedVideoId,
                title: safeTitle,
                description: '',
                url: videoUrl,
                video_length_in_millis: 0,
                published_url: videoUrl,
                published_video_length_in_millis: 0,
                source_type: 'VIDEO',
                embedded_type: 'CODE',
                embedded_data: JSON.stringify(splitScreenData),
                questions: [],
            },
            status: 'PUBLISHED',
            new_slide: true,
            notify: false,
        };

        const videoApiUrl = `${ADD_UPDATE_VIDEO_SLIDE}?chapterId=${chapterId}&instituteId=${instituteId}&packageSessionId=${packageSessionIds}&moduleId=${moduleId}&subjectId=${subjectId}`;
        const response = await authenticatedAxiosInstance.post(videoApiUrl, videoPayload);
        console.log(`[Course Creation] ✓ Integrated CODE slide created: ${response.status}`);
    } catch (e) {
        console.error('Error creating video+code slide:', e);
        throw e; // Re-throw to be caught by the slide processing loop
    }
}
