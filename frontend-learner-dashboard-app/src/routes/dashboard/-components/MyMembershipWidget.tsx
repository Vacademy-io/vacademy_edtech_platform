import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { formatInTimeZone } from "date-fns-tz";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { getInstituteId } from "@/constants/helper";
import { GET_BATCH_LIST, urlPublicCourseDetails, urlInstituteDetails } from "@/constants/urls";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { cn } from "@/lib/utils";
import {
    ArrowsClockwise,
    BookOpen,
    CheckCircle,
    CreditCard,
    Crown,
    ShieldCheck,
    Warning,
} from "@phosphor-icons/react";
import { useCleanerPlayTheme } from "@/hooks/use-cleaner-play-theme";
import iconShop from "@/assets/cleaner-play/icon-shop.webp";
import { shouldHidePaidPurchaseUI } from "@/utils/ios-iap-compliance";
import {
    RazorpayCheckoutForm,
    type RazorpayCheckoutFormRef,
} from "@/components/common/enroll-by-invite/-components/razorpay-checkout-form";
import {
    isPlanChangeAwaitingPayment,
    useSubscriptionManager,
    type Subscription,
} from "@/hooks/use-subscription-manager";
import { ChangePlanDialog } from "@/components/common/subscription/ChangePlanDialog";
import {
    DEFAULT_MANDATE_METHOD,
    MandateMethodPicker,
    type MandateMethod,
} from "@/components/common/subscription/MandateMethodPicker";

interface MyMembershipWidgetProps {
    className?: string;
}

/**
 * "My Membership" — the learner's own plan, not a catalogue listing.
 *
 * Primary source is the subscription API (the same UserPlan rows the public
 * /subscriptions/<username> page shows), because that is the only place that
 * knows the real access-until date, the next auto-deduction, and whether a
 * mandate can be revoked. It answers three questions on the dashboard:
 *   • which membership am I on
 *   • until when is it active
 *   • how do I stop it (or pay, when a renewal is due)
 *
 * FALLBACK: institutes that enroll learners without UserPlan rows have no
 * subscriptions at all. For them the widget keeps its previous behaviour —
 * listing the MEMBERSHIP-type packages the learner is enrolled in — so nothing
 * regresses. That legacy path is `EnrolledMembershipPackages` below.
 */
export const MyMembershipWidget: React.FC<MyMembershipWidgetProps> = ({ className }) => {
    const { t } = useTranslation("dashboard");
    const isCleanerPlay = useCleanerPlayTheme();
    const [instituteId, setInstituteId] = useState<string | null>(null);
    // Distinguishes "still resolving" from "genuinely no institute" — without
    // it a learner whose institute never resolves sits on the skeleton forever.
    const [instituteResolved, setInstituteResolved] = useState(false);
    const razorpayRef = useRef<RazorpayCheckoutFormRef>(null);
    const [toCancel, setToCancel] = useState<Subscription | null>(null);
    const [toChange, setToChange] = useState<Subscription | null>(null);
    // Per-plan "also re-enable auto-pay" choice. Default off: auto-pay being
    // off usually means the learner turned it off deliberately.
    const [autopayChoice, setAutopayChoice] = useState<Record<string, boolean>>({});
    // UPI vs card for the re-registered mandate; only read when autopayChoice is on.
    const [mandateMethodChoice, setMandateMethodChoice] = useState<Record<string, MandateMethod>>({});

    useEffect(() => {
        let cancelled = false;
        getInstituteId()
            .then((id) => {
                if (cancelled) return;
                setInstituteId(id ?? null);
                setInstituteResolved(true);
            })
            .catch(() => {
                if (cancelled) return;
                setInstituteId(null);
                setInstituteResolved(true);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const {
        subscriptions,
        isLoading,
        isError,
        cancel,
        isCancelling,
        startRenewal,
        renewingPlanId,
        startPlanChange,
        changingPlanId,
        cancelPlanChange,
        isCancellingPlanChange,
        refetchSoon,
    } = useSubscriptionManager({
        instituteId,
        scope: "dashboard-widget",
        onCheckout: (payload) => razorpayRef.current?.openPayment(payload),
    });

    // Reader mode: "My Membership" + renewal dates + a pay button read as a paid
    // subscription surface to App Review (Apple 3.1.1) — hide it entirely.
    if (shouldHidePaidPurchaseUI()) {
        return null;
    }

    const confirmCancel = async () => {
        if (!toCancel) return;
        try {
            const updated = await cancel(toCancel.user_plan_id);
            const until = formatDate(updated.end_date);
            toast.success(t("membership.stoppedToast"), {
                description: until
                    ? t("membership.stoppedToastBody", { date: until })
                    : t("membership.stoppedToastBodyNoDate"),
            });
            setToCancel(null);
        } catch {
            toast.error(t("membership.stopFailedToast"), {
                description: t("membership.tryAgain"),
            });
        }
    };

    if (!instituteResolved || (Boolean(instituteId) && isLoading)) {
        return (
            <Card className={cn("border border-border shadow-sm bg-card", "cp-card", className)}>
                <CardHeader className="pb-2">
                    <Skeleton className="h-5 w-32" />
                </CardHeader>
                <CardContent>
                    <Skeleton className="h-16 w-full rounded-lg" />
                </CardContent>
            </Card>
        );
    }

    // No UserPlan rows (or the endpoint is unavailable): fall back to the
    // enrolled-packages view so institutes that don't use plans keep a widget.
    if (isError || subscriptions.length === 0) {
        return <EnrolledMembershipPackages className={className} />;
    }

    return (
        <Card className={cn("border border-border shadow-sm bg-card", "cp-card", className)}>
            <MembershipCardHeader isCleanerPlay={isCleanerPlay} t={t} />
            <CardContent className="p-card pt-0 space-y-3">
                {subscriptions.map((sub) => {
                    const accessUntil = formatDate(sub.end_date);
                    const nextCharge = formatDate(sub.next_charge_at);
                    const autopayOn = sub.has_active_mandate && sub.status !== "CANCELED";
                    const paymentFailed = sub.status === "PAYMENT_FAILED";
                    const lapsed = sub.status === "EXPIRED" || paymentFailed;
                    const canRenew = sub.can_renew_manually && sub.plan_price != null;
                    const price = formatPrice(sub.plan_price, sub.currency);
                    // An open change is either a booking that will apply by itself or an
                    // abandoned checkout that needs a decision. They read nothing alike.
                    const openChange = sub.scheduled_plan_change;
                    const awaitingPaymentChange = isPlanChangeAwaitingPayment(openChange)
                        ? openChange
                        : null;
                    const bookedChange = awaitingPaymentChange ? null : openChange;

                    return (
                        <div
                            key={sub.user_plan_id}
                            className="space-y-3 rounded-lg border border-border bg-card p-3 shadow-sm"
                        >
                            {/* Plan name + status chip */}
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <h3 className="truncate text-base font-bold text-foreground">
                                            {sub.plan_name ?? t("membership.title")}
                                        </h3>
                                        {sub.is_trial && (
                                            <span className="rounded-full bg-secondary-100 px-2 py-0.5 text-caption font-semibold text-secondary-500">
                                                {t("membership.trial")}
                                            </span>
                                        )}
                                    </div>
                                    {/* THE answer to "until when is it active" */}
                                    <p className="mt-0.5 text-caption text-muted-foreground">
                                        {lapsed
                                            ? accessUntil
                                                ? t("membership.accessEnded", { date: accessUntil })
                                                : t("membership.statusExpired")
                                            : accessUntil
                                              ? t("membership.activeUntil", { date: accessUntil })
                                              : t("membership.activeNoEndDate")}
                                    </p>
                                </div>
                                <span
                                    className={cn(
                                        "shrink-0 rounded-full px-2.5 py-1 text-caption font-semibold",
                                        lapsed
                                            ? "bg-danger-50 text-danger-600"
                                            : autopayOn
                                              ? "bg-success-50 text-success-600"
                                              : "bg-muted text-muted-foreground"
                                    )}
                                >
                                    {paymentFailed
                                        ? t("membership.statusPaymentFailed")
                                        : sub.status === "EXPIRED"
                                          ? t("membership.statusExpired")
                                          : autopayOn
                                            ? t("membership.statusAutoRenews")
                                            : t("membership.statusEnding")}
                                </span>
                            </div>

                            {/* Auto-pay ON: when the next deduction happens + how to stop it */}
                            {autopayOn && (
                                <>
                                    {price && (
                                        <p className="text-caption text-foreground">
                                            {nextCharge
                                                ? t("membership.nextPayment", {
                                                      amount: price,
                                                      date: nextCharge,
                                                  })
                                                : t("membership.nextPaymentNoDate", { amount: price })}
                                        </p>
                                    )}
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <span className="flex items-center gap-1.5 text-caption text-muted-foreground">
                                            <ShieldCheck size={14} weight="duotone" />
                                            {t("membership.cancelAnytime")}
                                        </span>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setToCancel(sub)}
                                            className="gap-1.5"
                                        >
                                            <ArrowsClockwise size={14} weight="duotone" />
                                            {t("membership.stopAutoPay")}
                                        </Button>
                                    </div>
                                </>
                            )}

                            {/* Auto-pay already stopped, still inside the paid period */}
                            {!autopayOn && !lapsed && (
                                <div className="flex items-start gap-2 rounded-lg bg-success-50 p-3 text-caption text-success-600">
                                    <CheckCircle className="mt-0.5 size-4 shrink-0" weight="fill" />
                                    <span>
                                        {accessUntil
                                            ? t("membership.autoPayOff", { date: accessUntil })
                                            : t("membership.autoPayOffNoDate")}
                                    </span>
                                </div>
                            )}

                            {paymentFailed && (
                                <div className="flex items-start gap-2 rounded-lg bg-warning-50 p-3 text-caption text-warning-600">
                                    <Warning className="mt-0.5 size-4 shrink-0" weight="fill" />
                                    <span>{t("membership.paymentFailedBody")}</span>
                                </div>
                            )}

                            {/* A checkout the learner opened and never paid. Shown in warning
                                colours with both ways out, because it blocks a second attempt
                                until it is finished or dropped. */}
                            {awaitingPaymentChange && (
                                <div className="flex items-start gap-2 rounded-lg bg-warning-50 p-3 text-caption text-warning-600">
                                    <Warning className="mt-0.5 size-4 shrink-0" weight="fill" />
                                    <div className="min-w-0 flex-1">
                                        <span>
                                            {awaitingPaymentChange.amount_due_now != null
                                                ? t("membership.planChangeAwaitingPayment", {
                                                      plan: awaitingPaymentChange.to_plan_name,
                                                      amount: formatPrice(
                                                          awaitingPaymentChange.amount_due_now,
                                                          awaitingPaymentChange.currency ??
                                                              sub.currency
                                                      ),
                                                  })
                                                : t(
                                                      "membership.planChangeAwaitingPaymentNoAmount",
                                                      {
                                                          plan: awaitingPaymentChange.to_plan_name,
                                                      }
                                                  )}
                                        </span>
                                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                                            <Button
                                                size="sm"
                                                onClick={() => setToChange(sub)}
                                                disabled={changingPlanId === sub.user_plan_id}
                                                className="gap-1.5"
                                            >
                                                <CreditCard size={14} weight="duotone" />
                                                {t("membership.planChangeCompletePayment")}
                                            </Button>
                                            <Button
                                                variant="link"
                                                size="sm"
                                                className="h-auto p-0 text-caption"
                                                disabled={isCancellingPlanChange}
                                                onClick={() =>
                                                    cancelPlanChange(sub.user_plan_id)
                                                }
                                            >
                                                {t("membership.planChangeDiscard")}
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* A downgrade already booked. Without this the card would keep
                                claiming the old plan right up until the renewal swaps it. */}
                            {bookedChange && (
                                <div className="flex items-start gap-2 rounded-lg bg-info-50 p-3 text-caption text-info-600">
                                    <ArrowsClockwise
                                        className="mt-0.5 size-4 shrink-0"
                                        weight="duotone"
                                    />
                                    <div className="min-w-0 flex-1">
                                        <span>
                                            {formatDate(
                                                bookedChange?.effective_from
                                            )
                                                ? t("membership.planChangeScheduled", {
                                                      plan: bookedChange?.to_plan_name,
                                                      date: formatDate(
                                                          bookedChange?.effective_from
                                                      ),
                                                  })
                                                : t("membership.planChangeScheduledNoDate", {
                                                      plan: bookedChange?.to_plan_name,
                                                  })}
                                        </span>
                                        <Button
                                            variant="link"
                                            size="sm"
                                            className="h-auto p-0 text-caption"
                                            disabled={isCancellingPlanChange}
                                            onClick={() =>
                                                cancelPlanChange(sub.user_plan_id)
                                            }
                                        >
                                            {t("membership.planChangeCancelScheduled")}
                                        </Button>
                                    </div>
                                </div>
                            )}

                            {/* Switch plan. Hidden unless the institute has flagged at least
                                one other plan as switchable for this membership. */}
                            {sub.can_change_plan && !openChange && (
                                <div className="flex justify-end">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setToChange(sub)}
                                        disabled={changingPlanId === sub.user_plan_id}
                                        className="gap-1.5"
                                    >
                                        <ArrowsClockwise size={14} weight="duotone" />
                                        {t("membership.changePlan")}
                                    </Button>
                                </div>
                            )}

                            {/* Never a membership — an abandoned or failed first checkout. There
                                is no access to extend, so the way forward is to finish enrolling,
                                not to renew (the server refuses a renewal here). */}
                            {sub.can_complete_enrollment && sub.enroll_invite_code && instituteId && (
                                <div className="space-y-2.5 rounded-lg border border-warning-200 bg-warning-50 p-3">
                                    <p className="text-caption text-foreground">
                                        {t("membership.completeEnrollmentPrompt")}
                                    </p>
                                    <div className="flex justify-end">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="gap-1.5"
                                            onClick={() =>
                                                window.location.assign(
                                                    `/learner-invitation-response?instituteId=${encodeURIComponent(
                                                        instituteId,
                                                    )}&inviteCode=${encodeURIComponent(
                                                        sub.enroll_invite_code ?? "",
                                                    )}`,
                                                )
                                            }
                                        >
                                            {t("membership.completeEnrollmentCta")}
                                        </Button>
                                    </div>
                                </div>
                            )}

                            {/* Pay-to-continue: offered whenever autopay won't charge this plan */}
                            {canRenew && (
                                <div className="space-y-2.5 rounded-lg border border-primary-100 bg-primary-50 p-3">
                                    <p className="text-caption text-foreground">
                                        {lapsed
                                            ? t("membership.reactivatePrompt")
                                            : accessUntil
                                              ? t("membership.renewPrompt", { date: accessUntil })
                                              : t("membership.renewPromptNoDate")}
                                    </p>
                                    {sub.autopay_available && !sub.instant_renewal && (
                                        <label className="flex cursor-pointer items-start gap-2 text-caption text-foreground">
                                            <Checkbox
                                                className="mt-0.5"
                                                checked={autopayChoice[sub.user_plan_id] ?? Boolean(sub.autopay_default)}
                                                onCheckedChange={(checked) =>
                                                    setAutopayChoice((prev) => ({
                                                        ...prev,
                                                        [sub.user_plan_id]: checked === true,
                                                    }))
                                                }
                                            />
                                            <span>{t("membership.alsoEnableAutopay")}</span>
                                        </label>
                                    )}
                                    {sub.autopay_available && !sub.instant_renewal
                                        && (autopayChoice[sub.user_plan_id] ?? Boolean(sub.autopay_default)) && (
                                        <MandateMethodPicker
                                            value={mandateMethodChoice[sub.user_plan_id] ?? DEFAULT_MANDATE_METHOD}
                                            onChange={(method) =>
                                                setMandateMethodChoice((prev) => ({
                                                    ...prev,
                                                    [sub.user_plan_id]: method,
                                                }))
                                            }
                                            disabled={renewingPlanId === sub.user_plan_id}
                                        />
                                    )}
                                    <Button
                                        size="sm"
                                        onClick={() =>
                                            startRenewal(
                                                sub,
                                                Boolean(
                                                    sub.autopay_available &&
                                                        !sub.instant_renewal &&
                                                        (autopayChoice[sub.user_plan_id] ??
                                                            sub.autopay_default)
                                                ),
                                                mandateMethodChoice[sub.user_plan_id] ?? DEFAULT_MANDATE_METHOD
                                            )
                                        }
                                        disabled={renewingPlanId === sub.user_plan_id}
                                        className="w-full gap-2"
                                    >
                                        <CreditCard size={16} weight="duotone" />
                                        {renewingPlanId === sub.user_plan_id
                                            ? t("membership.startingPayment")
                                            : t("membership.payToContinue", { amount: price })}
                                    </Button>
                                </div>
                            )}
                        </div>
                    );
                })}
            </CardContent>

            {/* Gateway checkout host — visually hidden (its built-in card UI shows a
                placeholder amount); the SDK's payment modal attaches to document.body,
                so hiding this wrapper doesn't affect the checkout itself. */}
            <div className="hidden">
                <RazorpayCheckoutForm
                    ref={razorpayRef}
                    error={null}
                    amount={0}
                    currency="INR"
                    onPaymentReady={() => {
                        toast.success(t("membership.paymentReceivedToast"), {
                            description: t("membership.paymentReceivedToastBody"),
                        });
                        refetchSoon();
                    }}
                    onError={(message) =>
                        toast.error(t("membership.paymentNotCompletedToast"), {
                            description: message,
                        })
                    }
                />
            </div>

            <ChangePlanDialog
                open={Boolean(toChange)}
                onOpenChange={(open) => {
                    if (!open) setToChange(null);
                }}
                subscription={toChange}
                instituteId={instituteId}
                isSubmitting={Boolean(changingPlanId)}
                preselectPlanId={toChange?.scheduled_plan_change?.to_plan_id ?? null}
                onConfirm={(target, withAutopay, mandateMethod) =>
                    startPlanChange(toChange as Subscription, target, withAutopay, mandateMethod)
                }
            />

            <Dialog
                open={Boolean(toCancel)}
                onOpenChange={(open) => {
                    if (!open) setToCancel(null);
                }}
            >
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Warning className="size-5 text-danger-500" weight="fill" />
                            {t("membership.confirmStopTitle")}
                        </DialogTitle>
                        <DialogDescription>
                            {formatDate(toCancel?.end_date)
                                ? t("membership.confirmStopBody", {
                                      plan: toCancel?.plan_name ?? t("membership.title"),
                                      date: formatDate(toCancel?.end_date),
                                  })
                                : t("membership.confirmStopBodyNoDate", {
                                      plan: toCancel?.plan_name ?? t("membership.title"),
                                  })}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2">
                        <Button
                            variant="outline"
                            onClick={() => setToCancel(null)}
                            disabled={isCancelling}
                        >
                            {t("membership.keepItOn")}
                        </Button>
                        <Button onClick={confirmCancel} disabled={isCancelling}>
                            {isCancelling
                                ? t("membership.stopping")
                                : t("membership.stopAutoPay")}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
};

/** Shared card header so both the subscription and legacy views look identical. */
function MembershipCardHeader({
    isCleanerPlay,
    t,
}: {
    isCleanerPlay: boolean;
    t: TFunction<"dashboard">;
}) {
    return (
        <CardHeader className="p-card pb-2">
            <CardTitle
                className={cn(
                    "text-sm font-bold flex items-center gap-2 text-primary uppercase",
                    "cp-heading [.ui-cleaner-play_&]:normal-case"
                )}
            >
                {isCleanerPlay ? (
                    <img src={iconShop} alt="" aria-hidden="true" className="h-9 w-9 object-contain" />
                ) : (
                    <Crown className="w-5 h-5" />
                )}
                {t("membership.title")}
            </CardTitle>
        </CardHeader>
    );
}

const formatPrice = (amount?: number | null, currency?: string | null): string => {
    if (amount == null) return "";
    const symbol = (currency ?? "INR").toUpperCase() === "INR" ? "₹" : `${currency} `;
    return `${symbol}${amount % 1 === 0 ? amount.toFixed(0) : amount.toFixed(2)}`;
};

/**
 * UTC-anchored: end/charge timestamps are stored UTC and the renewal sweep
 * charges on the UTC date. Rendering in the local timezone shifted
 * late-evening charges to the next day (message said 11 Aug, page said 12 Aug).
 */
const formatDate = (value?: string | null): string | null => {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return formatInTimeZone(d, "UTC", "d MMM yyyy");
};

// ── Legacy fallback ─────────────────────────────────────────────────────────

interface InstituteSession {
    id: string;
    session_name?: string;
}

interface BatchForSession {
    id?: string;
    session?: { id?: string } | null;
}

interface BatchGroup {
    batches?: { package_session_id?: string }[];
}

interface MembershipPackage {
    id?: string;
    package_name?: string;
    package_type?: string;
    package_session_id?: string;
    validity_in_days?: number;
    child_packages?: { id?: string; package_name?: string }[] | null;
}

/**
 * The pre-subscription view, kept for institutes with no UserPlan rows: the
 * MEMBERSHIP-type packages the learner is enrolled in, under the "Plan"
 * session. Note `validity_in_days` is the plan's CONFIGURED validity, not the
 * learner's remaining days — which is exactly why the subscription path above
 * is preferred whenever it has data.
 */
const EnrolledMembershipPackages: React.FC<MyMembershipWidgetProps> = ({ className }) => {
    const { t } = useTranslation("dashboard");
    const isCleanerPlay = useCleanerPlayTheme();
    const [loading, setLoading] = useState(true);
    const [memberships, setMemberships] = useState<MembershipPackage[]>([]);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const instituteId = await getInstituteId();
                if (!instituteId) return;

                // STEP 1: Fetch Institute details to find the "Plan" session
                const instResponse = await authenticatedAxiosInstance.get(`${urlInstituteDetails}/${instituteId}`);
                const sessions: InstituteSession[] = instResponse.data?.sessions || [];
                const batchesForSessions: BatchForSession[] =
                    instResponse.data?.batches_for_sessions || [];

                // Only condition we care about: session_name === "Plan" (case-insensitive, trimmed)
                const planSession = sessions.find(
                    (s) => (s?.session_name || "").trim().toLowerCase() === "plan"
                );

                if (!planSession) {
                    setLoading(false);
                    return;
                }

                // STEP 2: Map session_id to package_session_id
                // IMPORTANT: `session_id` (from institute sessions) ≠ `package_session_id` (from package_session table)
                // The `batches_for_sessions` array represents the package_session table data where:
                //   - batch.id = package_session_id (from DB table package_session)
                //   - batch.session.id = session_id (from DB table session)
                // We need to find all package_session_ids that correspond to the Plan session_id
                const planSessionId = planSession.id;

                const planPackageSessionIds = new Set<string>();

                // Preferred mapping: from institute details (if backend provides it)
                if (Array.isArray(batchesForSessions) && batchesForSessions.length > 0) {
                    batchesForSessions
                        .filter((b) => b?.session?.id === planSessionId)
                        .forEach((b) => {
                            if (b?.id) planPackageSessionIds.add(b.id);
                        });
                } else {
                    // Fallback mapping: batches-by-session API returns package_session_ids for a given sessionId
                    // This is required for institutes where details-non-batches returns batches_for_sessions: []
                    try {
                        const batchListResponse = await authenticatedAxiosInstance.get(GET_BATCH_LIST, {
                            params: { sessionId: planSessionId, instituteId },
                        });

                        const batchData = batchListResponse.data;
                        // Expected shapes seen in codebase: BatchData[] or { content: BatchData[] } etc.
                        const batchGroups: BatchGroup[] =
                            (Array.isArray(batchData) ? batchData : batchData?.content) || [];

                        batchGroups.forEach((group) => {
                            const batches = Array.isArray(group?.batches) ? group.batches : [];
                            batches.forEach((b) => {
                                if (b?.package_session_id) {
                                    planPackageSessionIds.add(b.package_session_id);
                                }
                            });
                        });
                    } catch {
                        // Silent fallback failure
                    }
                }

                // If no package_session_ids found for Plan session, exit early
                if (planPackageSessionIds.size === 0) {
                    setLoading(false);
                    return;
                }

                // STEP 3: Fetch Packages
                const pkgResponse = await authenticatedAxiosInstance.post(
                    urlPublicCourseDetails,
                    {
                        status: [],
                        level_ids: [],
                        faculty_ids: [],
                        search_by_name: "",
                        tag: [],
                        min_percentage_completed: 0,
                        max_percentage_completed: 0,
                        type: "PROGRESS",
                        sort_columns: { createdAt: "DESC" },
                    },
                    {
                        params: { instituteId, page: 0, size: 100 },
                    }
                );

                const allContent: MembershipPackage[] = pkgResponse.data?.content || [];

                // STEP 4: Filter memberships by package_type "MEMBERSHIP" and package_session_id
                // Only show memberships that belong to the Plan session (using mapped package_session_ids)
                const filtered = allContent.filter((pkg) => {
                    // Only condition we care about: package_type === "MEMBERSHIP" (case-insensitive, trimmed)
                    const packageType = (pkg.package_type || "").trim().toUpperCase();
                    const pkgSessionId = pkg.package_session_id;
                    // Filter: Must be MEMBERSHIP type AND belong to one of the Plan session's mapped package_session_ids
                    return packageType === "MEMBERSHIP" && pkgSessionId && planPackageSessionIds.has(pkgSessionId);
                });

                const unique = filtered.filter(
                    (pkg, index, self) =>
                        index === self.findIndex((p) => p.package_name === pkg.package_name)
                );

                setMemberships(unique);
            } catch {
                // Silently fail
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, []);

    if (loading) {
        return (
            <Card className={cn("border border-border shadow-sm bg-card", "cp-card", className)}>
                <CardHeader className="pb-2">
                    <Skeleton className="h-5 w-32" />
                </CardHeader>
                <CardContent>
                    <Skeleton className="h-16 w-full rounded-lg" />
                </CardContent>
            </Card>
        );
    }

    // Settled and empty: render nothing instead of an empty commerce shell
    if (memberships.length === 0) {
        return null;
    }

    return (
        <Card className={cn("border border-border shadow-sm bg-card", "cp-card", className)}>
            <MembershipCardHeader isCleanerPlay={isCleanerPlay} t={t} />
            <CardContent className="p-card pt-0 space-y-3">
                {memberships.map((membership, idx) => (
                    <div key={membership.id || idx} className="space-y-3">
                        {/* Membership Item */}
                        <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-card shadow-sm">
                            <div className="flex-1 min-w-0 pe-2">
                                <h3 className="font-bold text-base text-foreground truncate">
                                    {membership.package_name}
                                </h3>
                                <span className="text-caption text-primary/70 font-bold uppercase tracking-widest mt-0.5 inline-block">
                                    {t("membership.planActive")}
                                </span>
                            </div>
                            <div className="flex flex-col items-center justify-center min-w-12 p-1.5 rounded-md bg-primary/5 border border-primary/10">
                                <span className="text-lg font-bold text-primary leading-none">
                                    {membership.validity_in_days || 0}
                                </span>
                                <span className="text-caption font-bold text-primary/70 uppercase">
                                    {t("membership.daysRemaining")}
                                </span>
                            </div>
                        </div>

                        {/* Sub-packages (Books) */}
                        {membership.child_packages && membership.child_packages.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                                {membership.child_packages.map((child, cidx) => (
                                    <div key={child.id || cidx} className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-secondary/50 border border-border">
                                        <BookOpen className="w-3 h-3 text-muted-foreground" />
                                        <span className="text-caption font-medium text-foreground truncate max-w-32">
                                            {child.package_name}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                ))}
            </CardContent>
        </Card>
    );
};
