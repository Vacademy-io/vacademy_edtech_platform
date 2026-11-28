import type { ExamPresetDefinition } from "@/types/exam-theme";

/**
 * RRB JE on the TCS console. Submit stays disabled for the whole test and
 * options are unnumbered.
 */
export const RRB_JE_PRESET: ExamPresetDefinition = {
  id: "rrb-je",
  family: "tcs",
  displayName: "RRB JE-style CBT",
  neutralName: "TCS-style CBT",
  patch: {
    policy: { earlySubmit: "disabled-until-end" },
  },
};
