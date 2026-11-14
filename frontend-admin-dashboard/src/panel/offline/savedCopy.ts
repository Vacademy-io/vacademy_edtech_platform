/**
 * What the "Offline: showing a saved copy" chip reads. A note belongs to the screen it
 * was made on, so it shows only there. No cache code here: PanelApp's chip reads it.
 */
import { useEffect, useState } from 'react';
import { isBackendReachable, subscribeReachability } from '../device/publicApi';
import { getCurrentRoute, subscribeRoute, type PanelScreen } from '../router';

const notes = new Map<string, PanelScreen>();
const listeners = new Set<() => void>();
let openFiles = 0;

function notify(): void {
    listeners.forEach((listener) => listener());
}

export function noteSavedCopy(key: string): void {
    if (notes.get(key) === getCurrentRoute().screen) return;
    notes.set(key, getCurrentRoute().screen);
    notify();
}

export function noteFreshCopy(key: string): void {
    if (notes.delete(key)) notify();
}

export function isShowingSaved(key: string): boolean {
    return notes.has(key);
}

/** A file opened from its saved copy. Returns the matching close. */
export function noteOpenSavedFile(): () => void {
    openFiles += 1;
    notify();
    return () => {
        openFiles -= 1;
        notify();
    };
}

export function clearSavedNotes(): void {
    if (notes.size === 0) return;
    notes.clear();
    notify();
}

function showingSavedHere(): boolean {
    if (!isBackendReachable() && openFiles > 0) return true;
    const screen = getCurrentRoute().screen;
    let found = false;
    notes.forEach((noted) => {
        if (noted === screen) found = true;
    });
    return found;
}

let wasReachable = isBackendReachable();
subscribeReachability(() => {
    const reachable = isBackendReachable();
    // Back online: what is on screen is no longer offline, and the lists refetch on their own.
    if (reachable && !wasReachable) clearSavedNotes();
    wasReachable = reachable;
    notify();
});

export function useShowingSavedCopy(): boolean {
    const [showing, setShowing] = useState(showingSavedHere);
    useEffect(() => {
        const update = () => setShowing(showingSavedHere());
        update();
        listeners.add(update);
        const offRoute = subscribeRoute(update);
        return () => {
            listeners.delete(update);
            offRoute();
        };
    }, []);
    return showing;
}
