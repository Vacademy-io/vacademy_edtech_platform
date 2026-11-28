package vacademy.io.admin_core_service.features.commerce.order.desk;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.common.request.CommerceRequestGuard;
import vacademy.io.admin_core_service.features.commerce.document.dto.CommerceInvoiceLineExtra;
import vacademy.io.admin_core_service.features.commerce.document.dto.CommerceInvoiceRequest;
import vacademy.io.admin_core_service.features.commerce.document.dto.CreditNoteDTO;
import vacademy.io.admin_core_service.features.commerce.document.dto.CreditNoteLineDTO;
import vacademy.io.admin_core_service.features.commerce.document.dto.CreditNoteLineRequest;
import vacademy.io.admin_core_service.features.commerce.document.dto.CreditNoteRequest;
import vacademy.io.admin_core_service.features.commerce.document.entity.CommerceCreditNoteLine;
import vacademy.io.admin_core_service.features.commerce.document.repository.CommerceCreditNoteLineRepository;
import vacademy.io.admin_core_service.features.commerce.document.service.CommerceCreditNoteService;
import vacademy.io.admin_core_service.features.commerce.document.service.CommerceInvoiceService;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceOrderQueryService;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceOrderWriter;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceRefundHook;
import vacademy.io.admin_core_service.features.commerce.order.desk.dto.OrderDeskDtos;
import vacademy.io.admin_core_service.features.commerce.order.dto.CartPriceSnapshot;
import vacademy.io.admin_core_service.features.commerce.order.dto.StaffOrderDtos;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrder;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderLine;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderTender;
import vacademy.io.admin_core_service.features.commerce.order.enums.CancelReason;
import vacademy.io.admin_core_service.features.commerce.order.enums.CommerceOrderStatus;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderLegacyRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderLegacyRepository.HoldRow;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderLineRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderTenderRepository;
import vacademy.io.admin_core_service.features.commerce.order.service.CommerceOrderTransitions;
import vacademy.io.admin_core_service.features.commerce.order.service.CommerceOrderTransitions.StaffMove;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.admin_core_service.features.commerce.shipment.entity.CommerceShipment;
import vacademy.io.admin_core_service.features.commerce.shipment.entity.CommerceShipmentLine;
import vacademy.io.admin_core_service.features.commerce.shipment.enums.CommerceShipmentStatus;
import vacademy.io.admin_core_service.features.commerce.shipment.repository.CommerceShipmentLineRepository;
import vacademy.io.admin_core_service.features.commerce.shipment.repository.CommerceShipmentRepository;
import vacademy.io.admin_core_service.features.commerce.shipment.service.CommerceShipmentService;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockMovement;
import vacademy.io.admin_core_service.features.commerce.stock.enums.StockMovementType;
import vacademy.io.admin_core_service.features.commerce.stock.repository.CommercePieceRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.CommercePieceRepository.PieceRow;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockMovementRepository;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockLedgerService;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockPosting;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxResult;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceInputRules;
import vacademy.io.admin_core_service.features.invoice.entity.Invoice;
import vacademy.io.admin_core_service.features.invoice.entity.InvoiceLineItem;
import vacademy.io.admin_core_service.features.invoice.repository.InvoiceLineItemRepository;
import vacademy.io.admin_core_service.features.stock_hold.service.StockHoldService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * The order desk (WP-30): the status moves staff make on {@code POST /orders/{id}/transition}
 * (confirm a COD order, cancel, unpack, undo shipped, undo delivered), the stock-short clear and
 * the bulk route, and the steps the shipment, line-cancel, receipt and staff-order services
 * share.
 *
 * <p>Every change runs through {@link CommerceRequestGuard} (exactly once per client key) and in
 * the lock order of the desk: the {@code commerce_request} row, the order row (FOR UPDATE, read
 * again after the lock), the shipment row, the order lines, stock postings, stock holds, pieces,
 * payment logs, the invoice row and the document series last. Nothing remote runs inside. The
 * role is checked before the lock; the status the client saw ({@code from_status}) is compared
 * under it (409 ORDER_STATE_CHANGED).
 *
 * <p>Cancelling gives the order's stock back in the same transaction
 * ({@code StockHoldService.giveBackSold}), not after it, so the cancel and the stock are one
 * step; a paid order records the money due back on {@code refund_due} and a REFUND_DUE payment
 * exception until refunds exist (WP-32).
 */
@Slf4j
@Service
public class CommerceOrderDeskService {

    public static final String ORDER_STATE_CHANGED = "ORDER_STATE_CHANGED";
    public static final String SHIPMENT_STATE_CHANGED = "SHIPMENT_STATE_CHANGED";
    public static final String REFERENCE_SHIPMENT_LINE = "SHIPMENT_LINE";
    public static final String REASON_SHIP_UNDO = "SHIP_UNDO";
    public static final String HOLD_REASON_CANCELLED = "CANCELLED";
    static final int MAX_TEXT = 500;
    static final int MAX_BULK = 100;
    static final int MAX_BULK_KEY = 27;
    static final Set<CommerceRole> FLOOR = Set.of(CommerceRole.STORE_MANAGER, CommerceRole.WAREHOUSE_STAFF);
    static final Set<CommerceRole> MANAGER = Set.of(CommerceRole.STORE_MANAGER);

    private final CommerceOrderRepository orderRepository;
    private final CommerceOrderLineRepository lineRepository;
    private final CommerceOrderTenderRepository tenderRepository;
    private final CommerceOrderLegacyRepository legacyRepository;
    private final CommerceOrderWriter writer;
    private final CommerceShipmentRepository shipmentRepository;
    private final CommerceShipmentLineRepository shipmentLineRepository;
    private final CommercePieceRepository pieceRepository;
    private final StockHoldService stockHoldService;
    private final StockLedgerService ledger;
    private final StockMovementRepository movementRepository;
    private final CommerceInvoiceService invoiceService;
    private final CommerceCreditNoteService creditNoteService;
    private final CommerceCreditNoteLineRepository creditNoteLineRepository;
    private final CommerceAuditService auditService;
    private final CommerceRefundHook refundHook;
    private final CommerceOrderEvents events;
    private final CommerceRequestGuard requestGuard;
    private final CommerceAccessGuard accessGuard;
    private final CommerceOrderQueryService queryService;
    private final ObjectMapper objectMapper;
    private final ObjectProvider<CommerceSalesMoneyHook> moneyHook;
    private final ObjectProvider<CommerceShipmentService> shipmentService;
    private final InvoiceLineItemRepository invoiceLineItemRepository;
    private final TransactionTemplate ownTransaction;

    @PersistenceContext
    private EntityManager entityManager;

    public CommerceOrderDeskService(CommerceOrderRepository orderRepository,
                                    CommerceOrderLineRepository lineRepository,
                                    CommerceOrderTenderRepository tenderRepository,
                                    CommerceOrderLegacyRepository legacyRepository,
                                    CommerceOrderWriter writer,
                                    CommerceShipmentRepository shipmentRepository,
                                    CommerceShipmentLineRepository shipmentLineRepository,
                                    CommercePieceRepository pieceRepository,
                                    StockHoldService stockHoldService,
                                    StockLedgerService ledger,
                                    StockMovementRepository movementRepository,
                                    CommerceInvoiceService invoiceService,
                                    CommerceCreditNoteService creditNoteService,
                                    CommerceCreditNoteLineRepository creditNoteLineRepository,
                                    CommerceAuditService auditService,
                                    CommerceRefundHook refundHook,
                                    CommerceOrderEvents events,
                                    CommerceRequestGuard requestGuard,
                                    CommerceAccessGuard accessGuard,
                                    CommerceOrderQueryService queryService,
                                    ObjectMapper objectMapper,
                                    ObjectProvider<CommerceSalesMoneyHook> moneyHook,
                                    ObjectProvider<CommerceShipmentService> shipmentService,
                                    InvoiceLineItemRepository invoiceLineItemRepository,
                                    PlatformTransactionManager transactionManager) {
        this.invoiceLineItemRepository = invoiceLineItemRepository;
        this.orderRepository = orderRepository;
        this.lineRepository = lineRepository;
        this.tenderRepository = tenderRepository;
        this.legacyRepository = legacyRepository;
        this.writer = writer;
        this.shipmentRepository = shipmentRepository;
        this.shipmentLineRepository = shipmentLineRepository;
        this.pieceRepository = pieceRepository;
        this.stockHoldService = stockHoldService;
        this.ledger = ledger;
        this.movementRepository = movementRepository;
        this.invoiceService = invoiceService;
        this.creditNoteService = creditNoteService;
        this.creditNoteLineRepository = creditNoteLineRepository;
        this.auditService = auditService;
        this.refundHook = refundHook;
        this.events = events;
        this.requestGuard = requestGuard;
        this.accessGuard = accessGuard;
        this.queryService = queryService;
        this.objectMapper = objectMapper;
        this.moneyHook = moneyHook;
        this.shipmentService = shipmentService;
        this.ownTransaction = new TransactionTemplate(transactionManager);
        this.ownTransaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    // ================================================================== routes

    /** {@code POST /orders/{id}/transition}: rows 1, 2, 3, 5, 6, 8 and 10 of the desk table. */
    public StaffOrderDtos.StaffOrderDetail transition(CustomUserDetails user, String instituteId, String orderId,
                                                      OrderDeskDtos.TransitionRequest request) {
        if (request == null) {
            throw validation("the request has no body");
        }
        String key = CommerceRequestGuard.requireClientKey(request.getClientRequestId());
        CommerceOrderStatus from = status(request.getFromStatus(), "from_status");
        CommerceOrderStatus to = status(request.getToStatus(), "to_status");
        String reason = text(request.getReason(), "reason", MAX_TEXT);
        String note = text(request.getNote(), "note", MAX_TEXT);
        StaffMove move = CommerceOrderTransitions.requireStaffMove(from, to);
        CommerceOrder seen = readOrder(instituteId, orderId);
        authorize(user, instituteId, seen.getFulfilmentLocationId(), move.roles());
        String actor = user.getUserId();
        CommerceRequestGuard.Outcome<String> outcome = requestGuard.run(new CommerceRequestGuard.Key(instituteId, key,
                        "ORDER_TRANSITION", "ORDER", orderId,
                        CommerceRequestGuard.hash("ORDER_TRANSITION", request, orderId), actor),
                () -> {
                    CommerceOrder order = lockOrder(instituteId, orderId);
                    requireStatus(order, from);
                    List<CommerceOrderLine> lines = freshLines(orderId);
                    String why = reason != null ? reason : note;
                    switch (move) {
                        case CONFIRM_COD -> confirmCod(order, actor, note);
                        case CANCEL_COD, CANCEL_CONFIRMED, CANCEL_PACKED ->
                                cancel(order, lines, CancelReason.STAFF_CANCELLED, actor, why);
                        case UNPACK -> unpack(order, lines, actor, why);
                        case UNDO_SHIP -> undoShip(order, lines, actor, why);
                        case UNDO_DELIVERY -> undoDelivery(order, lines, actor, why);
                    }
                    return orderId;
                },
                () -> orderId);
        return detail(instituteId, orderId, user, outcome.replayed());
    }

    /** {@code POST /orders/{id}/stock-short/clear}: staff found the goods or dealt with the order. */
    public StaffOrderDtos.StaffOrderDetail clearStockShort(CustomUserDetails user, String instituteId, String orderId,
                                                           OrderDeskDtos.StockShortClearRequest request) {
        if (request == null) {
            throw validation("the request has no body");
        }
        String key = CommerceRequestGuard.requireClientKey(request.getClientRequestId());
        String note = text(request.getNote(), "note", MAX_TEXT);
        CommerceOrder seen = readOrder(instituteId, orderId);
        authorize(user, instituteId, seen.getFulfilmentLocationId(), MANAGER);
        String actor = user.getUserId();
        CommerceRequestGuard.Outcome<String> outcome = requestGuard.run(new CommerceRequestGuard.Key(instituteId, key,
                        "STOCK_SHORT_CLEAR", "ORDER", orderId,
                        CommerceRequestGuard.hash("STOCK_SHORT_CLEAR", request, orderId), actor),
                () -> {
                    CommerceOrder order = lockOrder(instituteId, orderId);
                    if (!Boolean.TRUE.equals(order.getStockShort())) {
                        throw new ConflictException(ORDER_STATE_CHANGED + ": the order is not flagged stock short");
                    }
                    List<CommerceOrderLine> lines = freshLines(orderId);
                    Map<String, Object> old = new LinkedHashMap<>();
                    for (CommerceOrderLine line : lines) {
                        if (line.getStockShortQty() != null && line.getStockShortQty() > 0) {
                            old.put(line.getId(), line.getStockShortQty());
                        }
                    }
                    clearShort(order, lines);
                    orderRepository.save(order);
                    auditService.record(instituteId, actor, order.getFulfilmentLocationId(), "STOCK_SHORT_CLEARED",
                            "ORDER", orderId, CommerceInputRules.json(Map.of("stock_short_qty", old)), null, note);
                    return orderId;
                },
                () -> orderId);
        return detail(instituteId, orderId, user, outcome.replayed());
    }

    /**
     * {@code POST /orders/bulk}: CONFIRM, PACK, SHIP or DELIVER on many orders. Each item is its
     * own guarded transaction with the key {@code <client_request_id>:<order_id>}; one failure
     * does not stop the others. PACK takes every open line and refuses one-of-a-kind stock
     * (PIECE_SCAN_REQUIRED: scan it on the order).
     */
    public OrderDeskDtos.BulkResponse bulk(CustomUserDetails user, String instituteId,
                                           OrderDeskDtos.BulkRequest request) {
        if (request == null) {
            throw validation("the request has no body");
        }
        String prefix = CommerceRequestGuard.requireClientKey(request.getClientRequestId());
        if (prefix.length() > MAX_BULK_KEY) {
            throw validation("client_request_id of a bulk request is at most " + MAX_BULK_KEY + " characters");
        }
        String action = request.getAction() == null ? "" : request.getAction().trim().toUpperCase(Locale.ROOT);
        if (!Set.of("CONFIRM", "PACK", "SHIP", "DELIVER").contains(action)) {
            throw validation("action is CONFIRM, PACK, SHIP or DELIVER");
        }
        // A caller with no floor role is refused here, not once per item.
        accessGuard.require(user, instituteId, CommerceFeature.ORDERS, FLOOR);
        List<OrderDeskDtos.BulkItem> items = request.getItems();
        if (items == null || items.isEmpty() || items.size() > MAX_BULK) {
            throw validation("items holds 1 to " + MAX_BULK + " orders");
        }
        Set<String> seen = new LinkedHashSet<>();
        for (OrderDeskDtos.BulkItem item : items) {
            if (item == null || !StringUtils.hasText(item.getOrderId()) || item.getOrderId().trim().length() > 36
                    || !seen.add(item.getOrderId().trim())) {
                throw validation("every item names a different order_id");
            }
        }
        List<OrderDeskDtos.BulkResult> results = new ArrayList<>();
        CommerceShipmentService shipments = shipmentService.getObject();
        for (OrderDeskDtos.BulkItem item : items) {
            String orderId = item.getOrderId().trim();
            String itemKey = prefix + ":" + orderId;
            try {
                switch (action) {
                    case "CONFIRM" -> transitionWithKey(user, instituteId, orderId, itemKey, item.getFromStatus(),
                            CommerceOrderStatus.CONFIRMED.name());
                    case "PACK" -> shipments.packAll(user, instituteId, orderId, itemKey, item.getFromStatus());
                    case "SHIP" -> shipments.shipOrder(user, instituteId, orderId, itemKey, item);
                    default -> shipments.deliverOrder(user, instituteId, orderId, itemKey, item);
                }
                results.add(OrderDeskDtos.BulkResult.builder().orderId(orderId).ok(true).build());
            } catch (RuntimeException e) {
                results.add(OrderDeskDtos.BulkResult.builder().orderId(orderId).ok(false).code(codeOf(e))
                        .message(messageOf(e)).build());
            }
        }
        return OrderDeskDtos.BulkResponse.builder().results(results).build();
    }

    /** A transition with a key made by the bulk route (it may carry a colon). */
    private void transitionWithKey(CustomUserDetails user, String instituteId, String orderId, String itemKey,
                                   String fromStatus, String toStatus) {
        CommerceOrderStatus from = status(fromStatus, "from_status");
        CommerceOrderStatus to = status(toStatus, "to_status");
        StaffMove move = CommerceOrderTransitions.requireStaffMove(from, to);
        CommerceOrder seen = readOrder(instituteId, orderId);
        authorize(user, instituteId, seen.getFulfilmentLocationId(), move.roles());
        Map<String, String> body = new LinkedHashMap<>();
        body.put("from_status", from.name());
        body.put("to_status", to.name());
        requestGuard.run(new CommerceRequestGuard.Key(instituteId, itemKey, "ORDER_TRANSITION", "ORDER", orderId,
                        CommerceRequestGuard.hash("ORDER_TRANSITION", body, orderId), user.getUserId()),
                () -> {
                    CommerceOrder order = lockOrder(instituteId, orderId);
                    requireStatus(order, from);
                    if (move == StaffMove.CONFIRM_COD) {
                        confirmCod(order, user.getUserId(), null);
                    } else {
                        throw new ConflictException("ORDER_TRANSITION_NOT_ALLOWED: not a bulk move");
                    }
                    return orderId;
                }, () -> orderId);
    }

    // ================================================================== moves (inside the order lock)

    /** Row 1: a COD order above the confirmation amount is confirmed after a call. */
    void confirmCod(CommerceOrder order, String actor, String note) {
        CommerceOrderStatus from = CommerceOrderStatus.of(order.getStatus());
        CommerceOrderTransitions.require(from, CommerceOrderStatus.CONFIRMED);
        order.setStatus(CommerceOrderStatus.CONFIRMED.name());
        order.setConfirmedAt(new Date());
        order.setCodConfirmDueAt(null);
        orderRepository.save(order);
        // A deferral of the COD timer must not delay the invoice sweep of the confirmed order.
        orderRepository.clearSweep(order.getId());
        writer.history(order, from, CommerceOrderStatus.CONFIRMED, actor, note == null ? "Confirmed by staff" : note);
        events.afterCommit(event(CommerceOrderEvents.ORDER_CONFIRMED, order, null, true));
    }

    /**
     * Rows 2, 3 and 6 (and the timer's COD cancel): the order is cancelled. A packed order is
     * unpacked first (its credit note covers the cancel too). The units not shipped go back on
     * sale now, pending tenders are voided, the plans close; an unpaid order gives its coupon
     * use back, a paid one records the whole amount paid as due back.
     */
    public void cancel(CommerceOrder order, List<CommerceOrderLine> lines, CancelReason reason, String actor,
                       String note) {
        CommerceOrderStatus from = CommerceOrderStatus.of(order.getStatus());
        CommerceOrderTransitions.require(from, CommerceOrderStatus.CANCELLED);
        if (from == CommerceOrderStatus.PACKED) {
            unpackShipment(order, lines, actor, "Order cancelled");
        }
        for (CommerceOrderLine line : items(lines)) {
            int open = line.openQuantity();
            if (open > 0 && hasHold(line)) {
                stockHoldService.giveBackSold(line.getUserPlanId(), line.getPackageSessionId(), open,
                        HOLD_REASON_CANCELLED);
            }
        }
        List<String> planIds = planIds(lines);
        if (!planIds.isEmpty()) {
            legacyRepository.cancelPlans(planIds);
        }
        voidPendingTenders(order);
        boolean paid = order.getAmountPaid() != null && order.getAmountPaid().signum() > 0;
        if (!paid && StringUtils.hasText(order.getAppliedCouponDiscountId())) {
            // The order took one use of its coupon and was never paid: the use goes back, once
            // (this runs once per order, under its lock).
            legacyRepository.giveCouponUseBack(order.getAppliedCouponDiscountId());
        }
        if (paid) {
            raiseRefundDue(order, order.getAmountPaid().subtract(nz(order.getRefundDue())), "OCAN:" + order.getId(),
                    "The order was cancelled after it was paid.");
        }
        if (from != CommerceOrderStatus.PACKED) {
            // invoiceAt = CONFIRMED: the invoice of a confirmed order is credited in full.
            creditRest(order, lines, "OCAN:" + order.getId(), "Order cancelled", actor);
        }
        order.setStatus(CommerceOrderStatus.CANCELLED.name());
        order.setCancelReason(reason.name());
        order.setCancelledAt(new Date());
        order.setCodConfirmDueAt(null);
        clearShort(order, lines);
        orderRepository.save(order);
        writer.history(order, from, CommerceOrderStatus.CANCELLED, actor,
                reason.name() + (note == null ? "" : ": " + note));
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("from_status", from.name());
        detail.put("cancel_reason", reason.name());
        detail.put("refund_due", String.valueOf(order.getRefundDue()));
        auditService.record(order.getInstituteId(), actor, order.getFulfilmentLocationId(), "ORDER_CANCELLED",
                "ORDER", order.getId(), null, CommerceInputRules.json(detail), note);
        events.afterCommit(event(CommerceOrderEvents.ORDER_CANCELLED, order, null, true));
    }

    /** Row 5: the parcel is unpacked; its credit note is issued and the order is CONFIRMED again. */
    void unpack(CommerceOrder order, List<CommerceOrderLine> lines, String actor, String note) {
        unpackShipment(order, lines, actor, note == null ? "Unpacked" : note);
        order.setStatus(CommerceOrderStatus.CONFIRMED.name());
        orderRepository.save(order);
        writer.history(order, CommerceOrderStatus.PACKED, CommerceOrderStatus.CONFIRMED, actor,
                note == null ? "Unpacked" : "Unpacked: " + note);
        auditService.record(order.getInstituteId(), actor, order.getFulfilmentLocationId(), "ORDER_UNPACKED",
                "ORDER", order.getId(), null, null, note);
    }

    /**
     * The live PACKED shipment is cancelled: its pieces go back IN_STOCK, the invoice is credited
     * in full ({@code UNPACK:<shipment>:<ship_count>}) and {@code packed_at} is cleared. The
     * stock holds stay SOLD: the units are still promised to the order.
     */
    void unpackShipment(CommerceOrder order, List<CommerceOrderLine> lines, String actor, String reason) {
        CommerceShipment shipment = liveShipment(order);
        if (shipment == null || CommerceShipmentStatus.of(shipment.getStatus()) != CommerceShipmentStatus.PACKED) {
            throw new ConflictException(SHIPMENT_STATE_CHANGED + ": the order has no packed parcel");
        }
        for (CommerceShipmentLine shipped : shipmentLineRepository.findByShipmentIdOrderByCreatedAtAscIdAsc(
                shipment.getId())) {
            CommerceOrderLine line = byId(lines, shipped.getOrderLineId());
            for (PieceRow piece : pieceRepository.findRowsByOrderLine(order.getInstituteId(), shipped.getOrderLineId())) {
                if ("RESERVED".equals(piece.getStatus())
                        && pieceRepository.unreserve(order.getInstituteId(), piece.getId(),
                        shipped.getOrderLineId()) != 1) {
                    throw new ConflictException("PIECE_NOT_AVAILABLE: piece " + piece.getCode() + " changed meanwhile");
                }
            }
            if (line != null && line.getPieceId() != null) {
                line.setPieceId(null);
                lineRepository.save(line);
            }
        }
        shipment.setStatus(CommerceShipmentStatus.CANCELLED.name());
        shipment.setCancelledAt(new Date());
        shipment.setCancelledBy(actor);
        shipmentRepository.save(shipment);
        creditRest(order, lines, "UNPACK:" + shipment.getId() + ":" + nz(shipment.getShipCount()), reason, actor);
        order.setPackedAt(null);
    }

    /**
     * Row 8: the parcel did not leave after all. Every SALE row of the current ship is reversed
     * (reason SHIP_UNDO), pieces go back to RESERVED, the holds the ship closed are SOLD again,
     * and the order is PACKED with no shipped quantity and no cost. The invoice is kept.
     */
    void undoShip(CommerceOrder order, List<CommerceOrderLine> lines, String actor, String note) {
        CommerceShipment shipment = liveShipment(order);
        if (shipment == null || CommerceShipmentStatus.of(shipment.getStatus()) != CommerceShipmentStatus.SHIPPED) {
            throw new ConflictException(SHIPMENT_STATE_CHANGED + ": the parcel of this order is not in transit");
        }
        // The reversals post stock movements today: refused in a closed stock period, as ship is.
        shipmentService.getObject().requirePeriodOpen(order.getInstituteId());
        List<CommerceShipmentLine> shipped = shipmentLineRepository.findByShipmentIdOrderByCreatedAtAscIdAsc(
                shipment.getId());
        List<StockPosting> reversals = new ArrayList<>();
        for (StockMovement sale : currentSales(order.getInstituteId(), shipment, shipped)) {
            reversals.add(StockPosting.builder()
                    .instituteId(order.getInstituteId())
                    .locationId(sale.getLocationId())
                    .packageSessionId(sale.getPackageSessionId())
                    .pieceId(sale.getPieceId())
                    .type(StockMovementType.SALE)
                    .quantityDelta(-sale.getQuantityDelta())
                    .reversesMovementId(sale.getId())
                    .reason(REASON_SHIP_UNDO)
                    .referenceType(REFERENCE_SHIPMENT_LINE)
                    .referenceId(sale.getReferenceId())
                    .actorUserId(actor)
                    .idempotencyKey("SALE_UNDO:" + sale.getId())
                    .build());
        }
        ledger.postAll(reversals);
        for (CommerceShipmentLine line : shipped) {
            CommerceOrderLine orderLine = byId(lines, line.getOrderLineId());
            if (orderLine == null) {
                continue;
            }
            stockHoldService.reopenShipped(orderLine.getUserPlanId(), orderLine.getPackageSessionId());
            orderLine.setQtyShipped(Math.max(0, orderLine.getQtyShipped() - line.getQuantity()));
            orderLine.setCostTotal(null);
            lineRepository.save(orderLine);
        }
        shipment.setStatus(CommerceShipmentStatus.PACKED.name());
        shipment.setShippedAt(null);
        shipment.setShippedBy(null);
        shipmentRepository.save(shipment);
        order.setStatus(CommerceOrderStatus.PACKED.name());
        order.setShippedAt(null);
        orderRepository.save(order);
        writer.history(order, CommerceOrderStatus.SHIPPED, CommerceOrderStatus.PACKED, actor,
                note == null ? "Shipment undone" : "Shipment undone: " + note);
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("shipment_id", shipment.getId());
        detail.put("ship_count", shipment.getShipCount());
        detail.put("reversed_movements", reversals.size());
        auditService.record(order.getInstituteId(), actor, shipment.getLocationId(), "SHIP_UNDONE", "SHIPMENT",
                shipment.getId(), null, CommerceInputRules.json(detail), note);
    }

    /** Row 10: marked delivered by mistake. Refused once COD money is in or a return exists. */
    void undoDelivery(CommerceOrder order, List<CommerceOrderLine> lines, String actor, String note) {
        if (StringUtils.hasText(order.getCodRemittanceId()) || codCollected(order)) {
            throw new ConflictException("COD_COLLECTED: the cash of this order has been collected");
        }
        for (CommerceOrderLine line : lines) {
            if (line.getQtyReturned() != null && line.getQtyReturned() > 0) {
                throw new ConflictException("HAS_RETURNS: a line of this order has a return");
            }
        }
        CommerceShipment shipment = liveShipment(order);
        if (shipment == null || CommerceShipmentStatus.of(shipment.getStatus()) != CommerceShipmentStatus.DELIVERED) {
            throw new ConflictException(SHIPMENT_STATE_CHANGED + ": the parcel of this order is not delivered");
        }
        Map<String, Object> old = new LinkedHashMap<>();
        old.put("delivered_on", String.valueOf(shipment.getDeliveredOn()));
        shipment.setStatus(CommerceShipmentStatus.SHIPPED.name());
        shipment.setDeliveredOn(null);
        shipment.setDeliveredAt(null);
        shipment.setDeliveredBy(null);
        shipmentRepository.save(shipment);
        order.setStatus(CommerceOrderStatus.SHIPPED.name());
        order.setDeliveredAt(null);
        orderRepository.save(order);
        writer.history(order, CommerceOrderStatus.DELIVERED, CommerceOrderStatus.SHIPPED, actor,
                note == null ? "Delivery undone" : "Delivery undone: " + note);
        auditService.record(order.getInstituteId(), actor, shipment.getLocationId(), "DELIVERY_UNDONE", "SHIPMENT",
                shipment.getId(), CommerceInputRules.json(old), null, note);
    }

    // ================================================================== shared steps

    /** The order, read now (not locked); 404 when it is not an order of the institute. */
    public CommerceOrder readOrder(String instituteId, String orderId) {
        CommerceOrder order = ownTransaction.execute(status -> {
            if (!StringUtils.hasText(orderId)) {
                return null;
            }
            CommerceOrder found = orderRepository.findByIdAndInstituteId(orderId.trim(), instituteId).orElse(null);
            if (found != null && entityManager != null) {
                entityManager.refresh(found);
            }
            return found;
        });
        if (order == null) {
            throw new VacademyException(HttpStatus.NOT_FOUND, "ORDER_NOT_FOUND: no such order");
        }
        return order;
    }

    /**
     * The orders feature, a member of the institute in one of {@code roles} (or ADMIN), and, for
     * anyone but an ADMIN, assigned to the order's location (an order without one is ADMIN-only).
     */
    public void authorize(CustomUserDetails user, String instituteId, String locationId, Set<CommerceRole> roles) {
        accessGuard.require(user, instituteId, CommerceFeature.ORDERS, roles, locationId);
    }

    /** The order row locked FOR UPDATE and read again; 404 for another institute's order. */
    public CommerceOrder lockOrder(String instituteId, String orderId) {
        CommerceOrder order = orderRepository.lockById(orderId).orElse(null);
        if (order != null && entityManager != null) {
            entityManager.refresh(order);
        }
        if (order == null || !instituteId.equals(order.getInstituteId())) {
            throw new VacademyException(HttpStatus.NOT_FOUND, "ORDER_NOT_FOUND: no such order");
        }
        return order;
    }

    /** 409 ORDER_STATE_CHANGED when the order is not in the status the client saw. */
    public static void requireStatus(CommerceOrder order, CommerceOrderStatus expected) {
        if (expected == null || !expected.name().equals(order.getStatus())) {
            throw new ConflictException(ORDER_STATE_CHANGED + ": the order is " + order.getStatus() + " now, not "
                    + (expected == null ? "what was sent" : expected.name()));
        }
    }

    /** The lines of the order as the database has them now. */
    public List<CommerceOrderLine> freshLines(String orderId) {
        List<CommerceOrderLine> lines = lineRepository.findByOrderIdOrderByLineNoAsc(orderId);
        if (entityManager != null) {
            for (CommerceOrderLine line : lines) {
                entityManager.refresh(line);
            }
        }
        return lines;
    }

    /** The live shipment of an order, locked and read again; null when there is none. */
    public CommerceShipment liveShipment(CommerceOrder order) {
        Optional<String> id = shipmentRepository.findLiveId(order.getId());
        return id.map(shipmentId -> lockShipment(order.getInstituteId(), shipmentId)).orElse(null);
    }

    /**
     * A cash-on-delivery order whose amount changed while its parcel is PACKED (a line cancel):
     * the parcel collects the order's new {@code cod_amount}. The caller holds the order lock.
     */
    public void syncPackedCodAmount(CommerceOrder order) {
        if (!"COD".equals(order.getPaymentMethod())) {
            return;
        }
        CommerceShipment shipment = liveShipment(order);
        if (shipment == null || CommerceShipmentStatus.of(shipment.getStatus()) != CommerceShipmentStatus.PACKED) {
            return;
        }
        if (shipment.getCodAmount() == null || order.getCodAmount() == null
                || shipment.getCodAmount().compareTo(order.getCodAmount()) != 0) {
            shipment.setCodAmount(order.getCodAmount());
            shipmentRepository.save(shipment);
        }
    }

    /** A shipment of the institute locked FOR UPDATE and read again; 404 otherwise. */
    public CommerceShipment lockShipment(String instituteId, String shipmentId) {
        if (shipmentRepository.lockId(shipmentId, instituteId).isEmpty()) {
            throw new VacademyException(HttpStatus.NOT_FOUND, "SHIPMENT_NOT_FOUND: no such shipment");
        }
        CommerceShipment shipment = shipmentRepository.findById(shipmentId)
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "SHIPMENT_NOT_FOUND: no such shipment"));
        if (entityManager != null) {
            entityManager.refresh(shipment);
        }
        return shipment;
    }

    /** The SALE rows the current ship of the shipment posted (not reversals). */
    public List<StockMovement> currentSales(String instituteId, CommerceShipment shipment,
                                            List<CommerceShipmentLine> lines) {
        List<StockMovement> out = new ArrayList<>();
        if (lines.isEmpty()) {
            return out;
        }
        String suffix = ":" + nz(shipment.getShipCount());
        for (StockMovement movement : movementRepository.findByInstituteIdAndReferenceTypeAndReferenceIdInOrderByCreatedAtAsc(
                instituteId, REFERENCE_SHIPMENT_LINE, lines.stream().map(CommerceShipmentLine::getId).toList())) {
            if (StockMovementType.SALE.name().equals(movement.getType()) && movement.getReversesMovementId() == null
                    && movement.getIdempotencyKey() != null && movement.getIdempotencyKey().startsWith("SALE:")
                    && movement.getIdempotencyKey().endsWith(suffix)) {
                out.add(movement);
            }
        }
        return out;
    }

    /** True when the line's plan holds stock rows (a TRACKED variant); an UNTRACKED one has none. */
    public boolean hasHold(CommerceOrderLine line) {
        if (!StringUtils.hasText(line.getUserPlanId())) {
            return false;
        }
        for (HoldRow row : legacyRepository.findHoldsOfPlans(List.of(line.getUserPlanId()))) {
            if (line.getPackageSessionId() != null && line.getPackageSessionId().equals(row.getPackageSessionId())) {
                return true;
            }
        }
        return false;
    }

    /** The placement tax snapshot of the order. */
    public TaxResult placementTax(CommerceOrder order) {
        try {
            CartPriceSnapshot snapshot = objectMapper.readValue(order.getPriceSnapshotJson(), CartPriceSnapshot.class);
            if (snapshot == null || snapshot.getTax() == null) {
                throw new IllegalStateException("no tax result");
            }
            return snapshot.getTax();
        } catch (Exception e) {
            throw new IllegalStateException("order " + order.getId() + " has no readable price snapshot", e);
        }
    }

    /** The placement tax less the cancelled units: what the invoice is issued from. */
    public TaxResult remainingTax(CommerceOrder order, List<CommerceOrderLine> lines) {
        Map<String, Integer> cancelled = new HashMap<>();
        Map<String, Integer> quantity = new HashMap<>();
        for (CommerceOrderLine line : items(lines)) {
            quantity.put(line.getLineRef(), line.getQuantity());
            if (line.getQtyCancelled() != null && line.getQtyCancelled() > 0) {
                cancelled.put(line.getLineRef(), line.getQtyCancelled());
            }
        }
        return CommerceOrderRemainder.remainingTax(placementTax(order), cancelled, quantity);
    }

    /**
     * Issues the order's invoice now (pack), from the remaining tax, with every payment log of
     * the order. An order whose earlier invoice was credited in full when it was unpacked gets a
     * new one. Returns the live invoice.
     */
    public Invoice issueInvoice(CommerceOrder order, List<CommerceOrderLine> lines, String actor) {
        return issueInvoice(order, lines, actor, true);
    }

    /**
     * As {@link #issueInvoice(CommerceOrder, List, String)}; with {@code allowAfterFullCredit}
     * false (the invoice backlog) an order whose invoice was credited in full is refused
     * (INVOICE_FULLY_CREDITED) instead of billed again.
     */
    public Invoice issueInvoice(CommerceOrder order, List<CommerceOrderLine> lines, String actor,
                                boolean allowAfterFullCredit) {
        TaxResult tax = remainingTax(order, lines);
        List<CommerceInvoiceLineExtra> extras = new ArrayList<>();
        for (CommerceOrderLine line : items(lines)) {
            extras.add(CommerceInvoiceLineExtra.builder().lineRef(line.getLineRef()).sku(line.getSkuSnapshot())
                    .packageSessionId(line.getPackageSessionId()).pieceId(line.getPieceId()).build());
        }
        CommerceInvoiceRequest request = CommerceInvoiceRequest.builder()
                .commerceOrderId(order.getId())
                .orderNumber(order.getOrderNumber())
                .channel(order.getChannel())
                .locationId(order.getFulfilmentLocationId())
                .userId(order.getUserId())
                .buyerName(order.getCustomerName())
                .buyerPhone(order.getCustomerPhone())
                .buyerEmail(order.getCustomerEmail())
                .buyerGstin(order.getBuyerGstin())
                .billingAddress(addressText(order.getBillingAddressJson()))
                .shippingAddress(addressText(order.getShippingAddressJson()))
                .currency(order.getCurrency())
                .tax(tax)
                .lineExtras(extras)
                .paymentLogIds(logIds(lines))
                .actorUserId(actor)
                .allowAfterFullCredit(allowAfterFullCredit)
                .build();
        return invoiceService.issue(order.getInstituteId(), request).invoice();
    }

    /** The order's invoice that is neither cancelled nor credited in full, if any. */
    public Invoice liveInvoice(CommerceOrder order, List<CommerceOrderLine> lines) {
        List<String> logIds = logIds(lines);
        return logIds.isEmpty() ? null : invoiceService.liveDocument(order.getInstituteId(), logIds).orElse(null);
    }

    /**
     * Credits everything left of the live invoice with the key {@code key}; nothing when there
     * is no live invoice. Returns the note, or null.
     */
    public CreditNoteDTO creditRest(CommerceOrder order, List<CommerceOrderLine> lines, String key, String reason,
                                    String actor) {
        Invoice invoice = liveInvoice(order, lines);
        if (invoice == null) {
            return null;
        }
        return creditNoteService.issue(order.getInstituteId(), actor, CreditNoteRequest.builder()
                .clientRequestId(key)
                .invoiceId(invoice.getId())
                .full(true)
                .reason(reason)
                .build());
    }

    /** Credits the named invoice lines (a line cancel); nothing without a live invoice. */
    public CreditNoteDTO creditLines(CommerceOrder order, List<CommerceOrderLine> lines, String key, String reason,
                                     String actor, List<CreditNoteLineRequest> creditLines) {
        Invoice invoice = liveInvoice(order, lines);
        if (invoice == null || creditLines == null || creditLines.isEmpty()) {
            return null;
        }
        return creditNoteService.issue(order.getInstituteId(), actor, CreditNoteRequest.builder()
                .clientRequestId(key)
                .invoiceId(invoice.getId())
                .full(false)
                .reason(reason)
                .lines(creditLines)
                .build());
    }

    /** The order line ref ({@code source_id}) of each line of an invoice, by invoice line id. */
    public Map<String, String> invoiceLineRefs(String invoiceId) {
        Map<String, String> out = new LinkedHashMap<>();
        if (!StringUtils.hasText(invoiceId)) {
            return out;
        }
        for (InvoiceLineItem item : invoiceLineItemRepository.findByInvoiceId(invoiceId)) {
            if (item.getSourceId() != null) {
                out.put(item.getId(), item.getSourceId());
            }
        }
        return out;
    }

    /** The lines of an invoice. */
    public List<InvoiceLineItem> invoiceLines(String invoiceId) {
        return StringUtils.hasText(invoiceId) ? invoiceLineItemRepository.findByInvoiceId(invoiceId) : List.of();
    }

    /** Stores the cost of the goods coming back on the lines of a credit note (an RTO). */
    public void setCreditCosts(String instituteId, CreditNoteDTO note, Map<String, BigDecimal> costByInvoiceLine) {
        if (note == null || note.getLines() == null) {
            return;
        }
        for (CreditNoteLineDTO line : note.getLines()) {
            BigDecimal cost = costByInvoiceLine.get(line.getInvoiceLineItemId());
            if (cost == null) {
                continue;
            }
            CommerceCreditNoteLine row = creditNoteLineRepository.findById(line.getId()).orElse(null);
            if (row != null && instituteId.equals(row.getInstituteId()) && row.getCostTotal() == null) {
                row.setCostTotal(cost);
                creditNoteLineRepository.save(row);
            }
        }
    }

    /**
     * Raises {@code refund_due} by {@code amount} (never above amount_paid) and records the
     * REFUND_DUE exception of the event. The caller saves the order.
     */
    public void raiseRefundDue(CommerceOrder order, BigDecimal amount, String eventKey, String detail) {
        if (amount == null || amount.signum() <= 0) {
            return;
        }
        BigDecimal paid = nz(order.getAmountPaid());
        BigDecimal due = nz(order.getRefundDue()).add(amount).min(paid);
        BigDecimal raised = due.subtract(nz(order.getRefundDue()));
        if (raised.signum() <= 0) {
            return;
        }
        order.setRefundDue(due);
        refundHook.refundDue(order.getInstituteId(), order.getId(), order.getOrderNumber(), eventKey, raised,
                order.getCurrency(), detail);
    }

    /** Every PENDING tender becomes VOID; the money hook hears of each after the commit. */
    public void voidPendingTenders(CommerceOrder order) {
        for (CommerceOrderTender tender : tenderRepository.findByOrderIdOrderByCreatedAtAsc(order.getId())) {
            if (!CommerceOrderTender.STATUS_PENDING.equals(tender.getStatus())) {
                continue;
            }
            if (tenderRepository.settleOne(tender.getId(), CommerceOrderTender.STATUS_VOID, null, null) == 1) {
                String instituteId = order.getInstituteId();
                String orderId = order.getId();
                String tenderId = tender.getId();
                String mode = tender.getMode();
                BigDecimal amount = tender.getAmount();
                afterCommitMoney(hook -> hook.tenderVoided(instituteId, orderId, tenderId, mode, amount));
            }
        }
    }

    /** Clears the stock-short flag of the order and its lines. The caller saves the order. */
    public void clearShort(CommerceOrder order, List<CommerceOrderLine> lines) {
        order.setStockShort(false);
        order.setStockShortAt(null);
        for (CommerceOrderLine line : lines) {
            if (line.getStockShortQty() != null && line.getStockShortQty() > 0) {
                line.setStockShortQty(0);
                lineRepository.save(line);
            }
        }
    }

    /** Runs a call of the books' hook after the commit; a missing or failing hook changes nothing. */
    public void afterCommitMoney(java.util.function.Consumer<CommerceSalesMoneyHook> call) {
        Runnable run = () -> {
            try {
                CommerceSalesMoneyHook hook = moneyHook.getIfAvailable();
                if (hook != null) {
                    call.accept(hook);
                }
            } catch (RuntimeException e) {
                log.error("COMMERCE_ALERT sales_money_hook_failed", e);
            }
        };
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    run.run();
                }
            });
        } else {
            run.run();
        }
    }

    /** The answer of every desk route: the order as it is now, with the caller's next actions. */
    public StaffOrderDtos.StaffOrderDetail detail(String instituteId, String orderId, CustomUserDetails user,
                                                  boolean replayed) {
        StaffOrderDtos.StaffOrderDetail detail = queryService.staffDetail(instituteId, orderId,
                CommerceAccessGuard.rolesOf(user), isAdmin(user), true);
        detail.setReplayed(replayed ? Boolean.TRUE : null);
        return detail;
    }

    /**
     * An order event. {@code refId}: the shipment, return or refund it is about (null for the
     * order itself); it is also the event's {@code shipmentId}, as before.
     */
    public CommerceOrderEvents.OrderEvent event(String type, CommerceOrder order, String refId, boolean notify) {
        return new CommerceOrderEvents.OrderEvent(type, order.getInstituteId(), order.getId(), order.getOrderNumber(),
                refId, notify);
    }

    // ================================================================== helpers

    static boolean isAdmin(CustomUserDetails user) {
        if (user == null || user.getAuthorities() == null) {
            return false;
        }
        return user.getAuthorities().stream().anyMatch(a -> a != null && a.getAuthority() != null
                && "ADMIN".equalsIgnoreCase(a.getAuthority().trim()));
    }

    private boolean codCollected(CommerceOrder order) {
        for (CommerceOrderTender tender : tenderRepository.findByOrderIdOrderByCreatedAtAsc(order.getId())) {
            if (CommerceOrderTender.MODE_COD.equals(tender.getMode())
                    && CommerceOrderTender.STATUS_RECEIVED.equals(tender.getStatus())) {
                return true;
            }
        }
        return false;
    }

    public static List<CommerceOrderLine> items(List<CommerceOrderLine> lines) {
        return lines.stream().filter(line -> CommerceOrderLine.TYPE_ITEM.equals(line.getLineType())).toList();
    }

    public static CommerceOrderLine byId(List<CommerceOrderLine> lines, String id) {
        for (CommerceOrderLine line : lines) {
            if (line.getId().equals(id)) {
                return line;
            }
        }
        return null;
    }

    static List<String> planIds(List<CommerceOrderLine> lines) {
        List<String> ids = new ArrayList<>();
        for (CommerceOrderLine line : lines) {
            if (StringUtils.hasText(line.getUserPlanId())) {
                ids.add(line.getUserPlanId());
            }
        }
        return ids;
    }

    static List<String> logIds(List<CommerceOrderLine> lines) {
        List<String> ids = new ArrayList<>();
        for (CommerceOrderLine line : lines) {
            if (StringUtils.hasText(line.getPaymentLogId())) {
                ids.add(line.getPaymentLogId());
            }
        }
        return ids;
    }

    /** "1 Road, Area, Landmark, City 09 226001" from the stored address JSON. */
    String addressText(String json) {
        if (!StringUtils.hasText(json)) {
            return null;
        }
        try {
            JsonNode node = objectMapper.readTree(json);
            List<String> parts = new ArrayList<>();
            for (String field : List.of("name", "line1", "line2", "landmark", "city")) {
                String value = node.path(field).asText(null);
                if (StringUtils.hasText(value)) {
                    parts.add(value.trim());
                }
            }
            String tail = ((node.path("state_code").asText("") + " " + node.path("pincode").asText("")).trim());
            if (!tail.isEmpty()) {
                parts.add(tail);
            }
            return parts.isEmpty() ? null : String.join(", ", parts);
        } catch (Exception e) {
            return null;
        }
    }

    static CommerceOrderStatus status(String raw, String field) {
        CommerceOrderStatus status = CommerceOrderStatus.of(raw == null ? null : raw.trim().toUpperCase(Locale.ROOT));
        if (status == null) {
            throw validation(field + " is an order status");
        }
        return status;
    }

    static String text(String raw, String field, int max) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        String value = raw.trim();
        if (value.length() > max) {
            throw validation(field + " is at most " + max + " characters");
        }
        return value;
    }

    static InvalidRequestException validation(String message) {
        return new InvalidRequestException("VALIDATION: " + message);
    }

    static BigDecimal nz(BigDecimal value) {
        return value == null ? BigDecimal.ZERO.setScale(2) : value;
    }

    static int nz(Integer value) {
        return value == null ? 0 : value;
    }

    /** The code of a refusal: the text before the first colon when it is a code. */
    static String codeOf(RuntimeException e) {
        String message = e.getMessage();
        if (message != null) {
            int colon = message.indexOf(':');
            if (colon > 0 && message.substring(0, colon).matches("[A-Za-z_]{3,48}")) {
                return message.substring(0, colon);
            }
        }
        return e instanceof InvalidRequestException ? "VALIDATION" : "ERROR";
    }

    static String messageOf(RuntimeException e) {
        String message = e.getMessage();
        if (message == null) {
            return e.getClass().getSimpleName();
        }
        return message.length() > 300 ? message.substring(0, 300) : message;
    }
}
