package vacademy.io.admin_core_service.features.commerce.order.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceOrderPaymentService;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceOrderWriter;
import vacademy.io.admin_core_service.features.commerce.common.CommerceUnits;
import vacademy.io.admin_core_service.features.commerce.document.service.CommerceSellerLookup;
import vacademy.io.admin_core_service.features.commerce.document.service.DocumentClock;
import vacademy.io.admin_core_service.features.commerce.order.cod.CodEligibility;
import vacademy.io.admin_core_service.features.commerce.order.cod.CommerceCodAvailability;
import vacademy.io.admin_core_service.features.commerce.order.dto.CartPriceDtos;
import vacademy.io.admin_core_service.features.commerce.order.dto.CartPriceRequest;
import vacademy.io.admin_core_service.features.commerce.order.dto.CartPriceSnapshot;
import vacademy.io.admin_core_service.features.commerce.order.pincode.CommercePincodeService;
import vacademy.io.admin_core_service.features.commerce.order.pincode.PincodeStates;
import vacademy.io.admin_core_service.features.commerce.order.shipping.CommerceShippingCalculator;
import vacademy.io.admin_core_service.features.commerce.stock.service.CommerceStockSettings;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSettings;
import vacademy.io.admin_core_service.features.commerce.storefront.rules.StorefrontLocale;
import vacademy.io.admin_core_service.features.commerce.storefront.service.CommerceStorefrontSettings;
import vacademy.io.admin_core_service.features.commerce.storefront.service.StorefrontSnapshotLoader;
import vacademy.io.admin_core_service.features.commerce.storefront.service.StorefrontSnapshotLoader.CartVariant;
import vacademy.io.admin_core_service.features.commerce.tax.calc.CommerceTaxCalculator;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxClassRef;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxLineInput;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxLineResult;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxRateRow;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxRequest;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxResult;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxLineType;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxClassService;
import vacademy.io.admin_core_service.features.commerce.tax.enums.RoundTotalTo;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxContext;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxSettingService;
import vacademy.io.admin_core_service.features.product_page.service.BasketPricingCalculator;
import vacademy.io.admin_core_service.features.product_page.service.OfferCalculator;
import vacademy.io.admin_core_service.features.user_subscription.dto.coupon.CouponValidateRequestDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.coupon.CouponValidateResponseDTO;
import vacademy.io.admin_core_service.features.user_subscription.service.coupon.CouponValidationMessages;
import vacademy.io.admin_core_service.features.user_subscription.service.coupon.CouponValidationService;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Orders of the shop. This work package (WP-11) builds one method, {@link #priceCart}: the one
 * place a cart is priced. The cart page, the checkout and the staff order screen all call it,
 * and the order stores the {@link CartPriceSnapshot} it returns, so the price a shopper saw,
 * the order and the invoice come from the same calculation.
 *
 * <p>The server prices everything: the unit price is the variant's payment plan, read at the
 * moment of the call, and nothing a client sends is used as a price. The order of the
 * discounts is the one of the product pages: basket pricing, then the best offer, then the
 * coupon, each computed by the existing calculator on what is left after the one before
 * ({@link BasketPricingCalculator}, {@link OfferCalculator}, {@link CouponValidationService};
 * no discount maths lives here). The delivery charge comes from
 * {@link CommerceShippingCalculator}, and tax from {@link CommerceTaxCalculator} with shipping
 * and the COD charge as lines of their own.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CommerceOrderService {

    public static final int MAX_LINES = 50;
    /** A hard ceiling on a quantity; the shop's own maximum per line is far below it. */
    public static final int MAX_QUANTITY = 100_000;

    public static final String REASON_NOT_FOUND = "NOT_FOUND";
    public static final String REASON_NO_PRICE = "NO_PRICE";
    public static final String REASON_OUT_OF_STOCK = "OUT_OF_STOCK";
    public static final String REASON_INSUFFICIENT_STOCK = "INSUFFICIENT_STOCK";
    public static final String REASON_QUANTITY_INVALID = "QUANTITY_INVALID";
    public static final String REASON_QUANTITY_STEP = "QUANTITY_STEP";
    /** More than the shop sells of one variant in one order; answered whatever the stock is. */
    public static final String REASON_QUANTITY_ABOVE_MAX = "QUANTITY_ABOVE_MAX";
    private static final int MAX_ECHO = 64;
    public static final String REASON_CURRENCY_MISMATCH = "CURRENCY_MISMATCH";

    public static final String CHANGE_PRICE = "PRICE_CHANGED";
    public static final String CHANGE_UNAVAILABLE = "UNAVAILABLE";

    public static final String KIND_BASKET = "BASKET";
    public static final String KIND_OFFER = "OFFER";
    public static final String KIND_COUPON = "COUPON";
    /** A discount on the whole bill given at the counter (POS), with the cashier's reason as label. */
    public static final String KIND_BILL = "BILL";
    /** {@code placeOfSupplySource} of a counter sale: the state of the counter's location. */
    public static final String PLACE_SOURCE_COUNTER = "COUNTER";

    static final String SHIPPING_REF = "SHIPPING";
    static final String COD_REF = "COD_CHARGE";
    private static final BigDecimal ZERO = BigDecimal.ZERO.setScale(2);

    private final CommerceStorefrontSettings storefrontSettings;
    private final StorefrontSnapshotLoader variantLoader;
    private final CommerceShippingRuleService shippingRuleService;
    private final CommercePincodeService pincodeService;
    private final CommerceTaxSettingService taxSettingService;
    private final CommerceTaxClassService taxClassService;
    private final CommerceSellerLookup sellerLookup;
    private final CommerceStockSettings stockSettings;
    private final DocumentClock documentClock;
    private final CouponValidationService couponValidationService;
    private final OfferCalculator offerCalculator;
    private final BasketPricingCalculator basketPricingCalculator;
    /** The deployment switch of COD placement: a cart never offers COD that checkout refuses. */
    private final CommerceCodAvailability codAvailability;

    private final CommerceTaxCalculator taxCalculator = new CommerceTaxCalculator();
    private final ObjectMapper rulesReader = new ObjectMapper();

    // Checkout (WP-12) lives in the checkout package; the methods further down are the names
    // other packages call. Fields, not constructor arguments, so that pricing can be built
    // without them, and lazy, so that no bean cycle can form through this class.
    @Autowired
    @Lazy
    private CommerceOrderPaymentService orderPaymentService;
    @Autowired
    @Lazy
    private CommerceOrderWriter orderWriter;

    /**
     * The stored snapshot and the public view of one priced cart, and the variants it was priced
     * from by id (for callers that word a refusal in the item's unit; not part of any answer).
     */
    public record CartPrice(CartPriceSnapshot snapshot, CartPriceDtos.CartPrice view,
                            Map<String, CartVariant> variants) {

        public CartPrice {
            variants = variants == null ? Map.of() : variants;
        }

        public CartPrice(CartPriceSnapshot snapshot, CartPriceDtos.CartPrice view) {
            this(snapshot, view, Map.of());
        }
    }

    /**
     * The till's and the staff order's answer to a line that is not on its sale step: 400
     * {@code QUANTITY_STEP} naming the line and the step in display units ("line L1 is sold in
     * steps of 0.5 m"). The online cart keeps its unavailable reason instead.
     */
    public static InvalidRequestException stepRefusal(String lineRef, int qtyStep, int qtyScale, String unit) {
        return new InvalidRequestException(REASON_QUANTITY_STEP + ": line " + lineRef + " is sold in steps of "
                + CommerceUnits.shortQuantity(Math.max(1, qtyStep), qtyScale, unit));
    }

    /** Throws {@link #stepRefusal} for the first line of a priced cart refused as {@code QUANTITY_STEP}. */
    public static void requireOnStep(CartPrice priced) {
        requireOnStep(priced, line -> null);
    }

    /**
     * {@link #requireOnStep(CartPrice)} with a way to read a variant the priced cart does not hold
     * (a line asked by SKU): the step is always worded in the item's unit ("0.5 m"), never in base
     * units ("5").
     */
    public static void requireOnStep(CartPrice priced,
                                     java.util.function.Function<CartPriceDtos.UnavailableLine, CartVariant> load) {
        if (priced == null || priced.view() == null || priced.view().getUnavailable() == null) {
            return;
        }
        for (CartPriceDtos.UnavailableLine line : priced.view().getUnavailable()) {
            if (!REASON_QUANTITY_STEP.equals(line.getReason())) {
                continue;
            }
            CartVariant variant = line.getVariantId() == null ? null : priced.variants().get(line.getVariantId());
            if (variant == null && line.getSku() != null) {
                variant = priced.variants().values().stream().filter(v -> line.getSku().equals(v.sku()))
                        .findFirst().orElse(null);
            }
            if (variant == null && load != null) {
                variant = load.apply(line);
            }
            int step = line.getQtyStep() != null ? line.getQtyStep() : variant == null ? 1 : variant.qtyStep();
            throw stepRefusal(line.getLineRef(), step, variant == null ? 1 : variant.qtyScale(),
                    variant == null ? null : variant.unit());
        }
    }

    /**
     * The variant of a refused cart line, read now by its id or SKU (null when there is none):
     * for wording a refusal in the item's unit.
     */
    public CartVariant cartVariant(String instituteId, String variantId, String sku) {
        Set<String> ids = variantId == null ? Set.of() : Set.of(variantId);
        Set<String> skus = variantId != null || sku == null ? Set.of() : Set.of(sku);
        if (ids.isEmpty() && skus.isEmpty()) {
            return null;
        }
        Map<String, CartVariant> found = variantLoader.cartVariants(instituteId, ids, skus);
        return found == null || found.isEmpty() ? null : found.values().iterator().next();
    }

    /**
     * One cart line that can be bought, with the row it was priced from. {@code unitPrice} is the
     * variant's price, or the price staff typed for a staff order.
     */
    private record Priced(String lineRef, CartVariant variant, int quantity, BigDecimal gross, String name,
                          String variantLabel, BigDecimal unitPrice) {
    }

    /**
     * What a staff order adds to pricing: a unit price typed by a manager for some lines (by
     * line ref), and whether the delivery charge applies (no address, or waived).
     */
    public record StaffPricing(Map<String, BigDecimal> unitPriceByLineRef, boolean chargeShipping) {

        BigDecimal unitPrice(String lineRef) {
            return unitPriceByLineRef == null || lineRef == null ? null : unitPriceByLineRef.get(lineRef);
        }
    }

    /**
     * What a counter sale (POS) adds to pricing: the counter's location (the seller and the place
     * of supply), a discount per line (by line ref, on that line alone) and one discount on the
     * whole bill with its reason. A counter sale has no delivery charge, no COD, and is not
     * refused for the website's sellable stock or the per-line maximum: stock at the till is the
     * stock ledger's job. {@code paperBill}: a bill already written by hand and keyed in later
     * (the bill book): the length was cut as written, so the sale step is not applied.
     */
    public record CounterPricing(String locationId, Map<String, BigDecimal> lineDiscountByRef, BigDecimal billDiscount,
                                 String billDiscountReason, boolean paperBill) {

        /** A sale at the till: the step applies. */
        public CounterPricing(String locationId, Map<String, BigDecimal> lineDiscountByRef, BigDecimal billDiscount,
                              String billDiscountReason) {
            this(locationId, lineDiscountByRef, billDiscount, billDiscountReason, false);
        }

        BigDecimal lineDiscount(String lineRef) {
            BigDecimal value = lineDiscountByRef == null || lineRef == null ? null : lineDiscountByRef.get(lineRef);
            return value == null || value.signum() <= 0 ? null : value.setScale(2, RoundingMode.HALF_UP);
        }
    }

    /** A coupon answer and the most it may take off: the whole cart, or the items the coupon names. */
    private record CouponAnswer(CouponValidateResponseDTO answer, BigDecimal cap) {
    }

    private record Discounts(BigDecimal total, List<CartPriceSnapshot.Discount> rows, CartPriceDtos.Coupon coupon) {
    }

    // ------------------------------------------------------------------ orders (WP-12)

    /**
     * A payment log reads PAID (called from the commerce branch of the webhook and verify
     * path). Idempotent; a log that belongs to no shop order is ignored. See
     * {@link CommerceOrderPaymentService}.
     */
    public void onPaymentLogPaid(String paymentLogId) {
        requireSettled(orderPaymentService.onPaymentLogPaid(paymentLogId), "payment log " + paymentLogId);
    }

    /**
     * As {@link #onPaymentLogPaid(String)}, with what the gateway reported; a value that is
     * given (not null) must match the order or nothing is confirmed.
     *
     * @return what happened, for the caller's log
     */
    public CommerceOrderPaymentService.Outcome onPaymentLogPaid(String paymentLogId, String gatewayOrderId,
                                                               Long amountMinor) {
        return requireSettled(orderPaymentService.onPaymentLogPaid(paymentLogId, gatewayOrderId, amountMinor),
                "payment log " + paymentLogId);
    }

    /** The payment window of an order closed: holds released, the unpaid order cancelled. */
    public void onHoldExpired(String commerceOrderId) {
        orderPaymentService.onHoldExpired(commerceOrderId);
    }

    /**
     * The shopper released the stock of an unpaid order: the order is cancelled, so it is not
     * offered for payment again and does not count as an open order of that phone.
     */
    public void onShopperReleased(String commerceOrderId) {
        orderPaymentService.onHoldExpired(commerceOrderId, CommerceOrderPaymentService.REASON_SHOPPER_RELEASED);
    }

    /**
     * For the reconcile job and every webhook delivery: confirms a paid order that is not yet.
     *
     * @throws IllegalStateException when the order has money and could not be confirmed
     */
    public CommerceOrderPaymentService.Outcome ensurePaidOrderConfirmed(String commerceOrderId) {
        return requireSettled(orderPaymentService.ensurePaidOrderConfirmed(commerceOrderId),
                "order " + commerceOrderId);
    }

    /**
     * A paid order that could not be confirmed is an exception for the caller, not a quiet
     * return: the payment code then keeps the order on the list of the reconcile job. "Not
     * paid yet" and "nothing to do" are ordinary answers.
     */
    private static CommerceOrderPaymentService.Outcome requireSettled(CommerceOrderPaymentService.Outcome outcome,
                                                                     String what) {
        if (outcome == CommerceOrderPaymentService.Outcome.STOCK_NOT_SETTLED
                || outcome == CommerceOrderPaymentService.Outcome.REFUSED_MISMATCH
                || outcome == CommerceOrderPaymentService.Outcome.PARTLY_PAID) {
            throw new IllegalStateException("Commerce " + what + " is paid but the order was not confirmed: "
                    + outcome);
        }
        return outcome;
    }

    /**
     * The direct write of plans, payment logs and stock holds of an order, inside the caller's
     * transaction; no enrolment row on any channel. See {@link CommerceOrderWriter#writeMoneyRows}.
     */
    public CommerceOrderWriter.MoneyRows writeMoneyRows(
            vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrder order,
            List<vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderLine> lines,
            int holdMinutes) {
        return orderWriter.writeMoneyRows(order, lines, holdMinutes);
    }

    // ------------------------------------------------------------------ pricing (WP-11)

    /**
     * Prices a cart for an institute.
     *
     * @throws CartPricingException CART_INVALID for a malformed request; NOT_PRICEABLE when the
     *                              shop's tax or seller setup does not allow a price
     */
    public CartPrice priceCart(String instituteId, CartPriceRequest request) {
        return priceCart(instituteId, request, null);
    }

    /**
     * {@link #priceCart(String, CartPriceRequest)} for a staff order: the lines named in
     * {@code staff} are priced at the typed unit price (the catalogue price is kept on the
     * snapshot line as {@code list_unit_price}), and the delivery charge is left out when
     * {@code chargeShipping} is false. Everything else (stock, discounts, tax) is the same
     * calculation as the cart's. A null {@code staff} is the cart.
     */
    public CartPrice priceCart(String instituteId, CartPriceRequest request, StaffPricing staff) {
        return priceCart(instituteId, request, staff, null);
    }

    /**
     * {@link #priceCart(String, CartPriceRequest, StaffPricing)} for a counter sale when
     * {@code counter} is given (see {@link CounterPricing}); a null {@code counter} is exactly the
     * three-argument form.
     *
     * @throws CartPricingException CART_INVALID also when a line discount is more than its line or
     *                              the bill discount more than the goods left after line discounts
     *                              and offers
     */
    public CartPrice priceCart(String instituteId, CartPriceRequest request, StaffPricing staff,
                               CounterPricing counter) {
        List<CartPriceRequest.Line> asked = validate(request);
        StorefrontSettings settings = storefrontSettings.read(instituteId);
        List<String> chain = StorefrontLocale.chain(request.getLocale(), settings.baseLocale());
        boolean codAsked = counter == null && CartPriceRequest.COD.equalsIgnoreCase(trim(request.getPaymentMethod()));

        // 1. The variants, read now.
        Set<String> ids = new LinkedHashSet<>();
        Set<String> skus = new LinkedHashSet<>();
        for (CartPriceRequest.Line line : asked) {
            if (trim(line.getVariantId()) != null) {
                ids.add(trim(line.getVariantId()));
            } else {
                skus.add(trim(line.getSku()));
            }
        }
        Map<String, CartVariant> byId = variantLoader.cartVariants(instituteId, ids, skus);
        Map<String, CartVariant> bySku = new LinkedHashMap<>();
        byId.values().forEach(v -> bySku.put(v.sku(), v));

        // 2. Each line: buyable as asked, or a reason.
        List<Priced> priced = new ArrayList<>();
        List<CartPriceDtos.UnavailableLine> unavailable = new ArrayList<>();
        List<CartPriceDtos.Change> changes = new ArrayList<>();
        Map<String, Integer> askedSoFar = new LinkedHashMap<>();
        String currency = null;
        for (CartPriceRequest.Line line : asked) {
            CartVariant variant = trim(line.getVariantId()) != null ? byId.get(trim(line.getVariantId()))
                    : bySku.get(trim(line.getSku()));
            if (variant != null && (!variant.productActive() || !variant.variantActive())) {
                // A DRAFT or ARCHIVED product or variant is treated as not there from here on, so
                // that no later branch can name it: asked by SKU, the answer must not carry its
                // id, and must be the same as for a SKU that does not exist.
                variant = null;
            }
            String ref = lineRef(line, variant);
            BigDecimal override = staff == null ? null : staff.unitPrice(ref);
            int quantity = line.getQuantity() == null ? 0 : line.getQuantity();
            int already = variant == null ? 0 : askedSoFar.getOrDefault(variant.packageSessionId(), 0);
            String reason = refusal(variant, quantity, already, currency, settings, override != null, counter != null,
                    counter != null && counter.paperBill());
            if (reason != null) {
                unavailable.add(unavailable(ref, line, variant, reason, already, settings));
                changes.add(CartPriceDtos.Change.builder().lineRef(ref)
                        .variantId(variant == null ? clip(trim(line.getVariantId())) : variant.packageSessionId())
                        .type(CHANGE_UNAVAILABLE).reason(reason).build());
                continue;
            }
            askedSoFar.merge(variant.packageSessionId(), quantity, Integer::sum);
            currency = currency(variant);
            BigDecimal unitPrice = override != null ? override.setScale(2, RoundingMode.UNNECESSARY) : variant.price();
            if (override == null && line.getUnitPrice() != null && line.getUnitPrice().compareTo(variant.price()) != 0) {
                changes.add(CartPriceDtos.Change.builder().lineRef(ref).variantId(variant.packageSessionId())
                        .type(CHANGE_PRICE).oldUnitPrice(line.getUnitPrice()).newUnitPrice(variant.price()).build());
            }
            priced.add(new Priced(ref, variant, quantity,
                    unitPrice.multiply(BigDecimal.valueOf(quantity)).setScale(2, RoundingMode.UNNECESSARY),
                    name(variant, chain), variantLabel(variant, chain), unitPrice));
        }
        requireDistinctRefs(priced);

        // 3. Place of supply.
        String pincode = trim(request.getPincode()) == null ? null : trim(request.getPincode()).replace(" ", "");
        String placeState = null;
        String placeSource = null;
        // The pincode decides when it names a state; a state sent beside it is only used when the
        // pincode names none, so a shopper cannot pick the tax head against their own address.
        if (pincode != null && counter == null) {
            CommercePincodeService.Pincode found = pincodeService.lookup(pincode);
            if (found != null && found.stateCode() != null) {
                placeState = found.stateCode();
                placeSource = found.source();
            }
        }
        if (counter == null && placeState == null && PincodeStates.isStateCode(trim(request.getStateCode()))) {
            placeState = trim(request.getStateCode());
            placeSource = "REQUEST";
        }

        // A counter sale has no delivery and no COD: the shop's delivery rule is not read.
        CommerceShippingCalculator.Rule rule = counter == null ? shippingRule(instituteId) : null;
        BigDecimal codCharge = rule == null || rule.codCharge() == null ? ZERO
                : rule.codCharge().setScale(2, RoundingMode.HALF_UP);

        if (priced.isEmpty()) {
            CartPrice none = empty(instituteId, request, settings, unavailable, changes, pincode, placeState,
                    placeSource, codCharge, rule);
            return new CartPrice(none.snapshot(), none.view(), byId);
        }

        // 4. Discounts, then delivery.
        BigDecimal itemTotal = priced.stream().map(Priced::gross).reduce(ZERO, BigDecimal::add);
        Map<String, BigDecimal> lineDiscounts = counter == null ? Map.of() : lineDiscounts(priced, counter);
        BigDecimal lineDiscountTotal = lineDiscounts.values().stream().reduce(ZERO, BigDecimal::add);
        // At the counter the offers apply to what is left after the line discounts.
        Discounts discounts = discounts(instituteId, request, settings, priced, itemTotal.subtract(lineDiscountTotal));
        if (counter != null) {
            discounts = withBillDiscount(discounts, itemTotal.subtract(lineDiscountTotal), counter);
        }
        BigDecimal goodsValue = itemTotal.subtract(discounts.total());
        long weight = 0;
        for (Priced line : priced) {
            if (line.variant().weightGrams() != null && line.variant().weightGrams() > 0) {
                // The weight is that of one unit; a measured product counts base units.
                weight += (long) Math.ceil((double) line.variant().weightGrams() * line.quantity()
                        / Math.max(1, line.variant().qtyScale()));
            }
        }
        boolean chargeShipping = counter == null && (staff == null || staff.chargeShipping());
        CommerceShippingCalculator.Quote shipping = CommerceShippingCalculator.quote(chargeShipping ? rule : null,
                goodsValue, weight);

        // 5. Tax: once as prepaid, and again with the COD charge when COD was asked for and allowed.
        CommerceTaxContext taxContext = taxSettingService.context(instituteId);
        if (counter != null) {
            taxContext = counterTaxContext(taxContext);
        }
        String locationId = counter != null ? counter.locationId() : fulfilmentLocation(instituteId);
        String sellerState;
        Map<String, TaxClassRef> taxClasses;
        try {
            sellerState = sellerLookup.resolve(instituteId, locationId, taxContext).getStateCode();
            Set<String> classIds = new LinkedHashSet<>();
            priced.forEach(line -> classIds.add(line.variant().taxClassId()));
            if (rule != null) {
                classIds.add(rule.taxClassId());
            }
            taxClasses = new HashMap<>(taxClassService.loadRefs(instituteId, classIds));
        } catch (InvalidRequestException | ConflictException e) {
            throw new CartPricingException(CartPricingException.NOT_PRICEABLE, e.getMessage());
        }
        if (counter != null) {
            // Sold at the counter: the place of supply is the state of the counter's location.
            placeState = sellerState;
            placeSource = PLACE_SOURCE_COUNTER;
        }
        TaxRequest prepaidRequest = taxRequest(instituteId, taxContext, sellerState, placeState, priced,
                discounts.total(), shipping, null, rule, taxClasses, lineDiscounts);
        TaxResult prepaid = calculate(prepaidRequest);

        CodEligibility.Result cod = CodEligibility.check(codAvailability.effectiveCod(settings.cod()),
                prepaid.getTotal().add(codCharge), pincode, codCharge);
        boolean codApplied = codAsked && cod.eligible();
        TaxRequest finalRequest = prepaidRequest;
        TaxResult tax = prepaid;
        if (codApplied && codCharge.signum() > 0) {
            finalRequest = taxRequest(instituteId, taxContext, sellerState, placeState, priced, discounts.total(),
                    shipping, codCharge, rule, taxClasses, lineDiscounts);
            tax = calculate(finalRequest);
        }

        // 6. The snapshot and the public view.
        String paymentMethod = codApplied ? CartPriceRequest.COD : CartPriceRequest.PREPAID;
        List<CartPriceSnapshot.Line> snapshotLines = new ArrayList<>();
        List<CartPriceDtos.Line> viewLines = new ArrayList<>();
        for (Priced line : priced) {
            CartVariant v = line.variant();
            boolean overridden = staff != null && staff.unitPrice(line.lineRef()) != null;
            snapshotLines.add(CartPriceSnapshot.Line.builder()
                    .lineRef(line.lineRef()).packageSessionId(v.packageSessionId()).packageId(v.packageId())
                    .sku(v.sku()).name(line.name()).variantLabel(line.variantLabel()).quantity(line.quantity())
                    .qtyScale(v.qtyScale()).unit(v.unit())
                    .unitPrice(line.unitPrice()).mrp(v.mrp()).taxClassId(v.taxClassId()).weightGrams(v.weightGrams())
                    .listUnitPrice(overridden ? v.price() : null)
                    .build());
            viewLines.add(viewLine(line, tax));
        }
        CartPriceSnapshot snapshot = CartPriceSnapshot.builder()
                .version(CartPriceSnapshot.CURRENT_VERSION)
                .instituteId(instituteId)
                .pricedAt(Instant.now().toString())
                .currency(currency)
                .locale(StorefrontLocale.effective(chain))
                .paymentMethod(paymentMethod)
                .pincode(pincode)
                .placeOfSupplyState(placeState)
                .placeOfSupplySource(placeSource)
                .fulfilmentLocationId(locationId)
                .lines(snapshotLines)
                .discounts(discounts.rows())
                .shipping(CartPriceSnapshot.Shipping.builder().ruleId(shipping.ruleId())
                        .basis(shipping.basis() == null ? null : shipping.basis().name())
                        .baseCharge(shipping.baseCharge()).charge(shipping.charge()).freeAbove(shipping.freeAbove())
                        .weightGrams(shipping.weightGrams()).build())
                .codCharge(tax.getCodCharge())
                .taxRequest(finalRequest)
                .tax(tax)
                .total(tax.getTotal())
                .build();

        List<CartPriceDtos.Discount> viewDiscounts = new ArrayList<>();
        for (CartPriceSnapshot.Discount row : discounts.rows()) {
            viewDiscounts.add(CartPriceDtos.Discount.builder().kind(row.getKind()).label(row.getLabel())
                    .code(row.getCode()).amount(row.getAmount()).build());
        }
        CartPriceDtos.CartPrice view = CartPriceDtos.CartPrice.builder()
                .currency(currency)
                .paymentMethod(paymentMethod)
                .lines(viewLines)
                .unavailable(unavailable)
                .changes(changes)
                .discounts(viewDiscounts)
                .coupon(discounts.coupon())
                .shipping(viewShipping(shipping))
                .cod(viewCod(cod))
                .tax(viewTax(tax, placeState != null))
                .totals(CartPriceDtos.Totals.builder()
                        .subtotal(tax.getSubtotal()).discount(tax.getDiscount()).shipping(tax.getShipping())
                        .codCharge(tax.getCodCharge()).roundOff(tax.getRoundOff()).total(tax.getTotal())
                        .lineCount(priced.size()).build())
                .build();
        return new CartPrice(snapshot, view, byId);
    }

    // ------------------------------------------------------------------ request

    private static List<CartPriceRequest.Line> validate(CartPriceRequest request) {
        if (request == null || request.getLines() == null || request.getLines().isEmpty()) {
            throw new CartPricingException(CartPricingException.CART_INVALID, "The cart has no lines.");
        }
        if (request.getLines().size() > MAX_LINES) {
            throw new CartPricingException(CartPricingException.CART_INVALID,
                    "A cart has at most " + MAX_LINES + " lines.");
        }
        for (CartPriceRequest.Line line : request.getLines()) {
            if (line == null || (trim(line.getVariantId()) == null && trim(line.getSku()) == null)) {
                throw new CartPricingException(CartPricingException.CART_INVALID,
                        "Every line needs a variant_id or a sku.");
            }
            if (line.getUnitPrice() != null && (line.getUnitPrice().signum() < 0
                    || line.getUnitPrice().precision() - line.getUnitPrice().scale() > 10)) {
                throw new CartPricingException(CartPricingException.CART_INVALID, "unit_price is not an amount.");
            }
        }
        String method = trim(request.getPaymentMethod());
        if (method != null && !CartPriceRequest.COD.equalsIgnoreCase(method)
                && !CartPriceRequest.PREPAID.equalsIgnoreCase(method)) {
            throw new CartPricingException(CartPricingException.CART_INVALID, "payment_method must be PREPAID or COD.");
        }
        return request.getLines();
    }

    private static String lineRef(CartPriceRequest.Line line, CartVariant variant) {
        String ref = trim(line.getLineRef());
        if (ref != null) {
            return ref.length() > 64 ? ref.substring(0, 64) : ref;
        }
        if (variant != null) {
            return variant.packageSessionId();
        }
        return clip(trim(line.getVariantId()) != null ? trim(line.getVariantId()) : trim(line.getSku()));
    }

    /** What a client sent is echoed back at most this long. */
    private static String clip(String value) {
        return value != null && value.length() > MAX_ECHO ? value.substring(0, MAX_ECHO) : value;
    }

    /** The tax calculator and the order lines key a line by its ref, so two lines cannot share one. */
    private static void requireDistinctRefs(List<Priced> priced) {
        Set<String> seen = new LinkedHashSet<>();
        for (Priced line : priced) {
            if (!seen.add(line.lineRef()) || SHIPPING_REF.equals(line.lineRef()) || COD_REF.equals(line.lineRef())) {
                throw new CartPricingException(CartPricingException.CART_INVALID,
                        "Two cart lines share a line_ref, or name the same variant without one.");
            }
        }
    }

    /**
     * Why a line cannot be bought as asked, or null. An unknown id, a variant of another
     * institute and a product that is not ACTIVE all answer NOT_FOUND, so the answer does not
     * tell them apart.
     */
    private static String refusal(CartVariant variant, int quantity, int alreadyAsked, String cartCurrency,
                                  StorefrontSettings settings, boolean priceTypedByStaff, boolean counter,
                                  boolean paperBill) {
        if (variant == null) {
            return REASON_NOT_FOUND;
        }
        if (!priceTypedByStaff && (variant.price() == null || variant.price().signum() <= 0)) {
            return REASON_NO_PRICE;
        }
        if (cartCurrency != null && !cartCurrency.equals(currency(variant))) {
            return REASON_CURRENCY_MISMATCH;
        }
        if (quantity < 1 || quantity > MAX_QUANTITY) {
            return REASON_QUANTITY_INVALID;
        }
        if (!paperBill && quantity % Math.max(1, variant.qtyStep()) != 0) {
            return REASON_QUANTITY_STEP;
        }
        if (counter) {
            // At the counter the goods are in the buyer's hand: the ledger decides on the stock of
            // the location when the sale is written, and the website's per-line maximum does not apply.
            return null;
        }
        // Before the stock test and whatever the stock is: otherwise the accept / refuse boundary
        // of a large quantity would tell the exact count on hand.
        if ((long) alreadyAsked + quantity > settings.maxLineBaseUnits(variant.qtyScale())) {
            return REASON_QUANTITY_ABOVE_MAX;
        }
        if (variant.tracked()) {
            int available = Math.max(0, variant.availableSlots() == null ? 0 : variant.availableSlots()) - alreadyAsked;
            // Less than one sale step left (0.4 m of a cloth cut in 0.5 m) cannot be sold: sold out,
            // as the product page says, never "only 0 m".
            if (available < Math.max(1, variant.qtyStep())) {
                return REASON_OUT_OF_STOCK;
            }
            if (quantity > available) {
                return REASON_INSUFFICIENT_STOCK;
            }
        }
        return null;
    }

    private static CartPriceDtos.UnavailableLine unavailable(String ref, CartPriceRequest.Line line,
                                                             CartVariant variant, String reason, int alreadyAsked,
                                                             StorefrontSettings settings) {
        boolean known = variant != null && !REASON_NOT_FOUND.equals(reason);
        Integer available = null;
        if (known && REASON_INSUFFICIENT_STOCK.equals(reason)) {
            int left = Math.max(0, variant.availableSlots() == null ? 0 : variant.availableSlots()) - alreadyAsked;
            // The same rule as the product page: a number only at or below the low threshold.
            long lowLimit = (long) settings.lowStockThreshold() * Math.max(1, variant.qtyScale());
            int step = Math.max(1, variant.qtyStep());
            if (left <= lowLimit) {
                available = left - left % step;
            }
        }
        Integer maxQuantity = null;
        if (known && REASON_QUANTITY_ABOVE_MAX.equals(reason)) {
            // A shop setting, the same for every variant: it says nothing about the stock.
            maxQuantity = (int) Math.min(Integer.MAX_VALUE, settings.maxLineBaseUnits(variant.qtyScale()));
        }
        return CartPriceDtos.UnavailableLine.builder()
                .lineRef(ref)
                .variantId(known ? variant.packageSessionId() : clip(trim(line.getVariantId())))
                .sku(known ? variant.sku() : clip(trim(line.getSku())))
                .reason(reason)
                .availableQuantity(available)
                .maxQuantity(maxQuantity)
                .qtyStep(known ? variant.qtyStep() : null)
                .build();
    }

    private static String currency(CartVariant variant) {
        return variant.currency() == null || variant.currency().isBlank() ? "INR"
                : variant.currency().trim().toUpperCase(Locale.ROOT);
    }

    /**
     * The name of a cart line: the product name and, for a product with variants, what tells
     * this variant apart ("Cotton Shirt - Red / M"). The same text is the description of the
     * tax line, so the order line and the invoice line say which variant was sold.
     */
    private static String name(CartVariant variant, List<String> chain) {
        String name = StorefrontLocale.text(variant.names(), chain);
        if (name == null) {
            name = variant.slug();
        }
        String label = variantLabel(variant, chain);
        return label == null || label.equals(name) ? name : name + " - " + label;
    }

    /** The option values in option order ("Red / M"), as the product page builds them; else the stored name. */
    private static String variantLabel(CartVariant variant, List<String> chain) {
        List<String> parts = new ArrayList<>();
        if (variant.options() != null) {
            for (StorefrontSnapshotLoader.OptionLabel option : variant.options()) {
                String label = StorefrontLocale.text(option.labelI18n(), chain);
                if (label == null) {
                    label = option.code();
                }
                if (label != null) {
                    parts.add(label);
                }
            }
        }
        if (!parts.isEmpty()) {
            return String.join(" / ", parts);
        }
        String legacy = variant.legacyName();
        return legacy == null || legacy.equals(variant.sku()) ? null : legacy;
    }

    /**
     * How many items a cart holds for a rule that counts them ("10% off 3 or more", a coupon's
     * minimum): the units of the lines, where a line sold by measure (cloth by the metre)
     * counts as one whatever its length.
     */
    static int itemCount(List<Priced> priced) {
        long count = 0;
        for (Priced line : priced) {
            count += line.variant().qtyScale() > 1 ? 1 : line.quantity();
        }
        return (int) Math.min(Integer.MAX_VALUE, count);
    }

    // ------------------------------------------------------------------ discounts

    /**
     * Basket pricing, then the best offer, then the coupon; each on what is left. "Items" for a
     * rule that counts them is the number of units ({@link #itemCount}). The total never
     * exceeds the goods.
     */
    private Discounts discounts(String instituteId, CartPriceRequest request, StorefrontSettings settings,
                                List<Priced> priced, BigDecimal itemTotal) {
        List<CartPriceSnapshot.Discount> rows = new ArrayList<>();
        BigDecimal left = itemTotal;
        String rules = settings.pricingRulesJson();

        if (rules != null && discountBasis(rules)) {
            List<BasketPricingCalculator.BasketItem> items = new ArrayList<>();
            for (Priced line : priced) {
                if (line.variant().qtyScale() > 1) {
                    items.add(new BasketPricingCalculator.BasketItem("", line.name(), line.gross().doubleValue()));
                } else {
                    // One item per unit: three of one kurta count like three different ones.
                    for (int unit = 0; unit < line.quantity(); unit++) {
                        items.add(new BasketPricingCalculator.BasketItem("", line.name(),
                                line.unitPrice().doubleValue()));
                    }
                }
            }
            BasketPricingCalculator.BasketPrice basket = basketPricingCalculator.price(rules, items);
            if (basket != null) {
                // The reduction the engine decided, from its own two figures. It rounds both to whole
                // rupees, so "the cart minus its total" would invent a discount of paise on a cart
                // where no tier applied.
                BigDecimal off = cap(money(basket.getItemTotal() - basket.getTotal()), left);
                if (off.signum() > 0) {
                    rows.add(CartPriceSnapshot.Discount.builder().kind(KIND_BASKET)
                            .label(basket.getBreakdown().isEmpty() ? null : basket.getBreakdown().get(0))
                            .amount(off).build());
                    left = left.subtract(off);
                }
            }
        }

        if (rules != null && left.signum() > 0) {
            OfferCalculator.AppliedOffer offer = offerCalculator.bestOffer(rules, left.doubleValue(), itemCount(priced));
            if (offer != null) {
                BigDecimal off = cap(money(offer.getAmount()), left);
                if (off.signum() > 0) {
                    rows.add(CartPriceSnapshot.Discount.builder().kind(KIND_OFFER).label(offer.getLabel())
                            .code(offer.getId() == null || offer.getId().isBlank() ? null : offer.getId())
                            .amount(off).build());
                    left = left.subtract(off);
                }
            }
        }

        CartPriceDtos.Coupon coupon = null;
        String code = trim(request.getCouponCode());
        if (code != null) {
            code = code.length() > 64 ? code.substring(0, 64) : code;
            CouponAnswer validated = validateCoupon(instituteId, code, request, priced, itemTotal, left);
            CouponValidateResponseDTO answer = validated.answer();
            BigDecimal off = answer.isValid() && answer.getDiscountValue() != null
                    ? cap(money(answer.getDiscountValue()), validated.cap()) : ZERO;
            boolean applied = answer.isValid() && off.signum() > 0;
            if (applied) {
                rows.add(CartPriceSnapshot.Discount.builder().kind(KIND_COUPON).code(code.toUpperCase(Locale.ROOT))
                        .amount(off).couponCodeId(answer.getCouponCodeId())
                        .appliedCouponDiscountId(answer.getAppliedCouponDiscountId()).build());
                left = left.subtract(off);
            }
            coupon = CartPriceDtos.Coupon.builder().code(code.toUpperCase(Locale.ROOT)).applied(applied)
                    .reason(answer.getMessage()).discount(applied ? off : ZERO).build();
        }
        return new Discounts(itemTotal.subtract(left), rows, coupon);
    }

    /**
     * Basket pricing is used only on the DISCOUNT basis (a reduction off the real prices). The
     * FLAT basis replaces the prices of courses by a ladder of absolute amounts per count; on
     * goods it would overwrite the price of the product, so it is not applied to a cart.
     */
    private boolean discountBasis(String rules) {
        try {
            JsonNode basket = rulesReader.readTree(rules).path("basketPricing");
            if (!basket.path("enabled").asBoolean(false)) {
                return false;
            }
            if ("DISCOUNT".equalsIgnoreCase(basket.path("pricingBasis").asText(""))) {
                return true;
            }
            log.warn("commerce cart: basketPricing with a basis other than DISCOUNT is not applied to goods");
            return false;
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * The existing coupon validation. An institute-wide coupon is computed on the whole of
     * what is left. A coupon limited to certain items is tried per line; its discount is
     * computed on the share of what is left that belongs to the lines it names (their part
     * after the basket and offer reductions), and can never be more than that share: a flat
     * amount limited to a small item does not spill over onto the rest of the cart.
     */
    private CouponAnswer validateCoupon(String instituteId, String code, CartPriceRequest request,
                                        List<Priced> priced, BigDecimal itemTotal, BigDecimal left) {
        CouponValidateRequestDTO.CouponValidateRequestDTOBuilder base = CouponValidateRequestDTO.builder()
                .couponCode(code).instituteId(instituteId).userEmail(trim(request.getEmail()))
                .itemCount(itemCount(priced));
        try {
            CouponValidateResponseDTO whole = couponValidationService.validate(
                    base.totalAmount(left.doubleValue()).build());
            if (whole.isValid() || !CouponValidationMessages.NOT_APPLICABLE.equals(whole.getMessage())) {
                return new CouponAnswer(whole, left);
            }
            BigDecimal named = ZERO;
            String firstMatch = null;
            for (Priced line : priced) {
                CouponValidateResponseDTO one = couponValidationService.validate(base
                        .packageSessionId(line.variant().packageSessionId())
                        .totalAmount(line.gross().doubleValue()).build());
                if (one.isValid()) {
                    named = named.add(line.gross());
                    if (firstMatch == null) {
                        firstMatch = line.variant().packageSessionId();
                    }
                }
            }
            if (firstMatch == null) {
                return new CouponAnswer(whole, left);
            }
            BigDecimal share = itemTotal.signum() == 0 ? ZERO
                    : left.multiply(named).divide(itemTotal, 2, RoundingMode.HALF_UP).min(left);
            return new CouponAnswer(couponValidationService.validate(base.packageSessionId(firstMatch)
                    .totalAmount(share.doubleValue()).build()), share);
        } catch (RuntimeException e) {
            log.warn("commerce cart: coupon validation failed for institute {}: {}", instituteId, e.getMessage());
            return new CouponAnswer(
                    CouponValidateResponseDTO.builder().valid(false).message(CouponValidationMessages.INVALID).build(),
                    left);
        }
    }

    /** The line discounts of a counter sale, by line ref; each at most its line. */
    private static Map<String, BigDecimal> lineDiscounts(List<Priced> priced, CounterPricing counter) {
        Map<String, BigDecimal> out = new LinkedHashMap<>();
        for (Priced line : priced) {
            BigDecimal discount = counter.lineDiscount(line.lineRef());
            if (discount == null) {
                continue;
            }
            if (discount.compareTo(line.gross()) > 0) {
                throw new CartPricingException(CartPricingException.CART_INVALID,
                        "line_discount of line " + line.lineRef() + " is more than the line (" + line.gross()
                                .toPlainString() + ").");
            }
            out.put(line.lineRef(), discount);
        }
        return out;
    }

    /**
     * The bill discount of a counter sale, added after basket pricing and offers as a row of
     * kind {@link #KIND_BILL}. It may not be more than the goods left after the line discounts
     * and those reductions.
     */
    private static Discounts withBillDiscount(Discounts discounts, BigDecimal goodsAfterLineDiscounts,
                                              CounterPricing counter) {
        BigDecimal bill = counter.billDiscount() == null ? ZERO : counter.billDiscount().setScale(2, RoundingMode.HALF_UP);
        if (bill.signum() <= 0) {
            return discounts;
        }
        BigDecimal left = goodsAfterLineDiscounts.subtract(discounts.total());
        if (bill.compareTo(left) > 0) {
            throw new CartPricingException(CartPricingException.CART_INVALID,
                    "bill_discount is more than the goods left after line discounts and offers (" + left.toPlainString()
                            + ").");
        }
        List<CartPriceSnapshot.Discount> rows = new ArrayList<>(discounts.rows());
        rows.add(CartPriceSnapshot.Discount.builder().kind(KIND_BILL).label(counter.billDiscountReason())
                .amount(bill).build());
        return new Discounts(discounts.total().add(bill), rows, discounts.coupon());
    }

    private static BigDecimal money(double value) {
        return BigDecimal.valueOf(value).setScale(2, RoundingMode.HALF_UP);
    }

    private static BigDecimal cap(BigDecimal value, BigDecimal max) {
        return value.signum() <= 0 ? ZERO : value.min(max);
    }

    // ------------------------------------------------------------------ shipping, seller, tax

    private CommerceShippingCalculator.Rule shippingRule(String instituteId) {
        try {
            return shippingRuleService.activeRule(instituteId);
        } catch (IllegalArgumentException e) {
            // A stored rule that cannot be read must not turn into free delivery.
            throw new CartPricingException(CartPricingException.NOT_PRICEABLE,
                    "The delivery charge of this shop is not set up correctly.");
        }
    }

    /**
     * The tax settings of a counter sale: the bill total is rounded to the whole rupee
     * ({@link RoundTotalTo#RUPEE}, the existing round-off line), whatever the shop's setting, so
     * cash due, change and a full return's cash back are whole rupees. Online and desk orders
     * keep the shop's setting.
     */
    static CommerceTaxContext counterTaxContext(CommerceTaxContext context) {
        return context.getRoundTotalTo() == RoundTotalTo.RUPEE ? context
                : context.toBuilder().roundTotalTo(RoundTotalTo.RUPEE).build();
    }

    private String fulfilmentLocation(String instituteId) {
        String configured = stockSettings.defaultFulfilmentLocationId(instituteId);
        return configured != null ? configured : variantLoader.onlineLocationId(instituteId);
    }

    private TaxRequest taxRequest(String instituteId, CommerceTaxContext context, String sellerState,
                                  String placeState, List<Priced> priced, BigDecimal orderDiscount,
                                  CommerceShippingCalculator.Quote shipping, BigDecimal codCharge,
                                  CommerceShippingCalculator.Rule rule, Map<String, TaxClassRef> taxClasses,
                                  Map<String, BigDecimal> lineDiscounts) {
        List<TaxLineInput> lines = new ArrayList<>();
        for (Priced line : priced) {
            lines.add(TaxLineInput.builder()
                    .lineRef(line.lineRef())
                    .lineType(TaxLineType.ITEM)
                    .description(line.name())
                    .unitPrice(line.unitPrice())
                    .quantity(line.quantity())
                    .qtyScale(line.variant().qtyScale())
                    .unit(line.variant().unit())
                    .lineDiscount(lineDiscounts == null ? null : lineDiscounts.get(line.lineRef()))
                    .taxClass(taxClasses.get(line.variant().taxClassId()))
                    .build());
        }
        TaxClassRef chargeClass = rule == null || rule.taxClassId() == null ? null : taxClasses.get(rule.taxClassId());
        if (shipping.charge().signum() > 0) {
            lines.add(TaxLineInput.builder().lineRef(SHIPPING_REF).lineType(TaxLineType.SHIPPING)
                    .description("Delivery").unitPrice(shipping.charge()).quantity(1).qtyScale(1)
                    .taxClass(chargeClass).build());
        }
        if (codCharge != null && codCharge.signum() > 0) {
            lines.add(TaxLineInput.builder().lineRef(COD_REF).lineType(TaxLineType.COD_CHARGE)
                    .description("Cash on delivery charge").unitPrice(codCharge).quantity(1).qtyScale(1)
                    .taxClass(chargeClass).build());
        }
        return TaxRequest.builder()
                .mode(context.getMode())
                .slabBasis(context.getSlabBasis())
                .slabCompare(context.getSlabCompare())
                .roundTotalTo(context.getRoundTotalTo())
                .sellerStateCode(sellerState)
                .placeOfSupplyState(placeState)
                .date(documentClock.today(instituteId))
                .orderDiscount(orderDiscount)
                .lines(lines)
                .build();
    }

    private TaxResult calculate(TaxRequest request) {
        try {
            return taxCalculator.calculate(request);
        } catch (InvalidRequestException e) {
            // CommerceTaxException: no tax class, no rate in force, no seller state.
            throw new CartPricingException(CartPricingException.NOT_PRICEABLE, e.getMessage());
        }
    }

    // ------------------------------------------------------------------ views

    private static CartPriceDtos.Line viewLine(Priced line, TaxResult tax) {
        BigDecimal discount = ZERO;
        BigDecimal net = ZERO;
        BigDecimal taxable = ZERO;
        BigDecimal taxAmount = ZERO;
        BigDecimal rate = null;
        String hsn = null;
        // A set taxed in parts has several tax lines under one ref; they add up to the cart line.
        for (TaxLineResult row : tax.getLines()) {
            if (row.getLineType() == TaxLineType.ITEM && line.lineRef().equals(row.getLineRef())) {
                discount = discount.add(row.getLineDiscount()).add(row.getOrderDiscount());
                net = net.add(row.getNet());
                taxable = taxable.add(row.getTaxableValue());
                taxAmount = taxAmount.add(row.getTaxAmount());
                rate = rate == null ? row.getRatePercent() : rate.max(row.getRatePercent());
                hsn = hsn == null ? row.getHsnCode() : hsn;
            }
        }
        CartVariant v = line.variant();
        return CartPriceDtos.Line.builder()
                .lineRef(line.lineRef()).variantId(v.packageSessionId()).sku(v.sku()).slug(v.slug())
                .name(line.name()).variantLabel(line.variantLabel()).quantity(line.quantity())
                .qtyScale(v.qtyScale()).qtyStep(v.qtyStep()).piece(v.piece()).unit(v.unit())
                .unitPrice(line.unitPrice()).compareAtPrice(v.mrp()).gross(line.gross()).discount(discount).net(net)
                .hsnCode(hsn).taxRatePercent(rate).taxableValue(taxable).taxAmount(taxAmount)
                .build();
    }

    private static CartPriceDtos.Shipping viewShipping(CommerceShippingCalculator.Quote quote) {
        return CartPriceDtos.Shipping.builder()
                .basis(quote.basis() == null ? null : quote.basis().name())
                .charge(quote.charge())
                .chargeBeforeFree(quote.baseCharge())
                .free(quote.free())
                .freeAbove(quote.freeAbove())
                .remainingForFree(quote.remainingForFree())
                .build();
    }

    private static CartPriceDtos.Cod viewCod(CodEligibility.Result cod) {
        return CartPriceDtos.Cod.builder()
                .eligible(cod.eligible())
                .reason(cod.reasonCode())
                .charge(cod.charge())
                .maxOrderValue(cod.maxOrderValue())
                .totalWithCod(cod.totalWithCod())
                .needsStaffConfirmation(cod.needsStaffConfirmation())
                .otpRequired(true)
                .pincodeChecked(cod.pincodeChecked())
                .build();
    }

    private static CartPriceDtos.Tax viewTax(TaxResult tax, boolean placeKnown) {
        List<CartPriceDtos.TaxRow> rows = new ArrayList<>();
        if (tax.getRateRows() != null) {
            for (TaxRateRow row : tax.getRateRows()) {
                rows.add(CartPriceDtos.TaxRow.builder().ratePercent(row.getRatePercent())
                        .taxableValue(row.getTaxableValue()).cgst(row.getCgst()).sgst(row.getSgst())
                        .igst(row.getIgst()).cess(row.getCess()).taxAmount(row.getTaxAmount()).build());
            }
        }
        return CartPriceDtos.Tax.builder()
                .head(tax.getTaxHead() == null ? null : tax.getTaxHead().name())
                .placeOfSupplyState(tax.getPlaceOfSupplyState())
                .placeOfSupplyKnown(placeKnown)
                .taxableValue(tax.getTaxableValue()).cgst(tax.getCgst()).sgst(tax.getSgst()).igst(tax.getIgst())
                .cess(tax.getCess()).taxAmount(tax.getTaxAmount()).rows(rows)
                .build();
    }

    /** No line can be bought: totals of zero, the reasons, and no snapshot to store. */
    private CartPrice empty(String instituteId, CartPriceRequest request, StorefrontSettings settings,
                            List<CartPriceDtos.UnavailableLine> unavailable, List<CartPriceDtos.Change> changes,
                            String pincode, String placeState, String placeSource, BigDecimal codCharge,
                            CommerceShippingCalculator.Rule rule) {
        CommerceShippingCalculator.Quote shipping = CommerceShippingCalculator.quote(rule, ZERO, 0);
        CodEligibility.Result cod = CodEligibility.check(codAvailability.effectiveCod(settings.cod()), ZERO, pincode,
                codCharge);
        CartPriceDtos.Coupon coupon = trim(request.getCouponCode()) == null ? null
                : CartPriceDtos.Coupon.builder().code(trim(request.getCouponCode()).toUpperCase(Locale.ROOT))
                .applied(false).reason(CodEligibility.CART_EMPTY).discount(ZERO).build();
        CartPriceDtos.CartPrice view = CartPriceDtos.CartPrice.builder()
                .currency("INR")
                .paymentMethod(CartPriceRequest.PREPAID)
                .lines(List.of())
                .unavailable(unavailable)
                .changes(changes)
                .discounts(List.of())
                .coupon(coupon)
                .shipping(CartPriceDtos.Shipping.builder()
                        .basis(shipping.basis() == null ? null : shipping.basis().name()).charge(ZERO)
                        .chargeBeforeFree(ZERO).free(false).freeAbove(shipping.freeAbove())
                        .remainingForFree(shipping.remainingForFree()).build())
                .cod(viewCod(cod))
                .tax(CartPriceDtos.Tax.builder().head(null).placeOfSupplyState(placeState)
                        .placeOfSupplyKnown(placeState != null).taxableValue(ZERO).cgst(ZERO).sgst(ZERO).igst(ZERO)
                        .cess(ZERO).taxAmount(ZERO).rows(List.of()).build())
                .totals(CartPriceDtos.Totals.builder().subtotal(ZERO).discount(ZERO).shipping(ZERO).codCharge(ZERO)
                        .roundOff(ZERO).total(ZERO).lineCount(0).build())
                .build();
        return new CartPrice(null, view);
    }

    private static String trim(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
