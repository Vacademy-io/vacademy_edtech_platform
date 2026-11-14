import { useIsMobile } from "@/hooks/use-mobile";
import { useTranslation } from "react-i18next";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { RoleTerms, SystemTerms } from "@/types/naming-settings";

export const ScheduleTestHeaderDescription = () => {
  const isMobile = useIsMobile();
  const { t } = useTranslation("assessment");
  const admin = getTerminology(RoleTerms.Admin, SystemTerms.Admin).toLocaleLowerCase();

  return (
    <div
      className={`mb-8 flex items-center justify-between ${isMobile ? "flex-wrap gap-4" : "gap-10"
        }`}
    >
      <div className="flex flex-col w-full max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          {t("scheduleTest.header.title")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground sm:text-base">
          {t("scheduleTest.header.description", { admin })}
        </p>
      </div>
    </div>
  );
};
