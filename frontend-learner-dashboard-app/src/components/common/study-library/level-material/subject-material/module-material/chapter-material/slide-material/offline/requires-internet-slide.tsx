/**
 * Offline gate for online-only slide types (plan §B4/§7): YouTube/Vimeo/
 * Drive/embeds, SCORM, ASSESSMENT, CODE/JUPYTER/SCRATCH embeds, AI/HTML
 * video. These are never downloadable (third-party-hosted or execution-
 * environment content) — when the learner is offline, `slide-material.tsx`
 * renders this instead of attempting to load them.
 */

import { useTranslation } from "react-i18next";
import { CloudSlash, WifiHigh } from "@phosphor-icons/react";

export const RequiresInternetSlide = ({ slideTypeLabel }: { slideTypeLabel?: string }) => {
  const { t } = useTranslation("libraryCommonB");
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-neutral-100">
        <CloudSlash size={32} className="text-neutral-400" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-title font-semibold text-neutral-700">{t("requiresInternetSlide.title")}</p>
        <p className="max-w-sm text-body text-neutral-500">
          {slideTypeLabel
            ? t("requiresInternetSlide.bodyWithType", { type: slideTypeLabel })
            : t("requiresInternetSlide.bodyGeneric")}
        </p>
      </div>
      <div className="flex items-center gap-1.5 text-caption text-neutral-400">
        <WifiHigh size={14} />
        <span>{t("requiresInternetSlide.waiting")}</span>
      </div>
    </div>
  );
};
