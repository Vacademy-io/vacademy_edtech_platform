/**
 * "Document + Quiz" slide: an ordinary QUIZ slide (questions, attempts and
 * progress exactly as today) whose `quiz_slide.title` holds a small JSON marker
 * naming the PDF shown beside the questions:
 *
 *   {"kind":"DOCUMENT_QUIZ","v":1,"file_id":"…","file_name":"…","source":"PDF"}
 *
 * `quiz_slide.title` is never shown to learners (they see `slide.title`), so any
 * quiz whose title is not this marker renders exactly as before. The admin app
 * writes the marker (document-quiz/document-quiz-ref.ts) and admin_core checks the
 * same shape (DocumentQuizMarker.java).
 */

export const DOCUMENT_QUIZ_KIND = "DOCUMENT_QUIZ";

/** quiz_slide.title is varchar(255); anything longer was never written by us. */
export const DOCUMENT_QUIZ_MAX_LENGTH = 255;

export interface DocumentQuizRef {
  /** The PDF's file id (media service). */
  fileId: string;
  fileName: string;
  source: "PDF" | "PPT";
}

/** The document reference, or null for a plain quiz (any title that is not the marker). */
export function parseDocumentQuizRef(raw: unknown): DocumentQuizRef | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text.startsWith("{") || text.length > DOCUMENT_QUIZ_MAX_LENGTH) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  if (obj.kind !== DOCUMENT_QUIZ_KIND) return null;
  if (typeof obj.file_id !== "string" || !obj.file_id.trim()) return null;
  return {
    fileId: obj.file_id.trim(),
    fileName: typeof obj.file_name === "string" ? obj.file_name : "",
    source: obj.source === "PPT" ? "PPT" : "PDF",
  };
}

/** Document panel width bounds while dragging the divider, in percent. */
export const DOCUMENT_QUIZ_MIN_SPLIT = 25;
export const DOCUMENT_QUIZ_MAX_SPLIT = 75;
export const DOCUMENT_QUIZ_DEFAULT_SPLIT = 50;

/**
 * Document panel width (percent) for a pointer at `pointerX` over a container
 * starting at `left` and `width` wide, kept between the bounds so neither side
 * can be dragged shut. The document sits at the inline start, so in a
 * right-to-left layout it is measured from the right edge. Falls back to 50/50
 * for a zero-width container.
 */
export function documentQuizSplitPercent(
  pointerX: number,
  left: number,
  width: number,
  rtl = false
): number {
  if (!Number.isFinite(pointerX) || !Number.isFinite(left) || !(width > 0)) {
    return DOCUMENT_QUIZ_DEFAULT_SPLIT;
  }
  const fromStart = rtl ? left + width - pointerX : pointerX - left;
  const percent = (fromStart / width) * 100;
  return Math.round(
    Math.min(DOCUMENT_QUIZ_MAX_SPLIT, Math.max(DOCUMENT_QUIZ_MIN_SPLIT, percent))
  );
}

/**
 * Keyboard nudge on the divider: the arrow pointing away from the document
 * widens it by 5%, the other narrows it. Null for any other key.
 */
export function nudgeDocumentQuizSplit(current: number, key: string, rtl = false): number | null {
  const towardEnd = rtl ? "ArrowLeft" : "ArrowRight";
  const towardStart = rtl ? "ArrowRight" : "ArrowLeft";
  const step = key === towardEnd ? 5 : key === towardStart ? -5 : 0;
  if (step === 0) return null;
  return Math.min(DOCUMENT_QUIZ_MAX_SPLIT, Math.max(DOCUMENT_QUIZ_MIN_SPLIT, current + step));
}
