/**
 * Small facts about a shop that its pages learn from the server and remember on this device, so
 * the next page can hold the right room from its first paint: "this shop's carts show a
 * free-delivery bar", "this shop's listings have filters". Per shop (institute and site tag), in
 * localStorage; blocked storage reads as unknown.
 */
import { useEffect, useState } from 'react';
import { useCommerceSite } from './site';

export const shopFlagKey = (name: string, instituteId: string, tagName: string): string =>
    `commerce-${name}:${instituteId}:${(tagName || '').toLowerCase()}`;

/**
 * The flag as this device last saw it (true, false, or null when never seen), read once at
 * mount; `seen` (when defined) is written back for next time.
 */
export const useShopFlag = (name: string, seen: boolean | undefined): boolean | null => {
    const { instituteId, tagName } = useCommerceSite();
    const key = shopFlagKey(name, instituteId, tagName);
    const [known] = useState<boolean | null>(() => {
        try {
            const value = window.localStorage.getItem(key);
            return value === '1' ? true : value === '0' ? false : null;
        } catch {
            return null;
        }
    });
    useEffect(() => {
        if (seen === undefined) return;
        try {
            window.localStorage.setItem(key, seen ? '1' : '0');
        } catch {
            // Private mode or full storage: the next page starts from "unknown" again.
        }
    }, [key, seen]);
    return known;
};
