package vacademy.io.admin_core_service.features.commerce.order.checkout;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.commerce.customer.CommercePhones;
import vacademy.io.admin_core_service.features.commerce.customer.CommerceShopperSessions;
import vacademy.io.admin_core_service.features.commerce.customer.entity.CommerceCustomer;
import vacademy.io.admin_core_service.features.commerce.customer.entity.CommerceCustomerAddress;
import vacademy.io.admin_core_service.features.commerce.customer.service.CommerceCustomerService;
import vacademy.io.admin_core_service.features.commerce.order.dto.CheckoutDtos;
import vacademy.io.admin_core_service.features.commerce.order.dto.CheckoutRequest;
import vacademy.io.admin_core_service.features.commerce.order.dto.StaffOrderDtos;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrder;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderLine;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderStatusHistory;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderTender;
import vacademy.io.admin_core_service.features.commerce.order.enums.CommerceOrderStatus;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentConfirmService;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderLineRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderStatusHistoryRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderTenderRepository;
import vacademy.io.admin_core_service.features.commerce.order.service.CommerceOrderTransitions;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.admin_core_service.features.commerce.shipment.entity.CommerceShipment;
import vacademy.io.admin_core_service.features.commerce.shipment.entity.CommerceShipmentLine;
import vacademy.io.admin_core_service.features.commerce.shipment.repository.CommerceShipmentLineRepository;
import vacademy.io.admin_core_service.features.commerce.shipment.repository.CommerceShipmentRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.CommercePieceRepository;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Reads of orders: the buyer's order page (by signed token), track-order (order number plus a
 * phone proved by OTP), the buyer's own list and address book (the same proof), and the staff
 * list and detail. Nothing here changes an order.
 *
 * <p>Who may read what: an order number is never enough. A buyer
 * route answers "not found" for an order of another phone or another institute exactly as for
 * an order that does not exist.
 *
 * <p>The buyer's own routes ({@code /me/*}) take a shopper session ({@code X-Commerce-Session})
 * when one is sent; a bad session is 401 {@code session_invalid} with no fallback. Without one
 * they take a verified-phone token of purpose CHECKOUT or ACCOUNT (401 {@code token_invalid}).
 * An order placed with the phone by someone who did not prove it is listed as a masked row.
 */
@Slf4j
@Service
public class CommerceOrderQueryService {

    public static final int MAX_PAGE_SIZE = 50;

    private final CommerceOrderRepository orderRepository;
    private final CommerceOrderLineRepository lineRepository;
    private final CommerceOrderTenderRepository tenderRepository;
    private final CommerceOrderStatusHistoryRepository historyRepository;
    private final CommerceCustomerService customerService;
    private final CommerceOrderAccessTokens accessTokens;
    private final VerifiedPhones verifiedPhones;
    private final CommerceShopperSessions sessions;
    private final CommercePaymentConfirmService paymentConfirmService;
    private final ObjectMapper objectMapper;
    /** Not read-only, so it reads the primary: the thank-you page opens right after the commit. */
    private final TransactionTemplate primary;
    private final TransactionTemplate readOnly;
    /** The order desk's parcels; null in tests built by hand without them. */
    private final CommerceShipmentRepository shipmentRepository;
    private final CommerceShipmentLineRepository shipmentLineRepository;
    private final CommercePieceRepository pieceRepository;

    /** Without the order desk's repositories (the staff detail then lists no parcels). */
    public CommerceOrderQueryService(CommerceOrderRepository orderRepository,
                                     CommerceOrderLineRepository lineRepository,
                                     CommerceOrderTenderRepository tenderRepository,
                                     CommerceOrderStatusHistoryRepository historyRepository,
                                     CommerceCustomerService customerService,
                                     CommerceOrderAccessTokens accessTokens,
                                     VerifiedPhones verifiedPhones,
                                     CommerceShopperSessions sessions,
                                     CommercePaymentConfirmService paymentConfirmService,
                                     ObjectMapper objectMapper,
                                     PlatformTransactionManager transactionManager) {
        this(orderRepository, lineRepository, tenderRepository, historyRepository, customerService, accessTokens,
                verifiedPhones, sessions, paymentConfirmService, objectMapper, transactionManager, null, null, null);
    }

    @Autowired
    public CommerceOrderQueryService(CommerceOrderRepository orderRepository,
                                     CommerceOrderLineRepository lineRepository,
                                     CommerceOrderTenderRepository tenderRepository,
                                     CommerceOrderStatusHistoryRepository historyRepository,
                                     CommerceCustomerService customerService,
                                     CommerceOrderAccessTokens accessTokens,
                                     VerifiedPhones verifiedPhones,
                                     CommerceShopperSessions sessions,
                                     CommercePaymentConfirmService paymentConfirmService,
                                     ObjectMapper objectMapper,
                                     PlatformTransactionManager transactionManager,
                                     CommerceShipmentRepository shipmentRepository,
                                     CommerceShipmentLineRepository shipmentLineRepository,
                                     CommercePieceRepository pieceRepository) {
        this.shipmentRepository = shipmentRepository;
        this.shipmentLineRepository = shipmentLineRepository;
        this.pieceRepository = pieceRepository;
        this.orderRepository = orderRepository;
        this.lineRepository = lineRepository;
        this.tenderRepository = tenderRepository;
        this.historyRepository = historyRepository;
        this.customerService = customerService;
        this.accessTokens = accessTokens;
        this.verifiedPhones = verifiedPhones;
        this.sessions = sessions;
        this.paymentConfirmService = paymentConfirmService;
        this.objectMapper = objectMapper;
        this.primary = new TransactionTemplate(transactionManager);
        this.readOnly = new TransactionTemplate(transactionManager);
        this.readOnly.setReadOnly(true);
    }

    // ------------------------------------------------------------------ buyer

    /** The order a signed {@code order_access_token} opens. */
    public CheckoutDtos.OrderView viewByToken(String instituteId, String token) {
        CommerceOrderAccessTokens.Access access = accessTokens.verify(token);
        if (access == null || !access.instituteId().equals(instituteId)) {
            throw new CheckoutException(HttpStatus.FORBIDDEN, CheckoutException.TOKEN_INVALID,
                    "The order link is not valid or has expired.");
        }
        return primary.execute(status -> orderRepository.findByIdAndInstituteId(access.orderId(), instituteId)
                .map(this::buyerView).orElseThrow(CommerceOrderQueryService::notFound));
    }

    /**
     * Track by order number: only for the phone on the order, proved by an OTP. An order whose
     * phone was not proved when it was placed answers its state only (as its masked row in the
     * account): no items, totals or recipient. Its full view needs the order's own link.
     */
    public CheckoutDtos.OrderView track(String instituteId, String orderNumber, String phoneToken) {
        String phone = requirePhone(instituteId, phoneToken, VerifiedPhones.PURPOSE_TRACK_ORDER);
        String number = orderNumber == null ? "" : orderNumber.trim();
        if (number.isEmpty() || number.length() > 32) {
            throw notFound();
        }
        return primary.execute(status -> orderRepository.findByInstituteIdAndOrderNumber(instituteId, number)
                .filter(order -> phone.equals(order.getCustomerPhone()))
                .map(order -> Boolean.TRUE.equals(order.getPhoneVerified()) ? buyerView(order) : stateOnlyView(order))
                .orElseThrow(CommerceOrderQueryService::notFound));
    }

    /** As {@link #myOrders(String, String, String, int, int)} with a phone token only. */
    public CheckoutDtos.OrderPage myOrders(String instituteId, String phoneToken, int page, int pageSize) {
        return myOrders(instituteId, null, phoneToken, page, pageSize);
    }

    /**
     * The orders of the buyer's phone, newest first. An order whose phone was not proved when it
     * was placed is a masked row: number, status and date only, and no link.
     */
    public CheckoutDtos.OrderPage myOrders(String instituteId, String sessionToken, String phoneToken, int page,
                                           int pageSize) {
        String phone = requireBuyer(instituteId, sessionToken, phoneToken).phone();
        int size = Math.min(Math.max(pageSize, 1), MAX_PAGE_SIZE);
        int index = Math.max(page, 0);
        return primary.execute(status -> {
            CommerceCustomer customer = customerService.findByPhone(instituteId, phone).orElse(null);
            if (customer == null) {
                return CheckoutDtos.OrderPage.builder().orders(List.of()).page(index).pageSize(size).total(0).build();
            }
            Page<CommerceOrder> found = orderRepository.findByInstituteIdAndCustomerIdOrderByCreatedAtDesc(
                    instituteId, customer.getId(), PageRequest.of(index, size));
            List<String> ids = found.getContent().stream().map(CommerceOrder::getId).toList();
            Map<String, List<CommerceOrderLine>> linesByOrder = new HashMap<>();
            if (!ids.isEmpty()) {
                for (CommerceOrderLine line : lineRepository.findByOrderIdInOrderByOrderIdAscLineNoAsc(ids)) {
                    if (CommerceOrderLine.TYPE_ITEM.equals(line.getLineType())) {
                        linesByOrder.computeIfAbsent(line.getOrderId(), k -> new ArrayList<>()).add(line);
                    }
                }
            }
            List<CheckoutDtos.OrderSummary> rows = new ArrayList<>();
            for (CommerceOrder order : found.getContent()) {
                if (!Boolean.TRUE.equals(order.getPhoneVerified())) {
                    rows.add(CheckoutDtos.OrderSummary.builder()
                            .orderNumber(order.getOrderNumber())
                            .status(order.getStatus())
                            .placedAt(instant(order.getCreatedAt()))
                            .masked(true)
                            .build());
                    continue;
                }
                List<CommerceOrderLine> items = linesByOrder.getOrDefault(order.getId(), List.of());
                rows.add(CheckoutDtos.OrderSummary.builder()
                        .orderId(order.getId())
                        .orderNumber(order.getOrderNumber())
                        .status(order.getStatus())
                        .paymentStatus(order.getPaymentStatus())
                        .placedAt(instant(order.getCreatedAt()))
                        .currency(order.getCurrency())
                        .total(order.getTotal())
                        .itemCount(items.size())
                        .firstItemName(items.isEmpty() ? null : items.get(0).getNameSnapshot())
                        .orderAccessToken(accessTokens.issue(instituteId, order.getId()))
                        .build());
            }
            return CheckoutDtos.OrderPage.builder().orders(rows).page(index).pageSize(size)
                    .total(found.getTotalElements()).build();
        });
    }

    public List<CheckoutDtos.AddressView> myAddresses(String instituteId, String phoneToken) {
        return myAddresses(instituteId, null, phoneToken);
    }

    public List<CheckoutDtos.AddressView> myAddresses(String instituteId, String sessionToken, String phoneToken) {
        String phone = requireBuyer(instituteId, sessionToken, phoneToken).phone();
        return primary.execute(status -> {
            CommerceCustomer customer = customerService.findByPhone(instituteId, phone).orElse(null);
            if (customer == null) {
                return List.<CheckoutDtos.AddressView>of();
            }
            return customerService.addresses(instituteId, customer.getId()).stream().map(this::addressView).toList();
        });
    }

    public CheckoutDtos.AddressView addMyAddress(String instituteId, String phoneToken, CheckoutRequest.Address body) {
        return addMyAddress(instituteId, null, phoneToken, body);
    }

    public CheckoutDtos.AddressView addMyAddress(String instituteId, String sessionToken, String phoneToken,
                                                 CheckoutRequest.Address body) {
        String phone = requireBuyer(instituteId, sessionToken, phoneToken).phone();
        CommerceCustomerService.AddressInput input = addressInput(body, phone);
        return primary.execute(status -> {
            // A buyer may keep addresses before a first order: the customer row is made here.
            CommerceCustomer customer = customerService.upsert(instituteId, null, phone, null, null);
            return addressView(customerService.add(instituteId, customer.getId(), input));
        });
    }

    public CheckoutDtos.AddressView updateMyAddress(String instituteId, String phoneToken, String addressId,
                                                    CheckoutRequest.Address body) {
        return updateMyAddress(instituteId, null, phoneToken, addressId, body);
    }

    public CheckoutDtos.AddressView updateMyAddress(String instituteId, String sessionToken, String phoneToken,
                                                    String addressId, CheckoutRequest.Address body) {
        String phone = requireBuyer(instituteId, sessionToken, phoneToken).phone();
        CommerceCustomerService.AddressInput input = addressInput(body, phone);
        return primary.execute(status -> {
            CommerceCustomer customer = customerService.findByPhone(instituteId, phone)
                    .orElseThrow(CommerceOrderQueryService::notFound);
            return addressView(customerService.update(instituteId, customer.getId(), addressId, input));
        });
    }

    public void deleteMyAddress(String instituteId, String phoneToken, String addressId) {
        deleteMyAddress(instituteId, null, phoneToken, addressId);
    }

    public void deleteMyAddress(String instituteId, String sessionToken, String phoneToken, String addressId) {
        String phone = requireBuyer(instituteId, sessionToken, phoneToken).phone();
        primary.executeWithoutResult(status -> {
            CommerceCustomer customer = customerService.findByPhone(instituteId, phone)
                    .orElseThrow(CommerceOrderQueryService::notFound);
            customerService.delete(instituteId, customer.getId(), addressId);
        });
    }

    /**
     * {@code GET /me}: the buyer's name, phone (the one the caller proved, so checkout can fill
     * it in without the device keeping it), masked e-mail, and marketing consent.
     */
    public CheckoutDtos.Account me(String instituteId, String sessionToken, String phoneToken) {
        BuyerProof buyer = requireBuyer(instituteId, sessionToken, phoneToken);
        return primary.execute(status -> account(instituteId, buyer,
                customerService.findByPhone(instituteId, buyer.phone()).orElse(null)));
    }

    /** {@code PUT /me/consent}: the buyer's own marketing choice, recorded with time and source. */
    public CheckoutDtos.Account setConsent(String instituteId, String sessionToken, String phoneToken,
                                           Boolean consent) {
        if (consent == null) {
            throw CheckoutException.invalid("marketing_consent is true or false.");
        }
        BuyerProof buyer = requireBuyer(instituteId, sessionToken, phoneToken);
        return primary.execute(status -> {
            CommerceCustomer customer = customerService.findOrCreateUnverified(instituteId, buyer.phone());
            customerService.setConsent(customer, consent, "ACCOUNT");
            return account(instituteId, buyer, customer);
        });
    }

    /** {@code POST /me/logout}: every session of the buyer's phone in this shop ends. */
    public void logoutEverywhere(String instituteId, String sessionToken, String phoneToken) {
        BuyerProof buyer = requireBuyer(instituteId, sessionToken, phoneToken);
        String customerId = buyer.session() != null ? buyer.session().customerId()
                : primary.execute(status -> customerService.findByPhone(instituteId, buyer.phone())
                .map(CommerceCustomer::getId).orElse(null));
        if (customerId != null) {
            sessions.endAll(instituteId, customerId);
        }
    }

    private CheckoutDtos.Account account(String instituteId, BuyerProof buyer, CommerceCustomer customer) {
        return CheckoutDtos.Account.builder()
                .name(customer == null ? null : customer.getName())
                .phone(buyer.phone())
                .phoneMasked(CommercePhones.mask(buyer.phone()))
                .emailMasked(customer == null ? null : maskEmail(customer.getEmail()))
                .marketingConsent(customer != null && Boolean.TRUE.equals(customer.getMarketingConsent()))
                .sessionExpiresAt(buyer.session() == null ? null : buyer.session().expiresAt().toString())
                .build();
    }

    /** {@code a•••@example.com}: the first letter and the domain. */
    static String maskEmail(String email) {
        if (!StringUtils.hasText(email) || CommerceBuyerResolver.isHolderEmail(email)) {
            return null;
        }
        int at = email.indexOf('@');
        if (at < 1) {
            return null;
        }
        return email.charAt(0) + "•••" + email.substring(at);
    }

    /** Who a {@code /me} call is for: the phone, and the session when one was used. */
    public record BuyerProof(String phone, CommerceShopperSessions.Session session) {
    }

    /**
     * A shopper session when its header is sent (no fallback when it is bad), else a
     * verified-phone token of purpose CHECKOUT or ACCOUNT.
     */
    public BuyerProof requireBuyer(String instituteId, String sessionToken, String phoneToken) {
        if (StringUtils.hasText(sessionToken)) {
            if (!sessions.isConfigured()) {
                throw new CheckoutException(HttpStatus.SERVICE_UNAVAILABLE, CheckoutException.NOT_CONFIGURED,
                        "Accounts are not available for this shop yet.");
            }
            CommerceShopperSessions.Session session = sessions.verify(instituteId, sessionToken);
            if (session == null) {
                throw new CheckoutException(HttpStatus.UNAUTHORIZED, CheckoutException.SESSION_INVALID,
                        "Your session has ended. Verify your phone number to continue.");
            }
            return new BuyerProof(session.phone(), session);
        }
        String phone = verifiedPhones.phoneOf(instituteId, phoneToken, VerifiedPhones.PURPOSE_CHECKOUT);
        if (phone == null) {
            phone = verifiedPhones.phoneOf(instituteId, phoneToken, VerifiedPhones.PURPOSE_ACCOUNT);
        }
        if (phone == null) {
            throw new CheckoutException(HttpStatus.UNAUTHORIZED, CheckoutException.TOKEN_INVALID,
                    "Verify your phone number to continue.");
        }
        return new BuyerProof(phone, null);
    }

    private String requirePhone(String instituteId, String phoneToken, String purpose) {
        String phone = verifiedPhones.phoneOf(instituteId, phoneToken, purpose);
        if (phone == null) {
            throw new CheckoutException(HttpStatus.UNAUTHORIZED, CheckoutException.TOKEN_INVALID,
                    "Verify your phone number to continue.");
        }
        return phone;
    }

    private static CommerceCustomerService.AddressInput addressInput(CheckoutRequest.Address body, String phone) {
        if (body == null) {
            throw CheckoutException.invalid("The request has no body.");
        }
        Map<String, Object> clean = CommerceCheckoutService.address(body, "address", null, phone);
        String label = body.getLabel() == null || body.getLabel().isBlank() ? null : body.getLabel().trim();
        if (label != null && label.length() > 64) {
            throw CheckoutException.invalid("address.label is longer than 64 characters.");
        }
        return new CommerceCustomerService.AddressInput(label, (String) clean.get("name"), (String) clean.get("phone"),
                (String) clean.get("line1"), (String) clean.get("line2"), (String) clean.get("landmark"),
                (String) clean.get("city"), (String) clean.get("state_code"), (String) clean.get("pincode"),
                Boolean.TRUE.equals(body.getIsDefault()));
    }

    private CheckoutDtos.AddressView addressView(CommerceCustomerAddress a) {
        return CheckoutDtos.AddressView.builder().id(a.getId()).label(a.getLabel()).name(a.getName())
                .phone(a.getPhone()).line1(a.getLine1()).line2(a.getLine2()).landmark(a.getLandmark())
                .city(a.getCity()).stateCode(a.getStateCode()).pincode(a.getPincode())
                .isDefault(Boolean.TRUE.equals(a.getIsDefault())).build();
    }

    private CheckoutDtos.OrderView buyerView(CommerceOrder order) {
        List<CheckoutDtos.OrderLineView> lines = new ArrayList<>();
        for (CommerceOrderLine line : lineRepository.findByOrderIdOrderByLineNoAsc(order.getId())) {
            if (!CommerceOrderLine.TYPE_ITEM.equals(line.getLineType())) {
                continue;
            }
            lines.add(CheckoutDtos.OrderLineView.builder()
                    .lineRef(line.getLineRef())
                    .name(line.getNameSnapshot())
                    .variantLabel(line.getVariantLabel())
                    .sku(line.getSkuSnapshot())
                    .quantity(line.getQuantity())
                    .qtyScale(line.getQtyScale())
                    .unit(line.getUnit())
                    .unitPrice(line.getUnitPrice())
                    .compareAtPrice(line.getMrp())
                    .discount(line.getDiscount())
                    .lineTotal(line.getLineTotal())
                    .qtyCancelled(line.getQtyCancelled())
                    .qtyShipped(line.getQtyShipped())
                    .build());
        }
        List<CheckoutDtos.TimelineEntry> timeline = new ArrayList<>();
        for (CommerceOrderStatusHistory row : historyRepository.findByOrderIdOrderByCreatedAtAscIdAsc(order.getId())) {
            timeline.add(CheckoutDtos.TimelineEntry.builder().status(row.getToStatus())
                    .at(instant(row.getCreatedAt())).build());
        }
        JsonNode address = tree(order.getShippingAddressJson());
        boolean pending = CommerceOrderStatus.of(order.getStatus()) == CommerceOrderStatus.PENDING_PAYMENT;
        boolean processing = pending && paymentConfirmService.paymentInProgress(order.getId());
        return CheckoutDtos.OrderView.builder()
                .orderId(order.getId())
                .orderNumber(order.getOrderNumber())
                .status(order.getStatus())
                .paymentStatus(order.getPaymentStatus())
                .paymentMethod(order.getPaymentMethod())
                .cancelReason(order.getCancelReason())
                .placedAt(instant(order.getCreatedAt()))
                .holdExpiresAt(pending ? instant(order.getHoldExpiresAt()) : null)
                .paymentRetryable(pending && !processing)
                .paymentProcessing(processing)
                .currency(order.getCurrency())
                .lines(lines)
                .totals(totals(order))
                .recipient(CheckoutDtos.Recipient.builder()
                        .name(text(address, "name") != null ? text(address, "name") : order.getCustomerName())
                        .phoneMasked(CommercePhones.mask(order.getCustomerPhone()))
                        .city(text(address, "city"))
                        .stateCode(text(address, "state_code"))
                        .pincode(text(address, "pincode"))
                        .build())
                .timeline(timeline)
                .build();
    }

    /** Number, state and timeline of an order, and nothing about what was bought or for whom. */
    private CheckoutDtos.OrderView stateOnlyView(CommerceOrder order) {
        List<CheckoutDtos.TimelineEntry> timeline = new ArrayList<>();
        for (CommerceOrderStatusHistory row : historyRepository.findByOrderIdOrderByCreatedAtAscIdAsc(order.getId())) {
            timeline.add(CheckoutDtos.TimelineEntry.builder().status(row.getToStatus())
                    .at(instant(row.getCreatedAt())).build());
        }
        boolean pending = CommerceOrderStatus.of(order.getStatus()) == CommerceOrderStatus.PENDING_PAYMENT;
        boolean processing = pending && paymentConfirmService.paymentInProgress(order.getId());
        return CheckoutDtos.OrderView.builder()
                .orderNumber(order.getOrderNumber())
                .status(order.getStatus())
                .paymentStatus(order.getPaymentStatus())
                .cancelReason(order.getCancelReason())
                .placedAt(instant(order.getCreatedAt()))
                .holdExpiresAt(pending ? instant(order.getHoldExpiresAt()) : null)
                .paymentProcessing(processing)
                .timeline(timeline)
                .masked(true)
                .build();
    }

    // ------------------------------------------------------------------ staff

    /** The desk queues of the staff list ({@code queue}). */
    public static final Set<String> QUEUES = Set.of("TO_CONFIRM", "TO_PACK", "TO_SHIP", "IN_TRANSIT",
            "COD_TO_COLLECT", "RTO_TO_RECEIVE", "STOCK_SHORT", "DUES");
    private static final Set<String> PAYMENT_STATUSES = Set.of("UNPAID", "PARTIALLY_PAID", "PAID");
    private static final Set<String> CHANNELS = Set.of("ONLINE", "ADMIN", "POS");
    private static final ZoneId INDIA = ZoneId.of("Asia/Kolkata");

    /** The filters of the staff order list; every one optional. Dates are days in India, both ends included. */
    public record StaffListFilter(String status, String paymentMethod, String paymentStatus, String channel,
                                  String queue, String search, LocalDate from, LocalDate to) {

        public static StaffListFilter of(String status, String search) {
            return new StaffListFilter(status, null, null, null, null, search, null, null);
        }
    }

    /** The order list of the admin. The caller has passed the access guard for the institute. */
    public StaffOrderDtos.StaffOrderPage staffList(String instituteId, String status, String search, int page,
                                                 int pageSize) {
        return staffList(instituteId, StaffListFilter.of(status, search), page, pageSize);
    }

    /** The order list with the desk's filters and queues. */
    public StaffOrderDtos.StaffOrderPage staffList(String instituteId, StaffListFilter filter, int page,
                                                 int pageSize) {
        int size = Math.min(Math.max(pageSize, 1), MAX_PAGE_SIZE);
        int index = Math.max(page, 0);
        PageRequest pageable = PageRequest.of(index, size);
        StaffListFilter f = filter == null ? StaffListFilter.of(null, null) : filter;
        String text = StringUtils.hasText(f.search()) ? f.search().trim() : null;
        if (text != null && text.length() > 64) {
            text = text.substring(0, 64);
        }
        CommerceOrderStatus wanted = CommerceOrderStatus.of(StringUtils.hasText(f.status())
                ? f.status().trim().toUpperCase(Locale.ROOT) : null);
        if (StringUtils.hasText(f.status()) && wanted == null) {
            throw CheckoutException.invalid("status is not an order status.");
        }
        String method = upper(f.paymentMethod());
        if (method != null && !Set.of("PREPAID", "COD", "OFFLINE").contains(method)) {
            throw CheckoutException.invalid("payment_method is PREPAID, COD or OFFLINE.");
        }
        String paymentStatus = upper(f.paymentStatus());
        if (paymentStatus != null && !PAYMENT_STATUSES.contains(paymentStatus)) {
            throw CheckoutException.invalid("payment_status is UNPAID, PARTIALLY_PAID or PAID.");
        }
        String channel = upper(f.channel());
        if (channel != null && !CHANNELS.contains(channel)) {
            throw CheckoutException.invalid("channel is ONLINE, ADMIN or POS.");
        }
        String queue = upper(f.queue());
        if (queue != null && !QUEUES.contains(queue)) {
            throw CheckoutException.invalid("queue is not a desk queue.");
        }
        if (f.from() != null && f.to() != null && f.to().isBefore(f.from())) {
            throw CheckoutException.invalid("to is before from.");
        }
        Date fromTime = f.from() == null ? null : Date.from(f.from().atStartOfDay(INDIA).toInstant());
        Date toTime = f.to() == null ? null : Date.from(f.to().plusDays(1).atStartOfDay(INDIA).toInstant());
        String query = text;
        String phone = query == null ? null : CommercePhones.normalise(query);
        String namePattern = query == null ? null
                : "%" + query.toLowerCase(Locale.ROOT).replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
                        + "%";
        String statusName = wanted == null ? null : wanted.name();
        return readOnly.execute(tx -> {
            Page<CommerceOrder> found = orderRepository.staffSearch(instituteId, statusName, method, paymentStatus,
                    channel, queue, query, phone == null ? query : phone, namePattern, fromTime, toTime, pageable);
            List<CommerceOrder> orders = found.getContent();
            Map<String, CommerceShipment> live = liveShipments(orders);
            Map<String, Date> since = statusSince(orders);
            List<StaffOrderDtos.StaffOrderRow> rows = new ArrayList<>();
            for (CommerceOrder order : orders) {
                StaffOrderDtos.StaffOrderRow row = staffRow(order);
                CommerceShipment shipment = live.get(order.getId());
                if (shipment != null) {
                    row.setShipmentStatus(shipment.getStatus());
                    row.setTrackingNumber(shipment.getTrackingNumber());
                }
                row.setStatusSince(instant(since.get(order.getId())));
                rows.add(row);
            }
            return StaffOrderDtos.StaffOrderPage.builder()
                    .orders(rows)
                    .page(index).pageSize(size).total(found.getTotalElements()).build();
        });
    }

    public StaffOrderDtos.StaffOrderDetail staffDetail(String instituteId, String orderId) {
        return staffDetail(instituteId, orderId, null, false, false);
    }

    /**
     * One order for staff, with its parcels, documents and the desk actions {@code roles} (or an
     * ADMIN) may run on it now. {@code fromPrimary}: read the primary (the answer of a write).
     */
    public StaffOrderDtos.StaffOrderDetail staffDetail(String instituteId, String orderId, Set<CommerceRole> roles,
                                                       boolean admin, boolean fromPrimary) {
        return (fromPrimary ? primary : readOnly).execute(tx -> {
            CommerceOrder order = orderRepository.findByIdAndInstituteId(orderId, instituteId)
                    .orElseThrow(CommerceOrderQueryService::notFound);
            List<CommerceOrderLine> orderLines = lineRepository.findByOrderIdOrderByLineNoAsc(orderId);
            List<StaffOrderDtos.StaffOrderLine> lines = new ArrayList<>();
            boolean hasReturns = false;
            for (CommerceOrderLine line : orderLines) {
                hasReturns |= line.getQtyReturned() != null && line.getQtyReturned() > 0;
                lines.add(StaffOrderDtos.StaffOrderLine.builder()
                        .id(line.getId()).lineNo(line.getLineNo()).lineType(line.getLineType())
                        .packageSessionId(line.getPackageSessionId()).packageId(line.getPackageId())
                        .userPlanId(line.getUserPlanId()).paymentLogId(line.getPaymentLogId())
                        .name(line.getNameSnapshot()).variantLabel(line.getVariantLabel())
                        .sku(line.getSkuSnapshot()).unit(line.getUnit()).qtyScale(line.getQtyScale())
                        .quantity(line.getQuantity()).unitPrice(line.getUnitPrice()).mrp(line.getMrp())
                        .gross(line.getGross()).discount(line.getDiscount()).hsnCode(line.getHsnCode())
                        .taxRate(line.getTaxRate()).taxableValue(line.getTaxableValue())
                        .taxAmount(line.getTaxAmount()).lineTotal(line.getLineTotal())
                        .qtyCancelled(line.getQtyCancelled()).qtyShipped(line.getQtyShipped())
                        .qtyReturned(line.getQtyReturned())
                        .stockShortQty(line.getStockShortQty()).listUnitPrice(line.getListUnitPrice())
                        .priceOverrideBy(line.getPriceOverrideBy()).cancelledValue(line.getCancelledValue())
                        .costTotal(line.getCostTotal())
                        .build());
            }
            List<StaffOrderDtos.StaffTender> tenders = new ArrayList<>();
            boolean codReceived = false;
            for (CommerceOrderTender tender : tenderRepository.findByOrderIdOrderByCreatedAtAsc(orderId)) {
                codReceived |= CommerceOrderTender.MODE_COD.equals(tender.getMode())
                        && CommerceOrderTender.STATUS_RECEIVED.equals(tender.getStatus());
                tenders.add(StaffOrderDtos.StaffTender.builder().id(tender.getId()).mode(tender.getMode())
                        .amount(tender.getAmount()).status(tender.getStatus()).reference(tender.getReference())
                        .receivedAt(instant(tender.getReceivedAt())).build());
            }
            List<StaffOrderDtos.StaffTimelineEntry> timeline = new ArrayList<>();
            for (CommerceOrderStatusHistory row : historyRepository.findByOrderIdOrderByCreatedAtAscIdAsc(orderId)) {
                timeline.add(StaffOrderDtos.StaffTimelineEntry.builder().status(row.getToStatus())
                        .fromStatus(row.getFromStatus()).at(instant(row.getCreatedAt())).note(row.getNote())
                        .actorUserId(row.getActorUserId()).build());
            }
            List<StaffOrderDtos.StaffShipment> shipments = shipments(instituteId, orderId, orderLines);
            String liveShipmentStatus = null;
            String liveTracking = null;
            for (StaffOrderDtos.StaffShipment shipment : shipments) {
                if (!"CANCELLED".equals(shipment.getStatus())) {
                    liveShipmentStatus = shipment.getStatus();
                    liveTracking = shipment.getTrackingNumber();
                }
            }
            StaffOrderDtos.StaffOrderRow row = staffRow(order);
            row.setShipmentStatus(liveShipmentStatus);
            row.setTrackingNumber(liveTracking);
            if (!timeline.isEmpty()) {
                row.setStatusSince(timeline.get(timeline.size() - 1).getAt());
            }
            return StaffOrderDtos.StaffOrderDetail.builder()
                    .order(row)
                    .userId(order.getUserId())
                    .customerId(order.getCustomerId())
                    .customerEmail(order.getCustomerEmail())
                    .shippingAddress(tree(order.getShippingAddressJson()))
                    .billingAddress(tree(order.getBillingAddressJson()))
                    .buyerGstin(order.getBuyerGstin())
                    .placeOfSupplyState(order.getPlaceOfSupplyState())
                    .totals(totals(order))
                    .couponCode(order.getCouponCode())
                    .customerNote(order.getCustomerNote())
                    .giftNote(order.getGiftNote())
                    .locale(order.getLocale())
                    .fulfilmentLocationId(order.getFulfilmentLocationId())
                    .paymentGroupId(order.getPaymentGroupId())
                    .gatewayVendor(order.getGatewayVendor())
                    .gatewayOrderId(order.getGatewayOrderId())
                    .holdExpiresAt(instant(order.getHoldExpiresAt()))
                    .confirmedAt(instant(order.getConfirmedAt()))
                    .cancelledAt(instant(order.getCancelledAt()))
                    .nextStatuses(CommerceOrderTransitions.next(CommerceOrderStatus.of(order.getStatus())).stream()
                            .map(Enum::name).toList())
                    .lines(lines)
                    .tenders(tenders)
                    .timeline(timeline)
                    .shipments(shipments)
                    .refundDue(order.getRefundDue())
                    .stockShort(order.getStockShort())
                    .codAmount(order.getCodAmount())
                    .codRemittanceId(order.getCodRemittanceId())
                    .invoiceId(orderRepository.findLiveInvoiceId(instituteId, orderId).orElse(null))
                    .creditNoteIds(orderRepository.findCreditNoteIds(instituteId, orderId))
                    .nextActions(CommerceOrderTransitions.nextActions(new CommerceOrderTransitions.ActionState(
                            CommerceOrderStatus.of(order.getStatus()), liveShipmentStatus, order.getChannel(),
                            order.getPaymentMethod(), order.getPaymentStatus(),
                            Boolean.TRUE.equals(order.getStockShort()),
                            StringUtils.hasText(order.getCodRemittanceId()) || codReceived, hasReturns),
                            roles, admin))
                    .build();
        });
    }

    private List<StaffOrderDtos.StaffShipment> shipments(String instituteId, String orderId,
                                                         List<CommerceOrderLine> orderLines) {
        List<StaffOrderDtos.StaffShipment> out = new ArrayList<>();
        if (shipmentRepository == null) {
            return out;
        }
        List<CommerceShipment> found = shipmentRepository.findByOrderIdOrderByCreatedAtAsc(orderId);
        if (found.isEmpty()) {
            return out;
        }
        Map<String, List<CommerceShipmentLine>> linesOf = new HashMap<>();
        for (CommerceShipmentLine line : shipmentLineRepository.findByShipmentIdIn(
                found.stream().map(CommerceShipment::getId).toList())) {
            linesOf.computeIfAbsent(line.getShipmentId(), k -> new ArrayList<>()).add(line);
        }
        Map<String, List<String>> piecesOf = new HashMap<>();
        for (CommerceOrderLine line : orderLines) {
            if (!CommerceOrderLine.TYPE_ITEM.equals(line.getLineType()) || pieceRepository == null) {
                continue;
            }
            List<String> codes = pieceRepository.findRowsByOrderLine(instituteId, line.getId()).stream()
                    .map(CommercePieceRepository.PieceRow::getCode).toList();
            if (!codes.isEmpty()) {
                piecesOf.put(line.getId(), codes);
            }
        }
        for (CommerceShipment s : found) {
            boolean live = !"CANCELLED".equals(s.getStatus());
            List<StaffOrderDtos.StaffShipmentLine> lines = new ArrayList<>();
            for (CommerceShipmentLine line : linesOf.getOrDefault(s.getId(), List.of())) {
                lines.add(StaffOrderDtos.StaffShipmentLine.builder().id(line.getId())
                        .orderLineId(line.getOrderLineId()).quantity(line.getQuantity())
                        .pieceCodes(live ? piecesOf.get(line.getOrderLineId()) : null).build());
            }
            out.add(StaffOrderDtos.StaffShipment.builder()
                    .id(s.getId()).status(s.getStatus()).locationId(s.getLocationId())
                    .carrierCode(s.getCarrierCode()).carrierName(s.getCarrierName())
                    .trackingNumber(s.getTrackingNumber()).trackingUrl(s.getTrackingUrl())
                    .shipCount(s.getShipCount()).weightGrams(s.getWeightGrams()).invoiceId(s.getInvoiceId())
                    .rtoReason(s.getRtoReason())
                    .packedAt(instant(s.getPackedAt())).shippedAt(instant(s.getShippedAt()))
                    .deliveredOn(s.getDeliveredOn() == null ? null : s.getDeliveredOn().toString())
                    .rtoAt(instant(s.getRtoAt())).rtoReceivedAt(instant(s.getRtoReceivedAt()))
                    .cancelledAt(instant(s.getCancelledAt()))
                    .lines(lines)
                    .build());
        }
        return out;
    }

    /** The live (not cancelled) shipment of each order of a page. */
    private Map<String, CommerceShipment> liveShipments(List<CommerceOrder> orders) {
        Map<String, CommerceShipment> out = new HashMap<>();
        if (shipmentRepository == null || orders.isEmpty()) {
            return out;
        }
        for (CommerceShipment s : shipmentRepository.findByOrderIdInOrderByCreatedAtAsc(
                orders.stream().map(CommerceOrder::getId).toList())) {
            if (!"CANCELLED".equals(s.getStatus())) {
                out.put(s.getOrderId(), s);
            }
        }
        return out;
    }

    private Map<String, Date> statusSince(List<CommerceOrder> orders) {
        Map<String, Date> out = new HashMap<>();
        if (orders.isEmpty()) {
            return out;
        }
        List<CommerceOrderRepository.StatusSince> rows = orderRepository.findStatusSince(
                orders.stream().map(CommerceOrder::getId).toList());
        if (rows == null) {
            return out;
        }
        for (CommerceOrderRepository.StatusSince row : rows) {
            out.put(row.getOrderId(), row.getSince());
        }
        return out;
    }

    private static String upper(String value) {
        return StringUtils.hasText(value) ? value.trim().toUpperCase(Locale.ROOT) : null;
    }

    private StaffOrderDtos.StaffOrderRow staffRow(CommerceOrder order) {
        return StaffOrderDtos.StaffOrderRow.builder()
                .id(order.getId())
                .orderNumber(order.getOrderNumber())
                .channel(order.getChannel())
                .status(order.getStatus())
                .paymentStatus(order.getPaymentStatus())
                .paymentMethod(order.getPaymentMethod())
                .cancelReason(order.getCancelReason())
                .customerName(order.getCustomerName())
                .customerPhone(order.getCustomerPhone())
                .currency(order.getCurrency())
                .total(order.getTotal())
                .amountPaid(order.getAmountPaid())
                .createdAt(instant(order.getCreatedAt()))
                .stockShort(order.getStockShort())
                .refundDue(order.getRefundDue())
                .build();
    }

    // ------------------------------------------------------------------ helpers

    private static CheckoutDtos.Totals totals(CommerceOrder order) {
        return CheckoutDtos.Totals.builder()
                .subtotal(order.getSubtotal()).discount(order.getDiscount()).shipping(order.getShipping())
                .codCharge(order.getCodCharge()).tax(order.getTax()).roundOff(order.getRoundOff())
                .total(order.getTotal()).amountPaid(order.getAmountPaid()).build();
    }

    private JsonNode tree(String json) {
        if (!StringUtils.hasText(json)) {
            return null;
        }
        try {
            return objectMapper.readTree(json);
        } catch (Exception e) {
            log.warn("An order holds JSON that cannot be read: {}", e.getClass().getSimpleName());
            return null;
        }
    }

    private static String text(JsonNode node, String field) {
        if (node == null || !node.hasNonNull(field)) {
            return null;
        }
        String value = node.get(field).asText();
        return value.isBlank() ? null : value;
    }

    /** The JVM and the database are in UTC. */
    private static String instant(LocalDateTime value) {
        return value == null ? null : value.toInstant(ZoneOffset.UTC).toString();
    }

    private static String instant(Date value) {
        return value == null ? null : value.toInstant().toString();
    }

    private static CheckoutException notFound() {
        return new CheckoutException(HttpStatus.NOT_FOUND, CheckoutException.ORDER_NOT_FOUND, "Not found.");
    }
}
