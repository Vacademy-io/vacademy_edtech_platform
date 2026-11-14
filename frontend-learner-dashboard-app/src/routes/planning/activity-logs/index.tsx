import { useState, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Preferences } from "@capacitor/preferences";
import { Table as TableIcon, List, BookOpen, SpinnerGap } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { LayoutContainer } from "@/components/common/layout-container/layout-container";
import { useNavHeadingStore } from "@/stores/layout-container/useNavHeadingStore";
import FiltersDialog from "../-components/FiltersDialog";
import PlanningLogsTable from "../-components/PlanningLogsTable";
import ViewPlanningDialog from "../-components/ViewPlanningDialog";
import TodayPlanningCard from "../-components/TodayPlanningCard";
import ActivityPeriodSelector, {
  type ActivityPeriod,
} from "../-components/ActivityPeriodSelector";
import { useListPlanningLogs } from "../-services/listPlanningLogs";
import {
  useGetTodayIntervalTypeId,
  useGenerateIntervalTypeId,
} from "../-services/generateIntervalTypeId";
import type {
  ListPlanningLogsRequest,
  PlanningLog,
  ViewMode,
} from "../-types/types";
import { getPackageSessionName } from "../-utils/getPackageSessionName";
import { useTranslation } from "react-i18next";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { RoleTerms, SystemTerms } from "@/types/naming-settings";

export const Route = createFileRoute("/planning/activity-logs/")({
  component: ActivityLogsPage,
});

function ActivityLogsPage() {
  const { t } = useTranslation("planning");
  const teacher = getTerminology(RoleTerms.Teacher, SystemTerms.Teacher);
  const [pageNo, setPageNo] = useState(0);
  const [pageSize] = useState(20);
  const [viewMode, setViewMode] = useState<ViewMode>("timeline");
  const [selectedPeriod, setSelectedPeriod] = useState<ActivityPeriod>("today");
  const [todayIntervalTypeId, setTodayIntervalTypeId] = useState<string | null>(
    null
  );
  const [tomorrowIntervalTypeId, setTomorrowIntervalTypeId] = useState<
    string | null
  >(null);
  const [batchMap, setBatchMap] = useState<Record<string, string>>({});
  const [selectedLog, setSelectedLog] = useState<PlanningLog | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [filters, setFilters] = useState<ListPlanningLogsRequest>({
    statuses: ["ACTIVE"],
    log_types: ["diary_log"],
  });

  const { setNavHeading } = useNavHeadingStore();

  // Set navigation heading
  useEffect(() => {
    setNavHeading(t("activityLogsPage.navHeading"));
  }, [setNavHeading, t]);

  // Fetch batch names
  useEffect(() => {
    const fetchBatches = async () => {
      try {
        const batchData = await Preferences.get({ key: "sessionList" });
        if (batchData.value) {
          const batches = JSON.parse(batchData.value);
          const map: Record<string, string> = {};
          batches.forEach((batch: any) => {
            map[batch.id] = getPackageSessionName(batch);
          });
          setBatchMap(map);
        }
      } catch (error) {
        console.error("Error fetching batches:", error);
      }
    };
    fetchBatches();
  }, []);

  // Helper function to get date string in YYYY-MM-DD format
  const getDateString = (daysOffset: number = 0): string => {
    const date = new Date();
    date.setDate(date.getDate() + daysOffset);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  // Get interval type IDs for today and tomorrow
  const {
    mutate: getTodayId,
    isPending: isLoadingTodayId,
    data: todayIdData,
  } = useGetTodayIntervalTypeId();

  const {
    mutate: getTomorrowId,
    isPending: isLoadingTomorrowId,
    data: tomorrowIdData,
  } = useGenerateIntervalTypeId();

  // Fetch interval type IDs on mount
  useEffect(() => {
    getTodayId({ intervalType: "daily" });
  }, [getTodayId]);

  useEffect(() => {
    // For tomorrow, get the date and fetch interval type ID
    const tomorrowDate = getDateString(1);
    getTomorrowId({ intervalType: "daily", dateYYYYMMDD: tomorrowDate });
  }, [getTomorrowId]);

  // Update interval type IDs when data arrives
  useEffect(() => {
    if (todayIdData) {
      setTodayIntervalTypeId(todayIdData);
    }
  }, [todayIdData]);

  useEffect(() => {
    if (tomorrowIdData) {
      setTomorrowIntervalTypeId(tomorrowIdData);
    }
  }, [tomorrowIdData]);

  // Update filters based on selected period
  useEffect(() => {
    if (selectedPeriod === "today" && todayIntervalTypeId) {
      setFilters((prev) => ({
        ...prev,
        interval_type_ids: [todayIntervalTypeId],
      }));
    } else if (selectedPeriod === "tomorrow" && tomorrowIntervalTypeId) {
      setFilters((prev) => ({
        ...prev,
        interval_type_ids: [tomorrowIntervalTypeId],
      }));
    } else if (selectedPeriod === "all") {
      setFilters((prev) => ({
        ...prev,
        interval_type_ids: undefined,
      }));
    }
  }, [selectedPeriod, todayIntervalTypeId, tomorrowIntervalTypeId]);

  const shouldFetchData =
    selectedPeriod === "all" ||
    (selectedPeriod === "today" && !!todayIntervalTypeId) ||
    (selectedPeriod === "tomorrow" && !!tomorrowIntervalTypeId);

  const { data, isLoading, error } = useListPlanningLogs({
    pageNo,
    pageSize,
    filters,
    enabled: shouldFetchData,
  });

  const handleFilterChange = (newFilters: ListPlanningLogsRequest) => {
    // Clear interval_type_ids when applying custom filters
    setFilters({
      ...newFilters,
      statuses: ["ACTIVE"],
      log_types: ["diary_log"],
      interval_type_ids: undefined,
    });
    setPageNo(0);
    // Reset to "all" period when custom filters are applied
    setSelectedPeriod("all");
  };

  const handlePageChange = (newPage: number) => {
    setPageNo(newPage);
  };

  const toggleViewMode = () => {
    setViewMode((prev) => (prev === "table" ? "timeline" : "table"));
  };

  const handlePeriodChange = (period: ActivityPeriod) => {
    setSelectedPeriod(period);
    setPageNo(0);
  };

  const handleViewLog = (log: PlanningLog) => {
    setSelectedLog(log);
    setDialogOpen(true);
  };

  const activities = data?.content || [];
  const hasActivities = activities.length > 0;
  const isLoadingPeriodId =
    (selectedPeriod === "today" && isLoadingTodayId) ||
    (selectedPeriod === "tomorrow" && isLoadingTomorrowId);

  return (
    <LayoutContainer>
      <div className="space-y-4 p-4">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-3xl font-bold">{t("activityLogsPage.navHeading")}</h2>
            <p className="text-sm text-muted-foreground">
              {t("activityLogsPage.subtitle")}
            </p>
          </div>
          <div className="flex gap-2">
            <FiltersDialog
              filters={filters}
              onChange={handleFilterChange}
              hideIntervalTypeFilter
            />
            <Button
              variant="outline"
              size="sm"
              onClick={toggleViewMode}
              className="flex items-center gap-2"
            >
              {viewMode === "table" ? (
                <>
                  <List className="size-4" />
                  {t("common.viewModeTimeline")}
                </>
              ) : (
                <>
                  <TableIcon className="size-4" />
                  {t("common.viewModeTable")}
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Period Selector */}
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">
            {t("common.selectPeriod")}
          </h3>
          <ActivityPeriodSelector
            selectedPeriod={selectedPeriod}
            onSelect={handlePeriodChange}
          />
        </div>

        {/* Activities Content */}
        {isLoadingPeriodId ? (
          <div className="flex items-center justify-center py-12">
            <SpinnerGap className="size-8 animate-spin text-muted-foreground" />
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-12">
            <SpinnerGap className="size-8 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-8 text-center">
            <p className="text-destructive">{t("activityLogsPage.errorLoad")}</p>
          </div>
        ) : !hasActivities ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12">
            <BookOpen className="mb-4 size-12 text-muted-foreground/50" />
            <h3 className="mb-2 text-lg font-semibold">{t("activityLogsPage.empty.title")}</h3>
            <p className="text-sm text-muted-foreground">
              {t("activityLogsPage.empty.description", { teacher })}
            </p>
          </div>
        ) : viewMode === "table" ? (
          <PlanningLogsTable
            data={activities}
            totalPages={data?.totalPages || 0}
            currentPage={pageNo}
            onPageChange={handlePageChange}
            onViewLog={handleViewLog}
          />
        ) : (
          <div className="space-y-4">
            {activities.map((log) => (
              <TodayPlanningCard
                key={log.id}
                log={log}
                showBatchName={batchMap[log.entity_id]}
              />
            ))}
            {data && data.totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 pt-4">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pageNo === 0}
                  onClick={() => handlePageChange(pageNo - 1)}
                >
                  {t("common.previous")}
                </Button>
                <span className="text-sm text-muted-foreground">
                  {t("common.pageOf", { page: pageNo + 1, total: data.totalPages })}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pageNo >= data.totalPages - 1}
                  onClick={() => handlePageChange(pageNo + 1)}
                >
                  {t("common.next")}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* View Dialog */}
        <ViewPlanningDialog
          log={selectedLog}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
        />
      </div>
    </LayoutContainer>
  );
}
