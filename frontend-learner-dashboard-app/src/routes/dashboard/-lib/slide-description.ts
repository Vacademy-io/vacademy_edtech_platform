/**
 * The text to show under a lesson title. Anything that is not prose written for
 * the learner comes back empty, and callers fall back to their own generic line.
 *
 * Only some slide types hold such prose. The others keep authoring input or a
 * default word in the description column, so they are left out by type. Long
 * values arrive cut off, so a value is treated as structured from its opening
 * characters as well as by parsing it.
 */

const TYPES_WITH_LEARNER_PROSE = new Set(["DOCUMENT", "VIDEO", "AUDIO", "SCORM"]);

// Saved by authoring tools and API clients when no description was written.
const DEFAULT_VALUES = new Set([
  "audio",
  "description",
  "doc",
  "document",
  "embedded url",
  "external link",
  "html document",
  "image",
  "new doc",
  "new document",
  "pdf",
  "presentation",
  "scorm",
  "string",
  "video",
]);

// `{"`, `{{`, `[{`, `["`, `[]`, `{}`, plus the same inside an encoded string.
const OPENS_LIKE_JSON = /^"?\s*[[{]\s*\\?["{[\]}]/;

// A tag cut part way: `<a href="ht`, or from `<` on when the value ends in the
// ellipsis added to long values. A lone `<` in prose does not match.
const CUT_OFF_TAG =
  /<\/?[a-z][a-z0-9]*\s+[a-z-]+=[^<>]*$|<\/?(?:[a-z][a-z0-9]*(?:\s[^<>]*)?)?(?:\.{3}|…)$/i;

// Written by course generation, for its own search step rather than for reading.
const GENERATED_NOTES = /\b(?:video related to|youtube url):/i;

// A location in the course outline, `Chapter > Topic > Notes`.
const OUTLINE_PATH = /^[^>]+(?: > [^>]+){2,}$/;

// The uploaded file's name and nothing else.
const FILE_NAME = /^[^/\\]+\.(?:pdf|docx?|pptx?|xlsx?|csv|txt|mp3|wav|m4a|mp4|mov|webm|zip)$/i;

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

const isStructured = (value: string): boolean => {
  if (OPENS_LIKE_JSON.test(value)) return true;
  if (!/^[[{"]/.test(value)) return false;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed === "string") return isStructured(parsed.trim());
    return typeof parsed === "object" && parsed !== null;
  } catch {
    return false;
  }
};

export const readableSlideDescription = (
  description: string | null | undefined,
  sourceType: string | null | undefined,
): string => {
  if (typeof description !== "string") return "";
  if (!TYPES_WITH_LEARNER_PROSE.has((sourceType ?? "").toUpperCase())) return "";
  const trimmed = description.trim();
  if (!trimmed || isStructured(trimmed)) return "";
  const text = trimmed
    .replace(/<\/?[a-z][^>]*>/gi, " ")
    .replace(CUT_OFF_TAG, " ")
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/\s+/g, " ")
    .trim();
  if (DEFAULT_VALUES.has(text.toLowerCase())) return "";
  if (GENERATED_NOTES.test(text) || OUTLINE_PATH.test(text) || FILE_NAME.test(text)) return "";
  return isStructured(text) ? "" : text;
};
