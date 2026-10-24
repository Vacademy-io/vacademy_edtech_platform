import { Slide } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-hooks/use-slides';
import { Dispatch, RefObject, SetStateAction } from 'react';
import type { TFunction } from 'i18next';
import { toast } from 'sonner';
import { UseMutateAsyncFunction } from '@tanstack/react-query';
import {
    DocumentSlidePayload,
    VideoSlidePayload,
    QuizSlidePayload,
    AudioSlidePayload,
    ScormSlidePayload,
    AssessmentSlidePayload,
} from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-hooks/use-slides';
import { SlideQuestionsDataInterface } from '@/types/study-library/study-library-slides-type';
import {
    converDataToAssignmentFormat,
    converDataToVideoFormat,
    convertToQuestionBackendSlideFormat,
} from '../../-helper/helper';
import { createQuizSlidePayload } from '../quiz/utils/api-helpers';

type SlideResponse = {
    id: string;
    title: string;
    description: string;
    status: string;
};

export interface YTPlayer {
    getDuration(): number;
}

export const handlePublishSlide = async (
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
    playerRef: RefObject<YTPlayer> | undefined, // YouTube player ref (may be undefined)
    addUpdateAssessmentSlide:
        | UseMutateAsyncFunction<SlideResponse, Error, AssessmentSlidePayload, unknown>
        | undefined,
    /** Called only after the publish network call SUCCEEDS (e.g. to clear the local draft). */
    onPublishSuccess: (() => void) | undefined,
    /** Translation function bound to the caller's `studyLibraryHandlePublishSlide` namespace. */
    t: TFunction
) => {
    const status = 'PUBLISHED';

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
        } catch {
            toast.error(t('errorSavingSlide'));
        }
        return;
    }

    if (activeItem?.source_type === 'DOCUMENT') {
        // itemToPublish (the caller-built activeItem for DOC slides) has
        // document_slide.data set to the latest editor HTML. Fall back to
        // published_data so we never accidentally publish nothing.
        const publishedData =
            activeItem.document_slide?.data || activeItem.document_slide?.published_data;

        // Guard: refuse to publish if we can't resolve the latest content.
        // Without this, an empty serialization would send
        // data:null, published_data:null and clobber the slide on the server.
        if (!publishedData) {
            toast.error(t('couldNotReadContent'));
            return;
        }

        const publishDocumentSlide = (force: boolean) =>
            addUpdateDocumentSlide({
                id: activeItem?.id || '',
                title: activeItem.title || '',
                image_file_id: activeItem?.image_file_id || '',
                description: activeItem?.description || '',
                slide_order: activeItem.slide_order,
                document_slide: {
                    id: activeItem?.document_slide?.id || '',
                    type: activeItem?.document_slide?.type || '',
                    // Keep data in sync with published_data so that
                    // setEditorContent has a fallback if it ever reads
                    // from the data field on a PUBLISHED slide.
                    data: publishedData,
                    title: activeItem?.document_slide?.title || '',
                    cover_file_id: activeItem?.document_slide?.cover_file_id || '',
                    total_pages: activeItem?.document_slide?.total_pages || 0,
                    published_data: publishedData,
                    published_document_total_pages: activeItem?.document_slide?.total_pages || 0,
                    force_publish: force,
                },
                status: status,
                new_slide: false,
                notify: notify,
            });

        try {
            await publishDocumentSlide(false);
            toast.success(t('slidePublished'));
            setIsOpen(false);
            onPublishSuccess?.();
        } catch (error) {
            // The backend blocks a publish that would shrink a large live slide down to
            // a tiny fragment (409). Surface the real reason and let the author confirm
            // an explicit force-override instead of a generic "error saving".
            const response = (
                error as {
                    response?: { status?: number; data?: { ex?: string; message?: string } };
                }
            )?.response;
            const serverMessage = response?.data?.ex || response?.data?.message;
            if (response?.status === 409 && serverMessage) {
                const confirmed = window.confirm(t('confirmForcePublish', { serverMessage }));
                if (!confirmed) return;
                try {
                    await publishDocumentSlide(true);
                    toast.success(t('slidePublishedForced'));
                    setIsOpen(false);
                    onPublishSuccess?.();
                } catch {
                    toast.error(t('errorPublishingSlide'));
                }
                return;
            }
            toast.error(serverMessage || t('errorPublishingSlide'));
        }
    }

    if (activeItem?.source_type === 'VIDEO') {
        if (!activeItem.video_slide) {
            toast.error(t('videoSlideMissing'));
            return;
        }

        // Use playerRef to get latest duration if available
        let durationInMillis = 0;
        if (playerRef?.current?.getDuration) {
            const durationInSec = playerRef.current.getDuration();
            durationInMillis = Math.round(durationInSec * 1000);
        } else {
            durationInMillis =
                activeItem.video_slide.video_length_in_millis ||
                activeItem.video_slide.published_video_length_in_millis ||
                0;
        }

        const convertedData = converDataToVideoFormat({
            activeItem: {
                ...activeItem,
                video_slide: {
                    ...activeItem.video_slide,
                    video_length_in_millis: durationInMillis,
                    published_video_length_in_millis: durationInMillis,
                },
            },
            status,
            notify,
            newSlide: false,
        });

        try {
            await addUpdateVideoSlide(convertedData);
            toast.success(t('slidePublished'));
            setIsOpen(false);
        } catch {
            toast.error(t('errorPublishingSlide'));
        }
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
            toast.success(t('slidePublished'));
            setIsOpen(false);
        } catch {
            toast.error(t('errorPublishingSlide'));
        }
    }

    if (activeItem?.source_type === 'QUIZ') {
        try {
            // Use the createQuizSlidePayload function to properly transform the data
            const payload = createQuizSlidePayload(activeItem.quiz_slide?.questions || [], {
                ...activeItem,
                status: 'PUBLISHED', // Override status to PUBLISHED
            });

            // Call the API to publish the quiz slide (forward the notify choice —
            // createQuizSlidePayload doesn't carry it).
            await addUpdateQuizSlide({ ...payload, notify });
            toast.success(t('quizPublished'));
            setIsOpen(false);
        } catch (error) {
            console.error('Error publishing quiz slide:', error);
            toast.error(t('quizPublishFailed'));
        }
    }

    if (activeItem?.source_type === 'AUDIO') {
        if (!activeItem.audio_slide) {
            toast.error(t('audioSlideMissing'));
            return;
        }

        try {
            await addUpdateAudioSlide({
                id: activeItem.id,
                title: activeItem.title,
                description: activeItem.description || null,
                image_file_id: activeItem.image_file_id || null,
                status: 'PUBLISHED',
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
            toast.success(t('slidePublished'));
            setIsOpen(false);
        } catch {
            toast.error(t('errorPublishingSlide'));
        }
    }

    if (activeItem?.source_type === 'SCORM') {
        if (!activeItem.scorm_slide) {
            toast.error(t('scormSlideMissing'));
            return;
        }

        try {
            await addUpdateScormSlide({
                id: activeItem.id,
                title: activeItem.title,
                description: activeItem.description || '',
                image_file_id: activeItem.image_file_id || '',
                status: 'PUBLISHED',
                slide_order: activeItem.slide_order,
                notify: notify,
                new_slide: false,
                scorm_slide: {
                    id: activeItem.scorm_slide.id,
                },
            });
            toast.success(t('scormSlidePublished'));
            setIsOpen(false);
        } catch {
            toast.error(t('errorPublishingScormSlide'));
        }
    }

    if (activeItem?.source_type === 'ASSESSMENT') {
        if (!activeItem.assessment_slide || !addUpdateAssessmentSlide) {
            toast.error(t('assessmentSlideMissing'));
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
                status: 'PUBLISHED',
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
            toast.success(t('assessmentSlidePublished'));
            setIsOpen(false);
        } catch {
            toast.error(t('errorPublishingAssessmentSlide'));
        }
    }
};
