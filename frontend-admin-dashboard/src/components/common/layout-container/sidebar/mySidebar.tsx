/**
 * MySidebar — Gmail-style two-bar sidebar
 *
 * Layout:
 * ┌──────────┬──────────────────────────────┐
 * │ Rail     │ Panel                         │
 * │ (64px)   │ (250px, collapsible)          │
 * │          │                               │
 * │ [CRM]    │ [Logo] Institute Name         │
 * │ [LMS]    │ ──────────────                │
 * │ [AI]     │ Dashboard          (pill)     │
 * │ ───      │ Manage Institute     ▾        │
 * │ [Recent] │   ├── Batches                 │
 * │          │   └── Sessions                │
 * │          │ ────── divider ──────         │
 * │          │ Settings                      │
 * │          │                               │
 * │          │ ❓ Support                    │
 * └──────────┴──────────────────────────────┘
 *
 * On collapse: Only the Rail stays. Hovering a rail category shows a flyout
 * popover with the tabs for that category.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sidebar, SidebarContent, useSidebar } from '@/components/ui/sidebar';
import {
    SidebarStateType,
    SidebarItemsType,
} from '../../../../types/layout-container/layout-container-types';
import { getSidebarItemsData, withSystemDefaults } from './utils';
import { useNamingSettingsVersion } from '@/hooks/useNamingSettingsVersion';
import './scrollbarStyle.css';
import { useSuspenseQuery, useQuery } from '@tanstack/react-query';
import {
    useInstituteQuery,
    getSubOrgInstituteQuery,
} from '@/services/student-list-section/getInstituteDetails';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { filterMenuItems } from './helper';
import { useActiveSidebarSection } from './use-active-sidebar-section';
import { useTitleStore } from '@/stores/useTitleStore';
import {
    ADMIN_DISPLAY_SETTINGS_KEY,
    TEACHER_DISPLAY_SETTINGS_KEY,
    type DisplaySettingsData,
} from '@/types/display-settings';
import { getDisplaySettings, getDisplaySettingsFromCache } from '@/services/display-settings';
import { getNotificationSettings } from '@/services/notification-settings';
import { useFileUpload } from '@/hooks/use-file-upload';
import { cn } from '@/lib/utils';
import { useNavigate, useRouter } from '@tanstack/react-router';
import useInstituteLogoStore from './institutelogo-global-zustand';
import { useTabSettings } from '@/hooks/use-tab-settings';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import {
    getEffectiveInstituteLogoFileId,
    getValidSelectedSubOrgId,
    getSelectedSubOrgLinkageType,
    isCallerSubOrgAdmin,
} from '@/lib/auth/facultyAccessUtils';
import { TooltipProvider } from '@/components/ui/tooltip';
import { getActiveRoleDisplaySettingsKey } from '@/lib/auth/instituteUtils';

import { Lightning } from '@phosphor-icons/react';
import { CategoryRail, type CategoryId } from './category-rail';
import { SidebarPanel } from './sidebar-panel';
import { useCallIntelligenceEnabled, useHasCallIntelligenceData } from '@/components/shared/leads';
import { useIsMentor } from '@/hooks/use-is-mentor';
import { useMyEmployeeProfile } from '@/hooks/use-my-employee-profile';

import type { SidebarCategory } from '@/types/layout-container/layout-container-types';
import { useLeadSettings } from '@/hooks/use-lead-settings';
import { useEntitlement, useNavSnapshotStore } from '@/lib/capabilities/use-entitlement';
import {
    categoriesWithItems,
    filterSidebarByEntitlement,
    pickActiveCategory,
} from '@/lib/capabilities/nav-access';
// Sidebar sub-items under "Assessments and Tests" that deep-link into the
// create-assessment wizard. Hidden together with the Create Assessment button.
const ASSESSMENT_CREATE_SUB_ITEM_IDS = new Set([
    'create-deadline-test',
    'create-anytime-test',
    'create-survey',
]);

const voltSidebarData: SidebarItemsType[] = [
    {
        icon: Lightning,
        title: 'Volt',
        id: 'volt',
        to: '/study-library/volt',
    },
];

export const MySidebar = ({ sidebarComponent }: { sidebarComponent?: React.ReactNode }) => {
    const navigate = useNavigate();
    const {
        state,
        openMobile,
        setOpenMobile,
    }: SidebarStateType & { openMobile: boolean; setOpenMobile: (open: boolean) => void } =
        useSidebar();
    const { data, isLoading } = useSuspenseQuery(useInstituteQuery());
    const router = useRouter();
    const currentRoute = router.state.location.pathname;
    const { isTabVisible, isSubItemVisible } = useTabSettings();
    const isMobile = useIsMobile();

    const [isVoltSubdomain, setIsVoltSubdomain] = useState(false);
    const [activeCategory, setActiveCategory] = useState<CategoryId>('CRM');
    // Route the category sync last ran for — tells a real navigation apart from
    // a re-run caused by roleDisplay loading on the same page.
    const lastSyncedRouteRef = useRef<string | null>(null);
    const [roleDisplay, setRoleDisplay] = useState<DisplaySettingsData | null>(null);
    // True once this role's display settings are known (or failed to load), so the
    // published sidebar is the role's real one, not the defaults.
    const [roleDisplayResolved, setRoleDisplayResolved] = useState(false);
    const [mainInstituteLogoUrl, setMainInstituteLogoUrl] = useState<string>('');

    // Subscribe to naming-settings changes so the sidebar re-renders with
    // the new terms the moment they are saved on the settings page.
    useNamingSettingsVersion();

    // Same rationale for language: getSidebarItemsData() resolves its labels
    // through the i18next singleton, so without a subscription here the nav
    // would keep the old language until some unrelated state change forced a
    // re-render.
    useTranslation('sidebar');

    // IMPORTANT: use the *validated* selector here. The plain getter returns
    // whatever's in localStorage, which can be a stale id from a previous session
    // or a sub-org an institute admin only *visited* (not joined). Without this
    // gate the sidebar would silently flip to sub-org branding for an institute
    // admin who has no FSPSSM access. getValidSelectedSubOrgId self-heals stale
    // entries so future renders settle on parent branding without manual clears.
    const selectedSubOrgId = getValidSelectedSubOrgId();
    const subOrgLinkageType = getSelectedSubOrgLinkageType();
    const isPartnershipLinkage =
        subOrgLinkageType === 'PARTNERSHIP' || subOrgLinkageType === 'SUB_ORG';

    const { data: subOrgInstituteDetails } = useQuery({
        ...getSubOrgInstituteQuery(selectedSubOrgId ?? null),
        enabled: !!selectedSubOrgId,
    });

    // Chat-enabled gate for the Communications > Chat sidebar entry. Chat is OFF
    // by default — only surface the entry when an institute has explicitly enabled
    // it. Fail closed: isChatEnabled stays false while the query is loading or on
    // error, so the entry is hidden until we confirm chat is on. Reuses the cached
    // ['notification-settings'] query if it was already fetched elsewhere.
    const notificationSettingsQuery = useQuery({
        queryKey: ['notification-settings'],
        queryFn: getNotificationSettings,
        refetchOnWindowFocus: false,
    });
    const isChatEnabled = notificationSettingsQuery.data?.settings?.chat?.enabled === true;

    // "My Mentorship" is the mentor's OWN workspace (their mentees, availability,
    // booking link) — the admin views are the four entries beside it. Every other
    // Mentorship sub-item is adminOnly; this one has no role gate, so without this
    // check every non-mentor admin gets an entry that only ever renders
    // "Couldn't load your mentor profile".
    // Mentorship must not be touched from anywhere else in the app. A mentor is recognised from
    // the access token alone (zero requests), so the fallback probe is only worth running where
    // the answer is actually in play: on a Mentorship route, and only when the entry isn't hidden
    // for this institute anyway. Everywhere else — dashboard, students, fees — nothing is called.
    // The result is cached for the session, so returning to the dashboard keeps the entry without
    // re-asking.
    const mentorshipEntryVisible = isSubItemVisible('mentorship', 'mentorship-my-mentorship');
    const onMentorshipRoute = currentRoute.startsWith('/mentorship');
    const { isMentor } = useIsMentor(mentorshipEntryVisible && onMentorshipRoute);

    // ERP > My HR is the employee's OWN workspace; every screen behind it 404s
    // for someone with no HR profile (most staff, at an institute that has not
    // onboarded payroll). Unlike the mentorship probe this cannot wait until the
    // user is already on the route — the entry IS the way in — so it runs
    // whenever the institute has ERP switched on at all. That is one request per
    // session, cached for its lifetime, and none at all for the institutes that
    // never enable ERP.
    const myHrEntryVisible = isTabVisible('erp-my-hr');
    const { employeeId: myEmployeeId } = useMyEmployeeProfile(myHrEntryVisible);
    const hasEmployeeProfile = !!myEmployeeId;

    // AI Intelligence (Leads > AI Intelligence) rides on Call Intelligence. The
    // entry is available when the feature is ON, or when it's off but the institute
    // has previously-analyzed data to look back on (the page then shows historical
    // insights with an "off, no new analysis" banner). Once available, Display
    // Settings governs whether it actually shows (admins can still hide it).
    // Fail closed: both hooks return false while loading, so it stays hidden until
    // the settings/data resolve. The has-data probe is skipped when the feature is
    // on (the entry shows regardless), avoiding an extra analytics call.
    // Check Lead is off for every institute until one turns it on, so without a
    // gate the entry is a dead page for everyone else.
    //
    // Like every gate in this file (see project notes on sidebar feature-gates),
    // this costs a request on NON-CRM pages too — the sidebar is in the layout.
    // It shares the ['lead-settings-config'] cache the CRM screens already fill,
    // 5-min staleTime, and hits the same /institute/setting/v1/get that the
    // call-intelligence gate right below already calls on every page. So it is
    // one more cached GET per session, not one per navigation.
    const { leadLookup } = useLeadSettings();
    const isLeadLookupEnabled = leadLookup.enabled;

    const isCrmIntelligenceEnabled = useCallIntelligenceEnabled();
    const hasCrmIntelligenceData = useHasCallIntelligenceData(!isCrmIntelligenceEnabled);
    const isCrmIntelligenceAvailable = isCrmIntelligenceEnabled || hasCrmIntelligenceData;

    // Institute plan (modules). FULL_ENTITLEMENT — nothing filtered — unless the
    // institute is MANAGED and the catalogue loaded (INSTITUTE_MODULES spec §9).
    const entitlement = useEntitlement();
    const setNavSnapshot = useNavSnapshotStore((s) => s.setSnapshot);

    useEffect(() => {
        setIsVoltSubdomain(
            typeof window !== 'undefined' && window.location.hostname.startsWith('volt.')
        );
    }, []);

    // Load display settings
    useEffect(() => {
        const roleKey = getActiveRoleDisplaySettingsKey();
        const cached = getDisplaySettingsFromCache(roleKey);
        if (cached) {
            setRoleDisplay(cached);
            setRoleDisplayResolved(true);
        } else {
            getDisplaySettings(roleKey)
                .then(setRoleDisplay)
                .catch(() => setRoleDisplay(null))
                .finally(() => setRoleDisplayResolved(true));
        }
    }, []);

    // Reuse the roleDisplay blob loaded above rather than the assessment-actions
    // hook — the hook would fire a second identical fetch on a cold cache.
    const canCreateAssessment = roleDisplay?.assessmentPage?.showCreateAssessment !== false;

    // Compute the role's sidebar items (same logic as before)
    const roleSidebarItems = (() => {
        const rawBase = isVoltSubdomain
            ? voltSidebarData
            : filterMenuItems(
                  getSidebarItemsData(),
                  data?.id || '',
                  isTabVisible,
                  isSubItemVisible,
                  roleDisplay
              );
        // Chat is OFF by default. Strip the Communications > Chat sub-item unless the
        // institute has explicitly enabled chat. Fail closed: isChatEnabled is false
        // while the notification-settings query is loading/errored, so the entry stays
        // hidden until we confirm chat is on.
        // Strip feature-gated sub-items that the institute can't use: Chat (unless
        // notifications.chat is on) and AI Intelligence (unless Call Intelligence is
        // on OR there's historical analyzed data to look back on). Applied together
        // so we only remap once.
        // Also strip the assessment "Create …" shortcuts when Display Settings
        // turns off assessment creation for this role — those sub-items link
        // straight into the create wizard, so leaving them would contradict the
        // hidden Create Assessment button.
        const needsSubItemFilter =
            !isChatEnabled ||
            !isCrmIntelligenceAvailable ||
            !canCreateAssessment ||
            !isMentor ||
            !isLeadLookupEnabled;
        // Drop My HR entirely for non-employees — it is a whole module, not a
        // sub-item, so it is filtered from the item list rather than within one.
        const rawBaseWithHr = hasEmployeeProfile
            ? rawBase
            : rawBase.filter((item) => item.id !== 'erp-my-hr');
        const base = !needsSubItemFilter
            ? rawBaseWithHr
            : rawBaseWithHr.map((item) => ({
                  ...item,
                  subItems: item.subItems?.filter(
                      (s) =>
                          (isChatEnabled || s.subItemId !== 'chat') &&
                          (isCrmIntelligenceAvailable || s.subItemId !== 'ai-intelligence') &&
                          (isMentor || s.subItemId !== 'mentorship-my-mentorship') &&
                          (isLeadLookupEnabled || s.subItemId !== 'lead-lookup') &&
                          (canCreateAssessment ||
                              !ASSESSMENT_CREATE_SUB_ITEM_IDS.has(s.subItemId || ''))
                  ),
              }));
        if (!roleDisplay) return base;

        // Build a lookup of what each sidebar item would look like with system
        // defaults (no naming-settings applied). Used below to distinguish
        // seeded cfg.label values from deliberate user customizations.
        const defaultItemsById = new Map(
            withSystemDefaults(() => getSidebarItemsData()).map((i) => [i.id, i])
        );

        const tabVis = new Map(roleDisplay.sidebar.map((t) => [t.id, t]));
        const mapped = base
            .filter((item) => {
                const cfg = tabVis.get(item.id);
                return cfg ? cfg.visible !== false : true;
            })
            .map((item) => {
                const cfg = tabVis.get(item.id);
                if (!cfg) return item;
                // To decide whether cfg.label is a stale seed or a real user
                // customization, compare it to the same item rendered with
                // system defaults (i.e. no naming-settings applied). Match =
                // seeded, fall back to dynamic item.title. Mismatch = user
                // explicitly customized the label, respect it.
                // defaultItem is resolved in English (the language every seed
                // was written in); item.title covers a seed saved while a
                // non-English UI was active. Either match = not a customization.
                const defaultItem = defaultItemsById.get(item.id);
                const isSeededTitle =
                    !cfg.label || cfg.label === defaultItem?.title || cfg.label === item.title;
                // Custom sub-tabs the admin added under this tab (ids that are
                // not among the tab's hardcoded default subItems, e.g.
                // "custom-sub-…"). The built-in flow below only draws from the
                // hardcoded defaults, so without this these saved sub-tabs
                // persist in Display Settings but never render in the nav.
                // Build the default-id set from the *unfiltered* defaults so a
                // feature-gated default (chat/ai-intelligence removed above) is
                // still recognized as a default and not re-added here.
                const defaultSubIds = new Set(
                    (defaultItem?.subItems || item.subItems || []).map((s) => s.subItemId)
                );
                const customSubs = (cfg.subTabs || [])
                    .filter((s) => s.visible !== false && !defaultSubIds.has(s.id))
                    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                    .map((s) => ({
                        subItem: s.label || s.id,
                        subItemLink: s.route,
                        subItemId: s.id,
                        locked: s.locked,
                    }));
                if (item.subItems && item.subItems.length > 0) {
                    const subVis = new Map((cfg.subTabs || []).map((s) => [s.id, s]));
                    const defaultSubsById = new Map(
                        (defaultItem?.subItems || []).map((s) => [s.subItemId, s])
                    );
                    const filteredSubs = item.subItems
                        .filter((s) => {
                            const c = subVis.get(s.subItemId);
                            return c ? c.visible !== false : true;
                        })
                        .sort((a, b) => {
                            const ao = subVis.get(a.subItemId)?.order ?? 0;
                            const bo = subVis.get(b.subItemId)?.order ?? 0;
                            return ao - bo;
                        })
                        .map((s) => {
                            const c = subVis.get(s.subItemId);
                            const defaultSub = defaultSubsById.get(s.subItemId);
                            const isSeededSubLabel =
                                !c?.label ||
                                c.label === defaultSub?.subItem ||
                                c.label === s.subItem;
                            return {
                                ...s,
                                subItem: isSeededSubLabel ? s.subItem : (c?.label as string),
                                subItemLink: c?.route ?? s.subItemLink,
                                locked: c?.locked,
                            };
                        });
                    return {
                        ...item,
                        title: isSeededTitle ? item.title : (cfg.label as string),
                        to: cfg.route ?? item.to,
                        subItems: [...filteredSubs, ...customSubs],
                        locked: cfg.locked,
                    };
                }
                // Built-in tab with no default subItems but the admin added
                // custom sub-tabs — surface it as a collapsible group of those.
                if (customSubs.length > 0) {
                    return {
                        ...item,
                        title: isSeededTitle ? item.title : (cfg.label as string),
                        to: cfg.route ?? item.to,
                        subItems: customSubs,
                        locked: cfg.locked,
                    };
                }
                return {
                    ...item,
                    title: isSeededTitle ? item.title : (cfg.label as string),
                    to: cfg.route ?? item.to,
                    locked: cfg.locked,
                };
            })
            .sort((a, b) => {
                const ao = tabVis.get(a.id)?.order ?? 0;
                const bo = tabVis.get(b.id)?.order ?? 0;
                return ao - bo;
            });

        // Add custom tabs
        const baseIds = new Set(base.map((b) => b.id));
        const customTabs: SidebarItemsType[] = roleDisplay.sidebar
            .filter((t) => t.isCustom && t.visible !== false && !baseIds.has(t.id))
            .map((t) => {
                // Convert the admin-configured sub-tabs into the sidebar's
                // subItems shape so custom tabs render as collapsible groups.
                // Mirror the built-in flow: drop hidden subs, order by `order`.
                const subItems = (t.subTabs || [])
                    .filter((s) => s.visible !== false)
                    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                    .map((s) => ({
                        subItem: s.label || s.id,
                        subItemLink: s.route,
                        subItemId: s.id,
                        locked: s.locked,
                    }));
                return {
                    icon: (() => null) as unknown as SidebarItemsType['icon'],
                    title: t.label || t.id,
                    to: t.route,
                    id: t.id,
                    locked: t.locked,
                    // Honor the category the admin chose when creating the custom tab.
                    // Without this, the panel filter defaults to 'CRM' and hides
                    // LMS/AI custom tabs even when they were saved with the right category.
                    category: t.category,
                    // Only attach subItems when there are visible sub-tabs — an
                    // empty array would force an empty collapsible (SidebarItem
                    // switches on truthiness, not length).
                    ...(subItems.length > 0 ? { subItems } : {}),
                };
            });
        return ([...mapped, ...customTabs] as SidebarItemsType[]).sort((a, b) => {
            const ao = tabVis.get(a.id)?.order ?? 0;
            const bo = tabVis.get(b.id)?.order ?? 0;
            return ao - bo;
        });
    })();
    // Then the institute's plan. In LEGACY this returns roleSidebarItems itself.
    const entitledItems = filterSidebarByEntitlement(roleSidebarItems, entitlement);
    // The LMS Dashboard holds the learning cards that the CRM Dashboard took off the
    // home page, so it exists only where the home page is the CRM Dashboard: people
    // who can see Leads (sub-org admins keep their own dashboard). Everyone else keeps
    // their dashboard as before.
    // It always heads the LMS section: a role whose sidebar order was saved before the
    // tab existed would otherwise rank it after every saved tab.
    const finalSidebarItems =
        !isCallerSubOrgAdmin() && entitledItems.some((item) => item.id === 'leads' && !item.locked)
            ? [
                  ...entitledItems.filter((item) => item.id === 'lms-dashboard'),
                  ...entitledItems.filter((item) => item.id !== 'lms-dashboard'),
              ]
            : entitledItems.filter((item) => item.id !== 'lms-dashboard');
    // MANAGED: the rail categories with anything left to show (the rail draws only
    // these). A string so the category sync below re-runs only when it changes.
    const availableCategoriesKey = entitlement.managed
        ? Array.from(categoriesWithItems(finalSidebarItems, data?.id)).sort().join(',')
        : null;

    // Sync active category with current route
    useEffect(() => {
        // If on /settings, always show as SETTINGS category
        if (currentRoute.startsWith('/settings')) {
            setActiveCategory('SETTINGS');
            return;
        }

        // Collect every category whose tab/sub-tab/custom-tab matches the current
        // route. Custom tabs (saved in roleDisplay.sidebar) are collected first so
        // they win over a static entry for the same route — e.g. an ERP custom tab
        // pointing at /manage-students/students-list, which CRM > Manage Contacts
        // also links to, must not flip the rail to CRM.
        const findMatchingCategories = (): Array<SidebarCategory> => {
            if (isVoltSubdomain) return ['LMS'];
            const hits: Array<SidebarCategory> = [];
            const push = (cat?: SidebarCategory) => {
                const c = cat || 'CRM';
                if (!hits.includes(c)) hits.push(c);
            };

            // Custom tabs from the saved role config — these have their own category.
            const customTabs = roleDisplay?.sidebar?.filter((t) => t.isCustom) || [];
            for (const t of customTabs) {
                if (t.route && currentRoute.startsWith(t.route)) {
                    push(t.category as SidebarCategory | undefined);
                }
                for (const s of t.subTabs || []) {
                    if (s.route && currentRoute.startsWith(s.route)) {
                        push(t.category as SidebarCategory | undefined);
                    }
                }
            }

            for (const item of getSidebarItemsData()) {
                if (item.id === 'settings') continue;
                if (item.to && currentRoute.startsWith(item.to)) push(item.category);
                if (item.subItems) {
                    for (const sub of item.subItems) {
                        const link = sub.subItemLink || '';
                        if (link && currentRoute.startsWith(link)) push(item.category);
                    }
                }
            }

            return hits;
        };

        const matches = findMatchingCategories();
        // When the user navigates and the category they are in also owns the new
        // route, stay there — they clicked it from that panel. Skipped on the first
        // sync (initial state is just a 'CRM' placeholder) and on same-route re-runs.
        const isNavigation =
            lastSyncedRouteRef.current !== null && lastSyncedRouteRef.current !== currentRoute;
        lastSyncedRouteRef.current = currentRoute;
        // Prefer a visible match, then the role's default visible category. MANAGED:
        // only categories with something to show — a page outside the plan matches
        // the static LMS/AI/ERP entries (or nothing) and would open an empty panel.
        const targetCategory = pickActiveCategory({
            matches,
            activeCategory,
            isNavigation,
            sidebarCategories: roleDisplay?.sidebarCategories,
            available:
                availableCategoriesKey === null
                    ? null
                    : new Set(
                          availableCategoriesKey.split(',').filter(Boolean) as SidebarCategory[]
                      ),
        });

        if (targetCategory && activeCategory !== 'RECENT' && activeCategory !== 'SETTINGS') {
            setActiveCategory(targetCategory);
        }
    }, [currentRoute, isVoltSubdomain, roleDisplay, availableCategoriesKey]);

    // Publish what the user can see for the route guard (locked deep links) —
    // only when it actually changed, since this list is rebuilt every render.
    const navSignature = JSON.stringify(
        finalSidebarItems.map((i) => [
            i.id,
            i.to,
            i.title,
            i.category,
            i.showForInstitute,
            !!i.locked,
            i.subItems?.map((s) => [s.subItemId, s.subItemLink, s.subItem, !!s.locked]),
        ])
    );
    const categoriesSignature = JSON.stringify(roleDisplay?.sidebarCategories ?? null);
    useEffect(() => {
        if (!data?.id) return;
        setNavSnapshot({
            instituteId: data.id,
            items: finalSidebarItems,
            sidebarCategories: roleDisplay?.sidebarCategories ?? null,
            settingsReady: roleDisplayResolved,
        });
        // finalSidebarItems/roleDisplay are captured through the signatures.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [navSignature, categoriesSignature, roleDisplayResolved, data?.id, setNavSnapshot]);

    // Browser tab title leads with the section ("All Leads · I2CAN"), so several
    // tabs open on lists that share one page can still be told apart.
    const activeSectionLabel = useActiveSidebarSection()?.label ?? null;
    const setSectionTitle = useTitleStore((s) => s.setSectionTitle);
    useEffect(() => {
        setSectionTitle(activeSectionLabel);
    }, [activeSectionLabel, setSectionTitle]);
    useEffect(() => () => setSectionTitle(null), [setSectionTitle]);

    // Logo
    const { getPublicUrl } = useFileUpload();
    const { instituteLogo, setInstituteLogo, brandingDisplay } = useInstituteLogoStore();

    useEffect(() => {
        const timer = setTimeout(() => {
            const fetchPublicUrl = async () => {
                const effectiveLogoId = subOrgInstituteDetails?.institute_logo_file_id
                    ? subOrgInstituteDetails.institute_logo_file_id
                    : getEffectiveInstituteLogoFileId(data?.institute_logo_file_id || undefined);

                if (effectiveLogoId) {
                    const publicUrl = await getPublicUrl(effectiveLogoId);
                    setInstituteLogo(publicUrl || '');
                } else {
                    setInstituteLogo('');
                }

                if (isPartnershipLinkage && data?.institute_logo_file_id) {
                    const mainUrl = await getPublicUrl(data.institute_logo_file_id);
                    setMainInstituteLogoUrl(mainUrl || '');
                } else {
                    setMainInstituteLogoUrl('');
                }
            };
            fetchPublicUrl();
        }, 300);
        return () => clearTimeout(timer);
    }, [
        data?.institute_logo_file_id,
        subOrgInstituteDetails?.institute_logo_file_id,
        getPublicUrl,
        setInstituteLogo,
        currentRoute,
        isPartnershipLinkage,
    ]);

    if (isLoading) return <DashboardLoader />;
    if (roleDisplay?.ui?.showSidebar === false) return null;

    const isPanelOpen = state === 'expanded';
    const showSupportButton = roleDisplay?.ui?.showSupportButton !== false;

    const effectiveInstituteName = subOrgInstituteDetails?.institute_name
        ? subOrgInstituteDetails.institute_name
        : data?.institute_name || '';

    // ─── Mobile: Sheet/Drawer ──────────────────────────────────
    if (isMobile) {
        return (
            <Sheet open={openMobile} onOpenChange={setOpenMobile}>
                <SheetContent side="left" className="w-80 border-r p-0">
                    <SheetHeader className="sr-only">
                        <SheetTitle>Navigation Menu</SheetTitle>
                    </SheetHeader>
                    <TooltipProvider delayDuration={0}>
                        <div className="pt-safe-native pb-safe-native flex h-full">
                            {/* Category Rail */}
                            <CategoryRail
                                activeCategory={activeCategory}
                                onCategoryChange={setActiveCategory}
                                roleDisplay={roleDisplay}
                                sidebarItems={finalSidebarItems}
                                instituteId={data?.id}
                                hideEmptyCategories={entitlement.managed}
                            />

                            {/* Panel */}
                            <SidebarPanel
                                isOpen={true}
                                activeCategory={activeCategory}
                                sidebarItems={finalSidebarItems}
                                instituteLogo={instituteLogo}
                                instituteName={effectiveInstituteName}
                                roleDisplay={roleDisplay}
                                onItemClick={() => setOpenMobile(false)}
                                sidebarComponent={sidebarComponent}
                                showSupportButton={showSupportButton}
                                instituteId={data?.id}
                                isPartnershipLinkage={isPartnershipLinkage}
                                mainInstituteLogoUrl={mainInstituteLogoUrl}
                                mainInstituteName={data?.institute_name || ''}
                                hideInstituteName={brandingDisplay.hideInstituteName}
                                logoWidthPx={brandingDisplay.logoWidthPx}
                                logoHeightPx={brandingDisplay.logoHeightPx}
                                stackNameBelowLogo={brandingDisplay.stackNameBelowLogo}
                            />
                        </div>
                    </TooltipProvider>
                </SheetContent>
            </Sheet>
        );
    }

    // ─── Desktop: Two-bar sidebar ──────────────────────────────
    return (
        <Sidebar collapsible="icon" className="z-20 !border-0">
            <SidebarContent
                className={cn(
                    'sidebar-content pt-safe-native pb-safe-native !flex !flex-row !gap-0 !overflow-hidden border-r-0 bg-transparent py-0'
                )}
            >
                <TooltipProvider delayDuration={0}>
                    {/* Left: Category Rail (always visible) */}
                    <CategoryRail
                        activeCategory={activeCategory}
                        onCategoryChange={setActiveCategory}
                        roleDisplay={roleDisplay}
                        sidebarItems={finalSidebarItems}
                        instituteId={data?.id}
                        hideEmptyCategories={entitlement.managed}
                    />

                    {/* Right: Panel (always mounted, animates width) */}
                    <SidebarPanel
                        isOpen={isPanelOpen}
                        activeCategory={activeCategory}
                        sidebarItems={finalSidebarItems}
                        instituteLogo={instituteLogo}
                        instituteName={effectiveInstituteName}
                        roleDisplay={roleDisplay}
                        sidebarComponent={sidebarComponent}
                        showSupportButton={showSupportButton}
                        instituteId={data?.id}
                        isPartnershipLinkage={isPartnershipLinkage}
                        mainInstituteLogoUrl={mainInstituteLogoUrl}
                        mainInstituteName={data?.institute_name || ''}
                        hideInstituteName={brandingDisplay.hideInstituteName}
                        logoWidthPx={brandingDisplay.logoWidthPx}
                        logoHeightPx={brandingDisplay.logoHeightPx}
                        stackNameBelowLogo={brandingDisplay.stackNameBelowLogo}
                    />
                </TooltipProvider>
            </SidebarContent>
        </Sidebar>
    );
};
