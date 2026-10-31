import React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { MegaMenuItem } from "./mega-menu-model";

/**
 * Small pieces shared by the desktop panel and the mobile accordion of the
 * header mega menu.
 */

/** Round image on the item's accent colour; its initial when there is no image. */
export const MegaItemIcon: React.FC<{
  item: Pick<MegaMenuItem, "imageUrl" | "accentColor" | "title">;
  className?: string;
  initialClassName?: string;
}> = ({ item, className, initialClassName }) => (
  <span
    aria-hidden="true"
    className={cn(
      "flex shrink-0 items-center justify-center overflow-hidden rounded-full",
      !item.accentColor && "bg-primary-100",
      className,
    )}
    style={item.accentColor ? { backgroundColor: item.accentColor } : undefined} // design-lint-ignore: folder accent colour is admin data
  >
    {item.imageUrl ? (
      <img
        src={item.imageUrl}
        alt=""
        loading="lazy"
        className={cn("size-full", item.accentColor ? "object-contain p-1.5" : "object-cover")}
      />
    ) : (
      <span className={cn("font-semibold text-catalogue-brand-ink", initialClassName)}>
        {Array.from(item.title.trim())[0] || ""}
      </span>
    )}
  </span>
);

/** "coming soon" tag on muted tiles and rows. */
export const ComingSoonTag: React.FC<{ className?: string }> = ({ className }) => {
  const { t } = useTranslation("coursePlayerB");
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-catalogue-border px-2 py-0.5 text-caption font-medium text-catalogue-text-muted",
        className,
      )}
    >
      {t("header.megaMenu.comingSoon", "Coming soon")}
    </span>
  );
};

/** ● available ○ coming soon */
export const AvailabilityDot: React.FC<{ comingSoon: boolean }> = ({ comingSoon }) => (
  <span
    aria-hidden="true"
    className={cn(
      "inline-block size-2 shrink-0 rounded-full",
      comingSoon ? "border border-catalogue-text-muted" : "bg-primary-500",
    )}
  />
);

export const AvailabilityLegend: React.FC<{ className?: string }> = ({ className }) => {
  const { t } = useTranslation("coursePlayerB");
  return (
    <p className={cn("flex items-center gap-3 text-caption text-catalogue-text-muted", className)}>
      <span className="inline-flex items-center gap-1.5">
        <AvailabilityDot comingSoon={false} />
        {t("header.megaMenu.legendAvailable", "available")}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <AvailabilityDot comingSoon />
        {t("header.megaMenu.legendComingSoon", "coming soon")}
      </span>
    </p>
  );
};
