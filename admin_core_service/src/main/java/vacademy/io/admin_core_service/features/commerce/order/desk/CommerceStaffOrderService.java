package vacademy.io.admin_core_service.features.commerce.order.desk;

import vacademy.io.admin_core_service.features.commerce.returns.entity.CommerceReturn;
import vacademy.io.admin_core_service.features.commerce.returns.enums.RefundMethod;
import vacademy.io.admin_core_service.features.commerce.returns.service.CommerceExchangeService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.common.request.CommerceRequestGuard;
import vacademy.io.admin_core_service.features.commerce.customer.CommercePhones;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CheckoutException;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceBuyerResolver;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceOrderWriter;
import vacademy.io.admin_core_service.features.commerce.order.desk.dto.StaffOrderRequest;
import vacademy.io.admin_core_service.features.commerce.order.dto.CartPriceRequest;
import vacademy.io.admin_core_service.features.commerce.order.dto.CartPriceSnapshot;
import vacademy.io.admin_core_service.features.commerce.order.dto.CheckoutRequest;
import vacademy.io.admin_core_service.features.commerce.order.dto.StaffOrderDtos;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrder;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderLine;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderTender;
import vacademy.io.admin_core_service.features.commerce.order.enums.TenderMode;
import vacademy.io.admin_core_service.features.commerce.order.pincode.PincodeStates;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderTenderRepository;
import vacademy.io.admin_core_service.features.commerce.order.service.CartPricingException;
import vacademy.io.admin_core_service.features.commerce.order.service.CommerceOrderService;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.admin_core_service.features.commerce.shipment.service.CommerceShipmentService;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLocationRepository;
import vacademy.io.admin_core_service.features.commerce.stock.service.CommerceCounterService;
import vacademy.io.admin_core_service.features.commerce.stock.service.CommerceStockSettings;
import vacademy.io.admin_core_service.features.commerce.order.checkout.BuyerIdentity;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceInputRules;
import vacademy.io.admin_core_service.features.commerce.tax.service.GstinValidator;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentLogService;
import vacademy.io.admin_core_service.features.user_subscription.service.UserPlanService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * {@code POST /orders}: an order a store manager takes by phone, on WhatsApp or for a reseller
 * (channel ADMIN, row 0c of the desk table).
 *
 * <p>Priced by the cart's own calculation; a manager may type a unit price for a line (kept on
 * the line with the catalogue price beside it, and audited). The order is CONFIRMED at once:
 * its stock is held and SOLD in the same transaction, its payment logs carry vendor OFFLINE,
 * the money taken now is RECEIVED tenders and the rest one CREDIT tender PENDING. Paid in full,
 * its logs turn PAID and its plans ACTIVE in that transaction. With {@code hand_over_now} the
 * goods leave at once: pack, ship (carrier HANDOVER) and deliver in the same transaction.
 *
 * <p>The buyer is the holder account of the typed phone, resolved before the transaction (a
 * remote call), as checkout does; the order is not phone-verified. Repeats of the request are
 * answered by {@code commerce_order.client_request_id} and its request hash.
 */
@Slf4j
@Service
public class CommerceStaffOrderService {

    static final Set<CommerceRole> MANAGER = Set.of(CommerceRole.STORE_MANAGER);
    static final int MAX_LINES = 50;
    static final int MAX_TENDERS = 10;
    private static final Pattern EMAIL = Pattern.compile("^[^@\\s]{1,64}@[^@\\s]{1,255}\\.[^@\\s.]{2,}$");
    private static final Pattern PINCODE = Pattern.compile("^[1-9][0-9]{5}$");
    private static final BigDecimal MAX_PRICE = new BigDecimal("9999999999.99");

    private final CommerceOrderDeskService desk;
    private final CommerceOrderService orderService;
    private final CommerceOrderWriter writer;
    private final CommerceOrderRepository orderRepository;
    private final CommerceOrderTenderRepository tenderRepository;
    private final CommerceBuyerResolver buyerResolver;
    private final CommerceCounterService counterService;
    private final CommerceStockSettings stockSettings;
    private final StockLocationRepository locationRepository;
    private final CommerceAccessGuard accessGuard;
    private final CommerceAuditService auditService;
    private final CommerceOrderEvents events;
    private final PaymentLogService paymentLogService;
    private final UserPlanService userPlanService;
    private final ObjectProvider<CommerceShipmentService> shipmentService;
    private final TransactionTemplate transaction;

    public CommerceStaffOrderService(CommerceOrderDeskService desk, CommerceOrderService orderService,
                                     CommerceOrderWriter writer, CommerceOrderRepository orderRepository,
                                     CommerceOrderTenderRepository tenderRepository,
                                     CommerceBuyerResolver buyerResolver, CommerceCounterService counterService,
                                     CommerceStockSettings stockSettings, StockLocationRepository locationRepository,
                                     CommerceAccessGuard accessGuard, CommerceAuditService auditService,
                                     CommerceOrderEvents events, PaymentLogService paymentLogService,
                                     UserPlanService userPlanService,
                                     ObjectProvider<CommerceShipmentService> shipmentService,
                                     PlatformTransactionManager transactionManager) {
        this.desk = desk;
        this.orderService = orderService;
        this.writer = writer;
        this.orderRepository = orderRepository;
        this.tenderRepository = tenderRepository;
        this.buyerResolver = buyerResolver;
        this.counterService = counterService;
        this.stockSettings = stockSettings;
        this.locationRepository = locationRepository;
        this.accessGuard = accessGuard;
        this.auditService = auditService;
        this.events = events;
        this.paymentLogService = paymentLogService;
        this.userPlanService = userPlanService;
        this.shipmentService = shipmentService;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    /** Exchanges (WP-32); set by Spring, absent in tests built by hand. */
    private ObjectProvider<CommerceExchangeService> exchangeProvider;
    private CommerceExchangeService exchangeService;

    @org.springframework.beans.factory.annotation.Autowired(required = false)
    public void setExchangeProvider(ObjectProvider<CommerceExchangeService> exchangeProvider) {
        this.exchangeProvider = exchangeProvider;
    }

    /** For tests built by hand. */
    public void useExchangeService(CommerceExchangeService exchangeService) {
        this.exchangeService = exchangeService;
    }

    private CommerceExchangeService exchanges() {
        if (exchangeService == null && exchangeProvider != null) {
            exchangeService = exchangeProvider.getIfAvailable();
        }
        return exchangeService;
    }

    /** A staff order as validated: what the transaction writes. */
    record Clean(String clientRequestId, String phone, String name, String email,
                 Map<String, Object> shippingAddress, Map<String, Object> billingAddress, String buyerGstin,
                 List<CartPriceRequest.Line> lines, Map<String, BigDecimal> overrides, String couponCode,
                 boolean chargeShipping, List<CommerceOrderWriter.StaffTender> tenders, boolean restOnCredit,
                 boolean handOverNow, String customerNote,
                 Map<String, CommerceShipmentService.PackLine> handOverPieces,
                 CommerceExchangeService.Ask exchange) {

        BigDecimal received() {
            return tenders.stream().map(CommerceOrderWriter.StaffTender::amount).reduce(BigDecimal.ZERO.setScale(2),
                    BigDecimal::add);
        }
    }

    /** {@code POST /orders}. Answers the new order (or, for a repeat, the order it made). */
    public Created create(CustomUserDetails user, String instituteId, StaffOrderRequest request) {
        Clean clean = validate(request);
        // Role before anything is read or priced; the location once pricing has named it.
        accessGuard.require(user, instituteId, CommerceFeature.ORDERS, MANAGER);
        String hash = CommerceRequestGuard.hash("STAFF_ORDER", request);

        CommerceOrder earlier = transaction.execute(status -> orderRepository
                .findByInstituteIdAndClientRequestId(instituteId, clean.clientRequestId()).orElse(null));
        if (earlier != null) {
            return replay(user, instituteId, earlier, hash);
        }

        CartPriceSnapshot snapshot = price(instituteId, clean);
        desk.authorize(user, instituteId, snapshot.getFulfilmentLocationId(), MANAGER);
        BigDecimal total = snapshot.getTotal();
        BigDecimal received = clean.received();
        if (clean.exchange() != null) {
            // The credit of the return is known only under its lock: the tenders are checked there.
            if (exchanges() == null) {
                throw new ConflictException(CommerceExchangeService.EXCHANGE_NOT_AVAILABLE + ": exchanges are not "
                        + "available");
            }
            // The exchange spends the return's credit: the caller must manage the return's
            // location too (as POST /refunds with a return_id), not only the new order's.
            CommerceReturn exchanged = transaction.execute(status -> exchanges().readReturn(instituteId,
                    clean.exchange().returnId()));
            desk.authorize(user, instituteId, exchanged == null ? null : exchanged.getLocationId(), MANAGER);
        } else if (received.compareTo(total) > 0) {
            throw new InvalidRequestException("TENDERS_OVER: the money received (" + received.toPlainString()
                    + ") is more than the order total (" + total.toPlainString() + ")");
        }
        if (clean.exchange() == null && received.compareTo(total) < 0 && !clean.restOnCredit()) {
            throw new InvalidRequestException("TENDERS_SHORT: " + total.subtract(received).toPlainString()
                    + " is not paid; record it or leave it on credit (rest_on_credit)");
        }

        // Remote, then the counter in its own short transaction: nothing is locked meanwhile.
        String userId;
        try {
            userId = buyerResolver.resolve(instituteId, BuyerIdentity.PHONE_OTP, clean.phone(), clean.name(), null,
                    true).userId();
        } catch (CheckoutException e) {
            throw refusal(e);
        }
        String orderNumber = counterService.nextNumber(instituteId, CommerceOrderWriter.ORDER_COUNTER_SCOPE);
        int holdMinutes = stockSettings.holdMinutes(instituteId);
        String actor = user.getUserId();
        CommerceOrderWriter.StaffNewOrder newOrder = new CommerceOrderWriter.StaffNewOrder(instituteId, orderNumber,
                clean.clientRequestId(), hash, userId, actor, clean.phone(), clean.name(), clean.email(),
                clean.shippingAddress(), clean.billingAddress(), clean.buyerGstin(), clean.customerNote(), snapshot,
                holdMinutes, clean.tenders(), clean.restOnCredit());
        String orderId;
        try {
            orderId = transaction.execute(status -> write(newOrder, clean, actor));
        } catch (DataIntegrityViolationException e) {
            CommerceOrder winner = transaction.execute(status -> orderRepository
                    .findByInstituteIdAndClientRequestId(instituteId, clean.clientRequestId()).orElse(null));
            if (winner == null) {
                throw e;
            }
            return replay(user, instituteId, winner, hash);
        } catch (CheckoutException e) {
            throw refusal(e);
        }
        if (clean.exchange() != null) {
            exchanges().executeRemainder(instituteId, orderId);
        }
        return new Created(desk.detail(instituteId, orderId, user, false), false);
    }

    /** The answer of the route: the detail, and whether it answers an earlier request. */
    public record Created(StaffOrderDtos.StaffOrderDetail detail, boolean replayed) {
    }

    /** Inside the order transaction. Returns the order id. */
    String write(CommerceOrderWriter.StaffNewOrder newOrder, Clean clean, String actor) {
        CommerceExchangeService.Locked exchange = null;
        if (clean.exchange() != null) {
            // The old order and the return are locked before anything of the new order is written.
            exchange = exchanges().lock(newOrder.instituteId(), clean.exchange());
            BigDecimal total = newOrder.snapshot().getTotal();
            BigDecimal applied = CommerceExchangeService.applied(exchange.credit(), total);
            BigDecimal received = clean.received().add(applied);
            if (received.compareTo(total) > 0) {
                throw new InvalidRequestException("TENDERS_OVER: the money received and the exchange credit ("
                        + received.toPlainString() + ") are more than the order total (" + total.toPlainString() + ")");
            }
            if (received.compareTo(total) < 0 && !clean.restOnCredit()) {
                throw new InvalidRequestException("TENDERS_SHORT: " + total.subtract(received).toPlainString()
                        + " is not paid; record it or leave it on credit (rest_on_credit)");
            }
            CommerceExchangeService.requireRemainder(clean.exchange(), exchange.credit(), total);
            List<CommerceOrderWriter.StaffTender> tenders = new ArrayList<>();
            tenders.add(new CommerceOrderWriter.StaffTender(TenderMode.CREDIT_NOTE.name(), applied,
                    exchange.creditNoteNumber()));
            tenders.addAll(newOrder.tenders());
            newOrder = new CommerceOrderWriter.StaffNewOrder(newOrder.instituteId(), newOrder.orderNumber(),
                    newOrder.clientRequestId(), newOrder.requestHash(), newOrder.userId(), newOrder.actorUserId(),
                    newOrder.phone(), newOrder.name(), newOrder.email(), newOrder.shippingAddress(),
                    newOrder.billingAddress(), newOrder.buyerGstin(), newOrder.customerNote(), newOrder.snapshot(),
                    newOrder.holdMinutes(), tenders, newOrder.restOnCredit());
        }
        CommerceOrderWriter.Written written = writer.writeStaff(newOrder);
        CommerceOrder order = written.order();
        if (exchange != null) {
            order.setExchangeOfOrderId(exchange.oldOrder().getId());
            order = orderRepository.save(order);
            exchanges().apply(exchange, order, clean.exchange(), actor);
        }
        List<CommerceOrderLine> lines = written.lines();
        for (CommerceOrderLine line : CommerceOrderDeskService.items(lines)) {
            if (line.getListUnitPrice() == null) {
                continue;
            }
            Map<String, Object> old = new LinkedHashMap<>();
            old.put("unit_price", line.getListUnitPrice().toPlainString());
            Map<String, Object> now = new LinkedHashMap<>();
            now.put("unit_price", line.getUnitPrice().toPlainString());
            now.put("line_no", line.getLineNo());
            now.put("sku", line.getSkuSnapshot());
            auditService.record(order.getInstituteId(), actor, order.getFulfilmentLocationId(), "LINE_PRICE_OVERRIDE",
                    "ORDER_LINE", line.getId(), CommerceInputRules.json(old), CommerceInputRules.json(now), null);
        }
        if (CommerceOrderWriter.PAYMENT_PAID.equals(order.getPaymentStatus())) {
            settlePaid(order, lines);
        }
        for (CommerceOrderTender tender : tenderRepository.findByOrderIdOrderByCreatedAtAsc(order.getId())) {
            if (CommerceOrderTender.STATUS_RECEIVED.equals(tender.getStatus())) {
                String instituteId = order.getInstituteId();
                String orderId = order.getId();
                String tenderId = tender.getId();
                String mode = tender.getMode();
                BigDecimal amount = tender.getAmount();
                desk.afterCommitMoney(hook -> hook.tenderReceived(instituteId, orderId, tenderId, mode, amount));
            }
        }
        if (clean.handOverNow()) {
            shipmentService.getObject().handOverInside(order, lines, clean.handOverPieces(), actor);
        }
        // A sale handed over at the counter is a bill (the counter sale); anything else is an order
        // to be delivered later.
        events.afterCommit(desk.event(clean.handOverNow() ? CommerceOrderEvents.POS_BILL_ISSUED
                : CommerceOrderEvents.ORDER_CONFIRMED, order, null, true));
        log.info("Commerce staff order {} ({}) created for institute {}: {} line(s), total {} {}, {}",
                order.getOrderNumber(), order.getId(), order.getInstituteId(), lines.size(), order.getTotal(),
                order.getCurrency(), order.getPaymentStatus());
        return order.getId();
    }

    /**
     * A staff order (or its last receipt) is paid in full: the logs of the lines that still have
     * units turn PAID and their plans ACTIVE, in the caller's transaction. A fully cancelled
     * line's log stays as it is (amount 0, never claimed).
     */
    public void settlePaid(CommerceOrder order, List<CommerceOrderLine> lines) {
        Map<String, String> planOfLog = new LinkedHashMap<>();
        for (CommerceOrderLine line : CommerceOrderDeskService.items(lines)) {
            if (line.liveQuantity() > 0 && StringUtils.hasText(line.getPaymentLogId())) {
                planOfLog.put(line.getPaymentLogId(), line.getUserPlanId());
            }
        }
        if (planOfLog.isEmpty()) {
            return;
        }
        List<String> claimed = paymentLogService.markCommerceLogsPaid(planOfLog.keySet());
        for (String logId : claimed) {
            String planId = planOfLog.get(logId);
            if (StringUtils.hasText(planId)) {
                userPlanService.activateCommercePlan(userPlanService.findById(planId));
            }
        }
    }

    private Created replay(CustomUserDetails user, String instituteId, CommerceOrder earlier, String hash) {
        if (!hash.equals(earlier.getRequestHash()) || !CommerceOrderWriter.CHANNEL_ADMIN.equals(earlier.getChannel())) {
            throw new ConflictException(CommerceRequestGuard.IDEMPOTENCY_MISMATCH
                    + ": client_request_id was already used for another request");
        }
        desk.authorize(user, instituteId, earlier.getFulfilmentLocationId(), MANAGER);
        return new Created(desk.detail(instituteId, earlier.getId(), user, true), true);
    }

    // ------------------------------------------------------------------ pricing

    CartPriceSnapshot price(String instituteId, Clean clean) {
        Map<String, Object> shipping = clean.shippingAddress();
        String pincode = shipping == null ? null : (String) shipping.get("pincode");
        String stateCode = shipping == null ? null : (String) shipping.get("state_code");
        CartPriceSnapshot snapshot = priceOnce(instituteId, clean, pincode, stateCode);
        if (snapshot.getPlaceOfSupplyState() == null && shipping == null) {
            // Sold at the shop: the place of supply is the state of the location it leaves from.
            String locationState = snapshot.getFulfilmentLocationId() == null ? null
                    : locationRepository.findByInstituteIdAndId(instituteId, snapshot.getFulfilmentLocationId())
                    .map(location -> location.getStateCode()).orElse(null);
            if (locationState != null) {
                snapshot = priceOnce(instituteId, clean, null, locationState);
            }
        }
        if (snapshot.getPlaceOfSupplyState() == null) {
            throw CommerceOrderDeskService.validation("the delivery address needs a valid pincode or state");
        }
        if (snapshot.getTotal() == null || snapshot.getTotal().signum() <= 0) {
            throw new ConflictException(CheckoutException.NOT_PRICEABLE + ": an order with nothing to pay cannot "
                    + "be created");
        }
        return snapshot;
    }

    private CartPriceSnapshot priceOnce(String instituteId, Clean clean, String pincode, String stateCode) {
        CartPriceRequest cart = CartPriceRequest.builder()
                .lines(clean.lines())
                .couponCode(clean.couponCode())
                .pincode(pincode)
                .stateCode(stateCode)
                .paymentMethod(CartPriceRequest.PREPAID)
                .email(clean.email())
                .build();
        CommerceOrderService.CartPrice priced;
        try {
            priced = orderService.priceCart(instituteId, cart,
                    new CommerceOrderService.StaffPricing(clean.overrides(), clean.chargeShipping()));
        } catch (CartPricingException e) {
            if (CartPricingException.CART_INVALID.equals(e.getCode())) {
                throw CommerceOrderDeskService.validation(e.getMessage());
            }
            throw new ConflictException(CheckoutException.NOT_PRICEABLE + ": " + e.getMessage());
        }
        if (priced.view().getUnavailable() != null && !priced.view().getUnavailable().isEmpty()) {
            List<String> refs = new ArrayList<>();
            priced.view().getUnavailable().forEach(u -> refs.add(u.getLineRef() + " (" + u.getReason() + ")"));
            throw new ConflictException(CheckoutException.CART_CHANGED + ": these lines cannot be sold as asked: "
                    + String.join(", ", refs));
        }
        CartPriceSnapshot snapshot = priced.snapshot();
        if (snapshot.getLines() == null || snapshot.getLines().isEmpty() || snapshot.getTax() == null) {
            throw CommerceOrderDeskService.validation("the order has no line");
        }
        return snapshot;
    }

    // ------------------------------------------------------------------ validation

    Clean validate(StaffOrderRequest request) {
        if (request == null) {
            throw CommerceOrderDeskService.validation("the request has no body");
        }
        String key = CommerceRequestGuard.requireClientKey(request.getClientRequestId());
        StaffOrderRequest.Customer customer = request.getCustomer();
        if (customer == null) {
            throw CommerceOrderDeskService.validation("customer is required");
        }
        String name = CommerceOrderDeskService.text(customer.getName(), "customer.name", 200);
        if (name == null) {
            throw CommerceOrderDeskService.validation("customer.name is required");
        }
        String phone = CommercePhones.normalise(customer.getPhone());
        if (phone == null) {
            throw CommerceOrderDeskService.validation("customer.phone is not a valid phone number");
        }
        String email = CommerceOrderDeskService.text(customer.getEmail(), "customer.email", 320);
        if (email != null) {
            email = email.toLowerCase(Locale.ROOT);
            if (!EMAIL.matcher(email).matches() || CommerceBuyerResolver.isHolderEmail(email)) {
                throw CommerceOrderDeskService.validation("customer.email is not a valid e-mail address");
            }
        }
        Map<String, Object> shipping = request.getShippingAddress() == null ? null
                : address(request.getShippingAddress(), "shipping_address", name, phone);
        Map<String, Object> billing = request.getBillingAddress() == null ? null
                : address(request.getBillingAddress(), "billing_address", name, phone);
        String gstin = CommerceOrderDeskService.text(request.getBuyerGstin(), "buyer_gstin", 20);
        if (gstin != null) {
            gstin = GstinValidator.normalise(gstin);
            if (!GstinValidator.isValid(gstin)) {
                throw CommerceOrderDeskService.validation("buyer_gstin is not a valid GSTIN");
            }
        }

        List<StaffOrderRequest.Line> asked = request.getLines();
        if (asked == null || asked.isEmpty() || asked.size() > MAX_LINES) {
            throw CommerceOrderDeskService.validation("lines holds 1 to " + MAX_LINES + " lines");
        }
        boolean handOverNow = Boolean.TRUE.equals(request.getHandOverNow());
        List<CartPriceRequest.Line> lines = new ArrayList<>();
        Map<String, BigDecimal> overrides = new LinkedHashMap<>();
        Map<String, CommerceShipmentService.PackLine> handOverPieces = new LinkedHashMap<>();
        int no = 0;
        for (StaffOrderRequest.Line line : asked) {
            no++;
            if (line == null || line.getQuantity() == null || line.getQuantity() < 1 || line.getQuantity() > 100_000) {
                throw CommerceOrderDeskService.validation("line " + no + " needs a quantity of at least 1");
            }
            String variantId = CommerceOrderDeskService.text(line.getVariantId(), "variant_id", 36);
            String sku = CommerceOrderDeskService.text(line.getSku(), "sku", 100);
            if (variantId == null && sku == null) {
                throw CommerceOrderDeskService.validation("line " + no + " names a variant_id or a sku");
            }
            String ref = "L" + no;
            lines.add(CartPriceRequest.Line.builder().lineRef(ref).variantId(variantId).sku(sku)
                    .quantity(line.getQuantity()).build());
            if (line.getUnitPriceOverride() != null) {
                BigDecimal price = line.getUnitPriceOverride();
                if (price.compareTo(new BigDecimal("0.01")) < 0 || price.stripTrailingZeros().scale() > 2
                        || price.compareTo(MAX_PRICE) > 0) {
                    throw CommerceOrderDeskService.validation("unit_price_override of line " + no
                            + " is an amount of at least 0.01 with at most two decimals");
                }
                overrides.put(ref, price.setScale(2, RoundingMode.UNNECESSARY));
            }
            List<String> pieceIds = pieces(line.getPieceIds(), no, "piece_ids", 36);
            List<String> pieceCodes = pieces(line.getPieceCodes(), no, "piece_codes", 64);
            if (!pieceIds.isEmpty() || !pieceCodes.isEmpty()) {
                if (!handOverNow) {
                    throw CommerceOrderDeskService.validation("piece_ids and piece_codes are named only for a "
                            + "hand-over (hand_over_now); pack the order to name its pieces");
                }
                if (pieceIds.size() + pieceCodes.size() != line.getQuantity()) {
                    throw CommerceOrderDeskService.validation("line " + no + " names " + line.getQuantity()
                            + " piece(s), one per unit");
                }
                handOverPieces.put(ref, new CommerceShipmentService.PackLine(line.getQuantity(), pieceIds,
                        pieceCodes));
            }
        }

        List<StaffOrderRequest.Tender> askedTenders = request.getTenders() == null ? List.of() : request.getTenders();
        if (askedTenders.size() > MAX_TENDERS) {
            throw CommerceOrderDeskService.validation("tenders holds at most " + MAX_TENDERS + " payments");
        }
        List<CommerceOrderWriter.StaffTender> tenders = new ArrayList<>();
        for (StaffOrderRequest.Tender tender : askedTenders) {
            TenderMode mode = tender == null ? null : TenderMode.of(tender.getMode());
            if (mode == null || !TenderMode.STAFF_RECEIVED.contains(mode)) {
                throw CommerceOrderDeskService.validation("a tender mode is CASH, UPI, CARD, BANK_TRANSFER or CHEQUE");
            }
            BigDecimal amount = CommerceReceiptService.amount(tender.getAmount(), "tender amount");
            tenders.add(new CommerceOrderWriter.StaffTender(mode.name(), amount,
                    CommerceOrderDeskService.text(tender.getReference(), "tender reference", 100)));
        }
        boolean chargeShipping = request.getChargeShipping() != null ? request.getChargeShipping() : shipping != null;
        CommerceExchangeService.Ask exchange = null;
        if (request.getExchange() != null) {
            String returnId = CommerceOrderDeskService.text(request.getExchange().getReturnId(), "exchange.return_id",
                    36);
            if (returnId == null) {
                throw CommerceOrderDeskService.validation("exchange.return_id is required");
            }
            RefundMethod method = null;
            String reference = null;
            StaffOrderRequest.RemainderRefund rest = request.getExchange().getRemainderRefund();
            if (rest != null) {
                method = RefundMethod.of(rest.getMethod());
                if (method == null || method == RefundMethod.EXCHANGE_CREDIT) {
                    throw CommerceOrderDeskService.validation("exchange.remainder_refund.method is GATEWAY, CASH, UPI "
                            + "or BANK_TRANSFER");
                }
                reference = CommerceOrderDeskService.text(rest.getReference(), "exchange.remainder_refund.reference",
                        100);
            }
            exchange = new CommerceExchangeService.Ask(returnId, method, reference);
        }
        return new Clean(key, phone, name, email, shipping, billing, gstin, lines, overrides,
                CommerceOrderDeskService.text(request.getCouponCode(), "coupon_code", 64), chargeShipping, tenders,
                Boolean.TRUE.equals(request.getRestOnCredit()), handOverNow,
                CommerceOrderDeskService.text(request.getCustomerNote(), "customer_note", 500), handOverPieces,
                exchange);
    }

    /** Piece ids or scan codes of one line: trimmed, distinct, at most {@code maxLength} characters each. */
    private static List<String> pieces(List<String> raw, int lineNo, String field, int maxLength) {
        if (raw == null || raw.isEmpty()) {
            return List.of();
        }
        if (raw.size() > 1000) {
            throw CommerceOrderDeskService.validation(field + " of line " + lineNo + " holds at most 1000 pieces");
        }
        Set<String> out = new LinkedHashSet<>();
        for (String value : raw) {
            String v = value == null ? "" : value.trim();
            if (v.isEmpty() || v.length() > maxLength || !out.add(v)) {
                throw CommerceOrderDeskService.validation(field + " of line " + lineNo + " are distinct values of "
                        + "at most " + maxLength + " characters");
            }
        }
        return new ArrayList<>(out);
    }

    /** An address as the order stores it: snake_case keys, trimmed, capped, validated. */
    static Map<String, Object> address(CheckoutRequest.Address a, String field, String defaultName,
                                       String defaultPhone) {
        String pincode = CommerceOrderDeskService.text(a.getPincode(), field + ".pincode", 10);
        if (pincode != null) {
            pincode = pincode.replace(" ", "");
        }
        if (pincode == null || !PINCODE.matcher(pincode).matches()) {
            throw CommerceOrderDeskService.validation(field + ".pincode needs six digits");
        }
        String state = CommerceOrderDeskService.text(a.getStateCode(), field + ".state_code", 4);
        if (state != null && !PincodeStates.isStateCode(state)) {
            throw CommerceOrderDeskService.validation(field + ".state_code is not a GST state code");
        }
        String phone = defaultPhone;
        if (StringUtils.hasText(a.getPhone())) {
            phone = CommercePhones.normalise(a.getPhone());
            if (phone == null) {
                throw CommerceOrderDeskService.validation(field + ".phone is not a valid phone number");
            }
        }
        String line1 = CommerceOrderDeskService.text(a.getLine1(), field + ".line1", 300);
        if (line1 == null) {
            throw CommerceOrderDeskService.validation(field + ".line1 is required");
        }
        String name = CommerceOrderDeskService.text(a.getName(), field + ".name", 200);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("name", name == null ? defaultName : name);
        out.put("phone", phone);
        out.put("line1", line1);
        out.put("line2", CommerceOrderDeskService.text(a.getLine2(), field + ".line2", 300));
        out.put("landmark", CommerceOrderDeskService.text(a.getLandmark(), field + ".landmark", 200));
        out.put("city", CommerceOrderDeskService.text(a.getCity(), field + ".city", 100));
        out.put("state_code", state);
        out.put("pincode", pincode);
        return out;
    }

    /** A checkout refusal (stock, coupon, buyer) as the desk's error: the message starts with the code. */
    static VacademyException refusal(CheckoutException e) {
        HttpStatus status = e.getStatus() == null ? HttpStatus.CONFLICT : e.getStatus();
        return new VacademyException(status, e.getCode() + ": " + e.getMessage());
    }
}
