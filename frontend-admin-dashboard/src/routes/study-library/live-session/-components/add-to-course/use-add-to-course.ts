// Orchestrates "push transcript-derived content into a course slide".
//
// Given a resolved destination (chapter + its module/subject/package-session)
// and the generated content, this creates the right slide type and refreshes
// the caches so it appears when that chapter is next opened. Frontend-only —
// every endpoint it calls already exists.

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_SLIDES } from '@/constants/urls';
import { getInstituteId } from '@/constants/helper';
import {
    type BulkSlideContext,
    createDocHtmlSlide,
    createPdfSlide,
    createQuizSlide,
    createAssessmentLinkSlide,
} from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-services/bulk-slide-creation';
import { getNextSlideOrder } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-helper/slide-naming-utils';
import { checkIsHtmlEmpty } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-helper/html-content-utils';
import { convertHtmlToPdf } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-helper/helper';
import { getSlideStatusForUser } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/non-admin/hooks/useNonAdminSlides';
import { formatHTMLString } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-components/slide-operations/formatHtmlString';
import { UploadFileInS3 } from '@/services/upload_file';
import { notesMarkdownToHtml } from './notesMarkdownToHtml';
import type { GeneratedQuestion } from '../../-services/utils';
import { transformGeneratedQuestions } from './transformGeneratedQuestions';

export type AddToCourseContent =
    | { kind: 'NOTES'; markdown: string; suggestedTitle: string }
    | {
          kind: 'ASSESSMENT';
          questions: GeneratedQuestion[];
          suggestedTitle: string;
          /** Set once the assessment has been published — enables the link path. */
          assessmentId?: string | null;
      };

/**
 * For an ASSESSMENT:
 *  - QUIZ            → embed the questions in a self-contained quiz slide.
 *  - ASSESSMENT      → publish the assessment and link it as an assessment slide.
 *  - ASSESSMENT_ONLY → publish to the Assessment Center only; create no slide.
 */
export type AssessmentSlideMode = 'QUIZ' | 'ASSESSMENT' | 'ASSESSMENT_ONLY';

/** For NOTES, whether to store editable HTML (DOC) or a rendered PDF. */
export type NotesFormat = 'DOC' | 'PDF';

export interface AddToCourseDestination {
    chapterId: string;
    moduleId: string;
    subjectId: string;
    packageSessionId: string;
}

interface CreateArgs {
    /** One or more chapters to create the slide in (across courses). */
    destinations: AddToCourseDestination[];
    title: string;
    content: AddToCourseContent;
    assessmentMode?: AssessmentSlideMode;
    notesFormat?: NotesFormat;
    /** Slide publish state. Defaults to the role-based status. */
    status?: 'DRAFT' | 'PUBLISHED';
    /** When set (PDF notes via the HTML fallback), stamps a per-page watermark. */
    watermarkDataUrl?: string | null;
    /**
     * A ready-made PDF (captured from the rendered notes node) to upload as-is
     * for a PDF notes slide. When provided, we skip HTML→PDF rasterisation so the
     * uploaded PDF matches the preview/Download-PDF exactly.
     */
    pdfFile?: File;
    pdfTotalPages?: number;
}

/** Read a chapter's slides directly (the route store only holds the open chapter). */
const fetchChapterSlides = async (chapterId: string) => {
    const response = await authenticatedAxiosInstance.get(`${GET_SLIDES}?chapterId=${chapterId}`);
    return Array.isArray(response.data) ? response.data : [];
};

export const useAddToCourse = () => {
    const queryClient = useQueryClient();
    const { t } = useTranslation('studyLibraryUseAddToCourse');
    const [isCreating, setIsCreating] = useState(false);

    const create = async ({
        destinations,
        title,
        content,
        assessmentMode = 'QUIZ',
        notesFormat = 'DOC',
        status,
        watermarkDataUrl,
        pdfFile,
        pdfTotalPages,
    }: CreateArgs): Promise<{ createdIds: string[]; failed: AddToCourseDestination[] }> => {
        const instituteId = getInstituteId();
        if (!instituteId) throw new Error(t('errors.noInstitute'));

        const targets = (destinations ?? []).filter((d) => d.chapterId && d.packageSessionId);
        if (targets.length === 0) {
            throw new Error(t('errors.pickDestination'));
        }

        const finalTitle =
            title.trim() || (content.kind === 'NOTES' ? t('defaultTitles.notes') : t('defaultTitles.assessment'));
        const slideStatus = status ?? getSlideStatusForUser();

        setIsCreating(true);
        try {
            // ---- Prepare the shared payload ONCE (so a PDF is rendered/uploaded
            // a single time even when adding to many chapters) ----------------
            let docHtml: string | null = null;
            let pdfFileId: string | null = null;
            let pdfPages = 1;
            let quizQuestions: ReturnType<typeof transformGeneratedQuestions> | null = null;
            let linkAssessmentId: string | null = null;

            if (content.kind === 'NOTES') {
                docHtml = formatHTMLString(notesMarkdownToHtml(content.markdown || ''));
                // Same guard the editor uses, so we never persist a blank slide.
                if (checkIsHtmlEmpty(docHtml)) {
                    throw new Error(t('errors.emptyNotes'));
                }
                if (notesFormat === 'PDF') {
                    let file = pdfFile;
                    pdfPages = pdfTotalPages ?? 1;
                    if (!file) {
                        const { pdfBlob, totalPages } = await convertHtmlToPdf(docHtml, {
                            watermarkDataUrl,
                        });
                        file = new File([pdfBlob], `${finalTitle || 'notes'}.pdf`, {
                            type: 'application/pdf',
                        });
                        pdfPages = totalPages || 1;
                    }
                    pdfFileId =
                        (await UploadFileInS3(
                            file,
                            undefined,
                            instituteId,
                            'PDF_DOCUMENTS',
                            undefined,
                            false
                        )) ?? null;
                    if (!pdfFileId) throw new Error(t('errors.pdfUploadFailed'));
                }
            } else if (assessmentMode === 'ASSESSMENT') {
                if (!content.assessmentId) {
                    throw new Error(t('errors.publishAssessmentFirst'));
                }
                linkAssessmentId = content.assessmentId;
            } else {
                quizQuestions = transformGeneratedQuestions(content.questions || []);
                if (quizQuestions.length === 0) {
                    throw new Error(t('errors.noQuestions'));
                }
            }

            // ---- Create the slide in each destination chapter ----------------
            // A per-destination failure doesn't abort the others (so one bad
            // chapter can't leave a half-finished batch). We return WHICH ones
            // failed so the caller can keep only those for a retry — that's what
            // prevents re-creating (duplicating) the slides that already landed.
            const createdIds: string[] = [];
            const failed: AddToCourseDestination[] = [];
            for (const dest of targets) {
                try {
                    const existing = await fetchChapterSlides(dest.chapterId);
                    const slideOrder = getNextSlideOrder(existing);
                    const ctx: BulkSlideContext = {
                        chapterId: dest.chapterId,
                        moduleId: dest.moduleId,
                        subjectId: dest.subjectId,
                        packageSessionId: dest.packageSessionId,
                        instituteId,
                        status: slideStatus,
                        notify: false,
                    };

                    let newSlideId: string;
                    if (content.kind === 'NOTES' && notesFormat === 'PDF') {
                        newSlideId = await createPdfSlide(ctx, {
                            title: finalTitle,
                            fileId: pdfFileId!,
                            totalPages: pdfPages,
                            slideOrder,
                        });
                    } else if (content.kind === 'NOTES') {
                        newSlideId = await createDocHtmlSlide(ctx, {
                            title: finalTitle,
                            html: docHtml!,
                            totalPages: 1,
                            slideOrder,
                        });
                    } else if (assessmentMode === 'ASSESSMENT') {
                        newSlideId = await createAssessmentLinkSlide(ctx, {
                            title: finalTitle,
                            assessmentId: linkAssessmentId!,
                            slideOrder,
                        });
                    } else {
                        newSlideId = await createQuizSlide(ctx, {
                            title: finalTitle,
                            questions: quizQuestions!,
                            slideOrder,
                        });
                    }
                    createdIds.push(newSlideId);
                    queryClient.invalidateQueries({ queryKey: ['slides', dest.chapterId] });
                } catch (err) {
                    failed.push(dest);
                    // eslint-disable-next-line no-console
                    console.error(
                        '[add-to-course] failed to create slide for chapter',
                        dest.chapterId,
                        err
                    );
                }
            }

            queryClient.invalidateQueries({ queryKey: ['GET_MODULES_WITH_CHAPTERS'] });
            if (createdIds.length === 0) {
                throw new Error(t('errors.allChaptersFailed'));
            }
            return { createdIds, failed };
        } finally {
            setIsCreating(false);
        }
    };

    return { create, isCreating };
};
