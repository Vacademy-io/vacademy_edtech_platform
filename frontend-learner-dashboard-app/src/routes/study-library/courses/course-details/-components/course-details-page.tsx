import { useRouter } from "@tanstack/react-router";
import { CaretLeft } from "@phosphor-icons/react";
import { shouldHidePaidPurchaseUI } from "@/utils/ios-iap-compliance";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import {
  CourseDetailsFormValues,
  makeCourseDetailsSchema,
} from "./course-details-schema";
import { useSuspenseQuery, useQuery } from "@tanstack/react-query";
import { handleGetSlideCountDetails } from "../-services/get-slides-count";
import { CourseDetailsRatingsComponent } from "./course-details-ratings-page";
import { transformApiDataToCourseData } from "../-utils/helper";
import {
  handleGetCourseInit,
  handleGetCourseDetails,
} from "../-services/get-course-details";
import { useNavHeadingStore } from "@/stores/layout-container/useNavHeadingStore";
import { CourseStructureDetails } from "./course-structure-details";
import { DonationDialog } from "@/components/common/donation/DonationDialog";
import { EnrollmentPaymentDialog } from "./payment-dialogs/EnrollmentPaymentDialog";
import { EnrollmentPendingApprovalDialog } from "./payment-dialogs/EnrollmentPendingApprovalDialog";
import { useEnrollmentStatus } from "@/hooks/use-enrollment-status";
import { getSubjectDetails } from "@/routes/courses/course-details/-utils/helper";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import { DashboardLoader } from "@/components/core/dashboard-loader";
import { ContentOnlyCourseDetailsSkeleton } from "./course-details-skeleton";
import { CourseHeader } from "./course-header";
import { CourseSubscriptionCancel } from "./CourseSubscriptionCancel";
import { CertificateCompletionBanner } from "./certificate-completion-banner.tsx";
import { CourseEnrollment } from "./course-enrollment";
import { CourseSidebar } from "./course-sidebar";
import { CourseDetailsCollapsible } from "./course-details-collapsible";
import { mockCourses } from "../-utils/mock-courses";
import { processSlideCounts } from "../-utils/slide-counts";
import {
  derivePrimaryInstructorName,
  extractReadTimeMinutes,
  fillEnrolledSessionsFromInit,
  getCourseDepthFromInit,
  getFirstLevelSubjectsFromInit,
} from "../-utils/course-init-extract";
import type {
  PackageSessionSummary,
  SlideCountType,
} from "../-utils/course-details-types";
import { useCourseDetailsLoadingStates } from "../-hooks/use-loading-states";
import { useUserContext } from "../-hooks/use-user-context";
import { useInstituteAndBatches } from "../-hooks/use-institute-and-batches";
import { usePaymentType } from "../-hooks/use-payment-type";
import { useCourseSelection } from "../-hooks/use-course-selection";
import { useCertificateGeneration } from "../-hooks/use-certificate-generation";
import { usePaymentStatusSync } from "../-hooks/use-payment-status-sync";
import { useCourseDisplaySettings } from "../-hooks/use-course-display-settings";
import { useEnrollmentActions } from "../-hooks/use-enrollment-actions";
import { TutorEntryCard } from "@/components/tutor/TutorEntryCard";

export type {
  ChapterType,
  ModuleType,
  SubjectType,
} from "../-utils/course-details-types";

export const CourseDetailsPage = () => {
  const { t, i18n: i18nInstance } = useTranslation("courseDetailsA");
  const { t: tSlideCounts } = useTranslation("courseDetailsC");
  const { setNavHeading } = useNavHeadingStore();
  const courseDetailsSchema = useMemo(
    () => makeCourseDetailsSchema(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [i18nInstance.language],
  );

  const heading = (
    <div className="flex items-center">
      <CaretLeft
        onClick={() => window.history.back()}
        className="cursor-pointer"
      />
      <h1 className="text-lg ms-2">
        {t("detailsPage.heading", {
          course: getTerminology(ContentTerms.Course, SystemTerms.Course),
        })}
      </h1>
    </div>
  );

  useEffect(() => {
    setNavHeading(heading);
  }, [setNavHeading]);

  const router = useRouter();
  const searchParams = router.state.location.search;

  // Navigation helper function
  const navigateTo = (
    pathname: string,
    searchParamsObj: Record<string, string | undefined>,
  ) => router.navigate({ to: pathname, search: searchParamsObj });

  // Get selectedTab from route params, default to "ALL" if not provided
  const selectedTab = searchParams.selectedTab || "ALL";

  const {
    isLoading,
    updateLoadingState,
    handleModulesLoadingChange,
    handleRatingsLoadingChange,
  } = useCourseDetailsLoadingStates();

  const { instituteId, inviteCode, authToken } =
    useUserContext(updateLoadingState);

  // Enrollment state. Its service reads are memoized (30s TTL), so the two
  // instances on this route (page + course structure) share network calls.
  const {
    enrolledSessions: rawEnrolledSessions,
    addEnrolledSession,
    isLoading: isEnrollmentLoading,
  } = useEnrollmentStatus(instituteId);

  const { fetchedBatches, isBatchesFetched } = useInstituteAndBatches({
    instituteId,
    courseId: searchParams.courseId,
    updateLoadingState,
  });

  const paymentType = usePaymentType(instituteId);

  const form = useForm<CourseDetailsFormValues>({
    resolver: zodResolver(courseDetailsSchema),
    defaultValues: {
      courseData: {
        id: "",
        title: "",
        description: "",
        tags: [],
        imageUrl: "",
        courseStructure: 1,
        whatYoullLearn: "",
        whyLearn: "",
        whoShouldLearn: "",
        aboutTheCourse: "",
        packageName: "",
        status: "",
        isCoursePublishedToCatalaouge: false,
        coursePreviewImageMediaId: "",
        courseBannerMediaId: "",
        courseMediaId: "",
        courseHtmlDescription: "",
        instructors: [],
        sessions: [],
      },
      mockCourses: [],
    },
    mode: "onChange",
  });

  // Watch sessions so memos recompute when form.reset updates course data
  const watchedSessions = form.watch("courseData.sessions") || [];

  // Watch entire courseData to get stable reference for child components
  const watchedCourseData = form.watch();

  // Create a stable key based on session IDs to detect when data actually changes
  const sessionIdsKey = useMemo(
    () =>
      JSON.stringify(
        (watchedSessions || []).map(
          (s: { sessionDetails?: { id?: string } }) => s.sessionDetails?.id,
        ),
      ),
    [watchedSessions],
  );

  // Memoize the courseData to prevent new object reference on every render
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableCourseData = useMemo(() => watchedCourseData, [sessionIdsKey]);

  // Fetch single course details using the new scalable endpoint
  const { data: courseDetailsData, isLoading: isCourseDetailsLoading } =
    useSuspenseQuery(
      handleGetCourseInit({
        courseId: searchParams.courseId || "",
        instituteId: instituteId || "",
      }),
    );

  // Course depth from course-init API (so we show correct structure before form is reset)
  const courseStructureFromApi = getCourseDepthFromInit(courseDetailsData);

  // Subjects from course-init (first session, first level); used to call
  // modules-with-chapters and show content when form isn't ready
  const courseInitSubjectsFromCourseInit = useMemo(
    () => getFirstLevelSubjectsFromInit(courseDetailsData),
    [courseDetailsData],
  );

  // One enrolled-session list for everything on this page, with skeletal
  // entries (no package id) filled from course-init's package_sessions.
  const enrolledSessions = useMemo(
    () => fillEnrolledSessionsFromInit(rawEnrolledSessions, courseDetailsData),
    [rawEnrolledSessions, courseDetailsData],
  );

  // Find enrolled package_sessions for THIS course by matching student package_session_ids
  // against courseDetailsData.package_sessions (source of truth for level mapping)
  const enrolledPackageSessionsForCourse = useMemo(() => {
    const enrolledPkgSessionIds = (enrolledSessions || []).map((e) => e.id);

    const data = courseDetailsData as
      | { package_sessions?: PackageSessionSummary[] }
      | null
      | undefined;
    const packageSessions = Array.isArray(data?.package_sessions)
      ? data.package_sessions
      : [];

    // Match: only keep package_sessions the user is enrolled in
    return packageSessions.filter((ps) =>
      enrolledPkgSessionIds.includes(ps.id),
    );
  }, [enrolledSessions, courseDetailsData]);

  // Enrolled in THIS course (any batch). Drives the enrolled-first layout:
  // resume strip up top, shopper/marketing blocks demoted below content.
  const isEnrolledInCourse = useMemo(
    () =>
      (enrolledSessions || []).some(
        (enrolledSession) =>
          enrolledSession.package_dto.id === searchParams.courseId,
      ),
    [enrolledSessions, searchParams.courseId],
  );

  const {
    selectedSession,
    selectedLevel,
    selectedBatchId,
    levelOptions,
    packageSessionIdForCurrentLevel,
    sessionOptions,
    batchOptions,
    shouldShowBatchDropdown,
    handleBatchChange,
  } = useCourseSelection({
    form,
    courseId: searchParams.courseId,
    urlPackageSessionId: searchParams.packageSessionId,
    selectedTab,
    fetchedBatches,
    isBatchesFetched,
    courseDetailsData,
    enrolledSessions: enrolledSessions || [],
    enrolledPackageSessionsForCourse,
    isEnrollmentLoading,
    watchedSessions,
  });

  // Update course details loading state
  useEffect(() => {
    updateLoadingState("courseDetails", isCourseDetailsLoading);
  }, [isCourseDetailsLoading, updateLoadingState]);

  const {
    certificateUrl,
    showConfetti,
    completionPercentage,
    certificateThreshold,
    certificatesEnabled,
  } = useCertificateGeneration({
    packageSessionIdForCurrentLevel,
    courseDetailsData,
    searchParams,
  });

  useEffect(() => {
    const loadCourseData = async () => {
      if (
        (courseDetailsData as { course?: unknown } | null | undefined)?.course
      ) {
        try {
          const transformedData =
            await transformApiDataToCourseData(courseDetailsData);
          if (transformedData) {
            form.reset({
              courseData: transformedData,
              mockCourses: mockCourses,
            });
          }
        } catch {
          // Error transforming course data
        }
      }
    };

    loadCourseData();
  }, [courseDetailsData, form]);

  const [moduleStats, setModuleStats] = useState({
    totalModules: 0,
    totalChapters: 0,
    totalSubjects: 0,
  });

  // Calculate module statistics
  useEffect(() => {
    const currentSubjects = getSubjectDetails(
      form.getValues(),
      selectedSession,
      selectedLevel,
    );

    let totalModules = 0;
    let totalChapters = 0;
    const totalSubjects = currentSubjects.length;

    // Calculate modules and chapters for non-depth-5 courses
    if (form.getValues("courseData.courseStructure") !== 5) {
      currentSubjects.forEach((subject) => {
        const subj = subject as unknown as {
          modules?: Array<{ chapters?: Array<unknown> }>;
        };
        if (Array.isArray(subj.modules)) {
          totalModules += subj.modules.length;
          subj.modules.forEach((module) => {
            if (Array.isArray(module.chapters)) {
              totalChapters += module.chapters.length;
            }
          });
        }
      });
    }

    setModuleStats({
      totalModules,
      totalChapters,
      totalSubjects,
    });
  }, [selectedSession, selectedLevel, form]);

  // Function to update module statistics for depth 5 courses
  const updateModuleStats = (
    modulesData: Record<string, Array<{ chapters?: Array<unknown> }>>,
  ) => {
    if (form.getValues("courseData.courseStructure") === 5) {
      let totalModules = 0;
      let totalChapters = 0;

      Object.values(modulesData).forEach((modules) => {
        totalModules += modules.length;
        modules.forEach((module) => {
          if (module.chapters) {
            totalChapters += module.chapters.length;
          }
        });
      });

      setModuleStats((prev) => ({
        ...prev,
        totalModules,
        totalChapters,
      }));
    }
  };

  const slideCountQuery = useQuery({
    ...handleGetSlideCountDetails(packageSessionIdForCurrentLevel || ""),
    enabled: !!packageSessionIdForCurrentLevel,
  });

  // Update slide count loading state
  useEffect(() => {
    updateLoadingState("slideCount", slideCountQuery.isLoading);
  }, [slideCountQuery.isLoading, updateLoadingState]);

  // Fetch single course details to derive author/read time if needed
  const singleCourseQuery = useQuery({
    ...handleGetCourseDetails({
      packageId: (searchParams.courseId as string) || "",
    }),
    enabled: !!searchParams.courseId,
  });

  // read_time_in_minutes from package detail API (correct source of truth)
  const backendReadTimeMinutes = useMemo(
    () => extractReadTimeMinutes(singleCourseQuery.data),
    [singleCourseQuery.data],
  );

  // Custom slide count calculation to handle special document types
  const processedSlideCounts = useMemo(
    () =>
      processSlideCounts(
        slideCountQuery.data as SlideCountType[] | null,
        tSlideCounts,
      ),
    [slideCountQuery.data, tSlideCounts],
  );

  usePaymentStatusSync({
    packageSessionIdForCurrentLevel,
    authToken,
    courseId: searchParams.courseId,
    selectedSession,
    selectedLevel,
    sessionOptions,
    levelOptions,
    enrolledSessions: enrolledSessions || [],
    addEnrolledSession,
    form,
  });

  const {
    showCourseConfiguration,
    hideTags,
    overviewVisible,
    hideAuthorName,
    showInstructors,
    enrolledLayout,
    chapterOpensFirstSlide: chapterOpensFirstSlideSetting,
    contentCardImageFit,
  } = useCourseDisplaySettings();

  const {
    enrollmentDialogOpen,
    setEnrollmentDialogOpen,
    donationDialogOpen,
    setDonationDialogOpen,
    pendingApprovalDialogOpen,
    setPendingApprovalDialogOpen,
    handleEnrollmentSuccess,
    handleNavigationToSlides,
    handleDonationEnrollmentSuccess,
    onEnrollmentClick,
  } = useEnrollmentActions({
    form,
    courseId: searchParams.courseId,
    navigateTo,
    selectedSession,
    selectedLevel,
    sessionOptions,
    levelOptions,
    packageSessionIdForCurrentLevel,
    addEnrolledSession,
    authToken,
    paymentType,
  });

  // "contentOnly" strips this page down to the Content Structure card: no
  // right-hand overview card, no description/tags/media, no highlights or
  // enrollment configuration.
  //
  // This does NOT need a second `isEnrolledInCourse` check. THIS route is the
  // post-enrollment surface — the shopper-facing page is /courses/course-details
  // plus the catalogue, which are different components this setting never
  // touches. Gating on enrollment here only added a way for the setting to look
  // broken: enrolledSessions is merged from a Capacitor Preferences snapshot
  // and a learner-packages search, and legitimately comes back empty (or with a
  // package_dto.id that doesn't match) often enough that admins would flip the
  // toggle and see no change. Knowing the layout without waiting on that fetch
  // also lets the loading skeleton below match the layout it's loading into.
  const contentOnly = enrolledLayout === "contentOnly";

  // Opening a chapter straight into the viewer is its own preference, not a
  // fact about the layout — a full-page institute may still want the shortcut,
  // and a content-only one may still want the slide list. Unset follows the
  // layout so today's behaviour is unchanged either way.
  const chapterOpensFirstSlide = chapterOpensFirstSlideSetting ?? contentOnly;

  const hasRightSidebar = !contentOnly;

  const primaryInstructorName = derivePrimaryInstructorName({
    formInstructors: form.getValues("courseData").instructors as unknown as
      | Array<{ name?: string; full_name?: string }>
      | undefined,
    packageDetailData: singleCourseQuery.data,
    courseInitData: courseDetailsData,
  });

  // Show loading until essential data is ready; defer packageSessionId-dependent UI below
  if (isLoading || !instituteId || !courseDetailsData) {
    // Match the skeleton to the layout it resolves into — a full-page branded
    // spinner ahead of a title-plus-one-card page reads as a much heavier load
    // than it is, and makes the content visibly jump when it lands.
    return contentOnly ? (
      <ContentOnlyCourseDetailsSkeleton />
    ) : (
      <DashboardLoader />
    );
  }

  return (
    <>
      {/* Donation Dialog for Enrollment */}
      <DonationDialog
        open={donationDialogOpen}
        onOpenChange={setDonationDialogOpen}
        packageSessionId={packageSessionIdForCurrentLevel || ""}
        instituteId={instituteId || ""}
        token={authToken}
        courseTitle={form.getValues("courseData").title}
        inviteCode={inviteCode}
        mode="enrollment"
        isUserEnrolled={false} // User is not enrolled yet in enrollment mode
        onEnrollmentSuccess={handleDonationEnrollmentSuccess}
      />

      {/* Enrollment Payment Dialog for Non-Donation Payment Types */}
      <EnrollmentPaymentDialog
        open={enrollmentDialogOpen}
        onOpenChange={setEnrollmentDialogOpen}
        packageSessionId={packageSessionIdForCurrentLevel || ""}
        instituteId={instituteId || ""}
        token={authToken}
        courseTitle={form.getValues("courseData").title}
        inviteCode={inviteCode}
        onEnrollmentSuccess={handleEnrollmentSuccess}
        onNavigateToSlides={handleNavigationToSlides}
      />

      {/* Pending Approval Dialog for Free Enrollments */}
      <EnrollmentPendingApprovalDialog
        open={pendingApprovalDialogOpen}
        onOpenChange={setPendingApprovalDialogOpen}
        courseTitle={form.getValues("courseData").title}
      />

      <div className="min-h-screen bg-background relative w-full max-w-full">
        {/* Course Header */}
        <CourseHeader
          courseData={form.getValues("courseData")}
          showConfetti={showConfetti}
          minimal={contentOnly}
          hideTags={hideTags}
        />

        {/* Main Content Container */}
        <div className="relative z-10 w-full px-2 sm:px-0 py-2 lg:py-3">
          <div
            className={`grid grid-cols-1 ${
              hasRightSidebar ? "lg:grid-cols-3" : ""
            } gap-3`}
          >
            {/* Left Column - Course Content (3/4) */}
            <div
              className={`${hasRightSidebar ? "lg:col-span-2" : ""} space-y-3`}
            >
              {/* Certificate Completion Banner - Show above course structure if threshold is met */}
              <CertificateCompletionBanner
                certificateUrl={certificateUrl}
                courseTitle={form.getValues("courseData").title}
                sessionLabel={
                  sessionOptions?.find((o) => o.value === selectedSession)
                    ?.label
                }
                levelLabel={
                  levelOptions?.find((o) => o.value === selectedLevel)?.label
                }
                percentageCompleted={completionPercentage}
                threshold={certificateThreshold}
              />

              {/* Enrolled learners see content first (header → resume strip →
                  tabs); shopper/marketing blocks (highlights, configuration)
                  are demoted below the content. Non-enrolled shoppers keep the
                  original marketing-first order. */}
              {(() => {
                // Course highlights (collapsed by default) — admin-authored
                // overview copy; leads for shoppers, demoted for enrolled.
                const highlightsBlock = (
                  <CourseDetailsCollapsible
                    courseData={form.getValues("courseData")}
                    showInstructors={showInstructors}
                  />
                );

                // Course Enrollment Configuration. In the content-only
                // layout the same card renders as the Class/Section picker
                // alone, and hides itself when there is only one batch.
                const enrollmentBlock = (
                  <CourseEnrollment
                    showCourseConfiguration={showCourseConfiguration}
                    batchPickerOnly={contentOnly}
                    selectedTab={selectedTab}
                    sessionOptions={sessionOptions || []}
                    levelOptions={levelOptions || []}
                    batchOptions={batchOptions}
                    selectedSession={selectedSession}
                    selectedLevel={selectedLevel}
                    selectedBatchId={selectedBatchId}
                    shouldShowBatchDropdown={shouldShowBatchDropdown}
                    enrolledSessions={enrolledSessions || []}
                    courseId={searchParams.courseId || ""}
                    hasRightSidebar={hasRightSidebar}
                    paymentType={paymentType}
                    certificateUrl={certificateUrl}
                    packageSessionIdForCurrentLevel={
                      packageSessionIdForCurrentLevel
                    }
                    onBatchChange={handleBatchChange}
                    onEnrollmentClick={onEnrollmentClick}
                  />
                );

                // Course Structure (always rendered; internal logic will adapt to enrollment/public)
                const structureBlock = (
                  <div
                    className="animate-fade-in-up"
                    style={{ animationDelay: "0.2s" }}
                  >
                    {/* Live AI Tutor entry (renders nothing unless the course is prepared) */}
                    <TutorEntryCard
                      courseId={searchParams.courseId || ""}
                      packageSessionId={packageSessionIdForCurrentLevel || ""}
                      selectedTab={searchParams.selectedTab}
                    />
                    <CourseStructureDetails
                      selectedSession={selectedSession}
                      selectedLevel={selectedLevel}
                      courseStructure={
                        courseStructureFromApi ??
                        stableCourseData?.courseData?.courseStructure ??
                        5
                      }
                      courseData={stableCourseData}
                      packageSessionId={packageSessionIdForCurrentLevel || ""}
                      selectedTab={selectedTab}
                      updateModuleStats={updateModuleStats}
                      isEnrolledInCourse={isEnrolledInCourse}
                      contentOnly={contentOnly}
                      chapterOpensFirstSlide={chapterOpensFirstSlide}
                      contentCardImageFit={contentCardImageFit}
                      onLoadingChange={handleModulesLoadingChange}
                      courseInitSubjects={courseInitSubjectsFromCourseInit}
                      {...(paymentType && { paymentType })}
                    />
                  </div>
                );

                // Content-only: the structure card is the whole page. The
                // autopay-cancel block stays — it self-hides unless this course
                // has a live mandate, and burying a cancel control behind a
                // display preference is not a layout decision to make for the
                // learner.
                if (contentOnly) {
                  return (
                    <>
                      {enrollmentBlock}
                      {structureBlock}
                      {!shouldHidePaidPurchaseUI() && (
                        <CourseSubscriptionCancel
                          instituteId={instituteId || ""}
                          packageSessionId={
                            packageSessionIdForCurrentLevel || undefined
                          }
                        />
                      )}
                    </>
                  );
                }

                return isEnrolledInCourse ? (
                  <>
                    {structureBlock}
                    {enrollmentBlock}
                    {/* Cancel autopay — self-hides unless this course has an active
                        mandate. Hidden on native iOS (reader mode): it surfaces a
                        subscription bought on the web; managed there (Apple 3.1.1). */}
                    {!shouldHidePaidPurchaseUI() && (
                      <CourseSubscriptionCancel
                        instituteId={instituteId || ""}
                        packageSessionId={
                          packageSessionIdForCurrentLevel || undefined
                        }
                      />
                    )}
                    {highlightsBlock}
                  </>
                ) : (
                  <>
                    {highlightsBlock}
                    {enrollmentBlock}
                    {structureBlock}
                  </>
                );
              })()}
            </div>

            {/* Right Column - Course Stats Sidebar (1/4). Dropped entirely in
                the content-only layout — that card is what "hide the author and
                the right-side details" refers to. */}
            {hasRightSidebar && (
              <div className="lg:col-span-1">
                <div className="sticky top-24 self-start">
                  <CourseSidebar
                    hasRightSidebar={hasRightSidebar}
                    levelOptions={levelOptions}
                    selectedLevel={selectedLevel}
                    slideCountQuery={slideCountQuery}
                    overviewVisible={overviewVisible}
                    hideAuthorName={hideAuthorName}
                    processedSlideCounts={processedSlideCounts}
                    moduleStats={moduleStats}
                    currentSubjects={getSubjectDetails(
                      form.getValues(),
                      selectedSession,
                      selectedLevel,
                    )}
                    // Same resolution as the structure block below: the form's
                    // courseStructure is still its placeholder until the reset
                    // lands, and the sidebar now hides level counts by depth.
                    courseStructure={
                      courseStructureFromApi ??
                      stableCourseData?.courseData?.courseStructure ??
                      5
                    }
                    instructorsCount={
                      form.getValues("courseData").instructors.length
                    }
                    primaryInstructorName={primaryInstructorName}
                    backendReadTimeMinutes={backendReadTimeMinutes || undefined}
                    selectedTab={selectedTab}
                    selectedSession={selectedSession}
                    enrolledSessions={enrolledSessions || []}
                    courseId={searchParams.courseId || ""}
                    paymentType={paymentType}
                    packageSessionIdForCurrentLevel={
                      packageSessionIdForCurrentLevel
                    }
                    percentageCompleted={completionPercentage}
                    certificatesEnabled={certificatesEnabled}
                    onEnrollmentClick={onEnrollmentClick}
                    onRatingsLoadingChange={handleRatingsLoadingChange}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Ratings Component — the single-column fallback for layouts with no
              right-hand card. The content-only layout also has no right card
              but deliberately wants nothing but the structure, so it opts out. */}
          {!hasRightSidebar && !contentOnly && packageSessionIdForCurrentLevel && (
            <div
              className="mt-6 lg:mt-8 animate-fade-in-up"
              style={{ animationDelay: "0.8s" }}
            >
              <CourseDetailsRatingsComponent
                packageSessionId={packageSessionIdForCurrentLevel}
                onLoadingChange={handleRatingsLoadingChange}
              />
            </div>
          )}
        </div>
      </div>
    </>
  );
};
