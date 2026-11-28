import { useState, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Preferences } from "@capacitor/preferences";
import { Table as TableIcon, List, CalendarCheck, SpinnerGap } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { LayoutContainer } from "@/components/common/layout-container/layout-container";
import { useNavHeadingStore } from "@/stores/layout-container/useNavHeadingStore";
import FiltersDialog from "../-components/FiltersDialog";
import PlanningLogsTable from "../-components/PlanningLogsTable";
import ViewPlanningDialog from "../-components/ViewPlanningDialog";
import IntervalTypeSelector, {
  type PlanningPeriod,
} from "../-components/IntervalTypeSelector";
import TodayPlanningCard from "../-components/TodayPlanningCard";
import { useListPlanningLogs } from "../-services/listPlanningLogs";
import {
  useGetTodayIntervalTypeId,
  type IntervalType,
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

export const Route = createFileRoute("/planning/planning-logs/")({
  component: PlanningLogsPage,
});

function PlanningLogsPage() {
  const { t } = useTranslation("planning");
  const teacher = getTerminology(RoleTerms.Teacher, SystemTerms.Teacher);
  const [pageNo, setPageNo] = useState(0);
  const [pageSize] = useState(10);
  const [viewMode, setViewMode] = useState<ViewMode>("timeline");
  const [selectedPeriod, setSelectedPeriod] =
    useState<PlanningPeriod>("weekly");
  const [todayIntervalTypeId, setTodayIntervalTypeId] = useState<string | null>(
    null
  );
  const [batchMap, setBatchMap] = useState<Record<string, string>>({});
  const [selectedLog, setSelectedLog] = useState<PlanningLog | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [filters, setFilters] = useState<ListPlanningLogsRequest>({
    statuses: ["ACTIVE"],
    log_types: ["planning"],
  });

  const { setNavHeading } = useNavHeadingStore();

  // Set navigation heading
  useEffect(() => {
    setNavHeading(t("planningLogsPage.navHeading"));
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

  // Get today's interval type ID
  const {
    mutate: getTodayId,
    isPending: isLoadingTodayId,
    data: todayIdData,
  } = useGetTodayIntervalTypeId();

  // Trigger API call when interval type changes (only if not "all")
  useEffect(() => {
    if (selectedPeriod !== "all") {
      getTodayId({ intervalType: selectedPeriod as IntervalType });
    }
  }, [selectedPeriod, getTodayId]);

  // Update todayIntervalTypeId when data arrives
  useEffect(() => {
    if (todayIdData) {
      setTodayIntervalTypeId(todayIdData);
      // Update filters to include today's interval type ID
      setFilters((prev) => ({
        ...prev,
        interval_type_ids: [todayIdData],
      }));
    }
  }, [todayIdData]);

  // Update filters when "all" is selected
  useEffect(() => {
    if (selectedPeriod === "all") {
      setFilters((prev) => ({
        ...prev,
        interval_type_ids: undefined,
      }));
    }
  }, [selectedPeriod]);

  // Determine if we should fetch data
  const shouldFetchData = selectedPeriod === "all" || !!todayIntervalTypeId;

  // Fetch planning logs
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
      log_types: ["planning"],
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

  const handlePeriodChange = (period: PlanningPeriod) => {
    setSelectedPeriod(period);
    setPageNo(0);
  };

  const handleViewLog = (log: PlanningLog) => {
    setSelectedLog(log);
    setDialogOpen(true);
  };

  const todayPlannings = data?.content || [];
  const hasPlannings = todayPlannings.length > 0;
  const isLoadingPeriodId = selectedPeriod !== "all" && isLoadingTodayId;

  return (
    <LayoutContainer>
      <div className="space-y-4 p-4">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-3xl font-bold">{t("planningLogsPage.navHeading")}</h2>
            <p className="text-sm text-muted-foreground">
              {t("planningLogsPage.subtitle")}
            </p>
          </div>
          <div className="flex gap-2">
            <FiltersDialog filters={filters} onChange={handleFilterChange} />
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

        {/* Interval Type Selector */}
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">
            {t("common.selectPeriod")}
          </h3>
          <IntervalTypeSelector
            selectedType={selectedPeriod}
            onSelect={handlePeriodChange}
          />
        </div>

        {/* Today's Plannings */}
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
            <p className="text-destructive">{t("planningLogsPage.errorLoad")}</p>
          </div>
        ) : !hasPlannings ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12">
            <CalendarCheck className="mb-4 size-12 text-muted-foreground/50" />
            <h3 className="mb-2 text-lg font-semibold">{t("planningLogsPage.empty.title")}</h3>
            <p className="text-sm text-muted-foreground">
              {t("planningLogsPage.empty.description", { teacher })}
            </p>
          </div>
        ) : viewMode === "table" ? (
          <PlanningLogsTable
            data={todayPlannings}
            totalPages={data?.totalPages || 0}
            currentPage={pageNo}
            onPageChange={handlePageChange}
            onViewLog={handleViewLog}
          />
        ) : (
          <div className="space-y-4">
            {todayPlannings.map((log) => (
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
