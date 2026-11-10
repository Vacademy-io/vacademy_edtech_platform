import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { courseColourClass } from "@/components/design-system/fun/course-palette";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { useLessonNotesStore } from "@/stores/study-library/lesson-notes-store";
import { useModulesWithChaptersStore } from "@/stores/study-library/use-modules-with-chapters-store";
import { getChapterName } from "@/utils/study-library/get-name-by-id/getChapterById";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import { isPlaceholderName } from "./result-facts";

/**
 * Where the open quiz sits, from what the lesson page already knows: the URL
 * (course and chapter ids), the course name the lesson page looked up, and the
 * chapter list it loaded. Nothing is fetched here.
 */
export function useQuizPlace() {
  const search = new URLSearchParams(window.location.search);
  // The slides route's courseId is the course (package) id, which keys the colour.
  const courseId = search.get("courseId") || "";
  const chapterId = search.get("chapterId") || "";
  const sessionId = search.get("sessionId") || "";
  const courseName = useLessonNotesStore((state) => state.courseName);
  const modules = useModulesWithChaptersStore((state) => state.modulesWithChaptersData);
  const chapterName = chapterId ? getChapterName(chapterId, modules) : null;
  const navigate = useNavigate();

  const backToChapter = useCallback(() => {
    if (!courseId) {
      window.history.back();
      return;
    }
    navigate({
      to: "/study-library/courses/course-details",
      search: { courseId, packageSessionId: sessionId || undefined },
    });
  }, [courseId, sessionId, navigate]);

  return {
    courseId,
    colourClass: courseId ? courseColourClass(courseId) : "",
    courseName: isPlaceholderName(courseName) ? null : courseName!.trim(),
    chapterName: isPlaceholderName(chapterName) ? null : chapterName!.trim(),
    chapterTerm: getTerminology(ContentTerms.Chapters, SystemTerms.Chapters),
    backToChapter,
  };
}
