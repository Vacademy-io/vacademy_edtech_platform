import type {
    AssignmentSlidePayload,
    QuizSlidePayload,
    Slide,
} from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-hooks/use-slides';
import {
    generateUniqueAssignmentSlideTitle,
    generateUniqueQuizSlideTitle,
    getNextSlideOrder,
} from '../../-helper/slide-naming-utils';
import { getSlideStatusForUser } from '../../non-admin/hooks/useNonAdminSlides';
import i18n from '@/i18n';

const NS = 'studyLibraryCreateAssignmentSlidePayload';

export function createAssignmentSlidePayload(
    allSlides: Slide[] = [],
    titleOverride?: string
): AssignmentSlidePayload {
    const slideId = crypto.randomUUID();
    const title =
        titleOverride?.trim() ||
        generateUniqueAssignmentSlideTitle(allSlides) ||
        i18n.t(`${NS}:untitledAssignment`);

    const slideStatus = getSlideStatusForUser();

    return {
        id: slideId,
        source_id: '',
        source_type: 'ASSIGNMENT',
        title: title,
        image_file_id: '',
        description: i18n.t(`${NS}:assignmentDescription`),
        status: slideStatus,
        slide_order: getNextSlideOrder(allSlides),
        video_slide: null,
        document_slide: null,
        question_slide: null,
        assignment_slide: {
            id: crypto.randomUUID(),
            parent_rich_text: {
                id: '',
                type: 'TEXT',
                content: '',
            },
            text_data: {
                id: '',
                type: 'TEXT',
                content: '',
            },
            live_date: '',
            end_date: '',
            re_attempt_count: 0,
            comma_separated_media_ids: 'types:',
            questions: [],
        },
        quiz_slide: null,
        is_loaded: true,
        new_slide: true,
    };
}

/**
 * Creates a payload for a new quiz slide without questions
 */
export function createQuizSlidePayload(
    allSlides: Slide[] = [],
    titleOverride?: string
): QuizSlidePayload {
    const slideId = crypto.randomUUID();
    const title =
        titleOverride?.trim() ||
        generateUniqueQuizSlideTitle(allSlides) ||
        i18n.t(`${NS}:untitledQuiz`);

    const slideStatus = getSlideStatusForUser();

    return {
        id: slideId,
        source_id: '',
        source_type: 'QUIZ',
        title: title,
        image_file_id: '',
        description: i18n.t(`${NS}:quizDescription`),
        status: slideStatus,
        slide_order: getNextSlideOrder(allSlides),
        video_slide: null,
        document_slide: null,
        question_slide: null,
        assignment_slide: null,
        quiz_slide: {
            id: crypto.randomUUID(),
            title: title,
            description: {
                id: '',
                content: '',
                type: 'TEXT',
            },
            questions: [],
        },
        is_loaded: true,
        new_slide: true,
    };
}
