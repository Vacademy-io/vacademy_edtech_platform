import { useEffect, useRef } from 'react';
import { SSE_BASE, type ChatAnnouncementEvent, type ChatMessagePayload } from '@/services/chat/chatApi';
import { getChatUser } from '@/services/chat/getChatUser';

interface UseChatStreamArgs {
    /** Called with the message payload for a newly-received CHAT_MESSAGE event. */
    onMessage: (payload: ChatMessagePayload) => void;
    /**
     * Called for CHAT_MESSAGE_UPDATED — an EXISTING message changed in place (edited or deleted).
     * Separate from onMessage because an in-place change must not count as a new arrival: it has no
     * unread, and it must not overwrite the conversation-list preview with an older message.
     */
    onMessageUpdated?: (payload: ChatMessagePayload) => void;
    /** Called for CHAT_READ events (read-receipt sync). */
    onRead?: (payload: ChatMessagePayload) => void;
    /**
     * Called after the stream reconnects so the caller can refetch the open
     * conversation with sinceCursor and catch up on missed messages.
     */
    onReconnect?: () => void;
    /** When false, the stream is not opened (e.g. no user yet). */
    enabled?: boolean;
}

/**
 * Opens an EventSource to the notification-service SSE stream and surfaces
 * CHAT_MESSAGE / CHAT_READ events. Reconnects with capped exponential backoff;
 * fires onReconnect after a successful reconnect so the caller can resync.
 * The SSE path is whitelisted but we still pass the token as a query param.
 */
export function useChatStream({
    onMessage,
    onMessageUpdated,
    onRead,
    onReconnect,
    enabled = true,
}: UseChatStreamArgs): void {
    // Keep latest callbacks in refs so we don't tear down the stream on each render.
    const onMessageRef = useRef(onMessage);
    const onMessageUpdatedRef = useRef(onMessageUpdated);
    const onReadRef = useRef(onRead);
    const onReconnectRef = useRef(onReconnect);
    onMessageRef.current = onMessage;
    onMessageUpdatedRef.current = onMessageUpdated;
    onReadRef.current = onRead;
    onReconnectRef.current = onReconnect;

    useEffect(() => {
        if (!enabled) return;

        const { userId, instituteId, token } = getChatUser();
        if (!userId || !instituteId) return;

        let es: EventSource | null = null;
        let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
        let attempt = 0;
        let closed = false;
        let hadConnected = false;

        const parsePayload = (raw: string): ChatMessagePayload | null => {
            try {
                const evt = JSON.parse(raw) as ChatAnnouncementEvent;
                return evt?.data ?? null;
            } catch {
                return null;
            }
        };

        const handleMessage = (e: MessageEvent) => {
            const payload = parsePayload(e.data);
            if (payload) onMessageRef.current(payload);
        };

        const handleMessageUpdated = (e: MessageEvent) => {
            const payload = parsePayload(e.data);
            if (payload && onMessageUpdatedRef.current) onMessageUpdatedRef.current(payload);
        };

        const handleRead = (e: MessageEvent) => {
            const payload = parsePayload(e.data);
            if (payload && onReadRef.current) onReadRef.current(payload);
        };

        const connect = () => {
            if (closed) return;

            const url = `${SSE_BASE}/stream/${encodeURIComponent(userId)}?instituteId=${encodeURIComponent(
                instituteId
            )}&token=${encodeURIComponent(token)}`;

            es = new EventSource(url);

            es.addEventListener('open', () => {
                attempt = 0;
                if (hadConnected && onReconnectRef.current) {
                    onReconnectRef.current();
                }
                hadConnected = true;
            });

            es.addEventListener('CHAT_MESSAGE', handleMessage as EventListener);
            es.addEventListener('CHAT_MESSAGE_UPDATED', handleMessageUpdated as EventListener);
            es.addEventListener('CHAT_READ', handleRead as EventListener);
            // 'HEARTBEAT' and the initial 'connection' event are intentionally ignored.

            es.addEventListener('error', () => {
                // EventSource auto-reconnects, but to honor our own backoff + the
                // onReconnect resync contract we close and reconnect manually.
                es?.close();
                if (closed) return;
                attempt += 1;
                const delay = Math.min(1000 * 2 ** Math.min(attempt, 5), 30000);
                reconnectTimer = setTimeout(connect, delay);
            });
        };

        // Pause the stream while the tab is backgrounded so the server promptly marks the user offline
        // and routes new messages to an FCM push instead of a stream they can't see. Reconnect on
        // foreground; the reconnect handler catches up anything missed via sinceCursor.
        const handleVisibility = () => {
            if (typeof document === 'undefined') return;
            if (document.hidden) {
                if (reconnectTimer) {
                    clearTimeout(reconnectTimer);
                    reconnectTimer = null;
                }
                es?.close();
                es = null;
            } else if (!es) {
                attempt = 0;
                connect();
            }
        };
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', handleVisibility);
        }

        if (typeof document === 'undefined' || !document.hidden) {
            connect();
        }

        return () => {
            closed = true;
            if (typeof document !== 'undefined') {
                document.removeEventListener('visibilitychange', handleVisibility);
            }
            if (reconnectTimer) clearTimeout(reconnectTimer);
            es?.close();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled]);
}
