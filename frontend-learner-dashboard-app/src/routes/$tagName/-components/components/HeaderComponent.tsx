import React from "react";
import { useNavigate, useLocation } from "@tanstack/react-router";
import { useSiteNavigate } from "../../-utils/catalogue-route-search";
import { useTranslation } from "react-i18next";
import { HeaderProps } from "../../-types/course-catalogue-types";
import { useDomainRouting } from "@/hooks/use-domain-routing";
import { getPublicUrlWithoutLogin } from "@/services/upload_file";
import { RouteMatcher } from "../../-services/route-matcher";
import { CourseCatalogueData } from "../../-types/course-catalogue-types";
import { createElement, useState, useEffect, useRef } from "react";
import { MagnifyingGlass, ShoppingCart } from "@phosphor-icons/react";
import { useCartStore } from "../../-stores/cart-store";
import { isIOSPlatform } from "@/hooks/useIsIOS";
import { Capacitor } from "@capacitor/core";
import { getAccessToken, isTokenExpired } from "@/lib/auth/sessionUtility";
import { SystemAlertsBar } from "@/components/announcements";
import { LogoutSidebar } from "@/components/common/layout-container/sidebar/logoutSidebar";
import useStore from "@/components/common/layout-container/sidebar/useSidebar";
import { List } from "@phosphor-icons/react";
import { AuthModal, AuthModalRef } from "@/components/common/auth/modal/AuthModal";
import { getStudentDisplaySettings } from "@/services/student-display-settings";
import type { StudentAuthPresentation } from "@/types/student-display-settings";
import type {
  GlobalSettings,
  HeaderActiveStyle,
  HeaderAuthLink,
  HeaderNavItem,
} from "../../-types/course-catalogue-types";
import { useCatalogueLocale, useSiteT } from "../../-utils/catalogue-locale";
import { isSiteCartEnabled } from "../../-utils/site-cart";
import { courseLanguagesOf } from "../../-utils/course-variants";
import { SiteCartButton } from "../site-cart/SiteCartButton";
import { MegaMenuNavItem } from "../header/MegaMenuNavItem";
import { MobileMegaMenu } from "../header/MobileMegaMenu";
import { HeaderSearch } from "../header/HeaderSearch";
import { HeaderLanguageSwitcher } from "../header/HeaderLanguageSwitcher";
import { DesktopNavDropdown, MobileNavDropdown } from "./header/NavDropdown";
import { dropdownHasActive } from "./header/nav-dropdown";
import {
  DESKTOP_AUTH_CLASSES,
  MOBILE_AUTH_CLASSES,
  desktopAuthVariant,
  desktopNavItemClasses,
  mobileAuthVariant,
} from "../header/header-variants";
import type { HeaderChromeProps } from "../../-types/site-chrome-types";
import {
  EDITORIAL_AUTH_CLASSES,
  EDITORIAL_NAV,
  EDITORIAL_RIGHT_GROUP,
  HEADER_COMPACT_LOGO,
  HEADER_CONTAINED_INNER,
  HEADER_CONTAINED_OUTER,
  editorialNavItemClasses,
  resolveHeaderChrome,
} from "../header/header-chrome";

/** A nav item that opens the streams mega menu; one without a library stays a plain link. */
const isMegaMenuItem = (item: HeaderNavItem | null | undefined): boolean =>
  item?.type === "megaMenu" && !!(item.megaMenu?.libraryId || "").trim();

export const HeaderComponent: React.FC<HeaderProps & {
  /** `enabled: false` hides a link the author kept but does not want live.
   *  Absent means visible, so headers authored before the toggle existed are
   *  unchanged. */
  navigation?: HeaderNavItem[];
  authLinks?: HeaderAuthLink[];
  useAuthModal?: boolean;
  catalogueData?: CourseCatalogueData;
  tagName?: string;
  /** Author-picked surface colour. The editor has always offered this control;
   *  the header ignored it entirely and stayed on the bg-catalogue-bg token, so
   *  "I changed the header background and nothing happened" was the correct
   *  observation — the picker was wired to nothing. */
  backgroundColor?: string;
  textColor?: string;
  /** The authored props before translation (JsonRenderer passes them when the
   *  site is shown in another language). Everything that DECIDES — routes,
   *  "is this the Get Started button", signup filtering — reads these, so a
   *  translated label can never change behaviour. Absent = `navigation` /
   *  `authLinks` above are the authored values. */
  baseProps?: { navigation?: HeaderNavItem[]; authLinks?: HeaderAuthLink[] } & Record<string, unknown>;
  instituteId?: string;
  globalSettings?: GlobalSettings;
  /** How the current page's nav item is marked. Absent = 'pill'. */
  activeStyle?: HeaderActiveStyle;
  /** Site search icon (courses, pages, streams). Absent = no new search. */
  showSearch?: boolean;
  /** हिन्दी | EN switch, when the site has more than one language. */
  showLanguageSwitcher?: boolean;
  /** Editor preview only: the real route of the page shown at the site root
   *  ("" = home), so the right nav item is marked active. */
  previewPath?: string;
  /** Where the logo and site name lead: a page route or URL; "none" = not a
   *  link. Unset = the institute's home-icon route, else the site's home page. */
  logoLink?: string;
} & HeaderChromeProps> = ({
  navigation = [],
  authLinks = [],
  useAuthModal = false,
  catalogueData,
  tagName = "home",
  backgroundColor,
  textColor,
  baseProps,
  instituteId,
  globalSettings,
  activeStyle,
  showSearch,
  showLanguageSwitcher,
  previewPath,
  logoLink,
  barSize,
  contentWidth,
  navStyle,
  logoOnly,
  languageSwitcherStyle,
  cartDisplay,
  megaMenuStyle,
}) => {
    const { t } = useTranslation("coursePlayerB");
    const siteT = useSiteT();
    const siteLocale = useCatalogueLocale();
    const [togle, settogle] = useState(false);
    const navigate = useNavigate();
    const siteNavigate = useSiteNavigate();
    const location = useLocation();
    const domainRouting = useDomainRouting();
    const { getItemCountByMode, items, syncCart } = useCartStore();
    const [cartItemCount, setCartItemCount] = useState(0);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const { setSidebarOpen } = useStore();
    const [currentMode, setCurrentMode] = useState<'buy' | 'rent'>(() => {
      const levelFilter = sessionStorage.getItem('levelFilter') || '';
      return levelFilter.toLowerCase().includes('rent') ? 'rent' : 'buy';
    });
    const [instituteLogoUrl, setInstituteLogoUrl] = useState<string | null>(null);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [mobileMenuRef, setMobileMenuRef] = useState<HTMLDivElement | null>(null);
    const [hamburgerButtonRef, setHamburgerButtonRef] = useState<HTMLButtonElement | null>(null);
    const isIOS = isIOSPlatform();
    const isAndroid = Capacitor.getPlatform() === 'android';

    const loginAuthModalRef = useRef<AuthModalRef | null>(null);
    const signupAuthModalRef = useRef<AuthModalRef | null>(null);

    // Resolved from Student Display Settings on mount. JSON `useAuthModal`
    // remains a per-page override; if either signals "modal", we open in-place.
    const [authPresentation, setAuthPresentation] = useState<StudentAuthPresentation | null>(null);
    const [signupEnabled, setSignupEnabled] = useState<boolean>(true);
    useEffect(() => {
      let cancelled = false;
      (async () => {
        try {
          const settings = await getStudentDisplaySettings();
          if (!cancelled) {
            setAuthPresentation(settings?.signup?.presentation ?? 'page');
            setSignupEnabled(settings?.signup?.enabled ?? true);
          }
        } catch {
          // Network/cache miss — leave defaults (signup visible, page nav).
        }
      })();
      return () => { cancelled = true; };
    }, []);
    const useModalForAuth = authPresentation === 'modal' || useAuthModal;

    const normalizeRoute = (route: string) =>
      (route || '').replace(/^\//, '').toLowerCase();

    // A header auth/CTA button opens the lead-collection ("Get Started") modal when its
    // route points at the lead form. 'get-started' is the canonical route the page editor
    // writes; the other variants keep older / hand-authored configs working. Matched
    // identically on desktop and the mobile menu so a configured button behaves the same.
    const isLeadFormLink = (link: { route?: string; label?: string }) => {
      const r = normalizeRoute(link.route || '');
      return (
        r === 'get-started' ||
        r === 'getstarted' ||
        r === '' ||
        (link.label || '').toLowerCase().includes('get started')
      );
    };

    // Shown items paired with their authored (untranslated) values, by position
    // — translation never adds, drops or reorders items. Logic reads `base`;
    // only labels shown on screen come from `item` / `link`.
    const baseNavigation = Array.isArray(baseProps?.navigation) ? baseProps.navigation : navigation;
    const baseAuthLinks = Array.isArray(baseProps?.authLinks) ? baseProps.authLinks : authLinks;

    // Links the author switched off in the editor never reach the bar, the
    // mobile menu, or the "is there anything to show?" checks that gate them.
    const navEntries = navigation
      .map((item, index) => ({ item, base: baseNavigation[index] ?? item }))
      .filter(({ base }) => base?.enabled !== false);
    const visibleNavigation = navEntries.map(({ item }) => item);

    // The catalogue this header belongs to. The prop is authoritative — the
    // route resolved it — and the first path segment was only ever a fallback
    // for the default "home". On a root-mounted host that segment is a PAGE
    // ("/about"), so reading it as the tag would send every Home click to
    // "/about" and the cart to "/about/cart".
    const effectiveTagName =
      tagName && tagName !== 'home'
        ? tagName
        : (location.pathname.split('/').filter(Boolean)[0] || tagName);

    // Opt-in header features. Each one is off unless its prop (or the site's
    // cart setting) turns it on, so a header authored before them renders
    // exactly as it always has.
    const resolvedInstituteId = instituteId || domainRouting.instituteId || null;
    const resolvedGlobalSettings = globalSettings ?? catalogueData?.globalSettings;
    const megaEntries = navEntries.filter(({ base }) => isMegaMenuItem(base));
    const showSearchButton = showSearch === true;
    const showSwitcher = showLanguageSwitcher === true && siteLocale.enabled && siteLocale.locales.length > 1;
    const showSiteCart = isSiteCartEnabled(resolvedGlobalSettings?.siteCart);
    const hasHeaderExtras = showSearchButton || showSwitcher || showSiteCart;
    // Opt-in looks of the design (site-chrome-types.ts); all off when absent.
    const chrome = resolveHeaderChrome({
      barSize,
      contentWidth,
      navStyle,
      logoOnly,
      languageSwitcherStyle,
      cartDisplay,
      megaMenuStyle,
    });
    const switcherVariant = chrome.segmentedSwitcher ? "segmented" : undefined;
    // The phone menu's nav item look (same strings as its plain items below).
    const mobileItemClass = (active: boolean) =>
      `block w-full text-start px-4 py-2.5 rounded-catalogue-sm text-base font-medium transition-colors duration-200 ${active
        ? 'text-primary-500 bg-primary-50'
        : 'text-catalogue-text-secondary hover:text-catalogue-text-primary hover:bg-catalogue-interactive-hover'
      }`;
    const mobileNavItemClass = mobileItemClass(false);

    // Filter out "Sign Up" auth links when signup is disabled at the institute level.
    const authEntries = authLinks.map((link, index) => ({ link, base: baseAuthLinks[index] ?? link }));
    const visibleAuthEntries = signupEnabled
      ? authEntries
      : authEntries.filter(({ base }) => normalizeRoute(base.route) !== 'signup');
    const visibleAuthLinks = visibleAuthEntries.map(({ link }) => link);

    // With search / language / cart in the bar, the full desktop bar needs more
    // room than md gives: measured with the client's header (5 nav items, two
    // buttons) it overflows up to ~1180px and pushes the buttons off-screen.
    // So with any of them the desktop bar starts at lg and tablets keep the
    // phone bar and menu. Without them every class here is the original md one.
    const bp = hasHeaderExtras
      ? {
          phoneOnly: 'lg:hidden',
          desktopFlex: 'hidden lg:flex',
          // flex-initial, not flex-none: the logo may shrink on desktop too.
          catalogLogo: 'flex-1 lg:flex-initial justify-center lg:justify-start',
        }
      : {
          phoneOnly: 'md:hidden',
          desktopFlex: 'hidden md:flex',
          catalogLogo: 'flex-1 md:flex-none justify-center md:justify-start',
        };
    // The phone menu opens under the bar. In the lg layout it also opens on
    // tablets, where the bar is taller (md:h-20), so its offset follows (as
    // classes). Otherwise, and on the iOS app (status-bar inset), it keeps its
    // original inline top.
    const menuTop: { className: string; style: React.CSSProperties | undefined } =
      hasHeaderExtras && !isIOS
        ? { className: chrome.compact ? ' top-14 md:top-16' : ' top-14 md:top-20', style: undefined }
        : { className: '', style: { top: isIOS ? 'calc(56px + 32px)' : '56px' } }; // design-lint-ignore: original menu offset (iOS status-bar inset)

    // Shared by the desktop bar, the mobile bar and the mobile menu so a
    // configured auth link behaves identically wherever it is tapped. `base`
    // decides what happens; `link` only supplies the popup title on screen.
    const handleAuthLinkClick = (link: HeaderAuthLink, base: HeaderAuthLink = link) => {
      const r = normalizeRoute(base.route);
      if (r === 'login' || r === 'signup') {
        if (useModalForAuth) {
          (r === 'login' ? loginAuthModalRef : signupAuthModalRef).current?.setIsOpen(true);
        } else {
          window.location.href = `/${r}`;
        }
      } else if ((base.audienceId || '').trim()) {
        window.dispatchEvent(new CustomEvent('openAudienceForm', {
          detail: { audienceId: (base.audienceId || '').trim(), title: link.formTitle || link.label },
        }));
      } else if (isLeadFormLink(base)) {
        window.dispatchEvent(new CustomEvent('openLeadCollection'));
      } else {
        handleNavigation(base.route, base.label);
      }
    };

    // Calculate cart item count based on current mode (Buy or Rent)
    useEffect(() => {
      const checkAuth = async () => {
        try {
          const token = await getAccessToken();
          setIsAuthenticated(!!token && !isTokenExpired(token));
        } catch (error) {
          setIsAuthenticated(false);
        }
      };
      checkAuth();

      const updateCartCount = async () => {
        const levelFilter = sessionStorage.getItem('levelFilter') || '';
        const isRentMode = levelFilter.toLowerCase().includes('rent');
        const mode = isRentMode ? 'rent' : 'buy';

        // Update current mode if changed
        if (mode !== currentMode) {
          setCurrentMode(mode);
          // Sync cart when mode changes
          await syncCart();
        }

        // Get count for the current mode from storage (most accurate)
        const count = await getItemCountByMode(mode);
        setCartItemCount(count);
      };

      updateCartCount();

      // Listen for cart changes and levelFilter changes
      const handleStorageChange = (e: StorageEvent) => {
        if (e.key === 'levelFilter' || e.key?.startsWith('cart_items_')) {
          updateCartCount();
        }
      };

      // Listen for custom events
      const handleCartUpdate = () => {
        updateCartCount();
      };

      const handleCartUpdated = () => {
        updateCartCount();
      };

      window.addEventListener('storage', handleStorageChange);
      window.addEventListener('levelFilterChanged', handleCartUpdate);
      window.addEventListener('cartUpdated', handleCartUpdated);
      window.addEventListener('cartSynced', handleCartUpdated);

      // Also check periodically for same-tab changes
      const interval = setInterval(updateCartCount, 500);

      return () => {
        clearInterval(interval);
        window.removeEventListener('storage', handleStorageChange);
        window.removeEventListener('levelFilterChanged', handleCartUpdate);
        window.removeEventListener('cartUpdated', handleCartUpdated);
        window.removeEventListener('cartSynced', handleCartUpdated);
      };
    }, [getItemCountByMode, syncCart, currentMode]);

    // Also update count when items change (reactive to store updates)
    useEffect(() => {
      const updateCountFromStore = async () => {
        const levelFilter = sessionStorage.getItem('levelFilter') || '';
        const isRentMode = levelFilter.toLowerCase().includes('rent');
        const mode = isRentMode ? 'rent' : 'buy';
        const count = await getItemCountByMode(mode);
        setCartItemCount(count);
      };
      updateCountFromStore();
    }, [items, getItemCountByMode]);

    // Check if courseCatalogeType.enabled is true
    const isCourseCatalogeTypeEnabled = !!(catalogueData?.globalSettings?.courseCatalogeType?.enabled);
    // Below sm the language switch moves from the bar into the phone menu
    // (when there is one) so the bar keeps room for the logo and the toggle.
    const hasStandardMenu = visibleNavigation.length > 0 || visibleAuthLinks.length > 0 || isAuthenticated;
    const switcherInMenu = showSwitcher && (isCourseCatalogeTypeEnabled || hasStandardMenu);
    // Where the logo (and the site name beside it) leads. The site's own
    // "Logo click" setting wins ("none" = not a link); else the institute's
    // home-icon route, as before; else the site's home page. Read untranslated
    // (baseProps): it is a route, not text.
    const authoredLogoLink = (() => {
      const raw = (baseProps as { logoLink?: unknown } | undefined)?.logoLink ?? logoLink;
      return typeof raw === "string" ? raw.trim() : "";
    })();
    const logoHref =
      authoredLogoLink.toLowerCase() === "none"
        ? null
        : authoredLogoLink
          ? RouteMatcher.isExternalLink(authoredLogoLink)
            ? authoredLogoLink
            : RouteMatcher.pagePath(effectiveTagName, authoredLogoLink)
          : domainRouting.homeIconClickRoute || RouteMatcher.pagePath(effectiveTagName);
    const handleLogoClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
      // Let the browser open a new tab / window as it would for any link.
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (authoredLogoLink) {
        handleNavigation(authoredLogoLink, "", true);
      } else if (domainRouting.homeIconClickRoute) {
        window.location.href = domainRouting.homeIconClickRoute;
      } else {
        void siteNavigate(RouteMatcher.pagePath(effectiveTagName));
      }
    };

    // Load institute logo
    useEffect(() => {
      const loadInstituteLogo = async () => {
        if (domainRouting.instituteLogoFileId) {
          try {
            const url = await getPublicUrlWithoutLogin(domainRouting.instituteLogoFileId);
            setInstituteLogoUrl(url);
          } catch (error) {
            console.error("Error loading institute logo:", error);
          }
        }
      };

      loadInstituteLogo();
    }, [domainRouting.instituteLogoFileId]);


    // Handle outside click to close mobile menu
    useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
        if (isMobileMenuOpen && mobileMenuRef && !mobileMenuRef.contains(event.target as Node)) {
          // Don't close if clicking on the hamburger button
          if (hamburgerButtonRef && hamburgerButtonRef.contains(event.target as Node)) {
            return;
          }
          setIsMobileMenuOpen(false);
        }
      };

      if (isMobileMenuOpen) {
        document.addEventListener('mousedown', handleClickOutside);
      }

      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }, [isMobileMenuOpen, mobileMenuRef, hamburgerButtonRef]);


    // Helper function to check if a navigation item is active.
    //
    // A catalogue path is always /<tagName>[/<pageRoute>], so the second
    // segment decides the winner and an empty one means the site root, which
    // renders the home page. The previous version keyed off the item's LABEL —
    // "Courses" always owned the root and "Home" was suppressed whenever a
    // Courses item existed — a leftover from when /<tagName> WAS the course
    // listing. On a multi-page site that lit "Courses" up on the home page,
    // and the fallback below it compared a "/tag/about" pathname against a
    // bare "about" route (no leading slash), so no inner page ever matched
    // either: Courses was the only nav item that could ever look active.
    const isActiveRoute = (route: string) => {
      if (RouteMatcher.isExternalLink(route)) return false;
      // "Whatever follows the catalogue base": the segment after "/<tag>", or
      // the first segment when this catalogue is mounted at the host's root.
      // The editor preview shows every page at the root, so it names the page.
      const currentRoute = RouteMatcher.normalizeRoute(
        (previewPath !== undefined
          ? previewPath.split('/').filter(Boolean)[0]
          : RouteMatcher.segmentsAfterBase(location.pathname, effectiveTagName)[0]) || ''
      );
      const target = RouteMatcher.normalizeRoute(route || '');
      const targetIsHome = target === '' || target === 'home';
      // The home page answers to both /<tagName> and /<tagName>/home.
      if (currentRoute === '' || currentRoute === 'home') return targetIsHome;
      return !targetIsHome && currentRoute === target;
    };

    // Helper function to handle navigation
    const handleNavigation = (route: string, _label: string, openInSameTab?: boolean | string) => {
      // Normalize openInSameTab value (handle string "true"/"false", boolean, or undefined)
      const shouldOpenInSameTab = openInSameTab === true || openInSameTab === "true";

      // Check if route is external
      if (RouteMatcher.isExternalLink(route)) {
        console.log(`[HeaderComponent] Opening external link: ${route}, openInSameTab: ${openInSameTab}, shouldOpenInSameTab: ${shouldOpenInSameTab}`);
        if (shouldOpenInSameTab) {
          // Open in same tab
          window.location.href = route;
        } else {
          // Open in new tab (default behavior when openInSameTab is false or undefined)
          window.open(route, '_blank', 'noopener,noreferrer');
        }
        return;
      }

      // If catalogueData is available, try to match the route with pages
      if (catalogueData && catalogueData.pages) {
        const matchedPage = RouteMatcher.findMatchingPage(route, catalogueData.pages);

        if (matchedPage) {
          // Get the proper navigation route for this page
          const navigationRoute = RouteMatcher.getPageNavigationRoute(matchedPage, tagName);
          void siteNavigate(navigationRoute);
          return;
        }
      }

      // Handle special routes (homepage, courses, etc.)
      const normalizedRoute = RouteMatcher.normalizeRoute(route);

      if (normalizedRoute === 'home' || normalizedRoute === '' || route === '/') {
        navigate({ to: RouteMatcher.pagePath(effectiveTagName) });
        return;
      }

      if (normalizedRoute === 'courses') {
        navigate({ to: RouteMatcher.pagePath(effectiveTagName) });
        return;
      }

      // For other routes, check if we're already on the target route
      if (isActiveRoute(route)) {
        return;
      }

      // Navigate to the route as-is (for custom internal routes)
      void siteNavigate(route);
    };

    /**
     * Links inside a "dropdown" nav item. Those are often a sub-address of one
     * of this site's pages ("blog/ssc-cgl" — an article on the blog page),
     * which the loose page match in handleNavigation would collapse to the
     * page itself ("blog".includes), dropping the article. Scoped to dropdown
     * links so every existing nav item keeps resolving exactly as before.
     */
    const handleDropdownNavigation = (route: string, label: string, openInSameTab?: boolean | string) => {
      const subPath = route.trim().replace(/^\/+/, "").replace(/\/+$/, "");
      const firstSegment = subPath.split(/[/?#]/)[0].toLowerCase();
      if (
        !RouteMatcher.isExternalLink(route) &&
        subPath.includes("/") &&
        catalogueData?.pages?.some((page) => RouteMatcher.normalizeRoute(page.route || "") === firstSegment)
      ) {
        void siteNavigate(RouteMatcher.pagePath(effectiveTagName, subPath));
        return;
      }
      handleNavigation(route, label, openInSameTab);
    };



    // Use JSON logo and title from the page builder if configured
    const jsonLogoRaw = catalogueData?.globalSettings?.layout?.header?.props?.logo || null;
    const jsonTitle = catalogueData?.globalSettings?.layout?.header?.props?.title || null;
    // Read raw from the catalogue, so it is translated here, for display only
    // (unchanged on a single-language site).
    const jsonTitleShown = jsonTitle ? siteT(jsonTitle) : null;

    // Resolve jsonLogoRaw — it may be a file ID or a full URL
    const [jsonLogoUrl, setJsonLogoUrl] = useState<string | null>(null);
    useEffect(() => {
      if (!jsonLogoRaw) { setJsonLogoUrl(null); return; }
      // Already a URL — use directly
      if (jsonLogoRaw.startsWith('http://') || jsonLogoRaw.startsWith('https://')) {
        setJsonLogoUrl(jsonLogoRaw);
        return;
      }
      // Looks like a file ID — resolve it
      let cancelled = false;
      getPublicUrlWithoutLogin(jsonLogoRaw).then(url => {
        if (!cancelled && url) setJsonLogoUrl(url);
      }).catch(() => {});
      return () => { cancelled = true; };
    }, [jsonLogoRaw]);

    // Check if we should hide search and cart icons
    const getIconVisibility = () => {
      let hideSearch = false;
      let hideCart = false;

      const currentPath = location.pathname.toLowerCase();
      // Segments after the catalogue base, so "/new/<id>" and a root-mounted
      // "/<id>" both read as a course-details page.
      const afterBase = RouteMatcher.segmentsAfterBase(location.pathname, effectiveTagName);

      // Hide on cart page
      if (currentPath.includes('/cart')) {
        hideSearch = true;
        hideCart = true;
      }

      // Hide on book/course details page (pattern: <base>/$courseId)
      if (afterBase.length >= 1) {
        const potentialCourseId = afterBase[0];
        const isNumeric = /^\d+$/.test(potentialCourseId);
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(potentialCourseId);
        if (isNumeric || isUUID) {
          hideSearch = true;
          hideCart = true;
        }
      }

      // Check if current page has buyRentSection component
      // Hide search but KEEP cart visible on plan page
      if (catalogueData?.pages) {
        const pageRoute = afterBase.join('/') || '';
        for (const page of catalogueData.pages) {
          const pageRouteLower = (page.route || '').toLowerCase();
          const pageIdLower = (page.id || '').toLowerCase();

          const isCurrentPage = pageRouteLower === pageRoute.toLowerCase() ||
            pageIdLower === pageRoute.toLowerCase() ||
            (pageRoute === '' && pageRouteLower === '');

          if (isCurrentPage && page.components) {
            const hasBuyRentSection = page.components.some(
              (component: any) => component.type === 'buyRentSection' && (component.enabled === true || String(component.enabled) === "true")
            );
            if (hasBuyRentSection) {
              hideSearch = true;
            }
          }
        }
      }

      return { hideSearch, hideCart };
    };

    const { hideSearch, hideCart } = getIconVisibility();

    // A mega item whose library is gone acts like the plain items around it.
    const mobileMegaPlainLink = (base: HeaderNavItem) => {
      const sameTab = base.openInSameTab === true || String(base.openInSameTab) === "true";
      return {
        onClick: () => {
          setIsMobileMenuOpen(false);
          handleNavigation(base.route, base.label, sameTab);
        },
        className: mobileItemClass(isActiveRoute(base.route)),
      };
    };

    // Phones: the language switch as the menu's first row (from sm it is in the bar).
    const renderMenuLanguageRow = () => (
      <div className="flex items-center justify-between gap-3 border-b border-catalogue-border-subtle px-4 pb-3 pt-1 sm:hidden">
        <span className="text-sm font-medium text-catalogue-text-secondary">
          {t("header.language.label", "Site language")}
        </span>
        <HeaderLanguageSwitcher authoredLocales={resolvedGlobalSettings?.i18n?.locales} variant={switcherVariant} />
      </div>
    );

    // Consistent header height using design tokens
    const headerHeight = chrome.compact ? 'h-16' : 'h-16 md:h-20';
    const headerTopOffset = isIOS ? 'pt-8' : '';

    return (
      <header
        // Only fall back to the theme token when the author picked nothing —
        // an inline colour must beat the class, so the class is omitted when set.
        className={`fixed top-0 start-0 end-0 z-catalogue-fixed border-b ${chrome.editorialNav ? 'border-palette-border' : 'border-catalogue-border-subtle'} w-full ${backgroundColor ? '' : 'bg-catalogue-bg'} ${headerTopOffset}`}
        style={{
          '--header-height': 'var(--catalogue-header-height)',
          '--header-height-mobile': 'var(--catalogue-header-height-mobile)',
          ...(backgroundColor ? { backgroundColor } : {}), // design-lint-ignore: author-picked page-builder color
          ...(textColor ? { color: textColor } : {}), // design-lint-ignore: author-picked page-builder color
        } as React.CSSProperties}
      >
        {/* Container with consistent responsive padding */}
        <LogoutSidebar />
        <div className={`${chrome.contained ? HEADER_CONTAINED_OUTER : 'w-full px-4 sm:px-6 lg:px-8 xl:px-12'} ${isAndroid || isIOS ? 'mt-6' : ''}`}>
          <div className={`flex items-center justify-between ${headerHeight}${chrome.contained ? ` ${HEADER_CONTAINED_INNER}` : ''}`}>
            {/* Mobile menu button - Left side when courseCatalogeType.enabled is true */}
            {/* Mobile menu button - Left side when courseCatalogeType.enabled is true */}
            {isCourseCatalogeTypeEnabled && (
              <button
                ref={setHamburgerButtonRef}
                onClick={() => {
                  const newState = !isMobileMenuOpen;
                  setIsMobileMenuOpen(newState);
                  if (newState && togle) {
                    settogle(false);
                    window.dispatchEvent(new CustomEvent('toggleSearchBar', { detail: { isOpen: false } }));
                    sessionStorage.setItem('searchBarOpen', 'false');
                  }
                }}
                className={`${bp.phoneOnly} p-2 rounded-catalogue-sm text-catalogue-text-secondary hover:text-catalogue-text-primary hover:bg-catalogue-interactive-hover flex-shrink-0 transition-colors duration-200`}
                aria-label={t("header.toggleMenu")}
              >
                <div className="relative w-5 h-5 flex flex-col justify-center items-center">
                  <span
                    className={`absolute block h-0.5 w-5 bg-current transform transition-transform duration-200 ${isMobileMenuOpen ? 'rotate-45 translate-y-0' : '-translate-y-1.5'
                      }`}
                  />
                  <span
                    className={`absolute block h-0.5 w-5 bg-current transition-opacity duration-200 ${isMobileMenuOpen ? 'opacity-0' : 'opacity-100'
                      }`}
                  />
                  <span
                    className={`absolute block h-0.5 w-5 bg-current transform transition-transform duration-200 ${isMobileMenuOpen ? '-rotate-45 translate-y-0' : 'translate-y-1.5'
                      }`}
                  />
                </div>
              </button>
            )}

            {/* Logo and Brand. With the bar's extras it may shrink (min-w-0),
                so the title truncates instead of pushing the controls off-screen. */}
            {/* The logo and site name lead home (or where the site points them). */}
            {createElement(
              logoHref ? "a" : "div",
              {
                className: `flex items-center gap-3 ${isCourseCatalogeTypeEnabled ? bp.catalogLogo : ''}${hasHeaderExtras ? ' min-w-0' : ''}${logoHref ? ' no-underline' : ''}`,
                ...(logoHref ? { href: logoHref, onClick: handleLogoClick } : {}),
              },
              <>
              {/* JSON logo (from page builder) */}
              {jsonLogoUrl ? (
                <>
                  <img
                    src={jsonLogoUrl}
                    alt={t("header.logoAlt")}
                    className={`${chrome.compact ? HEADER_COMPACT_LOGO : 'max-h-12 md:max-h-16'} w-auto object-contain rounded-catalogue-sm transition-opacity duration-200 hover:opacity-90${hasHeaderExtras ? ' min-w-0' : ''}`}
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                  {jsonTitleShown && !chrome.logoOnly && (
                    <span className="text-base md:text-lg font-semibold text-catalogue-text-primary truncate max-w-48 md:max-w-none">
                      {jsonTitleShown}
                    </span>
                  )}
                </>
              ) : (
                <>
                  {/* Institute circular logo */}
                  {instituteLogoUrl && (
                    <img
                      src={instituteLogoUrl}
                      alt={t("header.instituteLogoAlt")}
                      className="h-10 w-10 md:h-11 md:w-11 rounded-full object-cover border border-catalogue-border"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                    />
                  )}
                  {/* Title: use JSON title if set, else institute name */}
                  {!chrome.logoOnly && (
                  <span className="text-base md:text-lg font-semibold text-catalogue-text-primary truncate max-w-48 md:max-w-none">
                    {jsonTitleShown || domainRouting.instituteName || ""}
                  </span>
                  )}
                </>
              )}
              </>,
            )}

            {/* Desktop Navigation */}
            {visibleNavigation.length > 0 && (
              <nav className={`${bp.desktopFlex} ${chrome.editorialNav ? EDITORIAL_NAV : 'items-center gap-1'}`}>
                {navEntries.map(({ item, base }, index) => {
                  if (isMegaMenuItem(base)) {
                    // Its panel is positioned against the fixed <header>, so
                    // no ancestor between here and the header may be positioned.
                    // A deleted library makes it the plain item below (plainLink).
                    const megaSameTab = base.openInSameTab === true || String(base.openInSameTab) === "true";
                    return (
                      <MegaMenuNavItem
                        key={index}
                        label={item.label}
                        config={item.megaMenu ?? base.megaMenu ?? {}}
                        baseConfig={base.megaMenu ?? {}}
                        instituteId={resolvedInstituteId}
                        tagName={effectiveTagName}
                        activeStyle={activeStyle}
                        navStyle={chrome.editorialNav ? "editorial" : undefined}
                        panelStyle={chrome.editorialMega ? "editorial" : undefined}
                        routeActive={!!(base.route || '').trim() && isActiveRoute(base.route)}
                        plainLink={{
                          onClick: () => handleNavigation(base.route, base.label, megaSameTab),
                          active: isActiveRoute(base.route),
                        }}
                      />
                    );
                  }
                  const isActive = isActiveRoute(base.route);
                  const openInSameTab = base.openInSameTab === true || String(base.openInSameTab) === "true";
                  if (base.type === "dropdown" && Array.isArray(base.children) && base.children.length > 0) {
                    const ddActive = isActive || dropdownHasActive(base.children, isActiveRoute);
                    return (
                      <DesktopNavDropdown
                        key={index}
                        label={item.label}
                        items={base.children}
                        active={ddActive}
                        onNavigate={handleDropdownNavigation}
                        buttonClassName={chrome.editorialNav ? editorialNavItemClasses(ddActive) : `px-4 py-2 rounded-catalogue-sm text-sm font-medium transition-colors duration-200 ${desktopNavItemClasses(ddActive, activeStyle)}`}
                      />
                    );
                  }
                  return (
                    <button
                      key={index}
                      onClick={() => handleNavigation(base.route, base.label, openInSameTab)}
                      className={chrome.editorialNav ? editorialNavItemClasses(isActive) : `px-4 py-2 rounded-catalogue-sm text-sm font-medium transition-colors duration-200 ${desktopNavItemClasses(isActive, activeStyle)}`}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </nav>
            )}

            {/* Right side actions */}
            <div className={chrome.editorialNav ? EDITORIAL_RIGHT_GROUP : "flex items-center gap-2 md:gap-3 flex-shrink-0"}>
              {/* Mobile menu button - Right side when courseCatalogeType is disabled.
                  Gated on nav items OR auth links, matching what the menu below
                  actually renders: a header configured with only Login /
                  Get Started (no nav) used to show no toggle at all, leaving
                  those links unreachable on a phone. */}
              {!isCourseCatalogeTypeEnabled && (visibleNavigation.length > 0 || visibleAuthLinks.length > 0 || isAuthenticated) && (
                <button
                  ref={setHamburgerButtonRef}
                  onClick={() => {
                    const newState = !isMobileMenuOpen;
                    setIsMobileMenuOpen(newState);
                    if (newState && togle) {
                      settogle(false);
                      window.dispatchEvent(new CustomEvent('toggleSearchBar', { detail: { isOpen: false } }));
                      sessionStorage.setItem('searchBarOpen', 'false');
                    }
                  }}
                  // With search / language / cart in the bar, the menu toggle
                  // moves to the far end on phones, where visitors look for it.
                  className={`${bp.phoneOnly} p-2 rounded-catalogue-sm text-catalogue-text-secondary hover:text-catalogue-text-primary hover:bg-catalogue-interactive-hover transition-colors duration-200${hasHeaderExtras ? ' order-last lg:order-none' : ''}`}
                  aria-label={t("header.toggleMenu")}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                </button>
              )}

              {/* Search and Cart Icons */}
              {isCourseCatalogeTypeEnabled && (
                <div className="flex items-center gap-1">
                  {/* Search Icon — replaced by the site search when the author turns that on */}
                  {!hideSearch && !showSearchButton && (
                  <button
                    onClick={() => {
                      const newToggleState = !togle;
                      settogle(newToggleState);
                      window.dispatchEvent(new CustomEvent('toggleSearchBar', {
                        detail: { isOpen: newToggleState }
                      }));
                      sessionStorage.setItem('searchBarOpen', String(newToggleState));
                      if (newToggleState && isMobileMenuOpen) {
                        setIsMobileMenuOpen(false);
                      }
                    }}
                    className="p-2 rounded-catalogue-sm text-catalogue-text-secondary hover:text-catalogue-text-primary hover:bg-catalogue-interactive-hover transition-colors duration-200"
                    aria-label={t("header.search")}
                  >
                    <MagnifyingGlass className="w-5 h-5" />
                  </button>
                  )}

                  {/* Cart Icon — the book-store cart; a site cart (below) replaces it. */}
                  {!hideCart && !showSiteCart && (
                  <button
                    onClick={() => {
                      navigate({ to: `${RouteMatcher.basePath(effectiveTagName)}/cart` });
                    }}
                    className="relative p-2 rounded-catalogue-sm text-catalogue-text-secondary hover:text-catalogue-text-primary hover:bg-catalogue-interactive-hover transition-colors duration-200"
                    aria-label={t("header.shoppingCart")}
                  >
                    <ShoppingCart className="w-5 h-5" />
                    {cartItemCount > 0 && (
                      <span className="absolute -top-0.5 -end-0.5 bg-primary-500 text-white text-caption font-semibold rounded-full min-w-5 h-5 flex items-center justify-center px-1">
                        {cartItemCount > 99 ? '99+' : cartItemCount}
                      </span>
                    )}
                  </button>
                  )}
                </div>
              )}

              {/* Site search, language switch and site cart — each opt-in. */}
              {showSearchButton && (
                <HeaderSearch
                  instituteId={resolvedInstituteId}
                  tagName={effectiveTagName}
                  catalogueData={catalogueData}
                  globalSettings={resolvedGlobalSettings}
                  megaConfigs={megaEntries.map(({ base }) => base.megaMenu ?? {})}
                  streamsLabel={megaEntries[0]?.item.label}
                  className="flex-shrink-0"
                  variant={chrome.editorialNav ? "editorial" : undefined}
                />
              )}
              {showSwitcher && (
                <HeaderLanguageSwitcher
                  authoredLocales={resolvedGlobalSettings?.i18n?.locales}
                  className={switcherInMenu ? 'hidden sm:inline-flex' : undefined}
                  variant={switcherVariant}
                />
              )}
              {showSiteCart && (
                <SiteCartButton
                  instituteId={resolvedInstituteId ?? undefined}
                  tagName={effectiveTagName}
                  settings={resolvedGlobalSettings?.siteCart}
                  languages={
                    resolvedGlobalSettings?.courseLanguages?.enabled
                      ? courseLanguagesOf(resolvedGlobalSettings.courseLanguages)
                      : undefined
                  }
                  hideWhenEmpty={chrome.cartWhenNotEmpty || undefined}
                />
              )}

              {/* Login Button - Mobile only (when courseCatalogeType enabled) */}
              {isCourseCatalogeTypeEnabled && !isAuthenticated && (
                <button
                  onClick={() => navigate({ to: '/login' })}
                  className={`${bp.phoneOnly} px-3 py-1.5 rounded-catalogue-sm text-xs font-medium bg-primary-500 text-white hover:bg-primary-400 transition-colors duration-200`}
                >
                  {t("header.login")}
                </button>
              )}

              {/* Auth Links - Desktop only. On mobile these live in the
                  hamburger menu (see the toggle above), not in the bar: the
                  sticky MobileActionBar already carries Login / Get Started, so
                  repeating them in the header just doubled the same two CTAs. */}
              <div className={`${bp.desktopFlex} items-center ${chrome.editorialNav ? 'gap-4' : 'gap-2'}`}>
                {isAuthenticated ? (
                  <div className="flex items-center gap-3 shrink-0">
                    <SystemAlertsBar />
                    <div className="w-px h-6 bg-primary-200/60 dark:bg-neutral-700"></div>
                    <button
                      className="group relative flex items-center justify-center w-8 h-8 md:w-9 md:h-9 rounded-catalogue-sm border border-primary-200/50 dark:border-neutral-700 bg-white dark:bg-neutral-800 hover:bg-primary-100 dark:hover:bg-neutral-700 hover:border-primary-400 dark:hover:border-neutral-600 transition-all duration-200"
                      onClick={() => {
                        setSidebarOpen();
                      }}
                    >
                      <List className="w-4 h-4 text-primary-600 dark:text-neutral-300 group-hover:text-primary-700 dark:group-hover:text-neutral-200 transition-colors duration-200" />
                    </button>
                  </div>
                ) : (
                  visibleAuthEntries.map(({ link, base }, index) => (
                    <button
                      key={index}
                      onClick={() => handleAuthLinkClick(link, base)}
                      // No style set = the original rule: first filled, the rest outlined.
                      className={
                        chrome.editorialNav
                          ? EDITORIAL_AUTH_CLASSES[desktopAuthVariant(base.style ?? link.style, index)]
                          : `px-4 py-2 rounded-catalogue-sm text-sm font-medium transition-colors duration-200 ${DESKTOP_AUTH_CLASSES[desktopAuthVariant(base.style ?? link.style, index)]}`
                      }
                    >
                      {link.label}
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Mobile Navigation Menu */}
          {isCourseCatalogeTypeEnabled ? (
            <div
              ref={setMobileMenuRef}
              className={`${bp.phoneOnly}  fixed start-0 end-0 z-catalogue-dropdown bg-catalogue-bg-elevated border-b border-catalogue-border transition-all duration-300 ease-out ${isMobileMenuOpen
                ? 'opacity-100 visible'
                : 'opacity-0 invisible pointer-events-none'
                }${megaEntries.length ? ' max-h-screen-85 overflow-y-auto overscroll-contain' : ''}${menuTop.className}`}
              style={menuTop.style}
            >
              <div className={`transform transition-transform duration-300 ease-out ${isMobileMenuOpen ? 'translate-y-0' : '-translate-y-4'
                }`}>
                <div className="px-4 py-4 space-y-3">
                  {switcherInMenu && renderMenuLanguageRow()}
                  {/* Navigation Links */}
                  {visibleNavigation.length > 0 && (
                    <div className="space-y-1 pb-3 border-b border-catalogue-border-subtle">
                      {navEntries.map(({ item, base }, index) => {
                        if (isMegaMenuItem(base)) {
                          return (
                            <MobileMegaMenu
                              key={index}
                              label={item.label}
                              config={item.megaMenu ?? base.megaMenu ?? {}}
                              baseConfig={base.megaMenu ?? {}}
                              instituteId={resolvedInstituteId}
                              tagName={effectiveTagName}
                              itemClassName={mobileNavItemClass}
                              onDone={() => setIsMobileMenuOpen(false)}
                              plainLink={mobileMegaPlainLink(base)}
                            />
                          );
                        }
                        const isActive = isActiveRoute(base.route);
                        const openInSameTab = base.openInSameTab === true || String(base.openInSameTab) === "true";
                        if (base.type === "dropdown" && Array.isArray(base.children) && base.children.length > 0) {
                          return (
                            <MobileNavDropdown
                              key={index}
                              label={item.label}
                              items={base.children}
                              itemClassName={mobileNavItemClass}
                              onNavigate={handleDropdownNavigation}
                              onDone={() => setIsMobileMenuOpen(false)}
                            />
                          );
                        }
                        return (
                          <button
                            key={index}
                            onClick={() => {
                              setIsMobileMenuOpen(false);
                              handleNavigation(base.route, base.label, openInSameTab);
                            }}
                            className={`block w-full text-start px-4 py-2.5 rounded-catalogue-sm text-base font-medium transition-colors duration-200 ${isActive
                              ? 'text-primary-500 bg-primary-50'
                              : 'text-catalogue-text-secondary hover:text-catalogue-text-primary hover:bg-catalogue-interactive-hover'
                              }`}
                          >
                            {item.label}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Login Button */}
                  {!isAuthenticated && (
                  <button
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      navigate({ to: '/login' });
                    }}
                    className="w-full flex items-center justify-between px-4 py-3 rounded-catalogue-md text-base font-medium bg-primary-500 text-white hover:bg-primary-400 transition-colors duration-200"
                  >
                    <span>{t("header.login")}</span>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  </button>
                  )}

                  {/* Dashboard Button - when authenticated */}
                  {isAuthenticated && (
                    <button
                      onClick={() => {
                        setIsMobileMenuOpen(false);
                        navigate({ to: '/dashboard' });
                      }}
                      className="w-full flex items-center justify-between px-4 py-3 rounded-catalogue-md text-base font-medium text-white bg-primary-500 hover:bg-primary-400 transition-colors duration-200"
                    >
                      <span>{t("header.dashboard")}</span>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                      </svg>
                    </button>
                  )}

                  {/* Customer Services Button */}
                  <button
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      const customerServiceLink = baseAuthLinks.find(link =>
                        link.label.toLowerCase().includes('support') ||
                        link.label.toLowerCase().includes('customer') ||
                        link.route.includes('support') ||
                        link.route.includes('customer')
                      );
                      if (customerServiceLink) {
                        handleNavigation(customerServiceLink.route, customerServiceLink.label);
                      } else {
                        window.open('https://chat.whatsapp.com/Kvh1fsDcL1GFCBrIveQ8q8', '_blank', 'noopener,noreferrer');
                      }
                    }}
                    className="w-full flex items-center justify-between px-4 py-3 rounded-catalogue-md text-base font-medium text-catalogue-text-secondary bg-catalogue-bg-subtle hover:bg-catalogue-interactive-hover border border-catalogue-border transition-colors duration-200"
                  >
                    <span className="flex items-center gap-3">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z" />
                      </svg>
                      {t("header.customerServices")}
                    </span>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                  
                  {/* Join Community Button - Only show if provided in JSON */}
                  {catalogueData?.globalSettings?.communityJoinLink && (
                    <button
                      onClick={() => {
                        setIsMobileMenuOpen(false);
                        window.open(catalogueData.globalSettings.communityJoinLink!, '_blank', 'noopener,noreferrer');
                      }}
                      className="w-full flex items-center justify-between px-4 py-3 rounded-catalogue-md text-base font-medium text-white bg-whatsapp hover:bg-whatsapp-hover transition-colors duration-200 shadow-sm"
                    >
                      <span className="flex items-center gap-3">
                        <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
                        </svg>
                        {t("header.joinCommunity")}
                      </span>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  )}

                  {/* Genre Dropdown */}
                  {/* <div className="relative">
                  <button
                    onClick={() => setIsGenreDropdownOpen(!isGenreDropdownOpen)}
                    className="group w-full flex items-center justify-between px-5 py-3.5 rounded-catalogue-lg text-base font-medium text-catalogue-text-primary bg-catalogue-bg-subtle hover:bg-catalogue-bg-muted border border-catalogue-border hover:border-catalogue-border-strong transition-all duration-300 ease-in-out transform hover:scale-[1.01] active:scale-[0.99]"
                  >
                    <span className="flex items-center gap-2">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                      </svg>
                      Genre
                    </span>
                    <svg 
                      className={`w-5 h-5 transform transition-all duration-300 ease-in-out ${
                        isGenreDropdownOpen ? 'rotate-180' : ''
                      }`}
                      fill="none" 
                      stroke="currentColor" 
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  
                  <div 
                    className={`overflow-hidden transition-all duration-500 ease-in-out ${
                      isGenreDropdownOpen ? 'max-h-96 opacity-100 mt-2' : 'max-h-0 opacity-0 mt-0'
                    }`}
                  >
                    <div className="bg-gradient-to-br from-gray-50 to-white rounded-catalogue-lg border border-gray-200 shadow-sm overflow-hidden">
                      {['Poetry', 'Drama', 'Fiction', 'Non-Fiction'].map((genre, index) => (
                        <button
                          key={index}
                          onClick={() => {
                            setIsMobileMenuOpen(false);
                            setIsGenreDropdownOpen(false);
                            // Set genre filter in sessionStorage
                            sessionStorage.setItem('genreFilter', genre.toLowerCase());
                            // Navigate to homepage with genre filter
                            navigate({ to: RouteMatcher.pagePath(effectiveTagName) });
                          }}
                          className="group w-full text-left px-6 py-3 text-sm font-medium text-catalogue-text-secondary hover:text-catalogue-text-primary hover:bg-catalogue-bg-subtle border-b border-catalogue-border-subtle last:border-b-0 transition-all duration-200 ease-in-out transform hover:translate-x-1"
                        >
                          <span className="flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-gray-400 group-hover:bg-blue-500 transition-colors duration-200" />
                            {genre}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div> */}
                </div>
              </div>
            </div>
          ) : (
            // Standard mobile menu
            isMobileMenuOpen && (visibleNavigation.length > 0 || visibleAuthLinks.length > 0 || isAuthenticated) && (
              <div
                ref={setMobileMenuRef}
                className={`${bp.phoneOnly} fixed start-0 end-0 z-catalogue-dropdown border-t border-catalogue-border-subtle bg-catalogue-bg-elevated ${isAndroid || isIOS ? 'mt-8' : ''}${megaEntries.length ? ' max-h-screen-85 overflow-y-auto overscroll-contain' : ''}${menuTop.className}`}
                style={menuTop.style}
              >
                <div className="px-4 py-3 space-y-1">
                  {switcherInMenu && renderMenuLanguageRow()}
                  {/* Navigation Links */}
                  {navEntries.map(({ item, base }, index) => {
                    if (isMegaMenuItem(base)) {
                      return (
                        <MobileMegaMenu
                          key={index}
                          label={item.label}
                          config={item.megaMenu ?? base.megaMenu ?? {}}
                          baseConfig={base.megaMenu ?? {}}
                          instituteId={resolvedInstituteId}
                          tagName={effectiveTagName}
                          itemClassName={mobileNavItemClass}
                          onDone={() => setIsMobileMenuOpen(false)}
                          plainLink={mobileMegaPlainLink(base)}
                        />
                      );
                    }
                    const isActive = isActiveRoute(base.route);
                    const openInSameTab = base.openInSameTab === true || String(base.openInSameTab) === "true";
                    if (base.type === "dropdown" && Array.isArray(base.children) && base.children.length > 0) {
                      return (
                        <MobileNavDropdown
                          key={index}
                          label={item.label}
                          items={base.children}
                          itemClassName={mobileNavItemClass}
                          onNavigate={handleDropdownNavigation}
                          onDone={() => setIsMobileMenuOpen(false)}
                        />
                      );
                    }
                    return (
                      <button
                        key={index}
                        onClick={() => {
                          setIsMobileMenuOpen(false);
                          handleNavigation(base.route, base.label, openInSameTab);
                        }}
                        className={`block w-full text-start px-4 py-2.5 rounded-catalogue-sm text-base font-medium transition-colors duration-200 ${isActive
                          ? 'text-primary-500 bg-primary-50'
                          : 'text-catalogue-text-secondary hover:text-catalogue-text-primary hover:bg-catalogue-interactive-hover'
                          }`}
                      >
                        {item.label}
                      </button>
                    );
                  })}

                  {/* Auth Links. The rule separates them from the nav items
                      above — with no nav configured there is nothing to
                      separate, so it would read as a stray line. */}
                  {(visibleAuthLinks.length > 0 || isAuthenticated) && (
                    <div className={`space-y-2 ${visibleNavigation.length > 0 ? 'border-t border-catalogue-border-subtle pt-3 mt-3' : ''}`}>
                      {isAuthenticated ? (
                        <>
                          <button
                            onClick={() => {
                              setIsMobileMenuOpen(false);
                              navigate({ to: '/dashboard' });
                            }}
                            className={`block w-full text-start px-4 py-2.5 rounded-catalogue-sm text-base font-medium transition-colors duration-200 text-white bg-primary-500 hover:bg-primary-400`}
                          >
                            {t("header.dashboard")}
                          </button>
                          <div className="px-4 py-1">
                            {/* In mobile maybe don't need notification bell alone, they can see from dashboard */}
                            {/* Just have dashboard link */}
                          </div>
                        </>
                      ) : (
                        visibleAuthEntries.map(({ link, base }, index) => (
                          <button
                            key={`auth-${index}`}
                            onClick={() => {
                              const r = normalizeRoute(base.route);
                              setIsMobileMenuOpen(false);
                              if (r === 'login' || r === 'signup') {
                                if (useModalForAuth) {
                                  (r === 'login' ? loginAuthModalRef : signupAuthModalRef)
                                    .current?.setIsOpen(true);
                                } else {
                                  navigate({ to: `/${r}` });
                                }
                              } else if ((base.audienceId || '').trim()) {
                                window.dispatchEvent(new CustomEvent('openAudienceForm', {
                                  detail: { audienceId: (base.audienceId || '').trim(), title: link.formTitle || link.label },
                                }));
                              } else if (isLeadFormLink(base)) {
                                const event = new CustomEvent('openLeadCollection', {
                                  detail: { source: 'mobileMenu' }
                                });
                                window.dispatchEvent(event);
                              } else {
                                void siteNavigate(base.route);
                              }
                            }}
                            // No style set = the original rule here: first filled, the rest plain text.
                            className={`block w-full text-start px-4 py-2.5 rounded-catalogue-sm text-base font-medium transition-colors duration-200 ${MOBILE_AUTH_CLASSES[mobileAuthVariant(base.style ?? link.style, index)]}`}
                          >
                            {link.label}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          )}
        </div>

        {/* Search Bar - Only for hero section header */}

        {/* Hidden triggers — opened programmatically from header auth buttons.
            Only mounted when the tenant opts into the in-place modal flow. */}
        {useModalForAuth && (
          <>
            <AuthModal
              ref={loginAuthModalRef}
              initialMode="login"
              trigger={<span style={{ display: 'none' }} aria-hidden="true" />}
            />
            <AuthModal
              ref={signupAuthModalRef}
              initialMode="signup"
              trigger={<span style={{ display: 'none' }} aria-hidden="true" />}
            />
          </>
        )}
      </header>
    );
  };
