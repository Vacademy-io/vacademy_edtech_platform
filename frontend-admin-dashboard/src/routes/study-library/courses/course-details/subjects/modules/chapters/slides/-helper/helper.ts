/* eslint-disable */
import { QuestionType } from '@/constants/dummy-data';
import {
    getEvaluationJSON,
    transformResponseDataToMyQuestionsSchema,
    transformResponseDataToMyQuestionsSchemaSingleQuestion,
} from '@/routes/assessment/question-papers/-utils/helper';
// Lazily load heavy libs at call sites
import { AssignmentSlide, Slide } from '../-hooks/use-slides';
import { MyQuestion } from '@/types/assessments/question-paper-form';
import { convertToUTC } from '@/routes/homework-creation/create-assessment/$assessmentId/$examtype/-utils/helper';
import {
    AssignmentFormType,
    decodeAllowedFileTypes,
    encodeAllowedFileTypes,
} from '../-form-schemas/assignmentFormSchema';
import { parseHtmlToString } from '@/lib/utils';
import type { TFunction } from 'i18next';

// Convert a UTC ISO timestamp from the backend ("2026-03-25T09:00:00Z")
// into a "YYYY-MM-DDTHH:mm" string in the admin's LOCAL timezone for the
// <input type="datetime-local"> control. The shared `convertDateFormat`
// helper does .toISOString().slice(0,16) which leaks UTC into the form,
// causing the admin to see times shifted by their TZ offset on reload.
const isoUtcToLocalDatetimeLocal = (iso: string | undefined | null): string => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};



export const convertHtmlToPdf = async (
    htmlString: string,
    options?: { watermarkDataUrl?: string | null }
): Promise<{ pdfBlob: Blob; totalPages: number }> => {
    // Create temporary div to hold the HTML content. Tag it with the global
    // .rich-text-content class so the slide's tables/lists/headings/paragraph
    // spacing are styled in the capture — otherwise Tailwind's preflight (applied
    // app-wide) strips borders/markers/margins and the PDF comes out unformatted.
    const tempDiv: HTMLElement = document.createElement('div');
    tempDiv.className = 'rich-text-content';
    tempDiv.innerHTML = htmlString;

    // Pre-process images
    const imageElements = tempDiv.querySelectorAll('img');
    for (const img of Array.from(imageElements)) {
        // Fix zero width/height images
        if (img.width === 0 || img.height === 0) {
            img.width = 400;
            img.height = 300;
            img.style.maxWidth = '100%';
            img.style.height = 'auto';
        }

        // Make sure image has proper loading attributes
        img.crossOrigin = 'anonymous';
        img.loading = 'eager';
    }

    // Create an offscreen container that's outside the viewport
    tempDiv.style.position = 'absolute';
    tempDiv.style.top = '-9999px';
    tempDiv.style.left = '-9999px';
    tempDiv.style.width = '210mm'; // A4 width
    tempDiv.style.backgroundColor = 'white';
    tempDiv.style.padding = '10mm';
    // Don't constrain height

    // Append to body temporarily
    document.body.appendChild(tempDiv);

    try {
        // Wait for any potential image loading and layout
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Initialize PDF
        const { default: jsPDF } = await import('jspdf');
        const pdf = new jsPDF({
            orientation: 'portrait',
            unit: 'mm',
            format: 'a4',
            compress: true,
        });

        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = pdf.internal.pageSize.getHeight();

        const content = tempDiv;

        // Collect safe page-break points: the TOP of each block-level element, so a
        // page never splits a block mid-way. offsetTop is relative to tempDiv (the
        // nearest positioned ancestor), matching the captured canvas's coordinates.
        let blocks = Array.from(content.children) as HTMLElement[];
        const onlyChild = blocks.length === 1 ? blocks[0] : undefined;
        if (onlyChild && onlyChild.children.length > 1) {
            // Yoopta sometimes wraps all blocks in a single container div.
            blocks = Array.from(onlyChild.children) as HTMLElement[];
        }
        const blockTops = blocks.map((el) => el.offsetTop);

        const { default: html2canvas } = await import('html2canvas');
        const canvas = await html2canvas(content, {
            scale: 2, // sharper text/images than 1.5
            useCORS: true,
            logging: false,
            backgroundColor: '#ffffff', // design-lint-ignore: html2canvas render background (canvas API, not a UI token)
            width: content.scrollWidth,
            height: content.scrollHeight,
            windowWidth: content.scrollWidth,
            windowHeight: content.scrollHeight,
            allowTaint: true,
        });

        // Paginate by slicing the canvas at block boundaries (not fixed heights), so
        // headings/paragraphs/list-items/table rows aren't cut across pages. Each
        // slice is added top-aligned at the page width, preserving aspect ratio (no
        // stretching). A block taller than a page is hard-cut as a fallback.
        const imgWidth = pdfWidth;
        const renderScale = canvas.width / content.scrollWidth; // html2canvas scale actually used
        const pxPerPage = pdfHeight * (canvas.width / pdfWidth); // one A4 page in canvas px
        const candidates = Array.from(
            new Set([0, ...blockTops.map((t) => Math.round(t * renderScale)), canvas.height])
        )
            .filter((y) => y >= 0 && y <= canvas.height)
            .sort((a, b) => a - b);

        const pages: Array<[number, number]> = [];
        let y = 0;
        while (y < canvas.height - 1) {
            const maxY = y + pxPerPage;
            let next = -1;
            for (const c of candidates) {
                if (c > y && c <= maxY) next = c; // furthest break that still fits a page
            }
            if (next === -1) next = Math.min(Math.round(maxY), canvas.height); // oversized block
            pages.push([y, next]);
            y = next;
        }
        if (pages.length === 0) pages.push([0, canvas.height]);

        for (let i = 0; i < pages.length; i++) {
            const [y0, y1] = pages[i]!;
            const sliceH = Math.max(1, y1 - y0);
            const sliceCanvas = document.createElement('canvas');
            sliceCanvas.width = canvas.width;
            sliceCanvas.height = sliceH;
            const ctx = sliceCanvas.getContext('2d');
            if (ctx) {
                ctx.fillStyle = '#ffffff'; // design-lint-ignore: canvas fill color (canvas API, not a UI token)
                ctx.fillRect(0, 0, canvas.width, sliceH);
                ctx.drawImage(canvas, 0, y0, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
            }
            const sliceImg = sliceCanvas.toDataURL('image/jpeg', 0.85);
            const sliceImgHeight = (sliceH * imgWidth) / canvas.width;
            if (i > 0) pdf.addPage();
            pdf.addImage(sliceImg, 'JPEG', 0, 0, imgWidth, sliceImgHeight, undefined, 'FAST');

            // Optional centred, faint institute-logo watermark on every page.
            // Best-effort: never block PDF generation if the stamp fails.
            if (options?.watermarkDataUrl) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const anyPdf = pdf as any;
                const GState = anyPdf.GState;
                try {
                    const props = anyPdf.getImageProperties(options.watermarkDataUrl);
                    const wmWidth = pdfWidth * 0.5;
                    const wmHeight = (props.height / props.width) * wmWidth;
                    const wmX = (pdfWidth - wmWidth) / 2;
                    const wmY = (pdfHeight - wmHeight) / 2;
                    if (GState) anyPdf.setGState(new GState({ opacity: 0.08 }));
                    pdf.addImage(
                        options.watermarkDataUrl,
                        'PNG',
                        wmX,
                        wmY,
                        wmWidth,
                        wmHeight,
                        undefined,
                        'FAST'
                    );
                } catch {
                    // ignore — watermark is decorative
                } finally {
                    // Always restore full opacity so a mid-stamp failure can't
                    // leave the NEXT page's content faint.
                    if (GState) {
                        try {
                            anyPdf.setGState(new GState({ opacity: 1 }));
                        } catch {
                            /* ignore */
                        }
                    }
                }
            }
        }
        const totalPages = pages.length;

        // Generate the PDF blob
        const pdfOutput = pdf.output('datauristring');
        const pdfBlob = await fetch(pdfOutput).then((res) => res.blob());
        return {
            pdfBlob: new Blob([pdfBlob], { type: 'application/pdf' }),
            totalPages,
        };
    } finally {
        // Clean up
        if (document.body.contains(tempDiv)) {
            document.body.removeChild(tempDiv);
        }
    }
};

export function updateDocumentDataInSlides<T>(
    data: Slide[],
    slide: Slide,
    formData: T,
    setActiveItem: (item: Slide) => void
): Slide[] {
    return data.map((item) => {
        if (item.id === slide.id) {
            const changedData: Slide = {
                ...item,
                // document_data: JSON.stringify(formData),
            };
            setActiveItem(changedData);
            return changedData;
        }
        return item;
    });
}

export const formatTimeStudyLibraryInSeconds = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${hrs}:${mins < 10 ? '0' + mins : mins}:${secs < 10 ? '0' + secs : secs}`;
};

export function convertStudyLibraryQuestion(question: MyQuestion) {
    let options;
    if (question.questionType === QuestionType.MCQS) {
        options = question?.singleChoiceOptions?.map((opt, idx) => ({
            id: opt.id, // Assuming no direct mapping for option ID
            preview_id: idx, // Using index as preview_id
            question_id: null,
            text: {
                id: null, // Assuming no direct mapping for option text ID
                type: 'HTML', // Assuming option content is HTML
                content: opt?.name,
            },
            explanation_text: {
                id: null, // Assuming no direct mapping for explanation text ID
                type: 'HTML', // Assuming explanation for options is in HTML
                content: question.explanation, // Assuming no explanation provided for options
            },
        }));
    } else if (question?.questionType === QuestionType.TRUE_FALSE) {
        options = question?.trueFalseOptions?.map((opt, idx) => ({
            id: opt.id, // Assuming no direct mapping for option ID
            preview_id: idx, // Using index as preview_id
            text: {
                id: null, // Assuming no direct mapping for option text ID
                type: 'HTML', // Assuming option content is HTML
                content: idx === 0 ? 'TRUE' : 'FALSE', // First option is TRUE, second is FALSE
            },
            explanation_text: {
                id: null, // Assuming no direct mapping for explanation text ID
                type: 'HTML', // Assuming explanation for options is in HTML
                content: question.explanation, // Assuming no explanation provided for options
            },
        }));
    } else if (question?.questionType === QuestionType.MCQM) {
        options = question?.multipleChoiceOptions?.map((opt, idx) => ({
            id: opt.id, // Assuming no direct mapping for option ID
            preview_id: idx, // Using index as preview_id
            text: {
                id: null, // Assuming no direct mapping for option text ID
                type: 'HTML', // Assuming option content is HTML
                content: opt?.name,
            },
            explanation_text: {
                id: null, // Assuming no direct mapping for explanation text ID
                type: 'HTML', // Assuming explanation for options is in HTML
                content: question.explanation, // Assuming no explanation provided for options
            },
        }));
    } else if (question?.questionType === QuestionType.CMCQS) {
        options = question?.csingleChoiceOptions?.map((opt, idx) => ({
            id: opt.id, // Assuming no direct mapping for option ID
            preview_id: idx, // Using index as preview_id
            text: {
                id: null, // Assuming no direct mapping for option text ID
                type: 'HTML', // Assuming option content is HTML
                content: opt?.name,
            },
            explanation_text: {
                id: null, // Assuming no direct mapping for explanation text ID
                type: 'HTML', // Assuming explanation for options is in HTML
                content: question.explanation, // Assuming no explanation provided for options
            },
        }));
    } else if (question?.questionType === QuestionType.CMCQM) {
        options = question?.cmultipleChoiceOptions?.map((opt, idx) => ({
            id: opt.id, // Assuming no direct mapping for option ID
            preview_id: idx, // Using index as preview_id
            text: {
                id: null, // Assuming no direct mapping for option text ID
                type: 'HTML', // Assuming option content is HTML
                content: opt?.name,
            },
            explanation_text: {
                id: null, // Assuming no direct mapping for explanation text ID
                type: 'HTML', // Assuming explanation for options is in HTML
                content: question.explanation, // Assuming no explanation provided for options
            },
        }));
    }

    // Extract correct option indices as strings
    let correctOptionIds;

    if (question?.questionType === QuestionType.MCQS) {
        correctOptionIds = question?.singleChoiceOptions
            ?.map((opt, idx) => (opt.isSelected ? (opt.id ? opt.id : idx.toString()) : null))
            .filter((idx) => idx !== null); // Remove null values
    } else if (question?.questionType === QuestionType.MCQM) {
        correctOptionIds = question?.multipleChoiceOptions
            ?.map((opt, idx) => (opt.isSelected ? (opt.id ? opt.id : idx.toString()) : null))
            .filter((idx) => idx !== null); // Remove null values
    } else if (question?.questionType === QuestionType.CMCQS) {
        correctOptionIds = question?.csingleChoiceOptions
            ?.map((opt, idx) => (opt.isSelected ? (opt.id ? opt.id : idx.toString()) : null))
            .filter((idx) => idx !== null); // Remove null values
    } else if (question?.questionType === QuestionType.CMCQM) {
        correctOptionIds = question?.cmultipleChoiceOptions
            ?.map((opt, idx) => (opt.isSelected ? (opt.id ? opt.id : idx.toString()) : null))
            .filter((idx) => idx !== null); // Remove null values
    } else if (question?.questionType === QuestionType.TRUE_FALSE) {
        correctOptionIds = question?.trueFalseOptions
            ?.map((opt, idx) => (opt.isSelected ? (opt.id ? opt.id : idx.toString()) : null))
            .filter((idx) => idx !== null); // Remove null values
    }

    const auto_evaluation_json = getEvaluationJSON(
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        question!,
        correctOptionIds,
        question?.validAnswers,
        question?.subjectiveAnswerText
    );

    return {
        id: question.id ? question.id : crypto.randomUUID(),
        parent_rich_text: generateTextBlock(question?.parentRichTextContent || ''),
        text_data: generateTextBlock(question?.questionName || ''),
        explanation_text_data: generateTextBlock(question?.explanation || ''),
        media_id: '',
        question_response_type: 'OPTION',
        question_type: question?.questionType,
        access_level: 'PUBLIC',
        auto_evaluation_json: auto_evaluation_json,
        evaluation_type: 'AUTO',
        question_time_in_millis: timestampToSeconds(question.timestamp) * 1000,
        question_order: 0,
        status: question?.status || 'ACTIVE',
        options: options?.map((opt, idx) => ({
            id: opt.id || null,
            preview_id: opt.id || idx,
            text: generateTextBlock(opt.text?.content || ''),
            explanationTextData: generateTextBlock(opt.explanation_text?.content || ''),
            mediaId: '',
        })),
        new_question: question.newQuestion === false ? false : true,
        can_skip: question.canSkip,
    };
}

export const converDataToVideoFormat = ({
    activeItem,
    status,
    notify,
    newSlide,
}: {
    activeItem: Slide;
    status: string;
    notify: boolean;
    newSlide: boolean;
}) => {
    // Check if this is a split screen slide and include embedded data
    const splitData = (activeItem as any).splitScreenData;
    const splitType = (activeItem as any).splitScreenType;
    const isSplitScreen = (activeItem as any).splitScreenMode;

    const videoSlideData = {
        id: activeItem?.video_slide?.id || '',
        description: activeItem?.video_slide?.description || '',
        title: activeItem?.video_slide?.title || '',
        url: '',
        video_length_in_millis: activeItem?.video_slide?.video_length_in_millis || 0,
        published_url: activeItem?.video_slide?.url || activeItem?.video_slide?.published_url || '',
        published_video_length_in_millis:
            activeItem?.video_slide?.published_video_length_in_millis || 0,
        source_type: '',
        questions:
            activeItem?.video_slide?.questions.map((question) =>
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-expect-error
                convertStudyLibraryQuestion(question)
            ) || [],
        // Include embedded data for split screen slides
        ...(isSplitScreen &&
            splitData &&
            splitType && {
                embedded_type: splitType.replace('SPLIT_', ''),
                embedded_data: JSON.stringify(splitData),
            }),
    };

    return {
        id: activeItem?.id || '',
        title: activeItem?.title || '',
        description: activeItem?.description || '',
        image_file_id: activeItem?.image_file_id || '',
        source_id: activeItem?.video_slide?.id || '',
        source_type: activeItem?.source_type || '',
        status: status,
        slide_order: newSlide ? 0 : (activeItem?.slide_order || 0),
        video_slide: videoSlideData,
        document_slide: null,
        question_slide: null,
        assignment_slide: null,
        is_loaded: true,
        new_slide: newSlide,
        notify,
    };
};

export const convertToAssignmentSlideBackendFormat = (assignmentSlide: AssignmentFormType) => {
    const convertedStartDate = assignmentSlide.hasDateRange ? convertToUTC(assignmentSlide.startDate || '') : '';
    const convertedEndDate = assignmentSlide.hasDateRange ? convertToUTC(assignmentSlide.endDate || '') : '';

    return {
        id: assignmentSlide.id,
        parent_rich_text: {
            id: assignmentSlide.parentRichTextId || '',
            type: 'RICH_TEXT',
            content: assignmentSlide.taskDescription,
        },
        text_data: {
            id: assignmentSlide.textDataId || '',
            type: 'TEXT',
            content: assignmentSlide.task,
        },
        live_date: convertedStartDate,
        end_date: convertedEndDate,
        re_attempt_count: assignmentSlide.reattemptCount,
        total_marks: assignmentSlide.totalMarks ?? null,
        passing_marks: assignmentSlide.passingMarks ?? null,
        // Reuses the otherwise-unused comma_separated_media_ids column to carry
        // the admin's allowed-file-types selection (prefixed with `types:`).
        comma_separated_media_ids: encodeAllowedFileTypes(assignmentSlide.allowedFileTypes),
        questions: assignmentSlide.adaptive_marking_for_each_question.map((question, idx) => {
            return {
                id: question.questionId,
                text_data: {
                    id: '',
                    type: 'text',
                    content: question.questionName,
                },
                question_order: idx,
                status: 'ACTIVE',
                question_type: question.questionType,
                new_question: question.newQuestion,
                ...(question.options?.length
                    ? {
                          options: question.options.map((opt) => ({
                              id: opt.id,
                              text: { id: null, type: 'HTML', content: opt.text.content },
                          })),
                      }
                    : {}),
            };
        }),
    };
};

export const converDataToAssignmentFormat = ({
    activeItem,
    status,
    notify,
    newSlide,
}: {
    activeItem: Slide;
    status: string;
    notify: boolean;
    newSlide: boolean;
}) => {
    return {
        id: activeItem?.id || '',
        title: activeItem?.title || '',
        description: activeItem?.description || '',
        image_file_id: activeItem?.image_file_id || '',
        source_id: activeItem?.source_id || '',
        source_type: activeItem?.source_type || '',
        status: status,
        slide_order: newSlide ? 0 : (activeItem?.slide_order || 0),
        video_slide: null,
        document_slide: null,
        question_slide: null,
        assignment_slide: activeItem.assignment_slide
            ? convertToAssignmentSlideBackendFormat(activeItem.assignment_slide as any)
            : null,
        is_loaded: true,
        new_slide: newSlide,
        notify,
    };
};

export function convertToQuestionSlideFormat(question: MyQuestion, sourceId?: string) {
    let options;
    if (question?.questionType === QuestionType.MCQS) {
        options = question?.singleChoiceOptions?.map((opt, idx) => ({
            id: opt.id, // Assuming no direct mapping for option ID
            preview_id: idx, // Using index as preview_id
            question_id: null,
            text: {
                id: null, // Assuming no direct mapping for option text ID
                type: 'HTML', // Assuming option content is HTML
                content: opt?.name,
            },
            explanation_text: {
                id: null, // Assuming no direct mapping for explanation text ID
                type: 'HTML', // Assuming explanation for options is in HTML
                content: question.explanation, // Assuming no explanation provided for options
            },
        }));
    } else if (question?.questionType === QuestionType.TRUE_FALSE) {
        options = question?.trueFalseOptions?.map((opt, idx) => ({
            id: opt.id, // Assuming no direct mapping for option ID
            text: {
                id: null, // Assuming no direct mapping for option text ID
                type: 'HTML', // Assuming option content is HTML
                content: idx === 0 ? 'TRUE' : 'FALSE', // First option is TRUE, second is FALSE
            },
            explanation_text: {
                id: null, // Assuming no direct mapping for explanation text ID
                type: 'HTML', // Assuming explanation for options is in HTML
                content: question.explanation, // Assuming no explanation provided for options
            },
        }));
    } else if (question?.questionType === QuestionType.MCQM) {
        options = question?.multipleChoiceOptions?.map((opt) => ({
            id: opt.id, // Assuming no direct mapping for option ID
            text: {
                id: null, // Assuming no direct mapping for option text ID
                type: 'HTML', // Assuming option content is HTML
                content: opt?.name,
            },
            explanation_text: {
                id: null, // Assuming no direct mapping for explanation text ID
                type: 'HTML', // Assuming explanation for options is in HTML
                content: question.explanation, // Assuming no explanation provided for options
            },
        }));
    } else if (question?.questionType === QuestionType.CMCQS) {
        options = question?.csingleChoiceOptions?.map((opt) => ({
            id: opt.id, // Assuming no direct mapping for option ID
            text: {
                id: null, // Assuming no direct mapping for option text ID
                type: 'HTML', // Assuming option content is HTML
                content: opt?.name,
            },
            explanation_text: {
                id: null, // Assuming no direct mapping for explanation text ID
                type: 'HTML', // Assuming explanation for options is in HTML
                content: question.explanation, // Assuming no explanation provided for options
            },
        }));
    } else if (question?.questionType === QuestionType.CMCQM) {
        options = question?.cmultipleChoiceOptions?.map((opt) => ({
            id: opt.id, // Assuming no direct mapping for option ID
            text: {
                id: null, // Assuming no direct mapping for option text ID
                type: 'HTML', // Assuming option content is HTML
                content: opt?.name,
            },
            explanation_text: {
                id: null, // Assuming no direct mapping for explanation text ID
                type: 'HTML', // Assuming explanation for options is in HTML
                content: question.explanation, // Assuming no explanation provided for options
            },
        }));
    }

    // Extract correct option indices as strings
    let correctOptionIds;

    if (question?.questionType === QuestionType.MCQS) {
        correctOptionIds = question?.singleChoiceOptions
            ?.map((opt, idx) => (opt.isSelected ? (opt.id ? opt.id : idx.toString()) : null))
            .filter((idx) => idx !== null); // Remove null values
    } else if (question?.questionType === QuestionType.MCQM) {
        correctOptionIds = question?.multipleChoiceOptions
            ?.map((opt, idx) => (opt.isSelected ? (opt.id ? opt.id : idx.toString()) : null))
            .filter((idx) => idx !== null); // Remove null values
    } else if (question?.questionType === QuestionType.CMCQS) {
        correctOptionIds = question?.csingleChoiceOptions
            ?.map((opt, idx) => (opt.isSelected ? (opt.id ? opt.id : idx.toString()) : null))
            .filter((idx) => idx !== null); // Remove null values
    } else if (question?.questionType === QuestionType.CMCQM) {
        correctOptionIds = question?.cmultipleChoiceOptions
            ?.map((opt, idx) => (opt.isSelected ? (opt.id ? opt.id : idx.toString()) : null))
            .filter((idx) => idx !== null); // Remove null values
    } else if (question?.questionType === QuestionType.TRUE_FALSE) {
        correctOptionIds = question?.trueFalseOptions
            ?.map((opt, idx) => (opt.isSelected ? (opt.id ? opt.id : idx.toString()) : null))
            .filter((idx) => idx !== null); // Remove null values
    }

    const auto_evaluation_json = getEvaluationJSON(
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        question!,
        correctOptionIds,
        question?.validAnswers,
        question?.subjectiveAnswerText
    );

    return {
        id: sourceId ? sourceId : crypto.randomUUID(),
        parent_rich_text: generateTextBlock(question?.parentRichTextContent || ''),
        text_data: generateTextBlock(question?.questionName || ''),
        explanation_text_data: generateTextBlock(question?.explanation || ''),
        media_id: '',
        question_response_type: 'OPTION',
        question_type: question?.questionType,
        access_level: 'PUBLIC',
        auto_evaluation_json: auto_evaluation_json,
        evaluation_type: 'AUTO',
        default_question_time_mins: parseInt(question?.questionDuration?.min || '0'),
        re_attempt_count: question?.reattemptCount || '',
        points: '0',
        options: options?.map((opt, idx) => ({
            id: opt?.id || '',
            preview_id: opt?.id || idx,
            questionSlideId: '',
            text: generateTextBlock(opt?.text?.content || ''),
            explanationTextData: generateTextBlock(opt?.explanation_text?.content || ''),
            mediaId: '',
        })),
        source_type: 'QUESTION',
    };
}

export function convertToQuestionBackendSlideFormat({
    activeItem,
    status,
    notify,
    newSlide,
}: {
    activeItem: Slide;
    status: string;
    notify: boolean;
    newSlide: boolean;
}) {
    return {
        id: activeItem?.id || '',
        title: activeItem?.title || '',
        description: activeItem?.description || '',
        image_file_id: activeItem?.image_file_id || '',
        source_id: activeItem?.source_id || '',
        source_type: activeItem?.source_type || '',
        status: status,
        slide_order: newSlide ? 0 : (activeItem?.slide_order || 0),
        video_slide: null,
        document_slide: null,
        question_slide: activeItem.question_slide
            ? convertToQuestionSlideFormat(activeItem.question_slide as any, activeItem?.source_id)
            : null,
        assignment_slide: null,
        is_loaded: true,
        new_slide: newSlide,
        notify,
    };
}
export function convertToQuizBackendSlideFormat({
    activeItem,
    status,
    notify,
    newSlide,
    t,
}: {
    activeItem: Slide;
    status: string;
    notify: boolean;
    newSlide: boolean;
    /** Threaded in from the calling component's `useTranslation()` — this
     *  helper isn't a component/hook, so it can't call useTranslation itself. */
    t: TFunction;
}) {
    return {
        id: activeItem?.id || '',
        title: activeItem?.title || '',
        description: activeItem?.description || '',
        image_file_id: activeItem?.image_file_id || '',
        source_id: activeItem?.source_id || '',
        source_type: activeItem?.source_type || 'QUIZE',
        status: status,
        slide_order: newSlide ? 0 : (activeItem?.slide_order || 0),
        video_slide: null,
        document_slide: null,
        question_slide: null,
        quiz_slide: activeItem?.quiz_slide
            ? convertToQuizSlideFormat(
                  activeItem.quiz_slide.questions as any,
                  t,
                  activeItem?.source_id
              )
            : null,
        assignment_slide: null,
        is_loaded: true,
        new_slide: newSlide,
        notify,
    };
}

export function timestampToSeconds(timestamp: string | undefined): number {
    if (!timestamp) return 0;
    const [hours = 0, minutes = 0, seconds = 0] = timestamp.split(':').map(Number);
    return hours * 3600 + minutes * 60 + seconds;
}

const transformAssignmentSlide = (assignment: AssignmentSlide) => {
    const startDate = isoUtcToLocalDatetimeLocal(assignment?.live_date || '');
    const endDate = isoUtcToLocalDatetimeLocal(assignment?.end_date || '');
    const hasDateRange = !!(startDate || endDate);
    return {
        id: assignment?.id,
        task: parseHtmlToString(assignment?.text_data?.content || ''),
        taskDescription: assignment?.parent_rich_text?.content || '',
        parentRichTextId: assignment?.parent_rich_text?.id || '',
        textDataId: assignment?.text_data?.id || '',
        hasDateRange,
        startDate,
        endDate,
        reattemptCount: String(assignment?.re_attempt_count || 0),
        totalMarks: assignment?.total_marks ?? undefined,
        passingMarks: assignment?.passing_marks ?? undefined,
        allowedFileTypes: decodeAllowedFileTypes(assignment?.comma_separated_media_ids),
        uploaded_question_paper: null,
        adaptive_marking_for_each_question:
            assignment?.questions?.map((question) => {
                return {
                    questionId: question?.id || '',
                    questionName: question?.text_data?.content || '',
                    questionType: question?.question_type || '',
                    newQuestion: question?.new_question || false,
                    options: question?.options?.map((opt: { id: string; text: { content: string } }) => ({
                        id: opt.id || '',
                        text: { content: opt.text?.content || '' },
                    })),
                };
            }) || [],
        totalParticipants: 0,
        submittedParticipants: 0,
    };
};

export function cleanVideoQuestions(data: Slide[]) {


    if (!data || !Array.isArray(data)) {

        return [];
    }

    // Fix null slide_order issues
    const dataWithFixedOrder = data.map((item, index) => {
        if (item.slide_order == null) {

            return { ...item, slide_order: index };
        }
        return item;
    });

    // Sort by slide_order to ensure proper ordering
    const sortedData = dataWithFixedOrder.sort(
        (a, b) => (a.slide_order || 0) - (b.slide_order || 0)
    );

    const cleanedData = sortedData.map((item, index) => {
        try {
            if (item.source_type === 'VIDEO' && item.video_slide) {
                // Check if this is a split screen video slide
                const videoSlide = item.video_slide as any;
                if (videoSlide.embedded_type && videoSlide.embedded_data) {
                    try {
                        // Parse the embedded data to reconstruct split screen slide
                        const splitScreenData = JSON.parse(videoSlide.embedded_data);

                        return {
                            ...item,
                            splitScreenMode: true,
                            splitScreenData: splitScreenData,
                            splitScreenType: `SPLIT_${videoSlide.embedded_type}`,
                            isNewSplitScreen: false, // Existing slides loaded from backend are not new
                            originalVideoSlide: {
                                ...videoSlide,
                                // Remove embedded fields from the original video slide
                                embedded_type: undefined,
                                embedded_data: undefined,
                            },
                            video_slide: {
                                ...videoSlide,
                                questions: transformResponseDataToMyQuestionsSchema(
                                    (videoSlide.questions as any) || []
                                ),
                            },
                        };
                    } catch (error) {

                        // Fall back to regular video slide if parsing fails
                        return {
                            ...item,
                            video_slide: {
                                ...item.video_slide,
                                questions: transformResponseDataToMyQuestionsSchema(
                                    (item.video_slide.questions as any) || []
                                ),
                            },
                        };
                    }
                }

                // Regular video slide processing
                return {
                    ...item,
                    video_slide: {
                        ...item.video_slide,

                        questions: transformResponseDataToMyQuestionsSchema(
                            (item.video_slide.questions as any) || []
                        ),
                    },
                };
            }
            if (item.source_type === 'QUESTION') {
                return {
                    ...item,
                    question_slide: transformResponseDataToMyQuestionsSchemaSingleQuestion(
                        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                        // @ts-expect-error
                        item.question_slide
                    ),
                };
            }
            if (item.source_type === 'ASSIGNMENT') {
                return {
                    ...item,
                    assignment_slide: transformAssignmentSlide(
                        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                        // @ts-expect-error
                        item.assignment_slide
                    ),
                };
            }
            if (item.source_type === 'QUIZE') {
                return {
                    ...item,
                    quiz_slide: {
                        ...item.quiz_slide,
                        questions: transformResponseDataToMyQuestionsSchema(
                            (item?.quiz_slide?.questions as any) || []
                        ),
                    },
                };
            }

            return item;
        } catch (error) {

            // Return the item as-is if transformation fails
            return item;
        }
    });

    return cleanedData;
}

export function convertToQuizSlideFormat(
  questionList: MyQuestion[],
  t: TFunction,
  sourceId?: string
) {
  const quizSlideId = sourceId ?? crypto.randomUUID();

  return {
    id: quizSlideId,
    title: t('studyLibrarySlidesHelper:quiz.untitledQuiz'),
    description: generateTextBlock(''),
    questions: questionList.map((q, index) => {
      // Get the appropriate options based on question type
      let options: any[] = [];
      let correctOptionIds: string[] = [];

      if (q.questionType === 'MCQS') {
        options = q.singleChoiceOptions?.map((opt, idx) => ({
          id: opt.id ?? crypto.randomUUID(),
          quiz_slide_question_id: '', // Backend will assign
          text: generateTextBlock(opt.name || ''),
          explanation_text: generateTextBlock(q.explanation || ''),
          media_id: '',
        })) || [];

        correctOptionIds = q.singleChoiceOptions
          ?.map((opt, idx) => (opt.isSelected ? opt.id ?? idx.toString() : null))
          .filter((id): id is string => id !== null) || [];
      } else if (q.questionType === 'MCQM') {
        options = q.multipleChoiceOptions?.map((opt, idx) => ({
          id: opt.id ?? crypto.randomUUID(),
          quiz_slide_question_id: '', // Backend will assign
          text: generateTextBlock(opt.name || ''),
          explanation_text: generateTextBlock(q.explanation || ''),
          media_id: '',
        })) || [];

        correctOptionIds = q.multipleChoiceOptions
          ?.map((opt, idx) => (opt.isSelected ? opt.id ?? idx.toString() : null))
          .filter((id): id is string => id !== null) || [];
      } else if (q.questionType === 'TRUE_FALSE') {
        options = q.trueFalseOptions?.map((opt, idx) => ({
          id: opt.id ?? crypto.randomUUID(),
          quiz_slide_question_id: '', // Backend will assign
          text: generateTextBlock(idx === 0 ? 'TRUE' : 'FALSE'),
          explanation_text: generateTextBlock(q.explanation || ''),
          media_id: '',
        })) || [];

        correctOptionIds = q.trueFalseOptions
          ?.map((opt, idx) => (opt.isSelected ? opt.id ?? idx.toString() : null))
          .filter((id): id is string => id !== null) || [];
      }

      return {
        id: q.id ?? crypto.randomUUID(),
        parent_rich_text: generateTextBlock(q.parentRichTextContent || ''),
        text: generateTextBlock(q.questionName || ''),
        explanation_text: generateTextBlock(q.explanation || ''),
        media_id: '',
        status: q.status ?? 'DRAFT',
        question_response_type: 'SINGLE', // or derive from q.responseType
        question_type: q.questionType || 'MCQ',
        access_level: 'INSTITUTE',
        auto_evaluation_json: JSON.stringify({ correct: correctOptionIds }),
        evaluation_type: 'AUTO',
        question_order: index,
        quiz_slide_id: quizSlideId,
        can_skip: q.canSkip ?? true,
        options,
      };
    }),
  };
}
export function generateTextBlock(content: string) {
  return {
    id: crypto.randomUUID(),
    type: 'HTML',
    content: content,
  };
}
