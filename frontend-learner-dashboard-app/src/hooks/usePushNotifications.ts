import { useEffect, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { PushNotificationSchema } from '@capacitor/push-notifications';
import { pushNotificationService } from '@/services/push-notifications/push-notification-service';
import { usePushNotificationStore } from '@/stores/push-notification-store';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { UNREAD_COUNT_KEY } from '@/services/chat/chatApi';

export const usePushNotifications = () => {
  const queryClient = useQueryClient();
  const {
    settings,
    isPermissionGranted,
    token,
    notifications,
    unreadCount,
    setSettings,
    setPermissionGranted,
    setToken,
    addNotification,
    markAsRead,
    markAllAsRead,
    removeNotification,
    clearAllNotifications,
    initialize
  } = usePushNotificationStore();

  // Initialize push notifications
  const initializePushNotifications = useCallback(async () => {
    try {
      await initialize();
      await pushNotificationService.initialize();
      
      // Check current permissions
      const permissions = await pushNotificationService.checkPermissions();
      setPermissionGranted(permissions.receive === 'granted');
      
      // Get stored token or generate new one for web
      let storedToken = await pushNotificationService.getStoredToken();

      // For web platform, try to get FCM token if no stored token **and** permission granted
      if (!storedToken && Capacitor.getPlatform() === 'web' && permissions.receive === 'granted') {
        const { getFirebaseToken } = await import('@/services/firebase-config');
        const fcmToken = await getFirebaseToken();
        if (fcmToken) {
          storedToken = fcmToken;
          // Token will be saved by the service initialization
        }
      }
      
      if (storedToken) {
        setToken(storedToken);
      }
    } catch (error) {
      console.error('Error initializing push notifications:', error);
      
    }
  }, [initialize, setPermissionGranted, setToken]);

  // Request notification permissions
  const requestPermissions = useCallback(async () => {
    try {
      const permissions = await pushNotificationService.requestPermissions();
      const granted = permissions.receive === 'granted';
      setPermissionGranted(granted);
      
      if (granted) {
        toast.success('Notifications enabled!');
        await pushNotificationService.initialize();
      } else {
        toast.error('Notification permissions denied');
      }
      
      return granted;
    } catch (error) {
      console.error('Error requesting notification permissions:', error);
      toast.error('Failed to request notification permissions');
      return false;
    }
  }, [setPermissionGranted]);

  // Send a local notification (for testing)
  const sendLocalNotification = useCallback(async (payload: { title: string; body: string; data?: Record<string, unknown> }) => {
    try {
      await pushNotificationService.sendLocalNotification({
        title: payload.title,
        body: payload.body,
        data: payload.data,
        imageUrl: '/icon-192.webp'
      });
    } catch (error) {
      console.error('Error sending local notification:', error);
    }
  }, []);

  // Handle incoming notifications
  const handleNotification = useCallback((notification: PushNotificationSchema) => {
    // Add to store
    addNotification(notification);

    // A chat push means a new unread message — refresh the sidebar badge now instead of on its next poll.
    if (notification.data?.type === 'chat') {
      void queryClient.invalidateQueries({ queryKey: UNREAD_COUNT_KEY });
    }

    // iOS already shows the system banner for a foreground push (presentationOptions: alert), so a chat
    // toast would show the same message twice. Other pushes keep the toast: its "View" is their only in-app
    // deep link (data.path) on iOS.
    if (Capacitor.getPlatform() === 'ios' && notification.data?.type === 'chat') {
      return;
    }

    // Show toast (regardless of focus so it's visible during testing/background)
    toast.info(notification.title || 'New notification', {
      description: notification.body,
      action: {
        label: 'View',
        onClick: () => {
          markAsRead(notification.id);
          // Navigate to path from notification data if available
          // Chat pushes carry a conversationId instead of a path.
          const conversationId = notification.data?.conversationId;
          const path =
            notification.data?.type === 'chat' && conversationId
              ? `/chat?conversationId=${encodeURIComponent(String(conversationId))}`
              : notification.data?.path;
          if (path && typeof path === 'string') {
            window.location.href = path;
          }
        }
      }
    });
  }, [addNotification, markAsRead, queryClient]);

  // Setup notification listeners for all platforms, including web
  useEffect(() => {
    pushNotificationService.addListener(handleNotification);
    
    return () => {
      pushNotificationService.removeListener(handleNotification);
    };
  }, [handleNotification]);

  // Handle Electron notification clicks
  useEffect(() => {
    if (window.electronAPI) {
      const handleElectronNotificationClick = (data: { actionUrl?: string }) => {
        if (data.actionUrl) {
          // Navigate to the action URL
          window.location.href = data.actionUrl;
        }
      };

      window.electronAPI.onNotification(handleElectronNotificationClick);
    }
  }, []);

  // Auto-initialize on mount
  useEffect(() => {
    initializePushNotifications();
  }, [initializePushNotifications]);

  // Update notification settings
  const updateSettings = useCallback(async (newSettings: Partial<typeof settings>) => {
    setSettings(newSettings);
    
    // Optionally sync with backend
    try {
      // await syncSettingsWithBackend(newSettings);
      toast.success('Notification settings updated');
    } catch (error) {
      console.error('Error updating notification settings:', error);
      toast.error('Failed to update settings');
    }
  }, [setSettings]);

  // Get notification status as string
  const getNotificationStatus = useCallback(() => {
    if (!isPermissionGranted) {
      return 'denied';
    }
    if (!settings.enabled) {
      return 'disabled';
    }
    return 'enabled';
  }, [isPermissionGranted, settings.enabled]);

  return {
    // State
    settings,
    isPermissionGranted,
    token,
    notifications,
    unreadCount,
    
    // Actions
    requestPermissions,
    sendLocalNotification,
    updateSettings,
    markAsRead,
    markAllAsRead,
    removeNotification,
    clearAllNotifications,
    
    // Utilities
    getNotificationStatus,
    initializePushNotifications
  };
}; 