import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { Capacitor } from '@capacitor/core';
import { Bell, X, CaretDown, CaretUp, SpinnerGap, Trash } from "@phosphor-icons/react";
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useSystemAlerts } from '@/hooks/useSystemAlerts';

import { formatLocalDateTime } from '@/helpers/formatISOTime';
import type { UserMessage } from '@/types/announcement';
import { announcementApi } from '@/services/announcementApi';

interface SystemAlertsBarProps {
  className?: string;
}

export const SystemAlertsBar: React.FC<SystemAlertsBarProps> = ({ className = '' }) => {
  const { t } = useTranslation('courseComponentsExtra');
  const {
    alerts,
    unreadCount,
    loading,
    error,
    hasMore,
    isEnabled,
    isLoadingSettings,
    markAsRead,
    dismiss,
    dismissAll,
    loadMore,
    refresh,
    handleAlertVisibility,
  } = useSystemAlerts({
    enablePolling: true,
    pollingInterval: 15000,
    autoMarkAsRead: true,
    markAsReadDelay: 1000,
  });

  const isAndroid = Capacitor.getPlatform() === 'android';
  const isIOS = Capacitor.getPlatform() === 'ios';

  const [isOpen, setIsOpen] = useState(false);
  const [selectedAlert, setSelectedAlert] = useState<UserMessage | null>(null);
  const [showFullContent, setShowFullContent] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const alertRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Intersection observer for auto mark-as-read
  useEffect(() => {
    if (!observerRef.current) {
      observerRef.current = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            const messageId = entry.target.getAttribute('data-message-id');
            if (messageId) {
              handleAlertVisibility(messageId, entry.isIntersecting);
            }
          });
        },
        { threshold: 0.5, rootMargin: '50px' }
      );
    }

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [handleAlertVisibility]);

  // Observe alert elements
  useEffect(() => {
    alertRefs.current.forEach((element) => {
      if (observerRef.current) {
        observerRef.current.observe(element);
      }
    });
  }, [alerts]);

  const handleAlertClick = (alert: UserMessage) => {
    setIsOpen(false); // Close dropdown first
    setSelectedAlert(alert);
    setShowFullContent(true);
    markAsRead(alert.messageId);
    // Track click interaction
    announcementApi.recordInteraction(alert.messageId, 'CLICKED', { source: 'SystemAlertsBar' }).catch(() => undefined);
  };

  const handleDismiss = async (messageId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    await dismiss(messageId);
  };

  const handleLoadMore = () => {
    loadMore();
  };

  const handleRefresh = () => {
    refresh();
  };

  const getPriorityColor = (priority?: string) => {
    switch (priority) {
      case 'HIGH':
        return 'bg-red-500';
      case 'MEDIUM':
        return 'bg-yellow-500';
      case 'LOW':
        return 'bg-blue-500';
      default:
        return 'bg-gray-500';
    }
  };

  const getPriorityText = (priority?: string) => {
    switch (priority) {
      case 'HIGH':
        return t('systemAlertsBar.priority.high');
      case 'MEDIUM':
        return t('systemAlertsBar.priority.medium');
      case 'LOW':
        return t('systemAlertsBar.priority.low');
      default:
        return t('systemAlertsBar.priority.normal');
    }
  };

  const renderAlertContent = (alert: UserMessage) => {
    if (alert.content.type === 'html') {
      return (
        <div
          className="prose prose-sm max-w-none overflow-hidden break-words [&>*]:max-w-full [&_img]:max-w-full [&_img]:h-auto [&_table]:overflow-x-auto [&_table]:block [&_pre]:overflow-x-auto [&_pre]:max-w-full [&_meta]:hidden [&_style]:hidden [&_title]:hidden [&_head]:hidden [&_script]:hidden"
          dangerouslySetInnerHTML={{ __html: alert.content.content }}
        />
      );
    }

    return <p className="text-sm text-gray-700 break-words">{alert.content.content}</p>;
  };

  const renderAlertCard = (alert: UserMessage) => (
    <Card
      key={alert.messageId}
      className={`mb-3 cursor-pointer transition-all hover:shadow-md ${!alert.isRead ? 'border-s-4 border-s-blue-500 bg-blue-50' : ''
        }`}
      ref={(el) => {
        if (el) {
          alertRefs.current.set(alert.messageId, el);
        }
      }}
      data-message-id={alert.messageId}
      onClick={() => handleAlertClick(alert)}
    >
      <CardContent className="p-3 sm:p-card">
        <div className="flex items-start justify-between gap-1">
          <div className="flex-1 min-w-0 overflow-hidden">
            <div className="flex items-center gap-1.5 sm:gap-2 mb-1.5 sm:mb-2 flex-wrap">
              {alert.title && (
                <h4 className="font-medium text-gray-900 truncate max-w-full text-sm">{alert.title}</h4>
              )}
              {alert.priority && (
                <Badge
                  variant="secondary"
                  className={`text-xs ${getPriorityColor(alert.priority)} text-white flex-shrink-0`}
                >
                  {getPriorityText(alert.priority)}
                </Badge>
              )}
              {!alert.isRead && (
                <div className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0" />
              )}
            </div>

            <div className="text-sm text-gray-600 mb-2 overflow-hidden max-w-full">
              {renderAlertContent(alert)}
            </div>

            <div className="flex items-center justify-between text-xs text-gray-500 flex-wrap gap-2">
              <span className="truncate">
                {alert.createdByName && t('systemAlertsBar.byAuthor', { name: alert.createdByName })}
                {alert.createdByName && alert.createdAt && ' • '}
                {alert.createdAt && formatLocalDateTime(alert.createdAt)}
              </span>
            </div>
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="ms-1 h-6 w-6 p-0 hover:bg-gray-100 flex-shrink-0"
            onClick={(e) => handleDismiss(alert.messageId, e)}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  // Don't render if not enabled or still loading settings
  if (isLoadingSettings || !isEnabled) {
    return null;
  }

  return (
    <>
    <div className={className}>
      <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="relative">
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && (
              <Badge
                variant="destructive"
                className="absolute -top-1 -end-1 h-5 w-5 rounded-full p-0 flex items-center justify-center text-xs"
              >
                {unreadCount > 99 ? '99+' : unreadCount}
              </Badge>
            )}
            {isOpen ? <CaretUp className="ms-1 h-4 w-4" /> : <CaretDown className="ms-1 h-4 w-4" />}
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="end"
          className="w-calc-vw-1 sm:w-chat-panel md:w-96 max-h-screen-80 sm:max-h-96 p-0 z-50"
          sideOffset={8}
        >
          <div className="p-3 sm:p-4 border-b border-gray-200">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-medium text-gray-900 text-sm sm:text-base">{t('systemAlertsBar.title')}</h3>
              <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
                {alerts.length > 0 && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-600 hover:text-red-700 hover:bg-red-50 text-xs sm:text-sm px-2 sm:px-3"
                        disabled={loading}
                      >
                        <Trash className="h-4 w-4 me-1" />
                        {t('common.clearAll')}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="z-50">
                      <AlertDialogHeader>
                        <AlertDialogTitle>{t('systemAlertsBar.clearAllTitle')}</AlertDialogTitle>
                        <AlertDialogDescription>
                          {t('systemAlertsBar.clearAllDescription', { count: alerts.length })}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={dismissAll}
                          className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
                        >
                          {t('common.clearAll')}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRefresh}
                  disabled={loading}
                >
                  {loading ? <SpinnerGap className="h-4 w-4 animate-spin" /> : t('common.refresh')}
                </Button>
              </div>
            </div>
          </div>

          <ScrollArea className="h-screen-60 sm:h-80">
            <div className="p-3 sm:p-4">
              {error && (
                <div className="text-sm text-red-600 mb-4 p-3 bg-red-50 rounded-md">
                  {error}
                </div>
              )}

              {loading && alerts.length === 0 ? (
                <div className="flex items-center justify-center py-8">
                  <SpinnerGap className="h-6 w-6 animate-spin text-gray-400" />
                  <span className="ms-2 text-sm text-gray-500">{t('systemAlertsBar.loadingAlerts')}</span>
                </div>
              ) : alerts.length === 0 ? (
                <div className="text-center py-8 space-y-2">
                  <Bell className="h-8 w-8 text-gray-400 mx-auto" />
                  <p className="text-sm text-gray-500">{t('systemAlertsBar.noAlerts')}</p>
                </div>
              ) : (
                <>
                  {alerts.map(renderAlertCard)}

                  {hasMore && (
                    <div className="text-center pt-4">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleLoadMore}
                        disabled={loading}
                      >
                        {loading ? (
                          <>
                            <SpinnerGap className="h-4 w-4 animate-spin me-2" />
                            {t('common.loading')}
                          </>
                        ) : (
                          t('common.loadMore')
                        )}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          </ScrollArea>
        </DropdownMenuContent>
      </DropdownMenu>

    </div>

    {/* Full Content Modal — portaled to body so it's never clipped by navbar stacking context */}
    {selectedAlert && showFullContent && createPortal(
      <div
        className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
        onClick={() => setShowFullContent(false)}
      >
        <Card
          className="w-full max-w-vw-95 sm:max-w-2xl max-h-screen-90  overflow-hidden flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <CardContent className="p-1 sm:p-8 flex flex-col overflow-hidden gap-4">
            <div className="flex items-start justify-between flex-shrink-0">
              <div className="flex-1 min-w-0 me-2">
                {selectedAlert.title && (
                  <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-2 break-words">
                    {selectedAlert.title}
                  </h2>
                )}
                <div className="flex items-center gap-2 text-xs sm:text-sm text-gray-500 flex-wrap">
                  {selectedAlert.priority && (
                    <Badge variant="secondary" className={getPriorityColor(selectedAlert.priority)}>
                      {getPriorityText(selectedAlert.priority)}
                    </Badge>
                  )}
                  {selectedAlert.createdByName && (
                    <span className="truncate">
                      {t('systemAlertsBar.byAuthor', { name: selectedAlert.createdByName })}
                    </span>
                  )}
                  {selectedAlert.createdAt && (
                    <span className="truncate">{formatLocalDateTime(selectedAlert.createdAt)}</span>
                  )}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowFullContent(false)}
                className="flex-shrink-0"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <Separator className="flex-shrink-0" />

            <div className="overflow-y-auto flex-1 min-h-0">
              <div className="prose prose-sm max-w-none">
                {renderAlertContent(selectedAlert)}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>,
      document.body
    )}
    </>
  );
};
