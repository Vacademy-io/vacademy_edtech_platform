import { format } from 'date-fns';
import { parseApiDate } from '@/helpers/formatISOTime';
import type { UserMessage } from '@/types/announcement';

/** One row per unique title+content pair; `alert` is the most recent occurrence. */
export interface GroupedNotification {
  alert: UserMessage;
  count: number;
  isRead: boolean;
  /**
   * Every occurrence folded into this row, newest first. Dismissing a grouped
   * row has to clear all of them — clearing only `alert` leaves the remaining
   * duplicates behind and the row simply reappears with a smaller count.
   */
  messageIds: string[];
}

/** Single date format for notifications: "Jun 10, 4:14 PM" (year only when it differs). */
export const formatNotificationDate = (isoString?: string | null): string => {
  const date = parseApiDate(isoString);
  if (!date) return '';
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return format(date, sameYear ? 'MMM d, h:mm a' : 'MMM d, yyyy, h:mm a');
};

export const getCreatedAtMs = (alert: UserMessage): number =>
  parseApiDate(alert.createdAt)?.getTime() ?? 0;

/** Collapse identical notifications (same title + content) into one row with a count. */
export const groupNotifications = (alerts: UserMessage[]): GroupedNotification[] => {
  const groups = new Map<string, GroupedNotification>();

  for (const alert of alerts) {
    const key = `${alert.title ?? ''}::${alert.content?.content ?? ''}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        alert,
        count: 1,
        isRead: alert.isRead,
        messageIds: [alert.messageId],
      });
    } else {
      existing.count += 1;
      existing.isRead = existing.isRead && alert.isRead;
      existing.messageIds.push(alert.messageId);
      if (getCreatedAtMs(alert) > getCreatedAtMs(existing.alert)) {
        existing.alert = alert; // keep the latest occurrence (latest timestamp wins)
      }
    }
  }

  return [...groups.values()].sort(
    (a, b) => getCreatedAtMs(b.alert) - getCreatedAtMs(a.alert)
  );
};

/** localStorage key for the navbar bell's "seen up to" timestamp (epoch ms). */
export const NOTIFICATIONS_LAST_SEEN_KEY = 'vacademy.notifications.lastSeen';

/** Epoch ms of the last time the user opened the bell; 0 when never seen / unavailable. */
export const getNotificationsLastSeen = (): number => {
  try {
    const raw = localStorage.getItem(NOTIFICATIONS_LAST_SEEN_KEY);
    const value = raw ? Number(raw) : 0;
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
};

export const setNotificationsLastSeen = (timestampMs: number = Date.now()): void => {
  try {
    localStorage.setItem(NOTIFICATIONS_LAST_SEEN_KEY, String(timestampMs));
  } catch {
    // Storage unavailable (private mode / quota): the badge simply persists.
  }
};
