/**
 * What boot.tsx starts. In the initial chunk, so it stays small and imports nothing
 * from the cache layer.
 */
import { subscribeDeviceEvents } from '../device/store';
import { registerAfterSignOut } from '../lib/session';
import { clearResumeRecord, startResumeTracking } from './resume';
import { finishInterruptedWipe, wipeOfflineData } from './wipe';

const INDEX_CHECK_DELAY_MS = 15 * 1000;

let started = false;

export function startOffline(): void {
    if (started) return;
    started = true;
    finishInterruptedWipe();
    subscribeDeviceEvents((event) => {
        if (event.type !== 'RESTORED') void wipeOfflineData();
    });
    // Lists and decks stay for the same teacher tomorrow; where the teacher was does not.
    registerAfterSignOut(clearResumeRecord);
    startResumeTracking();
    window.setTimeout(() => {
        void import('./cacheStore').then(({ reconcileIndex }) => reconcileIndex());
    }, INDEX_CHECK_DELAY_MS);
}
