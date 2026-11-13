import type { ExamFamilyDefinition } from "@/types/exam-theme";

/**
 * Computer-based test console used by several Indian national exams.
 *
 * Shared rules (strict): an answer counts only after Save & Next or
 * Mark for Review & Next; leaving a question any other way discards an unsaved
 * pick. Mark sets the flag and moves on. One test clock in total minutes.
 * There is no Previous button; movement is through the palette.
 *
 * Colours, banner and chip tones are per preset and live in the theme CSS
 * (Phase 1); this file holds layout and behaviour only.
 */
export const TCS_FAMILY: ExamFamilyDefinition = {
  family: "tcs",
  base: {
    family: "tcs",
    version: 1,
    layout: { kind: "console", variant: "tcs-console" },
    policy: {
      answerCommit: "explicit",
      markSemantics: "set-and-next",
      earlySubmit: "allowed",
      navigation: "free",
      previousButton: false,
      visitMarksNotAnswered: true,
    },
    timer: { scope: "test", format: "MMM:SS" },
    palette: {
      kind: "grid-right",
      columns: 4,
      numbering: "plain",
      chip: "tcs-shapes",
      // Two-column legend: Answered | Not Answered, Not Visited | Marked,
      // then Answered & Marked on its own line.
      legendOrder: [
        "answered",
        "not-answered",
        "not-visited",
        "marked",
        "answered-marked",
      ],
      countsScope: "section",
      sectionBar: true,
    },
    options: { style: "radio-row", numbering: "none" },
  },
  // Practice-friendly: picks count at once and Submit is always available.
  practice: { answerCommit: "auto", earlySubmit: "allowed" },
};
