import type { CSSProperties, ReactNode } from 'react';
import {
    ArrowLeft,
    Bell,
    BookOpen,
    CalendarCheck,
    ClipboardText,
    House,
    SidebarSimple,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { MASCOT, bg, edge, fg, merge, type BrandPalette } from './palette';

/*
 * Pieces the skin models share. Every size here is in the learner app's own
 * pixels (a model is drawn 390px wide and zoomed down by PhoneFrame).
 */

/** A placeholder line standing in for a run of text. */
export function Bar({ className, style }: { className?: string; style?: CSSProperties }) {
    return (
        <span
            className={cn('block h-3 shrink-0 rounded-full bg-neutral-200', className)}
            style={style}
        />
    );
}

/** A circle with the learner's first letter, as the learner app's avatar. */
export function Avatar({
    letter,
    className,
    style,
}: {
    letter: string;
    className?: string;
    style?: CSSProperties;
}) {
    return (
        <span
            className={cn(
                'flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-bold',
                className
            )}
            style={style}
        >
            {letter}
        </span>
    );
}

interface TopBarProps {
    brand: BrandPalette;
    letter: string;
    /** Inside a course: back and home buttons and the course title. */
    inner?: boolean;
    /** Colour of the tool icons (Vibrant tints them with the brand). */
    toolColor?: string;
    /** Play draws the bell and avatar as raised circles. */
    raisedTools?: boolean;
}

/** The learner app's top bar on a phone. */
export function TopBar({ brand, letter, inner, toolColor, raisedTools }: TopBarProps) {
    const tool =
        'flex size-9 shrink-0 items-center justify-center rounded-lg border border-neutral-200 bg-white';
    const iconStyle = toolColor ? fg(toolColor) : undefined;
    return (
        <span className="flex h-12 shrink-0 items-center gap-2 border-b border-neutral-200 bg-white px-2">
            <span className={tool} style={iconStyle}>
                <SidebarSimple size={18} />
            </span>
            {inner ? (
                <>
                    <span className={tool} style={iconStyle}>
                        <ArrowLeft size={18} className="rtl:-scale-x-100" />
                    </span>
                    <span className={tool} style={iconStyle}>
                        <House size={18} />
                    </span>
                    <Bar className="h-3.5 w-36 bg-neutral-800" />
                </>
            ) : (
                <span className="size-8 rounded-md" style={bg(brand.tint100)} />
            )}
            <span className="flex-1" />
            <span
                className={cn(
                    'flex size-9 items-center justify-center',
                    raisedTools && 'rounded-full border border-neutral-200 bg-neutral-50 shadow-sm'
                )}
                style={iconStyle}
            >
                <Bell size={18} />
            </span>
            <Avatar
                letter={letter}
                className={cn(raisedTools && 'border border-neutral-200 shadow-sm')}
                style={merge(bg(brand.tint100), fg(brand.solid))}
            />
        </span>
    );
}

const TAB_ICONS = [House, BookOpen, ClipboardText, CalendarCheck];

interface BottomTabsProps {
    /** 0 Home, 1 Learn. */
    active: 0 | 1;
    activeBg: string;
    activeInk: string;
    /** Fun draws a wider pill and a thicker top line. */
    wide?: boolean;
    lineColor?: string;
    className?: string;
}

/** The phone tab bar (Play, Cleaner Play and Fun have one; the others do not). */
export function BottomTabs({
    active,
    activeBg,
    activeInk,
    wide,
    lineColor,
    className,
}: BottomTabsProps) {
    return (
        <span
            className={cn(
                'absolute inset-x-0 bottom-0 flex h-20 items-center justify-around bg-white px-2',
                wide ? 'border-t-2' : 'border-t border-neutral-200',
                className
            )}
            style={lineColor ? edge(lineColor) : undefined}
        >
            {TAB_ICONS.map((Icon, i) => {
                const on = i === active;
                return (
                    <span
                        key={i}
                        className={cn(
                            'flex h-14 flex-col items-center justify-center gap-1.5 rounded-2xl',
                            wide ? 'w-24' : 'w-16',
                            !on && 'text-slate-500'
                        )}
                        style={on ? merge(bg(activeBg), fg(activeInk)) : undefined}
                    >
                        <Icon size={22} weight={on ? 'bold' : 'regular'} />
                        <Bar
                            className={cn('h-2 w-9', !on && 'bg-slate-300')}
                            style={on ? bg(activeInk) : undefined}
                        />
                    </span>
                );
            })}
        </span>
    );
}

/** Play and Cleaner Play's waving mascot, reduced to simple shapes. */
export function Mascot({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 60 96" className={cn('h-24 w-14 shrink-0', className)}>
            {/* waving arm */}
            <path d="M44 40 L54 22" strokeWidth="7" strokeLinecap="round" stroke={MASCOT.skin} />
            <rect x="16" y="36" width="28" height="34" rx="11" fill={MASCOT.shirt} />
            <path d="M18 40 L42 40 L36 50 L24 50 Z" fill={MASCOT.scarf} />
            <path d="M17 44 L10 62" strokeWidth="7" strokeLinecap="round" stroke={MASCOT.skin} />
            <rect x="19" y="66" width="9" height="22" rx="4" fill={MASCOT.shirt} />
            <rect x="32" y="66" width="9" height="22" rx="4" fill={MASCOT.shirt} />
            <rect x="17" y="84" width="12" height="8" rx="3" fill={MASCOT.boot} />
            <rect x="31" y="84" width="12" height="8" rx="3" fill={MASCOT.boot} />
            <circle cx="30" cy="22" r="14" fill={MASCOT.skin} />
            <path d="M16 20 C16 6 44 6 44 20 C38 13 24 13 16 20 Z" fill={MASCOT.hair} />
            <circle cx="25" cy="23" r="1.8" fill={MASCOT.boot} />
            <circle cx="35" cy="23" r="1.8" fill={MASCOT.boot} />
        </svg>
    );
}

/** A screen's root: white, clipped, in the learner app's font unless a skin overrides it. */
export function Screen({
    children,
    className,
    style,
}: {
    children: ReactNode;
    className?: string;
    style?: CSSProperties;
}) {
    return (
        <span
            className={cn('relative flex size-full flex-col overflow-hidden bg-white', className)}
            style={style}
        >
            {children}
        </span>
    );
}
