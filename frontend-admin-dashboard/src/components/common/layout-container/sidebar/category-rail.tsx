/**
 * CategoryRail — The narrow left vertical bar (Gmail-style)
 *
 * Shows category icons (CRM, LMS, AI, ERP) + Recent tabs + Settings (admin-only).
 * Each category has icon + small label below.
 * Active category gets a pill-shaped indicator.
 *
 * When the panel is collapsed, hovering a category shows a flyout popover
 * with all tabs for that category.
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Briefcase,
    GraduationCap,
    Sparkle,
    ClockCounterClockwise,
    GearSix,
    MagnifyingGlass,
    LockKey,
    Heartbeat, Bank } from '@phosphor-icons/react';
import { SidebarSearch } from './sidebar-search';
import { cn } from '@/lib/utils';
import { CATEGORY_COLORS } from './sidebar-colors';
import { ConnectionStatusPill } from '@/components/common/perf/ConnectionStatusPill';
import { motion } from 'framer-motion';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import type { DisplaySettingsData } from '@/types/display-settings';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { useSidebar } from '@/components/ui/sidebar';
import { SidebarItemsType, SidebarCategory } from '@/types/layout-container/layout-container-types';
import { CategoryFlyoutMenu } from './collapsed-category-flyout';
import { useIsMobile } from '@/hooks/use-mobile';
import type { TFunction } from 'i18next';
import { categoriesWithItems } from '@/lib/capabilities/nav-access';

export type CategoryId = SidebarCategory | 'RECENT' | 'SETTINGS';

interface CategoryRailProps {
    activeCategory: CategoryId;
    onCategoryChange: (category: CategoryId) => void;
    roleDisplay: DisplaySettingsData | null;
    /** All sidebar items (used for flyout when collapsed) */
    sidebarItems?: SidebarItemsType[];
    /** Institute ID for filtering */
    instituteId?: string;
    /**
     * Drop categories with no tab to show. On only for MANAGED institutes (a
     * module switched off can empty a whole category); LEGACY keeps every
     * category as before.
     */
    hideEmptyCategories?: boolean;
}

interface CategoryConfig {
    id: CategoryId;
    label: string;
    icon: React.FC<any>;
}

const buildBaseCategories = (t: TFunction): CategoryConfig[] => [
    { id: 'CRM', label: t('categories.crm'), icon: Briefcase },
    { id: 'LMS', label: t('categories.lms'), icon: GraduationCap },
    { id: 'AI', label: t('categories.ai'), icon: Sparkle },
    { id: 'ERP', label: t('categories.erp'), icon: Bank },
];

export const CategoryRail: React.FC<CategoryRailProps> = ({
    activeCategory,
    onCategoryChange,
    roleDisplay,
    sidebarItems = [],
    instituteId,
    hideEmptyCategories = false,
}) => {
    const navigate = useNavigate();
    const router = useRouter();
    const currentRoute = router.state.location.pathname;
    const { state } = useSidebar();
    const isMobile = useIsMobile();
    const isPanelCollapsed = state === 'collapsed' && !isMobile;
    const [searchOpen, setSearchOpen] = useState(false);
    const { t } = useTranslation('categoryRail');

    // Check if Settings should be shown (it exists in finalSidebarItems only for admins)
    const hasSettings = sidebarItems.some((item) => item.id === 'settings');

    // The pinned Status link defaults visible for every role; an explicit
    // `false` hides it.
    const showStatusLink = roleDisplay?.ui?.showStatus !== false;
    // Settings gear visibility. `hasSettings` is true only for admins — the
    // 'settings' item is stripped for every non-admin role by
    // filterSidebarByRole. So:
    //   - Admins: shown unless explicitly hidden (showSettings !== false).
    //   - Non-admin roles (teacher/custom): the gear is NOT available by
    //     default; it appears only when the role is explicitly opted in
    //     (showSettings === true). Opting in also gives that role a doorway
    //     into the full settings page, so it stays deliberate/opt-in.
    const showSettingsButton = hasSettings
        ? roleDisplay?.ui?.showSettings !== false
        : roleDisplay?.ui?.showSettings === true;

    // Sort categories by display settings order
    const sortedCategories = [...buildBaseCategories(t)].sort((a, b) => {
        const cfgA = roleDisplay?.sidebarCategories?.find((c) => c.id === a.id);
        const cfgB = roleDisplay?.sidebarCategories?.find((c) => c.id === b.id);
        return (cfgA?.order ?? 0) - (cfgB?.order ?? 0);
    });

    // Filter by visibility
    const nonEmptyCategories = hideEmptyCategories
        ? categoriesWithItems(sidebarItems, instituteId)
        : null;
    const visibleCategories = sortedCategories.filter((cat) => {
        if (cat.id === 'RECENT') return true;
        if (nonEmptyCategories && !nonEmptyCategories.has(cat.id as SidebarCategory)) {
            return false;
        }
        const cfg = roleDisplay?.sidebarCategories?.find((c) => c.id === cat.id);
        return cfg ? cfg.visible !== false : true;
    });

    // Get items for a specific category (excluding settings from CRM)
    const getItemsForCategory = (catId: SidebarCategory) => {
        return sidebarItems.filter((item) => {
            if (item.id === 'settings') return false; // Settings is rendered separately
            const show = item.showForInstitute;
            const category = item.category || 'CRM';
            return (!show || show === instituteId) && category === catId;
        });
    };

    const isSettingsActive = currentRoute.startsWith('/settings');

    const renderCategoryButton = (cat: CategoryConfig) => {
        const isActive = activeCategory === cat.id && !isSettingsActive;
        const colors =
            cat.id !== 'RECENT'
                ? CATEGORY_COLORS[cat.id as SidebarCategory]
                : null;
        const isLocked =
            cat.id !== 'RECENT' &&
            roleDisplay?.sidebarCategories?.find((c) => c.id === cat.id)?.locked;

        const buttonContent = (
            <button
                className={cn(
                    'relative flex w-14 flex-col items-center gap-0.5 rounded-xl px-1 py-2.5 transition-all duration-200',
                    'hover:bg-white/10',
                    isLocked && 'cursor-not-allowed opacity-60'
                )}
                onClick={() => {
                    if (isLocked) {
                        navigate({
                            to: '/locked-feature',
                            search: { feature: t('categoryFeatureLabel', { category: cat.label }) },
                        });
                        return;
                    }
                    onCategoryChange(cat.id);
                }}
            >
                {/* Animated pill background */}
                {isActive && (
                    <motion.div
                        layoutId="category-rail-active"
                        className={cn(
                            'absolute inset-0 rounded-xl',
                            colors?.railActiveBg || 'bg-white'
                        )}
                        transition={{
                            type: 'spring',
                            bounce: 0.15,
                            duration: 0.5,
                        }}
                    />
                )}

                {/* Icon */}
                <span className="relative z-10">
                    {isLocked ? (
                        <LockKey
                            size={22}
                            weight="duotone"
                            className="text-neutral-400"
                        />
                    ) : (
                        React.createElement(cat.icon, {
                            size: 22,
                            weight: isActive ? 'fill' : 'regular',
                            className: cn(
                                'transition-colors duration-200',
                                isActive
                                    ? colors?.railIconActive || 'text-primary-600'
                                    : 'text-white/70'
                            ),
                        })
                    )}
                </span>

                {/* Label */}
                <span
                    className={cn(
                        'relative z-10 text-2xs font-medium leading-tight transition-colors duration-200',
                        isActive
                            ? colors?.text || 'text-white'
                            : 'text-white/70'
                    )}
                >
                    {cat.label}
                </span>
            </button>
        );

        // When collapsed, wrap category buttons with flyout menus
        if (isPanelCollapsed && cat.id !== 'RECENT' && !isLocked) {
            const catItems = getItemsForCategory(cat.id as SidebarCategory);
            return (
                <CategoryFlyoutMenu
                    key={cat.id}
                    category={cat.id as SidebarCategory}
                    items={catItems}
                >
                    {buttonContent}
                </CategoryFlyoutMenu>
            );
        }

        return <React.Fragment key={cat.id}>{buttonContent}</React.Fragment>;
    };

    return (
        <div className="flex h-full w-16 flex-shrink-0 flex-col items-center border-r border-primary-600 bg-nav-surface py-3">
            {/* Search Icon */}
            <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                    <button
                        className={cn(
                            'mb-2 flex w-10 items-center justify-center rounded-lg p-2 transition-all duration-200',
                            'text-white/70 hover:bg-white/10 hover:text-white'
                        )}
                        onClick={() => setSearchOpen(true)}
                    >
                        <MagnifyingGlass size={20} weight="regular" />
                    </button>
                </TooltipTrigger>
                {!isMobile && (
                    <TooltipContent side="right" className="flex items-center gap-2 font-medium">
                        {t('search')}
                        <kbd className="rounded border border-primary-400 bg-primary-500 px-1.5 py-0.5 text-2xs font-medium text-white">
                            ⌘K
                        </kbd>
                    </TooltipContent>
                )}
            </Tooltip>

            {/* Divider after search */}
            <div className="mb-1 h-px w-8 bg-primary-400/50" />

            {/* Category Icons */}
            <div className="flex flex-1 flex-col items-center gap-1">
                {visibleCategories.map((cat) => renderCategoryButton(cat))}

                {/* Divider before Recent */}
                <div className="my-1 h-px w-8 bg-primary-400/50" />

                {/* Recent Tab */}
                        <button
                            className={cn(
                                'relative flex w-14 flex-col items-center gap-0.5 rounded-xl px-1 py-2.5 transition-all duration-200',
                                'hover:bg-white/10',
                            )}
                            onClick={() => onCategoryChange('RECENT')}
                        >
                            {activeCategory === 'RECENT' && !isSettingsActive && (
                                <motion.div
                                    layoutId="category-rail-active"
                                    className="absolute inset-0 rounded-xl bg-white"
                                    transition={{
                                        type: 'spring',
                                        bounce: 0.15,
                                        duration: 0.5,
                                    }}
                                />
                            )}
                            <span className="relative z-10">
                                <ClockCounterClockwise
                                    size={22}
                                    weight={activeCategory === 'RECENT' && !isSettingsActive ? 'fill' : 'regular'}
                                    className={cn(
                                        'transition-colors duration-200',
                                        activeCategory === 'RECENT' && !isSettingsActive
                                            ? 'text-neutral-900'
                                            : 'text-white/70'
                                    )}
                                />
                            </span>
                            <span
                                className={cn(
                                    'relative z-10 text-2xs font-medium leading-tight transition-colors duration-200',
                                    activeCategory === 'RECENT' && !isSettingsActive
                                        ? 'text-neutral-900'
                                        : 'text-white/70'
                                )}
                            >
                                {t('recent')}
                            </span>
                        </button>
            </div>

            {/* ─── Service health / status page (external, pinned above Settings) ──── */}
            {/* Live speed indicator — always visible, directly above Status. */}
            <ConnectionStatusPill />

            {showStatusLink && (
                <a
                    href="https://status.vacademy.io"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                        'relative flex w-14 flex-col items-center gap-0.5 rounded-xl px-1 py-2.5 transition-all duration-200',
                        'hover:bg-white/10'
                    )}
                    aria-label={t('serviceStatus')}
                    title={t('serviceStatus')}
                >
                    <span className="relative z-10">
                        <Heartbeat
                            size={22}
                            className="text-white/70 transition-colors duration-200"
                        />
                    </span>
                    <span className="relative z-10 text-2xs font-medium leading-tight text-white/70 transition-colors duration-200">
                        {t('status')}
                    </span>
                </a>
            )}

            {/* ─── Settings (admin-only, pinned to bottom) ──── */}
            {showSettingsButton && (
                <>
                    <div className="my-1 h-px w-8 bg-primary-400/50" />
                    <button
                        className={cn(
                            'relative flex w-14 flex-col items-center gap-0.5 rounded-xl px-1 py-2.5 transition-all duration-200',
                            'hover:bg-white/10',
                        )}
                        onClick={() => {
                            navigate({ to: '/settings', search: { selectedTab: 'tab' } });
                            onCategoryChange('SETTINGS');
                        }}
                    >
                        {isSettingsActive && (
                            <motion.div
                                layoutId="category-rail-active"
                                className="absolute inset-0 rounded-xl bg-white"
                                transition={{
                                    type: 'spring',
                                    bounce: 0.15,
                                    duration: 0.5,
                                }}
                            />
                        )}
                        <span className="relative z-10">
                            <GearSix
                                size={22}
                                weight={isSettingsActive ? 'fill' : 'regular'}
                                className={cn(
                                    'transition-colors duration-200',
                                    isSettingsActive
                                        ? 'text-neutral-900'
                                        : 'text-white/70'
                                )}
                            />
                        </span>
                        <span
                            className={cn(
                                'relative z-10 text-2xs font-medium leading-tight transition-colors duration-200',
                                isSettingsActive
                                    ? 'text-neutral-900'
                                    : 'text-white/70'
                            )}
                        >
                            {t('settings')}
                        </span>
                    </button>
                </>
            )}

            {/* Search Command Palette */}
            <SidebarSearch
                open={searchOpen}
                onOpenChange={setSearchOpen}
                sidebarItems={sidebarItems}
                instituteId={instituteId}
                sidebarCategories={roleDisplay?.sidebarCategories}
            />
        </div>
    );
};
