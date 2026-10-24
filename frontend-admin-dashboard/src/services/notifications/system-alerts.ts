import axios from 'axios';
import { BASE_URL } from '@/constants/urls';

export interface SystemAlertContentBody {
    id: string;
    type: 'html' | 'text' | string;
    content: string;
}

export interface SystemAlertItem {
    messageId: string;
    announcementId?: string | null;
    title: string;
    content: SystemAlertContentBody;
    createdBy?: string | null;
    createdByName?: string | null;
    createdByRole?: string | null;
    modeType?: string | null;
    status?: string | null;
    createdAt: string;
    deliveredAt?: string | null;
    isRead?: boolean;
    isDismissed?: boolean;
    interactionTime?: string | null;
    modeSettings?: unknown;
    repliesCount?: number | null;
    recentReplies?: unknown;
}

export interface PagedResponse<T> {
    content: T[];
    pageable: {
        pageNumber: number;
        pageSize: number;
        offset: number;
        paged: boolean;
        unpaged: boolean;
        sort?: unknown;
    };
    totalPages: number;
    totalElements: number;
    last: boolean;
    numberOfElements: number;
    first: boolean;
    size: number;
    number: number; // current page index
    sort?: unknown;
    empty: boolean;
    /**
     * Set only on the empty stand-in fetchSystemAlerts returns when the request failed, so
     * callers that must not read a failure as "no alerts" (the dashboard's Pending Actions)
     * can tell the two apart. Absent on real responses.
     */
    fetchFailed?: boolean;
}

export function getSystemAlertsUrl(userId: string): string {
    return `${BASE_URL}/notification-service/v1/user-messages/user/${userId}/system-alerts`;
}

export async function fetchSystemAlerts(params: {
    userId: string;
    page?: number;
    size?: number;
}): Promise<PagedResponse<SystemAlertItem>> {
    const { userId, page = 0, size = 20 } = params;
    try {
        const url = getSystemAlertsUrl(userId);
        const response = await axios.get(url, {
            params: {
                page,
                size,
            },
        });
        return response.data;
    } catch (error) {
        // Return empty response when notification service is down to prevent UI crashes
        console.warn('Failed to fetch system alerts, notification service may be down:', error);
        return {
            content: [],
            pageable: {
                pageNumber: page,
                pageSize: size,
                offset: page * size,
                paged: true,
                unpaged: false,
            },
            totalPages: 0,
            totalElements: 0,
            last: true,
            numberOfElements: 0,
            first: page === 0,
            size: size,
            number: page,
            empty: true,
            fetchFailed: true,
        };
    }
}

// Helpers to integrate with @tanstack/react-query
export function getSystemAlertsQuery(userId: string, size = 5) {
    return {
        queryKey: ['SYSTEM_ALERTS', userId, size] as const,
        queryFn: () => fetchSystemAlerts({ userId, page: 0, size }),
        staleTime: 60_000,
        retry: false, // Don't retry since we handle errors gracefully in fetchSystemAlerts
    };
}

export function getInfiniteSystemAlertsQuery(userId: string, pageSize = 20) {
    return {
        queryKey: ['SYSTEM_ALERTS_INFINITE', userId, pageSize] as const,
        queryFn: ({ pageParam = 0 }: { pageParam?: number }) =>
            fetchSystemAlerts({ userId, page: pageParam, size: pageSize }),
        getNextPageParam: (lastPage: PagedResponse<SystemAlertItem>) =>
            lastPage.last ? undefined : lastPage.number + 1,
        initialPageParam: 0,
        staleTime: 30_000,
        retry: false, // Don't retry since we handle errors gracefully in fetchSystemAlerts
    };
}

// Backend sends LocalDateTime without a timezone (e.g. "2026-04-26T04:18:27").
// The instant is UTC but JS would otherwise read it as local time. Append 'Z'
// when missing so Date parses it as UTC and toLocaleString() renders local time.
export function formatAlertTimestamp(value: string | null | undefined): string {
    if (!value) return '';
    const hasTimezone = /Z$|[+-]\d{2}:?\d{2}$/.test(value);
    const iso = hasTimezone ? value : `${value}Z`;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}

export function stripHtml(html: string): string {
    if (!html) return '';
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return (tmp.textContent || tmp.innerText || '').trim();
}

export async function markSystemAlertAsRead(
    recipientMessageId: string,
    userId: string
): Promise<void> {
    try {
        await axios.post(`${BASE_URL}/notification-service/v1/user-messages/interactions/read`, {
            recipientMessageId,
            userId,
            interactionType: 'READ',
        });
    } catch (error) {
        console.warn('Failed to mark system alert as read:', error);
    }
}

export async function markSystemAlertsAsRead(
    recipientMessageIds: string[],
    userId: string
): Promise<void> {
    if (!recipientMessageIds.length || !userId) return;
    await Promise.all(recipientMessageIds.map((id) => markSystemAlertAsRead(id, userId)));
}

// Dismiss a single alert. A DISMISSED interaction permanently hides the message
// from the user's system-alerts list (idempotent server-side).
export async function dismissSystemAlert(
    recipientMessageId: string,
    userId: string
): Promise<void> {
    await axios.post(`${BASE_URL}/notification-service/v1/user-messages/interactions/dismiss`, {
        recipientMessageId,
        userId,
        interactionType: 'DISMISSED',
    });
}

// Clear ALL of a user's system alerts. The backend has no bulk endpoint, so we
// page through every alert to collect ids, then dismiss each one. Best-effort:
// individual failures are tolerated. Returns the number successfully dismissed.
export async function dismissAllSystemAlerts(userId: string): Promise<number> {
    if (!userId) return 0;

    const ids: string[] = [];
    const pageSize = 100;
    const MAX_PAGES = 50; // safety cap (≤5000 alerts) to avoid a runaway loop
    for (let page = 0; page < MAX_PAGES; page += 1) {
        const res = await fetchSystemAlerts({ userId, page, size: pageSize });
        for (const item of res.content) {
            if (item.messageId) ids.push(item.messageId);
        }
        if (res.last || res.content.length === 0) break;
    }
    if (!ids.length) return 0;

    // Dismiss in small concurrent batches so we don't flood the service.
    let dismissed = 0;
    const concurrency = 10;
    for (let i = 0; i < ids.length; i += concurrency) {
        const chunk = ids.slice(i, i + concurrency);
        const results = await Promise.allSettled(
            chunk.map((id) => dismissSystemAlert(id, userId))
        );
        dismissed += results.filter((r) => r.status === 'fulfilled').length;
    }
    return dismissed;
}
