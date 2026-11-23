/**
 * The built-in learner dashboard widgets as placeable blocks (spec 2.6, 3.3).
 * One row per widget: where it goes by default, whether it can be removed,
 * its default options, and the learner-side conditions the editor explains.
 */
import {
    BUILTIN_WIDGETS,
    type BuiltinOptions,
    type BuiltinWidget,
    type DesktopPlacement,
    type StatsCard,
} from '../-types/learner-home-types';

export const STATS_CARDS: readonly StatsCard[] = ['COURSES', 'LIVE_CLASSES', 'EVALUATIONS'];

export interface BuiltinInfo {
    widget: BuiltinWidget;
    defaultPlacement: DesktopPlacement;
    /** HERO is required: it can move but never be deleted. */
    removable: boolean;
    defaultOptions: BuiltinOptions;
    /** Left out of the Fun look's home (learner FUN_HOME_LEAVES_OUT). */
    hiddenInFun: boolean;
    /** Shows only when its own learner-side setting allows it. */
    ownGate: boolean;
}

const FUN_LEAVES_OUT: ReadonlySet<BuiltinWidget> = new Set<BuiltinWidget>([
    'TODAY_TASKS',
    'UPCOMING_LIVE_CLASSES',
    'STATS_ROW',
    'GAMIFICATION',
    'LEARNING_ANALYTICS',
    'MY_MEMBERSHIP',
    'MY_BOOKS',
    'MY_ORDERS',
    'THIS_WEEK_ATTENDANCE',
    'MY_MENTORS',
    'GET_APP',
]);

const OWN_GATE: ReadonlySet<BuiltinWidget> = new Set<BuiltinWidget>([
    'PINS',
    'NOTEBOOK_REVIEW',
    'COMPANIONS',
    'RAISE_QUERY',
]);

const PLACEMENT: Record<BuiltinWidget, DesktopPlacement> = {
    HERO: 'FULL',
    PINS: 'RAIL',
    NOTEBOOK_REVIEW: 'MAIN',
    COMPANIONS: 'MAIN',
    TODAY_TASKS: 'RAIL',
    CONTINUE_LEARNING: 'MAIN',
    ENROLLED_COURSES: 'MAIN',
    STATS_ROW: 'MAIN',
    LEARNING_ANALYTICS: 'MAIN',
    MY_MEMBERSHIP: 'MAIN',
    MY_BOOKS: 'MAIN',
    MY_ORDERS: 'MAIN',
    UPCOMING_LIVE_CLASSES: 'RAIL',
    THIS_WEEK_ATTENDANCE: 'RAIL',
    MY_MENTORS: 'RAIL',
    GET_APP: 'RAIL',
    GAMIFICATION: 'FULL',
    RAISE_QUERY: 'FULL',
    EXPLORE_BUTTONS: 'FULL',
};

export function defaultBuiltinOptions(widget: BuiltinWidget): BuiltinOptions {
    switch (widget) {
        case 'HERO':
            return { getting_started: true };
        case 'STATS_ROW':
            return { cards: [...STATS_CARDS] };
        case 'ENROLLED_COURSES':
            return { show_all: false };
        case 'EXPLORE_BUTTONS':
            return { memberships: true, books: true };
        default:
            return {};
    }
}

export const BUILTIN_INFO: Record<BuiltinWidget, BuiltinInfo> = Object.fromEntries(
    BUILTIN_WIDGETS.map((widget) => [
        widget,
        {
            widget,
            defaultPlacement: PLACEMENT[widget],
            removable: widget !== 'HERO',
            defaultOptions: defaultBuiltinOptions(widget),
            hiddenInFun: FUN_LEAVES_OUT.has(widget),
            ownGate: OWN_GATE.has(widget),
        },
    ])
) as Record<BuiltinWidget, BuiltinInfo>;

/** Options a widget accepts; anything else is dropped before a save. */
export function cleanBuiltinOptions(
    widget: BuiltinWidget,
    options: BuiltinOptions
): BuiltinOptions {
    const o = options ?? {};
    switch (widget) {
        case 'HERO':
            return { getting_started: o.getting_started !== false };
        case 'STATS_ROW':
            return {
                cards: STATS_CARDS.filter((c) => (o.cards ?? STATS_CARDS).includes(c)),
            };
        case 'ENROLLED_COURSES':
            return { show_all: o.show_all === true };
        case 'EXPLORE_BUTTONS':
            return { memberships: o.memberships !== false, books: o.books !== false };
        default:
            return {};
    }
}
