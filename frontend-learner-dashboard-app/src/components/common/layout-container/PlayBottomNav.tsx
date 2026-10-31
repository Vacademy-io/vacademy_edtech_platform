import React, { useEffect, useMemo, useState } from "react";
import { isNavRouteActive } from "./sidebar/active-route";
import { Link, useRouter } from "@tanstack/react-router";
import { DotsThree, type IconProps } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { cn } from "@/lib/utils";
import { getStudentDisplaySettings } from "@/services/student-display-settings";
import type { SidebarItemsType } from "@/types/layout-container-types";
import type { StudentSidebarTabConfig } from "@/types/student-display-settings";
import { usePlayTheme } from "@/hooks/use-play-theme";
import { STUDENT_NAV_ICONS } from "@/constants/student-nav-icons";
import {
  arrangeBottomBar,
  isExternalNavRoute,
  normalizeNavRoute,
} from "@/lib/student-layout";
import type {
  StudentBottomBarItem,
  StudentBottomBarStyle,
} from "@/types/student-display-settings";
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

type BottomNavItem = SidebarItemsType & {
  /** Full https:// URL — opens in a new tab instead of routing in-app. */
  external?: boolean;
  /** Admin-typed label: shown as typed (truncated by CSS), not shortened. */
  fullLabel?: boolean;
  /** The big raised button in the middle of the bar. */
  highlight?: boolean;
};

function createLibraryIcon(key: string) {
  const PhIcon = STUDENT_NAV_ICONS[key]!;
  return function LibraryIcon(props: IconProps) {
    return <PhIcon {...props} />;
  };
}

function createImageIcon(src: string) {
  return function ImageIcon({ size = 20, className = "" }: IconProps) {
    return (
      <img
        src={src}
        alt=""
        className={cn("object-contain", className)}
        style={{ width: size, height: size }} // design-lint-ignore: icon size follows the nav's size prop
      />
    );
  };
}

/** Footer-bar tabs the institute configured (Student Display → Layout). */
function configuredNavItems(
  items: StudentBottomBarItem[],
  t: TFunction
): BottomNavItem[] {
  return items.map((item) => {
    // Built-in tabs seeded from the sidebar carry no typed label — use the
    // same translated name (and short form) the sidebar-mirroring bar shows.
    const typed = item.label?.trim();
    const labelKey = item.id === "dashboard" ? "common.home" : LABEL_KEYS[item.id];
    const label = typed || (labelKey ? t(labelKey) : item.id);
    const icon = item.iconUrl
      ? createImageIcon(item.iconUrl)
      : item.icon && STUDENT_NAV_ICONS[item.icon]
        ? createLibraryIcon(item.icon)
        : ICON_MAP[item.id] ||
          createLetterIcon(label.charAt(0).toUpperCase());
    const to = normalizeNavRoute(item.route);
    return {
      id: item.id,
      icon,
      title: label,
      to,
      external: isExternalNavRoute(to),
      fullLabel: !!typed,
      highlight: !!item.highlight,
    };
  });
}

function NavEntry({
  item,
  className,
  children,
}: {
  item: BottomNavItem;
  className: string;
  children: React.ReactNode;
}) {
  if (item.external) {
    return (
      <a href={item.to} target="_blank" rel="noopener noreferrer" className={className}>
        {children}
      </a>
    );
  }
  return (
    <Link to={item.to || "/"} className={className}>
      {children}
    </Link>
  );
}

function shortLabelFor(title: string, t: TFunction): string {
  const key = SHORT_LABEL_KEYS[title];
  return key ? t(key) : title.length > 6 ? title.slice(0, 5) + "…" : title;
}

interface PlayBottomNavProps {
  /** Keep the bar on tablet / desktop (the institute's layout put it there). */
  showOnLargeScreens?: boolean;
  /** Institute-configured tabs; null = mirror the sidebar (today's behaviour). */
  items?: StudentBottomBarItem[] | null;
  maxVisible?: number;
  showLabels?: boolean;
  /** "floating": a rounded bar above the bottom edge. Default "classic". */
  barStyle?: StudentBottomBarStyle;
}

export const PlayBottomNav: React.FC<PlayBottomNavProps> = ({
  showOnLargeScreens = false,
  items: configured = null,
  maxVisible = MAX_VISIBLE,
  showLabels = true,
  barStyle = "classic",
}) => {
  const { t } = useTranslation("layoutCommonA");
  const sidebarItems = usePlayNavItems();
  const configuredItems = useMemo(
    () => (configured?.length ? configuredNavItems(configured, t) : null),
    [configured, t]
  );
  const items: BottomNavItem[] = configuredItems ?? sidebarItems;
  const router = useRouter();
  const isPlay = usePlayTheme();
  // Play keeps its own green/gold press grammar; every other skin (Cleaner
  // Play, and default / vibrant / corporate once a layout puts the bar
  // there) uses the brand primary, since the play-* tokens exist only under
  // .ui-play.
  const primaryTone = !isPlay;
  const currentRoute = router.state.location.pathname;
  // Every entry is a direct link here (no sub-item rows), so all compete.
  const navRoutes = items.filter((item) => !item.external).map((item) => item.to);

  if (items.length === 0) return null;

  const { visible: visibleItems, overflow: overflowItems } = arrangeBottomBar(
    items,
    maxVisible
  );
  const hasOverflow = overflowItems.length > 0;
  const floating = barStyle === "floating";

  return (
    <nav
      className={cn(
        "fixed z-50",
        floating
          ? "inset-x-3 mx-auto max-w-md rounded-3xl border border-border bg-white/95 px-1 shadow-xl backdrop-blur-md"
          : "bottom-0 start-0 end-0 bg-white border-t border-border",
        !showOnLargeScreens && "md:hidden"
      )}
      style={
        floating
          ? { bottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" } // design-lint-ignore: safe-area offset
          : { // design-lint-ignore: dynamic safe-area inset padding
              paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 4px)",
              boxShadow: "0 -2px 8px rgba(0,0,0,0.04)",
            }
      }
    >
      <div className={cn("flex items-stretch justify-around px-1", floating ? "py-1" : "pt-1")}>
        {visibleItems.map((item, i) => {
          const isActive =
            !item.external && isNavRouteActive(currentRoute, item.to, navRoutes);
          const Icon = item.icon;
          const shortLabel = item.fullLabel ? item.title : shortLabelFor(item.title, t);

          if (item.highlight) {
            // The big center action (e.g. Live Class): a raised brand-colour
            // disc that sits above the bar, label underneath.
            return (
              <NavEntry
                key={i}
                item={item}
                className="group relative flex min-w-0 flex-1 flex-col items-center justify-end gap-1 pb-1.5"
              >
                <span
                  className={cn(
                    "-mt-8 flex size-16 items-center justify-center rounded-full text-white shadow-lg ring-4 ring-white transition-transform duration-150 group-active:scale-95",
                    // Play: the same chunky green press-button as its START CTA;
                    // other skins: the institute's brand colour.
                    primaryTone
                      ? "bg-gradient-to-br from-primary-400 to-primary-500"
                      : "border-b-4 border-play-success-deep bg-play-success",
                    isActive && "scale-105"
                  )}
                >
                  {Icon && React.createElement(Icon, { size: 30, weight: "fill" })}
                </span>
                {showLabels && (
                  <span
                    className={cn(
                      "max-w-full truncate px-0.5 text-2xs font-bold leading-none",
                      primaryTone ? "text-primary-500" : "text-play-success-soft-ink"
                    )}
                  >
                    {shortLabel}
                  </span>
                )}
              </NavEntry>
            );
          }

          return (
            <NavEntry
              key={i}
              item={item}
              className="group flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-1.5 transition-all duration-150"
            >
              <div
                className={cn(
                  "flex h-10 w-12 items-center justify-center rounded-xl transition-all duration-150",
                  isActive
                    ? primaryTone
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
              {showLabels && (
                <span
                  className={cn(
                    "text-2xs font-bold leading-none",
                    item.fullLabel && "max-w-full truncate px-0.5",
                    isActive
                      ? primaryTone
                        ? "text-primary"
                        : "text-play-success-soft-ink"
                      : "text-muted-foreground"
                  )}
                >
                  {shortLabel}
                </span>
              )}
            </NavEntry>
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
                {showLabels && (
                  <span className="text-2xs font-bold leading-none text-muted-foreground">
                    {t("playBottomNav.more")}
                  </span>
                )}
              </button>
            </SheetTrigger>
            <SheetContent side="bottom" className="rounded-t-3xl pb-safe">
              <SheetHeader>
                <SheetTitle className="text-sm font-bold">{t("playBottomNav.more")}</SheetTitle>
              </SheetHeader>
              <div className="grid grid-cols-3 gap-3 py-4">
                {overflowItems.map((item, i) => {
                  const Icon = item.icon;
                  const isActive =
                    !item.external && isNavRouteActive(currentRoute, item.to, navRoutes);
                  return (
                    <NavEntry
                      key={i}
                      item={item}
                      className={cn(
                        "group flex min-h-12 flex-col items-center gap-2 rounded-xl p-4 transition-all",
                        isActive
                          ? primaryTone
                            ? "bg-primary/5"
                            : "bg-play-gold-soft"
                          : "hover:bg-muted"
                      )}
                    >
                      <div
                        className={cn(
                          "flex size-12 items-center justify-center rounded-xl",
                          isActive
                            ? primaryTone
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
                            ? primaryTone
                              ? "text-primary"
                              : "text-play-ink"
                            : "text-muted-foreground"
                        )}
                      >
                        {item.title}
                      </span>
                    </NavEntry>
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
interface PlayNavRailProps {
  /**
   * Institute-configured tabs (the footer-bar tabs) when the layout puts a
   * rail on this screen size; null = the play skins' own rail over the
   * sidebar tabs (today's behaviour).
   */
  items?: StudentBottomBarItem[] | null;
  /** Rendered because the institute's layout asked for it: show from md up. */
  forced?: boolean;
  showLabels?: boolean;
}

export const PlayNavRail: React.FC<PlayNavRailProps> = ({
  items: configured = null,
  forced = false,
  showLabels = true,
}) => {
  const { t } = useTranslation("layoutCommonA");
  const sidebarItems = usePlayNavItems();
  const configuredItems = useMemo(
    () => (configured?.length ? configuredNavItems(configured, t) : null),
    [configured, t]
  );
  const items: BottomNavItem[] = configuredItems ?? sidebarItems;
  const router = useRouter();
  // Same tone rule as the bottom bar: play-* tokens only exist under .ui-play.
  const primaryTone = !usePlayTheme();
  const currentRoute = router.state.location.pathname;
  // Every entry is a direct link here (no sub-item rows), so all compete.
  const navRoutes = items.filter((item) => !item.external).map((item) => item.to);

  if (items.length === 0) return null;

  return (
    <nav
      aria-label={t("playBottomNav.mainNavigation")}
      className={cn(
        "sticky top-0 z-30 hidden h-svh w-20 shrink-0 flex-col items-center gap-1 overflow-y-auto border-e border-border bg-white px-2 py-4",
        forced ? "md:flex" : "lg:flex"
      )}
    >
      {items.map((item, i) => {
        const isActive =
          !item.external && isNavRouteActive(currentRoute, item.to, navRoutes);
        const Icon = item.icon;
        const label = item.fullLabel ? item.title : shortLabelFor(item.title, t);

        if (item.highlight) {
          // The rail's big action: a filled brand / play-green tile.
          return (
            <NavEntry
              key={i}
              item={item}
              className="group my-1 flex w-full flex-col items-center justify-center gap-1 py-1"
            >
              <div
                className={cn(
                  "flex size-14 items-center justify-center rounded-2xl text-white shadow-md transition-transform duration-150 group-active:scale-95",
                  primaryTone
                    ? "bg-gradient-to-br from-primary-400 to-primary-500"
                    : "border-b-4 border-play-success-deep bg-play-success"
                )}
              >
                {Icon && React.createElement(Icon, { size: 28, weight: "fill" })}
              </div>
              {showLabels && (
                <span
                  className={cn(
                    "max-w-full truncate text-2xs font-bold leading-none",
                    primaryTone ? "text-primary-500" : "text-play-success-soft-ink"
                  )}
                >
                  {label}
                </span>
              )}
            </NavEntry>
          );
        }

        return (
          <NavEntry
            key={i}
            item={item}
            className="group flex min-h-12 w-full flex-col items-center justify-center gap-1 py-1.5 transition-all duration-150"
          >
            <div
              className={cn(
                "flex h-11 w-12 items-center justify-center rounded-xl transition-all duration-150",
                isActive
                  ? primaryTone
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
            {showLabels && (
              <span
                className={cn(
                  "max-w-full truncate text-2xs font-bold leading-none",
                  isActive
                    ? primaryTone
                      ? "text-primary"
                      : "text-play-success-soft-ink"
                    : "text-muted-foreground"
                )}
              >
                {label}
              </span>
            )}
          </NavEntry>
        );
      })}
    </nav>
  );
};
