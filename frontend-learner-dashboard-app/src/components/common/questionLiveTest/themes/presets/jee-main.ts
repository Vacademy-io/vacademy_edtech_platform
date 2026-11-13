import type { ExamPresetDefinition } from "@/types/exam-theme";

/**
 * JEE Main. Two layouts: the NTA web mock (default; the screen candidates are
 * told to practise on) and the TCS console. Options are numbered (1)-(4) in
 * both. Early Submit is allowed.
 */
export const JEE_MAIN_PRESET: ExamPresetDefinition = {
  id: "jee-main",
  family: "tcs",
  displayName: "JEE Main-style CBT",
  neutralName: "Orange-band CBT",
  patch: {
    options: { numbering: "(1)" },
  },
  defaultLayout: "nta-mock",
  layouts: {
    "nta-mock": {
      layout: { kind: "console", variant: "nta-mock" },
      // << BACK / NEXT >> strip; SAVE & MARK FOR REVIEW sets both flags.
      policy: { previousButton: true },
      timer: { format: "HH:MM:SS" },
      palette: {
        columns: 8,
        numbering: "two-digit",
        chip: "nta-shapes",
        legendOrder: [
          "not-visited",
          "not-answered",
          "answered",
          "marked",
          "answered-marked",
        ],
        sectionBar: false,
      },
    },
    "tcs-console": {
      layout: { kind: "console", variant: "tcs-console" },
    },
  },
};
