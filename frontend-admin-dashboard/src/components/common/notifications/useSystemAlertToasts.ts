import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import type { SystemAlertItem } from '@/services/notifications/system-alerts';

/** Alerts newer than this on first load are not toasted: they are history, not news. */
const SEEN_ON_FIRST_LOAD = true;
const DESCRIPTION_LIMIT = 160;

const plainText = (html: string | undefined) =>
    (html ?? '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

/**
 * Toast every system alert that arrives while the admin is on any page.
 *
 * The bell list is polled by the navbar; a background job finishing (a bulk
 * AI check, a failed email) lands there as a SYSTEM_ALERT, and this is what
 * makes it appear on screen without the admin opening the bell. Alerts
 * present on the first load are treated as already seen.
 */
export function useSystemAlertToasts(alerts: SystemAlertItem[] | undefined) {
    const seen = useRef<Set<string> | null>(null);

    useEffect(() => {
        if (!alerts) return;
        if (seen.current === null) {
            seen.current = new Set(SEEN_ON_FIRST_LOAD ? alerts.map((a) => a.messageId) : []);
            return;
        }
        for (const alert of alerts) {
            if (seen.current.has(alert.messageId)) continue;
            seen.current.add(alert.messageId);
            if (alert.isRead || alert.isDismissed) continue;
            const description = plainText(alert.content?.content);
            toast(alert.title, {
                description:
                    description.length > DESCRIPTION_LIMIT
                        ? `${description.slice(0, DESCRIPTION_LIMIT)}…`
                        : description || undefined,
                duration: 8000,
            });
        }
    }, [alerts]);
}
