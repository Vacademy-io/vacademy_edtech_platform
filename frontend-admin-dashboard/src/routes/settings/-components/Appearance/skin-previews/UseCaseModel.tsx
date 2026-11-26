import { BookOpen, Books, House, Play, User, VideoCamera, X } from '@phosphor-icons/react';
import type { CSSProperties, ReactNode } from 'react';
import { Bar, Screen } from './parts';
import { CALM, PULSE, STAGE, bg, edge, fg, lip, merge, type UseCaseLook } from './palette';
import type { ModelCopy, SkinModelProps } from './types';

/**
 * The use-case skins, each Fun's screens in its own look: Stage (dance and art
 * academies), Calm (yoga institutes) and Pulse (fitness and gyms). One scale
 * model drawn from each look's colours and type. Like Neon City, they keep
 * their own action colour, so the brand is not used here.
 */
function UseCaseModel({ screen, copy, look }: SkinModelProps & { look: UseCaseLook }) {
    const root = merge({ fontFamily: look.body }, bg(look.page), fg(look.ink));
    return (
        <Screen style={root}>
            {screen === 'lesson' ? (
                <Lesson copy={copy} look={look} />
            ) : screen === 'result' ? (
                <Result copy={copy} look={look} />
            ) : (
                <Home copy={copy} look={look} />
            )}
        </Screen>
    );
}

export function StageModel(props: SkinModelProps) {
    return <UseCaseModel {...props} look={STAGE} />;
}
export function CalmModel(props: SkinModelProps) {
    return <UseCaseModel {...props} look={CALM} />;
}
export function PulseModel(props: SkinModelProps) {
    return <UseCaseModel {...props} look={PULSE} />;
}

interface Props {
    copy: ModelCopy;
    look: UseCaseLook;
}

const headingStyle = (look: UseCaseLook): CSSProperties => ({
    fontFamily: look.display,
    fontStyle: look.italic ? 'italic' : 'normal',
    fontWeight: look.upper ? 800 : 600,
    textTransform: look.upper ? 'uppercase' : 'none',
});

function ActionButton({ look, children }: { look: UseCaseLook; children: ReactNode }) {
    return (
        <span
            className="flex h-14 items-center justify-center gap-2 text-lg font-bold"
            style={merge(
                bg(look.action),
                fg(look.actionInk),
                lip(look.actionLip),
                { borderRadius: look.pill ? 999 : 16 },
                look.upper ? headingStyle(look) : {}
            )}
        >
            {children}
        </span>
    );
}

function Home({ copy, look }: Props) {
    return (
        <>
            <span
                className="relative block h-48 overflow-hidden rounded-b-3xl px-5 pt-5"
                style={merge(bg(look.band), fg(look.bandInk))}
            >
                <BandArt look={look} />
                <span className="relative flex items-start justify-between">
                    <span className="block min-w-0">
                        <span className="block text-sm font-semibold opacity-90">
                            {copy.greeting}
                        </span>
                        <span
                            className="block truncate text-4xl leading-tight"
                            style={headingStyle(look)}
                        >
                            {copy.name}
                        </span>
                    </span>
                    <span
                        className="flex size-11 items-center justify-center rounded-full text-base font-bold"
                        style={merge(bg(look.card), fg(look.ink))}
                    >
                        {copy.name.charAt(0)}
                    </span>
                </span>
            </span>
            <span
                className="relative mx-5 -mt-12 flex flex-col gap-2.5 rounded-3xl border p-5"
                style={merge(bg(look.hero), fg(look.heroInk), edge(look.line))}
            >
                <Bar className="h-2.5 w-28" style={bg(look.accent)} />
                <Bar className="h-5 w-44" style={bg(look.heroInk)} />
                <span className="h-2.5 overflow-hidden rounded-full" style={bg(look.track)}>
                    <span className="block h-full w-3/5 rounded-full" style={bg(look.action)} />
                </span>
                <ActionButton look={look}>
                    <Play size={18} weight="fill" />
                    {copy.continueLabel}
                </ActionButton>
            </span>
            <span className="mx-5 mt-5 flex items-center justify-between">
                <Bar className="h-4 w-28" style={bg(look.ink)} />
                <Bar className="h-3 w-14" style={bg(look.courses[0] ?? look.ink)} />
            </span>
            <span className="ms-5 mt-3 flex gap-3">
                {look.courses.map((colour) => (
                    <span
                        key={colour}
                        className="w-36 shrink-0 overflow-hidden rounded-3xl border"
                        style={merge(bg(look.card), edge(look.line))}
                    >
                        <span className="flex h-16 items-center px-3" style={bg(colour)}>
                            <span
                                className="flex size-9 items-center justify-center rounded-xl"
                                style={merge(bg(look.card), fg(colour))}
                            >
                                <BookOpen size={18} weight="bold" />
                            </span>
                        </span>
                        <span className="flex flex-col gap-2 p-3">
                            <Bar className="h-3.5 w-20" style={bg(look.ink)} />
                            <Bar className="h-2 w-16" style={bg(colour)} />
                        </span>
                    </span>
                ))}
            </span>
            <Tabs look={look} />
        </>
    );
}

/** A hint of each skin's art behind the greeting. */
function BandArt({ look }: { look: UseCaseLook }) {
    if (look === STAGE) {
        return (
            <svg
                viewBox="0 0 160 120"
                className="absolute -end-6 top-8 h-32 w-44"
                aria-hidden="true"
            >
                <g fill="none" stroke={look.action} strokeWidth="2.5">
                    <circle cx="80" cy="60" r="44" />
                    <path d="M80 60 C 104 36, 132 36, 132 66 C 132 96, 104 96, 80 72 C 56 48, 28 48, 28 78" />
                </g>
                <circle cx="80" cy="60" r="6" fill={look.action} />
            </svg>
        );
    }
    if (look === CALM) {
        return (
            <svg
                viewBox="0 0 390 190"
                className="absolute inset-0 size-full"
                preserveAspectRatio="xMidYMax slice"
                aria-hidden="true"
            >
                <circle cx="268" cy="132" r="40" fill={CALM_SUN} />
                <path
                    d="M0 150 C 90 120, 180 140, 270 146 C 330 150, 360 140, 390 142 V190 H0 Z"
                    fill={CALM_HILL}
                />
                <path d="M0 170 C 120 156, 260 178, 390 166 V190 H0 Z" fill={look.action} />
            </svg>
        );
    }
    return (
        <svg
            viewBox="0 0 390 190"
            className="absolute inset-0 size-full"
            preserveAspectRatio="none"
            aria-hidden="true"
        >
            <path
                d="M0 150 H170 L186 110 L202 186 L218 90 L234 166 L246 150 H390"
                fill="none"
                stroke={look.bandInk}
                strokeWidth="2"
                opacity="0.35"
            />
        </svg>
    );
}

const CALM_SUN = '#E9B48F'; // design-lint-ignore: learner Calm token --calm-clay
const CALM_HILL = '#A9BFA9'; // design-lint-ignore: Calm scene hill

function Tabs({ look }: { look: UseCaseLook }) {
    const icons = [House, Books, VideoCamera, User];
    const active = look.main;
    return (
        <span
            className="absolute inset-x-0 bottom-0 flex h-20 items-center justify-around border-t px-2"
            style={merge(bg(look === PULSE ? look.page : look.card), edge(look.line))}
        >
            {icons.map((Icon, i) => (
                <span
                    key={i}
                    className="flex h-14 w-20 flex-col items-center justify-center gap-1.5"
                    style={fg(i === 0 ? active : look.quiet)}
                >
                    <Icon size={22} weight={i === 0 ? 'bold' : 'regular'} />
                    <Bar className="h-2 w-9" style={bg(i === 0 ? active : look.line)} />
                </span>
            ))}
        </span>
    );
}

function Lesson({ copy, look }: Props) {
    return (
        <>
            <span className="block px-3 pt-2">
                <span className="flex items-center gap-1.5">
                    <span
                        className="flex size-11 items-center justify-center"
                        style={fg(look.quiet)}
                    >
                        <X size={22} weight="bold" />
                    </span>
                    <span className="flex-1">
                        <Bar className="h-3.5 w-40" style={bg(look.ink)} />
                    </span>
                </span>
                <span
                    className="ms-2.5 mt-1 block h-3 overflow-hidden rounded-full"
                    style={bg(look.line)}
                >
                    <span
                        className="block h-full w-2/5 rounded-full"
                        style={bg(look.courses[0] ?? look.ink)}
                    />
                </span>
            </span>
            <span
                className="relative mx-5 mt-4 flex h-48 shrink-0 items-center justify-center overflow-hidden rounded-3xl"
                style={bg(look.courses[0] ?? look.ink)}
            >
                <span
                    className="flex size-16 items-center justify-center rounded-full"
                    style={merge(bg(look.card), fg(look.courses[0] ?? look.ink))}
                >
                    <Play size={26} weight="fill" />
                </span>
            </span>
            <span className="flex flex-col gap-2.5 px-5 pt-4">
                <Bar className="h-6 w-48" style={bg(look.ink)} />
                <Bar className="mt-1 h-3 w-full" style={bg(look.line)} />
                <Bar className="h-3 w-4/5" style={bg(look.line)} />
            </span>
            <span
                className="absolute inset-x-0 bottom-0 border-t px-5 pb-6 pt-3"
                style={merge(bg(look.page), edge(look.line))}
            >
                <ActionButton
                    look={{
                        ...look,
                        action: look.main,
                        actionInk: look.mainInk,
                        actionLip: look.mainLip,
                    }}
                >
                    {copy.nextLabel}
                </ActionButton>
            </span>
        </>
    );
}

function Result({ copy, look }: Props) {
    const ring = look.main;
    return (
        <>
            <span className="flex items-center gap-1 px-3 pt-2">
                <span className="flex size-11 items-center justify-center" style={fg(look.quiet)}>
                    <X size={22} weight="bold" />
                </span>
                <Bar className="h-3 w-56" style={bg(look.quiet)} />
            </span>
            <span
                className="mx-5 mt-2 flex flex-col items-center gap-3 rounded-3xl border p-6 text-center"
                style={merge(bg(look.card), edge(look.line))}
            >
                <svg viewBox="0 0 120 120" className="size-28" aria-hidden="true">
                    <circle
                        cx="60"
                        cy="60"
                        r="48"
                        fill="none"
                        strokeWidth="12"
                        stroke={look.line}
                    />
                    <circle
                        cx="60"
                        cy="60"
                        r="48"
                        fill="none"
                        strokeWidth="12"
                        strokeLinecap="round"
                        strokeDasharray="241 302"
                        transform="rotate(-90 60 60)"
                        stroke={ring}
                    />
                </svg>
                <span className="block text-3xl" style={headingStyle(look)}>
                    {copy.passed}
                </span>
                <Bar className="h-3 w-32" style={bg(look.quiet)} />
            </span>
            <span className="absolute inset-x-5 bottom-6">
                <ActionButton
                    look={{
                        ...look,
                        action: look.main,
                        actionInk: look.mainInk,
                        actionLip: look.mainLip,
                    }}
                >
                    {copy.nextLabel}
                </ActionButton>
            </span>
        </>
    );
}
