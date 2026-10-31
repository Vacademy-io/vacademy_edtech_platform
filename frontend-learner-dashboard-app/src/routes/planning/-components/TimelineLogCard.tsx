import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Eye } from "@phosphor-icons/react";
import type { PlanningLog } from "../-types/types";
import {
  formatIntervalType,
  formatIntervalTypeId,
} from "../-utils/intervalTypeIdFormatter";
import { useTranslation } from "react-i18next";
import { formatDate } from "@/lib/formatters";

interface TimelineLogCardProps {
  log: PlanningLog;
  onView: (log: PlanningLog) => void;
  highlightText?: (text: string, highlight: string) => React.ReactNode;
  searchQuery?: string;
}

export default function TimelineLogCard({
  log,
  onView,
  highlightText,
  searchQuery = "",
}: TimelineLogCardProps) {
  const { t } = useTranslation("planning");
  const displayText = (text: string) => {
    if (highlightText && searchQuery) {
      return highlightText(text, searchQuery);
    }
    return text;
  };

  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm transition-shadow hover:shadow-md">
      <div className="space-y-3">
        {/* Primary: Interval Type and Period */}
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="px-3 py-1 text-sm font-semibold">
            {formatIntervalType(log.interval_type, t)}
          </Badge>
          <span className="text-base font-bold text-foreground">
            {formatIntervalTypeId(log.interval_type_id, t)}
          </span>
        </div>

        {/* Title */}
        <div className="text-base font-medium text-foreground">
          {displayText(log.title)}
        </div>

        {/* Description Preview */}
        {log.description && (
          <div className="line-clamp-2 text-sm text-muted-foreground">
            {displayText(log.description)}
          </div>
        )}

        {/* Meta information */}
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <span>{t("timelineCard.by", { name: log.created_by })}</span>
          <span>
            {formatDate(log.created_at, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </span>
        </div>

        {/* Actions - ONLY VIEW BUTTON FOR LEARNERS */}
        <div className="flex gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={() => onView(log)}>
            <Eye className="me-2 size-4" />
            {t("timelineCard.viewDetails")}
          </Button>
        </div>
      </div>
    </div>
  );
}
