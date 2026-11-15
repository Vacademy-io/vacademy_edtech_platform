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
                                     ObjectMapper objectMapper,
                                     PlatformTransactionManager transactionManager) {
        this.orderRepository = orderRepository;
        this.lineRepository = lineRepository;
        this.tenderRepository = tenderRepository;
        this.historyRepository = historyRepository;
        this.customerService = customerService;
        this.accessTokens = accessTokens;
        this.verifiedPhones = verifiedPhones;
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

    /** Track by order number: only for the phone on the order, proved by an OTP. */
    public CheckoutDtos.OrderView track(String instituteId, String orderNumber, String phoneToken) {
        String phone = requirePhone(instituteId, phoneToken, VerifiedPhones.PURPOSE_TRACK_ORDER);
        String number = orderNumber == null ? "" : orderNumber.trim();
        if (number.isEmpty() || number.length() > 32) {
            throw notFound();
        }
        return primary.execute(status -> orderRepository.findByInstituteIdAndOrderNumber(instituteId, number)
                .filter(order -> phone.equals(order.getCustomerPhone()))
                .map(this::buyerView).orElseThrow(CommerceOrderQueryService::notFound));
    }

    /** The orders of the phone a verified-phone token proves, newest first. */
    public CheckoutDtos.OrderPage myOrders(String instituteId, String phoneToken, int page, int pageSize) {
        String phone = requirePhone(instituteId, phoneToken);
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
        String phone = requirePhone(instituteId, phoneToken);
        return primary.execute(status -> {
            CommerceCustomer customer = customerService.findByPhone(instituteId, phone).orElse(null);
            if (customer == null) {
                return List.<CheckoutDtos.AddressView>of();
            }
            return customerService.addresses(instituteId, customer.getId()).stream().map(this::addressView).toList();
        });
    }

    public CheckoutDtos.AddressView addMyAddress(String instituteId, String phoneToken, CheckoutRequest.Address body) {
        String phone = requirePhone(instituteId, phoneToken);
        CommerceCustomerService.AddressInput input = addressInput(body, phone);
        return primary.execute(status -> {
            // A buyer may keep addresses before a first order: the customer row is made here.
            CommerceCustomer customer = customerService.upsert(instituteId, null, phone, null, null);
            return addressView(customerService.add(instituteId, customer.getId(), input));
        });
    }

    public CheckoutDtos.AddressView updateMyAddress(String instituteId, String phoneToken, String addressId,
                                                    CheckoutRequest.Address body) {
        String phone = requirePhone(instituteId, phoneToken);
        CommerceCustomerService.AddressInput input = addressInput(body, phone);
        return primary.execute(status -> {
            CommerceCustomer customer = customerService.findByPhone(instituteId, phone)
                    .orElseThrow(CommerceOrderQueryService::notFound);
            return addressView(customerService.update(instituteId, customer.getId(), addressId, input));
        });
    }

    public void deleteMyAddress(String instituteId, String phoneToken, String addressId) {
        String phone = requirePhone(instituteId, phoneToken);
        primary.executeWithoutResult(status -> {
            CommerceCustomer customer = customerService.findByPhone(instituteId, phone)
                    .orElseThrow(CommerceOrderQueryService::notFound);
            customerService.delete(instituteId, customer.getId(), addressId);
        });
    }

    /** The buyer's own routes take a token of purpose CHECKOUT ("to see own orders"). */
    private String requirePhone(String instituteId, String phoneToken) {
        return requirePhone(instituteId, phoneToken, VerifiedPhones.PURPOSE_CHECKOUT);
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
        return CheckoutDtos.OrderView.builder()
                .orderId(order.getId())
                .orderNumber(order.getOrderNumber())
                .status(order.getStatus())
                .paymentStatus(order.getPaymentStatus())
                .paymentMethod(order.getPaymentMethod())
                .cancelReason(order.getCancelReason())
                .placedAt(instant(order.getCreatedAt()))
                .holdExpiresAt(pending ? instant(order.getHoldExpiresAt()) : null)
                .paymentRetryable(pending)
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
