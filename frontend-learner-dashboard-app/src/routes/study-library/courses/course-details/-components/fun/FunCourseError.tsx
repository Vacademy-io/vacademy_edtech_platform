import { useTranslation } from "react-i18next";
import { FunButton } from "@/components/design-system/fun/FunButton";

/**
 * The course page's load error under the Fun skin: the same copy and the same
 * way back as the default page, on the skin's state card (styles/fun/course.css).
 */
export function FunCourseError({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation("courseDetailsC");
  return (
    <div className="fun-course-error">
      <div className="fun-learn-state fun-learn-state--error" role="alert">
        <span className="fun-learn-state__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7.5 V13 M12 16.4 V16.5" />
          </svg>
        </span>
        <h2 className="fun-learn-state__title">{t("errorPage.title")}</h2>
        <p className="fun-learn-state__body">{t("errorPage.description")}</p>
        <FunButton variant="primary" compact onClick={onBack}>
          {t("common.goBack")}
        </FunButton>
      </div>
    </div>
  );
}
