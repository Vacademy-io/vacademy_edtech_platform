import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Funnel, X } from "@phosphor-icons/react";
import { Preferences } from "@capacitor/preferences";
import { useEffect, useState } from "react";
import type { ListPlanningLogsRequest, IntervalType } from "../-types/types";
import { getPackageSessionName } from "../-utils/getPackageSessionName";
import { useTranslation } from "react-i18next";
import { getTerminologyPlural } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";

interface FiltersDialogProps {
  filters: ListPlanningLogsRequest;
  onChange: (filters: ListPlanningLogsRequest) => void;
  hideIntervalTypeFilter?: boolean;
}

export default function FiltersDialog({
  filters,
  onChange,
  hideIntervalTypeFilter = false,
}: FiltersDialogProps) {
  const { t } = useTranslation("planning");
  const [open, setOpen] = useState(false);
  const [localBatches, setLocalBatches] = useState<any[]>([]);
  const courses = getTerminologyPlural(ContentTerms.Course, SystemTerms.Course);
  const batches = getTerminologyPlural(ContentTerms.Batch, SystemTerms.Batch);

  // Fetch enrolled batches
  useEffect(() => {
    const fetchEnrolledBatches = async () => {
      try {
        const sessionListData = await Preferences.get({ key: "sessionList" });
        if (sessionListData.value) {
          const sessions = JSON.parse(sessionListData.value);
          if (Array.isArray(sessions)) {
            setLocalBatches(sessions);
          }
          return;
        }

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

          if (Array.isArray(allBatches)) {
            const enrolledBatches = allBatches.filter((batch: any) =>
              filtered.includes(batch.id)
            );
            setLocalBatches(enrolledBatches);
          }
        }
      } catch (error) {
        console.error(
          "[FiltersDialog] Error fetching enrolled batches:",
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

  const clearFilters = () => {
    onChange({
      statuses: filters.statuses,
      log_types: filters.log_types,
    });
  };

  const hasActiveFilters =
    (filters.interval_types && filters.interval_types.length > 0) ||
    (filters.entity_ids && filters.entity_ids.length > 0);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="relative">
          <Funnel className="me-2 size-4" />
          {t("common.filters")}
          {hasActiveFilters && (
            <span className="ms-2 flex size-5 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
              {(filters.interval_types?.length || 0) +
                (filters.entity_ids?.length || 0)}
            </span>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("filtersDialog.title")}</DialogTitle>
          <DialogDescription>{t("filtersDialog.description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Interval Type Filter */}
          {!hideIntervalTypeFilter && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">{t("filtersDialog.period")}</h3>
                {filters.interval_types &&
                  filters.interval_types.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        onChange({ ...filters, interval_types: undefined })
                      }
                    >
                      {t("common.clear")}
                    </Button>
                  )}
              </div>
              <div className="flex flex-wrap gap-2">
                {intervalTypeOptions.map((option) => {
                  const isSelected = filters.interval_types?.includes(
                    option.id
                  );
                  return (
                    <Badge
                      key={option.id}
                      variant={isSelected ? "default" : "outline"}
                      className="cursor-pointer px-3 py-1.5"
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

          {/* Batch Filter. hidding courses */}
          {localBatches.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">
                  {t("filtersDialog.coursesAndBatches", { courses, batches })}
                </h3>
                {filters.entity_ids && filters.entity_ids.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      onChange({ ...filters, entity_ids: undefined })
                    }
                  >
                    {t("common.clear")}
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {localBatches.map((batch) => {
                  const isSelected = filters.entity_ids?.includes(batch.id);
                  return (
                    <Badge
                      key={batch.id}
                      variant={isSelected ? "default" : "outline"}
                      className="cursor-pointer px-3 py-1.5"
                      onClick={() => toggleBatch(batch.id)}
                    >
                      {getPackageSessionName(batch)}
                      {isSelected && <X className="ms-1 size-3" />}
                    </Badge>
                  );
                })}
              </div>
            </div>
          )}

          {/* Clear All */}
          {hasActiveFilters && (
            <div className="flex justify-end border-t pt-4">
              <Button variant="outline" onClick={clearFilters}>
                {t("filtersDialog.clearAllFilters")}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
