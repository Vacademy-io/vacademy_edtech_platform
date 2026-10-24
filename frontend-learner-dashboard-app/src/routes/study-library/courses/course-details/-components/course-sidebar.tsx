import {
  FileText,
  PresentationChart,
  Folder,
  ChalkboardTeacher,
  TrendUp,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Steps } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  getTerminology,
  getTerminologyPlural,
} from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, RoleTerms, SystemTerms } from "@/types/naming-settings";
import { shouldHidePaidPurchaseUI } from "@/utils/ios-iap-compliance";
import { CourseDetailsRatingsComponent } from "./course-details-ratings-page";
import {
  formatTotalCourseDuration,
  SlideCountEntry,
  getBackendCourseDuration,
} from "@/utils/courseTime";
import { ProgressBar } from "@/components/ui/custom-progress-bar";

interface LevelOption {
  _id: string;
  value: string;
  label: string;
}

interface SlideCount {
  source_type: string;
  slide_count: number;
  display_name: string;
}

interface ModuleStats {
  totalModules: number;
  totalChapters: number;
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

interface CourseSidebarProps {
  hasRightSidebar: boolean;
  levelOptions: LevelOption[];
  selectedLevel: string;
  slideCountQuery: {
    isLoading: boolean;
    error: unknown;
    data?: Array<{
      slide_count: number;
      total_read_time_minutes: number | null;
      source_type: string;
    }>;
  };
  overviewVisible: boolean;
  /** When true, hide the "Author" row in the Course Overview card. */
  hideAuthorName?: boolean;
  processedSlideCounts: SlideCount[];
  moduleStats: ModuleStats;
  currentSubjects: unknown[];
  courseStructure: number;
  instructorsCount: number;
  selectedTab: string;
  selectedSession: string;
  enrolledSessions: EnrolledSession[];
  courseId: string;
  primaryInstructorName?: string;
  backendReadTimeMinutes?: number;
  paymentType?: string | null;
  packageSessionIdForCurrentLevel?: string | null;
  /**
   * Whether certificates are switched on for this batch, resolved server-side
   * from Certificate Settings. When false the certificate messaging is hidden
   * entirely — promising a certificate that will never be issued is worse than
   * saying nothing.
   */
  certificatesEnabled?: boolean;
  percentageCompleted?: number;
  onEnrollmentClick: () => void;
  onRatingsLoadingChange: (loading: boolean) => void;
}

export const CourseSidebar = ({
  hasRightSidebar,
  levelOptions,
  selectedLevel,
  slideCountQuery,
  overviewVisible,
  hideAuthorName = false,
  processedSlideCounts,
  moduleStats,
  currentSubjects,
  courseStructure,
  instructorsCount,
  selectedTab,
  selectedSession,
  enrolledSessions,
  courseId,
  primaryInstructorName,
  backendReadTimeMinutes,
  packageSessionIdForCurrentLevel,
  percentageCompleted,
  certificatesEnabled,
  onEnrollmentClick,
  onRatingsLoadingChange,
}: CourseSidebarProps) => {
  const { t } = useTranslation("courseDetailsA");
  const teacher = getTerminology(RoleTerms.Teacher, SystemTerms.Teacher);
  const capitalizeFirst = (text: string): string => text;

  const safeEnrolledSessions = enrolledSessions || [];
  // Enrolled in THIS course at all (any batch/level) — an Enroll CTA is
  // meaningless for an already-enrolled learner, so it must never render.
  const isEnrolledInCourse = safeEnrolledSessions.some(
    (enrolledSession) => enrolledSession.package_dto.id === courseId,
  );
  const isAlreadyEnrolled = safeEnrolledSessions.some((enrolledSession) => {
    // Original trio match — works when session/level resolve to real UUIDs.
    if (
      enrolledSession.package_dto.id === courseId &&
      enrolledSession.session.id === selectedSession &&
      enrolledSession.level.id === selectedLevel
    ) {
      return true;
    }
    // Additive: match by package_session_id (unique batch key). Covers cases
    // where the enrollment record carries empty/DEFAULT session/level ids
    // (e.g. backend PROGRESS results for courses with placeholder sessions).
    return (
      !!packageSessionIdForCurrentLevel &&
      enrolledSession.id === packageSessionIdForCurrentLevel
    );
  });

  // Compute total duration
  const totalDuration = (() => {
    if (
      typeof backendReadTimeMinutes === "number" &&
      !Number.isNaN(backendReadTimeMinutes) &&
      backendReadTimeMinutes > 0
    ) {
      return getBackendCourseDuration(backendReadTimeMinutes);
    }

    const raw = (slideCountQuery as unknown as { data?: SlideCountEntry[] })
      ?.data;
    if (raw && Array.isArray(raw)) {
      const totalMinutesFromSlides = raw.reduce((sum, entry) => {
        if (typeof entry.total_read_time_minutes === "number") {
          return sum + entry.total_read_time_minutes;
        }
        return sum;
      }, 0);

      if (totalMinutesFromSlides > 0) {
        return formatTotalCourseDuration(raw);
      }
    }

    const mapped: SlideCountEntry[] = (processedSlideCounts || []).map((c) => ({
      slide_count: c.slide_count,
      total_read_time_minutes: null,
      source_type: c.source_type,
    }));
    return formatTotalCourseDuration(mapped);
  })();

  const displayAuthorName = (() => {
    if (
      primaryInstructorName &&
      String(primaryInstructorName).trim().length > 0
    ) {
      return primaryInstructorName;
    }
    if (instructorsCount > 0) {
      return t("sidebar.unknownInstructor", { teacher });
    }
    return undefined;
  })();

  if (!hasRightSidebar) return null;

  return (
    <div className="space-y-3 pb-3">
      {/* Course Overview Card */}
      <Card className="animate-fade-in-up transition-all duration-300 hover:shadow-md border-border/60">
        <CardHeader className="p-3 pb-2 border-b bg-muted/40">
          <div className="flex items-center space-x-2">
            <div className="p-1 bg-primary/10 rounded-md">
              <Steps size={14} className="text-primary" weight="duotone" />
            </div>
            <CardTitle className="text-sm font-bold">
              {t("sidebar.overview", {
                course: (() => {
                  const term = getTerminology(
                    ContentTerms.Course,
                    SystemTerms.Course,
                  ).toLocaleLowerCase();
                  return term.charAt(0).toUpperCase() + term.slice(1);
                })(),
              })}
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-3 pt-2.5 space-y-2.5">
          {/* Author Name */}
          {!hideAuthorName && (
            <>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground font-medium">{t("sidebar.author")}</span>
                <span className="font-semibold">{displayAuthorName || "—"}</span>
              </div>

              <Separator />
            </>
          )}

          {/* Level Badge */}
          {levelOptions.length > 0 &&
            selectedLevel &&
            levelOptions.find((option) => option.value === selectedLevel)
              ?.label !== "default" && (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground font-medium flex items-center gap-1.5">
                    <Steps size={14} className="text-muted-foreground" />
                    {capitalizeFirst(
                      getTerminology(
                        ContentTerms.Level,
                        SystemTerms.Level,
                      ).toLocaleLowerCase(),
                    )}
                  </span>
                  <span className="px-2 py-0.5 bg-primary/10 text-primary text-xs font-semibold rounded-md">
                    {capitalizeFirst(
                      levelOptions.find(
                        (option) => option.value === selectedLevel,
                      )?.label || "",
                    )}
                  </span>
                </div>
                <Separator />
              </>
            )}

          {/* Course Time */}
          {slideCountQuery.isLoading ? (
            <div className="flex justify-between items-center animate-pulse">
              <div className="h-4 w-20 bg-muted rounded"></div>
              <div className="h-4 w-12 bg-muted rounded"></div>
            </div>
          ) : !slideCountQuery.error ? (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground font-medium">
                {t("sidebar.courseTime", {
                  course: getTerminology(ContentTerms.Course, SystemTerms.Course),
                })}
              </span>
              <span className="font-semibold">{totalDuration}</span>
            </div>
          ) : null}

          {/* Module Stats */}
          {overviewVisible && (
            <div className="space-y-3 pt-2">
              {/* A course below the depth that shows modules/chapters still
                  has one seeded "DEFAULT" row at each hidden level holding its
                  slides, so counting those told the learner about a hierarchy
                  they can't see ("Modules 1, Chapters 1" on a flat course).
                  Only that single placeholder is suppressed — a course that
                  genuinely has several keeps its count. */}
              {(courseStructure >= 4 || moduleStats.totalModules > 1) &&
                moduleStats.totalModules > 0 && (
                <div className="flex items-center justify-between text-sm group/item">
                  <div className="flex items-center gap-2 text-muted-foreground group-hover/item:text-foreground transition-colors">
                    <FileText
                      size={16}
                      className="text-blue-500"
                      weight="duotone"
                    />
                    <span>
                      {capitalizeFirst(
                        getTerminology(
                          ContentTerms.Modules,
                          SystemTerms.Modules,
                        ).toLocaleLowerCase(),
                      )}
                    </span>
                  </div>
                  <span className="font-semibold">
                    {moduleStats.totalModules}
                  </span>
                </div>
              )}
              {(courseStructure >= 3 || moduleStats.totalChapters > 1) &&
                moduleStats.totalChapters > 0 && (
                <div className="flex items-center justify-between text-sm group/item">
                  <div className="flex items-center gap-2 text-muted-foreground group-hover/item:text-foreground transition-colors">
                    <PresentationChart
                      size={16}
                      className="text-green-500"
                      weight="duotone"
                    />
                    <span>
                      {capitalizeFirst(
                        getTerminology(
                          ContentTerms.Chapters,
                          SystemTerms.Chapters,
                        ).toLocaleLowerCase(),
                      )}
                    </span>
                  </div>
                  <span className="font-semibold">
                    {moduleStats.totalChapters}
                  </span>
                </div>
              )}
              {courseStructure === 5 && currentSubjects.length > 0 && (
                <div className="flex items-center justify-between text-sm group/item">
                  <div className="flex items-center gap-2 text-muted-foreground group-hover/item:text-foreground transition-colors">
                    <Folder
                      size={16}
                      className="text-purple-500"
                      weight="duotone"
                    />
                    <span>
                      {capitalizeFirst(
                        getTerminology(
                          ContentTerms.Subjects,
                          SystemTerms.Subjects,
                        ).toLocaleLowerCase(),
                      )}
                    </span>
                  </div>
                  <span className="font-semibold">
                    {currentSubjects.length}
                  </span>
                </div>
              )}
              {instructorsCount > 0 && (
                <div className="flex items-center justify-between text-sm group/item">
                  <div className="flex items-center gap-2 text-muted-foreground group-hover/item:text-foreground transition-colors">
                    <ChalkboardTeacher
                      size={16}
                      className="text-orange-500"
                      weight="duotone"
                    />
                    <span>
                      {getTerminologyPlural(
                        RoleTerms.Teacher,
                        SystemTerms.Teacher,
                      )}
                    </span>
                  </div>
                  <span className="font-semibold">{instructorsCount}</span>
                </div>
              )}
            </div>
          )}

          {/* Action Button — hidden entirely for learners already enrolled in
              this course, and in reader mode (iOS / reader-mode institutes,
              Apple 3.1.1). */}
          {selectedTab === "ALL" &&
            selectedSession &&
            selectedLevel &&
            !isEnrolledInCourse &&
            !isAlreadyEnrolled &&
            !shouldHidePaidPurchaseUI() && (
              <div className="pt-2">
                <Button
                  className={cn(
                    "w-full font-semibold",
                    // Vibrant — default Button already renders the tenant-primary CTA
                    "[.ui-vibrant_&]:shadow-md",
                    // Play Styles — solid, bold, Duolingo-style
                    "[.ui-play_&]:bg-play-success [.ui-play_&]:hover:bg-play-success-deep [.ui-play_&]:text-white [.ui-play_&]:font-extrabold [.ui-play_&]:uppercase [.ui-play_&]:tracking-wide",
                    "[.ui-play_&]:rounded-xl [.ui-play_&]:shadow-play-4d-success [.ui-play_&]:hover:shadow-play-2d-success [.ui-play_&]:active:shadow-none",
                  )}
                  onClick={onEnrollmentClick}
                >
                  {t("sidebar.enrollNow")}
                </Button>
              </div>
            )}
        </CardContent>
      </Card>

      {/* Course Progress Card */}
      {selectedTab === "PROGRESS" &&
        typeof percentageCompleted === "number" && (
          <Card
            className={cn(
              "animate-fade-in-up border-border/60 hover:shadow-md transition-all",
              // Vibrant — white card with a top-rail: success once complete
              // (status), tenant primary while in progress
              "[.ui-vibrant_&]:border-t-4",
              percentageCompleted === 100
                ? "[.ui-vibrant_&]:border-t-success-400"
                : "[.ui-vibrant_&]:border-t-primary-300",
              "[.ui-vibrant_&]:shadow-md",
              // Play Styles — quiet white rail card (one rail language)
              "[.ui-play_&]:rounded-play-card-sm [.ui-play_&]:border [.ui-play_&]:border-border [.ui-play_&]:shadow-play-soft-card",
              "[.ui-play_&]:bg-white [.ui-play_&]:text-play-ink [.ui-play_&]:shadow-none [.ui-play_&]:hover:shadow-none",
            )}
          >
            <CardHeader
              className={cn(
                "p-3 pb-2 border-b bg-muted/40",
                // Play Styles
                "[.ui-play_&]:bg-transparent [.ui-play_&]:border-play-surface",
              )}
            >
              <div className="flex items-center space-x-2">
                <div
                  className={cn(
                    "p-1 bg-green-100 dark:bg-green-900/30 rounded-md",
                    // Vibrant — semantic success chip (progress status)
                    "[.ui-vibrant_&]:bg-success-100",
                    // Play Styles — neutral chip, success icon (progress role)
                    "[.ui-play_&]:bg-play-surface [.ui-play_&]:rounded-xl",
                  )}
                >
                  <TrendUp
                    size={14}
                    className={cn(
                      "text-green-600 dark:text-green-400",
                      "[.ui-play_&]:text-play-success-deep",
                    )}
                    weight="duotone"
                  />
                </div>
                <CardTitle
                  className={cn(
                    "text-base font-bold",
                    "[.ui-play_&]:text-play-ink",
                  )}
                >
                  {t("sidebar.courseProgress", {
                    course: getTerminology(ContentTerms.Course, SystemTerms.Course),
                  })}
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-3 pt-2.5 space-y-2.5">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span
                    className={cn(
                      "font-medium text-muted-foreground",
                      "[.ui-play_&]:text-play-muted-deep [.ui-play_&]:font-bold",
                    )}
                  >
                    {t("sidebar.completion")}
                  </span>
                  <span
                    className={cn(
                      "font-bold text-green-600 dark:text-green-400",
                      // Play — completion % is the big number of this card
                      "[.ui-play_&]:text-display-sm [.ui-play_&]:tabular-nums [.ui-play_&]:text-play-ink",
                    )}
                  >
                    {Math.min(percentageCompleted, 100).toFixed(0)}%
                  </span>
                </div>
                <ProgressBar
                  value={Math.min(percentageCompleted, 100)}
                  className={cn(
                    "h-2.5",
                    // Play — success fill on neutral surface track
                    "[.ui-play_&]:h-3 [.ui-play_&]:rounded-full [.ui-play_&]:border-transparent [.ui-play_&]:bg-play-surface",
                    "[.ui-play_&]:[&>div]:bg-play-success",
                  )}
                />
              </div>
              {certificatesEnabled && (
                <div
                  className={cn(
                    "p-2 bg-amber-50 dark:bg-amber-900/10 rounded-md border border-amber-200 dark:border-amber-800",
                    // Play — quiet highlight chip
                    "[.ui-play_&]:bg-play-gold-soft [.ui-play_&]:border-transparent [.ui-play_&]:rounded-xl",
                  )}
                >
                  <p
                    className={cn(
                      "text-xs text-amber-700 dark:text-amber-400 font-medium text-center",
                      "[.ui-play_&]:text-play-ink [.ui-play_&]:font-bold",
                    )}
                  >
                    {t("sidebar.certificateOnCompletion")}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

      {/* Ratings & Reviews */}
      {packageSessionIdForCurrentLevel && (
        <div className="animate-fade-in-up" style={{ animationDelay: "0.2s" }}>
          <CourseDetailsRatingsComponent
            packageSessionId={packageSessionIdForCurrentLevel}
            onLoadingChange={onRatingsLoadingChange}
          />
        </div>
      )}
    </div>
  );
};
