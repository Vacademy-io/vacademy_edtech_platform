/**
 * SidebarPanel — The wider second panel (Gmail-style)
 *
 * Shows institute logo + name at top, then the menu items for the active category.
 * On collapse, this panel hides entirely (only CategoryRail remains visible).
 * When collapsed, hovering a category rail item shows a flyout popover with the tabs.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { SidebarItemsType } from '@/types/layout-container/layout-container-types';
import { SidebarItem } from './sidebar-item';
import { SidebarMenu, SidebarMenuItem } from '@/components/ui/sidebar';
import {
    Question,
    Tabs,
    UserGear,
    Student,
    TextAa,
    Bell,
    CreditCard,
    Gift,
    BookOpen,
    Sliders,
    Certificate,
    Layout,
    Brain,
    GearSix,
    Medal,
    PaintBrush,
    Globe,
    FileText,
    Translate,
    Robot,
    Stack,
    ClipboardText,
    VideoCamera,
    ShieldCheck,
    LockKey,
    Funnel,
    GraduationCap,
    Users,
    DoorOpen,
    Wallet,
    Receipt,
    Ticket,
    Phone,
    Waveform,
    ChartLineUp,
    WhatsappLogo,
    Lightning,
    Megaphone,
    YoutubeLogo,
    Tag,
    MagnifyingGlass,
    CaretDown,
    type IconProps,
} from '@phosphor-icons/react';
import { MyInput } from '@/components/design-system/input';
import { SupportPanel } from '@/components/common/support/SupportPanel';
import { useSupportConfig } from '@/services/support';
import { getRecentTabs, type RecentTabEntry } from './recent-tabs-store';
import { parseSidebarLink, pickActiveSidebarLink } from './helper';
import { filterRecentEntries } from '@/lib/capabilities/nav-access';
import { useEntitlement } from '@/lib/capabilities/use-entitlement';
import { filterSettingsTabs } from '@/routes/settings/-utils/settings-entitlements';
import { Link, useLocation, useNavigate } from '@tanstack/react-router';
import { useRouter, useRouterState } from '@tanstack/react-router';
import { getCategoryColors } from './sidebar-colors';
import type { CategoryId } from './category-rail';
import { useIsMobile } from '@/hooks/use-mobile';
import type { DisplaySettingsData } from '@/types/display-settings';
import {
    getAvailableSettingsTabs,
    SETTINGS_DOMAIN_ORDER,
    SETTINGS_GROUP_ORDER,
    type SettingsTabEntry,
} from '@/routes/settings/-utils/utils';

/** Fixed width of the open panel, in px. */
const PANEL_WIDTH_PX = 250;

interface SidebarPanelProps {
    isOpen: boolean;
    activeCategory: CategoryId;
    sidebarItems: SidebarItemsType[];
    instituteLogo: string;
    instituteName: string;
    roleDisplay: DisplaySettingsData | null;
    onItemClick?: () => void;
    sidebarComponent?: React.ReactNode;
    showSupportButton?: boolean;
    instituteId?: string;
    isPartnershipLinkage?: boolean;
    mainInstituteLogoUrl?: string;
    mainInstituteName?: string;
    hideInstituteName?: boolean;
    logoWidthPx?: number | null;
    logoHeightPx?: number | null;
    stackNameBelowLogo?: boolean;
}

export const SidebarPanel: React.FC<SidebarPanelProps> = ({
    isOpen,
    activeCategory,
    sidebarItems,
    instituteLogo,
    instituteName,
    roleDisplay,
    onItemClick,
    sidebarComponent,
    showSupportButton = true,
    instituteId,
    isPartnershipLinkage,
    mainInstituteLogoUrl,
    mainInstituteName,
    hideInstituteName = false,
    logoWidthPx = null,
    logoHeightPx = null,
    stackNameBelowLogo = false,
}) => {
    const { t } = useTranslation('sidebarPanel');
    const navigate = useNavigate();
    const router = useRouter();
    const currentRoute = router.state.location.pathname;
    const isMobile = useIsMobile();

    // Filter items by active category
    const filteredItems =
        activeCategory === 'RECENT'
            ? [] // Recent items are handled separately
            : sidebarItems.filter((item) => {
                  if (item.id === 'settings') return false; // Settings is on the rail
                  const show = item.showForInstitute;
                  const category = item.category || 'CRM';
                  return (!show || show === instituteId) && category === activeCategory;
              });

    // Recent offers only what the sidebar shows right now and is not locked: an
    // entry recorded before a tab was hidden, locked or left the plan would
    // otherwise be a way around it. Settings screens follow the rail's gear rule.
    const hasSettings = sidebarItems.some((item) => item.id === 'settings');
    const recentTabs =
        activeCategory === 'RECENT'
            ? filterRecentEntries(getRecentTabs(), sidebarItems, {
                  instituteId,
                  sidebarCategories: roleDisplay?.sidebarCategories,
                  canOpenSettings: hasSettings
                      ? roleDisplay?.ui?.showSettings !== false
                      : roleDisplay?.ui?.showSettings === true,
              })
            : [];

    // On mobile, the panel is always rendered at full width inside the Sheet
    const panelOpen = isMobile ? true : isOpen;

    // Full-bleed logo: width configured at (or beyond) the whole panel AND no explicit
    // height. Then we drop the header's horizontal padding so the logo reaches both
    // edges and let it scale by width alone.
    //
    // Both conditions matter. Many institutes already run a width above the padded
    // content box (250 - 2*16 = 218px) together with a fixed height — that pair is a
    // deliberate "as wide as fits, capped at N px tall" box and must keep rendering
    // exactly as before, so a width test alone would silently restyle them. Requiring
    // a blank height keeps full-bleed opt-in: an operator asks for it by clearing the
    // height, which is also the only way to avoid the logo being letterboxed back down
    // to a fraction of the panel width.
    const logoSpansFullWidth =
        logoWidthPx != null && logoWidthPx >= PANEL_WIDTH_PX && logoHeightPx == null;

    // Settings tabs for the SETTINGS category (MANAGED: only the plan's screens)
    const entitlement = useEntitlement();
    const settingsTabs =
        activeCategory === 'SETTINGS'
            ? filterSettingsTabs(getAvailableSettingsTabs(), entitlement)
            : [];
    // Reactively read the selectedTab search param from the URL
    const routerState = useRouterState({ select: (s) => s.location.search });
    const activeSettingsTab =
        (routerState as unknown as Record<string, string>)?.selectedTab || 'tab';

    return (
        <div
            className={cn(
                'flex h-full flex-col border-r border-neutral-200 bg-neutral-50',
                'transition-[width,opacity] duration-200 ease-in-out',
                'overflow-hidden'
            )}
            style={{
                width: panelOpen ? PANEL_WIDTH_PX : 0,
                opacity: panelOpen ? 1 : 0,
                minWidth: panelOpen ? PANEL_WIDTH_PX : 0,
            }}
        >
            {/* Logo + Institute Name Header */}
            <div className="flex flex-col border-b border-neutral-200">
                <div
                    className={cn(
                        'flex cursor-pointer items-center',
                        logoSpansFullWidth
                            ? // Full-bleed logo: no horizontal padding at all so the
                              // logo reaches both panel edges (vertical padding stays,
                              // so it isn't flush against the top border). The name
                              // (when shown) stacks below it with its own padding.
                              'flex-col gap-2 py-4 text-center'
                            : hideInstituteName
                              ? // Name hidden: logo alone, but keep the same header
                                // padding as the other branches so it never touches
                                // the panel edges or the bottom divider.
                                'justify-center px-4 py-4'
                              : stackNameBelowLogo
                                ? 'flex-col gap-2 px-4 py-4 text-center'
                                : 'gap-2.5 px-4 py-4'
                    )}
                    onClick={() => {
                        navigate({ to: '/dashboard' });
                        onItemClick?.();
                    }}
                >
                    {instituteLogo &&
                        (() => {
                            const hasCustom = logoWidthPx != null || logoHeightPx != null;
                            if (hasCustom) {
                                // maxWidth: 100% caps the logo at the available panel width
                                // so an admin-configured pixel width larger than the panel
                                // doesn't overflow — it just fills the available space.
                                // Full-bleed: width drives, height stays auto so the logo
                                // keeps its aspect ratio while filling the panel edge to edge.
                                return (
                                    <img
                                        src={instituteLogo}
                                        alt={t('logoAlt')}
                                        className="object-contain"
                                        style={{
                                            width: logoSpansFullWidth
                                                ? '100%'
                                                : logoWidthPx ?? undefined,
                                            height: logoSpansFullWidth
                                                ? 'auto'
                                                : logoHeightPx ?? undefined,
                                            maxWidth: '100%',
                                        }}
                                    />
                                );
                            }
                            return (
                                <img
                                    src={instituteLogo}
                                    alt="logo"
                                    className="h-8 w-auto max-w-[36px] shrink-0 object-contain"
                                />
                            );
                        })()}
                    {!hideInstituteName && (
                        <span
                            className={cn(
                                'text-sm font-semibold text-neutral-800',
                                // Stacked: wrap the full name across as many lines
                                // as needed (centered), never truncated. Beside the
                                // logo: single-line ellipsis.
                                stackNameBelowLogo || logoSpansFullWidth
                                    ? 'w-full break-words'
                                    : 'truncate',
                                // Full-bleed logo strips the header padding, so the
                                // name carries its own.
                                logoSpansFullWidth && 'px-4'
                            )}
                            title={instituteName}
                        >
                            {instituteName}
                        </span>
                    )}
                </div>
                {isPartnershipLinkage && mainInstituteName && (
                    <div className="flex items-center gap-2 px-4 pb-3 ps-14 text-neutral-500">
                        <span className="whitespace-nowrap text-[10px] font-medium text-neutral-500">
                            {t('poweredBy')}
                        </span>
                        {mainInstituteLogoUrl ? (
                            <div className="flex shrink-0 items-center justify-center overflow-hidden rounded">
                                <img
                                    src={mainInstituteLogoUrl}
                                    alt={mainInstituteName}
                                    className="h-6 w-auto max-w-[100px] object-contain"
                                    aria-hidden
                                />
                            </div>
                        ) : (
                            <span className="truncate text-xs font-bold text-neutral-700">
                                {mainInstituteName}
                            </span>
                        )}
                    </div>
                )}
            </div>

            {/* Divider */}
            <div className="mx-3 my-1" />

            {/* Menu Items */}
            <div className="sidebar-content flex-1 overflow-y-auto px-1.5 py-2">
                {sidebarComponent ? (
                    sidebarComponent
                ) : activeCategory === 'SETTINGS' ? (
                    <SettingsTabsList
                        tabs={settingsTabs}
                        activeTab={activeSettingsTab}
                        onItemClick={onItemClick}
                    />
                ) : activeCategory === 'RECENT' ? (
                    <RecentTabsList entries={recentTabs} onItemClick={onItemClick} />
                ) : (
                    <SidebarMenu className="flex flex-col gap-0.5">
                        {filteredItems.map((obj, key) => (
                            <SidebarMenuItem
                                key={key}
                                id={obj.id}
                                onClick={() => {
                                    if (!obj.subItems) {
                                        onItemClick?.();
                                    }
                                }}
                            >
                                <SidebarItem {...obj} />
                            </SidebarMenuItem>
                        ))}
                    </SidebarMenu>
                )}
            </div>

            {/* Support button at bottom */}
            {showSupportButton && !currentRoute.includes('slides') && (
                <div className="mt-auto border-t border-neutral-200 px-1.5 py-2">
                    <SupportOptions />
                </div>
            )}
        </div>
    );
};

// ─── Recent Tabs List ──────────────────────────────────────────

interface RecentTabsListProps {
    entries: RecentTabEntry[];
    onItemClick?: () => void;
}

const RecentTabsList: React.FC<RecentTabsListProps> = ({ entries, onItemClick }) => {
    const { t } = useTranslation('sidebarPanel');
    // Recorded routes carry their query (?status=…&lock=status), so match them the
    // way the panel does rather than by pathname.
    const { pathname, search } = useLocation();
    const activeRoute = pickActiveSidebarLink(
        entries.map((entry) => entry.route),
        pathname,
        search as Record<string, unknown>
    );

    if (entries.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center">
                <p className="text-xs text-neutral-400">{t('recentTabs.emptyTitle')}</p>
                <p className="text-[10px] text-neutral-300">{t('recentTabs.emptyDescription')}</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-0.5">
            <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                {t('recentTabs.heading')}
            </p>
            {entries.map((entry, idx) => {
                const colors = getCategoryColors(entry.category);
                const isActive = entry.route === activeRoute;
                // Recorded routes can include a query ("/settings?selectedTab=…").
                const { to: entryTo, search: entrySearch } = parseSidebarLink(entry.route);
                return (
                    <Link
                        key={`${entry.route}-${idx}`}
                        to={entryTo}
                        search={entrySearch}
                        onClick={() => onItemClick?.()}
                        className={cn(
                            'flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-all duration-150',
                            isActive
                                ? cn(colors.pillBg, colors.pillText, 'font-medium')
                                : 'text-neutral-600 hover:bg-neutral-100'
                        )}
                    >
                        {/* Category dot */}
                        <span
                            className={cn(
                                'h-1.5 w-1.5 flex-shrink-0 rounded-full',
                                colors.text.replace('text-', 'bg-')
                            )}
                        />
                        <span className="truncate">{entry.label}</span>
                    </Link>
                );
            })}
        </div>
    );
};

// ─── Support Options ───────────────────────────────────────────

/** Maps a support-plan key to its translation key under `support.plan.*`. */
const SUPPORT_PLAN_TRANSLATION_KEY: Record<string, string> = {
    DEDICATED: 'support.plan.dedicated',
    PREMIUM: 'support.plan.premium',
    AVERAGE: 'support.plan.average',
    LOW: 'support.plan.low',
    NONE: 'support.plan.none',
};

function SupportOptions() {
    const { t } = useTranslation('sidebarPanel');
    const [open, setOpen] = React.useState(false);
    const [hover, setHover] = React.useState(false);
    const config = useSupportConfig();
    const planKey = config.data?.plan?.key;
    const planLabelKey = planKey ? SUPPORT_PLAN_TRANSLATION_KEY[planKey] : null;
    const planLabel = planLabelKey ? t(planLabelKey) : planKey ?? null;

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-white"
                onMouseEnter={() => setHover(true)}
                onMouseLeave={() => setHover(false)}
            >
                <Question
                    className={cn('size-5', hover ? 'text-teal-600' : 'text-neutral-400')}
                    weight={hover ? 'fill' : 'regular'}
                />
                <span
                    className={cn(
                        'text-sm transition-colors',
                        hover ? 'text-teal-600' : 'text-neutral-500'
                    )}
                >
                    {t('support.button')}
                </span>
                {planLabel ? (
                    <span
                        className="ms-auto rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-500"
                        title={t('support.planTooltip', { plan: planLabel })}
                    >
                        {planLabel}
                    </span>
                ) : null}
            </button>
            <SupportPanel open={open} onOpenChange={setOpen} />
        </>
    );
}

// ─── Settings Tabs List ────────────────────────────────────────

/** Map settings tab keys to unique icons — also reused by sidebar-search.tsx */
export const SETTINGS_TAB_ICONS: Record<string, React.FC<IconProps>> = {
    tab: Tabs,
    appearance: PaintBrush,
    whiteLabel: Globe,
    naming: TextAa,
    roleDisplay: UserGear,
    tnc: FileText,
    customFields: Sliders,
    language: Translate,
    aiSettings: Brain,
    assistantTools: Robot,
    course: BookOpen,
    lms: Stack,
    assessment: ClipboardText,
    certificates: Certificate,
    badgesRewards: Medal,
    liveSession: VideoCamera,
    doubtManagement: Question,
    contentProtection: ShieldCheck,
    studentDisplay: Student,
    leadSettings: Funnel,
    referral: Gift,
    schoolSettings: GraduationCap,
    guardianSettings: Users,
    onboardingSettings: DoorOpen,
    payment: CreditCard,
    paymentGateways: Wallet,
    invoice: Receipt,
    coupons: Ticket,
    telephony: Phone,
    aiCalling: Waveform,
    crmIntelligence: ChartLineUp,
    whatsapp: WhatsappLogo,
    templates: Layout,
    automations: Lightning,
    notification: Bell,
    integrations: Megaphone,
    youtube: YoutubeLogo,
    gtmSettings: Tag,
    security: LockKey,
};

interface SettingsTabsListProps {
    tabs: SettingsTabEntry[];
    activeTab: string;
    onItemClick?: () => void;
}

const SettingsTabsList: React.FC<SettingsTabsListProps> = ({ tabs, activeTab, onItemClick }) => {
    const { t } = useTranslation('sidebarPanel');

    // Group by domain, then by group, driven by the fixed order arrays —
    // never by this array's authoring order, which is free to change.
    const groupedByDomain = React.useMemo(() => {
        const byDomain = new Map<string, Map<string, SettingsTabEntry[]>>();
        tabs.forEach((tab) => {
            if (!byDomain.has(tab.domain)) byDomain.set(tab.domain, new Map());
            const byGroup = byDomain.get(tab.domain)!;
            if (!byGroup.has(tab.group)) byGroup.set(tab.group, []);
            byGroup.get(tab.group)!.push(tab);
        });
        return byDomain;
    }, [tabs]);

    // The domain containing the currently active tab starts expanded; every
    // other domain starts collapsed to just its header, so the resting view
    // is 7 short lines instead of a full 37-item scroll.
    const activeDomain = React.useMemo(
        () => tabs.find((tab) => tab.tab === activeTab)?.domain,
        [tabs, activeTab]
    );
    const [expandedDomains, setExpandedDomains] = React.useState<Set<string>>(
        () => new Set(activeDomain ? [activeDomain] : [])
    );
    const toggleDomain = (domain: string) => {
        setExpandedDomains((prev) => {
            const next = new Set(prev);
            if (next.has(domain)) next.delete(domain);
            else next.add(domain);
            return next;
        });
    };

    const [query, setQuery] = React.useState('');
    const trimmedQuery = query.trim().toLowerCase();
    const isSearching = trimmedQuery.length > 0;
    const matchesQuery = (tab: SettingsTabEntry, domain: string) =>
        tab.value.toLowerCase().includes(trimmedQuery) ||
        tab.group.toLowerCase().includes(trimmedQuery) ||
        domain.toLowerCase().includes(trimmedQuery);

    return (
        <div className="flex flex-col gap-0.5">
            <div className="relative px-2 pb-2 pt-1">
                <MyInput
                    inputType="text"
                    input={query}
                    onChangeFunction={(e) => setQuery(e.target.value)}
                    inputPlaceholder={t('settings.searchPlaceholder')}
                    className="h-8 ps-8 text-caption"
                />
                <MagnifyingGlass className="absolute start-4 top-1/2 size-3.5 -translate-y-1/2 text-neutral-400" />
            </div>
            {SETTINGS_DOMAIN_ORDER.map((domain) => {
                const groups = groupedByDomain.get(domain);
                if (!groups) return null;

                const groupEntries = (SETTINGS_GROUP_ORDER[domain] || [])
                    .map((group) => ({
                        group,
                        items: (groups.get(group) || []).filter(
                            (tab) => !isSearching || matchesQuery(tab, domain)
                        ),
                    }))
                    .filter(({ items }) => items.length > 0);
                if (isSearching && groupEntries.length === 0) return null;

                const isExpanded = isSearching || expandedDomains.has(domain);

                return (
                    <div key={domain}>
                        <button
                            type="button"
                            onClick={() => toggleDomain(domain)}
                            className="flex w-full items-center justify-between px-3 pb-1 pt-3 text-caption font-semibold uppercase tracking-wider text-neutral-400 hover:text-neutral-600"
                        >
                            <span>{domain}</span>
                            <CaretDown
                                className={cn(
                                    'size-3 shrink-0 transition-transform',
                                    !isExpanded && '-rotate-90'
                                )}
                            />
                        </button>
                        {isExpanded &&
                            groupEntries.map(({ group, items }, groupIdx) => (
                                <div
                                    key={group}
                                    className={cn(
                                        'flex flex-col gap-0.5',
                                        // Groups are separated by a hairline rather than a
                                        // label — the domain header is the only text tier.
                                        groupIdx > 0 && 'mt-1 border-t border-neutral-200/70 pt-1'
                                    )}
                                >
                                    {items.map((tab) => {
                                        const isActive = activeTab === tab.tab;
                                        const Icon = SETTINGS_TAB_ICONS[tab.tab] || GearSix;
                                        return (
                                            <Link
                                                key={tab.tab}
                                                to="/settings"
                                                search={{ selectedTab: tab.tab }}
                                                onClick={() => onItemClick?.()}
                                                className={cn(
                                                    'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-all duration-150',
                                                    isActive
                                                        ? 'bg-primary-50 font-medium text-neutral-800'
                                                        : 'text-neutral-600 hover:bg-neutral-100'
                                                )}
                                            >
                                                <Icon
                                                    size={16}
                                                    weight={isActive ? 'fill' : 'regular'}
                                                    className={cn(
                                                        'shrink-0 transition-colors',
                                                        isActive
                                                            ? 'text-neutral-800'
                                                            : 'text-neutral-400'
                                                    )}
                                                />
                                                <span className="truncate">{tab.value}</span>
                                            </Link>
                                        );
                                    })}
                                </div>
                            ))}
                    </div>
                );
            })}
        </div>
    );
};
