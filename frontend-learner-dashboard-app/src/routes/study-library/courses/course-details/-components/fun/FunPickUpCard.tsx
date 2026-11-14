import { useTranslation } from "react-i18next";
import { FunButton } from "@/components/design-system/fun/FunButton";

/** The slide the course outline marks as current, as the side card needs it. */
export interface FunCurrentSlide {
  slideId: string;
  title: string;
  chapterName: string;
  /** The slide's type in words ("Video", "PDF"); empty when unknown. */
  typeLabel: string;
  /** True when it is this device's resume point, false for the first unfinished slide. */
  fromResume: boolean;
  /** Opens the slide through the outline's own handler (payment and access rules included). */
  open: () => void;
}

/**
 * Laptop side card: the same slide the outline marks as current, with its own
 * Continue. That is this device's resume point while it is unfinished and can
 * open, else the first unfinished slide that can open. Resume is per device,
 * so the card names the slide, never "the last one you opened", and the
 * eyebrow changes when the slide is not a resume point. Nothing current (all
 * done, or not loaded yet) draws nothing.
 */
export function FunPickUpCard({ current }: { current: FunCurrentSlide | null }) {
  const { t } = useTranslation("funCourse");
  if (!current || !current.title) return null;
  const meta = [current.chapterName, current.typeLabel].filter((part) => part.trim() !== "").join(" · ");
  return (
    <section className="fun-pickup" aria-labelledby="fun-pickup-title" data-fun-pickup={current.slideId}>
      <p className="fun-pickup__eyebrow">
        {current.fromResume ? t("course.pickUpEyebrow") : t("course.nextUpEyebrow")}
      </p>
      <div className="fun-pickup__row">
        <span className="fun-pickup__play" aria-hidden="true">
          <svg viewBox="0 0 16 18">
            <path d="M2 1.5 L14.5 9 L2 16.5 Z" />
          </svg>
        </span>
        <div className="fun-pickup__text">
          <h2 id="fun-pickup-title" className="fun-pickup__title">
            {current.title}
          </h2>
          {meta ? <p className="fun-pickup__meta">{meta}</p> : null}
        </div>
      </div>
      <FunButton block className="fun-pickup__cta" onClick={current.open}>
        {t("course.pickUpCta")}
      </FunButton>
    </section>
  );
}
