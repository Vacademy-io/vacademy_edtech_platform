import React from "react";
import { useTranslation } from "react-i18next";
import { Sparkle } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import type { ComingSoonInfo } from "../../-utils/coming-soon";

/** The pill laid over a Coming Soon course's card image. */
export const ComingSoonRibbon: React.FC<{ info: ComingSoonInfo; className?: string }> = ({
  info,
  className,
}) => {
  const { t } = useTranslation("coursePlayerB");
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-primary-500 px-2.5 py-1 text-xs font-semibold text-white shadow-sm",
        className,
      )}
    >
      <Sparkle size={12} weight="fill" aria-hidden="true" />
      {info.ribbonText || t("comingSoon.ribbon")}
    </span>
  );
};

export default ComingSoonRibbon;
