import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { FunButton } from "@/components/design-system/fun/FunButton";
import { getResumeForCourse, resumeSearchParams, RESUME_ROUTE, useResumeScope } from "@/services/resume-thread";

/**
 * Laptop side card: this device's resume point in the course, when there is one.
 * Resume is per device, so the card names the slide, never "the last one you
 * opened". With no entry it draws nothing; the outline's current row then marks
 * the first unfinished slide.
 */
export function FunPickUpCard({ courseId }: { courseId: string }) {
  const { t } = useTranslation("funCourse");
  const scope = useResumeScope();
  const entry = useMemo(() => (courseId ? getResumeForCourse(scope, courseId) : null), [scope, courseId]);
  if (!entry || !entry.slideTitle) return null;
  return (
    <section className="fun-pickup" aria-labelledby="fun-pickup-title">
      <p className="fun-pickup__eyebrow">{t("course.pickUpEyebrow")}</p>
      <div className="fun-pickup__row">
        <span className="fun-pickup__play" aria-hidden="true">
          <svg viewBox="0 0 16 18">
            <path d="M2 1.5 L14.5 9 L2 16.5 Z" />
          </svg>
        </span>
        <div className="fun-pickup__text">
          <h2 id="fun-pickup-title" className="fun-pickup__title">
            {entry.slideTitle}
          </h2>
          {entry.chapterName ? <p className="fun-pickup__meta">{entry.chapterName}</p> : null}
        </div>
      </div>
      <FunButton asChild block className="fun-pickup__cta">
        <Link to={RESUME_ROUTE} search={resumeSearchParams(entry) as never}>
          {t("course.pickUpCta")}
        </Link>
      </FunButton>
    </section>
  );
}
