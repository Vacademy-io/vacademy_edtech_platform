import {
    ArrowCounterClockwise,
    ArrowLeft,
    ArrowRight,
    BookOpen,
    Check,
    Fire,
    Play,
    X,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { Avatar, Bar, BottomTabs, Screen } from './parts';
import { FUN, FUN_FONT, bg, edge, fg, lip, merge, type BrandPalette } from './palette';
import type { ModelCopy, SkinModelProps } from './types';

/**
 * Fun: bright and playful. A white page where every course has its own
 * colour (violet, teal, orange, pink), heavy rounded type, big soft corners,
 * chunky buttons standing on a darker 4px lip, a yellow progress fill, and a
 * tab bar whose active item is a brand-tinted pill. The brand colour is kept
 * for the main action, the active tab and links.
 */
export function FunModel({ screen, brand, copy }: SkinModelProps) {
    const root = merge({ fontFamily: FUN_FONT }, fg(FUN.ink));
    return (
        <Screen style={root}>
            {screen === 'lesson' ? (
                <FunLesson brand={brand} copy={copy} />
            ) : screen === 'result' ? (
                <FunResult brand={brand} copy={copy} />
            ) : (
                <FunHome brand={brand} copy={copy} />
            )}
        </Screen>
    );
}

interface Props {
    brand: BrandPalette;
    copy: ModelCopy;
}

const COURSE = FUN.courses[1];

function FunHome({ brand, copy }: Props) {
    return (
        <>
            <div className="flex items-end justify-between px-5 pt-5">
                <div className="min-w-0">
                    <p className="text-sm font-bold" style={fg(FUN.muted)}>
                        {copy.greeting}
                    </p>
                    <p className="truncate text-3xl font-black leading-tight">{copy.name}</p>
                </div>
                <div className="flex items-center gap-2">
                    <span
                        className="flex h-10 items-center gap-1 rounded-full px-3 text-lg font-black"
                        style={merge(bg(FUN.streakBg), fg(FUN.streakText))}
                    >
                        <Fire size={18} weight="fill" style={fg(FUN.flame)} />4
                    </span>
                    <Avatar
                        letter={copy.name.charAt(0)}
                        className="size-11 text-base font-black"
                        style={merge(bg(brand.funTint), fg(brand.funSolid))}
                    />
                </div>
            </div>

            <div
                className="relative mx-5 mt-4 overflow-hidden rounded-3xl p-5 text-white"
                style={bg(COURSE.solid)}
            >
                <span
                    className="absolute -end-12 -top-14 size-44 rounded-full opacity-50"
                    style={bg(COURSE.light)}
                />
                <div className="relative flex items-start gap-3">
                    <span className="flex flex-1 flex-col gap-2.5">
                        <Bar className="h-2.5 w-44 bg-white/70" />
                        <Bar className="h-5 w-40 bg-white" />
                        <Bar className="h-2.5 w-28 bg-white/80" />
                    </span>
                    <span
                        className="flex size-14 items-center justify-center rounded-2xl bg-white"
                        style={fg(COURSE.solid)}
                    >
                        <BookOpen size={28} weight="bold" />
                    </span>
                </div>
                <div className="relative mt-5 flex items-center gap-3">
                    <span
                        className="h-3.5 flex-1 overflow-hidden rounded-full"
                        style={bg(COURSE.light)}
                    >
                        <span
                            className="block h-full w-1/2 rounded-full"
                            style={bg(FUN.highlight)}
                        />
                    </span>
                    <span className="text-sm font-black">50%</span>
                </div>
                <span
                    className="relative mt-4 flex h-14 items-center justify-center gap-2 rounded-2xl bg-white text-lg font-black"
                    style={merge(fg(COURSE.solid), lip(COURSE.lip))}
                >
                    <Play size={18} weight="fill" />
                    {copy.continueLabel}
                </span>
            </div>

            <div className="mx-5 mt-4 grid grid-cols-2 gap-3">
                <span
                    className="flex items-center gap-3 rounded-2xl p-3"
                    style={bg(FUN.successTint)}
                >
                    <svg viewBox="0 0 44 44" className="size-11 shrink-0">
                        <circle
                            cx="22"
                            cy="22"
                            r="17"
                            fill="none"
                            strokeWidth="7"
                            stroke={FUN.successTrack}
                        />
                        <circle
                            cx="22"
                            cy="22"
                            r="17"
                            fill="none"
                            strokeWidth="7"
                            strokeLinecap="round"
                            strokeDasharray="71 107"
                            transform="rotate(-90 22 22)"
                            stroke={FUN.success}
                        />
                    </svg>
                    <span className="flex flex-col gap-1.5">
                        <span
                            className="text-lg font-black leading-none"
                            style={fg(FUN.successStrong)}
                        >
                            2/3
                        </span>
                        <Bar className="h-2 w-16" style={bg(FUN.successStrong)} />
                    </span>
                </span>
                <span
                    className="flex flex-col justify-center gap-2 rounded-2xl p-3"
                    style={bg(FUN.liveTint)}
                >
                    <span className="flex items-center gap-1.5 self-start rounded-full bg-white px-2 py-1">
                        <span className="size-2 rounded-full" style={bg(FUN.live)} />
                        <Bar className="h-2 w-14" style={bg(FUN.live)} />
                    </span>
                    <Bar className="h-3 w-28" style={bg(FUN.liveText)} />
                </span>
            </div>

            <div className="mx-5 mt-5 flex items-center justify-between">
                <Bar className="h-4 w-32" style={bg(FUN.ink)} />
                <Bar className="h-3 w-14" style={bg(brand.funSolid)} />
            </div>
            <div className="ms-5 mt-3 flex gap-3">
                {FUN.courses.slice(0, 3).map((course, i) => (
                    <span
                        key={i}
                        className="w-40 shrink-0 overflow-hidden rounded-3xl border-2 bg-white"
                        style={edge(FUN.lineCard)}
                    >
                        <span
                            className="relative flex h-24 items-center justify-center overflow-hidden"
                            style={bg(course.solid)}
                        >
                            <span
                                className="absolute -end-8 -top-8 size-24 rounded-full opacity-50"
                                style={bg(course.light)}
                            />
                            <span
                                className="relative flex size-12 items-center justify-center rounded-2xl bg-white"
                                style={fg(course.solid)}
                            >
                                <BookOpen size={24} weight="bold" />
                            </span>
                        </span>
                        <span className="flex flex-col gap-2 p-3">
                            <Bar className="h-3.5 w-20" style={bg(FUN.ink)} />
                            <span
                                className="h-2 overflow-hidden rounded-full"
                                style={bg(FUN.lineCard)}
                            >
                                <span
                                    className={cn(
                                        'block h-full rounded-full',
                                        ['w-3/4', 'w-1/2', 'w-1/5'][i]
                                    )}
                                    style={bg(course.solid)}
                                />
                            </span>
                        </span>
                    </span>
                ))}
            </div>

            <BottomTabs
                active={0}
                wide
                activeBg={brand.funTint}
                activeInk={brand.funSolid}
                lineColor={FUN.lineNav}
            />
        </>
    );
}

/** Fun's two bottom buttons: an outlined one and the brand one, both on a lip. */
function LipButtons({
    brand,
    label,
    back,
}: {
    brand: BrandPalette;
    label: string;
    back: 'previous' | 'retry';
}) {
    const BackIcon = back === 'retry' ? ArrowCounterClockwise : ArrowLeft;
    return (
        <div className="flex gap-3">
            <span
                className="flex h-14 w-28 items-center justify-center rounded-2xl border-2 bg-white"
                style={merge(edge(FUN.lineButton), lip(FUN.lineButton), fg(FUN.ink))}
            >
                <BackIcon size={22} weight="bold" />
            </span>
            <span
                className="flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl text-lg font-black text-white"
                style={merge(bg(brand.funSolid), lip(brand.funLip))}
            >
                {label}
                <ArrowRight size={20} weight="bold" />
            </span>
        </div>
    );
}

function FunLesson({ brand, copy }: Props) {
    return (
        <>
            <div className="px-3 pt-2">
                <div className="flex items-center gap-1.5">
                    <span
                        className="flex size-11 items-center justify-center"
                        style={fg(FUN.muted)}
                    >
                        <X size={22} weight="bold" />
                    </span>
                    <span className="flex-1">
                        <Bar className="h-3.5 w-40" style={bg(FUN.ink2)} />
                    </span>
                    <span className="pe-2 text-sm font-black" style={fg(FUN.muted)}>
                        3/5
                    </span>
                </div>
                <span
                    className="ms-2.5 mt-1 block h-3.5 overflow-hidden rounded-full"
                    style={bg(FUN.violetTrack)}
                >
                    <span className="block h-full w-2/5 rounded-full" style={bg(COURSE.solid)} />
                </span>
            </div>
            <div
                className="relative mx-5 mt-4 h-48 shrink-0 overflow-hidden rounded-3xl"
                style={bg(COURSE.solid)}
            >
                <span
                    className="absolute -end-6 top-2 size-44 rounded-full"
                    style={bg(COURSE.light)}
                />
                <span
                    className="absolute inset-x-4 top-24 border-t-4 border-dashed"
                    style={edge(FUN.violetLine)}
                />
                <span
                    className="absolute start-1/2 top-12 flex size-16 -translate-x-1/2 items-center justify-center rounded-full bg-white rtl:translate-x-1/2"
                    style={merge(fg(COURSE.solid), lip(COURSE.lip))}
                >
                    <Play size={26} weight="fill" />
                </span>
                <span
                    className="absolute inset-x-4 bottom-3 h-1.5 overflow-hidden rounded-full"
                    style={bg(COURSE.light)}
                >
                    <span className="block h-full w-2/5 rounded-full" style={bg(FUN.highlight)} />
                </span>
            </div>
            <div className="flex flex-col gap-2.5 px-5 pt-4">
                <Bar className="h-2.5 w-44" style={bg(COURSE.solid)} />
                <Bar className="h-6 w-48" style={bg(FUN.ink)} />
                <Bar className="mt-1 h-3 w-full" style={bg(FUN.lineButton)} />
                <Bar className="h-3 w-4/5" style={bg(FUN.lineButton)} />
                <span
                    className="mt-1 flex flex-col gap-2 rounded-2xl p-4"
                    style={bg(FUN.violetSoft)}
                >
                    <Bar className="h-5 w-40" style={bg(FUN.violetInk)} />
                    <Bar className="h-2.5 w-56" style={bg(FUN.muted)} />
                </span>
            </div>
            <div
                className="absolute inset-x-0 bottom-0 flex flex-col gap-2.5 border-t-2 bg-white px-5 pb-6 pt-3"
                style={edge(FUN.lineNav)}
            >
                <Bar className="h-2.5 w-28" style={bg(FUN.muted)} />
                <LipButtons brand={brand} label={copy.nextLabel} back="previous" />
            </div>
        </>
    );
}

function FunResult({ brand, copy }: Props) {
    const tiles = [
        { tint: FUN.successTint, ink: FUN.successStrong, value: '3' },
        { tint: FUN.liveTint, ink: FUN.liveText, value: '2' },
        { tint: FUN.infoTint, ink: FUN.info, value: '1/3' },
    ];
    return (
        <>
            <div className="flex items-center gap-1 px-3 pt-2">
                <span className="flex size-11 items-center justify-center" style={fg(FUN.muted)}>
                    <X size={22} weight="bold" />
                </span>
                <Bar className="h-3 w-56" style={bg(FUN.muted)} />
            </div>
            <div
                className="relative mx-5 mt-1 overflow-hidden rounded-3xl px-5 pb-5 pt-5 text-center"
                style={bg(FUN.testTint)}
            >
                <span
                    className="absolute start-6 top-5 size-3.5 rotate-12 rounded"
                    style={bg(FUN.confetti[0])}
                />
                <span
                    className="absolute end-10 top-6 size-4 rounded-full"
                    style={bg(FUN.confetti[1])}
                />
                <span
                    className="absolute start-14 top-20 size-3 rotate-45"
                    style={bg(FUN.confetti[2])}
                />
                <span
                    className="absolute end-12 top-20 h-2 w-4 -rotate-12 rounded-full"
                    style={bg(FUN.confetti[3])}
                />
                <span
                    className="absolute end-6 top-24 size-2.5 rounded-full"
                    style={bg(FUN.confetti[4])}
                />
                <svg viewBox="0 0 148 148" className="relative mx-auto size-32">
                    <circle cx="74" cy="74" r="62" fill="white" />
                    <circle
                        cx="74"
                        cy="74"
                        r="62"
                        fill="none"
                        strokeWidth="14"
                        stroke={FUN.testRing}
                    />
                    <circle
                        cx="74"
                        cy="74"
                        r="62"
                        fill="none"
                        strokeWidth="14"
                        strokeLinecap="round"
                        strokeDasharray="233.7 389.6"
                        transform="rotate(-90 74 74)"
                        stroke={FUN.success}
                    />
                    <text
                        x="74"
                        y="86"
                        textAnchor="middle"
                        fontSize="36"
                        fontWeight="900"
                        fill={FUN.ink}
                    >
                        60%
                    </text>
                </svg>
                <p className="relative mt-3 text-3xl font-black leading-tight">{copy.passed}</p>
                <Bar className="relative mx-auto mt-2 h-3 w-40 bg-yellow-800" />
            </div>
            <div className="mx-5 mt-3 grid grid-cols-3 gap-2.5">
                {tiles.map((tile, i) => (
                    <span
                        key={i}
                        className="flex flex-col items-center gap-1.5 rounded-2xl p-3"
                        style={bg(tile.tint)}
                    >
                        <span className="text-2xl font-black leading-none" style={fg(tile.ink)}>
                            {tile.value}
                        </span>
                        <Bar className="h-2 w-12" style={bg(tile.ink)} />
                    </span>
                ))}
            </div>
            <div className="mx-5 mt-4 flex flex-col gap-2">
                <Bar className="h-4 w-40" style={bg(FUN.ink)} />
                {[true, false].map((right, i) => (
                    <span
                        key={i}
                        className="flex h-12 items-center gap-3 rounded-2xl border-2 px-3.5"
                        style={
                            right ? edge(FUN.lineCard) : merge(edge(FUN.liveLine), bg(FUN.liveRow))
                        }
                    >
                        <span
                            className="flex size-6 items-center justify-center rounded-full text-white"
                            style={bg(right ? FUN.success : FUN.live)}
                        >
                            {right ? (
                                <Check size={14} weight="bold" />
                            ) : (
                                <X size={14} weight="bold" />
                            )}
                        </span>
                        <Bar className={cn('h-3', right ? 'w-44' : 'w-52')} style={bg(FUN.ink2)} />
                    </span>
                ))}
            </div>
            <div className="absolute inset-x-5 bottom-6">
                <LipButtons brand={brand} label={copy.nextLabel} back="retry" />
            </div>
        </>
    );
}
