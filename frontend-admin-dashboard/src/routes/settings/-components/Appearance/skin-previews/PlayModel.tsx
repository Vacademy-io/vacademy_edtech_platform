import { BookOpen, Fire, Play, Sparkle } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { ClassicLesson, ClassicResult, type ClassicLook } from './classic';
import { Bar, BottomTabs, Mascot, Screen, TopBar } from './parts';
import { PLAY, bg, edge, fg, lip, merge } from './palette';
import type { SkinModelProps } from './types';

/**
 * Play: game-like and bold. A pale yellow hero with the waving mascot and a
 * heavy greeting, a huge lime-green CONTINUE button standing on a darker
 * 6px lip, navy "continue learning" card, 20px+ corners, uppercase heavy
 * labels, and a tab bar whose active item is lime-tinted. Play keeps its own
 * colours; the brand shows only in small places like the avatar.
 */
export function PlayModel({ screen, brand, copy }: SkinModelProps) {
    const tabs = (active: 0 | 1) => (
        <BottomTabs active={active} activeBg={PLAY.successSoft} activeInk={PLAY.successSoftInk} />
    );
    const look: ClassicLook = {
        hero: { className: '' },
        card: { className: '' },
        button: bg(brand.solid),
        avatar: true,
        raisedTools: true,
        tabs: tabs(1),
    };
    if (screen === 'lesson') return <ClassicLesson brand={brand} copy={copy} look={look} />;
    if (screen === 'result') {
        return (
            <ClassicResult
                brand={brand}
                copy={copy}
                look={look}
                celebration={
                    <div
                        className="absolute inset-x-4 top-4 z-10 flex items-center gap-3 rounded-2xl px-4 py-3 text-white"
                        style={merge(bg(PLAY.success), lip(PLAY.successDeep))}
                    >
                        <Mascot className="h-14 w-9" />
                        <span className="flex flex-col gap-1.5">
                            <Bar className="h-4 w-44 bg-neutral-800" />
                            <Bar className="h-2.5 w-52 bg-neutral-700" />
                        </span>
                    </div>
                }
            />
        );
    }
    return (
        <Screen>
            <TopBar brand={brand} letter={copy.name.charAt(0)} raisedTools />
            <div className="flex flex-col gap-4 px-7 pt-6">
                <div
                    className="rounded-3xl border-2 p-4"
                    style={merge(bg(PLAY.highlight), edge(PLAY.highlightEdge))}
                >
                    <div className="flex items-center gap-3">
                        <Mascot className="h-28 w-20" />
                        <div className="flex min-w-0 flex-1 flex-col gap-2">
                            <span
                                className="text-2xl font-black leading-tight"
                                style={fg(PLAY.ink)}
                            >
                                {copy.greetingName}!
                            </span>
                            <span className="flex h-9 items-center gap-2 self-start rounded-full bg-white px-3 shadow-md">
                                <Fire size={16} className="text-neutral-500" />
                                <Bar className="h-2.5 w-24 bg-neutral-700" />
                            </span>
                            <span className="flex h-9 items-center gap-2 self-start rounded-full bg-white px-3 shadow-md">
                                <span className="size-5 rounded-full border-4 border-blue-100" />
                                <Bar className="h-2.5 w-14 bg-neutral-700" />
                            </span>
                        </div>
                    </div>
                    <div
                        className="mt-4 flex h-24 items-center gap-4 rounded-3xl px-6 text-white"
                        style={merge(bg(PLAY.success), lip(PLAY.successDeep, 6))}
                    >
                        <Play size={36} weight="fill" />
                        <span className="flex min-w-0 flex-col gap-1.5">
                            <span className="truncate text-4xl font-black uppercase leading-none tracking-tight">
                                {copy.continueLabel}
                            </span>
                            <span className="rounded-full bg-white px-3 py-1.5">
                                <Bar className="h-2.5 w-36 bg-neutral-700" />
                            </span>
                        </span>
                    </div>
                </div>
                <div
                    className="flex flex-col gap-3 rounded-2xl border border-slate-200 p-4"
                    style={bg(PLAY.navySoft)}
                >
                    <div className="flex items-center gap-3">
                        <BookOpen size={30} weight="duotone" className="text-yellow-700" />
                        <span className="flex flex-1 flex-col gap-1.5">
                            <Bar className="h-4 w-36" style={bg(PLAY.navy)} />
                            <Bar className="h-2.5 w-24 bg-neutral-400" />
                        </span>
                        <span
                            className="flex h-8 items-center gap-1 rounded-full bg-white px-3"
                            style={fg(PLAY.navy)}
                        >
                            <Sparkle size={12} weight="fill" />
                            <Bar className="h-2.5 w-12" style={bg(PLAY.navy)} />
                        </span>
                    </div>
                    {[0, 1].map((i) => (
                        <div key={i} className="flex items-center gap-3 rounded-xl bg-white p-3">
                            <span
                                className={cn(
                                    'flex size-6 items-center justify-center rounded-md text-xs font-black',
                                    i === 0
                                        ? 'text-white'
                                        : 'border border-neutral-200 text-neutral-500'
                                )}
                                style={i === 0 ? bg(PLAY.navy) : undefined}
                            >
                                {i + 1}
                            </span>
                            <span className="flex flex-1 flex-col gap-1.5">
                                <Bar
                                    className={cn('h-3 bg-neutral-800', i === 0 ? 'w-52' : 'w-36')}
                                />
                                <Bar className="h-2 w-36 bg-neutral-300" />
                            </span>
                        </div>
                    ))}
                    <span
                        className="flex h-9 items-center justify-center gap-2"
                        style={fg(PLAY.ink)}
                    >
                        <Play size={16} weight="fill" />
                        <Bar className="h-3.5 w-36" style={bg(PLAY.ink)} />
                    </span>
                </div>
                <div
                    className="rounded-3xl border p-4"
                    style={merge(bg(PLAY.infoSoft), edge(PLAY.infoSoftEdge))}
                >
                    <span className="block h-32 rounded-2xl" style={bg(PLAY.infoSoftInk)} />
                </div>
            </div>
            {tabs(0)}
        </Screen>
    );
}
