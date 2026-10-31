import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X } from "@phosphor-icons/react";
import { Preferences } from "@capacitor/preferences";
import { useEffect, useState } from "react";
import type { ListPlanningLogsRequest, IntervalType } from "../-types/types";
import { getTerminology, getTerminologyPlural } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import { useTranslation } from "react-i18next";

interface PlanningFiltersProps {
  filters: ListPlanningLogsRequest;
  onChange: (filters: ListPlanningLogsRequest) => void;
  hideIntervalTypeFilter?: boolean;
  hideLogTypeFilter?: boolean;
}

export default function PlanningFilters({
  filters,
  onChange,
  hideIntervalTypeFilter = false,
}: PlanningFiltersProps) {
  const { t } = useTranslation("planning");
  const batchTerm = getTerminology(ContentTerms.Batch, SystemTerms.Batch);
  const [localBatches, setLocalBatches] = useState<any[]>([]);

  // Fetch enrolled package session IDs and local batches from student data
  useEffect(() => {
    const fetchEnrolledBatches = async () => {
      try {
        // Get enrolled package session IDs
        // Try to get from sessionList first (preferred) - this has the matched batches
        const sessionListData = await Preferences.get({ key: "sessionList" });
        if (sessionListData.value) {
          const sessions = JSON.parse(sessionListData.value);

          // Set local batches directly from sessionList
          if (Array.isArray(sessions)) {
            setLocalBatches(sessions);
          }
          return;
        }

        // Fallback: Get from instituteBatchesForSessions and students
        const studentsData = await Preferences.get({ key: "students" });
        const instituteBatchesData = await Preferences.get({
          key: "instituteBatchesForSessions",
        });

        if (studentsData.value && instituteBatchesData.value) {
          const students = JSON.parse(studentsData.value);
          const allBatches = JSON.parse(instituteBatchesData.value);

          const sessionIds = Array.isArray(students)
            ? students.map((student) => student.package_session_id)
            : [students.package_session_id];
          const filtered = sessionIds.filter(Boolean);

          // Filter batches to only enrolled ones
          if (Array.isArray(allBatches)) {
            const enrolledBatches = allBatches.filter((batch: any) =>
              filtered.includes(batch.id)
            );
            setLocalBatches(enrolledBatches);
          }
          return;
        }
      } catch (error) {
        console.error(
          "[PlanningFilters] Error fetching enrolled batches:",
          error
        );
      }
    };

    fetchEnrolledBatches();
  }, []);

  const intervalTypeOptions: { id: IntervalType; label: string }[] = [
    { id: "weekly", label: t("intervalTypeOptions.dayOfWeek") },
    { id: "monthly", label: t("intervalTypeOptions.weekly") },
    { id: "yearly_month", label: t("intervalTypeOptions.monthly") },
    { id: "yearly_quarter", label: t("intervalTypeOptions.quarterly") },
  ];

  const toggleIntervalType = (intervalType: IntervalType) => {
    const currentTypes = filters.interval_types || [];
    const newTypes = currentTypes.includes(intervalType)
      ? currentTypes.filter((t) => t !== intervalType)
      : [...currentTypes, intervalType];
    onChange({
      ...filters,
      interval_types: newTypes.length > 0 ? newTypes : undefined,
    });
  };

  const toggleBatch = (batchId: string) => {
    const currentBatches = filters.entity_ids || [];
    const newBatches = currentBatches.includes(batchId)
      ? currentBatches.filter((id) => id !== batchId)
      : [...currentBatches, batchId];
    onChange({
      ...filters,
      entity_ids: newBatches.length > 0 ? newBatches : undefined,
    });
  };

  const clearAllFilters = () => {
    onChange({ statuses: ["ACTIVE"] });
  };

  const hasActiveFilters =
    (filters.log_types && filters.log_types.length > 0) ||
    (filters.interval_types && filters.interval_types.length > 0) ||
    (filters.entity_ids && filters.entity_ids.length > 0);

  return (
    <div className="space-y-4 rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t("common.filters")}</h3>
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearAllFilters}
            className="h-auto p-1 text-xs"
          >
            {t("planningFilters.clearAll")}
          </Button>
        )}
      </div>

      {/* Batch Filter */}
      {localBatches && localBatches.length > 0 && (
        <div className="space-y-2">
          <label className="text-sm font-medium">{getTerminologyPlural(ContentTerms.Batch, SystemTerms.Batch)}</label>
          <div className="flex flex-wrap gap-2">
            {localBatches.map((batch) => {
              const batchId = batch.id;
              const batchName =
                batch.package_dto?.package_name ||
                batch.session?.session_name ||
                t("planningFilters.unnamedBatch", { batch: batchTerm });
              const isSelected = filters.entity_ids?.includes(batchId);

              return (
                <Badge
                  key={batchId}
                  variant={isSelected ? "default" : "outline"}
                  className="cursor-pointer"
                  onClick={() => toggleBatch(batchId)}
                >
                  {batchName}
                  {isSelected && <X className="ms-1 size-3" />}
                </Badge>
              );
            })}
          </div>
        </div>
      )}

      {/* Interval Type Filter */}
      {!hideIntervalTypeFilter && (
        <div className="space-y-2">
          <label className="text-sm font-medium">{t("planningFilters.intervalType")}</label>
          <div className="flex flex-wrap gap-2">
            {intervalTypeOptions.map((option) => {
              const isSelected = filters.interval_types?.includes(option.id);
              return (
                <Badge
                  key={option.id}
                  variant={isSelected ? "default" : "outline"}
                  className="cursor-pointer"
                  onClick={() => toggleIntervalType(option.id)}
                >
                  {option.label}
                  {isSelected && <X className="ms-1 size-3" />}
                </Badge>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
