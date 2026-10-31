import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatInTimeZone } from "date-fns-tz";
import { toast } from "sonner";
import {
  ArrowLeft,
  CalendarCheck,
  CalendarX,
  Clock,
  Prohibit,
  User,
  VideoCamera,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { DashboardLoader } from "@/components/core/dashboard-loader";
import {
  ModernCard,
  ModernCardHeader,
  ModernCardTitle,
} from "@/components/design-system/modern-card";
import { MyButton } from "@/components/design-system/button";
import { MyDialog } from "@/components/design-system/dialog";
import { Textarea } from "@/components/ui/textarea";
import SlotPicker from "../booking-response/-components/slot-picker";
import { BookingConfirmation } from "../booking-response/-components/booking-page";
import {
  BookingView,
  cancelBooking,
  extractBookingErrorMessage,
  getBrowserTimezone,
  handleGetBookingPage,
  handleGetManagedBooking,
  rescheduleBooking,
} from "../booking-response/-services/booking-services";
import { Trans, useTranslation } from "react-i18next";

const manageParamsSchema = z.object({
  token: z.string().min(1),
  instituteId: z.string().optional(),
});

export const Route = createFileRoute("/booking-manage/")({
  validateSearch: manageParamsSchema,
  component: RouteComponent,
  // Malformed/missing search params (zod validation failure) land here — show
  // a friendly message instead of the generic error page.
  errorComponent: () => {
    const { t } = useTranslation("liveClassGuest");
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-neutral-50 px-4">
        <ModernCard variant="glass" padding="lg" rounded="lg" className="max-w-md">
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <div className="flex size-16 items-center justify-center rounded-full bg-neutral-100">
              <CalendarX size={32} className="text-neutral-400" />
            </div>
            <h2 className="text-h3 font-semibold text-neutral-700">
              {t("bookingManage.errorPage.incompleteTitle")}
            </h2>
            <p className="text-body text-neutral-500">
              {t("bookingManage.errorPage.incompleteDescription")}
            </p>
          </div>
        </ModernCard>
      </div>
    );
  },
});

const STATUS_CLASSNAMES: Record<string, string> = {
  CONFIRMED: "bg-success-50 text-success-600 border-success-200",
  PENDING: "bg-warning-50 text-warning-600 border-warning-200",
  CANCELLED: "bg-danger-50 text-danger-600 border-danger-200",
  RESCHEDULED: "bg-neutral-100 text-neutral-600 border-neutral-200",
};

// Status label i18n keys — the raw backend status string is the fallback for
// any value outside this known set.
const STATUS_LABEL_KEYS: Record<string, string> = {
  CONFIRMED: "bookingManage.status.confirmed",
  PENDING: "bookingManage.status.pending",
  CANCELLED: "bookingManage.status.cancelled",
  RESCHEDULED: "bookingManage.status.rescheduled",
};

const statusClassName = (status: string) =>
  STATUS_CLASSNAMES[status] ?? "bg-neutral-100 text-neutral-600 border-neutral-200";

const formatSlotFull = (iso: string, tz: string) =>
  formatInTimeZone(new Date(iso), tz, "EEEE, d MMMM yyyy 'at' h:mm a");

function RouteComponent() {
  const { t } = useTranslation("liveClassGuest");
  const { token, instituteId } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [pendingSlot, setPendingSlot] = useState<{
    iso: string;
    tz: string;
  } | null>(null);
  const [confirmingReschedule, setConfirmingReschedule] = useState(false);
  const [justRescheduled, setJustRescheduled] = useState(false);
  // Controlled slot-picker state (survives the picker unmounting).
  const browserTz = useMemo(() => getBrowserTimezone(), []);
  const [pickerTz, setPickerTz] = useState<string>(browserTz);
  const [pickerWeekOffset, setPickerWeekOffset] = useState(0);
  const [pickerDayKey, setPickerDayKey] = useState<string | null>(null);

  const {
    data: booking,
    isLoading,
    isError,
  } = useQuery(handleGetManagedBooking(token));

  // Page data — only needed for the reschedule slot picker, and only possible
  // when instituteId is present (the manage view carries page_slug but not the
  // institute). When instituteId is missing we hide reschedule entirely.
  const { data: pageData, isLoading: pageLoading } = useQuery({
    ...handleGetBookingPage({
      instituteId: instituteId ?? "",
      slug: booking?.page_slug ?? "",
    }),
    enabled: rescheduling && !!instituteId && !!booking?.page_slug,
  });

  if (isLoading) {
    return <DashboardLoader />;
  }

  if (isError || !booking) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-neutral-50 px-4">
        <ModernCard variant="glass" padding="lg" rounded="lg" className="max-w-md">
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <div className="flex size-16 items-center justify-center rounded-full bg-neutral-100">
              <CalendarX size={32} className="text-neutral-400" />
            </div>
            <h2 className="text-h3 font-semibold text-neutral-700">
              {t("bookingManage.notFound.title")}
            </h2>
            <p className="text-body text-neutral-500">
              {t("bookingManage.notFound.description")}
            </p>
          </div>
        </ModernCard>
      </div>
    );
  }

  const tz = booking.invitee_timezone;
  const isPast = new Date(booking.start_time_utc).getTime() <= Date.now();
  // A retired booking (cancelled, or superseded by a reschedule) must never
  // offer the meet link or any actions.
  const isRetired =
    booking.status === "CANCELLED" || booking.status === "RESCHEDULED";
  const isActionable =
    (booking.status === "CONFIRMED" || booking.status === "PENDING") && !isPast;
  const canReschedule = isActionable && !!instituteId;
  const statusLabel = STATUS_LABEL_KEYS[booking.status]
    ? t(STATUS_LABEL_KEYS[booking.status])
    : booking.status;
  const statusClass = statusClassName(booking.status);

  const updateBookingCache = (view: BookingView) => {
    queryClient.setQueryData(["GET_MANAGED_BOOKING", view.manage_token], view);
  };

  const onCancel = async () => {
    setCancelling(true);
    try {
      const view = await cancelBooking({
        token,
        reason: cancelReason.trim() || undefined,
      });
      updateBookingCache(view);
      setCancelOpen(false);
      toast.success(t("bookingManage.toast.cancelSuccess"));
    } catch (error) {
      toast.error(
        extractBookingErrorMessage(
          error,
          t("bookingManage.toast.cancelError")
        )
      );
    } finally {
      setCancelling(false);
    }
  };

  const onConfirmReschedule = async () => {
    if (!pendingSlot) return;
    setConfirmingReschedule(true);
    try {
      const view = await rescheduleBooking({
        token,
        startTime: pendingSlot.iso,
        inviteeTimezone: pendingSlot.tz,
      });
      updateBookingCache(view);
      // Refresh availability for anyone re-opening the picker.
      await queryClient.invalidateQueries({ queryKey: ["GET_BOOKING_SLOTS"] });
      setRescheduling(false);
      setPendingSlot(null);
      setJustRescheduled(true);
      toast.success(t("bookingManage.toast.rescheduleSuccess"));
      // The reschedule mints a NEW manage token — update the URL so the link
      // in the address bar stays valid.
      navigate({
        to: "/booking-manage",
        search: { token: view.manage_token, instituteId },
        replace: true,
      });
    } catch (error) {
      toast.error(
        extractBookingErrorMessage(
          error,
          t("bookingManage.toast.rescheduleError")
        )
      );
      setPendingSlot(null);
      await queryClient.invalidateQueries({ queryKey: ["GET_BOOKING_SLOTS"] });
    } finally {
      setConfirmingReschedule(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-neutral-50">
      <div className="px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-2xl flex-col gap-section">
          <ModernCard variant="glass" padding="lg" rounded="lg">
            {justRescheduled ? (
              <>
                <BookingConfirmation
                  booking={booking}
                  instituteId={instituteId}
                />
                <div className="flex justify-center">
                  <MyButton
                    type="button"
                    buttonType="text"
                    scale="medium"
                    onClick={() => setJustRescheduled(false)}
                  >
                    {t("bookingManage.viewDetails")}
                  </MyButton>
                </div>
              </>
            ) : rescheduling ? (
              <>
                <div className="mb-4 flex items-center gap-2">
                  <MyButton
                    type="button"
                    buttonType="secondary"
                    layoutVariant="icon"
                    scale="medium"
                    onClick={() => {
                      setRescheduling(false);
                      setPendingSlot(null);
                    }}
                    aria-label={t("bookingManage.backToDetailsAria")}
                  >
                    <ArrowLeft size={16} />
                  </MyButton>
                  <ModernCardTitle size="md" className="text-neutral-700">
                    {t("bookingManage.pickNewTime")}
                  </ModernCardTitle>
                </div>
                {pageLoading || !pageData ? (
                  <div className="py-8 text-center text-body text-neutral-500">
                    {t("bookingManage.loadingAvailability")}
                  </div>
                ) : (
                  <div className="flex flex-col gap-4">
                    <SlotPicker
                      instituteId={instituteId as string}
                      slug={booking.page_slug}
                      pageTimezone={pageData.timezone}
                      bookingHorizonDays={pageData.booking_horizon_days}
                      onSelect={(iso, slotTz) =>
                        setPendingSlot({ iso, tz: slotTz })
                      }
                      selectedSlot={pendingSlot?.iso ?? null}
                      browserTimezone={browserTz}
                      tz={pickerTz}
                      onTzChange={setPickerTz}
                      weekOffset={pickerWeekOffset}
                      onWeekOffsetChange={setPickerWeekOffset}
                      selectedDayKey={pickerDayKey}
                      onSelectedDayKeyChange={setPickerDayKey}
                    />
                    {pendingSlot && (
                      <div className="flex flex-col gap-stack rounded-lg border border-primary-100 bg-primary-50 p-4">
                        <div className="flex items-center gap-2 text-body text-neutral-700">
                          <CalendarCheck
                            size={18}
                            className="shrink-0 text-primary-500"
                          />
                          <span className="font-semibold">
                            {formatSlotFull(pendingSlot.iso, pendingSlot.tz)}
                          </span>
                        </div>
                        <MyButton
                          type="button"
                          buttonType="primary"
                          scale="large"
                          layoutVariant="default"
                          disable={confirmingReschedule}
                          onClick={onConfirmReschedule}
                          className="w-full"
                        >
                          {confirmingReschedule
                            ? t("bookingManage.confirmReschedule.confirming")
                            : t("bookingManage.confirmReschedule.default")}
                        </MyButton>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <>
                <ModernCardHeader className="mb-4 p-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <ModernCardTitle size="lg" className="text-neutral-700">
                      {booking.title}
                    </ModernCardTitle>
                    <span
                      className={cn(
                        "rounded-full border px-3 py-1 text-caption font-semibold",
                        statusClass
                      )}
                    >
                      {statusLabel}
                    </span>
                  </div>
                </ModernCardHeader>

                <div className="flex flex-col gap-stack rounded-lg border border-neutral-200 bg-neutral-50 p-4">
                  {booking.host_name && (
                    <div className="flex items-center gap-2 text-body text-neutral-600">
                      <User size={18} className="shrink-0 text-primary-500" />
                      <span>
                        {t("common.hostedBy")}{" "}
                        <span className="font-semibold">
                          {booking.host_name}
                        </span>
                      </span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-body text-neutral-600">
                    <CalendarCheck
                      size={18}
                      className="shrink-0 text-primary-500"
                    />
                    <span className="font-semibold">
                      {formatSlotFull(booking.start_time_utc, tz)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-caption text-neutral-500">
                    <Clock size={18} className="shrink-0 text-primary-500" />
                    <span>{t("common.timezoneLabel", { tz: tz.replace(/_/g, " ") })}</span>
                  </div>
                  <div className="flex items-center gap-2 text-caption text-neutral-500">
                    <User size={18} className="shrink-0 text-primary-500" />
                    <span>
                      {t("bookingManage.bookedFor")}{" "}
                      <span className="font-semibold">
                        {booking.invitee_name}
                      </span>
                      {booking.invitee_email ? ` (${booking.invitee_email})` : ""}
                    </span>
                  </div>
                </div>

                {booking.status === "PENDING" && !isPast && (
                  <p className="mt-3 text-caption text-neutral-500">
                    {t("bookingManage.statusNotes.pending")}
                  </p>
                )}
                {booking.status === "CANCELLED" && (
                  <p className="mt-3 text-caption text-neutral-500">
                    {t("bookingManage.statusNotes.cancelled")}
                  </p>
                )}
                {booking.status === "RESCHEDULED" && (
                  <p className="mt-3 text-caption text-neutral-500">
                    {t("bookingManage.statusNotes.rescheduled")}
                  </p>
                )}
                {isPast && !isRetired && (
                  <p className="mt-3 text-caption text-neutral-500">
                    {t("bookingManage.statusNotes.past")}
                  </p>
                )}

                {booking.meet_link &&
                  !isRetired &&
                  !isPast && (
                    <a
                      href={booking.meet_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-4 block w-full"
                    >
                      <MyButton
                        type="button"
                        buttonType="primary"
                        scale="large"
                        layoutVariant="default"
                        className="w-full"
                      >
                        <VideoCamera size={18} className="me-2" />{" "}
                        {t("common.joinMeetingLink")}
                      </MyButton>
                    </a>
                  )}

                {isActionable && (
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                    {canReschedule && (
                      <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="large"
                        layoutVariant="default"
                        onClick={() => setRescheduling(true)}
                        className="w-full sm:flex-1"
                      >
                        {t("bookingManage.reschedule")}
                      </MyButton>
                    )}
                    <MyButton
                      type="button"
                      buttonType="secondary"
                      scale="large"
                      layoutVariant="default"
                      onClick={() => setCancelOpen(true)}
                      className="w-full !text-danger-600 sm:flex-1"
                    >
                      <Prohibit size={18} className="me-2" />{" "}
                      {t("bookingManage.cancelBooking")}
                    </MyButton>
                  </div>
                )}
              </>
            )}
          </ModernCard>
        </div>
      </div>

      {/* Cancel confirmation dialog */}
      <MyDialog
        heading={t("bookingManage.cancelDialog.heading")}
        open={cancelOpen}
        onOpenChange={(open) => {
          setCancelOpen(open);
          if (!open) setCancelReason("");
        }}
        footer={
          <div className="flex w-full justify-end gap-2">
            <MyButton
              type="button"
              buttonType="secondary"
              scale="medium"
              onClick={() => setCancelOpen(false)}
              disable={cancelling}
            >
              {t("bookingManage.cancelDialog.keepBooking")}
            </MyButton>
            <MyButton
              type="button"
              buttonType="primary"
              scale="medium"
              onClick={onCancel}
              disable={cancelling}
              className="!bg-danger-600 hover:!bg-danger-500"
            >
              {cancelling
                ? t("bookingManage.cancelDialog.cancelling")
                : t("bookingManage.cancelDialog.confirmCancel")}
            </MyButton>
          </div>
        }
      >
        <div className="flex flex-col gap-stack p-2">
          <p className="text-body text-neutral-600">
            <Trans
              t={t}
              i18nKey="bookingManage.cancelDialog.releaseNotice"
              values={{ slot: formatSlotFull(booking.start_time_utc, tz) }}
              components={{ bold: <span className="font-semibold" /> }}
            />
          </p>
          <label className="text-caption text-neutral-500" htmlFor="cancel-reason">
            {t("bookingManage.cancelDialog.reasonLabel")}
          </label>
          <Textarea
            id="cancel-reason"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder={t("bookingManage.cancelDialog.reasonPlaceholder")}
            rows={3}
          />
        </div>
      </MyDialog>
    </div>
  );
}
