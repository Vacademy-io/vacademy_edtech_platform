import type { ExamPresetDefinition } from "@/types/exam-theme";

/**
 * GATE on the TCS console. Submit stays disabled until the time is up, and the
 * on-screen scientific calculator is always there (physical calculators are
 * not allowed in the real exam), unless the test turns it off.
 */
export const GATE_PRESET: ExamPresetDefinition = {
  id: "gate",
  family: "tcs",
  displayName: "GATE-style CBT",
  neutralName: "TCS-style CBT",
  builtInCalculator: "scientific",
  patch: {
    policy: { earlySubmit: "disabled-until-end" },
  },
};
