"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  fetchMyReports,
  type ReportListItem,
  type StudentReport,
} from "@/services/student-reports-api";
import { useStudentPermissions } from "@/hooks/use-student-permissions";
import { DashboardLoader } from "@/components/core/dashboard-loader";
import { MyPagination } from "@/components/design-system/pagination";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MyButton } from "@/components/design-system/button";
import { useReportStore } from "@/stores/report-store";
import { X, Sparkle } from "@phosphor-icons/react";
import { useEffect } from "react";
import {
  fetchActivityInsights,
  insightTypeLabel,
} from "@/services/activity-insights";

function safeFormatDate(iso: string | undefined | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

/** Label to show in the card title: report name if set, else date range. */
function reportLabel(report: ReportListItem): string {
  if (report.name) return report.name;
  const start = safeFormatDate(report.start_date_iso);
  const end = safeFormatDate(report.end_date_iso);
  return `${start} — ${end}`;
}


function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex items-center justify-center min-h-reg-400 px-6">
      <div className="text-center space-y-2">
        <h2 className="text-xl font-semibold text-neutral-700">{title}</h2>
        <p className="text-neutral-500">{message}</p>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active
          ? "border-primary-500 text-primary-700"
          : "border-transparent text-gray-500 hover:text-gray-700"
      }`}
    >
      {children}
    </button>
  );
}

type ReportsTab = "term" | "activity";

export default function MyReportsPage() {
  const { t } = useTranslation("layoutCommonB");
  const navigate = useNavigate();
  const { permissions, isLoading: permissionsLoading } =
    useStudentPermissions();
  const { setSelectedReport } = useReportStore();
  const [currentPage, setCurrentPage] = useState(0);
  const [activeTab, setActiveTab] = useState<ReportsTab>("term");
  const [insightsPage, setInsightsPage] = useState(0);

  // No separate switch for insights: reaching My Reports at all already requires
  // the canViewReports permission, and that is the decision an institute makes.
  const { data: insightsData, isLoading: insightsLoading } = useQuery({
    queryKey: ["activityInsights", insightsPage],
    queryFn: () => fetchActivityInsights(insightsPage),
  });

  // Redirect if user doesn't have permission to view reports
  useEffect(() => {
    if (!permissionsLoading && !permissions.canViewReports) {
      navigate({ to: "/dashboard" });
    }
  }, [permissions.canViewReports, permissionsLoading, navigate]);

  const {
    data: reportsData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["myReports", currentPage],
    queryFn: () => fetchMyReports(currentPage, 20),
    enabled: !!permissions.canViewReports,
  });

  const handleViewDetails = (item: ReportListItem) => {
    // For v1 reports: pre-populate the store so the detail page can show date
    // range without a second fetch. V2 reports don't use the store.
    if (item.report_version !== "v2" && item.report) {
      const synthetic: StudentReport = {
        process_id: item.process_id,
        user_id: "",
        institute_id: "",
        start_date_iso: item.start_date_iso,
        end_date_iso: item.end_date_iso,
        status: item.status,
        created_at: item.created_at,
        updated_at: "",
        report: item.report,
      };
      setSelectedReport(synthetic);
    }
    navigate({ to: `/my-reports/${item.process_id}` });
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page - 1); // MyPagination is 1-based, API is 0-based
  };

  const handleClose = () => {
    navigate({ to: "/dashboard" });
  };

  if (permissionsLoading) {
    return <DashboardLoader />;
  }

  if (!permissions.canViewReports) {
    return null; // Will redirect
  }

  const termReports = reportsData?.reports ?? [];
  const insights = insightsData?.insights ?? [];

  // Both tabs are always present so the navigation is predictable; an learner with
  // no analysed attempts yet gets an explanatory empty state rather than a missing
  // tab they cannot account for.
  const showTabs = true;

  const renderTermReports = () => {
    if (isLoading) return <DashboardLoader />;
    if (error) {
      return (
        <EmptyState
          title={t("myReportsPage.errorLoading.title")}
          message={t("myReportsPage.errorLoading.message")}
        />
      );
    }
    if (termReports.length === 0) {
      return (
        <EmptyState
          title={t("myReportsPage.emptyTerm.title")}
          message={t("myReportsPage.emptyTerm.message")}
        />
      );
    }
    return (
      <>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 w-full py-6 md:py-8 px-4">
          {termReports.map((report) => (
            <Card
              key={report.process_id}
              className="hover:shadow-lg transition-shadow"
            >
              <CardHeader>
                <CardTitle className="text-lg">{reportLabel(report)}</CardTitle>
                <CardDescription>
                  {report.created_at
                    ? t("myReportsPage.term.created", { date: safeFormatDate(report.created_at) })
                    : ""}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-1 rounded-full text-xs font-medium ${
                        report.status === "COMPLETED"
                          ? "bg-green-100 text-green-800"
                          : "bg-yellow-100 text-yellow-800"
                      }`}
                    >
                      {report.status}
                    </span>
                    {report.report_version === "v2" && (
                      <span className="px-2 py-1 rounded-full text-xs font-medium bg-primary-50 text-primary-600 border border-primary-200">
                        {t("myReportsPage.term.comprehensive")}
                      </span>
                    )}
                  </div>
                  <MyButton
                    onClick={() => handleViewDetails(report)}
                    size="sm"
                    buttonType="secondary"
                  >
                    {t("myReportsPage.term.viewDetails")}
                  </MyButton>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {(reportsData?.total_pages ?? 0) > 1 && (
          <div className="mt-8 flex justify-center">
            <MyPagination
              currentPage={currentPage + 1}
              totalPages={reportsData?.total_pages ?? 1}
              onPageChange={handlePageChange}
            />
          </div>
        )}
      </>
    );
  };

  const renderActivityInsights = () => {
    if (insightsLoading) return <DashboardLoader />;
    if (insights.length === 0) {
      return (
        <EmptyState
          title={t("myReportsPage.emptyActivity.title")}
          message={t("myReportsPage.emptyActivity.message")}
        />
      );
    }
    return (
      <>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 w-full py-6 md:py-8 px-4">
          {insights.map((insight) => (
            <Card
              key={insight.id}
              className="hover:shadow-lg transition-shadow"
            >
              <CardHeader>
                <CardTitle className="text-lg line-clamp-2">
                  {insight.title || insightTypeLabel(insight.source_type)}
                </CardTitle>
                <CardDescription>
                  {insight.created_at ? safeFormatDate(insight.created_at) : ""}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex justify-between items-center">
                  <span className="px-2 py-1 rounded-full text-xs font-medium bg-primary-50 text-primary-600 border border-primary-200">
                    {insightTypeLabel(insight.source_type)}
                  </span>
                  <MyButton
                    onClick={() =>
                      navigate({ to: `/my-reports/activity/${insight.id}` })
                    }
                    size="sm"
                    buttonType="secondary"
                  >
                    {t("myReportsPage.activity.viewInsights")}
                  </MyButton>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {(insightsData?.total_pages ?? 0) > 1 && (
          <div className="mt-8 flex justify-center">
            <MyPagination
              currentPage={insightsPage + 1}
              totalPages={insightsData?.total_pages ?? 1}
              onPageChange={(page) => setInsightsPage(page - 1)}
            />
          </div>
        )}
      </>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50/50 pb-24 md:pb-8">
      <div className="bg-white border-b border-gray-200 sticky top-0 z-30">
        <div className="w-full py-4 px-4">
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-4">
              <button
                onClick={handleClose}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-600 md:hidden"
              >
                <X size={24} />
              </button>
              <h1 className="text-xl md:text-2xl font-bold text-gray-900">
                {t("myReportsPage.header.title")}
              </h1>
            </div>
            <div className="hidden md:flex gap-3">
              <MyButton
                type="button"
                scale="medium"
                buttonType="secondary"
                layoutVariant="default"
                onClick={handleClose}
              >
                {t("myReportsPage.header.backToDashboard")}
              </MyButton>
            </div>
          </div>

          {showTabs && (
            <div className="mt-4 flex gap-1 border-b border-gray-200">
              <TabButton
                active={activeTab === "term"}
                onClick={() => setActiveTab("term")}
              >
                {t("myReportsPage.header.progressReportsTab")}
              </TabButton>
              <TabButton
                active={activeTab === "activity"}
                onClick={() => setActiveTab("activity")}
              >
                <Sparkle size={14} weight="fill" className="text-primary-500" />
                {t("myReportsPage.header.activityInsightsTab")}
              </TabButton>
            </div>
          )}
        </div>
      </div>

      {activeTab === "activity" ? renderActivityInsights() : renderTermReports()}
    </div>
  );
}
