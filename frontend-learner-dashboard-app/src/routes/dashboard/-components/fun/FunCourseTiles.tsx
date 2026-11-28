import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { CourseArt } from "@/components/design-system/fun/CourseArt";
import { ReviewLabel } from "@/components/design-system/fun/FinishedTick";
import { FunProgress } from "@/components/design-system/fun/FunProgress";
import { courseColourClass } from "@/components/design-system/fun/course-palette";
import { courseIdsNeedingBatchNames, useBatchNames } from "@/components/design-system/fun/batch-names";
import { useHideProgress } from "@/hooks/use-hide-progress";
import { getTerminologyPlural } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import type { EnrolledCourse } from "@/services/enrolled-courses";
import { getResumeForCourse, RESUME_ROUTE, resumeSearchParams, useResumeScope } from "@/services/resume-thread";
import LocalStorageUtils from "@/utils/localstorage";
import { NEARLY_DONE_PERCENT } from "@/lib/learner-state/course-progress";
import type { DashboardSlide } from "../../-types/dashboard-data-types";
import { useEnrolledStanding } from "@/hooks/use-enrolled-standing";
import {
  funHeroKind,
  heroOffersStartOf,
  nearlyDone,
  startCourseOf,
  tileNotStarted,
  tileSublines,
  tilesModeOf,
  visibleTiles,
  withTileBatchNames,
  type FunHeroInput,
  type TilesMode,
} from "./home-state";
import { useCourseImages } from "./use-fun-home-bits";
import { useFunEnrolledCourses } from "./use-fun-enrolled-courses";
import { ChevronIcon } from "./fun-icons";

/** What the hero card is decided from (FunHomeTop), as the dashboard page has it. */
export type FunTilesHero = Pick<
  FunHeroInput,
  "hasResume" | "resumeResolving" | "firstRunKnown" | "hasAnyProgress" | "dashboardLoading" | "dashboardAnswered"
>;

/**
 * The course tiles under the hero (the enrolledCourses widget in the Fun skin). Each
 * course in its own colour (course-palette.ts), its image or the plain shape, and its
 * percent unless the institute hides progress, where the level name shows instead.
 * When two tiles share a course name (one course in two batches), both add the
 * level and session under the name (and the batch name when those read the same),
 * whatever the progress setting.
 * A finished course keeps its colour with a green tick and "Review", unless the
 * dashboard still lists one of its lessons in progress: then it shows nearly done,
 * as the hero does (`serverSlides`, the dashboard's Continue Learning rows). With
 * progress hidden, no tile signals completion (no tick, no "Look back").
 *
 * `hero` carries the page's answers the hero card is decided from (FunHomeTop), so the
 * tiles leave out exactly the course the hero offers to start, and only then.
 */
export function FunCourseTiles({ serverSlides, hero }: { serverSlides?: readonly DashboardSlide[]; hero?: FunTilesHero }) {
  const { t } = useTranslation("funHome");
  const { t: tCommon } = useTranslation("funCommon");
  const navigate = useNavigate();
  const scope = useResumeScope();
  const hideProgress = useHideProgress();
  const { courses, showAll, pending, failed } = useFunEnrolledCourses();
  const standing = useEnrolledStanding();
  const coursesLabel = getTerminologyPlural(ContentTerms.Course, SystemTerms.Course);

  const listedCourseIds = new Set((serverSlides ?? []).map((slide) => slide.package_id).filter(Boolean));
  const lessonsListed = Boolean(serverSlides?.length);
  const heroOffersStart = hero
    ? heroOffersStartOf(
        funHeroKind({ ...hero, lessonsListed, standing, courses, coursesPending: pending, hideProgress }),
        hero,
      )
    : false;
  const mode: TilesMode = courses ? tilesModeOf(courses, lessonsListed, hideProgress !== false, heroOffersStart) : "all";
  const start = mode === "others" ? startCourseOf(courses) : null;
  const pool = (courses ?? []).filter((c) => c !== start);
  const visible = visibleTiles(pool, showAll);
  // Two batches of one course carry the same name: their tiles add level and session
  // (and the batch name when those read the same), looked up from the course's batches
  // because the enrolment list sends no session name.
  const batchNames = useBatchNames(
    courseIdsNeedingBatchNames((courses ?? []).map((c) => ({ courseId: c.id, name: c.name, session: c.sessionName }))),
  );
  const named = new Map((courses ?? []).map((c) => [c, withTileBatchNames(c, batchNames)] as const));
  const sublines = tileSublines([...named.values()]);
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
            const nearly = nearlyDone(course, listedCourseIds);
            const finished = course.state === "COMPLETED" && !nearly;
            const url = course.previewImageId ? images[course.previewImageId] : undefined;
            const sub = sublines.get(named.get(course) ?? course) ?? { text: course.levelName, disambiguates: false };
            let state: string;
            let foot: ReactNode;
            if (hideProgress !== false) {
              // Not read yet: hold the line's room; hidden: the level name instead (drawn below).
              state = sub.text;
              foot = <span className="fun-tile__held" aria-hidden="true" />;
            } else if (finished) {
              state = tCommon("review");
              foot = <ReviewLabel className="fun-tile__review" />;
            } else if (tileNotStarted(course, listedCourseIds, Boolean(getResumeForCourse(scope, course.id)))) {
              state = tCommon("notStarted");
              foot = (
                <>
                  {mode !== "lookBack" && <span className="fun-progress fun-tile__track" aria-hidden="true" />}
                  <span className="fun-tile__meta">{state}</span>
                </>
              );
            } else {
              const percent = nearly ? NEARLY_DONE_PERCENT : course.percentComplete;
              state = tCommon("percentDone", { percent });
              foot = (
                <>
                  <FunProgress percent={percent} label={course.name} className="fun-tile__bar" />
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
                  aria-label={[course.name, hideProgress === false && sub.disambiguates ? sub.text : "", state].filter(Boolean).join(", ")}
                >
                  <CourseArt courseId={course.id} name={course.name} imageUrl={url} finished={finished && hideProgress === false} className="fun-tile__art" />
                  {hideProgress === true ? (
                    <span className="fun-tile__body" aria-hidden="true">
                      <span className="fun-tile__words">
                        <span className="fun-tile__name fun-clamp-2">
                          <bdi>{course.name}</bdi>
                        </span>
                        {sub.text ? <span className="fun-tile__level">{sub.text}</span> : null}
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
                      {sub.disambiguates ? (
                        <span className="fun-tile__level">
                          <bdi>{sub.text}</bdi>
                        </span>
                      ) : null}
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
