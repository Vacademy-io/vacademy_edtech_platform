import { Dispatch, SetStateAction, RefObject } from 'react';
import { toast } from 'sonner';
import type { TFunction } from 'i18next';
import i18n from '@/i18n';
import {
    DocumentSlidePayload,
    Slide,
    VideoSlidePayload,
    QuizSlidePayload,
    AudioSlidePayload,
    ScormSlidePayload,
    AssessmentSlidePayload,
} from '../../-hooks/use-slides';
import { UseMutateAsyncFunction } from '@tanstack/react-query';
import { SlideQuestionsDataInterface } from '@/types/study-library/study-library-slides-type';
import {
    converDataToAssignmentFormat,
    converDataToVideoFormat,
    convertToQuestionBackendSlideFormat,
} from '../../-helper/helper';
import { YTPlayer } from '../youtube-player';
import { createQuizSlidePayload } from '../quiz/utils/api-helpers';

type SlideResponse = {
    id: string;

    title: string;
    description: string;
    status: string;
};

const NAMESPACE = 'studyLibraryHandleUnpublishSlide';

/**
 * This handler runs outside a React render tree (it's a plain exported async
 * function invoked from event handlers), so it can't use the `useTranslation`
 * hook. Fall back to the shared i18next singleton directly.
 */
const globalT: TFunction = ((key: string, options?: Record<string, unknown>) =>
    i18n.t(key, { ns: NAMESPACE, ...options })) as TFunction;

export const handleUnpublishSlide = async (
    setIsOpen: Dispatch<SetStateAction<boolean>>,
    notify: boolean,
    activeItem: Slide,
    addUpdateDocumentSlide: UseMutateAsyncFunction<
        SlideResponse,
        Error,
        DocumentSlidePayload,
        unknown
    >,
    addUpdateVideoSlide: UseMutateAsyncFunction<SlideResponse, Error, VideoSlidePayload, unknown>,
    updateQuestionOrder: UseMutateAsyncFunction<
        SlideResponse,
        Error,
        SlideQuestionsDataInterface,
        unknown
    >,
    updateAssignmentOrder: UseMutateAsyncFunction<
        SlideResponse,
        Error,
        SlideQuestionsDataInterface,
        unknown
    >,
    addUpdateQuizSlide: UseMutateAsyncFunction<SlideResponse, Error, QuizSlidePayload, unknown>,
    addUpdateAudioSlide: UseMutateAsyncFunction<SlideResponse, Error, AudioSlidePayload, unknown>,
    addUpdateScormSlide: UseMutateAsyncFunction<SlideResponse, Error, ScormSlidePayload, unknown>,
    SaveDraft: (activeItem: Slide) => Promise<void>,
    playerRef?: RefObject<YTPlayer>, // Optional: in case needed for recalculating duration
    addUpdateAssessmentSlide?: UseMutateAsyncFunction<
        SlideResponse,
        Error,
        AssessmentSlidePayload,
        unknown
    >
) => {
    const status = 'DRAFT';

    if (activeItem?.source_type === 'QUESTION') {
        const convertedData = convertToQuestionBackendSlideFormat({
            activeItem,
            status,
            notify,
            newSlide: false,
        });

        try {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-expect-error
            await updateQuestionOrder(convertedData!);
            toast.success(globalT('unpublishSuccess'));
            setIsOpen(false);
        } catch {
            toast.error(globalT('errorUnpublishQuestion'));
        }
        return;
    }

    if (activeItem?.source_type === 'DOCUMENT') {
        // if (activeItem.document_slide?.type === 'DOC') {
        //     await SaveDraft(activeItem);
        // }

        // For unpublishing, preserve the data from published_data if it exists, then fallback to data
        // This ensures we don't lose content when unpublishing published slides
        const draftData =
            activeItem.document_slide?.published_data || activeItem.document_slide?.data;

        try {
            await addUpdateDocumentSlide({
                id: activeItem.id || '',
                title: activeItem.title || '',
                image_file_id: activeItem.image_file_id || '',
                description: activeItem.description || '',
                slide_order: activeItem.slide_order,
                document_slide: {
                    id: activeItem.document_slide?.id || '',
                    type: activeItem.document_slide?.type || '',
                    data: draftData || null, // Move published_data back to data field
                    title: activeItem.document_slide?.title || '',
                    cover_file_id: activeItem.document_slide?.cover_file_id || '',
                    total_pages: activeItem.document_slide?.total_pages || 0,
                    published_data: null, // Clear published_data since we're unpublishing
                    published_document_total_pages: activeItem.document_slide?.total_pages || 0,
                },
                status,
                new_slide: false,
                notify,
            });

            toast.success(globalT('unpublishSuccess'));
            setIsOpen(false);
        } catch {
            toast.error(globalT('errorUnpublishGeneric'));
        }
        return;
    }

    if (activeItem?.source_type === 'VIDEO') {
        if (!activeItem.video_slide) {
            toast.error(globalT('errorVideoDataMissing'));
            return;
        }

        let durationInMillis = 0;
        const currentStatus = activeItem.status;

        if (playerRef?.current?.getDuration) {
            try {
                const seconds = playerRef.current.getDuration();
                durationInMillis = Math.round(seconds * 1000);
            } catch {
                // fallback below
                durationInMillis =
                    currentStatus === 'UNSYNC'
                        ? activeItem.video_slide.video_length_in_millis || 0
                        : activeItem.video_slide.published_video_length_in_millis || 0;
            }
        } else {
            durationInMillis =
                currentStatus === 'UNSYNC'
                    ? activeItem.video_slide.video_length_in_millis || 0
                    : activeItem.video_slide.published_video_length_in_millis || 0;
        }

        const convertedData = converDataToVideoFormat({
            activeItem: {
                ...activeItem,
                video_slide: {
                    ...activeItem.video_slide,
                    video_length_in_millis: durationInMillis,
                    published_video_length_in_millis: 0,
                },
            },
            status,
            notify,
            newSlide: false,
        });

        // converDataToVideoFormat is shaped for publish: it clears
        // video_slide.url and moves the file id into published_url. On
        // unpublish the slide returns to a draft state, where the preview reads
        // video_slide.url (video-slide-preview.tsx) — so a cleared url would
        // leave the video blank. Restore the file id into url from the
        // published copy the transform just computed. The shared transform is
        // left untouched, so publish / save-draft behavior is unchanged.
        if (convertedData?.video_slide) {
            convertedData.video_slide.url =
                convertedData.video_slide.published_url ||
                activeItem.video_slide.url ||
                '';
        }

        try {
            await addUpdateVideoSlide(convertedData);
            toast.success(globalT('unpublishSuccess'));
            setIsOpen(false);
        } catch {
            toast.error(globalT('errorUnpublishGeneric'));
        }
        return;
    }

    if (activeItem?.source_type === 'ASSIGNMENT') {
        const convertedData = converDataToAssignmentFormat({
            activeItem,
            status,
            notify,
            newSlide: false,
        });

        try {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-expect-error
            await updateAssignmentOrder(convertedData!);
            toast.success(globalT('unpublishSuccess'));
            setIsOpen(false);
        } catch {
            toast.error(globalT('errorUnpublishGeneric'));
        }
    }

    if (activeItem?.source_type === 'QUIZ') {
        try {
            // Use the createQuizSlidePayload function to properly transform the data
            const payload = createQuizSlidePayload(activeItem.quiz_slide?.questions || [], {
                ...activeItem,
                status: 'DRAFT', // Override status to DRAFT
            });

            // Call the API to unpublish the quiz slide
            await addUpdateQuizSlide(payload);
            toast.success(globalT('quizUnpublishSuccess'));
            setIsOpen(false);
        } catch (error) {
            console.error('Error unpublishing quiz slide:', error);
            toast.error(globalT('errorUnpublishQuiz'));
        }
    }

    if (activeItem?.source_type === 'AUDIO') {
        if (!activeItem.audio_slide) {
            toast.error(globalT('errorAudioDataMissing'));
            return;
        }

        try {
            await addUpdateAudioSlide({
                id: activeItem.id,
                title: activeItem.title,
                description: activeItem.description || null,
                image_file_id: activeItem.image_file_id || null,
                status: 'DRAFT',
                slide_order: activeItem.slide_order,
                notify: notify,
                new_slide: false,
                audio_slide: {
                    id: activeItem.audio_slide.id,
                    audio_file_id: activeItem.audio_slide.audio_file_id,
                    thumbnail_file_id: activeItem.audio_slide.thumbnail_file_id || null,
                    audio_length_in_millis: activeItem.audio_slide.audio_length_in_millis,
                    source_type: activeItem.audio_slide.source_type,
                    external_url: activeItem.audio_slide.external_url || null,
                    transcript: activeItem.audio_slide.transcript || null,
                },
            });
            toast.success(globalT('unpublishSuccess'));
            setIsOpen(false);
        } catch {
            toast.error(globalT('errorUnpublishGeneric'));
        }
    }

    if (activeItem?.source_type === 'SCORM') {
        if (!activeItem.scorm_slide) {
            toast.error(globalT('errorScormDataMissing'));
            return;
        }

        try {
            await addUpdateScormSlide({
                id: activeItem.id,
                title: activeItem.title,
                description: activeItem.description || '',
                image_file_id: activeItem.image_file_id || '',
                status: 'DRAFT',
                slide_order: activeItem.slide_order,
                notify: notify,
                new_slide: false,
                scorm_slide: {
                    id: activeItem.scorm_slide.id,
                },
            });
            toast.success(globalT('scormUnpublishSuccess'));
            setIsOpen(false);
        } catch {
            toast.error(globalT('errorUnpublishScorm'));
        }
    }

    if (activeItem?.source_type === 'ASSESSMENT') {
        if (!activeItem.assessment_slide || !addUpdateAssessmentSlide) {
            toast.error(globalT('errorAssessmentDataMissing'));
            return;
        }
        try {
            await addUpdateAssessmentSlide({
                id: activeItem.id,
                source_id: activeItem.assessment_slide.id,
                source_type: 'ASSESSMENT',
                title: activeItem.title,
                description: activeItem.description || '',
                image_file_id: activeItem.image_file_id || '',
                status: 'DRAFT',
                slide_order: activeItem.slide_order,
                notify,
                new_slide: false,
                assessment_slide: {
                    id: activeItem.assessment_slide.id,
                    assessment_id: activeItem.assessment_slide.assessment_id,
                    allow_reattempt: activeItem.assessment_slide.allow_reattempt ?? true,
                    show_result: activeItem.assessment_slide.show_result ?? true,
                },
            });
            toast.success(globalT('assessmentUnpublishSuccess'));
            setIsOpen(false);
        } catch {
            toast.error(globalT('errorUnpublishAssessment'));
        }
    }
};
