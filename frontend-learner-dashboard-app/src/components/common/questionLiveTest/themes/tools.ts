import type { ExamExperienceSettings } from "@/types/assessment-experience";
import type { ResolvedExamTheme } from "@/types/exam-theme";

/**
 * The institute's live-test settings with the theme's built-in tools applied.
 *
 * A theme whose real exam screen always has a calculator (GATE) turns the
 * calculator on in that mode, whatever the institute chose, unless the test
 * itself turned it off (resolved into `builtInCalculator`). Every other
 * setting, and every other theme, passes through unchanged (same object).
 */
export const withThemeTools = (
  settings: ExamExperienceSettings,
  theme: Pick<ResolvedExamTheme, "builtInCalculator">,
): ExamExperienceSettings => {
  const mode = theme.builtInCalculator;
  if (!mode) return settings;
  if (settings.calculator.enabled && settings.calculator.mode === mode) {
    return settings;
  }
  return { ...settings, calculator: { enabled: true, mode } };
};
