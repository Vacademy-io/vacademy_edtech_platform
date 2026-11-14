import React from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Bell, CaretRight } from '@phosphor-icons/react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/design-system/states';
import { useSystemAlerts } from '@/hooks/useSystemAlerts';
import {
  formatNotificationDate,
  getCreatedAtMs,
  getNotificationsLastSeen,
  groupNotifications,
  setNotificationsLastSeen,
  type GroupedNotification,
} from '@/lib/notifications';
import { cn } from '@/lib/utils';

const MAX_ROWS = 5;

/**
 * Navbar notification bell: THE notification surface of the shell.
 * Badge counts grouped notifications newer than the locally stored
 * "last seen" timestamp; opening the popover marks everything as seen.
 */
export const NotificationsBell: React.FC<{ className?: string }> = ({
  className,
}) => {
  const { t } = useTranslation('layoutCommonA');
  const navigate = useNavigate();
  const { alerts, loading, error, isEnabled, isLoadingSettings } =
    useSystemAlerts({
      enablePolling: true,
      pollingInterval: 60000,
      autoMarkAsRead: false, // seen-state is handled via the lastSeen timestamp
    });

  const [open, setOpen] = React.useState(false);
  const [lastSeen, setLastSeen] = React.useState<number>(() =>
    getNotificationsLastSeen(),
  );

  const grouped = React.useMemo(
    (): GroupedNotification[] =>
      groupNotifications(alerts.filter((alert) => !alert.isDismissed)),
    [alerts],
  );
  const latest = grouped.slice(0, MAX_ROWS);

  const unseenCount = React.useMemo(
    () => grouped.filter((group) => getCreatedAtMs(group.alert) > lastSeen).length,
    [grouped, lastSeen],
  );

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      const now = Date.now();
      setNotificationsLastSeen(now);
      setLastSeen(now);
    }
  };

  const goToInbox = () => {
    setOpen(false);
    navigate({ to: '/dashboard/notifications' });
  };

  if (isLoadingSettings || !isEnabled) {
    return null;
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={
            unseenCount > 0
              ? t('notificationsBell.ariaLabelWithCount', { count: unseenCount })
              : t('common.notifications')
          }
          className={cn(
            // Default / vibrant: quiet ghost icon button matching navbar icon sizing
            'relative flex items-center justify-center w-8 h-8 md:w-9 md:h-9 rounded-md',
            'text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-neutral-700',
            'hover:text-primary-700 dark:hover:text-primary-300 transition-colors duration-200',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
            // Play: slightly chunkier rounded-full button
            '[.ui-play_&]:rounded-full [.ui-play_&]:bg-primary/10 [.ui-play_&]:border [.ui-play_&]:border-border',
            className,
          )}
        >
          <Bell
            className="w-4 h-4 md:w-5 md:h-5"
            weight={unseenCount > 0 ? 'fill' : 'regular'}
          />
          {unseenCount > 0 && (
            <span
              aria-hidden="true"
              className="absolute -top-0.5 -end-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary-500 px-1 text-caption font-semibold leading-none text-white tabular-nums"
            >
              {unseenCount > 9 ? '9+' : unseenCount}
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-80 p-0 [.ui-play_&]:rounded-2xl [.ui-play_&]:border [.ui-play_&]:border-border"
      >
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-foreground">
            {t('common.notifications')}
          </h3>
        </div>

        {error && (
          <div className="px-4 py-3 text-sm text-destructive">{error}</div>
        )}

        {loading && latest.length === 0 ? (
          <div
            className="flex flex-col gap-stack px-4 py-3"
            role="status"
            aria-live="polite"
          >
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="flex flex-col gap-1.5">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            ))}
          </div>
        ) : latest.length === 0 ? (
          <EmptyState
            icon={Bell}
            title={t('notificationsBell.allCaughtUpTitle')}
            description={t('notificationsBell.allCaughtUpDescription')}
            compact
            className="px-4"
          />
        ) : (
          <ul className="max-h-80 overflow-y-auto py-1">
            {latest.map(({ alert, count, isRead }) => (
              <li key={alert.messageId}>
                <button
                  type="button"
                  onClick={goToInbox}
                  className="flex w-full items-start gap-2.5 px-4 py-2.5 text-start transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <span
                    className={cn(
                      'mt-1.5 size-2 shrink-0 rounded-full',
                      !isRead ? 'bg-primary-500' : 'bg-muted',
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-foreground">
                        {alert.title || t('notificationsBell.fallbackNotificationTitle')}
                      </span>
                      {count > 1 && (
                        <span className="shrink-0 rounded-full bg-secondary px-1.5 text-caption text-secondary-foreground tabular-nums">
                          x{count}
                        </span>
                      )}
                    </span>
                    <span className="block text-caption text-muted-foreground">
                      {formatNotificationDate(alert.createdAt)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="border-t border-border p-1.5">
          <button
            type="button"
            onClick={goToInbox}
            className="flex w-full items-center justify-center gap-1 rounded-md px-3 py-2 text-sm font-medium text-primary-600 transition-colors hover:bg-primary-50 dark:text-primary-400 dark:hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [.ui-play_&]:rounded-xl [.ui-play_&]:font-bold"
          >
            {t('notificationsBell.viewAll')}
            <CaretRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
};
