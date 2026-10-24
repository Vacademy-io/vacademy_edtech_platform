import type { TFunction } from 'i18next';
import { Slide } from '../-hooks/use-slides';

/**
 * i18next namespace for this file's translated slide-type labels
 * (public/locales/{en,ar,hi,fr}/studyLibrarySlideNamingUtils.json).
 */
const NAMESPACE = 'studyLibrarySlideNamingUtils';

/**
 * Slide type mappings for generating unique names.
 *
 * These are the English fallback labels used when no `t` (i18next TFunction)
 * is threaded in by the caller — see `SLIDE_TYPE_NAME_KEYS` for the
 * translated counterparts.
 */
export const SLIDE_TYPE_NAMES = {
    // Document types
    DOC: 'Document',
    // Tiptap-based document (document_slide.type 'HTML') — same user-facing
    // name as DOC; the editor is an implementation detail.
    HTML: 'Document',
    PRESENTATION: 'Presentation',
    JUPYTER: 'Jupyter Notebook',
    SCRATCH: 'Scratch Project',
    CODE: 'Code Editor',

    // Video types
    VIDEO: 'Video',

    // Audio types
    AUDIO: 'Audio',

    // Question types
    QUESTION: 'Question',

    // Assignment types
    ASSIGNMENT: 'Assignment',

    // PDF types
    PDF: 'PDF Document',
} as const;

/** Translation key (under `types.*`) for each SLIDE_TYPE_NAMES entry. */
const SLIDE_TYPE_NAME_KEYS: Record<keyof typeof SLIDE_TYPE_NAMES, string> = {
    DOC: 'types.document',
    HTML: 'types.document',
    PRESENTATION: 'types.presentation',
    JUPYTER: 'types.jupyterNotebook',
    SCRATCH: 'types.scratchProject',
    CODE: 'types.codeEditor',
    VIDEO: 'types.video',
    AUDIO: 'types.audio',
    QUESTION: 'types.question',
    ASSIGNMENT: 'types.assignment',
    PDF: 'types.pdfDocument',
};

/**
 * Resolve the display label for one SLIDE_TYPE_NAMES entry, translated when
 * `t` is supplied. `t` is optional so call sites that haven't been threaded
 * through yet keep working exactly as before (English fallback).
 */
function translateSlideType(key: keyof typeof SLIDE_TYPE_NAMES, t?: TFunction): string {
    return t ? t(`${NAMESPACE}:${SLIDE_TYPE_NAME_KEYS[key]}`) : SLIDE_TYPE_NAMES[key];
}

/**
 * Get the slide type for naming based on slide properties
 */
export function getSlideTypeForNaming(slide: Partial<Slide>, t?: TFunction): string {
    // Handle document slides
    if (slide.source_type === 'DOCUMENT' && slide.document_slide?.type) {
        const docType = slide.document_slide.type;
        switch (docType) {
            case 'DOC':
                return translateSlideType('DOC', t);
            case 'HTML':
                return translateSlideType('HTML', t);
            case 'PRESENTATION':
                return translateSlideType('PRESENTATION', t);
            case 'JUPYTER':
                return translateSlideType('JUPYTER', t);
            case 'SCRATCH':
                return translateSlideType('SCRATCH', t);
            case 'CODE':
                return translateSlideType('CODE', t);
            default:
                return translateSlideType('DOC', t);
        }
    }

    // Handle video slides
    if (slide.source_type === 'VIDEO') {
        return translateSlideType('VIDEO', t);
    }

    // Handle question slides
    if (slide.source_type === 'QUESTION') {
        return translateSlideType('QUESTION', t);
    }

    // Handle assignment slides
    if (slide.source_type === 'ASSIGNMENT') {
        return translateSlideType('ASSIGNMENT', t);
    }

    // Handle audio slides
    if (slide.source_type === 'AUDIO') {
        return translateSlideType('AUDIO', t);
    }

    // Default fallback
    return t ? t(`${NAMESPACE}:types.slide`) : 'Slide';
}

/**
 * Count existing slides of the same type
 */
export function countSlidesOfType(allSlides: Slide[], targetSlideType: string): number {
    return allSlides.filter((slide) => {
        const slideType = getSlideTypeForNaming(slide);
        return slideType === targetSlideType;
    }).length;
}

/**
 * Generate a unique slide name based on type and existing titles
 */
export function generateUniqueSlideTitle(
    allSlides: Slide[],
    slideType: string,
    customPrefix?: string
): string {
    const typeForNaming = customPrefix || slideType;
    const existingTitles = new Set(allSlides.map((slide) => slide.title?.trim() || ''));

    let counter = 1;
    let candidateTitle = `${typeForNaming} ${counter}`;

    while (existingTitles.has(candidateTitle)) {
        counter++;
        candidateTitle = `${typeForNaming} ${counter}`;
    }

    return candidateTitle;
}

/**
 * Generate a unique slide name for document slides
 */
export function generateUniqueDocumentSlideTitle(
    allSlides: Slide[],
    documentType: string,
    t?: TFunction
): string {
    let slideTypeKey: keyof typeof SLIDE_TYPE_NAMES;

    switch (documentType) {
        case 'DOC':
            slideTypeKey = 'DOC';
            break;
        case 'HTML':
            slideTypeKey = 'HTML';
            break;
        case 'PRESENTATION':
            slideTypeKey = 'PRESENTATION';
            break;
        case 'JUPYTER':
            slideTypeKey = 'JUPYTER';
            break;
        case 'SCRATCH':
            slideTypeKey = 'SCRATCH';
            break;
        case 'CODE':
            slideTypeKey = 'CODE';
            break;
        default:
            slideTypeKey = 'DOC';
    }

    return generateUniqueSlideTitle(allSlides, translateSlideType(slideTypeKey, t));
}

/**
 * Generate a unique slide name for video slides
 */
export function generateUniqueVideoSlideTitle(allSlides: Slide[], t?: TFunction): string {
    return generateUniqueSlideTitle(allSlides, translateSlideType('VIDEO', t));
}

/**
 * Generate a unique slide name for question slides
 */
export function generateUniqueQuestionSlideTitle(allSlides: Slide[], t?: TFunction): string {
    return generateUniqueSlideTitle(allSlides, translateSlideType('QUESTION', t));
}

/**
 * Generate a unique slide name for assignment slides
 */
export function generateUniqueAssignmentSlideTitle(allSlides: Slide[], t?: TFunction): string {
    return generateUniqueSlideTitle(allSlides, translateSlideType('ASSIGNMENT', t));
}

/**
 * Generate a unique slide name for quiz slides
 */
export function generateUniqueQuizSlideTitle(allSlides: Slide[], t?: TFunction): string {
    return generateUniqueSlideTitle(allSlides, t ? t(`${NAMESPACE}:types.quiz`) : 'Quiz');
}

/**
 * Generate a unique slide name for audio slides
 */
export function generateUniqueAudioSlideTitle(allSlides: Slide[], t?: TFunction): string {
    return generateUniqueSlideTitle(allSlides, translateSlideType('AUDIO', t));
}

type SlideOrderInput = Pick<Slide, 'slide_order'> & Partial<Pick<Slide, 'id'>>;

export function getNextSlideOrder(slides: SlideOrderInput[] = []): number {
    if (!slides || slides.length === 0) return 0;
    let max = -1;
    for (const s of slides) {
        const v = typeof s.slide_order === 'number' ? s.slide_order : -1;
        if (v > max) max = v;
    }
    return max + 1;
}

export function buildAppendReorderPayload(
    newSlideId: string,
    currentSlides: Pick<Slide, 'id' | 'slide_order'>[] = []
): { slide_id: string; slide_order: number }[] {
    const others = (currentSlides || [])
        .filter((s) => s.id !== newSlideId)
        .slice()
        .sort((a, b) => (a.slide_order ?? 0) - (b.slide_order ?? 0));
    return [
        ...others.map((s, idx) => ({ slide_id: s.id, slide_order: idx })),
        { slide_id: newSlideId, slide_order: others.length },
    ];
}
