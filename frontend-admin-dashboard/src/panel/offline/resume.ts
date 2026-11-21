/**
 * Back to the same lesson after a power cut, with no taps.
 *
 * panel.resume is rewritten whenever the route or the on-screen position changes.
 * Position comes from the remote-target seam, so the players know nothing about this.
 * At boot, a record whose user matches a session that still looks valid puts the panel
 * back on that screen; the page or slide is restored once its viewer has registered.
 */
import { PANEL_STORAGE_KEYS } from '../config';
import { readActiveDevice, readSessionMeta } from '../device/store';
import { getRefreshToken } from '../lib/api';
import { readJson, removeKey, writeJson } from '../lib/storage';
import { getCurrentRoute, navigate, subscribeRoute, type PanelScreen } from '../router';
import {
    getRemoteTargetInfo,
    seekRemoteTarget,
    subscribeRemoteTarget,
} from '../seams/remoteTarget';
import { offlineUseExpired } from './lock';

export interface PanelResumeRecord {
    screen: PanelScreen;
    params: Record<string, string>;
    page_or_slide_index: number;
    user_id: string;
}

const RESUMABLE: readonly PanelScreen[] = ['lessons', 'volt'];
/** Going to these means the teacher left the lesson. Other screens leave the record alone. */
const LEAVES_LESSON: readonly PanelScreen[] = ['home', 'whiteboard'];

const SEEK_RETRY_MS = 700;
const SEEK_MAX_TRIES = 4;
/** A large PDF on a weak panel can take this long to open. */
const SEEK_GIVE_UP_MS = 60 * 1000;

export function readResumeRecord(): PanelResumeRecord | null {
    const record = readJson<PanelResumeRecord>(PANEL_STORAGE_KEYS.resume);
    if (!record || typeof record.user_id !== 'string' || !record.params) return null;
    return RESUMABLE.indexOf(record.screen) >= 0 ? record : null;
}

export function clearResumeRecord(): void {
    removeKey(PANEL_STORAGE_KEYS.resume);
}

/** While a restored position is on its way, a viewer opening at page one must not overwrite it. */
let pendingSeek: { index: number; cancel: () => void } | null = null;

function sameRoute(record: PanelResumeRecord, params: Record<string, string>): boolean {
    return JSON.stringify(record.params) === JSON.stringify(params);
}

function writeCurrentPosition(): void {
    const route = getCurrentRoute();
    if (LEAVES_LESSON.indexOf(route.screen) >= 0) {
        cancelPendingSeek();
        clearResumeRecord();
        return;
    }
    if (RESUMABLE.indexOf(route.screen) < 0) return;
    const meta = readSessionMeta();
    if (!meta || !readActiveDevice()) return;
    const previous = readResumeRecord();
    const same =
        !!previous && previous.screen === route.screen && sameRoute(previous, route.params);
    const state = getRemoteTargetInfo().state;
    const previousIndex = same && previous ? previous.page_or_slide_index : 0;
    const index = pendingSeek ? pendingSeek.index : state ? state.index : previousIndex;
    if (same && previous && previous.page_or_slide_index === index) return;
    const record: PanelResumeRecord = {
        screen: route.screen,
        params: route.params,
        page_or_slide_index: index,
        user_id: meta.user_id,
    };
    writeJson(PANEL_STORAGE_KEYS.resume, record);
}

function cancelPendingSeek(): void {
    if (pendingSeek) pendingSeek.cancel();
}

function restorePosition(index: number): void {
    let tries = 0;
    let retryTimer = 0;
    let giveUpTimer = 0;
    const startedOn = window.location.hash;
    const finish = () => {
        pendingSeek = null;
        offTarget();
        offRoute();
        window.clearTimeout(retryTimer);
        window.clearTimeout(giveUpTimer);
        window.removeEventListener('keydown', finish);
        window.removeEventListener('pointerdown', finish);
    };
    const attempt = () => {
        const info = getRemoteTargetInfo();
        if (!info.hasTarget || !info.state) return;
        if (info.state.index === index) {
            finish();
            return;
        }
        tries += 1;
        if (!seekRemoteTarget(index) || tries >= SEEK_MAX_TRIES) {
            finish();
            return;
        }
        window.clearTimeout(retryTimer);
        retryTimer = window.setTimeout(attempt, SEEK_RETRY_MS);
    };
    const offTarget = subscribeRemoteTarget(attempt);
    // Any move to another screen or slide means the teacher has gone somewhere else.
    const offRoute = subscribeRoute(() => {
        if (window.location.hash !== startedOn) finish();
    });
    pendingSeek = { index, cancel: finish };
    giveUpTimer = window.setTimeout(finish, SEEK_GIVE_UP_MS);
    window.addEventListener('keydown', finish);
    window.addEventListener('pointerdown', finish);
    attempt();
}

/**
 * Runs before the first render. A live session goes back to its deck screen, where the
 * existing Resume and End banner takes over.
 */
export function applyBootResume(): void {
    const record = readResumeRecord();
    if (!record) return;
    const meta = readSessionMeta();
    const sessionLooksValid =
        !!meta && !!getRefreshToken() && !!readActiveDevice() && !offlineUseExpired();
    if (!sessionLooksValid || meta.user_id !== record.user_id) {
        clearResumeRecord();
        return;
    }
    if (getCurrentRoute().screen !== 'home') return;
    const live = record.screen === 'volt' && record.params.view === 'live';
    const params: Record<string, string> =
        live && record.params.id ? { view: 'deck', id: record.params.id } : record.params;
    navigate(record.screen, params, { replace: true });
    if (!live && record.page_or_slide_index > 0) restorePosition(record.page_or_slide_index);
}

export function startResumeTracking(): void {
    subscribeRoute(writeCurrentPosition);
    subscribeRemoteTarget(writeCurrentPosition);
}
