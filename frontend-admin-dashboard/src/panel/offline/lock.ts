/**
 * How long a signed-in panel may keep using saved copies with no answer from the
 * server: under an hour since the last refresh and inside the session's own limit.
 *
 * The timer is monotonic, and it does not run while the device sleeps or after a
 * restart. So the wall-clock gap since the last refresh also counts, unless the clock has
 * gone backwards (a panel with no RTC battery comes back in the past). A power cut still
 * resumes, and a panel left off or asleep overnight on a working clock locks.
 */
import { msSinceLastRefresh, msUntilSessionCap } from '../lib/api';
import { readSessionMeta } from '../device/store';
import { getPanelPolicy } from '../device/syncLoop';

export const OFFLINE_USE_MS = 60 * 60 * 1000;

export function offlineUseExpired(now: number = Date.now()): boolean {
    const refreshedThisBoot = msSinceLastRefresh();
    const sinceRefresh = refreshedThisBoot ?? performance.now();
    if (sinceRefresh >= OFFLINE_USE_MS) return true;
    const cap = msUntilSessionCap();
    if (cap !== null && cap <= 0) return true;
    const meta = readSessionMeta();
    if (!meta) return refreshedThisBoot === null;
    // A negative gap is a clock gone backwards, which never locks.
    const wallGap = now - meta.last_refresh_wall_ms;
    if (wallGap >= OFFLINE_USE_MS) return true;
    if (refreshedThisBoot === null) {
        // Within a boot the session cap is the monotonic one above.
        const sessionMs = getPanelPolicy().session_hours * 60 * 60 * 1000;
        if (now >= meta.started_at_ms && now - meta.started_at_ms >= sessionMs) return true;
    }
    return false;
}
