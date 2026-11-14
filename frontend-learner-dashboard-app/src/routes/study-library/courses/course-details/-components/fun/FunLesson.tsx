import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CaretDown, X } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { FunButton } from "@/components/design-system/fun/FunButton";
import { FunProgress } from "@/components/design-system/fun/FunProgress";
import { courseColourClass } from "@/components/design-system/fun/course-palette";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import { useHideProgress } from "@/hooks/use-hide-progress";

/*
 * The Fun skin's lesson viewer bars (styles/fun/course.css, "Lesson viewer").
 * The viewer keeps its navigation rules (edges, drip locks, chapter hand-off);
 * these only draw them. Two different numbers are shown, so both are labelled:
 * the slide's position in the chapter and the chapter's progress.
 */

const Arrow = ({ back }: { back?: boolean }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={back ? "M19 12 H5 M11 6 L5 12 L11 18" : "M5 12 H19 M13 6 L19 12 L13 18"} />
  </svg>
);

export function FunLessonTopBar({
  courseId,
  heading,
  index,
  total,
  chapterPercent,
  canGoPrev,
  canGoNext,
  onPrev,
  onNext,
  showNav,
  tools,
  onClose,
  onToggleOutline,
}: {
  courseId: string;
  heading: string;
  /** 1-based position among the chapter's real slides; null when unknown. */
  index: number | null;
  total: number;
  /** The chapter's progress (mean of its slides); null hides the bar. */
  chapterPercent: number | null;
  canGoPrev: boolean;
  canGoNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  /** Prev/Next in this bar: from 640px, or on a phone when it is the only way through. */
  showNav: "always" | "wide";
  tools?: ReactNode;
  /**
   * The way out of the lesson (to the course page). Under Fun the app's top bar is
   * not drawn over the viewer, so the bar carries its own 44px close, as on A-Lesson.
   */
  onClose?: () => void;
  /** Opens or closes the viewer's own outline (its sidebar), from the title; absent when there is none. */
  onToggleOutline?: () => void;
}) {
  const { t } = useTranslation("funCourse");
  const { t: tStudy } = useTranslation("studyContent");
  const { t: tCommon } = useTranslation("funCommon");
  const slide = getTerminology(ContentTerms.Slides, SystemTerms.Slides);
  const chapter = getTerminology(ContentTerms.Chapters, SystemTerms.Chapters);
  const label = t("lesson.chapterProgress", { chapter });
  const outlineHintId = useId();
  return (
    <div className={cn("fun-lesson-top", courseColourClass(courseId))} data-fun-lesson-top="">
      <div className="fun-lesson-top__row">
        {onClose ? (
          <button
            type="button"
            className="fun-lesson-top__close"
            aria-label={t("lesson.close", { slide: slide.toLocaleLowerCase() })}
            onClick={onClose}
          >
            <X aria-hidden="true" weight="bold" />
          </button>
        ) : null}
        {/* The page's one h1 (A-Lesson): the app's top bar is not drawn over the viewer. */}
        <h1 className="fun-lesson-top__title">
          {onToggleOutline ? (
            // The title opens the viewer's outline: no extra button, so the bar keeps one row on a phone.
            // What it opens is its description, kept out of the heading so the h1 reads the title only.
            <button
              type="button"
              className="fun-lesson-top__titlebtn"
              aria-describedby={outlineHintId}
              onClick={onToggleOutline}
            >
              <span className="fun-lesson-top__titletext">{heading || " "}</span>
              <CaretDown aria-hidden="true" weight="bold" />
            </button>
          ) : (
            heading || " "
          )}
        </h1>
        {onToggleOutline ? (
          <span id={outlineHintId} hidden>
            {t("lesson.outline", { chapter })}
          </span>
        ) : null}
        {index !== null && total > 0 ? (
          <p className="fun-lesson-top__position">
            <span aria-hidden="true">{t("lesson.position", { index, total })}</span>
            <span className="sr-only">{t("lesson.positionLabel", { slide, index, total })}</span>
          </p>
        ) : null}
        <nav
          className={cn("fun-lesson-top__nav", showNav === "always" ? "fun-lesson-top__nav--always" : null)}
          aria-label={t("lesson.navLabel", { slide })}
        >
          <FunButton variant="outline" compact onClick={onPrev} disabled={!canGoPrev} aria-label={tStudy("slideNav.previousSlide")}>
            <Arrow back />
            <span className="fun-lesson-top__navtext">{tStudy("slideNav.previous")}</span>
          </FunButton>
          <FunButton variant="primary" compact onClick={onNext} disabled={!canGoNext} aria-label={tStudy("slideNav.nextSlide")}>
            <span className="fun-lesson-top__navtext">{tStudy("slideNav.next")}</span>
            <Arrow />
          </FunButton>
        </nav>
        {tools ? <div className="fun-lesson-top__tools">{tools}</div> : null}
      </div>
      {chapterPercent !== null ? (
        <div className="fun-lesson-top__progress">
          <span className="fun-lesson-top__label">
            {label} · {tCommon("percent", { percent: chapterPercent })}
          </span>
          <FunProgress percent={chapterPercent} label={label} className="fun-lesson-top__bar" />
        </div>
      ) : null}
    </div>
  );
}

/**
 * The top bar as the viewer draws it. The chapter's progress shows only once the
 * institute's "hide progress" choice (courseDetails.hideProgressCard) is read and
 * off, so an institute that hides progress never sees a percent or bar here.
 */
export function FunViewerTopBar(props: Parameters<typeof FunLessonTopBar>[0]) {
  const hideProgress = useHideProgress();
  return <FunLessonTopBar {...props} chapterPercent={hideProgress === false ? props.chapterPercent : null} />;
}

const Padlock = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
    <rect x="3" y="7" width="10" height="7" rx="2" />
    <path d="M5.5 7 V5 a2.5 2.5 0 0 1 5 0 V7" />
  </svg>
);

/**
 * Phone bottom bar: what comes next, then Previous and Next as lip buttons.
 * A next slide held by a drip rule is named as locked, since Next cannot open it.
 */
export function FunLessonBottomBar({
  upNext,
  upNextLocked = false,
  canGoPrev,
  canGoNext,
  onPrev,
  onNext,
}: {
  upNext: string | null;
  /** The next slide is drip-locked. */
  upNextLocked?: boolean;
  canGoPrev: boolean;
  canGoNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  const { t } = useTranslation("funCourse");
  const { t: tStudy } = useTranslation("studyContent");
  const slide = getTerminology(ContentTerms.Slides, SystemTerms.Slides);
  return (
    <nav className="fun-lesson-bottom" aria-label={t("lesson.navLabel", { slide })} data-fun-lesson-bottom="">
      {upNext ? (
        <p className={cn("fun-lesson-bottom__next", upNextLocked && "fun-lesson-bottom__next--locked")}>
          {upNextLocked ? <Padlock /> : null}
          {t(upNextLocked ? "lesson.upNextLocked" : "lesson.upNext", { title: upNext })}
        </p>
      ) : null}
      <div className="fun-lesson-bottom__buttons">
        <FunButton variant="outline" onClick={onPrev} disabled={!canGoPrev} className="fun-lesson-bottom__prev" aria-label={tStudy("slideNav.previousSlide")}>
          {tStudy("slideNav.previous")}
        </FunButton>
        <FunButton variant="primary" onClick={onNext} disabled={!canGoNext} className="fun-lesson-bottom__nextbtn" aria-label={tStudy("slideNav.nextSlide")}>
          {tStudy("slideNav.next")}
          <Arrow />
        </FunButton>
      </div>
    </nav>
  );
}

/** "Chapter complete" hand-off, shown on the viewer's own conditions. */
export function FunChapterCompleteBar({
  nextChapterName,
  onNext,
  onDismiss,
}: {
  nextChapterName: string;
  onNext: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation("funCourse");
  const { t: tStudy } = useTranslation("studyContent");
  const chapter = getTerminology(ContentTerms.Chapters, SystemTerms.Chapters);
  return (
    <div className="fun-chapter-done" role="status">
      <span className="fun-chapter-done__tick" aria-hidden="true">
        <svg viewBox="0 0 28 28">
          <path d="M8 14.5 L12 18 L20 10" />
        </svg>
      </span>
      <div className="fun-chapter-done__text">
        <p className="fun-chapter-done__title">{t("lesson.chapterComplete", { chapter })}</p>
        <p className="fun-chapter-done__next">{nextChapterName}</p>
      </div>
      <FunButton variant="primary" compact onClick={onNext}>
        {tStudy("slideNav.next")}
        <Arrow />
      </FunButton>
      <button type="button" className="fun-chapter-done__close" onClick={onDismiss} aria-label={t("lesson.dismiss")}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" aria-hidden="true">
          <path d="M6 6 L18 18 M18 6 L6 18" />
        </svg>
      </button>
    </div>
  );
}
