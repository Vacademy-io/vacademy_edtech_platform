import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import type { UseFormReturn } from "react-hook-form";
import type { EnrolledSession } from "@/hooks/use-enrollment-status";
import type { CourseDetailsFormValues } from "../-components/course-details-schema";
import type { SelectOption } from "../-utils/course-details-types";

// One-shot background check on page load: if the backend says the user has
// already PAID and is ACTIVE for this package session (e.g. returning from a
// payment flow), sync the local enrolled-sessions state so the page renders
// the enrolled layout without a manual refresh.
export function usePaymentStatusSync({
  packageSessionIdForCurrentLevel,
  authToken,
  courseId,
  selectedSession,
  selectedLevel,
  sessionOptions,
  levelOptions,
  enrolledSessions,
  addEnrolledSession,
  form,
}: {
  packageSessionIdForCurrentLevel: string | null;
  authToken: string;
  courseId: string | undefined;
  selectedSession: string;
  selectedLevel: string;
  sessionOptions: SelectOption[];
  levelOptions: SelectOption[];
  enrolledSessions: EnrolledSession[];
  addEnrolledSession: (session: EnrolledSession) => Promise<void>;
  form: UseFormReturn<CourseDetailsFormValues>;
}) {
  const { t } = useTranslation("courseDetailsB");
  const [paymentStatusChecked, setPaymentStatusChecked] =
    useState<boolean>(false);
  const [isCheckingPaymentStatus, setIsCheckingPaymentStatus] =
    useState<boolean>(false);

  const checkPaymentStatusOnLoad = useCallback(async () => {
    if (
      !packageSessionIdForCurrentLevel ||
      !authToken ||
      paymentStatusChecked ||
      isCheckingPaymentStatus
    ) {
      return;
    }

    setIsCheckingPaymentStatus(true);

    try {
      const { fetchUserPlanStatus } =
        await import("@/services/payment-status-api");

      const response = await fetchUserPlanStatus(
        packageSessionIdForCurrentLevel,
        authToken,
      );

      const parseUserPlanStatus = (
        status: string,
      ): "PAID" | "FAILED" | "PAYMENT_PENDING" | "UNKNOWN" => {
        const normalizedStatus = status?.toUpperCase()?.trim();
        switch (normalizedStatus) {
          case "FAILED":
            return "FAILED";
          case "PAID":
          case "ACTIVE":
            return "PAID";
          case "PAYMENT_PENDING":
          case "PENDING_FOR_PAYMENT":
            return "PAYMENT_PENDING";
          default:
            console.warn(
              "CourseDetailsPage - Unknown user plan status on load:",
              {
                originalStatus: status,
                normalizedStatus,
                packageSessionId: packageSessionIdForCurrentLevel,
              },
            );
            return "UNKNOWN";
        }
      };

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
            console.warn(
              "CourseDetailsPage - Unknown learner status on load:",
              {
                originalStatus: status,
                normalizedStatus,
                packageSessionId: packageSessionIdForCurrentLevel,
              },
            );
            return "UNKNOWN";
        }
      };

      const userPlanStatus = parseUserPlanStatus(response.user_plan_status);
      const learnerStatus = parseLearnerStatus(response.learner_status);

      // If payment is successful and learner is active, enroll user immediately
      if (userPlanStatus === "PAID" && learnerStatus === "ACTIVE") {
        // Check if user is already enrolled to avoid duplicates
        const isAlreadyEnrolled = (enrolledSessions || []).some(
          (enrolledSession) =>
            enrolledSession.package_dto.id === courseId &&
            enrolledSession.session.id === selectedSession &&
            enrolledSession.level.id === selectedLevel,
        );

        if (!isAlreadyEnrolled) {
          const newEnrolledSession: EnrolledSession = {
            id: packageSessionIdForCurrentLevel,
            session: {
              id: selectedSession,
              session_name:
                sessionOptions.find((s) => s.value === selectedSession)
                  ?.label || "",
              status: "ACTIVE",
              start_date: new Date().toISOString(),
            },
            level: {
              id: selectedLevel,
              level_name:
                levelOptions.find((l) => l.value === selectedLevel)?.label ||
                "",
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

          try {
            await addEnrolledSession(newEnrolledSession);
            // No toast needed for background enrollment check
          } catch (error) {
            console.error(
              "CourseDetailsPage - Error enrolling user on page load:",
              error,
            );
            toast.error(t("enrollmentActions.toast.updateFailed"));
          }
        }
      }
    } catch (error) {
      console.error(
        "CourseDetailsPage - Error checking payment status on load:",
        error,
      );
      // Don't show error toast for this background check
    } finally {
      setIsCheckingPaymentStatus(false);
      setPaymentStatusChecked(true);
    }
  }, [
    packageSessionIdForCurrentLevel,
    authToken,
    paymentStatusChecked,
    isCheckingPaymentStatus,
    enrolledSessions,
    courseId,
    selectedSession,
    selectedLevel,
    sessionOptions,
    levelOptions,
    form,
    addEnrolledSession,
  ]);

  // Check payment status when page loads and essential data is available
  useEffect(() => {
    if (
      packageSessionIdForCurrentLevel &&
      authToken &&
      selectedSession &&
      selectedLevel &&
      !paymentStatusChecked &&
      !isCheckingPaymentStatus
    ) {
      checkPaymentStatusOnLoad();
    }
  }, [
    packageSessionIdForCurrentLevel,
    authToken,
    selectedSession,
    selectedLevel,
    paymentStatusChecked,
    isCheckingPaymentStatus,
    checkPaymentStatusOnLoad,
  ]);
}
