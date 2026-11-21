import { useState, useEffect, useMemo, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useProductPageStore } from '../-stores/product-page-store';
import { validateCoupon } from '../-services/product-page-service';

/**
 * Turns the API's message codes into something a parent can act on. Anything
 * unrecognised falls through to a plain refusal rather than leaking the code.
 */
const couponMessage = (t: (key: string) => string, code?: string): string => {
    switch (code) {
        case 'COUPON_BELOW_MIN_ITEMS':
            return t('cartStep.couponCard.errors.belowMinItems');
        case 'COUPON_EXPIRED':
            return t('cartStep.couponCard.errors.expired');
        case 'COUPON_NOT_STARTED':
            return t('cartStep.couponCard.errors.notStarted');
        case 'COUPON_LIMIT_REACHED':
            return t('cartStep.couponCard.errors.limitReached');
        case 'COUPON_EMAIL_RESTRICTED':
            return t('cartStep.couponCard.errors.emailRestricted');
        case 'COUPON_NOT_APPLICABLE':
            return t('cartStep.couponCard.errors.notApplicable');
        default:
            return t('cartStep.couponCard.invalidCoupon');
    }
};
import { PlanTiles } from './PlanTiles';
import { pushCartViewed, pushCouponApplied } from '@/components/common/enroll-by-invite/-utils/gtm';
import { useCouponsEnabled } from '@/components/common/coupon/use-coupons-enabled';
import { Tag, X, ArrowLeft, ArrowRight, CheckCircle, SpinnerGap } from "@phosphor-icons/react";
import { useCourseTerms } from "@/routes/$tagName/-utils/catalogue-naming";
import { cn } from '@/lib/utils';
import { CartItemList } from './CartItemList';
import { OffersStrip } from './OffersStrip';
import { MobileCheckoutBar } from './MobileCheckoutBar';

import { offerStatuses, parseOffers } from '../-utils/offers';
import { displayName } from '../-utils/cart-item-display';
import type { ProductPageData, ProductPageSettings, PageJson } from '../-types/product-page-types';

function parseSafeJson<T>(jsonStr: string | null | undefined, fallback: T): T {
    if (!jsonStr) return fallback;
    try { return JSON.parse(jsonStr) as T; } catch { return fallback; }
}

const EMPTY_PAGE_JSON: PageJson = { globalSettings: { primaryColor: '#4F46E5', logoFileId: '' }, components: [] }; // design-lint-ignore: page-builder default color

interface CartStepProps {
    pageData: ProductPageData;
    settings: ProductPageSettings;
    primaryColor?: string;
    onBack: () => void;
    onNext: () => void;
}

/**
 * Cart step. The line items and running total live in CheckoutLayout's
 * OrderSummaryPanel, which stays on screen for the whole checkout — this step
 * owns only the decisions the visitor makes here: which plan, which coupon,
 * and what else to add.
 */
export const CartStep = ({ pageData, settings, primaryColor = '#2563eb', onBack, onNext }: CartStepProps) => { // design-lint-ignore: page-builder default color
    const { t, i18n } = useTranslation('productPages');
    const terms = useCourseTerms();
    const course = terms.course;
    const courseTerm = terms.course.toLocaleLowerCase();
    const coursesTerm = terms.courses.toLocaleLowerCase();
    const {
        selectedPsOptionIds, couponCode, discountAmount,
        setCouponCode, applyCoupon, clearCoupon, totalPrice, toggleSelection, setSelection, utmParams,
        finalPrice, basketQuote, priceBeforeCoupon, regionalBaseTotal,
    } = useProductPageStore();
    // Institute-level kill switch (admin Settings → Coupons → "Enable coupon redemption").
    // ANDed with the per-product-page settings.coupon.enabled flag below — both must be on.
    const instituteCouponsEnabled = useCouponsEnabled();

    const [couponInput, setCouponInput] = useState(couponCode);
    const [couponError, setCouponError] = useState('');
    const [couponSuccess, setCouponSuccess] = useState(!!couponCode && discountAmount > 0);
    // The coupon can also be dropped from outside this step: the page's prices
    // were fetched again and the basket no longer costs what it was worked out
    // for (see syncPageData). It then reads as a cart change, not as applied.
    const couponDropped = couponSuccess && !couponCode;
    const couponApplied = couponSuccess && !couponDropped;
    const couponNotice = couponError || (couponDropped ? t('cartStep.couponChanged') : '');

    const selectedMappings = pageData.mappings.filter((m) =>
        selectedPsOptionIds.includes(m.ps_invite_payment_option_id)
    );
    const currency = pageData.currency || selectedMappings[0]?.payment_plan?.currency || 'INR';
    const currencySymbol = currency === 'INR' ? '₹' : currency;

    const pageSuggestions = useMemo(
        () => parseSafeJson<PageJson>(pageData.page_json, EMPTY_PAGE_JSON).suggestions ?? {},
        [pageData.page_json]
    );
    // Include selected suggested courses too so the user can remove them via the suggestion card
    const suggestedIds = useMemo(() => [...new Set(
        selectedPsOptionIds.flatMap((id) => pageSuggestions[id] ?? [])
    )], [selectedPsOptionIds, pageSuggestions]);
    const suggestedMappings = useMemo(() => pageData.mappings.filter(
        (m) => suggestedIds.includes(m.ps_invite_payment_option_id) && m.status === 'ACTIVE'
    ), [pageData.mappings, suggestedIds]);

    const removeSuggested = (id: string) =>
        setSelection(selectedPsOptionIds.filter((sid) => sid !== id));

    const subtotal = totalPrice();
    const isEmpty = selectedPsOptionIds.length === 0;
    const money = (n: number) => `${currencySymbol}${n.toLocaleString('en-IN')}`;

    // Same chain the server bills on: a basket price replaces the item sum,
    // then the best offer, then the coupon.
    const quote = basketQuote();
    const total = finalPrice();
    // Measured the same way the panel directly above measures it — against what
    // the courses cost apart, after EVERY discount. Counting only the basket
    // rule here had the sticky bar and the summary quoting two different
    // savings on one screen the moment a coupon was applied.
    const itemTotal = quote ? quote.itemTotal : totalPrice();
    const saved = Math.max(0, Math.round(itemTotal - total));
    const offers = offerStatuses(
        parseOffers(pageData.settings_json),
        quote ? quote.total : subtotal,
        selectedPsOptionIds.length
    );
    // Mirrors PlanTiles' own gate: it only shows when the page sells the same
    // thing several ways, which most pages do not.
    const planChoiceOffered =
        !!settings.planSelector?.enabled &&
        new Set(
            pageData.mappings
                .filter((m) => selectedPsOptionIds.includes(m.ps_invite_payment_option_id))
                .map((m) => m.payment_plan?.id)
                .filter(Boolean)
        ).size > 1;

    useEffect(() => {
        pushCartViewed(
            selectedMappings.map((m) => m.payment_plan?.name || m.ps_invite_payment_option_id),
            subtotal,
            utmParams,
        );
    }, []);

    // Cart changes invalidate the discount value computed for the previous
    // basket — the BE will recompute against the new subtotal at enroll time.
    // Drop the applied coupon and surface a gentle prompt so the learner
    // knows to re-apply for the updated cart.
    const prevCartKeyRef = useRef<string>(selectedPsOptionIds.slice().sort().join('|'));
    useEffect(() => {
        const currentKey = selectedPsOptionIds.slice().sort().join('|');
        if (prevCartKeyRef.current !== currentKey) {
            prevCartKeyRef.current = currentKey;
            if (couponCode && discountAmount > 0) {
                clearCoupon();
                setCouponInput('');
                setCouponSuccess(false);
                setCouponError(t('cartStep.couponChanged'));
            }
        }
    }, [selectedPsOptionIds, couponCode, discountAmount, clearCoupon]);

    const couponMutation = useMutation({
        // Asked about what the basket costs before the coupon (after the basket
        // price and the page offer), the figure the server works the coupon out
        // on at enrolment. On the plain course total a percentage coupon came
        // out bigger here than there, so the page could show "free" for a
        // basket the server then billed. Without a basket price or an offer the
        // two figures are the same.
        mutationFn: () =>
            validateCoupon(
                pageData.code,
                couponInput.trim(),
                priceBeforeCoupon(),
                selectedPsOptionIds.length,
                regionalBaseTotal() ?? undefined
            ),
        onSuccess: (data) => {
            if (!data.valid) {
                // The API answers in codes; a refused quantity condition needs to
                // say what would fix it, or the visitor just sees "invalid" on a
                // code that is perfectly real.
                setCouponError(couponMessage(t, data.message));
                setCouponSuccess(false);
                return;
            }
            applyCoupon(data.coupon_code_id, data.applied_coupon_discount_id, data.discount_value);
            setCouponCode(couponInput.trim());
            setCouponSuccess(true);
            setCouponError('');
            pushCouponApplied(couponInput.trim(), data.discount_value);
        },
        onError: () => {
            setCouponError(t('cartStep.couponCard.failedToValidate'));
            setCouponSuccess(false);
        },
    });

    const handleRemoveCoupon = () => {
        clearCoupon();
        setCouponInput('');
        setCouponSuccess(false);
        setCouponError('');
    };

    return (
        <div>
            <div className="space-y-6 px-5 py-6 sm:px-6">

                {/* ── Heading ────────────────────────────────────────── */}
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <div>
                        <h1 className="text-h3-semibold font-bold text-gray-900">{t('cartStep.heading.title')}</h1>
                        <p className="mt-0.5 text-sm text-gray-500">
                            {/* PlanTiles renders nothing unless the page offers two or
                                more genuine alternatives, so promising a plan choice
                                leaves most pages telling the visitor to do something
                                that is not on screen. */}
                            {planChoiceOffered
                                ? t('cartStep.heading.subtitlePlanChoice')
                                : t('cartStep.heading.subtitleDefault')}
                        </p>
                    </div>
                    {!isEmpty && (
                        <span className="shrink-0 rounded-full bg-gray-100 px-3 py-1 text-caption font-semibold text-gray-600">
                            {t('cartStep.basket.groupCount', {
                                count: selectedPsOptionIds.length,
                                course: courseTerm,
                                courses: coursesTerm,
                            })}
                        </span>
                    )}
                </div>

                {/* ── The cart itself, wide and editable ─────────────── */}
                <CartItemList
                    pageData={pageData}
                    settings={settings}
                    primaryColor={primaryColor}
                    onAddMore={settings.disableBackNavigation ? undefined : onBack}
                />

                {/* ── Offers ─────────────────────────────────────────── */}
                {!isEmpty && <OffersStrip offers={offers} money={money} />}

                {/* ── Plan tiles — from the page's configured payment plans ─── */}
                <PlanTiles pageData={pageData} settings={settings} primaryColor={primaryColor} />

                {/* ── Coupon ─────────────────────────────────────────── */}
                {/* Gated by BOTH the per-page setting AND the institute-level toggle. */}
                {(settings.coupon?.enabled && instituteCouponsEnabled) && (
                    <div className="overflow-hidden rounded-xl border border-gray-200">
                        <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50 px-4 py-3">
                            <Tag className="size-4 text-gray-400" aria-hidden="true" />
                            <span className="text-caption font-semibold text-gray-700">{t('cartStep.couponCard.title')}</span>
                        </div>
                        <div className="px-4 py-4">
                            {couponApplied ? (
                                <div className="flex items-center justify-between gap-2 rounded-lg border border-success-200 bg-success-50 px-3 py-2">
                                    <div className="flex min-w-0 items-center gap-2">
                                        <CheckCircle className="size-4 shrink-0 text-success-600" aria-hidden="true" />
                                        <span className="truncate font-mono text-caption font-semibold text-success-700">{couponCode}</span>
                                        <span className="shrink-0 text-caption text-success-600">
                                            {t('cartStep.couponCard.discountOff', { amount: `${currencySymbol}${discountAmount.toLocaleString(i18n.language)}` })}
                                        </span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleRemoveCoupon}
                                        className="shrink-0 text-gray-400 transition-colors hover:text-danger-600"
                                        aria-label={t('cartStep.item.removeTooltip')}
                                    >
                                        <X className="size-4" aria-hidden="true" />
                                    </button>
                                </div>
                            ) : (
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        placeholder={t('cartStep.couponCard.placeholder')}
                                        value={couponInput}
                                        onChange={(e) => {
                                            setCouponInput(e.target.value.toUpperCase());
                                            setCouponError('');
                                        }}
                                        className="min-h-11 flex-1 rounded-lg border border-gray-200 px-3 font-mono text-sm uppercase placeholder:normal-case focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
                                        aria-label={t('cartStep.couponCard.title')}
                                    />
                                    <button
                                        type="button"
                                        disabled={!couponInput.trim() || couponMutation.isPending}
                                        onClick={() => couponMutation.mutate()}
                                        className="min-h-11 cursor-pointer rounded-lg bg-gray-900 px-5 text-sm font-semibold text-white transition-colors hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {couponMutation.isPending ? <SpinnerGap className="size-4 animate-spin" aria-hidden="true" /> : t('cartStep.couponCard.apply')}
                                    </button>
                                </div>
                            )}
                            {couponNotice && <p className="mt-2 text-caption text-danger-600">{couponNotice}</p>}
                        </div>
                    </div>
                )}

                {/* ── Suggested courses ──────────────────────────────── */}
                {(() => {
                    const showOn = settings.suggestedCourses?.showOn ?? 'BOTH';
                    const visible = settings.suggestedCourses?.enabled &&
                        (showOn === 'CART' || showOn === 'BOTH') &&
                        suggestedMappings.length > 0;
                    if (!visible) return null;
                    return (
                        <div className="space-y-stack">
                            <h2 className="text-sm font-semibold text-gray-700">
                                {settings.suggestedCourses!.heading || t('common.peopleAlsoBuy')}
                            </h2>
                            <div className="flex gap-3 overflow-x-auto pb-2">
                                {suggestedMappings.map((m) => {
                                    const plan = m.payment_plan;
                                    const isAdded = selectedPsOptionIds.includes(m.ps_invite_payment_option_id);
                                    const initials = (m.package_name || plan?.name || 'C')
                                        .trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
                                    const label = m.package_name
                                        ? `${m.package_name}${displayName(m.session_name) ? ` · ${displayName(m.session_name)}` : ''}`
                                        : plan?.name || course;
                                    return (
                                        <div
                                            key={m.ps_invite_payment_option_id}
                                            className="flex w-44 shrink-0 flex-col rounded-xl border border-gray-200 bg-white p-3 shadow-sm"
                                        >
                                            <div
                                                className="mb-2.5 flex size-10 items-center justify-center rounded-xl text-sm font-bold text-white"
                                                // Dynamic: the institute's own page colour, only known at runtime.
                                                style={{ backgroundColor: primaryColor }}
                                            >
                                                {initials}
                                            </div>
                                            <p className="mb-1 line-clamp-2 flex-1 text-xs font-semibold leading-snug text-gray-900">{label}</p>
                                            <p className="mb-3 text-sm font-bold text-gray-900">
                                                {(plan?.actual_price ?? 0) > 0
                                                    ? `${currencySymbol}${plan!.actual_price.toLocaleString(i18n.language)}`
                                                    : t('common.free')}
                                            </p>
                                            {isAdded ? (
                                                <button
                                                    type="button"
                                                    onClick={() => removeSuggested(m.ps_invite_payment_option_id)}
                                                    className="w-full rounded-lg border border-danger-400 py-1.5 text-xs font-semibold text-danger-600 transition-colors hover:opacity-80"
                                                >
                                                    {t('common.removeSuggested')}
                                                </button>
                                            ) : (
                                                <button
                                                    type="button"
                                                    onClick={() => toggleSelection(m.ps_invite_payment_option_id)}
                                                    className="w-full rounded-lg border py-1.5 text-xs font-semibold transition-colors hover:opacity-80"
                                                    // Dynamic: institute page colour, see above.
                                                    style={{ borderColor: primaryColor, color: primaryColor }}
                                                >
                                                    {t('common.addSuggested')}
                                                </button>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })()}
            </div>

            {/* ── Step navigation ────────────────────────────────────── */}
            <div
                className={cn(
                    'flex items-center justify-between gap-3 rounded-b-2xl border-t border-gray-100 bg-gray-50 px-5 py-4 sm:px-6',
                    // Nothing left to show below lg once Back is off and Continue
                    // has moved to the sticky bar — an empty grey strip is worse
                    // than no strip.
                    settings.disableBackNavigation && 'hidden lg:flex'
                )}
            >
                {!settings.disableBackNavigation ? (
                    <button
                        type="button"
                        onClick={onBack}
                        className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-gray-300 bg-white px-5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
                    >
                        <ArrowLeft className="size-4" aria-hidden="true" />
                        {t('cartStep.backToCourses')}
                    </button>
                ) : <div />}
                <button
                    type="button"
                    onClick={onNext}
                    disabled={isEmpty}
                    className="hidden min-h-11 cursor-pointer items-center gap-2 rounded-xl px-7 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 lg:flex"
                    // Dynamic: institute page colour, see above.
                    style={{ backgroundColor: primaryColor }}
                >
                    {t('common.next')}
                    <ArrowRight className="size-4" aria-hidden="true" />
                </button>
            </div>

            {/* Below lg the total and the CTA would both scroll away behind a
                cart that runs longer than the screen, so they are pinned. */}
            <MobileCheckoutBar
                totalLabel={total > 0 ? money(total) : t('common.free')}
                caption={
                    saved > 0
                        ? t('cartStep.basket.youSave', { amount: money(saved) })
                        : undefined
                }
                ctaLabel={t('common.next')}
                onContinue={onNext}
                disabled={isEmpty}
                primaryColor={primaryColor}
                onShowSummary={
                    isEmpty
                        ? undefined
                        : () =>
                              document
                                  .getElementById('order-summary')
                                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }
            />
        </div>
    );
};
