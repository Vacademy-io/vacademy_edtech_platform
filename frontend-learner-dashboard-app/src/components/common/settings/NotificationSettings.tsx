import React from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { Bell, BellSlash, SpeakerHigh, SpeakerSlash, Shield, DeviceMobile } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/types/naming-settings';

export const NotificationSettings: React.FC = () => {
  const { t } = useTranslation('layoutCommonB');
  const {
    settings,
    isPermissionGranted,
    unreadCount,
    requestPermissions,
    updateSettings,
    sendLocalNotification,
    getNotificationStatus
  } = usePushNotifications();

  const status = getNotificationStatus();
  const liveClasses = getTerminologyPlural(ContentTerms.LiveSession, SystemTerms.LiveSession);

  const handlePermissionToggle = async () => {
    if (!isPermissionGranted) {
      await requestPermissions();
    } else {
      toast.info(t('notificationSettings.toasts.disableViaDeviceSettings'));
    }
  };

  const handleTestNotification = async () => {
    await sendLocalNotification(
      t('notificationSettings.testNotification.title'),
      t('notificationSettings.testNotification.body'),
      { type: 'test' }
    );
  };

  return (
    <div className="space-y-6">
      {/* Status Overview */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              {isPermissionGranted ? (
                <Bell className="h-5 w-5 text-green-600" />
              ) : (
                <BellSlash className="h-5 w-5 text-gray-400" />
              )}
              <CardTitle>{t('notificationSettings.status.title')}</CardTitle>
            </div>
            {unreadCount > 0 && (
              <Badge variant="destructive">{t('notificationSettings.status.unreadBadge', { count: unreadCount })}</Badge>
            )}
          </div>
          <CardDescription>
            {t('notificationSettings.status.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <div className="font-medium">{t('notificationSettings.status.platform')}</div>
              <div className="text-sm text-muted-foreground flex items-center space-x-2">
                <DeviceMobile className="h-4 w-4" />
                <span className="capitalize">{status.platform}</span>
              </div>
            </div>
            <Badge variant={status.isSupported ? 'default' : 'secondary'}>
              {status.isSupported ? t('notificationSettings.status.supported') : t('notificationSettings.status.notSupported')}
            </Badge>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <div className="font-medium">{t('notificationSettings.status.permissionStatus')}</div>
              <div className="text-sm text-muted-foreground">
                {isPermissionGranted ? t('notificationSettings.status.notificationsEnabled') : t('notificationSettings.status.notificationsDisabled')}
              </div>
            </div>
            <Button
              variant={isPermissionGranted ? 'outline' : 'default'}
              size="sm"
              onClick={handlePermissionToggle}
              disabled={!status.isSupported}
            >
              {isPermissionGranted ? t('notificationSettings.status.enabled') : t('notificationSettings.status.enableNotifications')}
            </Button>
          </div>

          {isPermissionGranted && (
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <div className="font-medium">{t('notificationSettings.status.testNotifications')}</div>
                <div className="text-sm text-muted-foreground">
                  {t('notificationSettings.status.testNotificationsDescription')}
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={handleTestNotification}>
                {t('notificationSettings.status.sendTest')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Notification Preferences */}
      <Card>
        <CardHeader>
          <CardTitle>{t('notificationSettings.preferences.title')}</CardTitle>
          <CardDescription>
            {t('notificationSettings.preferences.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Master Toggle */}
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <div className="font-medium">{t('notificationSettings.preferences.enableNotifications.label')}</div>
              <div className="text-sm text-muted-foreground">
                {t('notificationSettings.preferences.enableNotifications.description')}
              </div>
            </div>
            <Switch
              checked={settings.enabled && isPermissionGranted}
              onCheckedChange={(checked) => updateSettings({ enabled: checked })}
              disabled={!isPermissionGranted}
            />
          </div>

          {/* Sound Settings */}
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <div className="font-medium flex items-center space-x-2">
                {settings.sound ? (
                  <SpeakerHigh className="h-4 w-4" />
                ) : (
                  <SpeakerSlash className="h-4 w-4" />
                )}
                <span>{t('notificationSettings.preferences.sound.label')}</span>
              </div>
              <div className="text-sm text-muted-foreground">
                {t('notificationSettings.preferences.sound.description')}
              </div>
            </div>
            <Switch
              checked={settings.sound}
              onCheckedChange={(checked) => updateSettings({ sound: checked })}
              disabled={!settings.enabled || !isPermissionGranted}
            />
          </div>

          {/* Badge Settings */}
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <div className="font-medium flex items-center space-x-2">
                <Shield className="h-4 w-4" />
                <span>{t('notificationSettings.preferences.appBadge.label')}</span>
              </div>
              <div className="text-sm text-muted-foreground">
                {t('notificationSettings.preferences.appBadge.description')}
              </div>
            </div>
            <Switch
              checked={settings.badge}
              onCheckedChange={(checked) => updateSettings({ badge: checked })}
              disabled={!settings.enabled || !isPermissionGranted}
            />
          </div>
        </CardContent>
      </Card>

      {/* Notification Categories */}
      <Card>
        <CardHeader>
          <CardTitle>{t('notificationSettings.categories.title')}</CardTitle>
          <CardDescription>
            {t('notificationSettings.categories.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <div className="font-medium">{t('notificationSettings.categories.assignments.label')}</div>
              <div className="text-sm text-muted-foreground">
                {t('notificationSettings.categories.assignments.description')}
              </div>
            </div>
            <Switch
              checked={settings.categories.assignments}
              onCheckedChange={(checked) =>
                updateSettings({
                  categories: { ...settings.categories, assignments: checked }
                })
              }
              disabled={!settings.enabled || !isPermissionGranted}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <div className="font-medium">{t('notificationSettings.categories.announcements.label')}</div>
              <div className="text-sm text-muted-foreground">
                {t('notificationSettings.categories.announcements.description')}
              </div>
            </div>
            <Switch
              checked={settings.categories.announcements}
              onCheckedChange={(checked) =>
                updateSettings({
                  categories: { ...settings.categories, announcements: checked }
                })
              }
              disabled={!settings.enabled || !isPermissionGranted}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <div className="font-medium">{t('notificationSettings.categories.liveClasses.label', { liveClasses })}</div>
              <div className="text-sm text-muted-foreground">
                {t('notificationSettings.categories.liveClasses.description', { liveClasses })}
              </div>
            </div>
            <Switch
              checked={settings.categories.liveClasses}
              onCheckedChange={(checked) =>
                updateSettings({
                  categories: { ...settings.categories, liveClasses: checked }
                })
              }
              disabled={!settings.enabled || !isPermissionGranted}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <div className="font-medium">{t('notificationSettings.categories.general.label')}</div>
              <div className="text-sm text-muted-foreground">
                {t('notificationSettings.categories.general.description')}
              </div>
            </div>
            <Switch
              checked={settings.categories.general}
              onCheckedChange={(checked) =>
                updateSettings({
                  categories: { ...settings.categories, general: checked }
                })
              }
              disabled={!settings.enabled || !isPermissionGranted}
            />
          </div>
        </CardContent>
      </Card>

      {/* Help Text */}
      {!isPermissionGranted && (
        <Card className="border-orange-200 bg-orange-50">
          <CardContent className="pt-6">
            <div className="flex items-start space-x-3">
              <Bell className="h-5 w-5 text-orange-600 mt-0.5" />
              <div>
                <h3 className="font-medium text-orange-900">{t('notificationSettings.helpText.title')}</h3>
                <p className="text-sm text-orange-700 mt-1">
                  {t('notificationSettings.helpText.body')}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};