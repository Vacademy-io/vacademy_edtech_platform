import { useTranslation } from "react-i18next";
import { useRouter } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { CourseArt } from "@/components/design-system/fun/CourseArt";
import { FunProgress } from "@/components/design-system/fun/FunProgress";
import { courseColourClass } from "@/components/design-system/fun/course-palette";
import { getTerminology, getTerminologyPlural } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import type { CountKind } from "./course-outline";

const TERMS: Record<CountKind, [ContentTerms, SystemTerms]> = {
  subjects: [ContentTerms.Subjects, SystemTerms.Subjects],
  modules: [ContentTerms.Modules, SystemTerms.Modules],
  chapters: [ContentTerms.Chapters, SystemTerms.Chapters],
  slides: [ContentTerms.Slides, SystemTerms.Slides],
};

const countTerm = (kind: CountKind, count: number) => {
  const [key, fallback] = TERMS[kind];
  return (count === 1 ? getTerminology(key, fallback) : getTerminologyPlural(key, fallback)).toLocaleLowerCase();
};

/**
 * The course page header in the course's own colour (radius 0 0 28 28 on a
 * phone, 28 all round from 640px). Title, count chips and the batch's percent;
 * the percent hides under the institute's "hide progress" choice and while it is
 * not known. A finished course keeps its colour.
 */
export function FunCourseBand({
  courseId,
  title,
  eyebrow,
  summary,
  imageUrl,
  counts,
  percent,
  hidePercent,
}: {
  courseId: string;
  title: string;
  eyebrow?: string;
  summary?: string;
  imageUrl?: string | null;
  counts: Array<{ kind: CountKind; count: number }>;
  percent: number | null;
  hidePercent: boolean;
}) {
  const { t } = useTranslation("funCourse");
  const router = useRouter();
  const course = getTerminology(ContentTerms.Course, SystemTerms.Course);
  const courseLower = course.toLocaleLowerCase();
  const showPercent = !hidePercent && percent !== null;
  const rounded = percent === null ? null : Math.round(percent);

  const goBack = () => {
    if (window.history.length > 1) {
      router.history.back();
      return;
    }
    void router.navigate({ to: "/study-library/courses" });
  };

  return (
    <section
      className={cn("fun-band fun-on-colour", courseColourClass(courseId))}
      aria-labelledby="fun-course-title"
      data-fun-course-band=""
    >
      <CourseArt courseId={courseId} name={title} imageUrl={imageUrl ?? null} className="fun-band__art" />
      <div className="fun-band__body">
        <button type="button" className="fun-band__back" aria-label={t("course.back")} onClick={goBack}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 5 L8 12 L15 19" />
          </svg>
        </button>
        {eyebrow ? <p className="fun-band__eyebrow">{eyebrow}</p> : null}
        <h1 id="fun-course-title" className="fun-band__title">
          {title}
        </h1>
        {summary ? <p className="fun-band__summary">{summary}</p> : null}
        {counts.length > 0 ? (
          <ul className="fun-band__chips" aria-label={t("course.sizeLabel", { course })}>
            {counts.map(({ kind, count }) => (
              <li key={kind}>{t("course.countChip", { count, term: countTerm(kind, count) })}</li>
            ))}
          </ul>
        ) : null}
        {showPercent ? (
          <div className="fun-band__progress">
            <FunProgress percent={rounded} tone="band" label={t("course.progressLabel", { course })} />
            <span className="fun-band__percent fun-band__percent--short">{rounded}%</span>
            <span className="fun-band__percent fun-band__percent--long">
              {t("course.percentOfCourse", { percent: rounded, course: courseLower })}
            </span>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** The band's shape while the course loads, at its final size. */
export function FunCourseBandSkeleton() {
  return (
    <div className="fun-band fun-band--skeleton" aria-hidden="true">
      <div className="fun-band__body">
        <span className="fun-skeleton fun-band__sk-back" />
        <span className="fun-skeleton fun-band__sk-title" />
        <span className="fun-skeleton fun-band__sk-line" />
        <span className="fun-skeleton fun-band__sk-bar" />
      </div>
    </div>
  );
}
