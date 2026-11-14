import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Capacitor } from "@capacitor/core";
import { X, DeviceMobile } from "@phosphor-icons/react";
import { MyButton } from "@/components/design-system/button";
import {
  getCurrentDomainInfo,
  resolveDomainRouting,
} from "@/services/domain-routing";
import { getPublicUrlWithoutLogin } from "@/services/upload_file";
import { cn } from "@/lib/utils";

/**
 * "Get the <Institute> app" banner.
 *
 * Why this exists: on a white-labelled domain the browser's own PWA prompt used
 * to read "Install Vacademy" (see functions/_middleware.ts — the manifest is now
 * per-institute). But an institute that ships a real native app does not want a
 * PWA at all; it wants its learners in its own store listing. The manifest's
 * `prefer_related_applications` stops Chrome from offering the PWA, and this
 * banner is what takes its place.
 *
 * Web browsers only — inside the native app (or Electron) there is nothing to
 * install, and an already-installed PWA is left alone.
 */

const DISMISS_KEY = "GetAppBannerDismissedAt";
const DISMISS_FOR_DAYS = 14;

type MobileOs = "android" | "ios" | null;

const detectMobileOs = (): MobileOs => {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent || "";
  if (/android/i.test(ua)) return "android";
  // iPadOS 13+ reports as a Mac, so touch points are the only reliable tell.
  if (
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  ) {
    return "ios";
  }
  return null;
};

const isAlreadyInstalled = (): boolean => {
  try {
    if (window.matchMedia?.("(display-mode: standalone)")?.matches) return true;
    // iOS Safari's non-standard flag for home-screen launches.
    return (
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    );
  } catch {
    return false;
  }
};

const isDismissed = (): boolean => {
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const at = Number(raw);
    if (!Number.isFinite(at)) return false;
    return Date.now() - at < DISMISS_FOR_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
};

const nonEmpty = (value?: string | null): string =>
  typeof value === "string" && value.trim() ? value.trim() : "";

interface AppSuggestion {
  storeUrl: string;
  instituteName: string;
  logoUrl: string;
  os: Exclude<MobileOs, null>;
}

export function GetAppBanner() {
  const { t } = useTranslation("layoutCommonA");
  const [suggestion, setSuggestion] = useState<AppSuggestion | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // Nothing to suggest inside the native app / Electron shell.
    if (Capacitor.getPlatform() !== "web") return;

    const os = detectMobileOs();
    if (!os || isAlreadyInstalled() || isDismissed()) return;

    (async () => {
      try {
        const { domain, subdomain } = await getCurrentDomainInfo();
        const branding = await resolveDomainRouting(domain, subdomain || "*");
        if (cancelled || !branding) return;

        const storeUrl =
          os === "android"
            ? nonEmpty(branding.playStoreAppLink)
            : nonEmpty(branding.appStoreAppLink);
        // No listing for this OS — stay quiet and let the (now correctly
        // branded) PWA prompt do its thing.
        if (!storeUrl) return;

        let logoUrl = "";
        try {
          logoUrl = await getPublicUrlWithoutLogin(
            nonEmpty(branding.tabIconFileId) ||
              nonEmpty(branding.instituteLogoFileId)
          );
        } catch {
          // Icon is decorative; the banner is still useful without it.
        }
        if (cancelled) return;

        setSuggestion({
          storeUrl,
          instituteName:
            nonEmpty(branding.tabText) || nonEmpty(branding.instituteName),
          logoUrl,
          os,
        });
      } catch {
        // Never let a branding lookup break the page.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Belt and braces alongside the manifest's `prefer_related_applications`:
  // if the institute has a real app, never let Chrome's PWA mini-infobar
  // compete with it.
  useEffect(() => {
    if (!suggestion) return;
    const block = (event: Event) => event.preventDefault();
    window.addEventListener("beforeinstallprompt", block);
    return () => window.removeEventListener("beforeinstallprompt", block);
  }, [suggestion]);

  if (!suggestion || hidden) return null;

  const dismiss = () => {
    setHidden(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // Session-only dismissal is an acceptable fallback.
    }
  };

  const appLabel = suggestion.instituteName
    ? t("getAppBanner.appLabelWithName", { name: suggestion.instituteName })
    : t("getAppBanner.appLabelGeneric");

  return (
    <div
      className={cn(
        "fixed inset-x-0 top-0 z-50 flex items-center gap-3 border-b border-neutral-200",
        "bg-white px-3 py-2 shadow-sm"
      )}
      role="region"
      aria-label={t("getAppBanner.getRegionLabel", { appLabel })}
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label={t("getAppBanner.dismiss")}
        className="shrink-0 rounded-full p-1 text-neutral-500 hover:bg-neutral-100"
      >
        <X size={16} />
      </button>

      {suggestion.logoUrl ? (
        <img
          src={suggestion.logoUrl}
          alt=""
          className="size-10 shrink-0 rounded-xl object-contain"
        />
      ) : (
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-500">
          <DeviceMobile size={20} />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate text-body font-semibold text-neutral-700">
          {appLabel}
        </p>
        <p className="truncate text-caption text-neutral-500">
          {suggestion.os === "android"
            ? t("getAppBanner.googlePlay")
            : t("getAppBanner.appStore")}
        </p>
      </div>

      <MyButton
        buttonType="primary"
        scale="small"
        onClick={() => window.open(suggestion.storeUrl, "_blank", "noopener")}
      >
        {t("getAppBanner.getButton")}
      </MyButton>
    </div>
  );
}

export default GetAppBanner;
