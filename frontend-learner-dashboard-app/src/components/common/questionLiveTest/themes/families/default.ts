import type { ExamFamilyDefinition } from "@/types/exam-theme";
import { QUESTION_LEGEND_ORDER } from "../../question-status-colors";

/**
 * Today's live-test screen. Every value here describes the current look and
 * behaviour, so the default preset changes nothing.
 */
export const DEFAULT_FAMILY: ExamFamilyDefinition = {
  family: "default",
  base: {
    family: "default",
    version: 1,
    layout: { kind: "default", variant: "default" },
    policy: {
      answerCommit: "auto",
      markSemantics: "toggle",
      earlySubmit: "allowed",
      navigation: "free",
      previousButton: true,
      visitMarksNotAnswered: true,
    },
    timer: { scope: "test", format: "HH:MM:SS" },
    palette: {
      kind: "default",
      columns: 0,
      numbering: "plain",
      chip: "default",
      legendOrder: QUESTION_LEGEND_ORDER,
      countsScope: "section",
      sectionBar: false,
    },
    options: { style: "card", numbering: "default" },
  },
  practice: {},
};
