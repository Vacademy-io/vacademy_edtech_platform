import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { CourseArt } from "@/components/design-system/fun/CourseArt";
import { ReviewLabel } from "@/components/design-system/fun/FinishedTick";
import { FunProgress } from "@/components/design-system/fun/FunProgress";
import { courseColourClass } from "@/components/design-system/fun/course-palette";
import { useHideProgress } from "@/hooks/use-hide-progress";
import { getTerminologyPlural } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import type { EnrolledCourse } from "@/services/enrolled-courses";
import { getResumeForCourse, RESUME_ROUTE, resumeSearchParams, useResumeScope } from "@/services/resume-thread";
import LocalStorageUtils from "@/utils/localstorage";
import { startCourseOf, tilesModeOf, visibleTiles, type TilesMode } from "./home-state";
import { useCourseImages } from "./use-fun-home-bits";
import { useFunEnrolledCourses } from "./use-fun-enrolled-courses";
import { ChevronIcon } from "./fun-icons";

/**
 * The course tiles under the hero (the enrolledCourses widget in the Fun skin). Each
 * course in its own colour (course-palette.ts), its image or the plain shape, and its
 * percent unless the institute hides progress, where the level name shows instead.
 * A finished course keeps its colour with a green tick and "Review".
 */
export function FunCourseTiles() {
  const { t } = useTranslation("funHome");
  const { t: tCommon } = useTranslation("funCommon");
  const navigate = useNavigate();
  const scope = useResumeScope();
  const hideProgress = useHideProgress();
  const { courses, showAll, pending, failed } = useFunEnrolledCourses();
  const coursesLabel = getTerminologyPlural(ContentTerms.Course, SystemTerms.Course);

  const mode: TilesMode = courses ? tilesModeOf(courses) : "all";
  const start = mode === "others" ? startCourseOf(courses) : null;
  const pool = (courses ?? []).filter((c) => c !== start);
  const visible = visibleTiles(pool, showAll);
  const images = useCourseImages(visible.map((c) => c.previewImageId));

  // Nothing loaded and nothing to say: off the page, as the classic widget does.
  if ((failed || (!pending && !courses)) && !courses?.length) return null;
  // No course at all: the hero already says so.
  if (courses && pool.length === 0) return null;

  const open = (course: EnrolledCourse) => {
    const resume = getResumeForCourse(scope, course.id);
    if (resume && course.state !== "COMPLETED") {
      navigate({
        to: RESUME_ROUTE,
        search: resumeSearchParams(resume) as {
          courseId: string;
          levelId?: string;
          subjectId: string;
          moduleId: string;
          chapterId: string;
          slideId: string;
          sessionId: string;
        },
      });
      return;
    }
    try {
      LocalStorageUtils.set(`COURSE_PCT_${course.id}`, { value: course.percentComplete, ts: Date.now() });
    } catch {
      // The details page reads its own percent when this is missing.
    }
    navigate({
      to: "/study-library/courses/course-details",
      search: {
        courseId: course.id,
        packageSessionId: course.packageSessionId,
        selectedTab: course.state === "COMPLETED" ? "COMPLETED" : "PROGRESS",
        percentageCompleted: course.percentComplete,
      },
    });
  };

  const title =
    mode === "lookBack" ? t("tiles.lookBack") : mode === "others" ? t("tiles.otherTitle", { courses: coursesLabel.toLocaleLowerCase() }) : t("tiles.title", { courses: coursesLabel.toLocaleLowerCase() });
  const more = pool.length > visible.length;
  const seeAll = mode === "others" && more ? t("tiles.seeAllCount", { count: pool.length }) : t("tiles.seeAll");

  return (
    <section aria-labelledby="fun-tiles-title" className={cn("fun-tiles", `fun-tiles--${mode}`, hideProgress === true && "fun-tiles--quiet")}>
      <div className="fun-tiles__head">
        <h2 id="fun-tiles-title" className="fun-section-title">
          {title}
        </h2>
        <Link to="/study-library/courses" className="fun-link">
          {seeAll}
        </Link>
      </div>
      {!courses ? (
        <div className="fun-tiles__list" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="fun-tile fun-tile--skeleton">
              <span className="fun-skeleton fun-tile__sk-art" />
              <span className="fun-tile__body">
                <span className="fun-skeleton fun-tile__sk-line" />
                <span className="fun-skeleton fun-tile__sk-line fun-tile__sk-line--short" />
              </span>
            </div>
          ))}
        </div>
      ) : (
        <ul className="fun-tiles__list">
          {visible.map((course) => {
            const finished = course.state === "COMPLETED";
            const url = course.previewImageId ? images[course.previewImageId] : undefined;
            let state: string;
            let foot: ReactNode;
            if (hideProgress !== false) {
              // Not read yet: hold the line's room; hidden: the level name instead (drawn below).
              state = course.levelName;
              foot = <span className="fun-tile__held" aria-hidden="true" />;
            } else if (finished) {
              state = tCommon("review");
              foot = <ReviewLabel className="fun-tile__review" />;
            } else if (course.state === "NOT_STARTED") {
              state = tCommon("notStarted");
              foot = (
                <>
                  {mode !== "lookBack" && <span className="fun-progress fun-tile__track" aria-hidden="true" />}
                  <span className="fun-tile__meta">{state}</span>
                </>
              );
            } else {
              state = tCommon("percentDone", { percent: course.percentComplete });
              foot = (
                <>
                  <FunProgress percent={course.percentComplete} label={course.name} className="fun-tile__bar" />
                  <span className="fun-tile__meta">{state}</span>
                </>
              );
            }
            return (
              <li key={course.packageSessionId || course.id} className="fun-tiles__item">
                <button
                  type="button"
                  className={cn("fun-tile", courseColourClass(course.id))}
                  onClick={() => open(course)}
                  aria-label={state ? `${course.name}, ${state}` : course.name}
                >
                  <CourseArt courseId={course.id} name={course.name} imageUrl={url} finished={finished} className="fun-tile__art" />
                  {hideProgress === true ? (
                    <span className="fun-tile__body" aria-hidden="true">
                      <span className="fun-tile__words">
                        <span className="fun-tile__name fun-clamp-2">
                          <bdi>{course.name}</bdi>
                        </span>
                        {course.levelName ? <span className="fun-tile__level">{course.levelName}</span> : null}
                      </span>
                      <span className="fun-tile__go">
                        <ChevronIcon />
                      </span>
                    </span>
                  ) : (
                    <span className="fun-tile__body" aria-hidden="true">
                      <span className="fun-tile__name fun-clamp-2">
                        <bdi>{course.name}</bdi>
                      </span>
                      {finished && mode === "lookBack" ? <ReviewLabel className="fun-tile__review" /> : foot}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
