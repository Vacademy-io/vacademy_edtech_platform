import { BookOpen, Fire, Play, Sparkle } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { ClassicLesson, ClassicResult, type ClassicLook } from './classic';
import { Bar, BottomTabs, Mascot, Screen, TopBar } from './parts';
import { CLEANER, bg, edge, fg, merge } from './palette';
import type { SkinModelProps } from './types';

/**
 * Cleaner Play: Play's friendliness, calmer. The mascot sits in a hero washed
 * with the brand's lightest tint; the Continue button is a full pill in the
 * brand colour; cards are white with a warm hairline; badges are terracotta
 * and gold tints; the tab bar's active item is brand-tinted.
 */
export function CleanerPlayModel({ screen, brand, copy }: SkinModelProps) {
    const tabs = (active: 0 | 1) => (
        <BottomTabs active={active} activeBg={brand.tint100} activeInk={brand.solid} />
    );
    const look: ClassicLook = {
        hero: { className: '' },
        card: { className: '' },
        button: bg(brand.solid),
        avatar: true,
        tabs: tabs(1),
    };
    if (screen === 'lesson') return <ClassicLesson brand={brand} copy={copy} look={look} />;
    if (screen === 'result') return <ClassicResult brand={brand} copy={copy} look={look} />;
    return (
        <Screen>
            <TopBar brand={brand} letter={copy.name.charAt(0)} />
            <span className="flex flex-col gap-4 px-7 pt-6">
                <span
                    className="block rounded-xl border p-4"
                    style={merge(bg(brand.tint50), edge(brand.tint100))}
                >
                    <span className="flex items-center gap-3">
                        <Mascot className="h-28 w-20" />
                        <span className="flex min-w-0 flex-1 flex-col gap-2">
                            <span
                                className="text-2xl font-extrabold leading-tight"
                                style={fg(CLEANER.ink)}
                            >
                                {copy.greetingName}
                            </span>
                            <span
                                className="flex h-9 items-center gap-2 self-start rounded-full px-3"
                                style={merge(bg(CLEANER.goldTint), fg(CLEANER.ink))}
                            >
                                <Fire size={16} />
                                <Bar className="h-2.5 w-24" style={bg(CLEANER.ink)} />
                            </span>
                            <span className="flex h-9 items-center gap-2 self-start rounded-full bg-white px-3">
                                <span className="size-5 rounded-full border-4 border-stone-200" />
                                <Bar className="h-2.5 w-14" style={bg(CLEANER.muted)} />
                            </span>
                        </span>
                    </span>
                    <span
                        className="mt-4 flex h-20 items-center gap-4 rounded-full px-7 text-white"
                        style={bg(brand.solid)}
                    >
                        <Play size={28} weight="fill" />
                        <span className="flex min-w-0 flex-col gap-1">
                            <span className="truncate text-2xl font-bold leading-tight">
                                {copy.continueLabel}
                            </span>
                            <span className="rounded-full bg-white/25 px-3 py-1">
                                <Bar className="h-2.5 w-40 bg-white/80" />
                            </span>
                        </span>
                    </span>
                </span>
                <span
                    className="flex flex-col gap-3 rounded-xl border bg-white p-4"
                    style={edge(CLEANER.line)}
                >
                    <span className="flex items-center gap-3">
                        <BookOpen size={30} weight="duotone" className="text-yellow-800" />
                        <span className="flex flex-1 flex-col gap-1.5">
                            <Bar className="h-4 w-36" style={bg(CLEANER.ink)} />
                            <Bar className="h-2.5 w-24" style={bg(CLEANER.line)} />
                        </span>
                        <span
                            className="flex h-8 items-center gap-1 rounded-full px-3"
                            style={merge(bg(CLEANER.terracottaTint), fg(CLEANER.terracotta))}
                        >
                            <Sparkle size={12} weight="fill" />
                            <Bar className="h-2.5 w-12" style={bg(CLEANER.terracotta)} />
                        </span>
                    </span>
                    {[0, 1].map((i) => (
                        <span
                            key={i}
                            className="flex items-center gap-3 rounded-xl border p-3"
                            style={edge(CLEANER.line)}
                        >
                            <span
                                className={cn(
                                    'flex size-6 items-center justify-center rounded-md text-xs font-bold',
                                    i === 0 ? 'text-white' : 'bg-stone-100 text-stone-500'
                                )}
                                style={i === 0 ? bg(brand.solid) : undefined}
                            >
                                {i + 1}
                            </span>
                            <span className="flex flex-1 flex-col gap-1.5">
                                <Bar
                                    className={cn('h-3', i === 0 ? 'w-52' : 'w-36')}
                                    style={bg(CLEANER.ink)}
                                />
                                <Bar className="h-2 w-36" style={bg(CLEANER.line)} />
                            </span>
                        </span>
                    ))}
                    <span
                        className="flex h-12 items-center justify-center gap-2 rounded-full border"
                        style={merge(edge(CLEANER.line), fg(CLEANER.ink))}
                    >
                        <Play size={16} weight="fill" />
                        <Bar className="h-3 w-32" style={bg(CLEANER.ink)} />
                    </span>
                </span>
                <span className="block rounded-xl border p-4" style={edge(CLEANER.line)}>
                    <span className="block h-32 rounded-xl" style={bg(CLEANER.sage)} />
                </span>
            </span>
            {tabs(0)}
        </Screen>
    );
}
