/**
 * "Document + Quiz" slide: an ordinary QUIZ slide (questions, attempts and progress
 * exactly as today) whose `quiz_slide.title` holds a small JSON marker naming the
 * PDF shown beside the questions:
 *
 *   {"kind":"DOCUMENT_QUIZ","v":1,"file_id":"…","file_name":"…","source":"PDF"}
 *
 * `quiz_slide.title` is never shown (everyone sees `slide.title`), is not
 * translated, is returned by every slide query and is copied verbatim when a slide
 * or course is duplicated, so no migration is needed. A quiz whose title is not this
 * marker is a plain quiz. The learner app parses the same shape
 * (slide-material/document-quiz-ref.ts) and admin_core checks it in DocumentQuizMarker.java.
 */

export const DOCUMENT_QUIZ_KIND = 'DOCUMENT_QUIZ';

/** quiz_slide.title is varchar(255). */
export const DOCUMENT_QUIZ_MAX_LENGTH = 255;

/** PPT/PPTX uploads are converted to PDF first; `source` only records where it came from. */
export type DocumentQuizSource = 'PDF' | 'PPT';

export interface DocumentQuizRef {
    /** The PDF's file id (media service). */
    fileId: string;
    /** Original file name, for the admin preview. May be shortened to fit the column. */
    fileName: string;
    source: DocumentQuizSource;
}

const encode = (ref: DocumentQuizRef, fileName: string): string =>
    JSON.stringify({
        kind: DOCUMENT_QUIZ_KIND,
        v: 1,
        file_id: ref.fileId,
        file_name: fileName,
        source: ref.source,
    });

/**
 * The marker stored in quiz_slide.title. The file name is shortened (never the
 * file id) so the whole value fits the column. Throws on a blank file id.
 */
export function serializeDocumentQuizRef(ref: DocumentQuizRef): string {
    const fileId = (ref.fileId || '').trim();
    if (!fileId) throw new Error('A document is required');
    const clean = { ...ref, fileId };
    let name = Array.from((ref.fileName || '').trim());
    let out = encode(clean, name.join(''));
    while (out.length > DOCUMENT_QUIZ_MAX_LENGTH && name.length > 0) {
        name = name.slice(
            0,
            Math.max(0, name.length - Math.max(1, out.length - DOCUMENT_QUIZ_MAX_LENGTH))
        );
        out = encode(clean, name.join(''));
    }
    if (out.length > DOCUMENT_QUIZ_MAX_LENGTH) throw new Error('Document id is too long');
    return out;
}

/** The document reference, or null for a plain quiz (any title that is not the marker). */
export function parseDocumentQuizRef(raw: unknown): DocumentQuizRef | null {
    if (typeof raw !== 'string') return null;
    const text = raw.trim();
    if (!text.startsWith('{') || text.length > DOCUMENT_QUIZ_MAX_LENGTH) return null;
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        return null;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const obj = value as Record<string, unknown>;
    if (obj.kind !== DOCUMENT_QUIZ_KIND) return null;
    if (typeof obj.file_id !== 'string' || !obj.file_id.trim()) return null;
    return {
        fileId: obj.file_id.trim(),
        fileName: typeof obj.file_name === 'string' ? obj.file_name : '',
        source: obj.source === 'PPT' ? 'PPT' : 'PDF',
    };
}

/**
 * quiz_slide.title after the admin renames the slide. A plain quiz follows the new
 * heading as before; a Document + Quiz slide keeps its marker, or the editor would
 * lose the document until the next reload.
 */
export function quizTitleAfterRename(
    currentTitle: string | null | undefined,
    heading: string
): string {
    return currentTitle && parseDocumentQuizRef(currentTitle) ? currentTitle : heading;
}

/** True for a QUIZ slide that carries a document. */
export function isDocumentQuizSlide(
    slide:
        | { source_type?: string | null; quiz_slide?: { title?: string | null } | null }
        | null
        | undefined
): boolean {
    if (!slide || (slide.source_type || '').toUpperCase() !== 'QUIZ') return false;
    return parseDocumentQuizRef(slide.quiz_slide?.title) !== null;
}
