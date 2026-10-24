import { useEffect, useState } from "react";
import { getStudentDisplaySettings } from "@/services/student-display-settings";
import type {
  ContentCardImageFit,
  EnrolledCourseLayout,
} from "@/types/student-display-settings";

/**
 * QA override, mirroring DEBUG_UI_TYPE in the settings service. The settings
 * blob is cached in localStorage for 24h per institute, so flipping the layout
 * in the admin does not show up on a warm cache — and previewing a layout
 * should not require changing a live institute's saved settings at all. Set
 * `DEBUG_ENROLLED_LAYOUT` to "contentOnly" (or "full") and reload; remove the
 * key to go back to whatever the institute has configured.
 */
function readDebugEnrolledLayout(): EnrolledCourseLayout | null {
  try {
    const v = localStorage.getItem("DEBUG_ENROLLED_LAYOUT");
    return v === "contentOnly" || v === "full" ? v : null;
  } catch {
    return null;
  }
}

// Institute-level display flags for the course-details page. Defaults are the
// permissive ones (everything visible except instructors, which is opt-in).
export function useCourseDisplaySettings() {
  const [showCourseConfiguration, setShowCourseConfiguration] =
    useState<boolean>(true);
  const [overviewVisible, setOverviewVisible] = useState<boolean>(true);
  // Tag chips above the title; shown unless the institute hides them.
  const [hideTags, setHideTags] = useState<boolean>(false);
  const [hideAuthorName, setHideAuthorName] = useState<boolean>(false);
  // Teachers/Instructors section is hidden unless the institute opts in.
  const [showInstructors, setShowInstructors] = useState<boolean>(false);
  // "full" keeps today's page. Institutes opt into the table-of-contents page
  // ("contentOnly") from Student Display Settings; it only applies once the
  // learner is enrolled, which the page itself decides.
  const [enrolledLayout, setEnrolledLayout] = useState<EnrolledCourseLayout>(
    () => readDebugEnrolledLayout() ?? "full"
  );
  // undefined = "follow enrolledLayout" (see chapterOpensFirstSlide in
  // student-display-settings). Resolved by the page, which knows the layout.
  const [chapterOpensFirstSlide, setChapterOpensFirstSlide] = useState<
    boolean | undefined
  >(undefined);
  // How Content Structure cards fit their thumbnail. "cover" crops to fill,
  // matching the admin dashboard; "contain" shows the whole artwork.
  const [contentCardImageFit, setContentCardImageFit] =
    useState<ContentCardImageFit>("cover");

  useEffect(() => {
    getStudentDisplaySettings(false)
      .then((settings) => {
        const cd = settings?.courseDetails;
        if (cd) {
          setShowCourseConfiguration(cd.showCourseConfiguration ?? true);
          setHideTags(cd.hideTags === true);
          setOverviewVisible(cd.courseOverview?.visible ?? true);
          setHideAuthorName(cd.hideAuthorName ?? false);
          setShowInstructors(cd.showInstructors ?? false);
          setEnrolledLayout(
            readDebugEnrolledLayout() ?? cd.enrolledLayout ?? "full"
          );
          setChapterOpensFirstSlide(cd.chapterOpensFirstSlide);
          setContentCardImageFit(cd.contentCardImageFit ?? "cover");
        }
      })
      .catch(() => {
        setShowCourseConfiguration(true);
        setHideTags(false);
        setOverviewVisible(true);
        setHideAuthorName(false);
        setShowInstructors(false);
        setEnrolledLayout(readDebugEnrolledLayout() ?? "full");
        setChapterOpensFirstSlide(undefined);
        setContentCardImageFit("cover");
      });
  }, []);

  return {
    showCourseConfiguration,
    hideTags,
    overviewVisible,
    hideAuthorName,
    showInstructors,
    enrolledLayout,
    chapterOpensFirstSlide,
    contentCardImageFit,
  };
}
