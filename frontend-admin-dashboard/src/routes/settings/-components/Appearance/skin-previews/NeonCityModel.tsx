import {
    BookOpen,
    Books,
    House,
    MapPin,
    Play,
    Star,
    User,
    VideoCamera,
    X,
} from '@phosphor-icons/react';
import { useId, type CSSProperties, type ReactNode } from 'react';
import { Bar, Screen } from './parts';
import { NEON, NEON_DISPLAY, NEON_FONT, bg, edge, fg, lip, merge } from './palette';
import type { ModelCopy, SkinModelProps } from './types';

/**
 * Neon City: Fun's screens at night. A night-blue page, a sunset city behind
 * the greeting, slanted capital headings, neon pink buttons with dark text and
 * stars on a quiz result. It keeps its own pink rather than the brand colour,
 * so the brand is not used here.
 */
export function NeonCityModel({ screen, copy }: SkinModelProps) {
    const root = merge({ fontFamily: NEON_FONT }, bg(NEON.night), fg(NEON.text));
    return (
        <Screen style={root}>
            {screen === 'lesson' ? (
                <NeonLesson copy={copy} />
            ) : screen === 'result' ? (
                <NeonResult copy={copy} />
            ) : (
                <NeonHome copy={copy} />
            )}
        </Screen>
    );
}

const display: CSSProperties = {
    fontFamily: NEON_DISPLAY,
    fontWeight: 400,
    textTransform: 'uppercase',
    letterSpacing: '0.02em',
    transform: 'skewX(-8deg)',
    transformOrigin: 'left bottom',
};

/** The greeting's stamped look: a hard pink shadow. */
const stamped: CSSProperties = { textShadow: `3px 3px 0 ${NEON.pink}` };

function Slanted({
    children,
    className,
    style,
}: {
    children: ReactNode;
    className?: string;
    style?: CSSProperties;
}) {
    return (
        <span className={className} style={merge(display, style ?? {})}>
            {children}
        </span>
    );
}

function PinkButton({ children, gold }: { children: ReactNode; gold?: boolean }) {
    return (
        <span
            className="flex h-14 items-center justify-center gap-2 rounded-2xl text-xl"
            style={merge(
                bg(gold ? NEON.gold : NEON.pink),
                fg(NEON.night),
                lip(gold ? NEON.goldLip : NEON.pinkLip),
                { fontFamily: NEON_DISPLAY, letterSpacing: '0.06em', textTransform: 'uppercase' }
            )}
        >
            {children}
        </span>
    );
}

/** The sunset city behind the greeting, reduced to shapes. */
function Scene() {
    const id = useId();
    const sky = `${id}-sky`;
    const sun = `${id}-sun`;
    const cut = `${id}-cut`;
    const towers: Array<[number, number, number]> = [
        [0, 36, 16],
        [16, 54, 20],
        [38, 74, 14],
        [54, 44, 22],
        [150, 40, 18],
        [170, 62, 24],
        [286, 50, 20],
        [308, 90, 18],
        [328, 36, 26],
        [356, 58, 16],
        [372, 32, 18],
    ];
    return (
        <svg
            viewBox="0 0 390 250"
            className="absolute inset-x-0 top-0 h-60 w-full"
            preserveAspectRatio="xMidYMax slice"
            aria-hidden="true"
        >
            <defs>
                <linearGradient id={sky} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor={NEON.sky[0]} />
                    <stop offset="0.42" stopColor={NEON.sky[1]} />
                    <stop offset="0.72" stopColor={NEON.sky[2]} />
                    <stop offset="0.9" stopColor={NEON.sky[3]} />
                </linearGradient>
                <linearGradient id={sun} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor={NEON.sun[0]} />
                    <stop offset="1" stopColor={NEON.sun[1]} />
                </linearGradient>
                <mask id={cut}>
                    <rect width="390" height="250" fill="white" />
                    <rect y="160" width="390" height="3" />
                    <rect y="174" width="390" height="5" />
                    <rect y="189" width="390" height="7" />
                </mask>
            </defs>
            <rect width="390" height="250" fill={`url(#${sky})`} />
            <circle cx="262" cy="180" r="80" fill={`url(#${sun})`} mask={`url(#${cut})`} />
            {towers.map(([x, h, w]) => (
                <rect key={x} x={x} y={216 - h} width={w} height={h} fill={NEON.building} />
            ))}
            <rect y="216" width="390" height="34" fill={NEON.night} />
            <rect y="215" width="390" height="1.5" fill={NEON.pink} />
            <g stroke={NEON.palm} fill="none" strokeLinecap="round" strokeWidth="4">
                <path d="M30 250 C 33 226, 26 204, 38 174" strokeWidth="5" />
                <path d="M38 174 C 20 164, 6 170, -2 184" />
                <path d="M38 174 C 50 156, 66 154, 78 164" />
                <path d="M362 250 C 358 216, 366 184, 356 150" strokeWidth="6" />
                <path d="M356 150 C 374 138, 390 144, 398 158" />
                <path d="M356 150 C 342 132, 326 130, 314 140" />
            </g>
        </svg>
    );
}

function NeonHome({ copy }: { copy: ModelCopy }) {
    return (
        <>
            <Scene />
            <span className="relative flex items-start justify-between px-5 pt-5">
                <span className="block min-w-0">
                    <span className="block text-sm font-bold" style={fg(NEON.soft)}>
                        {copy.greeting}
                    </span>
                    <Slanted className="block truncate text-4xl leading-tight" style={stamped}>
                        {copy.name}
                    </Slanted>
                </span>
                <span
                    className="flex size-11 items-center justify-center rounded-full text-base font-extrabold"
                    style={merge(bg(NEON.gold), fg(NEON.night))}
                >
                    {copy.name.charAt(0)}
                </span>
            </span>

            <span
                className="relative mx-5 mt-28 flex flex-col gap-2.5 rounded-3xl border-2 p-5"
                style={merge(bg(NEON.card), edge(NEON.line), lip(NEON.night, 6))}
            >
                <span
                    className="flex items-center gap-1.5 text-xs font-extrabold tracking-widest"
                    style={fg(NEON.aqua)}
                >
                    <MapPin size={14} weight="fill" />
                    <Bar className="h-2.5 w-24" style={bg(NEON.aqua)} />
                </span>
                <Bar className="h-5 w-48" style={bg(NEON.text)} />
                <span className="flex items-center gap-3">
                    <span
                        className="h-2.5 flex-1 overflow-hidden rounded-full"
                        style={bg(NEON.raised)}
                    >
                        <span className="block h-full w-3/5 rounded-full" style={bg(NEON.aqua)} />
                    </span>
                    <span className="text-sm font-extrabold" style={fg(NEON.aqua)}>
                        60%
                    </span>
                </span>
                <PinkButton>
                    <Play size={18} weight="fill" />
                    {copy.continueLabel}
                </PinkButton>
            </span>

            <span className="mx-5 mt-5 flex items-center justify-between">
                <Slanted className="text-xl">
                    <Bar className="h-4 w-28" style={bg(NEON.text)} />
                </Slanted>
                <Bar className="h-3 w-14" style={bg(NEON.pink)} />
            </span>
            <span className="ms-5 mt-3 flex gap-3">
                {NEON.courses.map((colour, i) => (
                    <span
                        key={colour}
                        className="w-40 shrink-0 overflow-hidden rounded-3xl border-2"
                        style={merge(bg(NEON.card), edge(NEON.line))}
                    >
                        <span className="flex h-16 items-center px-3" style={bg(colour)}>
                            <span
                                className="flex size-9 items-center justify-center rounded-xl"
                                style={merge(bg(NEON.night), fg(colour))}
                            >
                                <BookOpen size={18} weight="bold" />
                            </span>
                        </span>
                        <span className="flex flex-col gap-2 p-3">
                            <Bar className="h-3.5 w-20" style={bg(NEON.text)} />
                            <span
                                className="h-2 overflow-hidden rounded-full"
                                style={bg(NEON.raised)}
                            >
                                <span
                                    className={
                                        [
                                            'block h-full w-3/4 rounded-full',
                                            'block h-full w-1/2 rounded-full',
                                            'block h-full w-1/5 rounded-full',
                                        ][i]
                                    }
                                    style={bg(colour)}
                                />
                            </span>
                        </span>
                    </span>
                ))}
            </span>
            <NeonTabs />
        </>
    );
}

function NeonTabs() {
    const icons = [House, Books, VideoCamera, User];
    return (
        <span
            className="absolute inset-x-0 bottom-0 flex h-20 items-center justify-around border-t-2 px-2"
            style={merge(bg(NEON.night), edge(NEON.raised))}
        >
            {icons.map((Icon, i) => (
                <span
                    key={i}
                    className="flex h-14 w-20 flex-col items-center justify-center gap-1.5"
                    style={fg(i === 0 ? NEON.pink : NEON.quiet)}
                >
                    <Icon size={22} weight={i === 0 ? 'bold' : 'regular'} />
                    <Bar className="h-2 w-9" style={bg(i === 0 ? NEON.pink : NEON.line)} />
                </span>
            ))}
        </span>
    );
}

function NeonLesson({ copy }: { copy: ModelCopy }) {
    return (
        <>
            <span className="block px-3 pt-2">
                <span className="flex items-center gap-1.5">
                    <span
                        className="flex size-11 items-center justify-center"
                        style={fg(NEON.quiet)}
                    >
                        <X size={22} weight="bold" />
                    </span>
                    <span className="flex-1">
                        <Bar className="h-3.5 w-40" style={bg(NEON.soft)} />
                    </span>
                    <span className="pe-2 text-sm font-extrabold" style={fg(NEON.quiet)}>
                        3/5
                    </span>
                </span>
                <span
                    className="ms-2.5 mt-1 block h-3.5 overflow-hidden rounded-full"
                    style={bg(NEON.raised)}
                >
                    <span className="block h-full w-2/5 rounded-full" style={bg(NEON.aqua)} />
                </span>
            </span>
            <span
                className="relative mx-5 mt-4 flex h-48 shrink-0 items-center justify-center overflow-hidden rounded-3xl border-2"
                style={merge(bg(NEON.card), edge(NEON.line))}
            >
                <span
                    className="flex size-16 items-center justify-center rounded-full"
                    style={merge(bg(NEON.pink), fg(NEON.night), lip(NEON.pinkLip))}
                >
                    <Play size={26} weight="fill" />
                </span>
            </span>
            <span className="flex flex-col gap-2.5 px-5 pt-4">
                <Bar className="h-2.5 w-44" style={bg(NEON.aqua)} />
                <Bar className="h-6 w-48" style={bg(NEON.text)} />
                <Bar className="mt-1 h-3 w-full" style={bg(NEON.line)} />
                <Bar className="h-3 w-4/5" style={bg(NEON.line)} />
            </span>
            <span
                className="absolute inset-x-0 bottom-0 flex gap-3 border-t-2 px-5 pb-6 pt-3"
                style={merge(bg(NEON.night), edge(NEON.raised))}
            >
                <span
                    className="flex h-14 w-24 items-center justify-center rounded-2xl border-2"
                    style={merge(edge(NEON.line), fg(NEON.quiet))}
                >
                    <Bar className="h-3 w-12" style={bg(NEON.quiet)} />
                </span>
                <span className="flex-1">
                    <PinkButton>{copy.nextLabel}</PinkButton>
                </span>
            </span>
        </>
    );
}

function NeonResult({ copy }: { copy: ModelCopy }) {
    return (
        <>
            <span className="flex items-center gap-1 px-3 pt-2">
                <span className="flex size-11 items-center justify-center" style={fg(NEON.quiet)}>
                    <X size={22} weight="bold" />
                </span>
                <Bar className="h-3 w-56" style={bg(NEON.quiet)} />
            </span>
            <span
                className="relative mx-5 mt-2 flex flex-col items-center gap-3 rounded-3xl border-2 p-6 text-center"
                style={merge(bg(NEON.card), edge(NEON.line))}
            >
                <span className="flex items-end gap-2">
                    {[0, 1, 2].map((i) => (
                        <Star
                            key={i}
                            size={i === 1 ? 52 : 40}
                            weight={i < 2 ? 'fill' : 'regular'}
                            style={fg(i < 2 ? NEON.gold : NEON.starOff)}
                        />
                    ))}
                </span>
                <span
                    className="px-5 pb-0.5 pt-1.5"
                    style={merge(bg(NEON.gold), lip(NEON.pink, 6), { transform: 'skewX(-8deg)' })}
                >
                    <span
                        className="block text-3xl"
                        style={merge(fg(NEON.night), {
                            fontFamily: NEON_DISPLAY,
                            textTransform: 'uppercase',
                            letterSpacing: '0.03em',
                        })}
                    >
                        {copy.passed}
                    </span>
                </span>
                <Slanted className="mt-2 text-6xl leading-none">8 / 10</Slanted>
                <Bar className="h-3 w-32" style={bg(NEON.soft)} />
            </span>
            <span className="mx-5 mt-4 grid grid-cols-10 gap-1.5">
                {Array.from({ length: 10 }, (_, i) => (
                    <span
                        key={i}
                        className="h-7 rounded-lg border-2"
                        style={
                            i === 3 || i === 8
                                ? edge(NEON.coral)
                                : merge(bg(NEON.aqua), edge(NEON.aqua))
                        }
                    />
                ))}
            </span>
            <span className="absolute inset-x-5 bottom-6">
                <PinkButton>{copy.nextLabel}</PinkButton>
            </span>
        </>
    );
}
