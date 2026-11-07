import { useNavigate } from "@tanstack/react-router";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStudentPermissions } from "@/hooks/use-student-permissions";
import { DashboardLoader } from "@/components/core/dashboard-loader";
import ReportDetailsPage from "@/components/common/my-reports/report-details-page";
import { StudentReportCard } from "@/components/common/my-reports/StudentReportCard";
import { LayoutContainer } from "@/components/common/layout-container/layout-container";
import { useReportStore } from "@/stores/report-store";
import {
  fetchMyReport,
  downloadReportPdf,
  type MyReportDetailResponse,
  type StudentReport,
} from "@/services/student-reports-api";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowCounterClockwise, DownloadSimple } from "@phosphor-icons/react";
import { getCachedInstituteBranding } from "@/services/domain-routing";

export const Route = createFileRoute("/my-reports/$processId/")({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation("miscRoutesA");
  const navigate = useNavigate();
  const params = Route.useParams();
  const processId = params.processId || "";

  const { permissions, isLoading: permissionsLoading } = useStudentPermissions();
  const { selectedReport } = useReportStore();

  const [detail, setDetail] = useState<MyReportDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Always fetch fresh so deep-links (e.g. from push notifications) work without
  // the store being populated.
  useEffect(() => {
    if (!processId) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchMyReport(processId);
        if (!cancelled) setDetail(data);
      } catch {
        if (!cancelled) setError(t("myReports.detail.loadError"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [processId]);

  // ── Permissions ───────────────────────────────────────────────────────────

  if (permissionsLoading) {
    return <DashboardLoader />;
  }

  if (!permissions.canViewReports) {
    return null; // useStudentPermissions will redirect
  }

  // ── Loading ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <LayoutContainer>
        <div className="flex items-center justify-center min-h-96">
          <DashboardLoader />
        </div>
      </LayoutContainer>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────

  if (error || !detail) {
    return (
      <LayoutContainer>
        <div className="flex items-center justify-center min-h-96 p-4">
          <Card className="max-w-md w-full">
            <CardContent className="pt-6 text-center space-y-3">
              <ArrowCounterClockwise size={32} className="text-muted-foreground mx-auto" />
              <p className="text-base font-semibold text-neutral-800">
                {t("myReports.detail.couldNotLoad")}
              </p>
              <p className="text-sm text-muted-foreground">
                {error ?? t("myReports.detail.reportNotFound")}
              </p>
              <button
                onClick={() => navigate({ to: "/my-reports" })}
                className="mt-2 px-4 py-2 text-sm font-medium bg-primary-500 text-white rounded-lg hover:bg-primary-400 transition-colors"
              >
                {t("myReports.detail.backToReports")}
              </button>
            </CardContent>
          </Card>
        </div>
      </LayoutContainer>
    );
  }

  // ── Still generating ──────────────────────────────────────────────────────

  if (detail.status !== "COMPLETED") {
    return (
      <LayoutContainer>
        <div className="flex items-center justify-center min-h-96 p-4">
          <Card className="max-w-md w-full">
            <CardContent className="pt-6 text-center space-y-3">
              <p className="text-base font-semibold text-neutral-800">
                {t("myReports.detail.inProgress")}
              </p>
              <p className="text-sm text-muted-foreground">
                {detail.status === "FAILED"
                  ? (detail.error_message ?? t("myReports.detail.generationFailed"))
                  : t("myReports.detail.stillGenerating")}
              </p>
              <button
                onClick={() => navigate({ to: "/my-reports" })}
                className="mt-2 px-4 py-2 text-sm font-medium bg-primary-500 text-white rounded-lg hover:bg-primary-400 transition-colors"
              >
                {t("myReports.detail.backToReports")}
              </button>
            </CardContent>
          </Card>
        </div>
      </LayoutContainer>
    );
  }

  // ── V2 comprehensive report ───────────────────────────────────────────────

  if (detail.report_version === "v2" && detail.comprehensive_report) {
    return (
      <LayoutContainer className="!m-0 !p-0 max-w-none">
        <div className="relative">
          <div className="absolute end-4 top-4 z-10">
            <button
              onClick={() => downloadReportPdf(detail.process_id)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 shadow-sm transition-colors hover:bg-neutral-50"
            >
              <DownloadSimple size={16} /> {t("myReports.detail.downloadPdf")}
            </button>
          </div>
          <StudentReportCard
            data={detail.comprehensive_report}
            fallbackLogoUrl={getCachedInstituteBranding()?.instituteLogoUrl ?? undefined}
          />
        </div>
      </LayoutContainer>
    );
  }

  // ── V1 LLM-text report ────────────────────────────────────────────────────

  const reportContent = detail.report;

  if (!reportContent) {
    return (
      <LayoutContainer>
        <div className="flex items-center justify-center min-h-96 p-4">
          <Card className="max-w-md w-full">
            <CardContent className="pt-6 text-center space-y-3">
              <p className="text-base font-semibold text-neutral-800">
                {t("myReports.detail.contentUnavailable")}
              </p>
              <p className="text-sm text-muted-foreground">
                {t("myReports.detail.contentUnavailableDescription")}
              </p>
              <button
                onClick={() => navigate({ to: "/my-reports" })}
                className="mt-2 px-4 py-2 text-sm font-medium bg-primary-500 text-white rounded-lg hover:bg-primary-400 transition-colors"
              >
                {t("myReports.detail.backToReports")}
              </button>
            </CardContent>
          </Card>
        </div>
      </LayoutContainer>
    );
  }

  // Prefer the store's copy when the processId matches — it carries dates that
  // the /my/report/:id endpoint does not return. Fall back to a synthetic record
  // with empty date strings (ReportDetailsPage guards those gracefully).
  const v1Report: StudentReport =
    selectedReport?.process_id === processId
      ? selectedReport
      : {
          process_id: detail.process_id,
          user_id: "",
          institute_id: "",
          start_date_iso: "",
          end_date_iso: "",
          status: detail.status,
          created_at: "",
          updated_at: "",
          report: reportContent,
        };

  return (
    <LayoutContainer>
      <ReportDetailsPage report={v1Report} />
    </LayoutContainer>
  );
}
