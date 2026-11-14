/**
 * What pressing Start does, without React. Returns what the screen should show next.
 *
 * With a meeting screen, `openMeeting` settles only when that screen closes, so this
 * function returns as soon as the screen is asked for and reports the end through
 * `onMeetingSettled`.
 */
import type { TodayClass } from '@/classroom-shared/apiTypes';
import {
    detectHostProvider,
    isHttpUrl,
    type HostActionResult,
    type HostActions,
    type HostProvider,
    type HostTarget,
} from '@/classroom-shared/hostActions';
import { logActivity } from '../device/activityLog';
import type { PanelOpenResult } from '../lib/native';
import { classCapability, type ClassCapability } from './capability';

export type DeviceReason =
    /** The capability table sends this provider to the teacher's device. */
    | 'unsupported'
    /** openExternal found nothing to open the link with. */
    | 'no-browser'
    /** An APK without the meeting screen, or the meeting screen refused the link. */
    | 'no-meeting-screen'
    /** The teacher chose it after a failed start. */
    | 'chosen';

export type StartOutcome =
    /** The meeting screen was asked for. The rest arrives at `onMeetingSettled`. */
    | { kind: 'meeting' }
    | { kind: 'external'; noHostLink: boolean }
    | { kind: 'device'; reason: DeviceReason }
    | { kind: 'meeting-ended'; scheduleId: string }
    | { kind: 'recreate-blocked'; message: string | null }
    | { kind: 'already-open' }
    /** There is no link and no host flow, so nothing here can start it. */
    | { kind: 'no-link' }
    /** The server answered but had no link for this class. */
    | { kind: 'no-url' }
    | { kind: 'failed' }
    /** The teacher left this screen before the answer came. Do nothing. */
    | { kind: 'cancelled' };

export interface StartDeps {
    host: HostActions;
    /** At click time. */
    webViewMajor: () => Promise<number>;
    bbbInAppMinWebview: () => number;
    /** The classroom APK's plugin is there. */
    hasMeetingScreen: () => boolean;
    isMeetingOpen: () => boolean;
    setMeetingOpen: (open: boolean) => void;
    setOpenedClassEnd: (endsAtMs: number | null | undefined) => void;
    openMeeting: (url: string) => Promise<PanelOpenResult>;
    openExternal: (url: string) => Promise<PanelOpenResult>;
    onMeetingSettled: (result: PanelOpenResult, item: TodayClass) => void;
    isCancelled: () => boolean;
}

/** The class was opened here or handed to another app or device: the end-of-class clock and the activity log. */
function noteOpened(item: TodayClass, deps: StartDeps): void {
    deps.setOpenedClassEnd(item.ends_at_ms);
    logActivity({
        kind: 'CLASS',
        ref_id: item.schedule_id,
        parent_id: item.session_id,
        title: item.title,
    });
}

export function hostTargetOf(item: TodayClass): HostTarget {
    return {
        sessionId: item.session_id,
        scheduleId: item.schedule_id,
        linkType: item.link_type,
        streamingType: item.streaming_type,
        externalLink: item.external_link,
    };
}

/** The provider on the card, the same rule resolveHostAction uses. */
export function providerOfClass(item: TodayClass): HostProvider | 'external' | null {
    const host = detectHostProvider(item.link_type, item.streaming_type);
    if (host && item.schedule_id) return host;
    return isHttpUrl(item.external_link) ? 'external' : null;
}

function openInMeetingScreen(item: TodayClass, url: string, deps: StartDeps): StartOutcome {
    if (deps.isMeetingOpen()) return { kind: 'already-open' };
    noteOpened(item, deps);
    deps.setMeetingOpen(true);
    void deps.openMeeting(url).then((result) => {
        // ALREADY_OPEN: the earlier meeting is still up and still owns the flag.
        if (result.opened || result.reason !== 'ALREADY_OPEN') deps.setMeetingOpen(false);
        deps.onMeetingSettled(result, item);
    });
    return { kind: 'meeting' };
}

async function openInAnotherApp(
    item: TodayClass,
    url: string,
    noHostLink: boolean,
    deps: StartDeps
): Promise<StartOutcome> {
    const opened = await deps.openExternal(url);
    if (deps.isCancelled()) return { kind: 'cancelled' };
    noteOpened(item, deps);
    return opened.opened
        ? { kind: 'external', noHostLink }
        : { kind: 'device', reason: 'no-browser' };
}

/** Acts on what the host flow returned, for a first start or a new room. */
export async function finishStart(
    item: TodayClass,
    capability: ClassCapability,
    result: HostActionResult,
    deps: StartDeps
): Promise<StartOutcome> {
    if (deps.isCancelled()) return { kind: 'cancelled' };
    switch (result.kind) {
        case 'open-url':
            return capability === 'here'
                ? openInMeetingScreen(item, result.url, deps)
                : openInAnotherApp(item, result.url, !!result.noHostLink, deps);
        case 'meeting-ended':
            return { kind: 'meeting-ended', scheduleId: result.scheduleId };
        case 'recreate-blocked':
            return { kind: 'recreate-blocked', message: result.message };
        case 'no-url':
            return { kind: 'no-url' };
        case 'open-route':
        case 'provisioning':
            // Zoom and Meet go to the teacher's device before reaching here.
            noteOpened(item, deps);
            return { kind: 'device', reason: 'unsupported' };
        case 'failed':
            return { kind: 'failed' };
    }
}

export async function startClass(item: TodayClass, deps: StartDeps): Promise<StartOutcome> {
    const action = deps.host.resolveHostAction(hostTargetOf(item));
    if (!action) return { kind: 'no-link' };
    const major = await deps.webViewMajor();
    if (deps.isCancelled()) return { kind: 'cancelled' };
    const capability = classCapability(action.provider, major, deps.bbbInAppMinWebview());
    if (capability === 'device' || (capability === 'here' && !deps.hasMeetingScreen())) {
        noteOpened(item, deps);
        return {
            kind: 'device',
            reason: capability === 'device' ? 'unsupported' : 'no-meeting-screen',
        };
    }
    if (capability === 'here' && deps.isMeetingOpen()) return { kind: 'already-open' };
    return finishStart(item, capability, await action.run(), deps);
}

/** MEETING_ENDED, confirmed: a new room, then the same path as a first start. */
export async function startNewRoom(item: TodayClass, deps: StartDeps): Promise<StartOutcome> {
    return finishStart(item, 'here', await deps.host.startBbb(item.schedule_id, true), deps);
}
