import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import {
    Slide,
    useSlidesMutations,
} from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-hooks/use-slides';
import { toast } from 'sonner';
import {
    converDataToAssignmentFormat,
    convertToQuestionBackendSlideFormat,
    converDataToVideoFormat,
} from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-helper/helper';
import { createQuizSlidePayload } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-components/quiz/utils/api-helpers';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { convertHtmlToPdf } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-helper/helper';
import { AssignmentSlidePayload } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-hooks/use-slides';
import { SlideQuestionsDataInterface } from '@/types/study-library/study-library-slides-type';

export interface UnsavedChanges {
    hasChanges: boolean;
    slideId: string | null;
    slideTitle: string;
}

// Utility function to get the correct slide status for new slides based on user role
export function getSlideStatusForUser(): 'DRAFT' | 'PUBLISHED' {
    try {
        const accessToken = getTokenFromCookie(TokenKey.accessToken);
        const tokenData = getTokenDecodedData(accessToken);

        if (!tokenData || !tokenData.authorities) {
            return 'DRAFT'; // Default to DRAFT if no token data
        }

        // Check if user is admin in any institute
        const authorities = tokenData.authorities;
        const isAdmin = Object.values(authorities).some((institute: { roles?: string[] }) =>
            institute?.roles?.includes('ADMIN')
        );

        // Admin users: create as DRAFT (normal flow)
        // Non-admin users: create as PUBLISHED (auto-publish flow)
        const status = isAdmin ? 'DRAFT' : 'PUBLISHED';

        // Log when non-admin users create published slides
        if (status === 'PUBLISHED') {
            // Set a flag that can be picked up by the useNonAdminSlides hook
            localStorage.setItem('triggerApprovalButton', Date.now().toString());
            // Show a notification to let user know the slide is auto-published
            import('sonner').then(({ toast }) => {
                toast.success(
                    i18next.t('studyLibraryNonAdminSlides:toasts.createdAndAutoPublished')
                );
            });
        }

        return status;
    } catch (error) {
        console.error('Error determining user role for slide status:', error);
        return 'DRAFT'; // Default to DRAFT on error
    }
}

export function useNonAdminSlides(chapterId: string) {
    const { t } = useTranslation('studyLibraryNonAdminSlides');
    const [unsavedChanges, setUnsavedChanges] = useState<UnsavedChanges>({
        hasChanges: false,
        slideId: null,
        slideTitle: '',
    });

    const [showApprovalButton, setShowApprovalButton] = useState(false);
    const slidesMutations = useSlidesMutations(chapterId);

    // Track if any changes have been made to show approval button
    const hasAnyChanges = useRef(false);

    // Auto-save slide with published status for non-admin users
    const saveSlideAsPublished = useCallback(
        async (slide: Slide, isManualSave = false, currentEditorContent?: string) => {
            try {
                // Only skip auto-publish for new slides during automatic saves (not manual saves)
                if (slide.new_slide && !isManualSave) {
                    return false;
                }

                // For non-admin users, always save as PUBLISHED status
                const publishedStatus = 'PUBLISHED';

                // For manual saves, always treat as update (not new slide creation)
                const isNewSlide = !isManualSave && (slide.new_slide || false);

                // Handle different slide types
                if (slide?.source_type === 'ASSIGNMENT') {
                    const convertedData = converDataToAssignmentFormat({
                        activeItem: slide,
                        status: publishedStatus,
                        notify: false,
                        newSlide: isNewSlide,
                    });
                    await slidesMutations.addUpdateAssignmentSlide(
                        convertedData as unknown as AssignmentSlidePayload
                    );
                    toast.success(t('toasts.assignmentPublished'));
                } else if (slide?.source_type === 'QUESTION') {
                    const convertedData = convertToQuestionBackendSlideFormat({
                        activeItem: slide,
                        status: publishedStatus,
                        notify: false,
                        newSlide: isNewSlide,
                    });
                    await slidesMutations.updateQuestionOrder(
                        convertedData as unknown as SlideQuestionsDataInterface
                    );
                    toast.success(t('toasts.questionPublished'));
                } else if (slide?.source_type === 'QUIZ') {
                    const payload = createQuizSlidePayload(slide.quiz_slide?.questions || [], {
                        ...slide,
                        status: publishedStatus,
                    });
                    await slidesMutations.addUpdateQuizSlide(payload);
                    toast.success(t('toasts.quizPublished'));
                } else if (slide?.source_type === 'VIDEO') {
                    if (slide.video_slide) {
                        // Convert in-memory (MyQuestion-shaped) video questions into the
                        // snake_case VideoSlideQuestionDTO shape the backend expects.
                        // Spreading slide.video_slide raw sent camelCase questions that the
                        // backend silently dropped, so added questions were never persisted.
                        const videoSlidePayload = converDataToVideoFormat({
                            activeItem: slide,
                            status: publishedStatus,
                            notify: false,
                            newSlide: isNewSlide,
                        });
                        await slidesMutations.addUpdateVideoSlide(videoSlidePayload);
                        toast.success(t('toasts.videoPublished'));
                    } else {
                        toast.error(t('toasts.videoDataMissing'));
                    }
                } else if (slide?.source_type === 'AUDIO') {
                    if (slide.audio_slide) {
                        const audioSlidePayload = {
                            id: slide.id,
                            title: slide.title,
                            description: slide.description || null,
                            image_file_id: slide.image_file_id || null,
                            status: publishedStatus as 'DRAFT' | 'PUBLISHED',
                            slide_order: slide.slide_order,
                            notify: false,
                            new_slide: isNewSlide,
                            audio_slide: {
                                id: slide.audio_slide.id,
                                audio_file_id: slide.audio_slide.audio_file_id,
                                thumbnail_file_id: slide.audio_slide.thumbnail_file_id || null,
                                audio_length_in_millis: slide.audio_slide.audio_length_in_millis,
                                source_type: slide.audio_slide.source_type,
                                external_url: slide.audio_slide.external_url || null,
                                transcript: slide.audio_slide.transcript || null,
                            },
                        };
                        await slidesMutations.addUpdateAudioSlide(audioSlidePayload);
                        toast.success(t('toasts.audioPublished'));
                    } else {
                        toast.error(t('toasts.audioDataMissing'));
                    }
                } else {
                    // Handle DOCUMENT slides (DOC, PDF, PPT_ANIM, PRESENTATION, CODE, JUPYTER, SCRATCH)
                    let currentData: string;
                    let totalPages: number;

                    const docType = slide.document_slide?.type;
                    if (docType === 'PRESENTATION') {
                        // For presentations, data is a file ID, not HTML content
                        currentData = slide.document_slide?.data || '';
                        totalPages = slide.document_slide?.total_pages || 1;
                    } else if (docType === 'PDF' || docType === 'PPT_ANIM') {
                        // File-backed slides: data is a PDF file id / deck base URL. The
                        // editor is empty on these, so `currentEditorContent` is the
                        // empty-document shell — using it here published that shell over
                        // the file reference and broke the slide for admins and learners.
                        currentData =
                            slide.document_slide?.data ||
                            slide.document_slide?.published_data ||
                            '';
                        if (!currentData) {
                            toast.error(t('toasts.saveFailed'));
                            return false;
                        }
                        totalPages = slide.document_slide?.total_pages || 1;
                    } else if (
                        docType === 'CODE' ||
                        docType === 'JUPYTER' ||
                        docType === 'SCRATCH'
                    ) {
                        // For interactive slides, always persist JSON from slide state, not HTML
                        currentData = slide.document_slide?.data || '';

                        // CRITICAL FIX: Prevent data loss for interactive slides
                        if (!currentData || currentData === '{}') {
                            console.warn(
                                '⚠️ Skipping save for interactive slide - no valid data found for non-admin'
                            );
                            const slideTypeName =
                                docType === 'CODE'
                                    ? t('slideTypes.codeEditor')
                                    : docType === 'JUPYTER'
                                      ? t('slideTypes.jupyterNotebook')
                                      : docType === 'SCRATCH'
                                        ? t('slideTypes.scratchProject')
                                        : t('slideTypes.interactiveSlide');
                            toast.success(t('toasts.alreadyUpToDate', { slideType: slideTypeName }));
                            return false;
                        }

                        totalPages = 1;
                    } else {
                        // For text-like document types, use current editor content if provided
                        currentData = currentEditorContent || slide.document_slide?.data || '';

                        // Safety check for document types
                        if (!currentData && docType !== 'PDF') {
                            console.warn('⚠️ No content found for document slide');
                            currentData = '<p>Empty document</p>'; // Safer fallback than '{}'
                        }

                        // Calculate total pages for document slides
                        totalPages = currentEditorContent
                            ? (await convertHtmlToPdf(currentEditorContent)).totalPages
                            : slide.document_slide?.total_pages || 1;
                    }

                    const publishedSlide = {
                        id: slide.id,
                        title: slide.title,
                        image_file_id: slide.image_file_id || '',
                        description: slide.description || '',
                        slide_order: slide.slide_order,
                        document_slide: {
                            id: slide.document_slide?.id || '',
                            type: slide.document_slide?.type || 'DOC',
                            data: currentData, // Use current editor content
                            title: slide.document_slide?.title || slide.title,
                            cover_file_id: slide.document_slide?.cover_file_id || '',
                            total_pages: totalPages,
                            published_data: currentData, // Set published_data to current content
                            published_document_total_pages: totalPages,
                        },
                        status: publishedStatus,
                        new_slide: isNewSlide,
                        notify: false,
                    };

                    await slidesMutations.addUpdateDocumentSlide(publishedSlide);
                    if (slide.document_slide?.type === 'PRESENTATION') {
                        toast.success(t('toasts.presentationPublished'));
                    } else {
                        toast.success(t('toasts.slidePublished'));
                    }
                }

                // Mark that changes have been made to show approval button
                hasAnyChanges.current = true;
                setShowApprovalButton(true);

                // Clear unsaved changes
                setUnsavedChanges({
                    hasChanges: false,
                    slideId: null,
                    slideTitle: '',
                });

                return true;
            } catch (error) {
                console.error('❌ Error saving slide as published:', error);
                toast.error(t('toasts.saveFailed'));
                return false;
            }
        },
        [slidesMutations, t]
    );

    // Mark slide as having unsaved changes
    const markAsUnsaved = useCallback((slideId: string, slideTitle: string) => {
        setUnsavedChanges({
            hasChanges: true,
            slideId,
            slideTitle,
        });
    }, []);

    // Clear unsaved changes (when user decides not to save)
    const clearUnsavedChanges = useCallback(() => {
        setUnsavedChanges({
            hasChanges: false,
            slideId: null,
            slideTitle: '',
        });
    }, []);

    // Manually trigger the approval button (for when new slides are created)
    const triggerApprovalButton = useCallback(() => {
        hasAnyChanges.current = true;
        setShowApprovalButton(true);
    }, []);

    // Effect to detect new published slides and show approval button automatically
    useEffect(() => {
        const checkForNewSlides = () => {
            const trigger = localStorage.getItem('triggerApprovalButton');
            if (trigger) {
                hasAnyChanges.current = true;
                setShowApprovalButton(true);
                localStorage.removeItem('triggerApprovalButton'); // Clear the flag
            }
        };

        // Check immediately
        checkForNewSlides();

        // Set up an interval to check periodically
        const interval = setInterval(checkForNewSlides, 1000);

        return () => clearInterval(interval);
    }, []);

    // Check if user wants to save before leaving slide
    const handleSlideSwitch = useCallback(
        (callback: () => void) => {
            if (unsavedChanges.hasChanges) {
                // Show confirmation dialog
                const shouldSave = window.confirm(
                    t('confirm.unsavedChanges', { slideTitle: unsavedChanges.slideTitle })
                );

                if (shouldSave) {
                    // User wants to save - we'll need the current slide data
                    // This should be handled by the component that has access to the slide data
                    return { shouldSave: true, callback };
                } else {
                    // User doesn't want to save
                    clearUnsavedChanges();
                    callback();
                    return { shouldSave: false, callback };
                }
            } else {
                // No unsaved changes, proceed normally
                callback();
                return { shouldSave: false, callback };
            }
        },
        [unsavedChanges, clearUnsavedChanges, t]
    );

    return {
        // State
        unsavedChanges,
        showApprovalButton,
        hasAnyChanges: hasAnyChanges.current,

        // Actions
        saveSlideAsPublished,
        markAsUnsaved,
        clearUnsavedChanges,
        handleSlideSwitch,
        triggerApprovalButton,

        // Mutations (for additional operations)
        slidesMutations,
    };
}
