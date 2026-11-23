import { useEffect, useState } from 'react';

/** The browser's own idea of the connection; unknown counts as online. */
export function readOnline(): boolean {
    try {
        return globalThis.navigator?.onLine !== false;
    } catch {
        return true;
    }
}

/**
 * `navigator.onLine` kept current by the window's `online` / `offline` events
 * (contract §7.2). It only knows "no network at all"; a request that times out
 * on a weak line is caught by the Pay dialog's retry instead.
 */
export function useOnline(): boolean {
    const [online, setOnline] = useState(readOnline);
    useEffect(() => {
        const up = () => setOnline(true);
        const down = () => setOnline(false);
        window.addEventListener('online', up);
        window.addEventListener('offline', down);
        setOnline(readOnline());
        return () => {
            window.removeEventListener('online', up);
            window.removeEventListener('offline', down);
        };
    }, []);
    return online;
}
