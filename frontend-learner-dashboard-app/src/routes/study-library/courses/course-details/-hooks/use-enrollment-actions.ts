import { useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import type { UseFormReturn } from "react-hook-form";
import { getSubjectDetails } from "@/routes/courses/course-details/-utils/helper";
import type { EnrolledSession } from "@/hooks/use-enrollment-status";
import type { CourseDetailsFormValues } from "../-components/course-details-schema";
import type { SelectOption } from "../-utils/course-details-types";

// Enrollment flows for the course-details page: free/paid/donation dialogs,
// post-enrollment state sync and the "jump into the first slide" navigation.
export function useEnrollmentActions({
  form,
  courseId,
  navigateTo,
  selectedSession,
  selectedLevel,
  sessionOptions,
  levelOptions,
  packageSessionIdForCurrentLevel,
  addEnrolledSession,
  authToken,
  paymentType,
}: {
  form: UseFormReturn<CourseDetailsFormValues>;
  courseId: string | undefined;
  navigateTo: (
    pathname: string,
    searchParamsObj: Record<string, string | undefined>,
  ) => void;
  selectedSession: string;
  selectedLevel: string;
  sessionOptions: SelectOption[];
  levelOptions: SelectOption[];
  packageSessionIdForCurrentLevel: string | null;
  addEnrolledSession: (session: EnrolledSession) => Promise<void>;
  authToken: string;
  paymentType: string | null;
}) {
  const { t } = useTranslation("courseDetailsB");
  const [enrollmentDialogOpen, setEnrollmentDialogOpen] = useState(false);
  const [donationDialogOpen, setDonationDialogOpen] = useState(false);
  const [pendingApprovalDialogOpen, setPendingApprovalDialogOpen] =
    useState(false);

  const handleEnrollmentSuccess = async () => {
    // Update enrolled sessions immediately using the hook
    const newEnrolledSession: EnrolledSession = {
      id: packageSessionIdForCurrentLevel || "",
      session: {
        id: selectedSession,
        session_name:
          sessionOptions.find((s) => s.value === selectedSession)?.label || "",
        status: "ACTIVE",
        start_date: new Date().toISOString(),
      },
      level: {
        id: selectedLevel,
        level_name:
          levelOptions.find((l) => l.value === selectedLevel)?.label || "",
        duration_in_days: null,
        thumbnail_id: null,
      },
      start_time: new Date().toISOString(),
      status: "ACTIVE",
      package_dto: {
        id: courseId || "",
        package_name: form.getValues("courseData").title,
        thumbnail_id: null,
      },
    };

    // Add the enrolled session and wait for it to complete
    try {
      await addEnrolledSession(newEnrolledSession);
    } catch {
      toast.error(t("enrollmentActions.toast.updateFailed"));
      return;
    }

    // Close dialogs
    setEnrollmentDialogOpen(false);
    setDonationDialogOpen(false);
  };

  const handleNavigationToSlides = async () => {
    // Add a small delay to ensure enrollment is fully processed
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Try to get course structure data from multiple sources
    let subjectId = "";
    let moduleId = "";
    let chapterId = "";
    let slideId = "";

    // Method 1: Try to get from form data
    const currentSubjects = getSubjectDetails(
      form.getValues(),
      selectedSession,
      selectedLevel,
    );

    if (currentSubjects.length > 0) {
      subjectId = currentSubjects[0]?.id || "";

      // Method 2: Fetch complete course structure using the same API
      if (packageSessionIdForCurrentLevel && subjectId) {
        try {
          // Import the API function dynamically to avoid circular dependencies
          const { fetchModulesWithChapters } =
            await import("@/services/study-library/getModulesWithChapters");

          const modulesData = await fetchModulesWithChapters(
            subjectId,
            packageSessionIdForCurrentLevel,
          );

          if (modulesData && modulesData.length > 0) {
            const firstModule = modulesData[0];
            moduleId = firstModule.module.id || "";

            if (firstModule.chapters && firstModule.chapters.length > 0) {
              const firstChapter = firstModule.chapters[0];
              chapterId = firstChapter.id || "";

              // For slides, we need to fetch them separately
              if (chapterId) {
                try {
                  const { fetchSlidesByChapterId } =
                    await import("@/hooks/study-library/use-slides");
                  const slides = await fetchSlidesByChapterId(chapterId);

                  if (slides && slides.length > 0) {
                    slideId = slides[0].id || "";
                  }
                } catch {
                  // Silent fallback
                }
              }
            }
          }
        } catch {
          // Silent fallback
        }
      }
    }

    // Navigate to slides with whatever IDs we found
    // sessionId is used by slides route as packageSessionId (batch id) for content/progress
    navigateTo(
      `/study-library/courses/course-details/subjects/modules/chapters/slides`,
      {
        courseId,
        subjectId: subjectId || "",
        moduleId: moduleId || "",
        chapterId: chapterId || "",
        slideId: slideId || "",
        sessionId: packageSessionIdForCurrentLevel || "",
      },
    );
  };

  // Combined handler for donation flow - does both enrollment AND navigation
  const handleDonationEnrollmentSuccess = async () => {
    await handleEnrollmentSuccess();
    // Donation flow should auto-navigate
    await handleNavigationToSlides();
  };

  // Handler for free enrollment click - checks user status first
  const handleFreeEnrollmentClick = async () => {
    if (!packageSessionIdForCurrentLevel || !authToken) {
      console.error("handleFreeEnrollmentClick - Missing required data", {
        packageSessionId: packageSessionIdForCurrentLevel,
        hasToken: !!authToken,
      });
      return;
    }

    try {
      const { fetchUserPlanStatus } =
        await import("@/services/payment-status-api");

      const response = await fetchUserPlanStatus(
        packageSessionIdForCurrentLevel,
        authToken,
      );

      const parseLearnerStatus = (
        status: string,
      ): "INVITED" | "PENDING_FOR_APPROVAL" | "ACTIVE" | "UNKNOWN" => {
        const normalizedStatus = status?.toUpperCase()?.trim();
        switch (normalizedStatus) {
          case "INVITED":
            return "INVITED";
          case "PENDING_FOR_APPROVAL":
          case "PENDING_APPROVAL":
            return "PENDING_FOR_APPROVAL";
          case "ACTIVE":
            return "ACTIVE";
          default:
            return "UNKNOWN";
        }
      };

      const learnerStatus = parseLearnerStatus(response.learner_status);

      // If user already has a pending approval, show pending approval dialog
      if (learnerStatus === "PENDING_FOR_APPROVAL") {
        setPendingApprovalDialogOpen(true);
        return;
      }

      // If user is already active, they're already enrolled
      if (learnerStatus === "ACTIVE") {
        // Navigate to slides since user is already enrolled
        await handleNavigationToSlides();
        return;
      }

      // If user is invited or unknown status, proceed with enrollment
      setEnrollmentDialogOpen(true);
    } catch (error) {
      console.error(
        "handleFreeEnrollmentClick - Error checking user status",
        error,
      );

      // If it's a 510 error (no enrollment request), proceed with enrollment
      if (error instanceof Error && error.message.includes("510")) {
        setEnrollmentDialogOpen(true);
      } else {
        // For other errors, proceed with enrollment (fallback behavior)
        console.warn(
          "handleFreeEnrollmentClick - Error checking status, proceeding with enrollment as fallback",
        );
        setEnrollmentDialogOpen(true);
      }
    }
  };

  // Shared CTA handler: free payment types verify user status first; paid
  // types open the enrollment dialog directly.
  const onEnrollmentClick = async () => {
    const isFreePayment =
      paymentType === "free" ||
      paymentType === "free_plan" ||
      paymentType === "FREE" ||
      paymentType === "FREE_PLAN";

    if (isFreePayment) {
      await handleFreeEnrollmentClick();
    } else {
      setEnrollmentDialogOpen(true);
    }
  };

  return {
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
  };
}
