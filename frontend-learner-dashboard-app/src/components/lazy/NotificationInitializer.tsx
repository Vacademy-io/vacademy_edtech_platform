import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { usePushNotifications } from "@/hooks/usePushNotifications";

/**
 * Lazy-loaded notification initializer component.
 * This is loaded after initial render to avoid blocking the main bundle.
 */
export const NotificationInitializer = () => {
    const { t } = useTranslation("miscComponents");

    // Initialize push notifications when app starts
    usePushNotifications();

    // Listen for messages forwarded by the service worker
    useEffect(() => {
        if (typeof window === "undefined" || !("serviceWorker" in navigator))
            return;

        type SwForwardedMessage = {
            type?: string;
            payload?: {
                messageId?: string;
                notification?: { title?: string; body?: string };
                data?: Record<string, unknown>;
            };
        };

        const handleSwMessage = (event: MessageEvent<SwForwardedMessage>) => {
            const data = event.data as SwForwardedMessage;
            if (!data || data.type !== "FCM_BACKGROUND_MESSAGE") return;

            // Convert to app notification shape and dispatch to store
            import("@/services/push-notifications/push-notification-service").then(
                ({ pushNotificationService }) => {
                    const payload = data.payload || {};
                    const title =
                        payload?.notification?.title ||
                        payload?.data?.title ||
                        t("notificationInitializer.newNotification");
                    const body = payload?.notification?.body || payload?.data?.body || "";
                    const id = payload?.messageId || String(Date.now());
                    pushNotificationService.dispatch({
                        title,
                        body,
                        id,
                        data: payload?.data || {},
                    } as unknown as import("@capacitor/push-notifications").PushNotificationSchema);
                }
            );
        };

        navigator.serviceWorker.addEventListener("message", handleSwMessage);
        return () =>
            navigator.serviceWorker.removeEventListener("message", handleSwMessage);
    }, []);

    return null;
};

export default NotificationInitializer;
