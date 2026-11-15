package vacademy.io.admin_core_service.features.commerce.order.checkout;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.commerce.customer.entity.CommerceCustomer;
import vacademy.io.admin_core_service.features.commerce.customer.service.CommerceCustomerService;
import vacademy.io.admin_core_service.features.commerce.order.dto.CartPriceRequest;
import vacademy.io.admin_core_service.features.commerce.order.dto.CartPriceSnapshot;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrder;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderLine;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderStatusHistory;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderTender;
import vacademy.io.admin_core_service.features.commerce.order.enums.CommerceOrderStatus;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderLegacyRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderLegacyRepository.SaleLinkRow;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderLineRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderStatusHistoryRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderTenderRepository;
import vacademy.io.admin_core_service.features.commerce.order.service.CommerceOrderTransitions;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxLineResult;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxResult;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxLineType;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.repository.EnrollInviteRepository;
import vacademy.io.admin_core_service.features.stock_hold.entity.StockHold;
import vacademy.io.admin_core_service.features.stock_hold.enums.StockHoldKind;
import vacademy.io.admin_core_service.features.stock_hold.service.StockHoldService;
import vacademy.io.admin_core_service.features.user_subscription.entity.AppliedCouponDiscount;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentOption;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.enums.UserPlanSourceEnum;
import vacademy.io.admin_core_service.features.user_subscription.enums.UserPlanStatusEnum;
import vacademy.io.admin_core_service.features.user_subscription.repository.AppliedCouponDiscountRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentOptionRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentPlanRepository;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentLogService;
import vacademy.io.admin_core_service.features.user_subscription.service.UserPlanService;
import vacademy.io.admin_core_service.features.user_subscription.service.coupon.CouponRedemptionService;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.payment.dto.PaymentInitiationRequestDTO;
import vacademy.io.common.payment.enums.PaymentGateway;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * The rows of one placed order, written inside the caller's transaction. Nothing here calls
 * another service over the network.
 *
 * <p>{@link #writeMoneyRows} is the direct write the owner decided on: one {@code user_plan}
 * and one {@code payment_log} per item line and a {@code stock_hold} per stock-tracked variant,
 * through the existing services, and <b>no enrolment row</b> on any channel. It never goes
 * through {@code MultiPackageLearnerEnrollService}.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class CommerceOrderWriter {

    public static final String CHANNEL_ONLINE = "ONLINE";
    public static final String PAYMENT_UNPAID = "UNPAID";
    public static final String PAYMENT_PAID = "PAID";
    static final String ORDER_COUNTER_SCOPE = "ORD";
    /**
     * The stock of a shop order is held this much longer than the order's own hold time: the
     * lost-webhook fetch asks the gateway once more in that gap, before the hold-expiry job
     * releases the stock and so expires the order.
     */
    public static final int FINAL_FETCH_GRACE_MINUTES = 3;
    private static final BigDecimal ZERO = BigDecimal.ZERO.setScale(2);

    private final CommerceOrderRepository orderRepository;
    private final CommerceOrderLineRepository lineRepository;
    private final CommerceOrderTenderRepository tenderRepository;
    private final CommerceOrderStatusHistoryRepository historyRepository;
    private final CommerceOrderLegacyRepository legacyRepository;
    private final CommerceCustomerService customerService;
    private final StockHoldService stockHoldService;
    private final UserPlanService userPlanService;
    private final PaymentLogService paymentLogService;
    private final EnrollInviteRepository enrollInviteRepository;
    private final PaymentOptionRepository paymentOptionRepository;
    private final PaymentPlanRepository paymentPlanRepository;
    private final AppliedCouponDiscountRepository appliedCouponDiscountRepository;
    private final CouponRedemptionService couponRedemptionService;
    private final ObjectMapper objectMapper;

    /** Everything the transaction needs; resolved before it opens. */
    public record NewOrder(String instituteId, String orderNumber, String clientRequestId, String requestHash,
                           String userId, String phone, String name, String email,
                           Map<String, Object> shippingAddress, Map<String, Object> billingAddress,
                           CommerceCustomerService.AddressInput addressToRemember, boolean marketingConsent,
                           String buyerGstin, String customerNote, String giftNote,
                           CartPriceSnapshot snapshot, int holdMinutes, boolean phoneVerified,
                           boolean buyerIsHolder) {

        /** Without the buyer kind: the user is not the phone's holder. */
        public NewOrder(String instituteId, String orderNumber, String clientRequestId, String requestHash,
                        String userId, String phone, String name, String email,
                        Map<String, Object> shippingAddress, Map<String, Object> billingAddress,
                        CommerceCustomerService.AddressInput addressToRemember, boolean marketingConsent,
                        String buyerGstin, String customerNote, String giftNote,
                        CartPriceSnapshot snapshot, int holdMinutes, boolean phoneVerified) {
            this(instituteId, orderNumber, clientRequestId, requestHash, userId, phone, name, email, shippingAddress,
                    billingAddress, addressToRemember, marketingConsent, buyerGstin, customerNote, giftNote, snapshot,
                    holdMinutes, phoneVerified, false);
        }
    }

    /** The saved order and, once only, the raw token that releases its holds. */
    public record Written(CommerceOrder order, List<CommerceOrderLine> lines, String releaseToken) {
    }

    /** What {@link #writeMoneyRows} wrote. */
    public record MoneyRows(String primaryPaymentLogId, List<String> paymentLogIds, List<StockHold> holds,
                            String releaseToken) {
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public Written write(NewOrder n) {
        CartPriceSnapshot snapshot = n.snapshot();
        TaxResult tax = snapshot.getTax();

        // A phone typed at checkout proves nothing. Only a shopper who proved the phone (OTP)
        // may write into the customer of that phone: its account, name, e-mail, marketing
        // consent and address book. Anyone else gets the row of the phone as it is (made with
        // the phone alone when the shop has not seen it), and the order is the only thing that
        // carries what they typed.
        // The customer row keeps only the phone's holder account: an account picked by an
        // e-mail (even beside a proved phone) is the order's buyer, never the phone's.
        CommerceCustomer customer;
        if (n.phoneVerified()) {
            customer = customerService.upsert(n.instituteId(), n.buyerIsHolder() ? n.userId() : null, n.phone(),
                    n.name(), n.email());
            if (n.marketingConsent()) {
                customerService.recordConsent(customer, "CHECKOUT");
            }
            if (n.addressToRemember() != null) {
                customerService.remember(n.instituteId(), customer.getId(), n.addressToRemember());
            }
        } else {
            customer = customerService.findOrCreateUnverified(n.instituteId(), n.phone());
        }

        CartPriceSnapshot.Discount coupon = couponOf(snapshot);

        Date holdExpiresAt = new Date(System.currentTimeMillis() + n.holdMinutes() * 60_000L);
        CommerceOrder order = new CommerceOrder();
        order.setInstituteId(n.instituteId());
        order.setOrderNumber(n.orderNumber());
        order.setPaymentGroupId(UUID.randomUUID().toString());
        order.setChannel(CHANNEL_ONLINE);
        order.setUserId(n.userId());
        order.setCustomerId(customer.getId());
        order.setCustomerName(n.name());
        order.setCustomerPhone(n.phone());
        order.setCustomerEmail(n.email());
        order.setPhoneVerified(n.phoneVerified());
        order.setShippingAddressJson(json(n.shippingAddress()));
        order.setBillingAddressJson(json(n.billingAddress() == null ? n.shippingAddress() : n.billingAddress()));
        order.setBuyerGstin(n.buyerGstin());
        order.setPlaceOfSupplyState(snapshot.getPlaceOfSupplyState());
        order.setSubtotal(money(tax.getSubtotal()));
        order.setDiscount(money(tax.getDiscount()));
        order.setShipping(money(tax.getShipping()));
        order.setCodCharge(money(tax.getCodCharge()));
        order.setTax(money(tax.getTaxAmount()));
        order.setRoundOff(money(tax.getRoundOff()));
        order.setTotal(money(snapshot.getTotal()));
        order.setAmountPaid(ZERO);
        order.setCurrency(snapshot.getCurrency());
        order.setPaymentMethod(CartPriceRequest.PREPAID);
        order.setPaymentStatus(PAYMENT_UNPAID);
        CommerceOrderTransitions.require(null, CommerceOrderStatus.PENDING_PAYMENT);
        order.setStatus(CommerceOrderStatus.PENDING_PAYMENT.name());
        order.setFulfilmentLocationId(snapshot.getFulfilmentLocationId());
        order.setCustomerNote(n.customerNote());
        order.setGiftNote(n.giftNote());
        order.setClientRequestId(n.clientRequestId());
        order.setRequestHash(n.requestHash());
        order.setLocale(snapshot.getLocale());
        order.setCreatedBy(n.userId());
        order.setPriceSnapshotJson(json(snapshot));
        if (coupon != null) {
            order.setCouponCode(coupon.getCode());
            order.setAppliedCouponDiscountId(coupon.getAppliedCouponDiscountId());
        }
        order.setHoldExpiresAt(holdExpiresAt);
        // Flushed here: a second request with the same client_request_id fails on the unique
        // key now, before any stock is held, any plan is written or the coupon is touched.
        order = orderRepository.saveAndFlush(order);
        // After the flush, so that the duplicate of a request never reaches it: the duplicate
        // would find the last use gone and be told "coupon not available" for its own order.
        redeemOnce(coupon);

        List<CommerceOrderLine> lines = lineRepository.saveAll(buildLines(order, snapshot));
        // The stock is held a little longer than the order (see FINAL_FETCH_GRACE_MINUTES).
        MoneyRows money = writeMoneyRows(order, lines, n.holdMinutes() + FINAL_FETCH_GRACE_MINUTES);
        lines = lineRepository.saveAll(lines);
        order.setPrimaryPaymentLogId(money.primaryPaymentLogId());
        order = orderRepository.save(order);

        CommerceOrderTender tender = new CommerceOrderTender();
        tender.setInstituteId(order.getInstituteId());
        tender.setOrderId(order.getId());
        tender.setMode(CommerceOrderTender.MODE_GATEWAY);
        tender.setAmount(order.getTotal());
        tender.setStatus(CommerceOrderTender.STATUS_PENDING);
        tenderRepository.save(tender);

        history(order, null, CommerceOrderStatus.PENDING_PAYMENT, n.userId(), "Order placed");
        return new Written(order, lines, money.releaseToken());
    }

    /**
     * The legacy money rows of an order: a stock hold per stock-tracked variant, then per ITEM
     * line a {@code user_plan} (PENDING_FOR_PAYMENT) and a {@code payment_log} (PAYMENT_PENDING)
     * that all share the order's payment group. The log amounts sum exactly to the order
     * total: the delivery charge and the round-off have no log of their own and ride on the
     * log of the largest item line. Every log carries the order id as
     * {@code originalRequest.order_id}, the reference the gateway order and the webhook use.
     *
     * <p>Sets {@code userPlanId}, {@code paymentLogId} and {@code logAmount} on the lines; the
     * caller saves them. Commerce code does not load or save a {@code PackageSession} here.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public MoneyRows writeMoneyRows(CommerceOrder order, List<CommerceOrderLine> lines, int holdMinutes) {
        List<CommerceOrderLine> items = lines.stream()
                .filter(line -> CommerceOrderLine.TYPE_ITEM.equals(line.getLineType())).toList();
        if (items.isEmpty()) {
            throw new IllegalStateException("an order needs at least one item line");
        }
        Map<String, Integer> quantities = new LinkedHashMap<>();
        for (CommerceOrderLine line : items) {
            if (quantities.put(line.getPackageSessionId(), line.getQuantity()) != null) {
                throw CheckoutException.invalid("The same item is on two lines; send it once with the full quantity.");
            }
        }

        // 1. The sale link of every variant, read as the cart read it. A package session of
        //    another institute, or one that is not a variant, has no link and stops the order:
        //    StockHoldService.hold would skip it without a word.
        Map<String, SaleLinkRow> links = new HashMap<>();
        Set<String> decided = new LinkedHashSet<>();
        for (SaleLinkRow row : legacyRepository.findSaleLinks(order.getInstituteId(), quantities.keySet())) {
            if (decided.add(row.getPackageSessionId()) && row.getPaymentPlanId() != null) {
                links.put(row.getPackageSessionId(), row);
            }
        }
        for (CommerceOrderLine line : items) {
            SaleLinkRow link = links.get(line.getPackageSessionId());
            if (link == null || link.getActualPrice() == null
                    || link.getActualPrice().compareTo(line.getUnitPrice()) != 0
                    || (link.getCurrency() != null && !link.getCurrency().equalsIgnoreCase(order.getCurrency()))) {
                // The price or the product changed between pricing and this transaction.
                throw new CheckoutException(HttpStatus.CONFLICT, CheckoutException.CART_CHANGED,
                        "An item in the cart changed. Please review the cart and try again.");
            }
        }

        // 2. Stock, sorted by package session inside hold().
        List<StockHold> holds;
        try {
            holds = stockHoldService.hold(order.getInstituteId(), quantities, StockHoldKind.PURCHASE, holdMinutes);
        } catch (ConflictException e) {
            throw new CheckoutException(HttpStatus.CONFLICT, CheckoutException.OUT_OF_STOCK,
                    "An item in the cart is no longer in stock in the quantity asked.");
        }
        Map<String, StockHold> holdBySession = new HashMap<>();
        for (StockHold hold : holds) {
            holdBySession.put(hold.getPackageSessionId(), hold);
        }

        // 3. Log amounts that sum to the order total.
        Map<String, BigDecimal> logAmounts = logAmounts(order.getTotal(), items);

        // 4. One plan and one log per item line.
        Map<String, EnrollInvite> invites = new HashMap<>();
        Map<String, PaymentOption> options = new HashMap<>();
        Map<String, PaymentPlan> plans = new HashMap<>();
        List<String> logIds = new ArrayList<>();
        for (CommerceOrderLine line : items) {
            SaleLinkRow link = links.get(line.getPackageSessionId());
            EnrollInvite invite = invites.computeIfAbsent(link.getEnrollInviteId(),
                    id -> enrollInviteRepository.findById(id).orElseThrow(() -> missing("invite")));
            PaymentOption option = options.computeIfAbsent(link.getPaymentOptionId(),
                    id -> paymentOptionRepository.findById(id).orElseThrow(() -> missing("payment option")));
            PaymentPlan plan = plans.computeIfAbsent(link.getPaymentPlanId(),
                    id -> paymentPlanRepository.findById(id).orElseThrow(() -> missing("payment plan")));
            BigDecimal amount = logAmounts.get(line.getId());

            PaymentInitiationRequestDTO payment = new PaymentInitiationRequestDTO();
            payment.setAmount(amount.doubleValue());
            payment.setCurrency(order.getCurrency());
            payment.setOrderId(order.getId());
            payment.setInstituteId(order.getInstituteId());
            payment.setVendor(PaymentGateway.RAZORPAY.name());

            // No coupon is handed down: commerce redeems it itself, once for the order.
            UserPlan userPlan = userPlanService.createUserPlan(order.getUserId(), plan, null, invite, option,
                    payment, UserPlanStatusEnum.PENDING_FOR_PAYMENT.name(), UserPlanSourceEnum.USER.name(), null,
                    null, null, line.getQuantity());
            String logId = paymentLogService.createPaymentLog(order.getUserId(), amount.doubleValue(),
                    PaymentGateway.RAZORPAY.name(), PaymentGateway.RAZORPAY.name(), order.getCurrency(), userPlan,
                    order.getId());
            line.setUserPlanId(userPlan.getId());
            line.setPaymentLogId(logId);
            line.setLogAmount(amount);
            logIds.add(logId);

            StockHold hold = holdBySession.get(line.getPackageSessionId());
            if (hold != null) {
                stockHoldService.attach(List.of(hold), order.getUserId(), userPlan.getId(), null);
            }
        }

        // 5. The group, the pending status and the order's one "payment log of the holds".
        String primaryLogId = logIds.get(0);
        if (legacyRepository.markLogsPending(logIds, order.getPaymentGroupId()) != logIds.size()) {
            throw new IllegalStateException("payment logs of order " + order.getId() + " could not be grouped");
        }
        String releaseToken = null;
        if (!holds.isEmpty()) {
            stockHoldService.attach(holds, null, null, primaryLogId);
            releaseToken = holds.get(0).getReleaseToken();
            if (StringUtils.hasText(order.getFulfilmentLocationId())) {
                legacyRepository.setHoldLocation(holds.stream().map(StockHold::getId).toList(),
                        order.getFulfilmentLocationId());
            }
        }
        return new MoneyRows(primaryLogId, logIds, holds, releaseToken);
    }

    /**
     * What each item line's payment log carries. Every line starts with its own total; the
     * rest of the order total (delivery, COD charge, round-off) goes on the largest line.
     *
     * @return amounts by line id, each at least zero, summing to {@code orderTotal}
     */
    static Map<String, BigDecimal> logAmounts(BigDecimal orderTotal, List<CommerceOrderLine> items) {
        Map<String, BigDecimal> out = new LinkedHashMap<>();
        BigDecimal sum = ZERO;
        CommerceOrderLine largest = null;
        for (CommerceOrderLine line : items) {
            BigDecimal amount = money(line.getLineTotal());
            out.put(line.getId(), amount);
            sum = sum.add(amount);
            if (largest == null || amount.compareTo(money(largest.getLineTotal())) > 0) {
                largest = line;
            }
        }
        BigDecimal rest = money(orderTotal).subtract(sum);
        if (rest.signum() != 0) {
            BigDecimal carried = out.get(largest.getId()).add(rest);
            if (carried.signum() < 0) {
                throw new IllegalStateException("the order total is lower than its lines allow");
            }
            out.put(largest.getId(), carried);
        }
        BigDecimal check = out.values().stream().reduce(ZERO, BigDecimal::add);
        if (check.compareTo(money(orderTotal)) != 0) {
            throw new IllegalStateException("payment log amounts do not sum to the order total");
        }
        return out;
    }

    /** The order lines of a snapshot: one per cart line, then delivery and the COD charge. */
    static List<CommerceOrderLine> buildLines(CommerceOrder order, CartPriceSnapshot snapshot) {
        Map<String, List<TaxLineResult>> taxByRef = new LinkedHashMap<>();
        for (TaxLineResult taxLine : snapshot.getTax().getLines()) {
            taxByRef.computeIfAbsent(taxLine.getLineRef(), k -> new ArrayList<>()).add(taxLine);
        }
        List<CommerceOrderLine> lines = new ArrayList<>();
        int no = 1;
        for (CartPriceSnapshot.Line item : snapshot.getLines()) {
            List<TaxLineResult> taxLines = taxByRef.remove(item.getLineRef());
            if (taxLines == null || taxLines.isEmpty()) {
                throw new IllegalStateException("cart line " + item.getLineRef() + " has no tax line");
            }
            CommerceOrderLine line = base(order, no++, CommerceOrderLine.TYPE_ITEM, item.getLineRef(), taxLines);
            line.setPackageSessionId(item.getPackageSessionId());
            line.setPackageId(item.getPackageId());
            line.setNameSnapshot(clip(item.getName(), 500));
            line.setSkuSnapshot(clip(item.getSku(), 100));
            line.setVariantLabel(clip(item.getVariantLabel(), 300));
            line.setUnit(item.getUnit());
            line.setQtyScale(Math.max(1, item.getQtyScale()));
            line.setQuantity(item.getQuantity());
            line.setUnitPrice(money(item.getUnitPrice()));
            line.setMrp(item.getMrp() == null ? null : money(item.getMrp()));
            line.setTaxClassId(item.getTaxClassId());
            line.setWeightGrams(item.getWeightGrams());
            lines.add(line);
        }
        for (Map.Entry<String, List<TaxLineResult>> rest : taxByRef.entrySet()) {
            TaxLineResult first = rest.getValue().get(0);
            if (first.getLineType() == TaxLineType.ITEM) {
                throw new IllegalStateException("tax line " + rest.getKey() + " has no cart line");
            }
            CommerceOrderLine line = base(order, no++, first.getLineType().name(), rest.getKey(), rest.getValue());
            line.setNameSnapshot(clip(first.getDescription(), 500));
            line.setQtyScale(1);
            line.setQuantity(1);
            line.setUnitPrice(line.getGross());
            line.setTaxClassId(first.getTaxClassId());
            lines.add(line);
        }
        return lines;
    }

    private static CommerceOrderLine base(CommerceOrder order, int no, String type, String ref,
                                          List<TaxLineResult> taxLines) {
        BigDecimal gross = ZERO;
        BigDecimal discount = ZERO;
        BigDecimal taxable = ZERO;
        BigDecimal taxAmount = ZERO;
        for (TaxLineResult taxLine : taxLines) {
            gross = gross.add(money(taxLine.getGross()));
            discount = discount.add(money(taxLine.getLineDiscount())).add(money(taxLine.getOrderDiscount()));
            taxable = taxable.add(money(taxLine.getTaxableValue()));
            taxAmount = taxAmount.add(money(taxLine.getTaxAmount()));
        }
        TaxLineResult first = taxLines.get(0);
        CommerceOrderLine line = new CommerceOrderLine();
        line.setInstituteId(order.getInstituteId());
        line.setOrderId(order.getId());
        line.setLineNo(no);
        line.setLineType(type);
        line.setLineRef(clip(ref, 64));
        line.setGross(gross);
        line.setDiscount(discount);
        line.setTaxableValue(taxable);
        line.setTaxAmount(taxAmount);
        line.setLineTotal(taxable.add(taxAmount));
        // A set has one line here and several tax lines; its parts may carry different rates.
        line.setHsnCode(taxLines.size() == 1 ? clip(first.getHsnCode(), 16) : null);
        line.setTaxRate(taxLines.size() == 1 ? first.getRatePercent() : null);
        return line;
    }

    /** Appends one row to the timeline of an order. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void history(CommerceOrder order, CommerceOrderStatus from, CommerceOrderStatus to, String actorUserId,
                        String note) {
        CommerceOrderStatusHistory row = new CommerceOrderStatusHistory();
        row.setInstituteId(order.getInstituteId());
        row.setOrderId(order.getId());
        row.setFromStatus(from == null ? null : from.name());
        row.setToStatus(to.name());
        row.setActorUserId(actorUserId);
        row.setNote(clip(note, 500));
        historyRepository.save(row);
    }

    private static CartPriceSnapshot.Discount couponOf(CartPriceSnapshot snapshot) {
        if (snapshot.getDiscounts() == null) {
            return null;
        }
        for (CartPriceSnapshot.Discount discount : snapshot.getDiscounts()) {
            if ("COUPON".equals(discount.getKind())) {
                return discount;
            }
        }
        return null;
    }

    /** One redemption per order, in this transaction: a lost race rolls the whole order back. */
    private void redeemOnce(CartPriceSnapshot.Discount coupon) {
        if (coupon == null || !StringUtils.hasText(coupon.getAppliedCouponDiscountId())) {
            return;
        }
        AppliedCouponDiscount applied = appliedCouponDiscountRepository.findById(coupon.getAppliedCouponDiscountId())
                .orElseThrow(() -> couponGone());
        try {
            couponRedemptionService.consume(applied);
        } catch (VacademyException e) {
            throw couponGone();
        }
    }

    private static CheckoutException couponGone() {
        return new CheckoutException(HttpStatus.CONFLICT, CheckoutException.COUPON_NOT_AVAILABLE,
                "The coupon can no longer be used. Remove it and try again.");
    }

    private static IllegalStateException missing(String what) {
        return new IllegalStateException("the " + what + " of a variant disappeared during checkout");
    }

    private String json(Object value) {
        if (value == null) {
            return null;
        }
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("order JSON could not be written", e);
        }
    }

    static BigDecimal money(BigDecimal value) {
        return value == null ? ZERO : value.setScale(2, RoundingMode.HALF_UP);
    }

    private static String clip(String value, int max) {
        if (value == null) {
            return null;
        }
        return value.length() <= max ? value : value.substring(0, max);
    }
}
