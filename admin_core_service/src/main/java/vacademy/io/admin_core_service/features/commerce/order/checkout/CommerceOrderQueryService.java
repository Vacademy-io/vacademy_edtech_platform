package vacademy.io.admin_core_service.features.commerce.order.checkout;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
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

import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

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

    /** The order list of the admin. The caller has passed the access guard for the institute. */
    public StaffOrderDtos.StaffOrderPage staffList(String instituteId, String status, String search, int page,
                                                 int pageSize) {
        int size = Math.min(Math.max(pageSize, 1), MAX_PAGE_SIZE);
        int index = Math.max(page, 0);
        PageRequest pageable = PageRequest.of(index, size);
        String text = StringUtils.hasText(search) ? search.trim() : null;
        if (text != null && text.length() > 64) {
            text = text.substring(0, 64);
        }
        String query = text;
        CommerceOrderStatus wanted = CommerceOrderStatus.of(StringUtils.hasText(status) ? status.trim() : null);
        if (StringUtils.hasText(status) && wanted == null) {
            throw CheckoutException.invalid("status is not an order status.");
        }
        return readOnly.execute(tx -> {
            Page<CommerceOrder> found;
            if (query != null) {
                String phone = CommercePhones.normalise(query);
                found = orderRepository.search(instituteId, query, phone == null ? query : phone, pageable);
            } else if (wanted != null) {
                found = orderRepository.findByInstituteIdAndStatusOrderByCreatedAtDesc(instituteId, wanted.name(),
                        pageable);
            } else {
                found = orderRepository.findByInstituteIdOrderByCreatedAtDesc(instituteId, pageable);
            }
            return StaffOrderDtos.StaffOrderPage.builder()
                    .orders(found.getContent().stream().map(this::staffRow).toList())
                    .page(index).pageSize(size).total(found.getTotalElements()).build();
        });
    }

    public StaffOrderDtos.StaffOrderDetail staffDetail(String instituteId, String orderId) {
        return readOnly.execute(tx -> {
            CommerceOrder order = orderRepository.findByIdAndInstituteId(orderId, instituteId)
                    .orElseThrow(CommerceOrderQueryService::notFound);
            List<StaffOrderDtos.StaffOrderLine> lines = new ArrayList<>();
            for (CommerceOrderLine line : lineRepository.findByOrderIdOrderByLineNoAsc(orderId)) {
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
                        .qtyReturned(line.getQtyReturned()).build());
            }
            List<StaffOrderDtos.StaffTender> tenders = new ArrayList<>();
            for (CommerceOrderTender tender : tenderRepository.findByOrderIdOrderByCreatedAtAsc(orderId)) {
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
            return StaffOrderDtos.StaffOrderDetail.builder()
                    .order(staffRow(order))
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
                    .build();
        });
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
