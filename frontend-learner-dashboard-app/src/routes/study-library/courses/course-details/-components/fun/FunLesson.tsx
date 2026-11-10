import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { FunButton } from "@/components/design-system/fun/FunButton";
import { FunProgress } from "@/components/design-system/fun/FunProgress";
import { courseColourClass } from "@/components/design-system/fun/course-palette";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";

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
}) {
  const { t } = useTranslation("funCourse");
  const { t: tStudy } = useTranslation("studyContent");
  const slide = getTerminology(ContentTerms.Slides, SystemTerms.Slides);
  const chapter = getTerminology(ContentTerms.Chapters, SystemTerms.Chapters);
  const label = t("lesson.chapterProgress", { chapter });
  return (
    <div className={cn("fun-lesson-top", courseColourClass(courseId))} data-fun-lesson-top="">
      <div className="fun-lesson-top__row">
        <h3 className="fun-lesson-top__title">{heading || " "}</h3>
        {index !== null && total > 0 ? (
          <p className="fun-lesson-top__position" aria-label={t("lesson.positionLabel", { slide, index, total })}>
            {t("lesson.position", { index, total })}
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
            {label} · {chapterPercent}%
          </span>
          <FunProgress percent={chapterPercent} label={label} className="fun-lesson-top__bar" />
        </div>
      ) : null}
    </div>
  );
}

/** Phone bottom bar: what comes next, then Previous and Next as lip buttons. */
export function FunLessonBottomBar({
  upNext,
  canGoPrev,
  canGoNext,
  onPrev,
  onNext,
}: {
  upNext: string | null;
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
      {upNext ? <p className="fun-lesson-bottom__next">{t("lesson.upNext", { title: upNext })}</p> : null}
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
