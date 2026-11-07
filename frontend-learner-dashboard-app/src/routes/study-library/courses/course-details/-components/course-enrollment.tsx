import { GraduationCap } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
// Note: Select imports kept for the Batch/Subgroup dropdown below
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getTerminology,
  getTerminologyPlural,
} from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, RoleTerms, SystemTerms } from "@/types/naming-settings";
import { shouldHidePaidPurchaseUI } from "@/utils/ios-iap-compliance";

// Static label for a session/level field — dropdowns are deprecated in favour of
// navigating to the course from the catalog with a specific packageSessionId in the URL.
const StaticField = ({ label, value }: { label: string; value: string }) => (
  <div className="flex flex-col gap-1.5">
    <span className="text-xs font-medium text-muted-foreground ms-1">
      {label}
    </span>
    <div className="px-3 py-2.5 bg-muted/50 rounded-md border text-sm font-medium">
      {value}
    </div>
  </div>
);

interface SessionOption {
  _id: string;
  value: string;
  label: string;
}

interface LevelOption {
  _id: string;
  value: string;
  label: string;
}

interface BatchOption {
  id: string;
  label: string;
  isParent: boolean;
}

interface EnrolledSession {
  id: string;
  session: {
    id: string;
    session_name: string;
    status: string;
    start_date: string;
  };
  level: {
    id: string;
    level_name: string;
    duration_in_days: number | null;
    thumbnail_id: string | null;
  };
  start_time: string | null;
  status: string;
  package_dto: {
    id: string;
    package_name: string;
    thumbnail_id?: string | null;
  };
}

interface CourseEnrollmentProps {
  showCourseConfiguration: boolean;
  /** "contentOnly" course-details layout: keep the Class/Section picker (a
   *  learner enrolled in several batches still has to switch between them) and
   *  drop everything else in this card — session/level labels, the preview
   *  notice and the enroll CTA are all shopper-facing. The card hides itself
   *  entirely when there is no batch choice to make. */
  batchPickerOnly?: boolean;
  selectedTab: string;
  sessionOptions: SessionOption[];
  levelOptions: LevelOption[];
  batchOptions: BatchOption[];
  selectedSession: string;
  selectedLevel: string;
  selectedBatchId: string;
  shouldShowBatchDropdown: boolean;
  enrolledSessions: EnrolledSession[];
  courseId: string;
  hasRightSidebar: boolean;
  paymentType?: string | null;
  certificateUrl?: string | null;
  packageSessionIdForCurrentLevel?: string | null;
  onBatchChange: (value: string) => void;
  onEnrollmentClick: () => void;
}

export const CourseEnrollment = ({
  showCourseConfiguration,
  batchPickerOnly = false,
  selectedTab,
  sessionOptions,
  levelOptions,
  batchOptions,
  selectedSession,
  selectedLevel,
  selectedBatchId,
  shouldShowBatchDropdown,
  enrolledSessions,
  courseId,
  hasRightSidebar,
  paymentType,
  certificateUrl,
  packageSessionIdForCurrentLevel,
  onBatchChange,
  onEnrollmentClick,
}: CourseEnrollmentProps) => {
  const { t } = useTranslation("courseDetailsA");
  if (!showCourseConfiguration) return null;

  const safeEnrolledSessions = enrolledSessions || [];
  const isEnrolledInCourse = safeEnrolledSessions.some(
    (enrolledSession) => enrolledSession.package_dto.id === courseId,
  );

  // Decide whether the card body would render anything meaningful — if not,
  // hide the entire card so we don't show a header with nothing under it.
  // Most commonly triggered when both session and level are the backend's
  // "Default" placeholder, no batch picker is needed, and there's nothing
  // tab-specific (preview notice / enroll CTA) to render either.
  const safeSessionOptions = sessionOptions || [];
  const sessionLabel = safeSessionOptions.find(
    (o) => o.value === selectedSession,
  )?.label;
  const levelLabel = (levelOptions || []).find(
    (o) => o.value === selectedLevel,
  )?.label;
  const isDefault = (n: string | null | undefined) =>
    !n || n.trim().toLowerCase() === "default";
  const showSessionField =
    !batchPickerOnly && !!sessionLabel && !isDefault(sessionLabel);
  const showLevelField =
    !batchPickerOnly && !!levelLabel && !isDefault(levelLabel);
  const showBatchPicker =
    shouldShowBatchDropdown &&
    (batchOptions || []).length > 0 &&
    !!selectedSession &&
    !!selectedLevel;
  const showPreviewNotice =
    !batchPickerOnly &&
    safeSessionOptions.length > 0 &&
    selectedTab === "ALL" &&
    !isEnrolledInCourse;
  const showNoSessionsWarning =
    !batchPickerOnly && safeSessionOptions.length === 0;
  const currentPackageSessionId =
    selectedBatchId || packageSessionIdForCurrentLevel || "";
  const isAlreadyEnrolledInCurrent = safeEnrolledSessions.some(
    (enrolledSession) => {
      // Original trio match (preserved).
      if (
        enrolledSession.package_dto.id === courseId &&
        enrolledSession.session.id === selectedSession &&
        enrolledSession.level.id === selectedLevel &&
        (!selectedBatchId || enrolledSession.id === selectedBatchId)
      ) {
        return true;
      }
      // Additive: match by package_session_id when session/level on the
      // enrollment record are empty/placeholder.
      return (
        !!currentPackageSessionId &&
        enrolledSession.id === currentPackageSessionId
      );
    },
  );
  const showInlineEnroll =
    !batchPickerOnly &&
    !hasRightSidebar &&
    selectedTab === "ALL" &&
    !!selectedSession &&
    !!selectedLevel &&
    !isAlreadyEnrolledInCurrent &&
    // Reader mode: never surface an enroll/pay CTA (Apple 3.1.1).
    !shouldHidePaidPurchaseUI();
  const hasAnythingToShow =
    showSessionField ||
    showLevelField ||
    showBatchPicker ||
    showPreviewNotice ||
    showNoSessionsWarning ||
    showInlineEnroll;
  if (!hasAnythingToShow) return null;

  return (
    <Card
      className="group relative overflow-hidden transition-all duration-300 hover:shadow-lg animate-fade-in-up border-border/60"
      style={{ animationDelay: "0.1s" }}
    >
      {/* Background gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"></div>

      {/* Floating orb effect */}
      <div className="absolute top-0 end-0 w-16 h-16 bg-primary/10 rounded-full blur-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-700 -translate-y-1 translate-x-3 pointer-events-none"></div>

      <CardHeader className="p-3 pb-2 space-y-0">
        <div className="flex items-center space-x-2">
          <div className="p-1 bg-primary/10 rounded-md shadow-sm ring-1 ring-primary/20">
            <GraduationCap
              size={16}
              className="text-primary"
              weight="duotone"
            />
          </div>
          <CardTitle className="text-sm font-bold">
            {t("enrollment.configurationTitle", {
              course: getTerminology(ContentTerms.Course, SystemTerms.Course),
            })}
          </CardTitle>
        </div>
      </CardHeader>

      <CardContent className="p-3 pt-0">
        {sessionOptions && sessionOptions.length > 0 ? (
          <div className="space-y-2.5">
            {/* Preview notice for ALL tab - only show if user is not enrolled */}
            {showPreviewNotice && (
              <div className="p-2 bg-blue-50/80 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md text-sm space-y-1">
                <div className="flex items-center gap-x-2 text-blue-700 dark:text-blue-300 font-medium">
                  <div className="w-1.5 h-1.5 bg-blue-500 rounded-full"></div>
                  <span>
                    {t("enrollment.previewMode", {
                      course: getTerminology(ContentTerms.Course, SystemTerms.Course),
                    })}
                  </span>
                </div>
                <p className="text-blue-600/90 dark:text-blue-400 ps-3.5 text-xs leading-relaxed">
                  {t("enrollment.previewNotice", {
                    slides: getTerminologyPlural(
                      ContentTerms.Slides,
                      SystemTerms.Slides,
                    ).toLocaleLowerCase(),
                  })}
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Session — static label, no dropdown */}
              {!batchPickerOnly &&
                (() => {
                  const sessionLabel = sessionOptions.find(
                    (o) => o.value === selectedSession,
                  )?.label;
                  return sessionLabel &&
                    sessionLabel.toLowerCase() !== "default" ? (
                    <StaticField
                      label={getTerminology(
                        ContentTerms.Session,
                        SystemTerms.Session,
                      )}
                      value={sessionLabel}
                    />
                  ) : null;
                })()}

              {/* Level — static label, no dropdown */}
              {!batchPickerOnly &&
                (() => {
                  const levelLabel = levelOptions.find(
                    (o) => o.value === selectedLevel,
                  )?.label;
                  return levelLabel &&
                    levelLabel.toLowerCase() !== "default" ? (
                    <StaticField
                      label={getTerminology(
                        ContentTerms.Level,
                        SystemTerms.Level,
                      )}
                      value={levelLabel}
                    />
                  ) : null;
                })()}

              {/* Batch / Subgroup Selector - only when child subgroups exist */}
              {shouldShowBatchDropdown &&
                batchOptions.length > 0 &&
                selectedSession &&
                selectedLevel && (
                  <div className="flex flex-col gap-1.5 sm:col-span-2">
                    <span className="text-xs font-medium text-muted-foreground ms-1">
                      {t("enrollment.classSection")}
                    </span>
                    <Select
                      value={selectedBatchId}
                      onValueChange={onBatchChange}
                    >
                      <SelectTrigger className="w-full bg-background">
                        <SelectValue placeholder={t("enrollment.classSectionPlaceholder")} />
                      </SelectTrigger>
                      <SelectContent>
                        {batchOptions.map((option) => (
                          <SelectItem key={option.id} value={option.id}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
            </div>
          </div>
        ) : (
          <div className="p-4 bg-yellow-50/50 dark:bg-yellow-900/10 border border-yellow-200 dark:border-yellow-800 rounded-lg space-y-1.5">
            <div className="flex items-center gap-x-2">
              <div className="w-1.5 h-1.5 bg-yellow-500 rounded-full"></div>
              <span className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                {selectedTab === "ALL"
                  ? t("enrollment.noActiveSessions", {
                      sessions: getTerminologyPlural(
                        ContentTerms.Session,
                        SystemTerms.Session,
                      ).toLocaleLowerCase(),
                    })
                  : t("enrollment.notEnrolled")}
              </span>
            </div>
            <p className="text-xs text-yellow-700 dark:text-yellow-400 ps-3.5 leading-relaxed">
              {selectedTab === "ALL"
                ? t("enrollment.requiresConfiguration", {
                    course: getTerminology(
                      ContentTerms.Course,
                      SystemTerms.Course,
                    ).toLocaleLowerCase(),
                  })
                : t("enrollment.contactTeacherToEnroll", {
                    teacher: getTerminology(
                      RoleTerms.Teacher,
                      SystemTerms.Teacher,
                    ).toLocaleLowerCase(),
                  })}
            </p>
          </div>
        )}

        {/* Inline Enroll card when sidebar is hidden */}
        {!batchPickerOnly &&
          !hasRightSidebar &&
          selectedTab === "ALL" &&
          !shouldHidePaidPurchaseUI() &&
          (() => {
            if (!selectedSession || !selectedLevel) return null;
            if (isAlreadyEnrolledInCurrent) return null;
            return (
              <div className="mt-4 pt-4 border-t border-border/50">
                <Button
                  type="button"
                  size="lg"
                  className="w-full font-semibold shadow-sm"
                  onClick={onEnrollmentClick}
                >
                  {t("enrollment.enrollNow")}
                </Button>
              </div>
            );
          })()}
      </CardContent>
    </Card>
  );
};
