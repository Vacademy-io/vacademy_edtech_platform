import React from "react";
import { AppleLogo } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

/**
 * "Get it on Google Play" / "Download on the App Store" badges, the app
 * promo's alternative to a single "Get the app" button. Authored as
 * `appLinks: { playStore, appStore }` on the sidebar promo
 * (courseCatalog.filterSidebar.promo) and on the app banner (ctaBanner band
 * with a phone mockup). Only https links count; a store left empty gets no
 * badge, and no link at all keeps the authored button.
 *
 * The badge wording is the stores' own (their badges are English on every
 * site), so it is not run through the site dictionary.
 */

export interface AppStoreLinks {
  playStore: string | null;
  appStore: string | null;
}

const httpsUrl = (value: unknown): string | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
};

/** The authored store links, or null when neither is a usable https URL. */
export const resolveAppStoreLinks = (raw: unknown): AppStoreLinks | null => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const links = raw as Record<string, unknown>;
  const playStore = httpsUrl(links.playStore);
  const appStore = httpsUrl(links.appStore);
  return playStore || appStore ? { playStore, appStore } : null;
};

// Store-badge geometry (black pill, logo + two-line label) — no token scale for these.
const BADGE =
  "flex min-w-[168px] items-center gap-3 rounded-[10px] border border-white/25 bg-black px-4 py-2.5 text-start text-white transition hover:border-white/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"; // design-lint-ignore: store badge 10px radius, black face
const SMALL = "block text-[11px] leading-4"; // design-lint-ignore: store badge caption 11/16
const LARGE = "block text-[18px] font-medium leading-6"; // design-lint-ignore: store badge name 18/24

/** Google Play's four brand colours, as on its official badge (a brand mark, not an icon-set glyph). */
const PLAY_GREEN = "#34A853"; // design-lint-ignore: Google Play brand colour
const PLAY_BLUE = "#4285F4"; // design-lint-ignore: Google Play brand colour
const PLAY_YELLOW = "#FBBC04"; // design-lint-ignore: Google Play brand colour
const PLAY_RED = "#EA4335"; // design-lint-ignore: Google Play brand colour

/** The coloured Google Play triangle. */
const GooglePlayMark: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M3.6 2.2 13.4 12 3.6 21.8c-.4-.3-.6-.8-.6-1.3V3.5c0-.5.2-1 .6-1.3Z" fill={PLAY_GREEN} />
    <path d="M3.6 2.2c.5-.4 1.2-.4 1.8-.1l11.3 6.5-3.3 3.4L3.6 2.2Z" fill={PLAY_BLUE} />
    <path d="M3.6 21.8 13.4 12l3.3 3.4-11.3 6.5c-.6.3-1.3.3-1.8-.1Z" fill={PLAY_YELLOW} />
    <path d="m16.7 8.6 3.6 2.1c1 .6 1 2 0 2.6l-3.6 2.1-3.3-3.4 3.3-3.4Z" fill={PLAY_RED} />
  </svg>
);

const Badge: React.FC<{ href: string; caption: string; name: string; icon: React.ReactNode; className?: string }> = ({
  href,
  caption,
  name,
  icon,
  className,
}) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    aria-label={`${caption} ${name}`}
    className={cn(BADGE, className)}
    data-app-store-badge=""
  >
    <span aria-hidden="true" className="shrink-0">
      {icon}
    </span>
    <span aria-hidden="true">
      <span className={SMALL}>{caption}</span>
      <span className={LARGE}>{name}</span>
    </span>
  </a>
);

export const AppStoreBadges: React.FC<{
  links: AppStoreLinks;
  /** Full-width, one under the other (the narrow sidebar card). */
  stacked?: boolean;
  className?: string;
}> = ({ links, stacked = false, className }) => (
  <div className={cn("flex gap-3", stacked ? "w-full flex-col" : "flex-wrap", className)}>
    {links.playStore && (
      <Badge
        href={links.playStore}
        caption="GET IT ON"
        name="Google Play"
        icon={<GooglePlayMark size={28} />}
        className={stacked ? "w-full" : undefined}
      />
    )}
    {links.appStore && (
      <Badge
        href={links.appStore}
        caption="Download on the"
        name="App Store"
        icon={<AppleLogo size={26} weight="fill" />}
        className={stacked ? "w-full" : undefined}
      />
    )}
  </div>
);
