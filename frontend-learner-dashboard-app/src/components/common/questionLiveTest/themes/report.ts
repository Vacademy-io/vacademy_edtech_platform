import * as Sentry from "@sentry/react";

const reported = new Set<string>();

/**
 * Leaves a breadcrumb when the server names a preset or layout this build does
 * not know (a newer backend or admin app). Once per value per page load; the
 * screen falls back to the default and the attempt is unaffected.
 */
export const reportUnknownExamTheme = (
  kind: "preset" | "layout",
  value: string,
): void => {
  const key = `${kind}:${value}`;
  if (reported.has(key)) return;
  reported.add(key);
  try {
    Sentry.addBreadcrumb({
      category: "exam-theme",
      level: "warning",
      message: `Unknown exam ${kind} "${value}", using the default`,
    });
  } catch {
    // Reporting must never affect the exam.
  }
};
