import { Info } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { formatUnlockMessage } from "@/utils/drip-conditions";
import { cn } from "@/lib/utils";

interface UnlockRequirementsProps {
  unlockMessage: string | null;
  className?: string;
  compact?: boolean;
}

/**
 * Component to display unlock requirements
 */
export function UnlockRequirements({
  unlockMessage,
  className,
  compact = false,
}: UnlockRequirementsProps) {
  const { t } = useTranslation("courseComponentsExtra");
  if (!unlockMessage) {
    return null;
  }

  const formattedMessage = formatUnlockMessage(unlockMessage);

  if (compact) {
    return (
      <div
        className={cn(
          "inline-flex items-center gap-1 text-xs text-amber-600",
          className
        )}
      >
        <Info size={12} weight="fill" />
        <span className="truncate">{formattedMessage}</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex items-start gap-2 p-2 rounded-md bg-amber-50 border border-amber-200",
        className
      )}
    >
      <Info
        size={16}
        weight="fill"
        className="text-amber-600 mt-0.5 flex-shrink-0"
      />
      <div className="flex-1 min-w-0 space-y-0.5">
        <p className="text-xs font-medium text-amber-900">
          {t("dripConditions.unlockRequirements.title")}
        </p>
        <p className="text-xs text-amber-700">{formattedMessage}</p>
      </div>
    </div>
  );
}
