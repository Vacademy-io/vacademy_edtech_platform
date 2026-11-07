import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { LayoutContainer } from "@/components/common/layout-container/layout-container";
import { DashboardLoader } from "@/components/core/dashboard-loader";
import AIReportDetailsPage from "@/components/common/my-reports/ai-report-details-page";
import { MyButton } from "@/components/design-system/button";
import { CaretLeft } from "@phosphor-icons/react";
import { fetchActivityInsight, insightTypeLabel } from "@/services/activity-insights";

/**
 * One per-activity AI insight report, opened from My Reports → Activity Insights.
 *
 * Renders through the same component the assessment AI report uses, so a learner
 * sees one consistent report regardless of what they were working on. Ownership is
 * enforced server-side (the endpoint reads the user from the token), so a guessed
 * id in the URL returns "not found" rather than someone else's report.
 *
 * Gated by nothing beyond My Reports itself — the canViewReports permission that
 * lets a learner reach the list is the same one that lets them open a row in it.
 */
export const Route = createFileRoute("/my-reports/activity/$logId/")({
  component: RouteComponent,
});

const formatDate = (iso?: string | null) => {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "";
  }
};

function RouteComponent() {
  const { t } = useTranslation("miscRoutesA");
  const navigate = useNavigate();
  const { logId } = Route.useParams();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["activityInsight", logId],
    queryFn: () => fetchActivityInsight(logId),
    enabled: Boolean(logId),
    retry: false,
  });

  const report = (() => {
    if (!data?.processed_json) return null;
    try {
      return JSON.parse(data.processed_json);
    } catch {
      return null;
    }
  })();

  const back = () => navigate({ to: "/my-reports" });

  const Frame = ({ children }: { children: React.ReactNode }) => (
    <LayoutContainer className="!m-0 !p-0 max-w-none">
      <div className="min-h-screen bg-gray-50/50 pb-24 md:pb-8">
        <div className="bg-white border-b border-gray-200 px-4 py-3">
          <MyButton
            type="button"
            scale="medium"
            buttonType="secondary"
            layoutVariant="default"
            onClick={back}
          >
            <CaretLeft size={16} />
            {t("myReports.detail.backToMyReports")}
          </MyButton>
        </div>
        {children}
      </div>
    </LayoutContainer>
  );

  if (isLoading) {
    return (
      <Frame>
        <div className="flex min-h-reg-400 items-center justify-center">
          <DashboardLoader />
        </div>
      </Frame>
    );
  }

  // The id isn't theirs, or the report isn't ready — one message either way,
  // because neither is the learner's problem to fix.
  if (isError || !report) {
    return (
      <Frame>
        <div className="flex min-h-reg-400 items-center justify-center px-6">
          <div className="text-center space-y-2">
            <h2 className="text-xl font-semibold text-neutral-700">
              {t("myReports.activity.insightsUnavailable")}
            </h2>
            <p className="text-neutral-500">
              {t("myReports.activity.insightsUnavailableDescription")}
            </p>
          </div>
        </div>
      </Frame>
    );
  }

  const typeLabel = insightTypeLabel(data?.source_type ?? "");
  const date = formatDate(data?.created_at);

  return (
    <Frame>
      <AIReportDetailsPage
        report={report}
        assessmentName={data?.title || t("myReports.activity.typeInsights", { type: typeLabel })}
        subtitle={date ? `${typeLabel} · ${date}` : typeLabel}
      />
    </Frame>
  );
}
