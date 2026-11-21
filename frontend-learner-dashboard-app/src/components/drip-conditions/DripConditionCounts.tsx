import { Eye, EyeSlash, Lock } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  getTerminology,
  getTerminologyPlural,
} from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";

interface DripConditionCountsProps {
  locked: number;
  hidden: number;
  total: number;
  className?: string;
  itemType?: "chapter" | "slide";
}

/**
 * Component to display counts of locked/hidden items
 */
export function DripConditionCounts({
  locked,
  hidden,
  total,
  className,
  itemType = "slide",
}: DripConditionCountsProps) {
  const { t } = useTranslation("courseComponentsExtra");
  const accessible = total - locked - hidden;

  if (locked === 0 && hidden === 0) {
    return null;
  }

  const itemLabel =
    itemType === "chapter"
      ? getTerminology(ContentTerms.Chapters, SystemTerms.Chapters)
      : getTerminology(ContentTerms.Slides, SystemTerms.Slides);
  const itemLabelPlural =
    itemType === "chapter"
      ? getTerminologyPlural(ContentTerms.Chapters, SystemTerms.Chapters)
      : getTerminologyPlural(ContentTerms.Slides, SystemTerms.Slides);

  return (
    <div className={cn("flex items-center gap-2 flex-wrap", className)}>
      {accessible > 0 && (
        <Badge
          variant="secondary"
          className="bg-green-50 text-green-700 border-green-200 text-xs"
        >
          <Eye size={12} weight="fill" className="me-1" />
          {t("dripConditions.counts.accessible", {
            count: accessible,
            term: accessible === 1 ? itemLabel : itemLabelPlural,
          })}
        </Badge>
      )}
      {locked > 0 && (
        <Badge
          variant="secondary"
          className="bg-amber-50 text-amber-700 border-amber-200 text-xs"
        >
          <Lock size={12} weight="fill" className="me-1" />
          {t("dripConditions.counts.locked", { count: locked })}
        </Badge>
      )}
      {hidden > 0 && (
        <Badge
          variant="secondary"
          className="bg-gray-100 text-gray-600 border-gray-300 text-xs"
        >
          <EyeSlash size={12} weight="fill" className="me-1" />
          {t("dripConditions.counts.hidden", { count: hidden })}
        </Badge>
      )}
    </div>
  );
}
