import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
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
} from "@/components/ui/alert-dialog";
import { Bell, Megaphone, Trash } from "@phosphor-icons/react";
import { NotificationCard } from "./NotificationCard";
import { NotificationDetailDialog } from "./NotificationDetailDialog";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/design-system/states";
import { useSystemAlerts } from "@/hooks/useSystemAlerts";
import { useAnnouncementStore } from "@/stores/announcement-store";
import { announcementApi } from "@/services/announcementApi";
import {
  formatNotificationDate,
  groupNotifications,
  type GroupedNotification,
} from "@/lib/notifications";
import type { UserMessage } from "@/types/announcement";

type NotificationVariant = "general" | "announcement";

/** What the detail dialog is currently showing. */
interface SelectedNotification {
  message: UserMessage;
  count: number;
  isNew: boolean;
  variant: NotificationVariant;
}

/** Plain-text preview of a message body (strips HTML when needed). */
function getMessagePreview(message: UserMessage): string {
  if (message.content?.type === "html") {
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = message.content.content;
    return tempDiv.textContent || tempDiv.innerText || "";
  }
  return message.content?.content ?? "";
}

interface MessageGroupListProps {
  groups: GroupedNotification[];
  variant: NotificationVariant;
  onSelect: (selected: SelectedNotification) => void;
  onClear: (group: GroupedNotification, variant: NotificationVariant) => void;
  clearingIds: ReadonlySet<string>;
}

function MessageGroupList({
  groups,
  variant,
  onSelect,
  onClear,
  clearingIds,
}: MessageGroupListProps) {
  const { t } = useTranslation("dashboard");
  return (
    <div className="flex flex-col gap-stack">
      {groups.map((group) => {
        const { alert, count, isRead } = group;
        return (
          <NotificationCard
            key={alert.messageId}
            title={alert.title || t("notifications.defaultTitle")}
            description={getMessagePreview(alert)}
            date={formatNotificationDate(alert.createdAt)}
            isNew={!isRead}
            count={count}
            variant={variant}
            clearing={clearingIds.has(alert.messageId)}
            onClick={() =>
              onSelect({ message: alert, count, isNew: !isRead, variant })
            }
            onClear={() => onClear(group, variant)}
          />
        );
      })}
    </div>
  );
}

export function NotificationList() {
  const { t } = useTranslation("dashboard");
  const {
    alerts,
    loading: alertsLoading,
    error: alertsError,
    hasMore,
    loadMore,
    refresh,
    markAsRead,
  } = useSystemAlerts({
    enablePolling: true,
    autoMarkAsRead: false,
  });

  const {
    dashboardPins,
    fetchDashboardPins,
    markPinAsRead,
    dismissAlert,
    dismissAllAlerts,
    dismissDashboardPin,
    dismissAllDashboardPins,
    removeSystemAlert,
    removeDashboardPin,
  } = useAnnouncementStore();

  const [selected, setSelected] = useState<SelectedNotification | null>(null);
  // Tab is controlled so "Clear all" knows which list it is clearing.
  const [activeTab, setActiveTab] = useState<NotificationVariant>("general");
  const [clearingIds, setClearingIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const [clearingAll, setClearingAll] = useState(false);

  useEffect(() => {
    fetchDashboardPins();
  }, [fetchDashboardPins]);

  const generalGroups = useMemo(
    () => groupNotifications(alerts.filter((alert) => !alert.isDismissed)),
    [alerts]
  );
  const announcementGroups = useMemo(
    () => groupNotifications(dashboardPins.items.filter((pin) => !pin.isDismissed)),
    [dashboardPins.items]
  );

  const unreadCount =
    generalGroups.filter((group) => !group.isRead).length +
    announcementGroups.filter((group) => !group.isRead).length;

  /* Opening the detail view is the read receipt: the list intentionally runs
     with autoMarkAsRead off so unread state survives a passing scroll. */
  const handleSelect = (next: SelectedNotification) => {
    setSelected(next);
    if (!next.isNew) return;
    const markRead =
      next.variant === "announcement" ? markPinAsRead : markAsRead;
    void markRead(next.message.messageId).catch(() => undefined);
  };

  /**
   * Clear one row. A grouped row (×3) stands for several messages, so every id
   * it folded in has to be dismissed — dismissing only the newest would leave
   * the row on screen with a smaller count.
   */
  const handleClear = async (
    group: GroupedNotification,
    variant: NotificationVariant
  ) => {
    const ids = group.messageIds;
    setClearingIds((current) => new Set(current).add(group.alert.messageId));
    try {
      if (ids.length === 1) {
        await (variant === "announcement"
          ? dismissDashboardPin(ids[0])
          : dismissAlert(ids[0]));
      } else {
        await announcementApi.batchDismissMessages(ids);
        const remove =
          variant === "announcement" ? removeDashboardPin : removeSystemAlert;
        ids.forEach(remove);
      }
    } finally {
      setClearingIds((current) => {
        const next = new Set(current);
        next.delete(group.alert.messageId);
        return next;
      });
    }
  };

  const handleClearAll = async () => {
    setClearingAll(true);
    try {
      await (activeTab === "announcement"
        ? dismissAllDashboardPins()
        : dismissAllAlerts());
    } finally {
      setClearingAll(false);
    }
  };

  const visibleGroups =
    activeTab === "announcement" ? announcementGroups : generalGroups;

  return (
    <div className="flex flex-col gap-section">
      <Tabs
        value={activeTab === "announcement" ? "Announcement" : "General"}
        onValueChange={(value) =>
          setActiveTab(value === "Announcement" ? "announcement" : "general")
        }
        className="flex w-full flex-col gap-section"
      >
        <div className="flex flex-col gap-stack">
          {/* No page-level <h1>: the navbar already renders "Notifications"
              as the page heading, so a second one would duplicate the title
              and give the route two h1s. */}
          <p className="text-sm text-muted-foreground">
            {unreadCount > 0
              ? t("notifications.unreadSummary", { count: unreadCount })
              : t("notifications.pageSubtitle")}
          </p>

          <div className="flex flex-wrap items-center justify-between gap-stack">
            <TabsList className="h-auto w-fit gap-1 border border-border bg-muted p-1 shadow-sm">
              <TabsTrigger
                className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm sm:px-4 sm:py-2"
                value="General"
              >
                <span className="flex items-center gap-2">
                  <Bell className="size-4" />
                  {t("notifications.tabGeneral")}
                </span>
              </TabsTrigger>
              <TabsTrigger
                className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm sm:px-4 sm:py-2"
                value="Announcement"
              >
                <span className="flex items-center gap-2">
                  <Megaphone className="size-4" />
                  {t("notifications.tabAnnouncements")}
                </span>
              </TabsTrigger>
            </TabsList>

            {/* Confirmed, because dismissing is not reversible from the app. */}
            {visibleGroups.length > 0 && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={clearingAll}
                    className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash size={15} />
                    {clearingAll
                      ? t("notifications.clearing")
                      : t("notifications.clearAll")}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {t("notifications.clearAllTitle")}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("notifications.clearAllDescription", {
                        count: visibleGroups.length,
                      })}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>
                      {t("notifications.cancel")}
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => void handleClearAll()}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      {t("notifications.clearAll")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </div>

        {/* General notifications (system alerts) */}
        <TabsContent className="mt-0" value="General">
          {alertsLoading && alerts.length === 0 ? (
            <LoadingState variant="list" count={3} />
          ) : alertsError ? (
            <ErrorState
              title={t("notifications.errorTitle")}
              message={alertsError}
              onRetry={refresh}
            />
          ) : generalGroups.length === 0 ? (
            <EmptyState
              icon={Bell}
              title={t("notifications.emptyTitle")}
              description={t("notifications.emptyDescription")}
            />
          ) : (
            <div className="flex flex-col gap-stack">
              <MessageGroupList
                groups={generalGroups}
                variant="general"
                onSelect={handleSelect}
                onClear={(group, variant) => void handleClear(group, variant)}
                clearingIds={clearingIds}
              />
              {hasMore && (
                <div className="flex justify-center pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={loadMore}
                    disabled={alertsLoading}
                  >
                    {alertsLoading
                      ? t("notifications.loading")
                      : t("notifications.loadMore")}
                  </Button>
                </div>
              )}
            </div>
          )}
        </TabsContent>

        {/* Announcements (dashboard pins) */}
        <TabsContent className="mt-0" value="Announcement">
          {dashboardPins.loading && dashboardPins.items.length === 0 ? (
            <LoadingState variant="list" count={3} />
          ) : dashboardPins.error ? (
            <ErrorState
              title={t("notifications.announcementsErrorTitle")}
              message={dashboardPins.error}
              onRetry={fetchDashboardPins}
            />
          ) : announcementGroups.length === 0 ? (
            <EmptyState
              icon={Megaphone}
              title={t("notifications.announcementsEmptyTitle")}
              description={t("notifications.announcementsEmptyDescription")}
            />
          ) : (
            <MessageGroupList
              groups={announcementGroups}
              variant="announcement"
              onSelect={handleSelect}
              onClear={(group, variant) => void handleClear(group, variant)}
              clearingIds={clearingIds}
            />
          )}
        </TabsContent>
      </Tabs>

      <NotificationDetailDialog
        notification={selected?.message ?? null}
        count={selected?.count}
        isNew={selected?.isNew}
        variant={selected?.variant}
        open={selected !== null}
        onOpenChange={(next) => {
          if (!next) setSelected(null);
        }}
      />
    </div>
  );
}
