import { create } from "zustand";
import { sideBarStateType } from "../../../../types/layout-container-types";
import { Preferences } from "@capacitor/preferences";
import { getPublicUrl } from "@/services/upload_file";
import { getCachedInstituteBranding } from "@/services/domain-routing";
import { isAppleStoreBuild } from "@/utils/ios-iap-compliance";

interface StoreState {
  sideBarState: sideBarStateType;
  sideBarOpen: boolean;
  instituteName: string;
  instituteLogoFileUrl: string;
  homeIconClickRoute: string | null;
  playStoreAppLink: string | null;
  appStoreAppLink: string | null;
  windowsAppLink: string | null;
  macAppLink: string | null;
  learnerPortalUrl: string | null;
  instructorPortalUrl: string | null;
  hasCustomSidebar: boolean;
  // Sub-org branding (from student_sub_org junction)
  subOrgName: string | null;
  subOrgLogoUrl: string | null;
  // White-label display overrides. Null / false = default behavior.
  hideInstituteName: boolean;
  logoWidthPx: number | null;
  logoHeightPx: number | null;
  stackNameBelowLogo: boolean;
  setSidebarOpen: () => void;
  setSideBarState: (sidebarstate: sideBarStateType) => void;
  setInstituteDetails: (
    instituteName?: string,
    instituteLogoFileUrl?: string,
    homeIconClickRoute?: string | null
  ) => void;
  setBrandingDisplayOverrides: (overrides: {
    hideInstituteName?: boolean | null;
    logoWidthPx?: number | null;
    logoHeightPx?: number | null;
    stackNameBelowLogo?: boolean | null;
  }) => void;
  setHasCustomSidebar: (value: boolean) => void;
  /**
   * Push the app/portal links straight from a domain-routing response.
   *
   * setInstituteDetails reads them out of the InstituteDetails cache, but it is
   * driven by the navbar's institute-details query — a separate request that can
   * land BEFORE use-domain-routing has written the cache, and whose effect does
   * not re-run afterwards. Without this the footer would appear or not depending
   * on which request won the race. Accepts the resolve response as-is; the keys
   * are the same camelCase ones the cache holds.
   */
  setAppLinks: (details: Record<string, unknown> | null) => void;
}

const readBrandingOverridesFromCache = () => {
  try {
    const branding = getCachedInstituteBranding();
    return {
      hideInstituteName: branding?.hideInstituteName === true,
      logoWidthPx:
        typeof branding?.logoWidthPx === "number" ? branding.logoWidthPx : null,
      logoHeightPx:
        typeof branding?.logoHeightPx === "number"
          ? branding.logoHeightPx
          : null,
      stackNameBelowLogo: branding?.stackNameBelowLogo === true,
    };
  } catch {
    return {
      hideInstituteName: false,
      logoWidthPx: null,
      logoHeightPx: null,
      stackNameBelowLogo: false,
    };
  }
};

/**
 * Make a configured link safe to put in an `href`.
 *
 * `institutes.learner_portal_base_url` is stored bare ("learner.example.com"),
 * and an admin filling in the store links on the domain-routing row can paste
 * one the same way. Without a scheme the browser reads the href as a *relative*
 * path, so the link lands on a 404 inside the app instead of the store listing.
 */
const toExternalUrl = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
};

/** True when the URL points at the page the learner is already on. */
const isCurrentHost = (url: string | null): boolean => {
  if (!url || typeof window === "undefined") return false;
  try {
    return (
      new URL(url).host.toLowerCase() === window.location.host.toLowerCase()
    );
  } catch {
    return false;
  }
};

/**
 * App-store and portal links come from the institute's DOMAIN ROUTING row, not
 * from the institute-details API — `use-domain-routing` merge-writes them into
 * the InstituteDetails cache. So the sidebar has to read them back from that
 * cache: they are not among setInstituteDetails' arguments, and its only caller
 * (the learner navbar) always passes a name, which means the explicit branch
 * below is the ONLY one that ever runs. Populating them there is what makes the
 * "Apps & Portals" footer appear at all.
 */
const readAppLinksFromDetails = (details: Record<string, unknown> | null) => {
  const learnerPortalUrl = toExternalUrl(details?.learnerPortalUrl);
  // Apple Guideline 2.3.10: an app on Apple's stores may not show other
  // platforms, so the iOS app and the Mac App Store build drop the Google Play
  // and Windows links. Both "Apps & Portals" and the dashboard's getApp widget
  // read from here, so this one place covers both.
  const appleStore = isAppleStoreBuild();
  return {
    playStoreAppLink: appleStore ? null : toExternalUrl(details?.playStoreAppLink),
    appStoreAppLink: toExternalUrl(details?.appStoreAppLink),
    windowsAppLink: appleStore ? null : toExternalUrl(details?.windowsAppLink),
    macAppLink: toExternalUrl(details?.macAppLink),
    // On the web portal this would just link back to the current page; it earns
    // its place only in the native/desktop shells.
    learnerPortalUrl: isCurrentHost(learnerPortalUrl) ? null : learnerPortalUrl,
    instructorPortalUrl: toExternalUrl(details?.instructorPortalUrl),
  };
};

const useStore = create<StoreState>((set) => ({
  sideBarState: sideBarStateType.DEFAULT,
  sideBarOpen: false,
  instituteName: "",
  instituteLogoFileUrl: "",
  homeIconClickRoute: null,
  playStoreAppLink: null,
  appStoreAppLink: null,
  windowsAppLink: null,
  macAppLink: null,
  learnerPortalUrl: null,
  instructorPortalUrl: null,
  hasCustomSidebar: false,
  subOrgName: null,
  subOrgLogoUrl: null,
  // Initialize from whatever the domain-routing cache has (may be null on
  // first load; the setters below will refresh it).
  ...readBrandingOverridesFromCache(),
  setSidebarOpen: () => set((state) => ({ sideBarOpen: !state.sideBarOpen })),
  setSideBarState: (sidebarstate) => set({ sideBarState: sidebarstate }),
  setHasCustomSidebar: (value: boolean) => set({ hasCustomSidebar: value }),
  setAppLinks: (details) => set(readAppLinksFromDetails(details)),
  setBrandingDisplayOverrides: ({
    hideInstituteName,
    logoWidthPx,
    logoHeightPx,
    stackNameBelowLogo,
  }) =>
    set({
      hideInstituteName: hideInstituteName === true,
      logoWidthPx: typeof logoWidthPx === "number" ? logoWidthPx : null,
      logoHeightPx: typeof logoHeightPx === "number" ? logoHeightPx : null,
      stackNameBelowLogo: stackNameBelowLogo === true,
    }),

  setInstituteDetails: async (
    name?: string,
    logoUrl?: string,
    homeIconClickRoute?: string | null
  ) => {
    try {
      // Always refresh white-label display overrides from the latest cached
      // domain-routing branding so the sidebar picks them up without needing
      // every caller to thread them in explicitly.
      const overrides = readBrandingOverridesFromCache();

      // If explicit values are provided, set them directly
      if (typeof name === 'string') {
        set({
          instituteName: name,
          instituteLogoFileUrl: logoUrl ?? "",
          homeIconClickRoute: homeIconClickRoute ?? null,
          ...overrides,
        });

        // Also resolve the app/portal links and sub-org branding from stored
        // authenticated details.
        try {
          const stored = await Preferences.get({ key: "InstituteDetails" });
          if (stored.value) {
            const details = JSON.parse(stored.value);
            set(readAppLinksFromDetails(details));
            const subOrgs = details?.sub_orgs;
            if (Array.isArray(subOrgs) && subOrgs.length > 0) {
              const activeSubOrg = subOrgs.find((s: any) => s.status === "ACTIVE") || subOrgs[0];
              const subOrgLogoUrl = activeSubOrg.logo_file_id
                ? await getPublicUrl(activeSubOrg.logo_file_id)
                : null;
              set({
                subOrgName: activeSubOrg.name || null,
                subOrgLogoUrl,
              });
            }
          }
        } catch {
          // Sub-org resolution is best-effort
        }
        return;
      }

      // Fallback: fetch from Preferences
      const InstituteDetailsData = await Preferences.get({
        key: "InstituteDetails",
      });

      const InstituteDetails = InstituteDetailsData.value
        ? JSON.parse(InstituteDetailsData.value)
        : null;

      if (InstituteDetails) {
        const url = InstituteDetails.institute_logo_file_id
          ? await getPublicUrl(InstituteDetails.institute_logo_file_id)
          : "";

        // Resolve sub-org branding if learner belongs to one
        const subOrgs = InstituteDetails.sub_orgs;
        let subOrgName: string | null = null;
        let subOrgLogoUrl: string | null = null;
        if (Array.isArray(subOrgs) && subOrgs.length > 0) {
          const activeSubOrg = subOrgs.find((s: any) => s.status === "ACTIVE") || subOrgs[0];
          subOrgName = activeSubOrg.name || null;
          if (activeSubOrg.logo_file_id) {
            subOrgLogoUrl = await getPublicUrl(activeSubOrg.logo_file_id);
          }
        }

        set({
          instituteName: InstituteDetails.institute_name,
          instituteLogoFileUrl: url,
          homeIconClickRoute:
            InstituteDetails.home_icon_click_route ??
            InstituteDetails.homeIconClickRoute ??
            null,
          ...readAppLinksFromDetails(InstituteDetails),
          subOrgName,
          subOrgLogoUrl,
          ...overrides,
        });
      }
    } catch (error) {
      console.error("Error fetching institute details:", error);
    }
  },
}));

export default useStore;
