import type { ResolvedExamTheme } from "@/types/exam-theme";
import { renderedLayoutKind } from "@/components/common/questionLiveTest/themes/layouts";

export type InstructionTemplateId = "default" | "tcs";

/**
 * Instruction page template for a theme: the console themes get the TCS
 * template once their console layout is the one the test will draw;
 * everything else keeps today's brief.
 */
export const instructionTemplateFor = (theme: ResolvedExamTheme): InstructionTemplateId =>
  theme.family === "tcs" && renderedLayoutKind(theme) === "console" ? "tcs" : "default";
