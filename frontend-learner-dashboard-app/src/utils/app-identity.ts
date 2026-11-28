import { Capacitor } from "@capacitor/core";
import { flavorConfig } from "../../flavor.config";
import { getPlatformFlavorInfo } from "./platform-flavor";

/**
 * The developer account every white-label app is published under. Google Play
 * and the App Store both reject a privacy policy that does not name the
 * developer / legal entity exactly as it appears on the store listing, so this
 * must stay byte-identical to the Play Console / App Store Connect account name.
 */
export const APP_PUBLISHER = {
  name: "Vidyayatan Technologies LLP",
  addressLines: [
    "Pragati Parisar, A 15, Depot Square Rd, Barkhedi Kalan",
    "North TT Nagar, Bhopal, Madhya Pradesh 462003",
    "India",
  ],
  email: "support@vacademy.io",
  website: "https://www.vacademy.io",
} as const;

/** ISO date of the last substantive edit to the privacy policy copy. */
export const PRIVACY_POLICY_LAST_UPDATED = "2026-09-15";

export interface AppIdentity {
  /** Store-facing app name from flavor.config.ts; null when nothing matched. */
  appName: string | null;
  /** Every Android applicationId / iOS bundle id registered for this brand. */
  appIds: string[];
  /** Brand portal host the ids point at, e.g. learner.soullifee.com. */
  host: string | null;
  domain: string | null;
  subdomain: string | null;
}

const EMPTY_IDENTITY: AppIdentity = {
  appName: null,
  appIds: [],
  host: null,
  domain: null,
  subdomain: null,
};

const hostOf = (c: { domain: string; subdomain: string }) =>
  c.subdomain ? `${c.subdomain}.${c.domain}` : c.domain;

// "The 7Cs" and "the7cs" are the same brand — compare names loosely.
const brandKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Work out which brand a privacy page is being shown for.
 *
 * `appId` wins (explicit `?app=` or the native bundle id); otherwise the current
 * hostname is matched against each flavour's portal host. The matched entry is
 * then widened to every id sharing its app name, because one brand's iOS and
 * Android flavours can legitimately point at different hosts (Shiksha Nation) and
 * the policy has to list all of them.
 */
export function resolveAppIdentity(opts: {
  hostname?: string | null;
  appId?: string | null;
}): AppIdentity {
  const entries = Object.entries(flavorConfig);

  let seed = opts.appId && flavorConfig[opts.appId]
    ? entries.filter(([id]) => id === opts.appId)
    : [];
  if (seed.length === 0 && opts.hostname) {
    const wanted = opts.hostname.trim().toLowerCase();
    seed = entries.filter(([, c]) => hostOf(c).toLowerCase() === wanted);
  }
  if (seed.length === 0) return EMPTY_IDENTITY;

  const brands = new Set(seed.map(([, c]) => brandKey(c.appName)));
  const family = entries.filter(([, c]) => brands.has(brandKey(c.appName)));
  const primary = seed[0][1];

  return {
    appName: primary.appName,
    appIds: family.map(([id]) => id),
    host: hostOf(primary),
    domain: primary.domain,
    subdomain: primary.subdomain || null,
  };
}

/**
 * Identity for the running context: an explicit override first, then the native
 * bundle id (inside the app `window.location.hostname` is just `localhost`),
 * then the web hostname.
 */
export async function resolveCurrentAppIdentity(
  appIdOverride?: string | null,
): Promise<AppIdentity> {
  if (appIdOverride) {
    const forced = resolveAppIdentity({ appId: appIdOverride });
    if (forced.appName) return forced;
  }
  if (Capacitor.isNativePlatform()) {
    const info = await getPlatformFlavorInfo();
    if (info.appId) {
      const native = resolveAppIdentity({ appId: info.appId });
      if (native.appName) return native;
    }
  }
  return resolveAppIdentity({ hostname: window.location.hostname });
}

/**
 * True when an institute's configured privacy URL is this very page — used so a
 * portal that points its `privacy_policy_url` at its own /privacy-policy does not
 * redirect to itself forever. Native webviews live on `localhost`, so there only
 * the path is compared.
 */
export function urlPointsAtCurrentPage(url: string): boolean {
  try {
    const target = new URL(url, window.location.href);
    const trim = (p: string) => p.replace(/\/+$/, "") || "/";
    const samePath = trim(target.pathname) === trim(window.location.pathname);
    const sameHost =
      target.host === window.location.host || Capacitor.isNativePlatform();
    return samePath && sameHost;
  } catch {
    return false;
  }
}
