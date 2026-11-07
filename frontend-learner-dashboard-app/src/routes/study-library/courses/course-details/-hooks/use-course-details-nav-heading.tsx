import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavHeadingStore } from "@/stores/layout-container/useNavHeadingStore";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";

// Shared by the page and its loading state, so the top bar names the screen from
// the moment it opens and does not change when the content lands. Waits for the
// translations rather than setting a raw key, and follows a language change.
export function useCourseDetailsNavHeading() {
  const { t, ready } = useTranslation("courseDetailsA");
  const { setNavHeading } = useNavHeadingStore();

  useEffect(() => {
    if (!ready) return;
    setNavHeading(
      <div className="flex items-center gap-2">
        <div>
          {t("detailsPage.heading", {
            course: getTerminology(ContentTerms.Course, SystemTerms.Course),
          })}
        </div>
      </div>,
    );
  }, [setNavHeading, ready, t]);
}
