import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { CourseArt } from "@/components/design-system/fun/CourseArt";
import { ReviewLabel } from "@/components/design-system/fun/FinishedTick";
import { FunButton } from "@/components/design-system/fun/FunButton";
import { FunProgress } from "@/components/design-system/fun/FunProgress";
import { courseColourClass } from "@/components/design-system/fun/course-palette";
import LocalStorageUtils from "@/utils/localstorage";
import { levelSessionLine } from "../../course-details/-components/fun/course-outline";
import type { CoursePackage } from "@/types/course-catalog/course-catalog-list";

/*
 * The Fun skin's Learn list rows and states (styles/fun/course.css, "Learn list").
 * Kept free of request modules at import time: the catalogue page imports it for
 * every skin, and it only renders under ui-fun.
 */

/**
 * One course row: the course colour block (image on the tint, else the shape),
 * name, level and session, and the bar with "% done" in the course's text shade.
 * A finished course keeps its colour, gets the tick and the green Review label.
 * Opens the course page, as the card's title did.
 */
export function FunCourseRow({
  course,
  selectedTab,
  hideProgress,
}: {
  course: CoursePackage & { session_name?: string | null };
  selectedTab: string;
  hideProgress: boolean;
}) {
  const { t } = useTranslation("funCommon");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const previewId = course.course_preview_image_media_id || "";
  useEffect(() => {
    let live = true;
    if (!previewId) {
      setImageUrl(null);
      return;
    }
    // Loaded on use: this module stays free of request code at import time.
    import("@/services/upload_file")
      .then(({ getPublicUrlWithoutLogin }) => getPublicUrlWithoutLogin(previewId))
      .then((url) => live && setImageUrl(url || null))
      .catch(() => live && setImageUrl(null));
    return () => {
      live = false;
    };
  }, [previewId]);

  const percent = Math.max(0, Math.min(100, Number(course.percentage_completed) || 0));
  const finished = percent >= 100;
  // In progress and Completed list only enrolled courses; on All a course with
  // no progress may be one the learner has not joined, so it says nothing.
  const enrolledKnown = selectedTab === "PROGRESS" || selectedTab === "COMPLETED" || percent > 0;
  const name = course.package_name || "";
  const meta = levelSessionLine(course.level_name, course.session_name);
  const search = {
    courseId: course.id,
    packageSessionId: course.package_session_id || undefined,
    selectedTab,
    percentageCompleted: percent,
  };
  const remember = () => {
    try {
      LocalStorageUtils.set(`COURSE_PCT_${course.id}`, { value: percent, ts: Date.now() });
    } catch {
      // storage unavailable
    }
  };

  let progress: ReactNode = null;
  if (!hideProgress) {
    if (finished) {
      progress = (
        <span className="fun-learn-row__status fun-learn-row__status--done">
          <span>{t("done")}</span>
          <span aria-hidden="true">·</span>
          <ReviewLabel />
        </span>
      );
    } else if (percent > 0) {
      progress = (
        <span className="fun-learn-row__progress">
          <FunProgress percent={percent} />
          <span className="fun-learn-row__percent">{t("percentDone", { percent: Math.round(percent) })}</span>
        </span>
      );
    } else if (enrolledKnown) {
      progress = (
        <span className="fun-learn-row__progress">
          <span className="fun-progress" aria-hidden="true" />
          <span className="fun-learn-row__muted">{t("notStarted")}</span>
        </span>
      );
    }
  }

  return (
    <li className="fun-learn-row-item">
      <Link
        to="/study-library/courses/course-details"
        search={search}
        onClick={remember}
        className={cn("fun-learn-row", courseColourClass(course.id))}
      >
        <CourseArt
          courseId={course.id}
          name={name}
          imageUrl={imageUrl}
          finished={finished && !hideProgress}
          className="fun-learn-row__art"
        />
        <span className="fun-learn-row__body">
          <span className="fun-learn-row__name">{name}</span>
          {meta ? <span className="fun-learn-row__meta">{meta}</span> : null}
          {progress}
        </span>
      </Link>
    </li>
  );
}

/** Rows at their final size while a tab loads. */
export function FunLearnSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <ul className="fun-learn-list" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="fun-learn-row fun-learn-row--skeleton">
          <span className="fun-skeleton fun-learn-row__art" />
          <span className="fun-learn-row__body">
            <span className="fun-skeleton fun-learn-sk__name" />
            <span className="fun-skeleton fun-learn-sk__meta" />
            <span className="fun-skeleton fun-learn-sk__bar" />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Empty and no-match states: the catalogue's own copy for the tab. */
export function FunLearnEmpty({ title, description }: { title: string; description: string }) {
  return (
    <div className="fun-learn-state" role="status">
      <span className="fun-learn-state__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="M15.5 15.5 L20 20" />
        </svg>
      </span>
      <p className="fun-learn-state__title">{title}</p>
      {description ? <p className="fun-learn-state__body">{description}</p> : null}
    </div>
  );
}

/** A tab whose request failed: not the empty state, and a way to try again. */
export function FunLearnError({ title, onRetry }: { title: string; onRetry: () => void }) {
  const { t } = useTranslation("funCourse");
  return (
    <div className="fun-learn-state fun-learn-state--error" role="alert">
      <span className="fun-learn-state__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7.5 V13 M12 16.4 V16.5" />
        </svg>
      </span>
      <p className="fun-learn-state__title">{title}</p>
      <FunButton variant="primary" compact onClick={onRetry}>
        {t("learn.retry")}
      </FunButton>
    </div>
  );
}

/** The rows of one tab. Honours the institute's "hide progress" choice. */
export function FunLearnList({
  courses,
  selectedTab,
  hideProgress,
}: {
  courses: ReadonlyArray<CoursePackage & { session_name?: string | null }>;
  selectedTab: string;
  hideProgress: boolean;
}) {
  return (
    <ul className="fun-learn-list">
      {courses.map((course, index) => (
        <FunCourseRow
          key={`${course.id || "no-id"}-${index}`}
          course={course}
          selectedTab={selectedTab}
          hideProgress={hideProgress}
        />
      ))}
    </ul>
  );
}

/** On All, the desktop filter toggle (phones open filters from their own button). */
export function FunLearnTools({
  showFilterToggle,
  isFilterOpen,
  onFilterToggle,
  activeFiltersCount,
}: {
  showFilterToggle: boolean;
  isFilterOpen: boolean;
  onFilterToggle: () => void;
  activeFiltersCount: number;
}) {
  const { t } = useTranslation("study");
  if (!showFilterToggle || isFilterOpen) return null;
  return (
    <div className="fun-learn-tools">
      <button type="button" className="fun-learn-tools__filter" onClick={onFilterToggle}>
        {t("filters.title")}
        {activeFiltersCount > 0 ? <span className="fun-learn-tools__badge">{activeFiltersCount}</span> : null}
      </button>
    </div>
  );
}

