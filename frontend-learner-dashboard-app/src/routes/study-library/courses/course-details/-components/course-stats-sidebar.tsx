import { Steps } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import {
  formatTotalCourseDuration,
  SlideCountEntry,
  getBackendCourseDuration,
} from "@/utils/courseTime";
import { ReactNode } from "react";

type LevelOption = {
  _id: string;
  value: string;
  label: string;
};

export type CourseStatsSidebarProps = {
  title: string;
  levelOptions: LevelOption[];
  selectedLevel: string;
  slideCounts?: SlideCountEntry[];
  // NEW: Backend timing data (takes priority over slideCounts)
  backendReadTimeMinutes?: number;
  authorName?: string;
  ratingsSlot?: ReactNode;
  ctaSlot?: ReactNode;
};

export const CourseStatsSidebar = ({
  title,
  levelOptions,
  selectedLevel,
  slideCounts,
  backendReadTimeMinutes,
  authorName,
  ratingsSlot,
  ctaSlot,
}: CourseStatsSidebarProps) => {
  const { t } = useTranslation("courseDetailsA");
  const capitalizeFirst = (text: string): string => {
    return text;
  };

  // NEW: Use backend time if available, fallback to slide count calculation
  const totalDuration = (() => {
    // Priority 1: Backend read_time_in_minutes
    if (
      typeof backendReadTimeMinutes === "number" &&
      !Number.isNaN(backendReadTimeMinutes)
    ) {
      return getBackendCourseDuration(backendReadTimeMinutes);
    }

    // Priority 2: Fallback to slide count calculation
    return formatTotalCourseDuration(slideCounts || []);
  })();

  return (
    <div className="sticky top-4 space-y-4">
      <div className="relative bg-white border border-gray-200 rounded-md shadow-sm hover:shadow-md transition-all duration-300 p-3 sm:p-4 group">
        <div className="absolute inset-0 bg-gradient-to-br from-primary-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-md"></div>
        <div className="absolute top-0 end-0 w-12 h-12 bg-primary-100/20 rounded-full blur-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-700 -translate-y-1 translate-x-3"></div>

        <div className="relative">
          <h2 className="text-base font-bold text-gray-900 mb-4 line-clamp-2">
            {title}
          </h2>

          <div className="flex items-center space-x-2 mb-3">
            <div className="p-1.5 bg-gradient-to-br from-primary-100 to-primary-200 rounded-lg shadow-sm">
              <Steps size={16} className="text-primary-600" weight="duotone" />
            </div>
            <h3 className="text-sm font-bold text-gray-900">
              {t("statsSidebar.overview", {
                course: capitalizeFirst(
                  getTerminology(
                    ContentTerms.Course,
                    SystemTerms.Course
                  ).toLocaleLowerCase()
                ),
              })}
            </h3>
          </div>

          <div className="space-y-2">
            {authorName && (
              <div className="flex items-center justify-between p-2.5 bg-gray-50/80 rounded-lg">
                <span className="text-xs font-medium text-gray-700">
                  {t("statsSidebar.author")}
                </span>
                <span className="text-xs font-bold text-gray-900 bg-white px-2 py-0.5 rounded-md shadow-sm">
                  {authorName}
                </span>
              </div>
            )}
            {levelOptions.length > 0 &&
              selectedLevel &&
              levelOptions.find((o) => o.value === selectedLevel)?.label !==
                "default" && (
                <div className="flex items-center justify-between p-2.5 bg-gradient-to-r from-primary-50 to-primary-100 rounded-lg border border-primary-200">
                  <div className="flex items-center space-x-2">
                    <Steps
                      size={16}
                      className="text-primary-600"
                      weight="duotone"
                    />
                    <span className="text-xs font-medium text-primary-700">
                      {capitalizeFirst(
                        getTerminology(
                          ContentTerms.Level,
                          SystemTerms.Level
                        ).toLocaleLowerCase()
                      )}
                    </span>
                  </div>
                  <span className="text-xs font-bold text-primary-800">
                    {capitalizeFirst(
                      levelOptions.find((o) => o.value === selectedLevel)
                        ?.label || ""
                    )}
                  </span>
                </div>
              )}

            {/* Only total time shown, per-type stats hidden by design */}
            <div className="flex items-center justify-between p-2.5 bg-gray-50/80 rounded-lg">
              <span className="text-xs font-medium text-gray-700">
                {t("statsSidebar.courseTime", {
                  course: getTerminology(ContentTerms.Course, SystemTerms.Course),
                })}
              </span>
              <span className="text-xs font-bold text-gray-900 bg-white px-2 py-0.5 rounded-md shadow-sm">
                {totalDuration}
              </span>
            </div>
            {ctaSlot && <div>{ctaSlot}</div>}
          </div>
        </div>
      </div>

      {ratingsSlot && (
        <div className="animate-fade-in-up" style={{ animationDelay: "0.1s" }}>
          {ratingsSlot}
        </div>
      )}
    </div>
  );
};
