import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { CalendarCheck, WarningCircle } from "@phosphor-icons/react";
import { MyButton } from "@/components/design-system/button";
import { MyInput } from "@/components/design-system/input";
import { MyDialog } from "@/components/design-system/dialog";
import { reportApiError } from "@/lib/report-api-error";
import SlotPicker from "@/routes/booking-response/-components/slot-picker";
import {
    getBrowserTimezone,
    handleGetBookingPage,
} from "@/routes/booking-response/-services/booking-services";
import {
    cancelMyMentorSession,
    rescheduleMyMentorSession,
    type MyMentorSession,
} from "../-services/my-mentors-service";
import { sessionWhen } from "../-utils/sessions";

/**
 * Cancel or move one of the learner's own 1:1s.
 *
 * Rescheduling reuses the very same slot picker the booking page uses, reading the
 * mentor's live availability — so a learner can only move a session to a time the
 * mentor is actually free, instead of proposing one and being refused.
 */
export function ManageSessionDialog({
    session,
    action,
    instituteId,
    /** The mentor's booking-page slug, needed to read their availability. */
    mentorSlug,
    onOpenChange,
}: {
    session: MyMentorSession | null;
    action: "cancel" | "reschedule" | null;
    instituteId: string | undefined;
    mentorSlug: string | null | undefined;
    onOpenChange: (open: boolean) => void;
}) {
    const { t } = useTranslation("miscRoutesA");
    const queryClient = useQueryClient();
    const [reason, setReason] = useState("");
    const [slot, setSlot] = useState<string | null>(null);

    const browserTz = useMemo(() => getBrowserTimezone(), []);
    const [pickerTz, setPickerTz] = useState<string>(browserTz);
    const [weekOffset, setWeekOffset] = useState(0);
    const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);

    // The page carries the timezone and booking horizon the picker needs. Only
    // fetched while a reschedule is actually open.
    const pageQuery = useQuery({
        ...handleGetBookingPage({ instituteId: instituteId ?? "", slug: mentorSlug ?? "" }),
        enabled: action === "reschedule" && !!instituteId && !!mentorSlug,
    });

    useEffect(() => {
        if (!action) return;
        setReason("");
        setSlot(null);
        setWeekOffset(0);
        setSelectedDayKey(null);
        setPickerTz(browserTz);
    }, [action, session?.booking_instance_id, browserTz]);

    const refresh = () => {
        queryClient.invalidateQueries({ queryKey: ["GET_MY_MENTOR_SESSIONS"] });
        queryClient.invalidateQueries({ queryKey: ["GET_BOOKING_SLOTS"] });
    };

    const run = useMutation({
        mutationFn: async () => {
            if (!session || !instituteId) throw new Error("missing session");
            if (action === "cancel") {
                return cancelMyMentorSession({
                    instituteId,
                    bookingInstanceId: session.booking_instance_id,
                    reason: reason.trim() || undefined,
                });
            }
            return rescheduleMyMentorSession({
                instituteId,
                bookingInstanceId: session.booking_instance_id,
                startTime: slot ?? "",
                inviteeTimezone: pickerTz,
            });
        },
        onSuccess: () => {
            toast.success(
                action === "cancel"
                    ? t("myMentors.manageDialog.toast.cancelled")
                    : t("myMentors.manageDialog.toast.moved")
            );
            refresh();
            onOpenChange(false);
        },
        onError: (error: unknown) => {
            // "This slot is no longer available" is the common one and worth reading.
            reportApiError(error, {
                feature: "mentorship",
                tags: { "mentorship.action": `learner-session-${action}` },
                extra: { bookingInstanceId: session?.booking_instance_id },
                fallbackMessage:
                    action === "cancel"
                        ? t("myMentors.manageDialog.toast.cancelFailed")
                        : t("myMentors.manageDialog.toast.moveFailed"),
            });
            refresh();
        },
    });

    if (!session || !action) return null;
    const cancelling = action === "cancel";

    return (
        <MyDialog
            heading={
                cancelling
                    ? t("myMentors.manageDialog.headingCancel")
                    : t("myMentors.manageDialog.headingMove")
            }
            open={!!action}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-lg"
            footer={
                <div className="flex justify-end gap-2">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => onOpenChange(false)}
                    >
                        {t("myMentors.manageDialog.keepAsIs")}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        onClick={() => {
                            if (!cancelling && !slot) {
                                toast.error(t("myMentors.manageDialog.pickTimeFirst"));
                                return;
                            }
                            run.mutate();
                        }}
                        disable={run.isPending || (!cancelling && !slot)}
                    >
                        {run.isPending
                            ? t("myMentors.manageDialog.saving")
                            : cancelling
                              ? t("myMentors.manageDialog.cancelSession")
                              : t("myMentors.manageDialog.moveSession")}
                    </MyButton>
                </div>
            }
        >
            <div className="flex flex-col gap-4">
                <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                    <CalendarCheck size={18} className="shrink-0 text-primary-500" />
                    <div className="flex min-w-0 flex-col">
                        <span className="truncate text-body font-semibold text-neutral-700">
                            {session.mentor_name || t("myMentors.common.yourMentor")}
                        </span>
                        <span className="text-caption text-neutral-500">
                            {sessionWhen(session.scheduled_start_utc)}
                        </span>
                    </div>
                </div>

                {cancelling ? (
                    <>
                        <p className="text-body text-neutral-600">
                            {t("myMentors.manageDialog.cancelDescription")}
                        </p>
                        <MyInput
                            input={reason}
                            onChangeFunction={(e: React.ChangeEvent<HTMLInputElement>) =>
                                setReason(e.target.value)
                            }
                            inputType="text"
                            inputPlaceholder={t("myMentors.manageDialog.reasonPlaceholder")}
                            label={t("myMentors.manageDialog.reasonLabel")}
                            className="w-full"
                        />
                    </>
                ) : !mentorSlug ? (
                    <div className="flex items-start gap-2 rounded-lg border border-warning-200 bg-warning-50 p-3">
                        <WarningCircle
                            size={18}
                            weight="fill"
                            className="mt-0.5 shrink-0 text-warning-600"
                        />
                        <p className="text-caption text-neutral-600">
                            {t("myMentors.manageDialog.noAvailability")}
                        </p>
                    </div>
                ) : pageQuery.isLoading ? (
                    <p className="text-caption text-neutral-500">
                        {t("myMentors.manageDialog.loadingTimes")}
                    </p>
                ) : pageQuery.isError || !pageQuery.data ? (
                    <div className="flex flex-col items-start gap-2 rounded-lg border border-danger-100 bg-danger-50 p-3">
                        <p className="text-caption text-danger-600">
                            {t("myMentors.manageDialog.loadAvailabilityFailed")}
                        </p>
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            onClick={() => pageQuery.refetch()}
                        >
                            {t("myMentors.common.retry")}
                        </MyButton>
                    </div>
                ) : (
                    <SlotPicker
                        instituteId={instituteId ?? ""}
                        slug={mentorSlug}
                        pageTimezone={pageQuery.data.timezone}
                        bookingHorizonDays={pageQuery.data.booking_horizon_days}
                        onSelect={(slotIso, tz) => {
                            setSlot(slotIso);
                            setPickerTz(tz);
                        }}
                        selectedSlot={slot}
                        browserTimezone={browserTz}
                        tz={pickerTz}
                        onTzChange={setPickerTz}
                        weekOffset={weekOffset}
                        onWeekOffsetChange={setWeekOffset}
                        selectedDayKey={selectedDayKey}
                        onSelectedDayKeyChange={setSelectedDayKey}
                        duration={session.duration_minutes ?? undefined}
                    />
                )}
            </div>
        </MyDialog>
    );
}
