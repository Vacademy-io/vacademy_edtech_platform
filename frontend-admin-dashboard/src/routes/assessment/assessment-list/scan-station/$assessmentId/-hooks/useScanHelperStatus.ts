import { useEffect, useState } from 'react';
import { scanHelper, type HelperStatus } from '../-lib/scan-helper-client';

export const HELPER_STATUS_POLL_MS = 3000;

const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';

/**
 * Ask the scan helper for its status every 3 s while the page is visible, and
 * not at all while it is hidden (the first visible moment asks at once).
 * `undefined` until the first answer; `null` when nothing answered.
 */
export const useScanHelperStatus = (
    enabled: boolean,
    intervalMs = HELPER_STATUS_POLL_MS
): HelperStatus | null | undefined => {
    const [status, setStatus] = useState<HelperStatus | null | undefined>(undefined);

    useEffect(() => {
        if (!enabled) return undefined;
        let stopped = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let inFlight: AbortController | null = null;

        const schedule = () => {
            if (stopped || !visible()) return;
            timer = setTimeout(tick, intervalMs);
        };
        const tick = () => {
            timer = undefined;
            if (stopped || !visible() || inFlight) return;
            const controller = new AbortController();
            inFlight = controller;
            scanHelper
                .status(controller.signal)
                .then((s) => {
                    if (!stopped && inFlight === controller) setStatus(s);
                })
                .catch(() => {
                    if (!stopped && inFlight === controller) setStatus(null);
                })
                .finally(() => {
                    if (inFlight === controller) inFlight = null;
                    schedule();
                });
        };
        const onVisibility = () => {
            if (timer) clearTimeout(timer);
            timer = undefined;
            if (visible()) tick();
        };

        tick();
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            stopped = true;
            if (timer) clearTimeout(timer);
            inFlight?.abort();
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [enabled, intervalMs]);

    return status;
};
