import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle,
  CreditCard,
  Info,
  Warning,
} from "@phosphor-icons/react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DEFAULT_MANDATE_METHOD,
  MandateMethodPicker,
  type MandateMethod,
} from "@/components/common/subscription/MandateMethodPicker";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  PLAN_CHANGE_OPTIONS_QUERY_KEY,
  fetchPlanChangeOptions,
  type PlanChangeTarget,
  type Subscription,
} from "@/components/common/user-profile/payment-billing/subscription-services";

interface ChangePlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscription: Subscription | null;
  instituteId: string | null;
  /** Resolves once the change has been booked (or the checkout opened). */
  onConfirm: (
    target: PlanChangeTarget,
    withAutopay: boolean,
    mandateMethod: MandateMethod
  ) => Promise<unknown>;
  isSubmitting?: boolean;
  /**
   * Opens with this plan already chosen. Used when the learner is resuming a change they
   * abandoned at checkout: the request is re-made from scratch (the old gateway order is
   * long gone), so the least they should have to do is not pick the plan again.
   */
  preselectPlanId?: string | null;
}

const formatPrice = (amount?: number | null, currency?: string | null): string => {
  if (amount == null) return "";
  const symbol = (currency ?? "INR").toUpperCase() === "INR" ? "₹" : `${currency} `;
  return `${symbol}${amount % 1 === 0 ? amount.toFixed(0) : amount.toFixed(2)}`;
};

/**
 * UTC-anchored like every other date in this flow: end/charge timestamps are stored UTC
 * and the renewal sweep runs on the UTC date, so rendering locally shifted late-evening
 * dates to the next day.
 */
const formatDate = (value?: string | null): string | null => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
};

const parseFeatures = (featureJson?: string | null): string[] => {
  if (!featureJson) return [];
  try {
    const parsed = JSON.parse(featureJson);
    return Array.isArray(parsed) ? parsed.filter((f) => typeof f === "string") : [];
  } catch {
    return [];
  }
};

/**
 * The learner's "switch to another plan" picker, shared by the dashboard membership
 * widget, the profile billing section and the public /subscriptions page.
 *
 * Targets are grouped by payment option so a cross-option move reads as "move to Gold"
 * rather than as a flat list of prices — the option is the thing a learner recognises,
 * the plan inside it is just the billing cadence.
 *
 * Every price shown comes from the server, already prorated for this learner at this
 * moment. Nothing here computes money.
 */
export function ChangePlanDialog({
  open,
  onOpenChange,
  subscription,
  instituteId,
  onConfirm,
  isSubmitting = false,
  preselectPlanId = null,
}: ChangePlanDialogProps) {
  const { t } = useTranslation("dashboard");
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [alsoEnableAutopay, setAlsoEnableAutopay] = useState(false);
  const [mandateMethod, setMandateMethod] = useState<MandateMethod>(DEFAULT_MANDATE_METHOD);

  const userPlanId = subscription?.user_plan_id ?? null;

  const { data, isLoading, isError } = useQuery({
    queryKey: [PLAN_CHANGE_OPTIONS_QUERY_KEY, instituteId, userPlanId],
    queryFn: () => fetchPlanChangeOptions(instituteId as string, userPlanId as string),
    enabled: open && Boolean(instituteId) && Boolean(userPlanId),
  });

  // Reset the choice whenever a different membership is opened, so a selection never
  // carries over onto a plan it was not made for.
  useEffect(() => {
    if (!open) return;
    setSelectedPlanId(null);
    setAlsoEnableAutopay(false);
    setMandateMethod(DEFAULT_MANDATE_METHOD);
  }, [open, userPlanId]);

  const targets = useMemo(() => data?.targets ?? [], [data]);

  // Applied after the targets land, not in the reset effect above: the preselected plan
  // has to actually be on offer, and it may have stopped being so since the abandoned
  // attempt. Only fills an empty selection, so it never fights a later choice.
  useEffect(() => {
    if (!open || !preselectPlanId) return;
    if (!targets.some((target) => target.plan_id === preselectPlanId)) return;
    setSelectedPlanId((current) => current ?? preselectPlanId);
  }, [open, preselectPlanId, targets]);

  /** Grouped by option, preserving the server's ordering (shortest cycle first). */
  const grouped = useMemo(() => {
    const byOption = new Map<string, { name: string; targets: PlanChangeTarget[] }>();
    targets.forEach((target) => {
      const key = target.payment_option_id;
      const existing = byOption.get(key);
      if (existing) {
        existing.targets.push(target);
      } else {
        byOption.set(key, {
          name: target.option_name || t("membership.title"),
          targets: [target],
        });
      }
    });
    return Array.from(byOption.entries()).map(([id, group]) => ({ id, ...group }));
  }, [targets, t]);

  const selected = targets.find((target) => target.plan_id === selectedPlanId) ?? null;
  const isUpgrade = selected?.effective_type === "IMMEDIATE";
  // Re-authorising the mandate is not optional when the backend says the current one
  // cannot carry the new plan, so the checkbox is forced on and locked rather than
  // letting the learner opt out into a silently broken auto-pay.
  const autopayForced = Boolean(selected?.requires_mandate_reauth);
  const autopayChecked = autopayForced || alsoEnableAutopay;

  const handleConfirm = async () => {
    if (!selected) return;
    const result = await onConfirm(selected, autopayChecked, mandateMethod);
    if (result) {
      onOpenChange(false);
      if (!isUpgrade) {
        const date = formatDate(selected.effective_from);
        toast.success(t("membership.planChangeScheduledToast"), {
          description: date
            ? t("membership.planChangeScheduledToastBody", {
                plan: selected.plan_name,
                date,
              })
            : undefined,
        });
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-screen-80 overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("membership.changePlanTitle")}</DialogTitle>
          <DialogDescription>
            {data?.current_plan_name
              ? t("membership.changePlanSubtitle", { plan: data.current_plan_name })
              : t("membership.changePlanSubtitleNoPlan")}
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="space-y-3 py-2">
            <Skeleton className="h-20 w-full rounded-lg" />
            <Skeleton className="h-20 w-full rounded-lg" />
          </div>
        )}

        {!isLoading && isError && (
          <div className="flex items-start gap-2 rounded-lg bg-danger-50 p-3 text-caption text-danger-600">
            <Warning className="mt-0.5 size-4 shrink-0" weight="fill" />
            <span>{t("membership.changePlanLoadFailed")}</span>
          </div>
        )}

        {!isLoading && !isError && targets.length === 0 && (
          <div className="flex items-start gap-2 rounded-lg bg-muted p-3 text-caption text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" weight="duotone" />
            <span>{t("membership.changePlanNoOptions")}</span>
          </div>
        )}

        {!isLoading && !isError && targets.length > 0 && (
          <div className="space-y-4 py-1">
            {grouped.map((group) => (
              <div key={group.id} className="space-y-2">
                {grouped.length > 1 && (
                  <p className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">
                    {group.name}
                  </p>
                )}
                {group.targets.map((target) => {
                  const isSelected = target.plan_id === selectedPlanId;
                  const immediate = target.effective_type === "IMMEDIATE";
                  const features = parseFeatures(target.feature_json);
                  const effectiveDate = formatDate(target.effective_from);

                  return (
                    <button
                      key={target.plan_id}
                      type="button"
                      onClick={() => setSelectedPlanId(target.plan_id)}
                      className={cn(
                        "w-full rounded-lg border p-3 text-left transition-colors",
                        isSelected
                          ? "border-primary-400 bg-primary-50"
                          : "border-border bg-card hover:border-primary-200"
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-body font-semibold text-foreground">
                              {target.plan_name}
                            </span>
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-caption font-semibold",
                                immediate
                                  ? "bg-success-50 text-success-600"
                                  : "bg-muted text-muted-foreground"
                              )}
                            >
                              {immediate ? (
                                <ArrowUp size={12} weight="bold" />
                              ) : (
                                <ArrowDown size={12} weight="bold" />
                              )}
                              {immediate
                                ? t("membership.planChangeUpgrade")
                                : t("membership.planChangeDowngrade")}
                            </span>
                          </div>
                          <p className="mt-0.5 text-caption text-muted-foreground">
                            {target.validity_in_days
                              ? t("membership.planChangeCadence", {
                                  price: formatPrice(target.price, target.currency),
                                  days: target.validity_in_days,
                                })
                              : formatPrice(target.price, target.currency)}
                          </p>
                        </div>
                        {isSelected && (
                          <CheckCircle
                            className="size-5 shrink-0 text-primary-400"
                            weight="fill"
                          />
                        )}
                      </div>

                      {/* The one line that decides for the learner: what they pay and when it starts. */}
                      <p className="mt-2 text-caption font-medium text-foreground">
                        {immediate
                          ? t("membership.planChangePayNow", {
                              amount: formatPrice(
                                target.amount_due_now,
                                target.currency
                              ),
                            })
                          : effectiveDate
                            ? t("membership.planChangeFreeOn", { date: effectiveDate })
                            : t("membership.planChangeFreeAtCycleEnd")}
                      </p>

                      {/* Say which of the two quotes this is: the difference against the plan
                          being traded in, or the target bought outright (a trial or a lapsed
                          plan has nothing to trade). */}
                      {immediate && target.trade_in_applied && (target.proration_credit ?? 0) > 0 && (
                        <p className="mt-0.5 text-caption text-success-600">
                          {t("membership.planChangeCredit", {
                            amount: formatPrice(
                              target.proration_credit,
                              target.currency
                            ),
                            days: target.extension_days ?? 0,
                          })}
                        </p>
                      )}
                      {immediate && !target.trade_in_applied && (
                        <p className="mt-0.5 text-caption text-muted-foreground">
                          {t("membership.planChangeFullPrice", {
                            days: target.extension_days ?? target.validity_in_days ?? 0,
                          })}
                        </p>
                      )}

                      {target.requires_mandate_reauth && (
                        <p className="mt-1 flex items-start gap-1.5 text-caption text-warning-600">
                          <Warning className="mt-0.5 size-3.5 shrink-0" weight="fill" />
                          {t("membership.planChangeMandateReauth")}
                        </p>
                      )}

                      {features.length > 0 && (
                        <ul className="mt-2 space-y-0.5">
                          {features.slice(0, 4).map((feature) => (
                            <li
                              key={feature}
                              className="flex items-start gap-1.5 text-caption text-muted-foreground"
                            >
                              <CheckCircle
                                className="mt-0.5 size-3 shrink-0 text-success-600"
                                weight="fill"
                              />
                              {feature}
                            </li>
                          ))}
                        </ul>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}

            {isUpgrade && subscription?.autopay_available && (
              <label
                className={cn(
                  "flex items-start gap-2 text-caption",
                  autopayForced
                    ? "cursor-default text-foreground"
                    : "cursor-pointer text-foreground"
                )}
              >
                <Checkbox
                  className="mt-0.5"
                  checked={autopayChecked}
                  disabled={autopayForced}
                  onCheckedChange={(checked) => setAlsoEnableAutopay(checked === true)}
                />
                <span>
                  {autopayForced
                    ? t("membership.planChangeAutopayRequired")
                    : t("membership.alsoEnableAutopay")}
                </span>
              </label>
            )}
            {/* A recurring order is bound to one authorisation method, so the pick must
                happen before the order exists — same as the enrol form. */}
            {isUpgrade && subscription?.autopay_available && autopayChecked && (
              <MandateMethodPicker
                value={mandateMethod}
                onChange={setMandateMethod}
                disabled={isSubmitting}
              />
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            {t("membership.planChangeCancel")}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!selected || isSubmitting}
            className="gap-2"
          >
            {isUpgrade && <CreditCard size={16} weight="duotone" />}
            {isSubmitting
              ? t("membership.startingPayment")
              : isUpgrade
                ? t("membership.planChangeConfirmPay", {
                    amount: formatPrice(selected?.amount_due_now, selected?.currency),
                  })
                : t("membership.planChangeConfirmSchedule")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
