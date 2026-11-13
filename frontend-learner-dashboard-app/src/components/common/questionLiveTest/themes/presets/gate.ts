import type { ExamPresetDefinition } from "@/types/exam-theme";

/** GATE on the TCS console. Submit stays disabled until the time is up. */
export const GATE_PRESET: ExamPresetDefinition = {
  id: "gate",
  family: "tcs",
  displayName: "GATE-style CBT",
  neutralName: "TCS-style CBT",
  patch: {
    policy: { earlySubmit: "disabled-until-end" },
  },
};
