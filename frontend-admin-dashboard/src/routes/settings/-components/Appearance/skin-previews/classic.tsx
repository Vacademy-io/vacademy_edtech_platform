import type { CSSProperties, ReactNode } from 'react';
import {
    BookOpen,
    CaretLeft,
    CaretRight,
    ChartBar,
    ChatText,
    CheckCircle,
    Confetti,
    NotePencil,
    Play,
    Sparkle,
    XCircle,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { Avatar, Bar, Screen, TopBar } from './parts';
import { bg, edge, fg, merge, type BrandPalette } from './palette';
import type { ModelCopy } from './types';

/*
 * The screens Default, Vibrant and Corporate draw, and the lesson and quiz
 * result that Play and Cleaner Play share with them. In the learner app these
 * skins differ in surfaces and chrome, not in layout, so one layout takes a
 * "look" that carries each skin's surfaces.
 */

export interface Surface {
    className: string;
    style?: CSSProperties;
}

export interface ClassicLook {
    /** Corporate: a cool grey page under a white panel. */
    canvas?: string;
    /** The first "continue" card on home. */
    hero: Surface;
    /** Every other card. */
    card: Surface;
    /** The primary button's fill. */
    button: CSSProperties;
    /** Default and Vibrant greet with a letter avatar; Corporate does not. */
    avatar: boolean;
    /** Vibrant tints the top bar's icons with the brand. */
    toolColor?: string;
    /** Play draws the bell and avatar as raised circles. */
    raisedTools?: boolean;
    /** Play and Cleaner Play put the slide controls on top and add the tab bar. */
    tabs?: ReactNode;
}

interface ClassicProps {
    brand: BrandPalette;
    copy: ModelCopy;
    look: ClassicLook;
}

/** Corporate's grey page with a white panel, or just the content. */
function Page({ look, children }: { look: ClassicLook; children: ReactNode }) {
    if (!look.canvas) return <>{children}</>;
    return (
        <div className="flex flex-1 flex-col px-4 pt-4" style={bg(look.canvas)}>
            <div className="flex flex-1 flex-col rounded-t-lg bg-white">{children}</div>
        </div>
    );
}

export function ClassicHome({ brand, copy, look }: ClassicProps) {
    const letter = copy.name.charAt(0);
    return (
        <Screen style={look.canvas ? bg(look.canvas) : undefined}>
            <TopBar brand={brand} letter={letter} toolColor={look.toolColor} />
            <Page look={look}>
                <div className={cn('flex flex-col gap-4 pt-6', look.canvas ? 'px-3' : 'px-7')}>
                    <div className="flex items-center gap-3">
                        {look.avatar ? (
                            <Avatar
                                letter={letter}
                                className="size-12 border-2 border-white text-lg shadow-sm"
                                style={merge(bg(brand.tint100), fg(brand.solid))}
                            />
                        ) : null}
                        <span
                            className={cn(
                                'truncate text-neutral-900',
                                look.avatar ? 'text-2xl font-bold' : 'ps-3 text-xl font-semibold'
                            )}
                        >
                            {copy.greetingName}
                        </span>
                    </div>
                    <Bar className="h-2.5 w-44 bg-neutral-300" />
                    <div
                        className={cn('flex flex-col gap-2.5 p-4', look.hero.className)}
                        style={look.hero.style}
                    >
                        <Bar className="h-2.5 w-28 bg-neutral-300" />
                        <Bar className="h-4 w-64 bg-neutral-800" />
                        <Bar className="h-2.5 w-32 bg-neutral-300" />
                        <span
                            className="mt-2 flex h-11 items-center justify-center gap-2 rounded-lg text-base font-semibold text-white"
                            style={look.button}
                        >
                            <Play size={16} weight="fill" />
                            {copy.continueLabel}
                        </span>
                    </div>
                    <div
                        className={cn('flex flex-col gap-3 p-4', look.card.className)}
                        style={look.card.style}
                    >
                        <div className="flex items-center gap-3">
                            <span
                                className="flex size-10 shrink-0 items-center justify-center rounded-lg"
                                style={merge(bg(brand.tint100), fg(brand.solid))}
                            >
                                <Play size={20} />
                            </span>
                            <span className="flex flex-1 flex-col gap-1.5">
                                <Bar className="h-4 w-36 bg-neutral-800" />
                                <Bar className="h-2.5 w-24 bg-neutral-300" />
                            </span>
                            <span
                                className="flex h-7 items-center gap-1 rounded-md border bg-white px-2"
                                style={merge(edge(brand.tint200), fg(brand.solid))}
                            >
                                <Sparkle size={12} weight="fill" />
                                <Bar className="h-2 w-10" style={bg(brand.solid)} />
                            </span>
                        </div>
                        {[0, 1].map((i) => (
                            <div key={i} className="flex items-center gap-3 py-1.5 ps-2">
                                <span
                                    className={cn(
                                        'flex size-6 shrink-0 items-center justify-center rounded-md text-xs font-bold',
                                        i === 0 ? 'text-white' : 'bg-neutral-100 text-neutral-500'
                                    )}
                                    style={i === 0 ? bg(brand.solid) : undefined}
                                >
                                    {i + 1}
                                </span>
                                <span className="flex flex-1 flex-col gap-1.5">
                                    <Bar
                                        className={cn(
                                            'h-3 bg-neutral-700',
                                            i === 0 ? 'w-52' : 'w-40'
                                        )}
                                    />
                                    <Bar className="h-2 w-36 bg-neutral-300" />
                                </span>
                                <CaretRight size={14} className="text-neutral-500" />
                            </div>
                        ))}
                        <span className="flex h-10 items-center justify-center gap-2 rounded-lg border border-neutral-200 bg-white text-neutral-900 shadow-sm">
                            <Play size={14} weight="fill" />
                            <Bar className="h-3 w-28 bg-neutral-800" />
                        </span>
                    </div>
                    <div className={cn('p-4', look.card.className)} style={look.card.style}>
                        <span
                            className="flex h-36 items-center justify-center rounded-lg text-white"
                            style={bg(brand.solid)}
                        >
                            <BookOpen size={40} weight="bold" />
                        </span>
                    </div>
                </div>
            </Page>
        </Screen>
    );
}

/** Previous / next slide button. */
function SlideButton({ next, muted }: { next?: boolean; muted?: boolean }) {
    const Icon = next ? CaretRight : CaretLeft;
    return (
        <span
            className={cn(
                'flex size-10 shrink-0 items-center justify-center rounded-xl border border-neutral-200 bg-white',
                muted ? 'text-neutral-300' : 'text-neutral-700'
            )}
        >
            <Icon size={16} />
        </span>
    );
}

/** The Doubts chip on its own (a quiz has no notes). */
function DoubtsChip() {
    return (
        <span className="flex h-7 items-center gap-1 rounded-md border border-neutral-200 bg-white px-2 text-neutral-500">
            <ChatText size={12} />
            <Bar className="h-2 w-10 bg-neutral-500" />
        </span>
    );
}

/** The Notes and Doubts chips. */
function ToolChips() {
    return (
        <>
            {[NotePencil, ChatText].map((Icon, i) => (
                <span
                    key={i}
                    className="flex h-7 items-center gap-1 rounded-md border border-neutral-200 bg-white px-2 text-neutral-500"
                >
                    <Icon size={12} />
                    <Bar className="h-2 w-9 bg-neutral-500" />
                </span>
            ))}
        </>
    );
}

export function ClassicLesson({ brand, copy, look }: ClassicProps) {
    const navTop = Boolean(look.tabs);
    return (
        <Screen style={look.canvas ? bg(look.canvas) : undefined}>
            <TopBar
                brand={brand}
                letter={copy.name.charAt(0)}
                inner
                toolColor={look.toolColor}
                raisedTools={look.raisedTools}
            />
            <div className={cn('px-6 py-3', look.canvas && 'mx-3 bg-white')}>
                <Bar className="h-2.5 w-56 bg-neutral-800" />
            </div>
            {navTop ? (
                <div className="mx-6 flex items-center gap-2 border-y border-neutral-100 py-2">
                    <SlideButton muted />
                    <span className="flex flex-1 items-center justify-center gap-2">
                        <span className="text-xs font-semibold text-neutral-400">1 / 3</span>
                        <ToolChips />
                    </span>
                    <SlideButton next />
                </div>
            ) : null}
            <div className="mx-3 mt-2 flex h-80 flex-col gap-4 rounded-xl border-2 border-neutral-200 bg-white p-5">
                <Bar className="h-4 w-full bg-neutral-500" />
                <Bar className="h-4 w-4/5 bg-neutral-500" />
                <Bar className="h-4 w-11/12 bg-neutral-300" />
                <Bar className="h-4 w-2/3 bg-neutral-300" />
            </div>
            {navTop ? (
                look.tabs
            ) : (
                <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2 border-t border-neutral-200 bg-white px-3 pb-3 pt-2">
                    <div className="flex items-center justify-between">
                        <Bar className="h-2.5 w-48 bg-neutral-700" />
                        <span className="text-xs font-semibold text-neutral-500">1 / 4</span>
                    </div>
                    <div className="flex items-center gap-2 border-t border-neutral-100 pt-2">
                        <SlideButton muted />
                        <span className="flex flex-1 justify-center gap-1">
                            <ToolChips />
                        </span>
                        <SlideButton next />
                    </div>
                </div>
            )}
        </Screen>
    );
}

export function ClassicResult({
    brand,
    copy,
    look,
    celebration,
}: ClassicProps & { celebration?: ReactNode }) {
    const navTop = Boolean(look.tabs);
    return (
        <Screen style={look.canvas ? bg(look.canvas) : undefined}>
            <TopBar
                brand={brand}
                letter={copy.name.charAt(0)}
                inner
                toolColor={look.toolColor}
                raisedTools={look.raisedTools}
            />
            {navTop ? (
                <div className="mx-6 flex items-center gap-2 border-b border-neutral-100 py-2">
                    <SlideButton />
                    <span className="flex flex-1 items-center justify-center gap-2">
                        <span className="text-xs font-semibold text-neutral-400">2 / 2</span>
                        <DoubtsChip />
                    </span>
                    <SlideButton next />
                </div>
            ) : null}
            {celebration}
            <div
                className={cn('flex flex-col gap-4 px-7 pt-5', look.canvas && 'mx-3 bg-white px-4')}
            >
                <div className="flex items-center gap-3">
                    <Bar className="h-4 w-24 bg-neutral-900" />
                    <span className="rounded-full px-3 py-1.5" style={bg(brand.tint100)}>
                        <Bar className="h-2 w-14 bg-neutral-700" />
                    </span>
                    <span className="flex-1" />
                    <span
                        className="flex h-9 w-24 items-center justify-center rounded-md bg-sky-300" /* design-lint-ignore: the learner app's fixed reattempt colour */
                    >
                        <Bar className="h-2.5 w-16 bg-neutral-800" />
                    </span>
                </div>
                <div
                    className="flex flex-col gap-3 rounded-xl border p-5"
                    style={merge(bg(brand.tint50), edge(brand.tint200))}
                >
                    <span className="flex items-center gap-2 text-neutral-700">
                        <ChartBar size={22} weight="duotone" />
                        <Bar className="h-3.5 w-24 bg-neutral-800" />
                    </span>
                    <span className="flex items-baseline gap-2">
                        <span className="text-4xl font-bold text-neutral-900">4</span>
                        <span className="text-xl font-medium" style={fg(brand.solid)}>
                            / 5
                        </span>
                        <span className="flex-1" />
                        <span
                            className="rounded-full px-3 py-1 text-sm font-bold text-neutral-800"
                            style={bg(brand.tint100)}
                        >
                            80%
                        </span>
                    </span>
                    <span className="flex items-center gap-4">
                        <span className="flex items-center gap-1.5 text-green-600">
                            <CheckCircle size={18} weight="fill" />
                            <Bar className="h-2.5 w-16 bg-green-600" />
                        </span>
                        <span className="flex items-center gap-1.5 text-red-500">
                            <XCircle size={18} weight="fill" />
                            <Bar className="h-2.5 w-14 bg-red-500" />
                        </span>
                    </span>
                </div>
                <div className="flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 p-4">
                    <Confetti size={26} className="text-yellow-600" />
                    <span className="flex flex-col gap-1.5">
                        <span className="text-base font-semibold text-green-800">
                            {copy.passed}
                        </span>
                        <Bar className="h-2.5 w-44 bg-green-600" />
                    </span>
                </div>
                <div className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-4">
                    <Bar className="h-2.5 w-20 bg-neutral-400" />
                    <Bar className="h-3 w-56 bg-neutral-700" />
                    <span className="rounded-lg border border-green-200 bg-green-50 p-3">
                        <Bar className="h-3 w-24 bg-neutral-700" />
                    </span>
                </div>
            </div>
            {navTop ? (
                look.tabs
            ) : (
                <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2 border-t border-neutral-200 bg-white px-3 pb-3 pt-2">
                    <div className="flex items-center justify-between">
                        <Bar className="h-2.5 w-28 bg-neutral-700" />
                        <span className="text-xs font-semibold text-neutral-500">2 / 3</span>
                    </div>
                    <div className="flex items-center gap-2 border-t border-neutral-100 pt-2">
                        <SlideButton />
                        <span className="flex flex-1 justify-center">
                            <DoubtsChip />
                        </span>
                        <SlideButton next />
                    </div>
                </div>
            )}
        </Screen>
    );
}
