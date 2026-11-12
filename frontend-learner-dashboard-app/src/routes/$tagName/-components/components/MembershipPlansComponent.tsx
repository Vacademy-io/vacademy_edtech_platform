import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Books, CalendarCheck, ShieldCheck, WarningCircle } from "@phosphor-icons/react";
import { INSTITUTE_ID } from "@/constants/urls";
import { PriceWithMrp, formatPriceAmount } from "@/components/common/price-with-mrp";
import { useHidePaidPurchaseUI } from "@/utils/ios-iap-compliance";
import { getMembershipPlans, type MembershipPlan } from "../../-services/membership-plan-service";
import { RouteMatcher } from "../../-services/route-matcher";
import { useCartStore } from "../../-stores/cart-store";
import type { GlobalSettings } from "../../-types/course-catalogue-types";
import { resolveRentModeCharges } from "../../-utils/additional-charges-util";
import { setCatalogueMode } from "../../-utils/catalogue-mode";
import { useSiteNavigate } from "../../-utils/catalogue-route-search";
import { RentLocationConfirmDialog } from "./RentLocationConfirmDialog";
import {
  buildDepositNotes,
  sortMembershipPlans,
  toCartMembershipPlan,
  toMembershipPlanCard,
  type MembershipPlanCardModel,
} from "./membership-plans-utils";

/**
 * Catalogue section `membershipPlans`: the institute's membership (rent) plans — packages of type
 * MEMBERSHIP — as cards, read live. "Choose plan" asks the rent-location question; going on picks
 * the plan for the rent cart, switches the storefront to rent mode and opens the library page.
 * Visitors never see an empty section; the builder preview explains it.
 */
export interface MembershipPlansProps {
  heading?: string;
  subheading?: string;
  /** Page route the plan buttons open (the book catalogue). */
  targetRoute?: string;
  /** Level name of rent mode in the catalogue. */
  rentLevelFilterValue?: string;
  /** Level name of buy mode ("Buy instead" in the location dialog). */
  buyLevelFilterValue?: string;
  /** The rent-mode charges line (e.g. security deposit) under the cards. */
  showDepositNote?: boolean;
  instituteId?: string;
  tagName?: string;
  globalSettings?: GlobalSettings;
  isPreviewMode?: boolean;
}

const DEFAULT_TARGET_ROUTE = "library";
const DEFAULT_RENT_LEVEL = "Rent";
const DEFAULT_BUY_LEVEL = "Buy";
const SKELETON_CARDS = 3;
const NO_PLANS: MembershipPlan[] = [];

export const MembershipPlansComponent: React.FC<MembershipPlansProps> = ({
  heading,
  subheading,
  targetRoute,
  rentLevelFilterValue,
  buyLevelFilterValue,
  showDepositNote = true,
  instituteId,
  tagName,
  globalSettings,
  isPreviewMode = false,
}) => {
  const { t } = useTranslation("coursePlayerB");
  const location = useLocation();
  const siteNavigate = useSiteNavigate();
  const setMembershipPlan = useCartStore((s) => s.setMembershipPlan);
  const hidePurchase = useHidePaidPurchaseUI();
  const [pendingPlan, setPendingPlan] = useState<MembershipPlan | null>(null);

  const effectiveInstituteId = instituteId || INSTITUTE_ID;
  const currentTagName = tagName || location.pathname.split("/").filter(Boolean)[0] || "";

  const {
    data: plans = NO_PLANS,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["STOREFRONT_MEMBERSHIP_PLANS", effectiveInstituteId],
    queryFn: () => getMembershipPlans(effectiveInstituteId),
    enabled: !!effectiveInstituteId && !hidePurchase,
    staleTime: 60_000,
  });

  const sortedPlans = useMemo(() => sortMembershipPlans(plans), [plans]);
  const depositNotes = useMemo(
    () => (showDepositNote ? buildDepositNotes(resolveRentModeCharges(globalSettings), globalSettings) : []),
    [showDepositNote, globalSettings],
  );

  const openTarget = () => {
    void siteNavigate(RouteMatcher.pagePath(currentTagName, targetRoute || DEFAULT_TARGET_ROUTE));
  };

  const handleContinue = () => {
    const plan = pendingPlan;
    setPendingPlan(null);
    if (!plan) return;
    // The editor preview shows the flow without touching the admin's own cart.
    if (!isPreviewMode) {
      setMembershipPlan(toCartMembershipPlan(plan));
      setCatalogueMode(rentLevelFilterValue || DEFAULT_RENT_LEVEL);
    }
    openTarget();
  };

  const handleBuyInstead = () => {
    setPendingPlan(null);
    if (!isPreviewMode) setCatalogueMode(buyLevelFilterValue || DEFAULT_BUY_LEVEL);
    openTarget();
  };

  // Commerce is hidden on Apple-store builds; a plan list without prices or a CTA means nothing.
  if (hidePurchase || !effectiveInstituteId) return null;

  if (!isLoading && !isError && sortedPlans.length === 0) {
    return isPreviewMode ? (
      <section className="catalogue-section bg-catalogue-bg">
        <div className="catalogue-shell">
          <div className="catalogue-card border-dashed p-card-lg text-center text-sm text-catalogue-text-muted">
            {t("membershipPlans.emptyPreview")}
          </div>
        </div>
      </section>
    ) : null;
  }

  const resolvedHeading = heading ?? t("membershipPlans.defaultHeading");
  const depositCurrency = sortedPlans[0]?.currency;

  return (
    <section className="catalogue-section bg-catalogue-bg">
      <div className="catalogue-shell">
        {(resolvedHeading || subheading) && (
          <div className="catalogue-section-header text-center">
            {resolvedHeading && <h2 className="catalogue-h2">{resolvedHeading}</h2>}
            {subheading && <p className="catalogue-lead catalogue-measure">{subheading}</p>}
          </div>
        )}

        {isError ? (
          <div
            role="alert"
            className="catalogue-card mx-auto flex max-w-md flex-col items-center gap-stack p-card-lg text-center"
          >
            <WarningCircle className="size-8 text-danger-500" aria-hidden />
            <p className="text-sm text-catalogue-text-secondary">{t("membershipPlans.loadError")}</p>
            <button
              type="button"
              className="catalogue-btn catalogue-btn-secondary catalogue-btn-sm"
              onClick={() => void refetch()}
              disabled={isFetching}
            >
              {t("membershipPlans.retry")}
            </button>
          </div>
        ) : (
          <div
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:gap-6 lg:grid-cols-3"
            aria-busy={isLoading || undefined}
          >
            {isLoading
              ? Array.from({ length: SKELETON_CARDS }).map((_, i) => <PlanCardSkeleton key={i} />)
              : sortedPlans.map((plan) => (
                  <PlanCard
                    key={plan.id}
                    card={toMembershipPlanCard(plan)}
                    onChoose={() => setPendingPlan(plan)}
                  />
                ))}
          </div>
        )}

        {!isLoading && !isError && depositNotes.length > 0 && (
          <div className="mt-6 flex flex-col items-center gap-1">
            {depositNotes.map((note) => (
              <p
                key={note.key}
                className="flex items-center gap-2 text-center text-sm text-catalogue-text-muted"
              >
                <ShieldCheck className="size-4 shrink-0" aria-hidden />
                {t(note.i18nKey, {
                  amount: formatPriceAmount(note.amount, depositCurrency),
                  label: note.label,
                })}
              </p>
            ))}
          </div>
        )}
      </div>

      <RentLocationConfirmDialog
        open={!!pendingPlan}
        onCancel={() => setPendingPlan(null)}
        onContinue={handleContinue}
        onBuyInstead={handleBuyInstead}
      />
    </section>
  );
};

const PlanCard: React.FC<{ card: MembershipPlanCardModel; onChoose: () => void }> = ({ card, onChoose }) => {
  const { t } = useTranslation("coursePlayerB");
  const unlimited = t("membershipPlans.unlimited");
  return (
    <article className="catalogue-card-elevated flex h-full flex-col gap-stack p-card-lg">
      <h3 className="text-lg font-semibold text-catalogue-text-primary">
        {card.name || t("membershipPlans.defaultName")}
      </h3>
      <PriceWithMrp
        actual={card.price}
        elevated={card.elevatedPrice}
        currency={card.currency}
        size="lg"
        freeForZero={false}
      />
      <dl className="flex flex-col gap-2 border-t border-catalogue-border-subtle pt-3 text-sm">
        <PlanLimit
          icon={<Books className="size-4 shrink-0 text-catalogue-brand-ink" aria-hidden />}
          label={t("membershipPlans.booksAtOnce")}
          value={card.booksAtOnce ?? unlimited}
        />
        <PlanLimit
          icon={<CalendarCheck className="size-4 shrink-0 text-catalogue-brand-ink" aria-hidden />}
          label={t("membershipPlans.booksPerPeriod")}
          value={card.booksPerPeriod ?? unlimited}
        />
      </dl>
      <button
        type="button"
        className="catalogue-btn catalogue-btn-primary mt-auto w-full"
        onClick={onChoose}
      >
        {t("membershipPlans.choosePlan")}
      </button>
    </article>
  );
};

const PlanLimit: React.FC<{ icon: React.ReactNode; label: string; value: React.ReactNode }> = ({
  icon,
  label,
  value,
}) => (
  <div className="flex items-center justify-between gap-2">
    <dt className="flex items-center gap-2 text-catalogue-text-secondary">
      {icon}
      {label}
    </dt>
    <dd className="font-semibold text-catalogue-text-primary">{value}</dd>
  </div>
);

const PlanCardSkeleton: React.FC = () => (
  <div className="catalogue-card flex flex-col gap-stack p-card-lg">
    <div className="catalogue-skeleton catalogue-skeleton-title w-2/3" />
    <div className="catalogue-skeleton h-8 w-1/3" />
    <div className="catalogue-skeleton catalogue-skeleton-text" />
    <div className="catalogue-skeleton catalogue-skeleton-text w-5/6" />
    <div className="catalogue-skeleton mt-2 h-control w-full" />
  </div>
);

export default MembershipPlansComponent;
