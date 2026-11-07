import { Lock } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface LockedBadgeProps {
  className?: string;
  size?: "sm" | "md" | "lg";
  showText?: boolean;
  unlockMessage?: string | null;
}

/**
 * Badge component to indicate locked content
 */
export function LockedBadge({
  className,
  size = "md",
  showText = true,
  unlockMessage,
}: LockedBadgeProps) {
  const { t } = useTranslation("courseComponentsExtra");
  const iconSize = size === "sm" ? 12 : size === "md" ? 14 : 16;

  const badge = (
    <Badge
      variant="secondary"
      className={cn(
        "inline-flex items-center gap-1 bg-amber-50 text-amber-700 border-amber-200",
        size === "sm" && "text-xs px-1.5 py-0.5",
        size === "md" && "text-xs px-2 py-1",
        size === "lg" && "text-sm px-2.5 py-1",
        unlockMessage && "cursor-help",
        className
      )}
    >
      <Lock size={iconSize} weight="fill" />
      {showText && <span>{t("dripConditions.common.locked")}</span>}
    </Badge>
  );

  if (unlockMessage) {
    return (
      <TooltipProvider>
        <Tooltip delayDuration={200}>
          <TooltipTrigger asChild>{badge}</TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            <p className="text-sm">{unlockMessage}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return badge;
}
