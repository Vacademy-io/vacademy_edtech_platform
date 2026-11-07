import type {
  StudentBottomBarItem,
  StudentBottomBarStyle,
  StudentLayoutDevice,
  StudentLayoutSettings,
  StudentNavPlacement,
} from "@/types/student-display-settings";

/**
 * Resolves STUDENT_DISPLAY_SETTINGS.layout into concrete render decisions.
 *
 * Contract: an absent setting reproduces today's behaviour exactly — sidebar
 * on every screen, the bottom tab bar on phones for the Play / Cleaner Play
 * skins only, every header item shown, no wallpaper.
 */

// Last layout read, shared by every LayoutContainer: each route mounts its own
// container, and starting each from "no layout" would flash the sidebar for a
// frame on every navigation. Reset with the settings cache (logout / institute
// switch) so one institute's layout never shows for another.
let lastStudentLayout: StudentLayoutSettings | null = null;
export const getLastStudentLayout = () => lastStudentLayout;
export const setLastStudentLayout = (layout: StudentLayoutSettings | null) => {
  lastStudentLayout = layout;
};

export const MOBILE_MAX_WIDTH = 767;
export const TABLET_MAX_WIDTH = 1023;

export function deviceForWidth(width: number): StudentLayoutDevice {
  if (width <= MOBILE_MAX_WIDTH) return "mobile";
  if (width <= TABLET_MAX_WIDTH) return "tablet";
  return "desktop";
}

const PLACEMENTS: readonly StudentNavPlacement[] = [
  "auto",
  "sidebar",
  "bottomBar",
  "both",
  "rail",
];

export interface ResolvedStudentHeader {
  showLogo: boolean;
  showPageTitle: boolean;
  showBack: boolean;
  showHome: boolean;
  showAchievements: boolean;
  showLanguage: boolean;
  showHelp: boolean;
  showNotifications: boolean;
}

export interface ResolvedStudentWallpaper {
  imageUrl: string;
  overlayColor: string | null;
  /** 0–0.9 */
  overlayOpacity: number;
  dashboardOnly: boolean;
}

export interface ResolvedStudentLayout {
  device: StudentLayoutDevice;
  placement: StudentNavPlacement;
  showBottomBar: boolean;
  hideSidebar: boolean;
  /** Slim left icon rail carrying the footer-bar tabs (replaces the sidebar). */
  showRail: boolean;
  header: ResolvedStudentHeader;
  bottomBar: {
    /** null = mirror the sidebar tabs (today's behaviour). */
    items: StudentBottomBarItem[] | null;
    maxVisible: number;
    showLabels: boolean;
    style: StudentBottomBarStyle;
  };
  wallpaper: ResolvedStudentWallpaper | null;
}

const HEX = /^#[0-9a-f]{6}$/i;

export function resolveStudentLayout(
  layout: StudentLayoutSettings | null | undefined,
  options: { device: StudentLayoutDevice; playSkin: boolean }
): ResolvedStudentLayout {
  const { device, playSkin } = options;
  const raw = layout?.navigation?.[device];
  const picked: StudentNavPlacement =
    raw && PLACEMENTS.includes(raw) ? raw : "auto";
  // A left rail has no room on a phone: it becomes the bottom bar there.
  const placement: StudentNavPlacement =
    picked === "rail" && device === "mobile" ? "bottomBar" : picked;

  const showBottomBar =
    placement === "auto"
      ? playSkin && device === "mobile"
      : placement === "bottomBar" || placement === "both";
  const showRail = placement === "rail";
  const hideSidebar = placement === "bottomBar" || showRail;

  const h = layout?.header ?? {};
  const header: ResolvedStudentHeader = {
    showLogo: h.showLogo !== false,
    showPageTitle: h.showPageTitle !== false,
    // Back and Home have their own switches; layouts saved with the older
    // single Back & Home switch keep it for whichever one is not set.
    showBack: typeof h.showBack === "boolean" ? h.showBack : h.showBackHome !== false,
    showHome: typeof h.showHome === "boolean" ? h.showHome : h.showBackHome !== false,
    showAchievements: h.showAchievements !== false,
    showLanguage: h.showLanguage !== false,
    showHelp: h.showHelp !== false,
    showNotifications: h.showNotifications !== false,
  };

  const bb = layout?.bottomBar ?? {};
  let highlightTaken = false;
  const items = (bb.items ?? [])
    .filter((i) => i && i.visible !== false && typeof i.route === "string" && i.route.trim())
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    // At most one big center button: the first highlighted tab wins.
    .map((i) => {
      if (!i.highlight) return i;
      if (highlightTaken) return { ...i, highlight: false };
      highlightTaken = true;
      return i;
    });
  const maxVisible =
    typeof bb.maxVisible === "number" && bb.maxVisible >= 3 && bb.maxVisible <= 5
      ? Math.floor(bb.maxVisible)
      : 4;

  const w = layout?.wallpaper;
  const imageUrl =
    (device === "mobile" && w?.mobileImageUrl?.trim()) || w?.imageUrl?.trim() || "";
  const wallpaper: ResolvedStudentWallpaper | null =
    w?.enabled && imageUrl
      ? {
          imageUrl,
          // A strength with no colour picked means the colour input's own
          // default (black) — otherwise the slider would silently do nothing.
          overlayColor:
            w.overlayColor && HEX.test(w.overlayColor)
              ? w.overlayColor
              : Number(w.overlayOpacity) > 0
                ? "#000000"
                : null,
          overlayOpacity: Math.min(90, Math.max(0, Number(w.overlayOpacity) || 0)) / 100,
          dashboardOnly: w.scope === "dashboard",
        }
      : null;

  return {
    device,
    placement,
    showBottomBar,
    hideSidebar,
    showRail,
    header,
    bottomBar: {
      items: items.length ? items : null,
      maxVisible,
      showLabels: bb.showLabels !== false,
      style: bb.style === "floating" ? "floating" : "classic",
    },
    wallpaper,
  };
}

/**
 * Split bar tabs into what shows and what goes under "More". The big center
 * button always shows and sits in the middle of the shown tabs, whatever its
 * position in the list; it counts toward maxVisible.
 */
export function arrangeBottomBar<T extends { highlight?: boolean }>(
  items: T[],
  maxVisible: number
): { visible: T[]; overflow: T[] } {
  const center = items.find((i) => i.highlight);
  if (!center) {
    return { visible: items.slice(0, maxVisible), overflow: items.slice(maxVisible) };
  }
  const rest = items.filter((i) => i !== center);
  const side = rest.slice(0, Math.max(0, maxVisible - 1));
  const overflow = rest.slice(side.length);
  const mid = Math.ceil(side.length / 2);
  return { visible: [...side.slice(0, mid), center, ...side.slice(mid)], overflow };
}

/** External links open in a new tab; everything else is an in-app route. */
export function isExternalNavRoute(route: string): boolean {
  return /^https?:\/\//i.test(route.trim());
}

/**
 * Tidy an admin-typed tab target: "www.x.com" is a website, and an in-app
 * page always starts with "/" (a bare "study-library" would otherwise resolve
 * relative to the current page).
 */
export function normalizeNavRoute(route: string): string {
  const r = route.trim();
  if (isExternalNavRoute(r)) return r;
  if (/^www\./i.test(r)) return `https://${r}`;
  return r.startsWith("/") ? r : `/${r}`;
}
