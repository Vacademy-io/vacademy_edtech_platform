import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { FunButton } from "@/components/design-system/fun/FunButton";
import { FunProgress } from "@/components/design-system/fun/FunProgress";
import { NewChip } from "@/components/design-system/fun/chips";
import { courseColourClass } from "@/components/design-system/fun/course-palette";
import { firstGrapheme } from "@/components/design-system/fun/CourseArt";
import { brandNearLiveRed } from "@/components/design-system/fun/brand-colours";
import { courseIdsNeedingBatchNames, useBatchNames } from "@/components/design-system/fun/batch-names";
import { useHideProgress } from "@/hooks/use-hide-progress";
import { useEnrolledFurthestPercent, useEnrolledStanding } from "@/hooks/use-enrolled-standing";
import { countWorthShowing, NEARLY_DONE_PERCENT, shownCoursePercent } from "@/lib/learner-state/course-progress";
import { getTerminology, getTerminologyPlural } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import { listResumes, useResumeScope } from "@/services/resume-thread";
import type { EnrolledCourse } from "@/services/enrolled-courses";
import type { SessionDetails } from "@/routes/study-library/live-class/-types/types";
import LocalStorageUtils from "@/utils/localstorage";
import { formatMinutesHuman } from "@/utils/courseTime";
import { useClaimFunHeaderSlot, useFunHeaderSlot } from "@/hooks/use-fun-header-slot";
import type { ResumeTarget } from "../../-lib/resume-target";
import type { DashboardSlide } from "../../-types/dashboard-data-types";
import { useDashboardHeroData, type DailyTaskProgress } from "../play/useDashboardHeroData";
import { bannerClassOf } from "./live-timing";
import {
  funHeroKind,
  headerFirstName,
  heroBarPercent,
  initialsOf,
  START_NAME_MAX,
  startCourseOf,
  tileSublines,
  withTileBatchNames,
  type FunHeroKind,
} from "./home-state";
import { courseIdOfResume } from "./resume-course";
import { useFunEnrolledCourses } from "./use-fun-enrolled-courses";
import { readBrandHex, useCourseImages, useNow, useStoredNames } from "./use-fun-home-bits";
import { FunHomeHeader } from "./FunHomeHeader";
import { FunLiveCard } from "./FunLiveCard";
import { FunTodayCards, type FunTodayInput } from "./FunTodayCards";
import { ChevronIcon, ClipboardIcon, DoneTicksArt, EmptyCoursesArt, PlayIcon, UserIcon } from "./fun-icons";

export interface FunHomeTopProps {
  userName: string | null;
  liveSessions: SessionDetails[];
  hasAnyProgress: boolean;
  /** The dashboard has settled whether the learner has started. */
  studyLibraryLoaded: boolean;
  onJoinSession: (session: SessionDetails) => void;
  resume: ResumeTarget | null;
  resumeResolving: boolean;
  showGamification: boolean;
  taskProgress: DailyTaskProgress | null;
  dashboardLoading: boolean;
  dashboardAnswered: boolean;
  onRetry: () => void;
  serverSlides: DashboardSlide[] | undefined;
  /** The Today cards' inputs; `todayBelow` puts them under the hero (a phone). */
  today: FunTodayInput;
  todayBelow: boolean;
  /**
   * Where the greeting row goes when the top bar offers no slot: full width above the
   * columns. Null: drawn here.
   */
  headerSlot: HTMLElement | null;
}

/** The course picture inside a hero band: the course image on its tint, else the plain shape. */
function HeroArt({ name, imageUrl }: { name: string; imageUrl?: string }) {
  return (
    <div className={cn("fun-hero__art", imageUrl && "fun-hero__art--image")} aria-hidden="true">
      {imageUrl ? (
        <img className="fun-hero__image" src={imageUrl} alt="" loading="lazy" decoding="async" />
      ) : (
        <>
          <span className="fun-hero__deco" />
          <span className="fun-hero__mark">{firstGrapheme(name)}</span>
        </>
      )}
    </div>
  );
}

function openCourseDetails(navigate: ReturnType<typeof useNavigate>, course: EnrolledCourse) {
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
}

/**
 * The top of the Fun home: greeting row, the class card when a class is live or about
 * to start, and the hero card for whichever state the learner is in (see funHeroKind).
 * On a phone the Today cards follow; on a laptop they sit in the rail.
 */
export function FunHomeTop(props: FunHomeTopProps) {
  const { t } = useTranslation("funHome");
  const { t: tDashboard } = useTranslation("dashboard");
  const navigate = useNavigate();
  const now = useNow();
  const hero = useDashboardHeroData({
    userName: props.userName,
    liveSessions: props.liveSessions,
    hasAnyProgress: props.hasAnyProgress,
    resume: props.resume,
    resumeResolving: props.resumeResolving,
    firstRunKnown: props.studyLibraryLoaded,
    showGamification: props.showGamification,
    taskProgress: props.taskProgress,
  });
  const hideProgress = useHideProgress();
  const standing = useEnrolledStanding();
  const furthestPercent = useEnrolledFurthestPercent();
  const enrolled = useFunEnrolledCourses();
  const scope = useResumeScope();
  const { fullName, instituteName } = useStoredNames();
  // The top bar's slot: the greeting row goes there, so the page has one bar and one
  // account button. Without it (the bar still loading) the row sits above the columns.
  const barSlot = useFunHeaderSlot();
  useClaimFunHeaderSlot(Boolean(barSlot));

  const course = getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase();
  const courses = getTerminologyPlural(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase();
  const slides = getTerminologyPlural(ContentTerms.Slides, SystemTerms.Slides).toLocaleLowerCase();

  const lessonsListed = Boolean(props.serverSlides?.length);
  const kind: FunHeroKind = funHeroKind({
    hasResume: Boolean(props.resume),
    resumeResolving: props.resumeResolving,
    firstRunKnown: props.studyLibraryLoaded,
    hasAnyProgress: props.hasAnyProgress,
    dashboardLoading: props.dashboardLoading,
    dashboardAnswered: props.dashboardAnswered,
    lessonsListed,
    standing,
    courses: enrolled.courses,
    coursesPending: enrolled.pending,
    hideProgress,
  });

  const banner = bannerClassOf(props.liveSessions, now);
  const liveNow = banner?.isLive === true;
  const resumeCourseId = props.resume
    ? courseIdOfResume(props.resume.slideId, listResumes(scope), props.serverSlides)
    : undefined;
  const startCourse = kind === "start" ? startCourseOf(enrolled.courses) : null;
  const heroCourseId = resumeCourseId ?? startCourse?.id;
  const heroEnrolled = heroCourseId ? enrolled.courses?.find((c) => c.id === heroCourseId) : undefined;
  const images = useCourseImages([heroEnrolled?.previewImageId]);
  // The course to start shares its name with another tile (one course in two batches):
  // its card names the batch as that tile does (FunCourseTiles, same lookup and cache).
  const batchNames = useBatchNames(
    courseIdsNeedingBatchNames((enrolled.courses ?? []).map((c) => ({ courseId: c.id, name: c.name, session: c.sessionName }))),
  );
  const startNamed = startCourse ? withTileBatchNames(startCourse, batchNames) : null;
  const startSubline = startNamed
    ? tileSublines((enrolled.courses ?? []).map((c) => (c === startCourse ? startNamed : withTileBatchNames(c, batchNames)))).get(startNamed)
    : undefined;
  const heroImage = heroEnrolled?.previewImageId ? images[heroEnrolled.previewImageId] : undefined;

  const firstName = headerFirstName(hero.firstName);
  const hour = new Date(now).getHours();
  const period = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  const greetingWithName = firstName ? tDashboard(`hero.greeting.${period}WithName`, { name: firstName }) : hero.plainGreeting;
  const initials = initialsOf(fullName) || initialsOf(firstName);
  const welcome = kind === "start" || kind === "noCourses";

  let card: ReactNode;
  switch (kind) {
    case "resume": {
      const resume = props.resume!;
      const count = resume.lessonCount?.();
      const percent = shownCoursePercent({
        hasResume: true,
        coursePercent: resume.coursePercent,
        hasAnyProgress: props.hasAnyProgress,
        furthestPercent,
        standing,
        lessonsListed,
      });
      // No bar at 0%: the card says Continue, and an empty bar beside it reads as nothing done.
      const shown = heroBarPercent(percent, hideProgress);
      const listed = props.serverSlides?.find((s) => s.slide_id === resume.slideId);
      const typeKey = listed?.source_type ? `hero.type.${listed.source_type}` : null;
      const typeLabel = typeKey && t(typeKey) !== typeKey ? t(typeKey) : null;
      const quietNote = hideProgress === true ? typeLabel ?? (heroEnrolled?.levelName || null) : null;
      card = (
        <section
          aria-label={t("hero.continueLabel")}
          className={cn("fun-hero fun-hero--course fun-on-colour", heroCourseId ? courseColourClass(heroCourseId) : "fun-hero--no-course")}
        >
          <HeroArt name={resume.courseName || resume.slideTitle} imageUrl={heroImage} />
          {resume.courseName && (
            <p className="fun-hero__eyebrow fun-t-eyebrow">
              <bdi>{resume.courseName}</bdi>
              {resume.chapterName ? (
                <>
                  {" · "}
                  <bdi>{resume.chapterName}</bdi>
                </>
              ) : null}
            </p>
          )}
          <h2 className="fun-hero__title fun-clamp-2">{resume.slideTitle}</h2>
          {hideProgress === false && countWorthShowing(count) && (
            <p className="fun-hero__count">
              {t("hero.count", { done: Math.min(count.done, count.total), total: count.total, slides })}
            </p>
          )}
          {quietNote && (
            <p className="fun-hero__note">
              <PlayIcon className="fun-hero__note-icon" />
              <bdi>{quietNote}</bdi>
            </p>
          )}
          {shown !== null && (
            <div className="fun-hero__progress">
              <FunProgress percent={shown} tone="band" label={t("hero.progressLabel", { course })} />
              <span className="fun-hero__percent">
                <span className="fun-hero__percent-short">{t("hero.percent", { percent: shown })}</span>
                <span className="fun-hero__percent-long">{t("hero.percentOfCourse", { percent: shown, course })}</span>
              </span>
            </div>
          )}
          <FunButton
            variant={liveNow ? "outline" : "onColour"}
            block
            className={cn("fun-hero__cta", liveNow && "fun-hero__cta--quiet")}
            onClick={hero.goToCta}
          >
            <PlayIcon />
            {t("hero.continue")}
          </FunButton>
        </section>
      );
      break;
    }
    case "start": {
      const c = startCourse!;
      const level = startSubline?.disambiguates ? startSubline.text : c.levelName;
      const meta = [level, c.readTimeInMinutes > 0 ? formatMinutesHuman(c.readTimeInMinutes) : ""].filter(Boolean).join(" · ");
      const shortName = Array.from(c.name.trim()).length <= START_NAME_MAX;
      card = (
        <section aria-label={t("hero.startLabel", { course })} className={cn("fun-hero fun-hero--course fun-on-colour", courseColourClass(c.id))}>
          <HeroArt name={c.name} imageUrl={heroImage} />
          <div className="fun-hero__eyebrow-row">
            <NewChip />
            <span className="fun-hero__eyebrow fun-t-eyebrow">{t("hero.startHere")}</span>
          </div>
          <h2 className="fun-hero__title fun-hero__title--start fun-clamp-2">
            <bdi>{c.name}</bdi>
          </h2>
          {meta && <p className="fun-hero__count">{meta}</p>}
          <FunButton
            variant={liveNow ? "outline" : "onColour"}
            block
            className={cn("fun-hero__cta fun-hero__cta--start", liveNow && "fun-hero__cta--quiet")}
            onClick={() => openCourseDetails(navigate, c)}
          >
            <PlayIcon />
            <span className="fun-hero__cta-label">{t("hero.start", { name: shortName ? c.name.trim() : course })}</span>
          </FunButton>
        </section>
      );
      break;
    }
    case "noCourses":
      card = (
        <section aria-labelledby="fun-empty-title" className="fun-hero fun-hero--empty">
          <div className="fun-hero__empty-art">
            <EmptyCoursesArt className="fun-empty-art" />
          </div>
          <div className="fun-hero__empty-body">
            <h2 id="fun-empty-title" className="fun-hero__empty-title">
              {t("empty.title", { course })}
            </h2>
            <p className="fun-hero__empty-text">{t("empty.body", { course })}</p>
            <FunButton asChild variant="primary" block className="fun-hero__cta">
              <Link to="/study-library/courses">{t("empty.browse", { courses })}</Link>
            </FunButton>
          </div>
        </section>
      );
      break;
    case "done":
    case "caughtUp": {
      const total = enrolled.courses?.length ?? 0;
      const done = enrolled.courses?.filter((c) => c.state === "COMPLETED").length ?? 0;
      card = (
        <section aria-labelledby="fun-done-title" className="fun-hero fun-hero--done fun-on-colour">
          <span className="fun-hero__done-deco" aria-hidden="true" />
          <DoneTicksArt className="fun-done-art" />
          <h2 id="fun-done-title" className="fun-hero__title fun-hero__title--done">
            {kind === "done" ? t("done.title", { course }) : t("done.caughtUpTitle")}
          </h2>
          <p className="fun-hero__done-text">
            {kind === "done" && total > 0 ? t("done.body", { done, total, courses }) : t("done.caughtUpBody", { course, courses })}
          </p>
          {kind === "caughtUp" && (
            <FunButton asChild variant={liveNow ? "outline" : "onColour"} block className={cn("fun-hero__cta fun-hero__cta--done", liveNow && "fun-hero__cta--quiet")}>
              <Link to="/study-library/courses">{t("hero.coursesCta", { courses })}</Link>
            </FunButton>
          )}
        </section>
      );
      break;
    }
    case "courses": {
      // A brand that reads as the live red would make this a second red card beside a
      // live class: it takes the brand tint instead while one is live.
      const brandQuiet = liveNow && brandNearLiveRed(readBrandHex());
      const percent =
        hideProgress === false && standing === "finished" && lessonsListed ? NEARLY_DONE_PERCENT : null;
      card = (
        <section
          aria-labelledby="fun-courses-title"
          className={cn("fun-hero fun-hero--brand", brandQuiet ? "fun-hero--brand-quiet" : "fun-on-colour")}
        >
          <h2 id="fun-courses-title" className="fun-hero__title">
            {/* Nothing started yet (the enrolled list could not say which course to
                offer): no "where you left off". */}
            {props.hasAnyProgress ? t("hero.coursesTitle") : t("hero.coursesTitleNew")}
          </h2>
          <p className="fun-hero__count">
            {percent !== null
              ? t("hero.nearlyThere", { percent })
              : props.hasAnyProgress
                ? t("hero.coursesBody", { courses })
                : t("hero.coursesBodyNew", { courses, course })}
          </p>
          <FunButton
            asChild
            variant={liveNow ? "outline" : "onColour"}
            block
            className={cn("fun-hero__cta fun-hero__cta--brand", liveNow && !brandQuiet && "fun-hero__cta--quiet")}
          >
            <Link to="/study-library/courses">{t("hero.coursesCta", { courses })}</Link>
          </FunButton>
        </section>
      );
      break;
    }
    case "error":
      card = (
        <section aria-labelledby="fun-error-title" className="fun-hero fun-hero--error" role="alert">
          <h2 id="fun-error-title" className="fun-hero__empty-title">
            {t("hero.errorTitle")}
          </h2>
          <p className="fun-hero__empty-text">{t("hero.errorBody")}</p>
          <FunButton variant="primary" block className="fun-hero__cta" onClick={props.onRetry}>
            {t("hero.retry")}
          </FunButton>
        </section>
      );
      break;
    default:
      card = (
        <div className="fun-hero fun-hero--skeleton" aria-busy="true" aria-label={t("hero.loading")}>
          <span className="fun-skeleton fun-hero__sk fun-hero__sk--eyebrow" />
          <span className="fun-skeleton fun-hero__sk fun-hero__sk--title" />
          <span className="fun-skeleton fun-hero__sk fun-hero__sk--line" />
          <span className="fun-skeleton fun-hero__sk fun-hero__sk--button" />
        </div>
      );
  }

  let below: ReactNode = null;
  if (kind === "noCourses") {
    below = (
      <>
        <section aria-labelledby="fun-wait-title" className="fun-wait">
          <h2 id="fun-wait-title" className="fun-wait__title">
            {t("empty.waitTitle")}
          </h2>
          <ul className="fun-wait__list">
            {props.today.showTests && (
              <li>
                <Link to="/assessment/examination" className="fun-row">
                  <span className="fun-row__icon fun-row__icon--tests" aria-hidden="true">
                    <ClipboardIcon />
                  </span>
                  <span className="fun-row__words">
                    <span className="fun-row__title">{t("empty.tests")}</span>
                    <span className="fun-row__sub">{t("empty.testsBody")}</span>
                  </span>
                  <ChevronIcon className="fun-row__chevron" />
                </Link>
              </li>
            )}
            <li>
              <Link to={"/user-profile" as never} className="fun-row">
                <span className="fun-row__icon fun-row__icon--profile" aria-hidden="true">
                  <UserIcon />
                </span>
                <span className="fun-row__words">
                  <span className="fun-row__title">{t("empty.profile")}</span>
                  <span className="fun-row__sub">{t("empty.profileBody")}</span>
                </span>
                <ChevronIcon className="fun-row__chevron" />
              </Link>
            </li>
          </ul>
        </section>
        <p className="fun-note">
          {instituteName ? t("empty.ask", { course, institute: instituteName }) : t("empty.askPlain", { course })}
        </p>
      </>
    );
  } else if (props.todayBelow) {
    below = <FunTodayCards {...props.today} variant={kind === "done" || kind === "caughtUp" ? "next" : "grid"} />;
  }

  const header = (
      <FunHomeHeader
        inBar={Boolean(barSlot)}
        plainGreeting={hero.plainGreeting}
        greetingWithName={greetingWithName}
        firstName={firstName}
        welcome={welcome}
        initials={initials}
        streak={hero.streakState}
        showStreak={props.showGamification && kind !== "start" && kind !== "noCourses"}
        loading={props.dashboardLoading && !props.userName}
      />
  );

  return (
    <div className="fun-home-top" data-fun-hero={kind}>
      {barSlot ? createPortal(header, barSlot) : props.headerSlot ? createPortal(header, props.headerSlot) : header}
      {banner && <FunLiveCard banner={banner} nowMs={now} onJoin={props.onJoinSession} />}
      {card}
      {below}
    </div>
  );
}
