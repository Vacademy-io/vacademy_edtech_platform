// hooks/use-slides.ts
import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import {
    GET_SLIDES,
    ADD_UPDATE_VIDEO_SLIDE,
    ADD_UPDATE_DOCUMENT_SLIDE,
    ADD_UPDATE_QUIZ_SLIDE,
    ADD_UPDATE_ASSIGNMENT_SLIDE,
    ADD_UPDATE_AUDIO_SLIDE,
    ADD_UPDATE_ASSESSMENT_SLIDE,
    ADD_UPDATE_HTML_VIDEO_SLIDE,
    SCORM_ADD_OR_UPDATE,
    UPDATE_SLIDE_STATUS,
    UPDATE_SLIDE_ORDER,
    UPDATE_QUESTION_ORDER,
    UPDATE_ASSIGNMENT_ORDER,
} from '@/constants/urls';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { useContentStore } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-stores/chapter-sidebar-store';
import { SlideQuestionsDataInterface } from '@/types/study-library/study-library-slides-type';
import { cleanVideoQuestions } from '../-helper/helper';

// Common interfaces
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
    embedded_type?: string;
    embedded_data?: string;
    questions: VideoQuestion[];
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

// Assignment slide interface
export interface AssignmentSlide {
    id: string;
    parent_rich_text: TextData;
    text_data: TextData;
    live_date: string; // ISO 8601 date format
    end_date: string; // ISO 8601 date format
    re_attempt_count: number;
    total_marks?: number;
    passing_marks?: number;
    comma_separated_media_ids: string;
    questions: AssignmentQuestion[];
}

export interface AssignmentQuestion {
    id: string;
    text_data: TextData;
    question_order: number;
    status: string;
    new_question: boolean;
    question_type: string;
    options?: {
        id: string;
        text: { content: string };
    }[];
}

// Quiz slide interface
export interface QuizSlide {
    id: string;
    title: string;
    description: TextData;
    questions: any[];
    parent_rich_text?: TextData;
    explanation_text_data?: TextData;
    media_id?: string;
    question_response_type?: string;
    access_level?: string;
    evaluation_type?: string;
    default_question_time_mins?: number;
    re_attempt_count?: number;
    source_type?: string;
    time_limit_in_minutes?: number | null;
    marks_per_question?: number;
    negative_marking?: number;
    partial_marking?: boolean | null;
    pass_percentage?: number | null;
}

// Audio slide interface
export interface AudioSlide {
    id: string;
    audio_file_id: string;
    thumbnail_file_id?: string;
    audio_length_in_millis: number;
    published_audio_file_id?: string;
    published_audio_length_in_millis?: number;
    source_type: 'FILE' | 'URL';
    external_url?: string;
    transcript?: string;
}

// SCORM slide interface
export interface ScormSlide {
    id: string;
    original_file_id?: string;
    launch_path?: string;
    launch_url?: string; // media file metadata UUID for the launch file
    scorm_version?: string;
}

// Assessment slide interface — slide that links to an existing assessment
export interface AssessmentSlide {
    id: string;
    assessment_id: string;
    allow_reattempt?: boolean;
    show_result?: boolean;
}

// AI-generated video slide (source_type HTML_VIDEO). The media is resolved from
// ai_gen_video_id at view time; code_editor_config is a JSON string when set.
export interface HtmlVideoSlideData {
    id: string;
    url?: string | null;
    ai_gen_video_id?: string | null;
    video_length_in_millis?: number | null;
    code_editor_config?: string | null;
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
    video_slide?: VideoSlide | null;
    document_slide?: DocumentSlide | null;
    question_slide?: QuestionSlide | null;
    assignment_slide?: AssignmentSlide | null;
    quiz_slide?: QuizSlide | null;
    audio_slide?: AudioSlide | null;
    scorm_slide?: ScormSlide | null;
    assessment_slide?: AssessmentSlide | null;
    html_video_slide?: HtmlVideoSlideData | null;
    is_loaded: boolean;
    new_slide: boolean;
    // Split-screen mode properties (frontend only)
    splitScreenMode?: boolean;
    splitScreenData?: Record<string, unknown>;
    splitScreenType?: string;
}

export interface VideoSlidePayload {
    id?: string | null;
    title: string;
    description: string | null;
    image_file_id: string | null;
    slide_order: number | null;
    video_slide: {
        id: string;
        description: string;
        url: string | null;
        title: string;
        video_length_in_millis: number;
        published_url: string | null;
        published_video_length_in_millis: number;
        source_type: string;
        embedded_type?: string;
        embedded_data?: string | null;
        questions?: VideoQuestion[];
    };
    status: string;
    new_slide?: boolean;
    notify: boolean;
}

export interface DocumentSlidePayload {
    id: string | null;
    title: string;
    image_file_id: string;
    description: string | null;
    slide_order: number | null;
    document_slide: {
        id: string;
        type: string;
        data: string | null;
        title: string;
        cover_file_id: string;
        total_pages: number;
        published_data: string | null;
        published_document_total_pages: number;
        /** When true, bypass the backend publish-time shrink guard (author confirmed). */
        force_publish?: boolean;
        /** When true, bypass the backend draft/unsync structural-block loss guard (author confirmed). */
        force_overwrite?: boolean;
    };
    status: string;
    new_slide: boolean;
    notify: boolean;
}

export interface AssignmentSlidePayload {
    id: string | null;
    source_id: string;
    source_type: string;
    title: string;
    image_file_id: string;
    description: string;
    status: string;
    slide_order: number;
    video_slide?: any | null;
    document_slide?: any | null;
    question_slide?: any | null;
    assignment_slide: {
        id: string;
        parent_rich_text: TextData;
        text_data: TextData;
        live_date: string;
        end_date: string;
        re_attempt_count: number;
        comma_separated_media_ids: string;
        questions: AssignmentQuestion[];
    };
    quiz_slide?: any | null;
    is_loaded: boolean;
    new_slide: boolean;
}

export interface QuizSlideQuestion {
    id: string;
    parent_rich_text: TextData;
    text: TextData;
    text_data: TextData; // Added for backend compatibility
    explanation_text: TextData;
    explanation_text_data: TextData; // Added for backend compatibility
    media_id: string;
    status: string;
    question_response_type: string;
    question_type: string;
    questionType?: string; // Fix: Add questionType field for backend compatibility
    access_level: string;
    auto_evaluation_json: string;
    evaluation_type: string;
    question_time_in_millis: number; // Added for backend compatibility
    question_order: number;
    quiz_slide_id: string;
    can_skip: boolean;
    new_question: boolean; // Added for backend compatibility
    options: {
        id: string;
        quiz_slide_question_id: string;
        text: TextData;
        explanation_text: TextData;
        explanation_text_data: TextData; // Added for backend compatibility
        media_id: string;
    }[];
}

export interface QuizSlidePayload {
    id: string | null;
    source_id: string;
    source_type: string;
    title: string;
    image_file_id: string;
    description: string;
    status: string;
    slide_order: number;
    video_slide?: {
        id: string;
        description: string;
        title: string;
        url: string;
        video_length_in_millis: number;
        published_url: string;
        published_video_length_in_millis: number;
        source_type: string;
        embedded_type?: string;
        embedded_data?: string;
        questions?: any[];
    } | null;
    document_slide?: {
        id: string;
        type: string;
        data: string;
        title: string;
        cover_file_id: string;
        total_pages: number;
        published_data: string;
        published_document_total_pages: number;
    } | null;
    question_slide?: {
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
        options: any[];
        source_type: string;
    } | null;
    assignment_slide?: {
        id: string;
        parent_rich_text: TextData;
        text_data: TextData;
        live_date: string;
        end_date: string;
        re_attempt_count: number;
        comma_separated_media_ids: string;
        questions: any[];
    } | null;
    quiz_slide: {
        id: string;
        description: TextData;
        title: string;
        questions: QuizSlideQuestion[];
    };
    is_loaded: boolean;
    new_slide: boolean;
    notify?: boolean;
}

export interface AudioSlidePayload {
    id?: string | null;
    title: string;
    description?: string | null;
    image_file_id?: string | null;
    status: 'DRAFT' | 'PUBLISHED';
    slide_order?: number | null;
    notify?: boolean;
    new_slide: boolean;
    audio_slide: {
        id?: string | null;
        audio_file_id: string;
        thumbnail_file_id?: string | null;
        audio_length_in_millis?: number;
        source_type: 'FILE' | 'URL';
        external_url?: string | null;
        transcript?: string | null;
    };
}

export interface ScormSlidePayload {
    id?: string | null;
    title: string;
    description?: string | null;
    image_file_id?: string | null;
    status: 'DRAFT' | 'PUBLISHED';
    slide_order?: number | null;
    new_slide: boolean;
    notify?: boolean;
    scorm_slide: {
        id: string; // The ScormSlide id returned from upload
    };
}

export interface AssessmentSlidePayload {
    id?: string | null;
    source_id?: string | null;
    source_type?: 'ASSESSMENT';
    title: string;
    description?: string | null;
    image_file_id?: string | null;
    status: 'DRAFT' | 'PUBLISHED';
    slide_order?: number | null;
    new_slide: boolean;
    notify?: boolean;
    assessment_slide: {
        id: string;
        assessment_id: string;
        allow_reattempt?: boolean;
        show_result?: boolean;
    };
}

// Update: the backend only overwrites html_video_slide fields that are sent, so a
// payload carrying just the id leaves the generated video untouched.
export interface HtmlVideoSlideUpdatePayload {
    id: string;
    title: string;
    description?: string | null;
    image_file_id?: string | null;
    status: string;
    slide_order?: number | null;
    new_slide: false;
    notify?: boolean;
    html_video_slide: {
        id: string;
    };
}

// Create: HTML_VIDEO slides (AI Video / AI Slides / AI Storybook) are created by the
// AI course flow and by "Add Slide → AI Video". Both ids are client-generated — the
// backend has no generator for html_video_slide.id. `url` and `ai_gen_video_id` both
// carry the ai_service video id; players resolve the media by it at view time.
export interface HtmlVideoSlideCreatePayload {
    id: string;
    title: string;
    description?: string | null;
    image_file_id?: string | null;
    status: 'DRAFT' | 'PUBLISHED';
    slide_order: number;
    source_type: 'HTML_VIDEO';
    new_slide: true;
    notify?: boolean;
    html_video_slide: {
        id: string;
        url: string;
        ai_gen_video_id: string;
        video_length_in_millis: number;
        /** JSON string, e.g. {"enabled":true,"layout":"split-right","language":"python",…}. */
        code_editor_config?: string;
    };
}

export type HtmlVideoSlidePayload = HtmlVideoSlideUpdatePayload | HtmlVideoSlideCreatePayload;

interface UpdateStatusParams {
    chapterId: string;
    slideId: string;
    status: string;
    instituteId: string;
}

export type slideOrderPayloadType = {
    slide_id: string;
    slide_order: number | null;
}[];

interface UpdateSlideOrderParams {
    chapterId: string;
    slideOrderPayload: slideOrderPayloadType;
}

// ✅ SEPARATED: Query hook (for reading slides data)
export const useSlidesQuery = (chapterId: string) => {
    const { setItems } = useContentStore();

    const getSlidesQuery = useQuery({
        queryKey: ['slides', chapterId],
        queryFn: async () => {
            try {
                const response = await authenticatedAxiosInstance.get(
                    `${GET_SLIDES}?chapterId=${chapterId}`
                );

                const cleanedData = cleanVideoQuestions(response.data);
                return cleanedData;
            } catch (error) {
                console.error(`[useSlidesQuery] ❌ Error in queryFn:`, {
                    error: error instanceof Error ? error.message : String(error),
                    stack: error instanceof Error ? error.stack : 'No stack trace',
                    chapterId,
                });
                throw error;
            }
        },
        staleTime: 3600000,
        enabled: !!chapterId,
    });

    // Update store when query data changes
    useEffect(() => {
        if (getSlidesQuery.data && Array.isArray(getSlidesQuery.data)) {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-expect-error
            setItems(getSlidesQuery.data);
        }
    }, [getSlidesQuery.data, getSlidesQuery.status, setItems]);

    return {
        slides: getSlidesQuery.data,
        isLoading: getSlidesQuery.isLoading,
        isError: getSlidesQuery.isError,
        error: getSlidesQuery.error,
        refetch: getSlidesQuery.refetch,
    };
};

// ✅ SEPARATED: Mutations hook (for write operations only)
export const useSlidesMutations = (
    chapterId: string,
    moduleId?: string,
    subjectId?: string,
    packageSessionId?: string
) => {
    const queryClient = useQueryClient();
    const accessToken = getTokenFromCookie(TokenKey.accessToken);
    const data = getTokenDecodedData(accessToken);
    const INSTITUTE_ID = data && Object.keys(data.authorities)[0];

    const addUpdateExcalidrawSlide = async (slideData: {
        id: string;
        title: string;
        image_file_id?: string;
        description?: string;
        slide_order: number;
        excalidraw_slide?: {
            elements: unknown[];
            files: Record<string, unknown>;
            appState: Record<string, unknown>;
        };
        status?: string;
        new_slide: boolean;
        notify: boolean;
    }) => {
        try {
            // Build Excalidraw data payload
            const excalidrawData = JSON.stringify({
                isExcalidraw: true,
                elements: slideData.excalidraw_slide?.elements || [],
                files: slideData.excalidraw_slide?.files || {},
                appState: slideData.excalidraw_slide?.appState || {},
            });

            // Prepare the document slide payload
            const documentSlidePayload = {
                id: slideData.id,
                title: slideData.title,
                image_file_id: slideData.image_file_id || '',
                description: slideData.description || '',
                slide_order: slideData.slide_order,
                document_slide: {
                    id: crypto.randomUUID(),
                    type: 'PRESENTATION',
                    data: excalidrawData,
                    title: slideData.title,
                    cover_file_id: '',
                    total_pages: 1,
                    published_data: null,
                    published_document_total_pages: 1,
                },
                status: slideData.status || 'DRAFT',
                new_slide: slideData.new_slide,
                notify: slideData.notify,
            };

            // Execute the mutation
            const response = await addUpdateDocumentSlideMutation.mutateAsync(documentSlidePayload);
            return response;
        } catch (error) {
            console.error('Error in addUpdateExcalidrawSlide:', error);
            throw error;
        }
    };

    const addUpdateVideoSlideMutation = useMutation({
        mutationFn: async (payload: VideoSlidePayload) => {
            const response = await authenticatedAxiosInstance.post(
                `${ADD_UPDATE_VIDEO_SLIDE}?chapterId=${chapterId}&instituteId=${INSTITUTE_ID}&packageSessionId=${packageSessionId}&moduleId=${moduleId}&subjectId=${subjectId}`,
                payload
            );
            return { data: response.data, isNewSlide: payload.new_slide };
        },
        onSuccess: async (result) => {
            // Invalidate and wait for slides query to refetch
            await queryClient.invalidateQueries({ queryKey: ['slides'] });
            queryClient.invalidateQueries({ queryKey: ['GET_MODULES_WITH_CHAPTERS'] });
            queryClient.invalidateQueries({ queryKey: ['GET_STUDENT_SUBJECTS_PROGRESS'] });
            queryClient.invalidateQueries({ queryKey: ['GET_STUDENT_SLIDES_PROGRESS'] });

            // If this was a new slide creation, set first slide as active after refetch completes
            if (result.isNewSlide) {
                // Wait for the slides query to actually refetch and update the store
                setTimeout(() => {
                    const { setActiveItem, items } = useContentStore.getState();

                    if (items && items.length > 0) {
                        setActiveItem(items[items.length - 1] as Slide);
                    }
                }, 1000); // Increased timeout to ensure refetch completes
            }
        },
    });

    // NOTE: Backend sometimes triggers two writes when adding a new DOC
    // (new slide creation + inter-slide change). We rely on idempotent payloads
    // and client-side dedup (in component) to avoid duplicate saves.
    const addUpdateDocumentSlideMutation = useMutation({
        mutationFn: async (payload: DocumentSlidePayload) => {
            const response = await authenticatedAxiosInstance.post(
                `${ADD_UPDATE_DOCUMENT_SLIDE}?chapterId=${chapterId}&moduleId=${moduleId}&subjectId=${subjectId}&packageSessionId=${packageSessionId}&instituteId=${INSTITUTE_ID}`,
                payload
            );
            return { data: response.data, isNewSlide: payload.new_slide };
        },
        onSuccess: async (result) => {
            await queryClient.invalidateQueries({ queryKey: ['slides'] });
            queryClient.invalidateQueries({ queryKey: ['GET_MODULES_WITH_CHAPTERS'] });
            queryClient.invalidateQueries({ queryKey: ['GET_STUDENT_SUBJECTS_PROGRESS'] });
            queryClient.invalidateQueries({ queryKey: ['GET_STUDENT_SLIDES_PROGRESS'] });

            // When a new DOC slide is created, auto-switch to it. New slides
            // are appended at the end (highest slide_order), so the last
            // item in the sorted list IS the new slide after the refetch
            // lands. Poll the store briefly instead of using a fixed
            // setTimeout — the old 1s delay raced with slow networks (new
            // slide didn't switch) and was redundantly late on fast ones.
            // Callers that want to control the active slide themselves
            // (e.g. AddDocDialog.reorderSlidesAfterNewSlide) will simply
            // overwrite this with the same target.
            if (result.isNewSlide) {
                for (let i = 0; i < 15; i++) {
                    await new Promise((r) => setTimeout(r, 100));
                    const { setActiveItem, items } = useContentStore.getState();
                    if (items && items.length > 0) {
                        setActiveItem(items[items.length - 1] as Slide);
                        break;
                    }
                }
            }
        },
    });

    const addUpdateQuizSlideMutation = useMutation({
        mutationFn: async (payload: QuizSlidePayload) => {
            const response = await authenticatedAxiosInstance.post(
                `${ADD_UPDATE_QUIZ_SLIDE}?chapterId=${chapterId}&instituteId=${INSTITUTE_ID}&packageSessionId=${packageSessionId}&subjectId=${subjectId}&moduleId=${moduleId}`,
                payload
            );
            return { data: response.data, isNewSlide: payload.new_slide };
        },
        onSuccess: async (result) => {
            // Invalidate and wait for slides query to refetch
            await queryClient.invalidateQueries({ queryKey: ['slides'] });
            queryClient.invalidateQueries({ queryKey: ['GET_MODULES_WITH_CHAPTERS'] });
            queryClient.invalidateQueries({ queryKey: ['GET_STUDENT_SUBJECTS_PROGRESS'] });
            queryClient.invalidateQueries({ queryKey: ['GET_STUDENT_SLIDES_PROGRESS'] });

            // Note: We don't automatically set the first slide as active here anymore
            // because AddQuizDialog handles setting the correct slide as active after refetch
        },
    });

    const addUpdateAssignmentSlideMutation = useMutation({
        mutationFn: async (payload: AssignmentSlidePayload) => {
            const response = await authenticatedAxiosInstance.post(
                `${ADD_UPDATE_ASSIGNMENT_SLIDE}?chapterId=${chapterId}&instituteId=${INSTITUTE_ID}&packageSessionId=${packageSessionId}&subjectId=${subjectId}&moduleId=${moduleId}`,
                payload
            );
            return { data: response.data, isNewSlide: payload.new_slide };
        },
        onSuccess: async (result) => {
            // Invalidate and wait for slides query to refetch
            await queryClient.invalidateQueries({ queryKey: ['slides'] });
            queryClient.invalidateQueries({ queryKey: ['GET_MODULES_WITH_CHAPTERS'] });
            queryClient.invalidateQueries({ queryKey: ['GET_STUDENT_SUBJECTS_PROGRESS'] });
            queryClient.invalidateQueries({ queryKey: ['GET_STUDENT_SLIDES_PROGRESS'] });

            // If this was a new slide creation, set first slide as active after refetch completes
            if (result.isNewSlide) {
                // Wait for the slides query to actually refetch and update the store
                setTimeout(() => {
                    const { setActiveItem, items } = useContentStore.getState();

                    if (items && items.length > 0) {
                        setActiveItem(items[items.length - 1] as Slide);
                    }
                }, 1000); // Increased timeout to ensure refetch completes
            }
        },
    });

    const addUpdateAudioSlideMutation = useMutation({
        mutationFn: async (payload: AudioSlidePayload) => {
            const response = await authenticatedAxiosInstance.post(
                `${ADD_UPDATE_AUDIO_SLIDE}?chapterId=${chapterId}&moduleId=${moduleId}&subjectId=${subjectId}&packageSessionId=${packageSessionId}&instituteId=${INSTITUTE_ID}`,
                payload
            );
            return { data: response.data, isNewSlide: payload.new_slide };
        },
        onSuccess: async (result) => {
            // Invalidate and wait for slides query to refetch
            await queryClient.invalidateQueries({ queryKey: ['slides'] });
            queryClient.invalidateQueries({ queryKey: ['GET_MODULES_WITH_CHAPTERS'] });
            queryClient.invalidateQueries({ queryKey: ['GET_STUDENT_SUBJECTS_PROGRESS'] });
            queryClient.invalidateQueries({ queryKey: ['GET_STUDENT_SLIDES_PROGRESS'] });

            // If this was a new slide creation, set first slide as active after refetch completes
            if (result.isNewSlide) {
                // Wait for the slides query to actually refetch and update the store
                setTimeout(() => {
                    const { setActiveItem, items } = useContentStore.getState();

                    if (items && items.length > 0) {
                        setActiveItem(items[items.length - 1] as Slide);
                    }
                }, 1000);
            }
        },
    });

    const addUpdateScormSlideMutation = useMutation({
        mutationFn: async (payload: ScormSlidePayload) => {
            const response = await authenticatedAxiosInstance.post(
                `${SCORM_ADD_OR_UPDATE}?chapterId=${chapterId}&moduleId=${moduleId}&subjectId=${subjectId}&packageSessionId=${packageSessionId}&instituteId=${INSTITUTE_ID}`,
                payload
            );
            return { data: response.data, isNewSlide: payload.new_slide };
        },
        onSuccess: async (result) => {
            await queryClient.invalidateQueries({ queryKey: ['slides'] });
            queryClient.invalidateQueries({ queryKey: ['GET_MODULES_WITH_CHAPTERS'] });
            queryClient.invalidateQueries({ queryKey: ['GET_STUDENT_SUBJECTS_PROGRESS'] });
            queryClient.invalidateQueries({ queryKey: ['GET_STUDENT_SLIDES_PROGRESS'] });

            if (result.isNewSlide) {
                setTimeout(() => {
                    const { setActiveItem, items } = useContentStore.getState();
                    if (items && items.length > 0) {
                        setActiveItem(items[items.length - 1] as Slide);
                    }
                }, 1000);
            }
        },
    });

    const addUpdateAssessmentSlideMutation = useMutation({
        mutationFn: async (payload: AssessmentSlidePayload) => {
            const response = await authenticatedAxiosInstance.post(
                `${ADD_UPDATE_ASSESSMENT_SLIDE}?chapterId=${chapterId}&moduleId=${moduleId}&subjectId=${subjectId}&packageSessionId=${packageSessionId}&instituteId=${INSTITUTE_ID}`,
                payload
            );
            return { data: response.data, isNewSlide: payload.new_slide };
        },
        onSuccess: async (result) => {
            await queryClient.invalidateQueries({ queryKey: ['slides'] });
            queryClient.invalidateQueries({ queryKey: ['GET_MODULES_WITH_CHAPTERS'] });
            queryClient.invalidateQueries({ queryKey: ['GET_STUDENT_SUBJECTS_PROGRESS'] });
            queryClient.invalidateQueries({ queryKey: ['GET_STUDENT_SLIDES_PROGRESS'] });

            if (result.isNewSlide) {
                setTimeout(() => {
                    const { setActiveItem, items } = useContentStore.getState();
                    if (items && items.length > 0) {
                        setActiveItem(items[items.length - 1] as Slide);
                    }
                }, 1000);
            }
        },
    });

    const addUpdateHtmlVideoSlideMutation = useMutation({
        mutationFn: async (payload: HtmlVideoSlidePayload) => {
            const response = await authenticatedAxiosInstance.post(
                `${ADD_UPDATE_HTML_VIDEO_SLIDE}?chapterId=${chapterId}&moduleId=${moduleId}&subjectId=${subjectId}&packageSessionId=${packageSessionId}&instituteId=${INSTITUTE_ID}`,
                payload
            );
            return { data: response.data };
        },
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ['slides'] });
            queryClient.invalidateQueries({ queryKey: ['GET_MODULES_WITH_CHAPTERS'] });
            queryClient.invalidateQueries({ queryKey: ['GET_STUDENT_SUBJECTS_PROGRESS'] });
            queryClient.invalidateQueries({ queryKey: ['GET_STUDENT_SLIDES_PROGRESS'] });
        },
    });

    const updateSlideStatus = useMutation({
        mutationFn: async ({ chapterId, slideId, status, instituteId }: UpdateStatusParams) => {
            return await authenticatedAxiosInstance.put(
                `${UPDATE_SLIDE_STATUS}?chapterId=${chapterId}&slideId=${slideId}&status=${status}&instituteId=${instituteId}`
            );
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['slides'] });
            queryClient.invalidateQueries({ queryKey: ['GET_MODULES_WITH_CHAPTERS'] });
            queryClient.invalidateQueries({ queryKey: ['GET_STUDENT_SUBJECTS_PROGRESS'] });
            queryClient.invalidateQueries({ queryKey: ['GET_STUDENT_SLIDES_PROGRESS'] });
        },
    });

    const updateSlideOrderMutation = useMutation({
        mutationFn: async ({ chapterId, slideOrderPayload }: UpdateSlideOrderParams) => {
            return await authenticatedAxiosInstance.put(
                `${UPDATE_SLIDE_ORDER}?chapterId=${chapterId}`,
                slideOrderPayload
            );
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['slides'] });
            queryClient.invalidateQueries({ queryKey: ['GET_MODULES_WITH_CHAPTERS'] });
            queryClient.invalidateQueries({ queryKey: ['GET_STUDENT_SUBJECTS_PROGRESS'] });
            queryClient.invalidateQueries({ queryKey: ['GET_STUDENT_SLIDES_PROGRESS'] });
        },
    });

    const updateQuestionSlideMutation = useMutation({
        mutationFn: async (payload: SlideQuestionsDataInterface) => {
            const response = await authenticatedAxiosInstance.post(
                `${UPDATE_QUESTION_ORDER}?chapterId=${chapterId}&instituteId=${INSTITUTE_ID}&packageSessionId=${packageSessionId}&moduleId=${moduleId}&subjectId=${subjectId}`,
                payload
            );
            return { data: response.data, isNewSlide: payload.new_slide };
        },
        onSuccess: async (result) => {
            // Invalidate and wait for slides query to refetch
            await queryClient.invalidateQueries({ queryKey: ['slides'] });
            queryClient.invalidateQueries({ queryKey: ['GET_MODULES_WITH_CHAPTERS'] });
            queryClient.invalidateQueries({ queryKey: ['GET_STUDENT_SUBJECTS_PROGRESS'] });
            queryClient.invalidateQueries({ queryKey: ['GET_STUDENT_SLIDES_PROGRESS'] });

            // If this was a new slide creation, set first slide as active after refetch completes
            if (result.isNewSlide) {
                // Wait for the slides query to actually refetch and update the store
                setTimeout(() => {
                    const { setActiveItem, items } = useContentStore.getState();

                    if (items && items.length > 0) {
                        setActiveItem(items[items.length - 1] as Slide);
                    }
                }, 1000); // Increased timeout to ensure refetch completes
            }
        },
    });

    const updateAssignmentSlideMutation = useMutation({
        mutationFn: async (payload: SlideQuestionsDataInterface) => {
            const response = await authenticatedAxiosInstance.post(
                `${UPDATE_ASSIGNMENT_ORDER}?chapterId=${chapterId}&instituteId=${INSTITUTE_ID}&packageSessionId=${packageSessionId}&subjectId=${subjectId}&moduleId=${moduleId}`,
                payload
            );
            return { data: response.data, isNewSlide: payload.new_slide };
        },
        onSuccess: async (result) => {
            // Invalidate and wait for slides query to refetch
            await queryClient.invalidateQueries({ queryKey: ['slides'] });
            queryClient.invalidateQueries({ queryKey: ['GET_MODULES_WITH_CHAPTERS'] });
            queryClient.invalidateQueries({ queryKey: ['GET_STUDENT_SUBJECTS_PROGRESS'] });
            queryClient.invalidateQueries({ queryKey: ['GET_STUDENT_SLIDES_PROGRESS'] });

            // If this was a new slide creation, set first slide as active after refetch completes
            if (result.isNewSlide) {
                // Wait for the slides query to actually refetch and update the store
                setTimeout(() => {
                    const { setActiveItem, items } = useContentStore.getState();

                    if (items && items.length > 0) {
                        setActiveItem(items[items.length - 1] as Slide);
                    }
                }, 1000); // Increased timeout to ensure refetch completes
            }
        },
    });

    return {
        addUpdateVideoSlide: (payload: VideoSlidePayload) =>
            addUpdateVideoSlideMutation.mutateAsync(payload).then((result) => result.data),
        addUpdateDocumentSlide: (payload: DocumentSlidePayload) =>
            addUpdateDocumentSlideMutation.mutateAsync(payload).then((result) => result.data),
        addUpdateQuizSlide: (payload: QuizSlidePayload) =>
            addUpdateQuizSlideMutation.mutateAsync(payload).then((result) => result.data),
        addUpdateAssignmentSlide: (payload: AssignmentSlidePayload) =>
            addUpdateAssignmentSlideMutation.mutateAsync(payload).then((result) => result.data),
        addUpdateAudioSlide: (payload: AudioSlidePayload) =>
            addUpdateAudioSlideMutation.mutateAsync(payload).then((result) => result.data),
        addUpdateScormSlide: (payload: ScormSlidePayload) =>
            addUpdateScormSlideMutation.mutateAsync(payload).then((result) => result.data),
        addUpdateAssessmentSlide: (payload: AssessmentSlidePayload) =>
            addUpdateAssessmentSlideMutation.mutateAsync(payload).then((result) => result.data),
        addUpdateHtmlVideoSlide: (payload: HtmlVideoSlidePayload) =>
            addUpdateHtmlVideoSlideMutation.mutateAsync(payload).then((result) => result.data),
        updateSlideStatus: updateSlideStatus.mutateAsync,
        updateSlideOrder: updateSlideOrderMutation.mutateAsync,
        updateQuestionOrder: (payload: SlideQuestionsDataInterface) =>
            updateQuestionSlideMutation.mutateAsync(payload).then((result) => result.data),
        updateAssignmentOrder: (payload: SlideQuestionsDataInterface) =>
            updateAssignmentSlideMutation.mutateAsync(payload).then((result) => result.data),
        addUpdateExcalidrawSlide,
        isUpdating:
            addUpdateVideoSlideMutation.isPending ||
            addUpdateDocumentSlideMutation.isPending ||
            addUpdateQuizSlideMutation.isPending ||
            addUpdateAssignmentSlideMutation.isPending ||
            addUpdateAudioSlideMutation.isPending ||
            addUpdateScormSlideMutation.isPending ||
            addUpdateAssessmentSlideMutation.isPending ||
            addUpdateHtmlVideoSlideMutation.isPending ||
            updateSlideOrderMutation.isPending ||
            updateQuestionSlideMutation.isPending ||
            updateAssignmentSlideMutation.isPending,
    };
};

// ✅ LEGACY: Keep original hook for backwards compatibility (but mark as deprecated)
/**
 * @deprecated Use useSlidesQuery() for reading data or useSlidesMutations() for mutations only
 */
export const useSlides = (
    chapterId: string,
    moduleId?: string,
    subjectId?: string,
    packageSessionId?: string
) => {
    const queryResults = useSlidesQuery(chapterId);
    const mutations = useSlidesMutations(chapterId, moduleId, subjectId, packageSessionId);

    return {
        ...queryResults,
        ...mutations,
    };
};
