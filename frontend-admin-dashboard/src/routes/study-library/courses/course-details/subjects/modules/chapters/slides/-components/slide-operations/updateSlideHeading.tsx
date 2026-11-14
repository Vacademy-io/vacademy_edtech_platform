import { Dispatch, SetStateAction } from 'react';
import { toast } from 'sonner';
import i18n from '@/i18n';
import {
    AssessmentSlidePayload,
    AudioSlidePayload,
    DocumentSlidePayload,
    HtmlVideoSlidePayload,
    ScormSlidePayload,
    Slide,
    VideoSlidePayload,
    VideoQuestion,
    QuizSlidePayload,
} from '../../-hooks/use-slides';
import { useContentStore } from '../../-stores/chapter-sidebar-store';
import { UseMutateAsyncFunction } from '@tanstack/react-query';
import { createQuizSlidePayload } from '../quiz/utils/api-helpers';
import {
    converDataToAssignmentFormat,
    convertToQuestionBackendSlideFormat,
    convertStudyLibraryQuestion,
} from '../../-helper/helper';

type SlideResponse = {
    id: string;
    title: string;
    description: string;
    status: string;
};

// Show the new title in the header and sidebar right away; the slides refetch the
// mutation triggers then replaces this with the saved copy. A static import on
// purpose: the `require(...)` used by the older branches below is not bundled by
// Vite, throws in the browser and is swallowed by its empty catch.
const applyTitleLocally = (activeItem: Slide, heading: string) => {
    const { items, setItems, setActiveItem } = useContentStore.getState();
    // setItems re-points activeItem at the list copy, so set the active slide last.
    setItems(items.map((item) => (item.id === activeItem.id ? { ...item, title: heading } : item)));
    setActiveItem({ ...activeItem, title: heading });
};

export const updateHeading = async (
    activeItem: Slide,
    addUpdateVideoSlide: UseMutateAsyncFunction<SlideResponse, Error, VideoSlidePayload, unknown>,
    SaveDraft: (activeItem: Slide) => Promise<void>,
    heading: string,
    setIsEditing: Dispatch<SetStateAction<boolean>>,
    addUpdateDocumentSlide: UseMutateAsyncFunction<
        SlideResponse,
        Error,
        DocumentSlidePayload,
        unknown
    >,
    addUpdateQuizSlide?: UseMutateAsyncFunction<SlideResponse, Error, QuizSlidePayload, unknown>,
    updateAssignmentOrder?: UseMutateAsyncFunction<SlideResponse, Error, any, unknown>,
    updateQuestionOrder?: UseMutateAsyncFunction<SlideResponse, Error, any, unknown>,
    addUpdateAudioSlide?: UseMutateAsyncFunction<SlideResponse, Error, AudioSlidePayload, unknown>,
    addUpdateScormSlide?: UseMutateAsyncFunction<SlideResponse, Error, ScormSlidePayload, unknown>,
    addUpdateAssessmentSlide?: UseMutateAsyncFunction<
        SlideResponse,
        Error,
        AssessmentSlidePayload,
        unknown
    >,
    addUpdateHtmlVideoSlide?: UseMutateAsyncFunction<
        SlideResponse,
        Error,
        HtmlVideoSlidePayload,
        unknown
    >
) => {
    const status = activeItem?.status == 'DRAFT' ? 'DRAFT' : 'UNSYNC';
    if (activeItem) {
        if (activeItem.source_type == 'VIDEO') {
            const url =
                activeItem?.status == 'PUBLISHED'
                    ? activeItem.video_slide?.published_url
                    : activeItem.video_slide?.url;
            await addUpdateVideoSlide({
                id: activeItem?.id,
                title: heading,
                description: activeItem.description,
                image_file_id: activeItem.image_file_id,
                slide_order: null,
                video_slide: {
                    id: activeItem.video_slide?.id || '',
                    description: activeItem.video_slide?.description || '',
                    url: url || null,
                    title: heading,
                    video_length_in_millis: activeItem?.video_slide?.video_length_in_millis || 0,
                    published_url: null,
                    published_video_length_in_millis:
                        activeItem?.video_slide?.published_video_length_in_millis || 0,
                    source_type: activeItem?.video_slide?.source_type || '',
                    // Preserve embedded fields for split-screen slides
                    embedded_type: activeItem?.video_slide?.embedded_type || '',
                    embedded_data: activeItem?.video_slide?.embedded_data || null,
                    // Convert MyQuestion-shaped questions to the backend
                    // VideoSlideQuestionDTO shape; sending them raw made the
                    // backend silently drop them on a heading rename.
                    questions: (activeItem?.video_slide?.questions || []).map((q) =>
                        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                        // @ts-expect-error - in-memory questions are MyQuestion shaped at runtime
                        convertStudyLibraryQuestion(q)
                    ) as unknown as VideoQuestion[],
                },
                status: status,
                new_slide: false,
                notify: false,
            });
            setIsEditing(false);
            return;
        } else if (activeItem.source_type === 'DOCUMENT') {
            // Handle PRESENTATION title update
            if (activeItem.document_slide?.type === 'PRESENTATION') {
                try {
                    const { setActiveItem, items, setItems } =
                        require('@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-stores/chapter-sidebar-store').useContentStore.getState();
                    const newDocSlide = { ...activeItem.document_slide, title: heading };
                    const newSlide = { ...activeItem, title: heading, document_slide: newDocSlide };
                    setActiveItem(newSlide);
                    if (Array.isArray(items)) {
                        setItems(
                            items.map((item) => (item.id === activeItem.id ? newSlide : item))
                        );
                    }
                } catch (e) {}
                await addUpdateDocumentSlide({
                    ...activeItem,
                    title: heading,
                    document_slide: {
                        ...activeItem.document_slide,
                        title: heading,
                    },
                    new_slide: false,
                    notify: false,
                });
                setIsEditing(false);
                return;
            }
            // if (activeItem.document_slide?.type == 'DOC') await SaveDraft(activeItem);

            await addUpdateDocumentSlide({
                id: activeItem?.id || '',
                title: heading,
                image_file_id: activeItem.image_file_id || '',
                description: activeItem?.description || '',
                slide_order: null,
                document_slide: {
                    id: activeItem?.document_slide?.id || '',
                    type: activeItem?.document_slide?.type || '',
                    // A rename must NOT carry content. This used to send the STORE's copy
                    // of the slide (never the live editor's), which meant renaming while
                    // you had unsaved edits silently reverted them — and made the rename
                    // one more writer that could persist a stale/collapsed document.
                    // null is safe: handleDraft/handleUnsyncDocumentSlide only write
                    // `data` when it is non-null (SlideService.java), while the title is
                    // applied from the DTO regardless. Status stays UNSYNC/DRAFT as
                    // before, so this never reaches handlePublishedDocumentSlide (which
                    // WOULD republish `data` when published_data is null).
                    data: null,
                    title: heading,
                    cover_file_id: activeItem.document_slide?.cover_file_id || '',
                    total_pages: activeItem?.document_slide?.total_pages || 0,
                    published_data: null,
                    published_document_total_pages:
                        activeItem?.document_slide?.published_document_total_pages || 0,
                },
                status: status,
                new_slide: false,
                notify: false,
            });
            try {
                const { setActiveItem, items, setItems } =
                    require('@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-stores/chapter-sidebar-store').useContentStore.getState();
                setActiveItem({ ...activeItem, title: heading });
                if (Array.isArray(items)) {
                    setItems(
                        items.map((item) =>
                            item.id === activeItem.id ? { ...item, title: heading } : item
                        )
                    );
                }
            } catch (e) {}
        } else if (activeItem.source_type === 'ASSIGNMENT' && updateAssignmentOrder) {
            // Assignment title update
            const convertedData = converDataToAssignmentFormat({
                activeItem: { ...activeItem, title: heading },
                status,
                notify: false,
                newSlide: false,
            });
            await updateAssignmentOrder(convertedData);
            try {
                const { setActiveItem, items, setItems } =
                    require('@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-stores/chapter-sidebar-store').useContentStore.getState();
                setActiveItem({ ...activeItem, title: heading });
                if (Array.isArray(items)) {
                    setItems(
                        items.map((item) =>
                            item.id === activeItem.id ? { ...item, title: heading } : item
                        )
                    );
                }
            } catch (e) {}
        } else if (activeItem.source_type === 'QUESTION' && updateQuestionOrder) {
            // Question title update
            const convertedData = convertToQuestionBackendSlideFormat({
                activeItem: { ...activeItem, title: heading },
                status,
                notify: false,
                newSlide: false,
            });
            await updateQuestionOrder(convertedData);
            try {
                const { setActiveItem, items, setItems } =
                    require('@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-stores/chapter-sidebar-store').useContentStore.getState();
                setActiveItem({ ...activeItem, title: heading });
                if (Array.isArray(items)) {
                    setItems(
                        items.map((item) =>
                            item.id === activeItem.id ? { ...item, title: heading } : item
                        )
                    );
                }
            } catch (e) {}
        } else if (activeItem.source_type === 'QUIZ' && addUpdateQuizSlide) {
            // Quiz title update
            const newQuizSlide = {
                ...activeItem.quiz_slide,
                id: activeItem.quiz_slide?.id || '',
                title: heading,
                description: activeItem.quiz_slide?.description || {
                    id: '',
                    content: '',
                    type: 'TEXT',
                },
                questions: activeItem.quiz_slide?.questions || [],
            };
            const newSlide = { ...activeItem, title: heading, quiz_slide: newQuizSlide };
            try {
                const { setActiveItem, items, setItems } =
                    require('@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-stores/chapter-sidebar-store').useContentStore.getState();
                setActiveItem(newSlide);
                if (Array.isArray(items)) {
                    setItems(items.map((item) => (item.id === activeItem.id ? newSlide : item)));
                }
            } catch (e) {}
            const payload = createQuizSlidePayload(activeItem.quiz_slide?.questions || [], {
                ...activeItem,
                title: heading,
                quiz_slide: newQuizSlide,
                status,
            });
            await addUpdateQuizSlide(payload);
        } else if (activeItem.source_type === 'AUDIO' && addUpdateAudioSlide) {
            if (!activeItem.audio_slide) {
                setIsEditing(false);
                return;
            }
            await addUpdateAudioSlide({
                id: activeItem.id,
                title: heading,
                description: activeItem.description || null,
                image_file_id: activeItem.image_file_id || null,
                status: status as 'DRAFT' | 'PUBLISHED',
                slide_order: null,
                notify: false,
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
            try {
                const { setActiveItem, items, setItems } =
                    require('@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-stores/chapter-sidebar-store').useContentStore.getState();
                setActiveItem({ ...activeItem, title: heading });
                if (Array.isArray(items)) {
                    setItems(
                        items.map((item) =>
                            item.id === activeItem.id ? { ...item, title: heading } : item
                        )
                    );
                }
            } catch (e) {}
        } else if (activeItem.source_type === 'SCORM' && addUpdateScormSlide) {
            if (!activeItem.scorm_slide) {
                toast.error(i18n.t('slideEditor:scorm.missingData'));
                setIsEditing(false);
                return;
            }
            // SCORM, assessment and AI-video slides have no separate draft copy, so a
            // rename keeps the current status rather than flipping it to UNSYNC/DRAFT.
            await addUpdateScormSlide({
                id: activeItem.id,
                title: heading,
                description: activeItem.description || null,
                image_file_id: activeItem.image_file_id || '',
                status: (activeItem.status || status) as 'DRAFT' | 'PUBLISHED',
                slide_order: null,
                notify: false,
                new_slide: false,
                scorm_slide: {
                    id: activeItem.scorm_slide.id,
                },
            });
            applyTitleLocally(activeItem, heading);
        } else if (activeItem.source_type === 'ASSESSMENT' && addUpdateAssessmentSlide) {
            if (!activeItem.assessment_slide) {
                toast.error(i18n.t('slideEditor:assessment.missingData'));
                setIsEditing(false);
                return;
            }
            await addUpdateAssessmentSlide({
                id: activeItem.id,
                source_id: activeItem.assessment_slide.id,
                source_type: 'ASSESSMENT',
                title: heading,
                description: activeItem.description || '',
                image_file_id: activeItem.image_file_id || '',
                status: (activeItem.status || status) as 'DRAFT' | 'PUBLISHED',
                slide_order: null,
                notify: false,
                new_slide: false,
                // allow_reattempt / show_result left out on purpose: the backend only
                // overwrites them when sent, so a rename can't reset them.
                assessment_slide: {
                    id: activeItem.assessment_slide.id,
                    assessment_id: activeItem.assessment_slide.assessment_id,
                },
            });
            applyTitleLocally(activeItem, heading);
        } else if (activeItem.source_type === 'HTML_VIDEO' && addUpdateHtmlVideoSlide) {
            const htmlVideoSlideId =
                (activeItem as Slide & { html_video_slide?: { id?: string } }).html_video_slide
                    ?.id || activeItem.source_id;
            await addUpdateHtmlVideoSlide({
                id: activeItem.id,
                title: heading,
                description: activeItem.description || null,
                image_file_id: activeItem.image_file_id || null,
                status: activeItem.status || status,
                slide_order: null,
                notify: false,
                new_slide: false,
                html_video_slide: {
                    id: htmlVideoSlideId,
                },
            });
            applyTitleLocally(activeItem, heading);
        } else {
            // Falling through used to close the editor without saving, so the new
            // title showed until the next refresh and then silently reverted.
            toast.error(i18n.t('slideEditor:slide.renameUnsupported'));
            // Put the saved title back in the header.
            applyTitleLocally(activeItem, activeItem.title);
        }
    }
    setIsEditing(false);
};
