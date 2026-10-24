import { createFileRoute, useRouter } from "@tanstack/react-router";
import { z } from "zod";
import { useEffect, useState } from "react";
import { Preferences } from "@capacitor/preferences";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { LEARNER_REPORT_COMPARISON_URL } from "@/constants/urls";
import { LayoutContainer } from "@/components/common/layout-container/layout-container";
import { DashboardLoader } from "@/components/core/dashboard-loader";
import { useNavHeadingStore } from "@/stores/layout-container/useNavHeadingStore";
import { ComparisonDashboard } from "@/components/common/student-test-records/comparison-dashboard";
import { useTranslation } from "react-i18next";

const comparisonParamsSchema = z.object({
  assessmentId: z.string(),
  attemptId: z.string(),
});

export const Route = createFileRoute("/assessment/reports/comparison/")({
  validateSearch: comparisonParamsSchema,
  component: ComparisonRouteComponent,
});

function ComparisonRouteComponent() {
  const { t } = useTranslation("assessment");
  const { assessmentId, attemptId } = Route.useSearch();
  const router = useRouter();
  const state = router.state.location.state as
    | { assessmentName?: string; evaluationType?: string }
    | undefined;
  const assessmentName = state?.assessmentName || t("comparison.defaultAssessmentName");
  const evaluationType = state?.evaluationType;

  const [comparisonData, setComparisonData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [instituteId, setInstituteId] = useState<string | undefined>(undefined);
  const { setNavHeading } = useNavHeadingStore();

  useEffect(() => {
    setNavHeading(t("comparison.navHeading"));
  }, [setNavHeading]);

  useEffect(() => {
    async function fetchInstituteId() {
      const { value } = await Preferences.get({ key: "InstituteDetails" });
      const parsed = JSON.parse(value || "{}");
      setInstituteId(parsed?.id);
    }
    fetchInstituteId();
  }, []);

  useEffect(() => {
    async function fetchComparison() {
      if (!instituteId) return;
      try {
        setError(null);
        const response = await authenticatedAxiosInstance({
          method: "GET",
          url: LEARNER_REPORT_COMPARISON_URL,
          params: { assessmentId, attemptId, instituteId },
        });
        setComparisonData(response.data);
      } catch (err) {
        console.error("Error fetching comparison data:", err);
        setError(t("comparison.error"));
      } finally {
        setLoading(false);
      }
    }
    fetchComparison();
  }, [instituteId, assessmentId, attemptId]);

  if (loading || !instituteId) {
    return (
      <div className="flex justify-center items-center h-screen w-screen">
        <DashboardLoader />
      </div>
    );
  }

  if (error) {
    return (
      <LayoutContainer>
        <div className="text-center py-8 text-destructive">{error}</div>
      </LayoutContainer>
    );
  }

  return (
    <LayoutContainer>
      <ComparisonDashboard
        data={comparisonData}
        assessmentName={assessmentName}
        assessmentId={assessmentId}
        attemptId={attemptId}
        instituteId={instituteId}
        evaluationType={evaluationType}
      />
    </LayoutContainer>
  );
}
