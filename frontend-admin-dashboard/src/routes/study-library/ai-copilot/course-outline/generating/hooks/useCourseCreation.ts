import { useState, useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { SessionProgress } from '../../../shared/types';
import { createCourseWithContent, setProgressCallback } from '../services/courseCreationService';
import { getRolesForCurrentInstitute } from '@/lib/auth/instituteUtils';
import {
    isCourseApprovalRequired,
    publishCourse,
    submitForReview,
} from '@/routes/study-library/courses/-services/approval-services';
import { savePackageSettingKey } from '@/services/package-settings';
import {
    TUTOR_MODE_SETTING_KEY,
    compileTutorPlans,
    getInstituteTutorDefaults,
    newCompileRunId,
    type TutorModeSetting,
} from '@/services/tutor';
import {
    COURSE_KB_DEFAULT_USE_IN,
    courseKbLinksEnabled,
    putCourseKbLink,
    type CourseKbChapterTopicsItem,
} from '@/services/course-knowledge-links';

/**
 * Live AI Tutor: after the copilot persists a course, mark it tutor-enabled and
 * compile every teachable slide.
 *
 * The prompt page's choices survive in their OWN sessionStorage keys
 * (`coursePersonalizedTeaching`, `courseLanguage`, `courseKbGrounding`): the
 * generating page deletes `courseConfig` as soon as the outline loads, long
 * before the course is created. The institute's Tutor Mode defaults decide
 * whether images are generated and whether tutor mode is available at all.
 * Never throws; failures are shown, not swallowed.
 */
async function startTutorPreparation(courseId: string, t: TFunction): Promise<void> {
    try {
        if (sessionStorage.getItem('coursePersonalizedTeaching') === '0') return;
        const institute: TutorModeSetting | null = await getInstituteTutorDefaults().catch(
            () => null
        );
        if (institute?.enabled === false) return; // tutor mode switched off for the institute
        const language = (sessionStorage.getItem('courseLanguage') || 'English')
            .toLowerCase()
            .startsWith('hi')
            ? 'hi'
            : 'en';
        let kb: { knowledge_base_id?: string; mode?: 'STRICT' | 'BLENDED' } | null = null;
        try {
            kb = JSON.parse(sessionStorage.getItem('courseKbGrounding') || 'null');
        } catch {
            kb = null;
        }
        const kbGrounding = kb?.knowledge_base_id
            ? { knowledge_base_id: kb.knowledge_base_id, mode: kb.mode ?? 'STRICT' }
            : null;
        const generateImages = institute?.generateImages !== false;
        await savePackageSettingKey(
            courseId,
            TUTOR_MODE_SETTING_KEY,
            {
                enabled: true,
                defaultOn: institute?.defaultOn !== false,
                generateImages,
                languages: [language, language === 'en' ? 'hi' : 'en'],
                kbGrounding,
            },
            'Tutor Mode'
        );
        toast.info(t('tutorPreparing'));
        let ready = 0;
        let failed = 0;
        await compileTutorPlans(
            courseId,
            {
                language,
                generate_images: generateImages,
                compile_run_id: newCompileRunId(),
                ...(kbGrounding ? { kb_grounding: kbGrounding } : {}),
            },
            (ev) => {
                if (ev.type === 'PLAN_READY' || ev.type === 'PLAN_UP_TO_DATE') ready += 1;
                if (ev.type === 'PLAN_ERROR') failed += 1;
            }
        );
        if (failed === 0) toast.success(t('tutorReady', { count: ready }));
        else toast.warning(t('tutorPartial', { ready, failed }));
    } catch (error) {
        console.warn('[Course Creation] Tutor preparation failed:', error);
        const msg = error instanceof Error ? error.message : t('unknownError');
        toast.error(t('tutorPrepFailed', { msg }));
    }
}

/** The outline todo fields the knowledge-base link needs (course_outline_service). */
interface OutlineTodoForLink {
    chapter_name?: string | null;
    metadata?: { node_id?: string | null } | null;
}

/**
 * Chapter → knowledge-base topics, in outline order: the outline stamps the
 * topic each slide was written from on its todo (metadata.node_id). The
 * server resolves chapter names to the new course's chapter ids.
 */
function chapterTopicsFromTodos(todos: OutlineTodoForLink[]): CourseKbChapterTopicsItem[] {
    const byChapter = new Map<string, string[]>();
    todos.forEach((todo) => {
        const chapter = (todo?.chapter_name ?? '').trim();
        const nodeId = todo?.metadata?.node_id;
        if (!chapter || typeof nodeId !== 'string' || !nodeId) return;
        const nodes = byChapter.get(chapter) ?? [];
        if (!nodes.includes(nodeId)) nodes.push(nodeId);
        byChapter.set(chapter, nodes);
    });
    return Array.from(byChapter, ([chapter_name, node_ids]) => ({ chapter_name, node_ids }));
}

/**
 * Course knowledge links: record that a course built from a knowledge base was
 * built from it, so the tutor and the student AI keep using that knowledge
 * base. Runs whether or not tutor mode is on (startTutorPreparation returns
 * early when it is off). Does nothing unless the platform's `links_enabled`
 * flag is on and the prompt page chose a knowledge base for THIS outline: a
 * resumed draft has no outline todos and does not carry the knowledge-base
 * choice, so a `courseKbGrounding` left in the tab by an earlier course is
 * never linked to it. Never throws: failures are logged, not shown, because
 * the course exists either way.
 */
async function saveCreatorLink(
    courseId: string,
    todos: OutlineTodoForLink[],
    queryClient: QueryClient
): Promise<void> {
    try {
        let kb: {
            knowledge_base_id?: string;
            node_ids?: unknown;
            mode?: 'STRICT' | 'BLENDED';
        } | null = null;
        try {
            kb = JSON.parse(sessionStorage.getItem('courseKbGrounding') || 'null');
        } catch {
            kb = null;
        }
        if (!kb?.knowledge_base_id) return;
        if (!Array.isArray(todos) || todos.length === 0) return;
        if (!(await courseKbLinksEnabled(queryClient))) return;

        const topicNodeIds = Array.isArray(kb.node_ids)
            ? kb.node_ids.filter((id): id is string => typeof id === 'string' && !!id)
            : [];
        const chapterTopics = chapterTopicsFromTodos(todos);
        await putCourseKbLink(courseId, {
            knowledge_base_id: kb.knowledge_base_id,
            grounding_mode: kb.mode === 'BLENDED' ? 'BLENDED' : 'STRICT',
            use_in: [...COURSE_KB_DEFAULT_USE_IN],
            ...(topicNodeIds.length > 0 ? { topic_node_ids: topicNodeIds } : {}),
            ...(chapterTopics.length > 0 ? { chapter_topics: chapterTopics } : {}),
            provenance: 'AI_COURSE_CREATOR',
        });
    } catch (error) {
        console.warn('[Course Creation] Saving the knowledge-base link failed:', error);
    }
}

/**
 * Custom hook for handling course creation
 */
export const useCourseCreation = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    courseMetadata: any,
    sessionsWithProgress: SessionProgress[],
    outlineTodos: OutlineTodoForLink[] = []
) => {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { t } = useTranslation('studyLibraryUseCourseCreation');
    const [isCreatingCourse, setIsCreatingCourse] = useState(false);
    const [creationProgress, setCreationProgress] = useState<string>('');

    // Set progress callback for the service
    useEffect(() => {
        setProgressCallback(setCreationProgress);
    }, []);

    const handleCreateCourse = async (status?: 'ACTIVE' | 'DRAFT') => {
        if (!courseMetadata) {
            toast.error(t('metadataMissing'));
            return;
        }

        if (!sessionsWithProgress || sessionsWithProgress.length === 0) {
            toast.error(t('noSessions'));
            return;
        }

        setIsCreatingCourse(true);
        setCreationProgress(t('progress.initializing'));

        try {
            // Extract course name - check multiple possible field names
            const courseName =
                courseMetadata.course_name ||
                courseMetadata.courseName ||
                courseMetadata.title ||
                t('defaultCourseName');
            console.log('[Course Creation] Extracted course name:', courseName);

            setCreationProgress(t('progress.creating'));
            // Extract metadata fields - using confirmed API structure with UI edit fallbacks
            const metadata = {
                aboutCourse:
                    courseMetadata.about_the_course_html || courseMetadata.aboutCourse || '',
                learningOutcome:
                    courseMetadata.why_learn_html || courseMetadata.learningOutcome || '',
                targetAudience:
                    courseMetadata.who_should_learn_html || courseMetadata.targetAudience || '',
                description:
                    courseMetadata.course_html_description || courseMetadata.description || '',

                // Images: The API returns both 'previewImageUrl' (direct S3 URL) and 'course_preview_image_media_id' (filename/ID)
                // We prefer the URL for display if available, but the ID is what we often need for backend references.
                // Our updated isValidFileId service now accepts URLs, so we can safely pass either.
                coursePreview:
                    courseMetadata.previewImageUrl ||
                    courseMetadata.course_preview_image_media_id ||
                    courseMetadata.coursePreview ||
                    '',
                courseBanner:
                    courseMetadata.bannerImageUrl ||
                    courseMetadata.course_banner_media_id ||
                    courseMetadata.courseBanner ||
                    '',

                courseMedia:
                    courseMetadata.mediaImageUrl ||
                    courseMetadata.courseMedia ||
                    (courseMetadata.course_media_id
                        ? typeof courseMetadata.course_media_id === 'string'
                            ? JSON.parse(courseMetadata.course_media_id)
                            : courseMetadata.course_media_id
                        : null),

                tags: courseMetadata.tags || [],
                levelStructure: courseMetadata.course_depth || courseMetadata.levelStructure || 2,
            };

            console.log('[Course Creation] Full courseMetadata object:', courseMetadata);
            console.log('[Course Creation] Course metadata being sent:', metadata);
            console.log('[Course Creation] Course name:', courseName);
            console.log('[Course Creation] Number of sessions:', sessionsWithProgress.length);
            console.log(
                '[Course Creation] Total slides:',
                sessionsWithProgress.reduce((sum, session) => sum + session.slides.length, 0)
            );

            // If user is a teacher and status is ACTIVE, we create as DRAFT first then submit
            // Current institute only — an ADMIN elsewhere is still a TEACHER here.
            const roles = getRolesForCurrentInstitute();
            const isTeacher = roles.includes('TEACHER') && !roles.includes('ADMIN');

            const creationStatus = isTeacher && status === 'ACTIVE' ? 'DRAFT' : status;

            const result = await createCourseWithContent({
                courseName,
                sessions: sessionsWithProgress,
                courseMetadata: metadata,
                status: creationStatus,
                levelId: courseMetadata.level || undefined, // Pass the levelId from courseMetadata
            });

            setCreationProgress(t('progress.created'));
            toast.success(t('progress.created'));
            // Clear saved draft since course is now created
            localStorage.removeItem('aiCourseDraft');

            // Course knowledge: link the course to the knowledge base it was
            // built from. Best-effort and independent of tutor mode.
            // Live AI Tutor: then enable tutor mode on the new course and compile
            // its teaching plans in the background. Best-effort — the course
            // exists either way, and the Tutor Mode tab can prepare it later.
            // Chained so the first compile already sees the link's chapter
            // topics; neither call throws and course creation waits for neither.
            void saveCreatorLink(result.courseId, outlineTodos, queryClient).then(() =>
                startTutorPreparation(result.courseId, t)
            );

            // Navigate to the course details page
            console.log('[Course Creation] Navigating to course:', result.courseId);

            if (isTeacher && status === 'ACTIVE') {
                // Role toggle: approval required -> submit for review; otherwise
                // publish the draft straight away so it ends up ACTIVE like an
                // admin-created course would.
                const requireApproval = isCourseApprovalRequired();
                setCreationProgress(
                    requireApproval ? t('progress.submitting') : t('progress.publishing')
                );
                try {
                    if (requireApproval) {
                        await submitForReview(result.courseId);
                        toast.success(t('reviewSubmitted'));
                    } else {
                        await publishCourse(result.courseId);
                        toast.success(t('coursePublished'));
                    }
                } catch (reviewError) {
                    console.error('Error finalising course:', reviewError);
                    toast.error(requireApproval ? t('reviewSubmitFailed') : t('publishFailed'));
                }
            }

            setTimeout(() => {
                navigate({
                    to: '/study-library/courses/course-details',
                    search: { courseId: result.courseId },
                });
            }, 1000);
        } catch (error) {
            console.error('Error creating course:', error);
            const errorMessage = error instanceof Error ? error.message : t('createFailed');
            toast.error(errorMessage);
            setCreationProgress('');
        } finally {
            setIsCreatingCourse(false);
        }
    };

    return {
        handleCreateCourse,
        isCreatingCourse,
        creationProgress,
    };
};
