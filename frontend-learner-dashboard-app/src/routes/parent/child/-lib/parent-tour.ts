// A gentle guided tour for parents, using driver.js (lazy-loaded so the library
// and its CSS stay out of the main bundle until a parent starts the walkthrough).
// Mirrors the learner run-tour; reuses the same popover styling.

import i18n from "i18next";

// Callers (ParentHelpButton, the child home) already call useTranslation("parent")
// before a tour can be triggered, so the namespace is loaded by the time this
// runs — read the shared i18next instance directly since this isn't a component.
const t = (key: string, fallback: string) =>
  i18n.t(key, { ns: "parent", defaultValue: fallback });

export interface ParentTourStep {
  /** CSS selector to highlight; omit for a centered explainer step. */
  element?: string;
  title: string;
  description: string;
}

export async function runParentTour(steps: ParentTourStep[]): Promise<void> {
  const [{ driver }] = await Promise.all([
    import("driver.js"),
    import("driver.js/dist/driver.css"),
  ]);

  driver({
    showProgress: true,
    progressText: t("tour.driver.progress", "{{current}} of {{total}}"),
    nextBtnText: t("tour.driver.next", "Next"),
    prevBtnText: t("tour.driver.back", "Back"),
    doneBtnText: t("tour.driver.gotIt", "Got it"),
    allowClose: true,
    overlayOpacity: 0.6,
    stagePadding: 6,
    stageRadius: 12,
    popoverClass: "vacademy-tour-popover",
    steps: steps.map((s) => ({
      element: s.element,
      popover: { title: s.title, description: s.description },
    })),
  }).drive();
}
