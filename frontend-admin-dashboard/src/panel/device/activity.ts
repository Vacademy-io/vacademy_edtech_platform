/**
 * Small signals the session bars read and the rest of the panel writes. No network
 * and no auth here, so any screen can import it.
 */
import { useSyncExternalStore } from 'react';

const activityListeners = new Set<() => void>();

/** Something other than touch or keys counts as use: a press on the phone remote. */
export function notePanelActivity(): void {
    activityListeners.forEach((listener) => listener());
}

export function subscribePanelActivity(listener: () => void): () => void {
    activityListeners.add(listener);
    return () => {
        activityListeners.delete(listener);
    };
}

let meetingOpen = false;

/** Around PanelDevice.openMeeting: idle does not run while the meeting is in front. */
export function setMeetingOpen(open: boolean): void {
    if (meetingOpen && !open) notePanelActivity();
    meetingOpen = open;
}

export function isMeetingOpen(): boolean {
    return meetingOpen;
}

let openedClassEndMs: number | null = null;

/**
 * Call when a class is started from a Today card, with its `ends_at_ms` (server
 * time). Null means no end time: the end-of-class bar never fires, only idle does.
 */
export function setOpenedClassEnd(endsAtMs: number | null | undefined): void {
    openedClassEndMs = typeof endsAtMs === 'number' ? endsAtMs : null;
}

export function getOpenedClassEnd(): number | null {
    return openedClassEndMs;
}

/** True while any <video> on the page is actually playing. */
export function isVideoPlaying(): boolean {
    const videos = document.getElementsByTagName('video');
    for (let i = 0; i < videos.length; i += 1) {
        const video = videos[i];
        if (video && !video.paused && !video.ended && video.readyState > 2) return true;
    }
    return false;
}

/** A clock a little behind the build is not wrong enough to break TLS, or worth a warning. */
const BUILD_DATE_TOLERANCE_MS = 24 * 60 * 60 * 1000;

/** A date before the bundle was built cannot be right, and TLS will fail on it. */
export function isPanelDateWrong(now: number = Date.now()): boolean {
    const builtAt =
        typeof __PANEL_BUILD__ === 'undefined' ? NaN : Date.parse(__PANEL_BUILD__.builtAt);
    return Number.isFinite(builtAt) && now < builtAt - BUILD_DATE_TOLERANCE_MS;
}

let topBars = 0;
const topBarListeners = new Set<() => void>();

/** PanelTopBar calls this while mounted: it already shows the teacher's name and Sign out. */
export function registerTopBar(): () => void {
    topBars += 1;
    topBarListeners.forEach((listener) => listener());
    return () => {
        topBars -= 1;
        topBarListeners.forEach((listener) => listener());
    };
}

function subscribeTopBars(listener: () => void): () => void {
    topBarListeners.add(listener);
    return () => {
        topBarListeners.delete(listener);
    };
}

export function useTopBarMounted(): boolean {
    return useSyncExternalStore(
        subscribeTopBars,
        () => topBars > 0,
        () => topBars > 0
    );
}
