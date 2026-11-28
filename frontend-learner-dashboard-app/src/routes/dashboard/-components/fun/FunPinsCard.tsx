import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn, sanitizeHtml } from "@/lib/utils";
import { useDashboardPins } from "@/hooks/useDashboardPins";
import { formatLocalDateTime } from "@/helpers/formatISOTime";
import { announcementApi } from "@/services/announcementApi";
import type { UserMessage } from "@/types/announcement";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
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
import { FUN_PINS_SHOWN, pinTimeLeft, pinTone, type PinTimeLeft } from "./pins";

/**
 * The institute's pinned announcements on the Fun home, in place of the classic
 * panel (DashboardPinsPanel): the same pins, polling, read marks, dismiss and clear,
 * drawn as a Fun card. Every control is at least 44px, every text 4.5:1 or more.
 * It leads nothing: on a laptop it sits under the Today rail, on a phone under the
 * Today cards. Renders nothing while pins are off or there is no pin.
 */
export function FunPinsCard() {
  const { t } = useTranslation("courseComponentsExtra");
  const { t: tFun } = useTranslation("funHome");
  const { pins, loading, error, isEnabled, isLoadingSettings, markAsRead, dismiss, dismissAll, refresh } =
    useDashboardPins({ enablePolling: true, pollingInterval: 15000, autoMarkAsRead: true });
  const [open, setOpen] = useState<UserMessage | null>(null);
  const [showAll, setShowAll] = useState(false);

  if (isLoadingSettings || !isEnabled || pins.length === 0) return null;

  const shown = showAll ? pins : pins.slice(0, FUN_PINS_SHOWN);
  const priorityLabel = (priority: UserMessage["priority"]) => t(`dashboardPinsPanel.priority.${pinTone(priority)}`);
  const timeLeftLabel = (left: PinTimeLeft | null) =>
    !left
      ? null
      : left.unit === "lessThanHour"
        ? t("dashboardPinsPanel.timeRemaining.lessThanHour")
        : t(`dashboardPinsPanel.timeRemaining.${left.unit}`, { count: left.count });

  const openPin = (pin: UserMessage) => {
    setOpen(pin);
    void markAsRead(pin.messageId);
    announcementApi.recordInteraction(pin.messageId, "CLICKED", { source: "DashboardPinsPanel" }).catch(() => undefined);
  };

  const body = (pin: UserMessage, full: boolean) =>
    pin.content.type === "html" ? (
      <div
        className={cn("fun-pins__body", !full && "fun-clamp-2")}
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(pin.content.content) }}
      />
    ) : (
      <p className={cn("fun-pins__body", !full && "fun-clamp-2")}>{pin.content.content}</p>
    );

  const openLeft = open ? timeLeftLabel(pinTimeLeft(open.pinEndTime, Date.now())) : null;

  return (
    <section className="fun-pins" aria-labelledby="fun-pins-title">
      <div className="fun-pins__head">
        <h2 id="fun-pins-title" className="fun-section-title">
          {t("dashboardPinsPanel.importantUpdates")}
        </h2>
        <div className="fun-pins__actions">
          <button type="button" className="fun-link fun-pins__action" onClick={() => void refresh()} disabled={loading}>
            {t("common.refresh")}
          </button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button type="button" className="fun-link fun-pins__action fun-pins__action--clear" disabled={loading}>
                {t("common.clearAll")}
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("dashboardPinsPanel.clearAllTitle")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("dashboardPinsPanel.clearAllDescription", { count: pins.length })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                <AlertDialogAction onClick={() => void dismissAll()} className="bg-red-600 hover:bg-red-700 focus:ring-red-600">
                  {t("common.clearAll")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {error && (
        <p className="fun-pins__error" role="alert">
          {error}
        </p>
      )}

      <ul className="fun-pins__list">
        {shown.map((pin) => {
          const tone = pinTone(pin.priority);
          const when = formatLocalDateTime(pin.createdAt);
          const left = timeLeftLabel(pinTimeLeft(pin.pinEndTime, Date.now()));
          const name = pin.title || t("dashboardPinsPanel.importantUpdates");
          return (
            <li key={pin.messageId} className={cn("fun-pins__item", !pin.isRead && "fun-pins__item--unread")}>
              <button type="button" className="fun-pins__open" onClick={() => openPin(pin)}>
                <span className="fun-pins__top">
                  {pin.priority && <span className={`fun-pins__chip fun-pins__chip--${tone}`}>{priorityLabel(pin.priority)}</span>}
                  {!pin.isRead && (
                    <span className="fun-pins__new">
                      <span className="fun-pins__dot" aria-hidden="true" />
                      {tFun("pins.unread")}
                    </span>
                  )}
                </span>
                {pin.title && (
                  <span className="fun-pins__title">
                    <bdi>{pin.title}</bdi>
                  </span>
                )}
                {body(pin, false)}
                {(pin.createdByName || when || left) && (
                  <span className="fun-pins__meta">
                    {pin.createdByName && <bdi>{pin.createdByName}</bdi>}
                    {pin.createdByName && when ? " · " : null}
                    {when}
                    {left && <span className="fun-pins__left">{left}</span>}
                  </span>
                )}
              </button>
              <button
                type="button"
                className="fun-pins__dismiss"
                aria-label={tFun("pins.dismiss", { title: name })}
                title={tFun("pins.dismissShort")}
                onClick={() => void dismiss(pin.messageId)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 6 L18 18 M18 6 L6 18" />
                </svg>
              </button>
            </li>
          );
        })}
      </ul>

      {pins.length > FUN_PINS_SHOWN && (
        <button type="button" className="fun-link fun-pins__more" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
          {showAll ? tFun("pins.showFewer") : tFun("pins.showAll", { count: pins.length })}
        </button>
      )}

      <Dialog open={open !== null} onOpenChange={(next) => !next && setOpen(null)}>
        {open && (
          <DialogContent className="fun-pins__dialog">
            <DialogTitle className="fun-pins__dialog-title">
              {open.title || t("dashboardPinsPanel.importantUpdates")}
            </DialogTitle>
            <DialogDescription className="fun-pins__meta">
              {open.priority && (
                <span className={`fun-pins__chip fun-pins__chip--${pinTone(open.priority)}`}>{priorityLabel(open.priority)}</span>
              )}
              {open.createdByName && <span>{t("dashboardPinsPanel.byAuthor", { name: open.createdByName })}</span>}
              {open.createdAt && <span>{formatLocalDateTime(open.createdAt)}</span>}
            </DialogDescription>
            {body(open, true)}
            {openLeft && <p className="fun-pins__expires">{t("dashboardPinsPanel.pinExpires", { time: openLeft })}</p>}
          </DialogContent>
        )}
      </Dialog>
    </section>
  );
}
