import { Clapperboard, FolderOpen, MoreHorizontal, UserSquare2, Wand2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DashboardTab } from './tabsConfig';

interface BottomTabBarProps {
    activeTab: DashboardTab;
    onTabChange: (tab: DashboardTab) => void;
    onMoreClick: () => void;
}

// Mobile-only bottom nav. Shown below the md breakpoint as the primary
// navigation; above md the desktop sidebar handles it. Five slots is the
// standard mobile cap — we surface the four most-used content tabs and a
// "More" button that opens the existing sidebar sheet for the overflow tabs
// (Reels, Brand Kits, Team) and account actions (Help, Logout, Credits).
const BOTTOM_TABS: Array<{ id: DashboardTab; label: string; Icon: typeof Wand2 }> = [
    { id: 'create', label: 'Create', Icon: Wand2 },
    { id: 'recent', label: 'Recent', Icon: Clapperboard },
    { id: 'assets', label: 'Assets', Icon: FolderOpen },
    { id: 'avatars', label: 'Avatars', Icon: UserSquare2 },
];

// Tabs that map to "More" — when any of these is the current tab, the More
// button shows as active so the user has visual feedback that the selection
// lives behind the sheet.
const MORE_TABS: DashboardTab[] = ['reels', 'studio', 'brand-kits', 'team'];

export function BottomTabBar({ activeTab, onTabChange, onMoreClick }: BottomTabBarProps) {
    const moreActive = MORE_TABS.includes(activeTab);
    return (
        // No pb-keyboard / pb-safe on the bar itself: when the IME opens it's
        // standard mobile UX for the keyboard to cover the bottom nav (the
        // text input gets the screen), and the parent shell's pb-safe already
        // lifts the bar above the home indicator.
        <nav
            data-assistant-fab="avoid-phone"
            className="relative z-30 flex shrink-0 items-stretch justify-around border-t border-neutral-200 bg-white md:hidden"
            aria-label="Primary"
        >
            {BOTTOM_TABS.map(({ id, label, Icon }) => {
                const active = activeTab === id;
                return (
                    <button
                        key={id}
                        type="button"
                        onClick={() => onTabChange(id)}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                            'flex flex-1 flex-col items-center justify-center gap-0.5 px-1 pb-1.5 pt-2 text-[11px] font-medium transition-colors',
                            active ? 'text-neutral-900' : 'text-neutral-500 hover:text-neutral-700'
                        )}
                    >
                        <Icon className={cn('size-5', active && 'text-neutral-900')} />
                        <span className="leading-none">{label}</span>
                    </button>
                );
            })}
            <button
                type="button"
                onClick={onMoreClick}
                aria-haspopup="menu"
                aria-current={moreActive ? 'page' : undefined}
                className={cn(
                    'flex flex-1 flex-col items-center justify-center gap-0.5 px-1 pb-1.5 pt-2 text-[11px] font-medium transition-colors',
                    moreActive ? 'text-neutral-900' : 'text-neutral-500 hover:text-neutral-700'
                )}
            >
                <MoreHorizontal className={cn('size-5', moreActive && 'text-neutral-900')} />
                <span className="leading-none">More</span>
            </button>
        </nav>
    );
}
