import type { ResumeEntry } from "@/services/resume-thread";
import type { DashboardSlide } from "../../-types/dashboard-data-types";

/**
 * The course (package) id of the lesson the hero offers, which picks its colour.
 * The resume answer names the slide but not the course, so this finds the course
 * through the two lists that answer came from: this device's resume entries, then
 * the lessons the dashboard lists. Undefined when neither has the slide.
 */
export function courseIdOfResume(
  slideId: string | null | undefined,
  entries: readonly ResumeEntry[],
  serverSlides: readonly DashboardSlide[] | null | undefined,
): string | undefined {
  if (!slideId) return undefined;
  const entry = entries.find((e) => e.slideId === slideId);
  if (entry?.courseId) return entry.courseId;
  const listed = serverSlides?.find((s) => s.slide_id === slideId);
  return listed?.package_id || undefined;
}
