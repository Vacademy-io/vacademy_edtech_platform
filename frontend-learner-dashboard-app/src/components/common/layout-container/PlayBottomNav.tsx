import React, { useEffect, useState } from "react";
import { isNavRouteActive } from "./sidebar/active-route";
import { Link, useRouter } from "@tanstack/react-router";
import { DotsThree, type IconProps } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { cn } from "@/lib/utils";
import { getStudentDisplaySettings } from "@/services/student-display-settings";
import type { SidebarItemsType } from "@/types/layout-container-types";
import type { StudentSidebarTabConfig } from "@/types/student-display-settings";
import { useCleanerPlayTheme } from "@/hooks/use-cleaner-play-theme";
import {
  NavHouseIcon,
  NavBookIcon,
  NavNotepadIcon,
  NavClipboardCheckIcon,
  NavUsersIcon,
  NavGiftIcon,
  NavCalendarCheckIcon,
} from "./sidebar/nav-icons";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

// Same hand-drawn icon set as mySidebar.tsx
const ICON_MAP: Record<string, React.FC<IconProps>> = {
  dashboard: NavHouseIcon,
  "learning-center": NavBookIcon,
  homework: NavNotepadIcon,
  "assessment-center": NavClipboardCheckIcon,
  "sub-org-learners": NavUsersIcon,
  referral: NavGiftIcon,
  attendance: NavCalendarCheckIcon,
};

// Translation keys for the tab-id fallback label (used when the display
// settings supply no admin-typed label at all). "dashboard" resolves via
// the shared `common.home` key since it means the same "go home" concept
// the navbar's Home tooltip uses.
const LABEL_KEYS: Record<string, string> = {
  "learning-center": "playBottomNav.labels.learningCenter",
  homework: "playBottomNav.labels.homework",
  "assessment-center": "playBottomNav.labels.assessmentCenter",
  referral: "playBottomNav.labels.referral",
  attendance: "playBottomNav.labels.attendance",
  planning: "playBottomNav.labels.planning",
};

// Short labels for bottom nav (max ~6 chars). Keyed by the FULL English
// title text that display settings / the main sidebar config hand us
// (e.g. "Learning Center") — that config text itself is not localized, so
// the keys stay the untranslated English strings; only the shortened
// VALUE returned is translated.
const SHORT_LABEL_KEYS: Record<string, string> = {
  "Dashboard": "common.home",
  "Learning Center": "playBottomNav.labels.learningCenter",
  "Homework": "playBottomNav.labels.homework",
  "Assessment Centre": "playBottomNav.labels.assessmentCenter",
  "Referral": "playBottomNav.labels.referral",
  "Attendance": "playBottomNav.labels.attendance",
  "Planning": "playBottomNav.labels.planning",
  "Sub-Org Learners": "playBottomNav.labels.subOrgLearners",
};

const ROUTE_MAP: Record<string, string> = {
  dashboard: "/dashboard",
  referral: "/referral",
  attendance: "/learning-centre/attendance",
};

function createLetterIcon(letter: string) {
  return function LetterIcon({ size = 20, className = "" }: IconProps) {
    return (
      <span
        className={`inline-flex items-center justify-center rounded-lg text-xs font-black ${className}`}
        style={{ width: size, height: size }}
      >
        {letter}
      </span>
    );
  };
}

function transformTabs(
  tabs: StudentSidebarTabConfig[],
  t: TFunction
): SidebarItemsType[] {
  return tabs
    .filter((tab) => tab.visible !== false)
    .map((tab) => {
      const firstRoute =
        tab.route ||
        ROUTE_MAP[tab.id] ||
        (tab.subTabs || []).find((s) => s.visible !== false)?.route ||
        "/";
      const labelKey = tab.id === "dashboard" ? "common.home" : LABEL_KEYS[tab.id];

      return {
        icon: ICON_MAP[tab.id] || createLetterIcon((tab.label || tab.id || "?").charAt(0).toUpperCase()),
        title: tab.label || (labelKey ? t(labelKey) : tab.id) || "",
        to: firstRoute,
      };
    });
}

const MAX_VISIBLE = 4;

/** Shared item source for the mobile bottom bar and the desktop rail. */
function usePlayNavItems(): SidebarItemsType[] {
  const { t } = useTranslation("layoutCommonA");
  const [items, setItems] = useState<SidebarItemsType[]>([]);

  useEffect(() => {
    getStudentDisplaySettings(false).then((settings) => {
      const tabs = settings?.sidebar?.tabs || [];
      setItems(transformTabs(tabs, t));
    });
  }, [t]);

  return items;
}

function shortLabelFor(title: string, t: TFunction): string {
  const key = SHORT_LABEL_KEYS[title];
  return key ? t(key) : title.length > 6 ? title.slice(0, 5) + "…" : title;
}

export const PlayBottomNav: React.FC = () => {
  const { t } = useTranslation("layoutCommonA");
  const items = usePlayNavItems();
  const router = useRouter();
  const isCleanerPlay = useCleanerPlayTheme();
  const currentRoute = router.state.location.pathname;
  // Every entry is a direct link here (no sub-item rows), so all compete.
  const navRoutes = items.map((item) => item.to);

  if (items.length === 0) return null;

  const visibleItems = items.slice(0, MAX_VISIBLE);
  const overflowItems = items.slice(MAX_VISIBLE);
  const hasOverflow = overflowItems.length > 0;

  return (
    <nav
      className="fixed bottom-0 start-0 end-0 z-50 md:hidden bg-white border-t border-border"
      style={{ // design-lint-ignore: dynamic safe-area inset padding
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 4px)",
        boxShadow: "0 -2px 8px rgba(0,0,0,0.04)",
      }}
    >
      <div className="flex items-stretch justify-around px-1 pt-1">
        {visibleItems.map((item, i) => {
          const isActive = isNavRouteActive(currentRoute, item.to, navRoutes);
          const Icon = item.icon;
          const shortLabel = shortLabelFor(item.title, t);

          return (
            <Link
              key={i}
              to={item.to || "/"}
              className="group flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 py-1.5 transition-all duration-150"
            >
              <div
                className={cn(
                  "flex h-10 w-12 items-center justify-center rounded-xl transition-all duration-150",
                  isActive
                    ? isCleanerPlay
                      ? "bg-primary/10 text-primary"
                      : "bg-play-success-soft text-play-success-soft-ink group-active:translate-y-0.5"
                    : "text-muted-foreground"
                )}
              >
                {Icon &&
                  React.createElement(Icon, {
                    size: 24,
                    weight: isActive ? "fill" : "regular",
                  })}
              </div>
              <span
                className={cn(
                  "text-2xs font-bold leading-none",
                  isActive
                    ? isCleanerPlay
                      ? "text-primary"
                      : "text-play-success-soft-ink"
                    : "text-muted-foreground"
                )}
              >
                {shortLabel}
              </span>
            </Link>
          );
        })}

        {/* More button for overflow items */}
        {hasOverflow && (
          <Sheet>
            <SheetTrigger asChild>
              <button className="flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 py-1.5">
                <div className="flex h-10 w-12 items-center justify-center rounded-xl text-muted-foreground">
                  <DotsThree size={24} weight="bold" />
                </div>
                <span className="text-2xs font-bold leading-none text-muted-foreground">
                  {t("playBottomNav.more")}
                </span>
              </button>
            </SheetTrigger>
            <SheetContent side="bottom" className="rounded-t-3xl pb-safe">
              <SheetHeader>
                <SheetTitle className="text-sm font-bold">{t("playBottomNav.more")}</SheetTitle>
              </SheetHeader>
              <div className="grid grid-cols-3 gap-3 py-4">
                {overflowItems.map((item, i) => {
                  const Icon = item.icon;
                  const isActive = isNavRouteActive(currentRoute, item.to, navRoutes);
                  return (
                    <Link
                      key={i}
                      to={item.to || "/"}
                      className={cn(
                        "group flex min-h-12 flex-col items-center gap-2 rounded-xl p-4 transition-all",
                        isActive
                          ? isCleanerPlay
                            ? "bg-primary/5"
                            : "bg-play-gold-soft"
                          : "hover:bg-muted"
                      )}
                    >
                      <div
                        className={cn(
                          "flex size-12 items-center justify-center rounded-xl",
                          isActive
                            ? isCleanerPlay
                              ? "bg-primary/10 text-primary"
                              : "bg-play-success-soft text-play-success-soft-ink"
                            : "bg-muted text-muted-foreground"
                        )}
                      >
                        {Icon &&
                          React.createElement(Icon, {
                            size: 24,
                            weight: isActive ? "fill" : "regular",
                          })}
                      </div>
                      <span
                        className={cn(
                          "text-center text-xs font-bold",
                          isActive
                            ? isCleanerPlay
                              ? "text-primary"
                              : "text-play-ink"
                            : "text-muted-foreground"
                        )}
                      >
                        {item.title}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </SheetContent>
          </Sheet>
        )}
      </div>
    </nav>
  );
};

/**
 * Desktop (lg+) play-mode icon rail. Rendered by LayoutContainer ONLY when
 * the standard sidebar is config-hidden (display settings
 * `sidebar.visible === false`) and the route has no custom sidebar — the one
 * desktop case with no persistent navigation. Sits in the sidebar-provider
 * flex row as a sticky sibling, so content clears it without padding hacks.
 * Mirrors the bottom bar's items and press grammar for one play nav language.
 */
export const PlayNavRail: React.FC = () => {
  const { t } = useTranslation("layoutCommonA");
  const items = usePlayNavItems();
  const router = useRouter();
  const isCleanerPlay = useCleanerPlayTheme();
  const currentRoute = router.state.location.pathname;
  // Every entry is a direct link here (no sub-item rows), so all compete.
  const navRoutes = items.map((item) => item.to);

  if (items.length === 0) return null;

  return (
    <nav
      aria-label={t("playBottomNav.mainNavigation")}
      className="sticky top-0 z-30 hidden h-svh w-20 shrink-0 flex-col items-center gap-1 overflow-y-auto border-e border-border bg-white px-2 py-4 lg:flex"
    >
      {items.map((item, i) => {
        const isActive = isNavRouteActive(currentRoute, item.to, navRoutes);
        const Icon = item.icon;

        return (
          <Link
            key={i}
            to={item.to || "/"}
            className="group flex min-h-12 w-full flex-col items-center justify-center gap-1 py-1.5 transition-all duration-150"
          >
            <div
              className={cn(
                "flex h-11 w-12 items-center justify-center rounded-xl transition-all duration-150",
                isActive
                  ? isCleanerPlay
                    ? "bg-primary/10 text-primary"
                    : "bg-play-success-soft text-play-success-soft-ink group-active:translate-y-0.5"
                  : "text-muted-foreground group-hover:bg-muted"
              )}
            >
              {Icon &&
                React.createElement(Icon, {
                  size: 26,
                  weight: isActive ? "fill" : "regular",
                })}
            </div>
            <span
              className={cn(
                "text-2xs font-bold leading-none",
                isActive
                  ? isCleanerPlay
                    ? "text-primary"
                    : "text-play-success-soft-ink"
                  : "text-muted-foreground"
              )}
            >
              {shortLabelFor(item.title, t)}
            </span>
          </Link>
        );
      })}
    </nav>
  );
};
