import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PushPin, Clock, User, X, SpinnerGap, WarningCircle, Trash } from "@phosphor-icons/react";
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import { useDashboardPins } from '@/hooks/useDashboardPins';
import { usePlayTheme } from '@/hooks/use-play-theme';
import { useCleanerPlayTheme } from '@/hooks/use-cleaner-play-theme';
import iconAnnouncement from '@/assets/cleaner-play/icon-announcement.webp';
import { formatLocalDateTime } from '@/helpers/formatISOTime';
import { cn, sanitizeHtml } from '@/lib/utils';
import type { UserMessage } from '@/types/announcement';
import { announcementApi } from '@/services/announcementApi';

interface DashboardPinsPanelProps {
  className?: string;
  maxPins?: number;
}

export const DashboardPinsPanel: React.FC<DashboardPinsPanelProps> = ({ 
  className = '',
  maxPins = 3
}) => {
  const { t } = useTranslation('courseComponentsExtra');
  const {
    pins,
    loading,
    error,
    isEnabled,
    isLoadingSettings,
    markAsRead,
    dismiss,
    dismissAll,
    refresh,
  } = useDashboardPins({
    enablePolling: true,
    pollingInterval: 15000,
    autoMarkAsRead: true,
  });

  const [selectedPin, setSelectedPin] = useState<UserMessage | null>(null);
  const [showFullContent, setShowFullContent] = useState(false);
  const isPlay = usePlayTheme();
  const isCleanerPlay = useCleanerPlayTheme();

  const handlePinClick = (pin: UserMessage) => {
    setSelectedPin(pin);
    setShowFullContent(true);
    markAsRead(pin.messageId);
    // Track click interaction
    announcementApi.recordInteraction(pin.messageId, 'CLICKED', { source: 'DashboardPinsPanel' }).catch(() => undefined);
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
        return t('dashboardPinsPanel.priority.high');
      case 'MEDIUM':
        return t('dashboardPinsPanel.priority.medium');
      case 'LOW':
        return t('dashboardPinsPanel.priority.low');
      default:
        return t('dashboardPinsPanel.priority.normal');
    }
  };

  const renderPinContent = (pin: UserMessage) => {
    if (pin.content.type === 'html') {
      return (
        <div 
          className="prose prose-sm max-w-none"
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(pin.content.content) }}
        />
      );
    }
    
    return <p className="text-sm text-gray-700">{pin.content.content}</p>;
  };

  const handleDismissPin = async (messageId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await dismiss(messageId);
  };

  const getTimeRemaining = (endTime?: string) => {
    if (!endTime) return null;
    
    const now = new Date();
    const end = new Date(endTime);
    const diff = end.getTime() - now.getTime();
    
    if (diff <= 0) return null;
    
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    
    if (days > 0) {
      return t('dashboardPinsPanel.timeRemaining.days', { count: days });
    } else if (hours > 0) {
      return t('dashboardPinsPanel.timeRemaining.hours', { count: hours });
    } else {
      return t('dashboardPinsPanel.timeRemaining.lessThanHour');
    }
  };

  // Don't render if not enabled or still loading settings
  if (isLoadingSettings || !isEnabled) {
    return null;
  }

  // Don't render if no pins
  if (pins.length === 0) {
    return null;
  }

  const displayPins = pins.slice(0, maxPins);

  return (
    <div className={className}>
      <Card
        className={cn(
          // Cleaner Play: shared cp-card shell (rule scoped to .ui-cleaner-play)
          'cp-card',
          // Play: pastel gold announcement surface, quiet chrome
          '[.ui-play_&]:bg-play-gold-soft [.ui-play_&]:rounded-play-card-sm',
          '[.ui-play_&]:border-border [.ui-play_&]:shadow-play-soft-card'
        )}
      >
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle
              className={cn(
                'flex items-center gap-2 text-lg',
                'cp-heading',
                '[.ui-play_&]:font-black [.ui-play_&]:text-play-gold-soft-ink'
              )}
            >
              {isPlay || isCleanerPlay ? (
                <img
                  src={iconAnnouncement}
                  alt=""
                  aria-hidden="true"
                  className="h-9 w-9 object-contain"
                />
              ) : (
                <PushPin className="h-5 w-5 text-blue-600" />
              )}
              {t('dashboardPinsPanel.importantUpdates')}
            </CardTitle>
            <div className="flex items-center gap-2">
              {pins.length > 0 && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      disabled={loading}
                    >
                      <Trash className="h-4 w-4 me-1" />
                      {t('common.clearAll')}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t('dashboardPinsPanel.clearAllTitle')}</AlertDialogTitle>
                      <AlertDialogDescription>
                        {t('dashboardPinsPanel.clearAllDescription', { count: pins.length })}
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
                onClick={refresh}
                disabled={loading}
              >
                {loading ? <SpinnerGap className="h-4 w-4 animate-spin" /> : t('common.refresh')}
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-0">
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 mb-4 p-3 bg-red-50 rounded-md">
              <WarningCircle className="h-4 w-4" />
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <SpinnerGap className="h-6 w-6 animate-spin text-gray-400" />
              <span className="ms-2 text-sm text-gray-500">{t('dashboardPinsPanel.loadingPins')}</span>
            </div>
          ) : (
            <div className="space-y-4">
              {displayPins.map((pin) => (
                <div
                  key={pin.messageId}
                  className={`p-4 rounded-lg border cursor-pointer transition-all hover:shadow-md ${
                    !pin.isRead ? 'border-s-4 border-s-blue-500 bg-blue-50' : 'border-gray-200'
                  }`}
                  onClick={() => handlePinClick(pin)}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {pin.title && (
                        <h4 className="font-medium text-gray-900">{pin.title}</h4>
                      )}
                      {pin.priority && (
                        <Badge 
                          variant="secondary" 
                          className={`text-xs ${getPriorityColor(pin.priority)} text-white`}
                        >
                          {getPriorityText(pin.priority)}
                        </Badge>
                      )}
                      {!pin.isRead && (
                        <div className="w-2 h-2 bg-blue-500 rounded-full" />
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ms-2 h-6 w-6 p-0 hover:bg-gray-100"
                      onClick={(e) => handleDismissPin(pin.messageId, e)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                  
                  <div className="text-sm text-gray-600 mb-3 line-clamp-2">
                    {renderPinContent(pin)}
                  </div>
                  
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <div className="flex items-center gap-4">
                      {pin.createdByName && (
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {pin.createdByName}
                        </span>
                      )}
                      {pin.createdAt && (
                        <span>{formatLocalDateTime(pin.createdAt)}</span>
                      )}
                    </div>
                    
                    {pin.pinEndTime && (
                      <span className="flex items-center gap-1 text-orange-600">
                        <Clock className="h-3 w-3" />
                        {getTimeRemaining(pin.pinEndTime)}
                      </span>
                    )}
                  </div>
                </div>
              ))}
              
              {pins.length > maxPins && (
                <div className="text-center pt-2">
                  <Button variant="outline" size="sm">
                    {t('dashboardPinsPanel.viewAll', { count: pins.length })}
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      
      {/* Full Content Modal */}
      {selectedPin && showFullContent && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-2xl max-h-screen-80 overflow-hidden">
            <CardContent className="p-card-lg">
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  {selectedPin.title && (
                    <h2 className="text-lg font-semibold text-gray-900 mb-2">
                      {selectedPin.title}
                    </h2>
                  )}
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    {selectedPin.priority && (
                      <Badge variant="secondary" className={getPriorityColor(selectedPin.priority)}>
                        {getPriorityText(selectedPin.priority)}
                      </Badge>
                    )}
                    {selectedPin.createdByName && (
                      <span>{t('dashboardPinsPanel.byAuthor', { name: selectedPin.createdByName })}</span>
                    )}
                    {selectedPin.createdAt && (
                      <span>{formatLocalDateTime(selectedPin.createdAt)}</span>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowFullContent(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              
              <Separator className="mb-4" />
              
              <div className="prose prose-sm max-w-none">
                {renderPinContent(selectedPin)}
              </div>
              
              {selectedPin.pinEndTime && (
                <div className="mt-4 p-3 bg-orange-50 rounded-md">
                  <div className="flex items-center gap-2 text-sm text-orange-700">
                    <Clock className="h-4 w-4" />
                    <span>
                      {t('dashboardPinsPanel.pinExpires', {
                        time: getTimeRemaining(selectedPin.pinEndTime),
                      })}
                    </span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};
