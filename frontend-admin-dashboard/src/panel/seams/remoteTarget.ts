/**
 * What a phone remote moves on the panel.
 *
 * One slot, one owner at a time. A screen that can be driven calls
 * useRemoteTarget({ next, prev, state }); the slot is cleared on unmount. Which
 * screen registers is decided per slide kind (see PanelPlayer):
 *
 *   PanelVoltPresenter                 go(+1) / go(-1)
 *   lesson pdf                         PanelPdfViewer's page jump; PanelPlayer passes null
 *   lesson scene, file-video, ai-video PanelPlayer's previous / next slide
 *   lesson deck, youtube, vimeo,
 *   missing, unsupported               null: the phone says "Use the panel for this screen"
 *
 * A null target releases only that component's own registration. Effects run
 * child first, so PanelPlayer's null must not wipe the viewer mounted inside it.
 *
 * Panel-side only, Chrome 66. The sync loop feeds applyNavCounter and reads
 * getRemoteTargetInfo; the offline resume record reads getRemoteTargetInfo.
 */
import { useEffect, useRef } from 'react';
import type { PanelNavState } from '@/classroom-shared/apiTypes';

export type RemoteTargetState = PanelNavState;

export interface RemoteTarget {
    next: () => void;
    prev: () => void;
    state: RemoteTargetState;
    /** Absolute jump used by resume. Never reachable from the phone, which sends only +1 and -1. */
    seek?: (index: number) => void;
}

export interface RemoteTargetInfo {
    /** Drives `presenting` on /sync. */
    hasTarget: boolean;
    state: RemoteTargetState | null;
}

/** A press older than this waited out a dropout; it must not fire when wifi returns. */
export const NAV_MAX_AGE_MS = 8000;
export const NAV_MAX_STEPS = 3;
/**
 * Steps of one update run one at a time. Targets step from their current
 * position, which only moves after a re-render (or a 400 ms scroll for a PDF),
 * so two synchronous calls would land on the same page.
 */
export const NAV_STEP_POLL_MS = 150;
export const NAV_STEP_MAX_POLLS = 8;

interface Slot {
    owner: object;
    target: RemoteTarget;
}

let slot: Slot | null = null;
const listeners = new Set<() => void>();
let lastInfoKey = infoKey(null);

function infoKey(info: RemoteTargetState | null): string {
    return info ? JSON.stringify([info.index, info.total, info.title]) : '';
}

function publish(): void {
    const key = infoKey(slot ? slot.target.state : null);
    if (key === lastInfoKey) return;
    lastInfoKey = key;
    listeners.forEach((listener) => listener());
}

function register(owner: object, target: RemoteTarget): void {
    slot = { owner, target };
    publish();
}

function release(owner: object): void {
    if (slot && slot.owner === owner) {
        slot = null;
        publish();
    }
}

/**
 * Registers `target` for as long as the component is mounted. `target` may be a
 * new object every render: the latest committed one is what the remote calls.
 */
export function useRemoteTarget(target: RemoteTarget | null): void {
    const ownerRef = useRef<object>({});
    const owner = ownerRef.current;
    useEffect(() => {
        if (target) register(owner, target);
        else release(owner);
    });
    useEffect(() => () => release(owner), [owner]);
}

export function getRemoteTargetInfo(): RemoteTargetInfo {
    if (!slot) return { hasTarget: false, state: null };
    const { index, total, title } = slot.target.state;
    return { hasTarget: true, state: { index, total, title } };
}

/** Called when a target appears, disappears or changes position. Returns an unsubscribe. */
export function subscribeRemoteTarget(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** Absolute jump for resume. False when there is no target or it cannot seek. */
export function seekRemoteTarget(index: number): boolean {
    const seek = slot ? slot.target.seek : undefined;
    if (!seek) return false;
    seek(index);
    return true;
}

function isDialogOpen(): boolean {
    return !!document.querySelector('[role="dialog"], [role="alertdialog"]');
}

// ---------------------------------------------------------- nav counter ---

export interface NavCounterUpdate {
    session_id: string;
    nav_counter: number;
    nav_age_ms: number | null;
}

export type NavApplyOutcome =
    /** First sight of this session: the baseline was set, nothing moved. */
    | 'BASELINE'
    /** No new presses. */
    | 'NO_CHANGE'
    /** Presses too old to act on (over 8 s, or no age reported). */
    | 'STALE'
    | 'DIALOG_OPEN'
    | 'NO_TARGET'
    | 'APPLIED';

export interface NavApplyResult {
    outcome: NavApplyOutcome;
    /** Signed steps queued; 0 unless APPLIED. An APPLIED result counts as activity for idle. */
    steps: number;
}

let baselineSession: string | null = null;
let baseline = 0;
let pendingSteps = 0;
let stepTimer: ReturnType<typeof setTimeout> | null = null;
let waitingOnIndex: number | null = null;
let waitPolls = 0;

function cancelSteps(): void {
    pendingSteps = 0;
    waitingOnIndex = null;
    waitPolls = 0;
    if (stepTimer !== null) {
        clearTimeout(stepTimer);
        stepTimer = null;
    }
}

function runStep(): void {
    stepTimer = null;
    const target = slot ? slot.target : null;
    if (!target || isDialogOpen()) {
        cancelSteps();
        return;
    }
    // Let the previous step land before the next one, but never wait forever:
    // a press on the last page does not move anything.
    if (
        waitingOnIndex !== null &&
        target.state.index === waitingOnIndex &&
        waitPolls < NAV_STEP_MAX_POLLS
    ) {
        waitPolls += 1;
        stepTimer = setTimeout(runStep, NAV_STEP_POLL_MS);
        return;
    }
    waitingOnIndex = null;
    waitPolls = 0;
    if (pendingSteps === 0) return;

    const forward = pendingSteps > 0;
    pendingSteps += forward ? -1 : 1;
    waitingOnIndex = target.state.index;
    try {
        if (forward) target.next();
        else target.prev();
    } catch (error) {
        console.warn('[panel/remote] target failed', error);
        cancelSteps();
        return;
    }
    stepTimer = setTimeout(runStep, NAV_STEP_POLL_MS);
}

/**
 * One /sync result in. The baseline always moves, so a press that is dropped
 * here is gone for good rather than firing later. There is deliberately no
 * client gap timer: at a 5 s sync it would equal the interval and drop the
 * first press after the phone had been idle. `nav_age_ms` from the server is
 * the only freshness signal.
 */
export function applyNavCounter(update: NavCounterUpdate): NavApplyResult {
    if (update.session_id !== baselineSession) {
        cancelSteps();
        baselineSession = update.session_id;
        baseline = update.nav_counter;
        return { outcome: 'BASELINE', steps: 0 };
    }
    const diff = update.nav_counter - baseline;
    baseline = update.nav_counter;
    if (diff === 0) return { outcome: 'NO_CHANGE', steps: 0 };
    if (update.nav_age_ms === null || update.nav_age_ms > NAV_MAX_AGE_MS) {
        return { outcome: 'STALE', steps: 0 };
    }
    if (isDialogOpen()) return { outcome: 'DIALOG_OPEN', steps: 0 };
    if (!slot) return { outcome: 'NO_TARGET', steps: 0 };

    const steps = Math.max(-NAV_MAX_STEPS, Math.min(NAV_MAX_STEPS, diff));
    pendingSteps = Math.max(-NAV_MAX_STEPS, Math.min(NAV_MAX_STEPS, pendingSteps + steps));
    if (stepTimer === null) runStep();
    return { outcome: 'APPLIED', steps };
}

/** Sign-out or session end: forget the session so the next one starts from its own baseline. */
export function resetNavBaseline(): void {
    cancelSteps();
    baselineSession = null;
    baseline = 0;
}
