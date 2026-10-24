import type { TFunction } from "i18next";
import type { SlideCountType } from "./course-details-types";

export type ProcessedSlideCount = {
  source_type: string;
  slide_count: number;
  display_name: string;
};

// English fallback used whenever no translator is supplied (keeps existing
// callers working unchanged) and as the i18next defaultValue.
const DISPLAY_NAMES: Record<string, string> = {
  VIDEO: "Video slides",
  CODE: "Code slides",
  PDF: "PDF slides",
  DOCUMENT: "DOC slides",
  QUESTION: "Question slides",
  ASSIGNMENT: "Assignment slides",
  PRESENTATION: "Presentation slides",
  JUPYTER_NOTEBOOK: "Jupyter Notebook slides",
  JUPYTER: "Jupyter Notebook slides",
  SCRATCH_PROJECT: "Scratch Project slides",
  SCRATCH: "Scratch Project slides",
  QUIZ: "Quiz slides",
  CODE_EDITOR: "Code Editor slides",
};

// courseDetailsC catalog keys mirroring DISPLAY_NAMES above.
const DISPLAY_NAME_KEYS: Record<string, string> = {
  VIDEO: "slideCounts.video",
  CODE: "slideCounts.code",
  PDF: "slideCounts.pdf",
  DOCUMENT: "slideCounts.document",
  QUESTION: "slideCounts.question",
  ASSIGNMENT: "slideCounts.assignment",
  PRESENTATION: "slideCounts.presentation",
  JUPYTER_NOTEBOOK: "slideCounts.jupyterNotebook",
  JUPYTER: "slideCounts.jupyterNotebook",
  SCRATCH_PROJECT: "slideCounts.scratchProject",
  SCRATCH: "slideCounts.scratchProject",
  QUIZ: "slideCounts.quiz",
  CODE_EDITOR: "slideCounts.codeEditor",
};

// Collapses the raw per-source counts into display rows. DOCUMENT is a
// catch-all bucket on the backend, so it is suppressed whenever specific
// document types (Jupyter, code editor, presentation, Scratch) are present —
// otherwise the same slides would be counted twice.
//
// `t` is optional so existing callers that don't pass a translator keep
// getting the English display names unchanged; pass a `courseDetailsC`
// TFunction to localize `display_name`.
export function processSlideCounts(
  counts: SlideCountType[] | null | undefined,
  t?: TFunction,
): ProcessedSlideCount[] {
  if (!counts) return [];

  const typeCounts: { [key: string]: number } = {};

  const hasSpecificDocumentTypes = counts.some(
    (count) =>
      count.source_type === "JUPYTER_NOTEBOOK" ||
      count.source_type === "CODE_EDITOR" ||
      count.source_type === "PRESENTATION" ||
      count.source_type === "SCRATCH_PROJECT",
  );

  counts.forEach((count) => {
    let canonicalType = count.source_type;
    if (canonicalType === "JUPYTER") canonicalType = "JUPYTER_NOTEBOOK";
    if (canonicalType === "SCRATCH") canonicalType = "SCRATCH_PROJECT";
    if (canonicalType === "DOCUMENT") {
      if (!hasSpecificDocumentTypes) {
        typeCounts["DOCUMENT"] =
          (typeCounts["DOCUMENT"] || 0) + count.slide_count;
      }
    } else {
      typeCounts[canonicalType] =
        (typeCounts[canonicalType] || 0) + count.slide_count;
    }
  });

  return Object.entries(typeCounts).map(([sourceType, slideCount]) => {
    const fallback = DISPLAY_NAMES[sourceType] ?? `${sourceType} slides`;
    const display_name = t
      ? DISPLAY_NAME_KEYS[sourceType]
        ? t(DISPLAY_NAME_KEYS[sourceType], { defaultValue: fallback })
        : t("slideCounts.genericFallback", {
            type: sourceType,
            defaultValue: fallback,
          })
      : fallback;

    return {
      source_type: sourceType,
      slide_count: slideCount,
      display_name,
    };
  });
}
