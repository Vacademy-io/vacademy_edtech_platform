import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { addDays, format, parseISO } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { CaretLeft, CaretRight, CircleNotch, GlobeHemisphereEast } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { MyButton } from "@/components/design-system/button";
import { handleGetBookingSlots } from "../-services/booking-services";
import { useTranslation } from "react-i18next";

interface SlotPickerProps {
  instituteId: string;
  slug: string;
  /** The booking page's own timezone (offered as an alternative to the browser tz). */
  pageTimezone: string;
  bookingHorizonDays: number;
  /** Called when the invitee picks a slot. `slotIso` is the ISO offset datetime as returned by the API. */
  onSelect: (slotIso: string, timezone: string) => void;
  /** Currently selected slot ISO string (highlighted, compared by instant so it survives tz switches). */
  selectedSlot?: string | null;
  // Controlled picker state — lifted to the parent so it survives the picker
  // unmounting (e.g. navigating to the details step and back).
  browserTimezone: string;
  tz: string;
  onTzChange: (tz: string) => void;
  weekOffset: number;
  onWeekOffsetChange: (offset: number) => void;
  selectedDayKey: string | null;
  onSelectedDayKeyChange: (dayKey: string) => void;
  /** Chosen session-type length (minutes) so slots fit the actual meeting length. */
  duration?: number;
}

const DAYS_PER_PAGE = 7;

/**
 * Calendly-style slot picker: a 7-day strip (paged, capped at the page's
 * booking horizon) + the available times for the selected day, with a
 * browser-tz / page-tz switch. Reused by the public booking page and the
 * manage-booking reschedule flow. All UI state is controlled by the parent.
 */
const SlotPicker = ({
  instituteId,
  slug,
  pageTimezone,
  bookingHorizonDays,
  onSelect,
  selectedSlot,
  browserTimezone,
  tz,
  onTzChange,
  weekOffset,
  onWeekOffsetChange,
  selectedDayKey,
  onSelectedDayKeyChange,
  duration,
}: SlotPickerProps) => {
  const { t } = useTranslation("liveClassGuest");
  const horizonDays = Math.max(1, bookingHorizonDays || 30);

  // "Today" as seen in the invitee's selected timezone.
  const todayKey = formatInTimeZone(new Date(), tz, "yyyy-MM-dd");
  const baseDate = parseISO(todayKey);

  // Day window for the current page of the strip, clipped to the horizon.
  const days = useMemo(() => {
    const result: { key: string; date: Date }[] = [];
    for (let i = 0; i < DAYS_PER_PAGE; i++) {
      const idx = weekOffset * DAYS_PER_PAGE + i;
      if (idx >= horizonDays) break;
      const date = addDays(baseDate, idx);
      result.push({ key: format(date, "yyyy-MM-dd"), date });
    }
    return result;
    // baseDate is derived from todayKey, which is stable per tz/day
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekOffset, horizonDays, todayKey]);

  // Fetch one extra day on each side of the visible window: the backend
  // expands from/to as PAGE-timezone days, so when the invitee tz differs a
  // window-edge day can span two page-tz days and its slots would otherwise
  // never be fetched. The strip and the grouping below stay limited to the
  // visible days (the backend caps ranges well above 9 days).
  const from = format(
    addDays(baseDate, Math.max(0, weekOffset * DAYS_PER_PAGE - 1)),
    "yyyy-MM-dd"
  );
  const to = days.length
    ? format(addDays(days[days.length - 1].date, 1), "yyyy-MM-dd")
    : todayKey;

  const {
    data: slotsData,
    isLoading: slotsLoading,
    isError: slotsError,
  } = useQuery(handleGetBookingSlots({ instituteId, slug, from, to, tz, duration }));

  // Group returned slots by day (in the selected timezone).
  const slotsByDay = useMemo(() => {
    const grouped: Record<string, string[]> = {};
    (slotsData?.slots ?? []).forEach((slot) => {
      const dayKey = formatInTimeZone(new Date(slot), tz, "yyyy-MM-dd");
      (grouped[dayKey] = grouped[dayKey] ?? []).push(slot);
    });
    return grouped;
  }, [slotsData, tz]);

  // Effective selected day — fall back to the first day of the window when the
  // stored selection isn't in the current window (week/tz change).
  const activeDayKey = days.some((d) => d.key === selectedDayKey)
    ? (selectedDayKey as string)
    : days[0]?.key ?? todayKey;

  const activeDaySlots = slotsByDay[activeDayKey] ?? [];

  const hasNextPage = (weekOffset + 1) * DAYS_PER_PAGE < horizonDays;

  const tzOptions =
    pageTimezone && pageTimezone !== browserTimezone
      ? [browserTimezone, pageTimezone]
      : [browserTimezone];

  const selectedInstant = selectedSlot ? new Date(selectedSlot).getTime() : null;

  return (
    <div className="flex flex-col gap-4">
      {/* Timezone switch */}
      <div className="flex flex-wrap items-center gap-2">
        <GlobeHemisphereEast className="text-neutral-500" size={18} />
        {tzOptions.length > 1 ? (
          tzOptions.map((option) => (
            <MyButton
              key={option}
              type="button"
              buttonType={tz === option ? "primary" : "secondary"}
              scale="small"
              layoutVariant="default"
              className="!min-w-0 px-3"
              onClick={() => onTzChange(option)}
            >
              {option.replace(/_/g, " ")}
            </MyButton>
          ))
        ) : (
          <span className="text-caption text-neutral-600">
            {tz.replace(/_/g, " ")}
          </span>
        )}
      </div>

      {/* Day strip */}
      <div className="flex items-center gap-2">
        <MyButton
          type="button"
          buttonType="secondary"
          layoutVariant="icon"
          scale="medium"
          disable={weekOffset === 0}
          onClick={() => onWeekOffsetChange(Math.max(0, weekOffset - 1))}
          aria-label={t("bookingResponse.slotPicker.prevDaysAria")}
        >
          <CaretLeft size={16} />
        </MyButton>
        <div className="flex flex-1 gap-1 overflow-x-auto pb-1">
          {days.map((day) => {
            const isActive = day.key === activeDayKey;
            const hasSlots = (slotsByDay[day.key] ?? []).length > 0;
            return (
              <button
                key={day.key}
                type="button"
                onClick={() => onSelectedDayKeyChange(day.key)}
                className={cn(
                  "flex min-w-14 flex-1 flex-col items-center rounded-lg border px-2 py-2 transition-colors",
                  isActive
                    ? "border-primary-500 bg-primary-50 text-primary-500"
                    : "border-neutral-200 bg-white text-neutral-600 hover:border-primary-200"
                )}
              >
                <span className="text-caption font-semibold uppercase">
                  {format(day.date, "EEE")}
                </span>
                <span className="text-body font-semibold">
                  {format(day.date, "d")}
                </span>
                <span className="text-caption text-neutral-400">
                  {format(day.date, "MMM")}
                </span>
                <span
                  className={cn(
                    "mt-1 size-1.5 rounded-full",
                    hasSlots ? "bg-success-500" : "bg-transparent"
                  )}
                />
              </button>
            );
          })}
        </div>
        <MyButton
          type="button"
          buttonType="secondary"
          layoutVariant="icon"
          scale="medium"
          disable={!hasNextPage}
          onClick={() => onWeekOffsetChange(weekOffset + 1)}
          aria-label={t("bookingResponse.slotPicker.nextDaysAria")}
        >
          <CaretRight size={16} />
        </MyButton>
      </div>

      {/* Slots for the selected day */}
      <div className="min-h-24">
        {slotsLoading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-neutral-500">
            <CircleNotch className="animate-spin" size={20} />
            <span className="text-body">{t("bookingResponse.slotPicker.loading")}</span>
          </div>
        ) : slotsError ? (
          <div className="py-8 text-center text-body text-danger-600">
            {t("bookingResponse.slotPicker.loadError")}
          </div>
        ) : activeDaySlots.length === 0 ? (
          <div className="py-8 text-center text-body text-neutral-500">
            {t("bookingResponse.slotPicker.noSlots", {
              day: format(parseISO(activeDayKey), "EEEE, d MMMM"),
            })}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {activeDaySlots.map((slot) => {
              const isSelected =
                selectedInstant !== null &&
                new Date(slot).getTime() === selectedInstant;
              return (
                <MyButton
                  key={slot}
                  type="button"
                  buttonType={isSelected ? "primary" : "secondary"}
                  scale="medium"
                  layoutVariant="default"
                  className="w-full !min-w-0"
                  onClick={() => onSelect(slot, tz)}
                >
                  {formatInTimeZone(new Date(slot), tz, "h:mm a")}
                </MyButton>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default SlotPicker;
