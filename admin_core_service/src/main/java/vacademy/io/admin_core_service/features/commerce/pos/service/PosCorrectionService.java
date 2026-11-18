package vacademy.io.admin_core_service.features.commerce.pos.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.common.request.CommerceRequestGuard;
import vacademy.io.admin_core_service.features.commerce.document.service.CommerceInvoiceService;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceOrderWriter;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceOrderDeskService;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceOrderEvents;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrder;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderLine;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderTender;
import vacademy.io.admin_core_service.features.commerce.order.enums.CancelReason;
import vacademy.io.admin_core_service.features.commerce.order.enums.CommerceOrderStatus;
import vacademy.io.admin_core_service.features.commerce.order.enums.TenderMode;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderLegacyRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderLineRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderTenderRepository;
import vacademy.io.admin_core_service.features.commerce.order.service.CommerceOrderTransitions;
import vacademy.io.admin_core_service.features.commerce.pos.dto.PosDtos;
import vacademy.io.admin_core_service.features.commerce.pos.entity.PosSession;
import vacademy.io.admin_core_service.features.commerce.pos.enums.PosApprovalAction;
import vacademy.io.admin_core_service.features.commerce.pos.repository.PosReadRepository;
import vacademy.io.admin_core_service.features.commerce.pos.repository.PosSessionRepository;
import vacademy.io.admin_core_service.features.commerce.returns.entity.CommerceReturn;
import vacademy.io.admin_core_service.features.commerce.returns.enums.ReturnStatus;
import vacademy.io.admin_core_service.features.commerce.returns.repository.CommerceReturnRepository;
import vacademy.io.admin_core_service.features.commerce.security.CommerceApprovalService;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockMovement;
import vacademy.io.admin_core_service.features.commerce.stock.enums.StockMovementType;
import vacademy.io.admin_core_service.features.commerce.stock.repository.CommercePieceRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockMovementRepository;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockLedgerService;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockPosting;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceInputRules;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * Corrections of a counter bill while its session is open: the void (the bill never happened:
 * stock back, tenders VOID, the invoice cancelled with its number kept) and the tender change
 * (paid by another mode). A cashier needs a manager's PIN for both; a manager or ADMIN acts on
 * their own login. Each runs once per {@code client_request_id} ({@link CommerceRequestGuard}),
 * in one transaction, in the shop's lock order: the order, the PIN (a remote role check), the
 * session FOR SHARE (a close waits), the stock ledger, the document.
 */
@Slf4j
@Service
public class PosCorrectionService {

    public static final String VOID_SESSION_CLOSED = "VOID_SESSION_CLOSED";
    public static final String VOID_HAS_RETURNS = "VOID_HAS_RETURNS";
    public static final String VOID_HAS_EXCHANGE = "VOID_HAS_EXCHANGE";
    public static final String TENDER_STATE_CHANGED = "TENDER_STATE_CHANGED";
    static final String REFERENCE_ORDER_LINE = "ORDER_LINE";
    static final String REASON_POS_VOID = "POS_VOID";

    private final PosAccess access;
    private final PosReceiptService receipts;
    private final PosSessionRepository sessionRepository;
    private final PosReadRepository readRepository;
    private final CommerceOrderDeskService desk;
    private final CommerceOrderWriter writer;
    private final CommerceOrderRepository orderRepository;
    private final CommerceOrderLineRepository lineRepository;
    private final CommerceOrderTenderRepository tenderRepository;
    private final CommerceOrderLegacyRepository legacyRepository;
    private final CommerceOrderEvents events;
    private final StockMovementRepository movementRepository;
    private final StockLedgerService ledger;
    private final CommercePieceRepository pieceRepository;
    private final CommerceReturnRepository returnRepository;
    private final CommerceInvoiceService invoiceService;
    private final CommerceApprovalService approvalService;
    private final CommerceAuditService auditService;
    private final CommerceRequestGuard requestGuard;

    @PersistenceContext
    private EntityManager entityManager;

    public PosCorrectionService(PosAccess access, PosReceiptService receipts, PosSessionRepository sessionRepository,
                                PosReadRepository readRepository, CommerceOrderDeskService desk,
                                CommerceOrderWriter writer, CommerceOrderRepository orderRepository,
                                CommerceOrderLineRepository lineRepository,
                                CommerceOrderTenderRepository tenderRepository,
                                CommerceOrderLegacyRepository legacyRepository, CommerceOrderEvents events,
                                StockMovementRepository movementRepository, StockLedgerService ledger,
                                CommercePieceRepository pieceRepository, CommerceReturnRepository returnRepository,
                                CommerceInvoiceService invoiceService, CommerceApprovalService approvalService,
                                CommerceAuditService auditService, CommerceRequestGuard requestGuard) {
        this.access = access;
        this.receipts = receipts;
        this.sessionRepository = sessionRepository;
        this.readRepository = readRepository;
        this.desk = desk;
        this.writer = writer;
        this.orderRepository = orderRepository;
        this.lineRepository = lineRepository;
        this.tenderRepository = tenderRepository;
        this.legacyRepository = legacyRepository;
        this.events = events;
        this.movementRepository = movementRepository;
        this.ledger = ledger;
        this.pieceRepository = pieceRepository;
        this.returnRepository = returnRepository;
        this.invoiceService = invoiceService;
        this.approvalService = approvalService;
        this.auditService = auditService;
        this.requestGuard = requestGuard;
    }

    // ================================================================== void

    /** {@code POST /pos/sales/{orderId}/void}: answers the bill (VOID) and its receipt. */
    public PosDtos.SaleAnswer voidSale(CustomUserDetails user, String instituteId, String orderId,
                                       PosDtos.VoidRequest request) {
        if (request == null) {
            throw validation("the request has no body");
        }
        String key = CommerceRequestGuard.requireClientKey(request.clientRequestId());
        String reason = PosSaleService.text(request.reason(), "reason", 500);
        if (reason == null) {
            throw validation("reason is required (1 to 500 characters)");
        }
        CommerceOrder seen = receipts.readPosOrder(instituteId, orderId);
        access.requireAt(user, instituteId, PosAccess.TILL, seen.getFulfilmentLocationId());
        boolean manager = PosAccess.isManager(user);
        if (!manager && request.approval() == null && !voided(seen)) {
            throw PosSessionService.approvalRequired(PosApprovalAction.POS_VOID, "a bill is voided with a manager's "
                    + "PIN");
        }
        String actor = user.getUserId();
        String hash = CommerceRequestGuard.hash("POS_VOID", request.withoutApproval(), seen.getId());
        CommerceRequestGuard.Outcome<String> outcome = requestGuard.run(new CommerceRequestGuard.Key(instituteId, key,
                        "POS_VOID", "ORDER", seen.getId(), hash, actor),
                () -> voidInside(instituteId, seen.getId(), reason, request.approval(), manager, actor),
                seen::getId);
        return answer(user, instituteId, outcome.value(), outcome.replayed());
    }

    static boolean voided(CommerceOrder order) {
        return CommerceOrderStatus.CANCELLED.name().equals(order.getStatus())
                && CancelReason.POS_VOID.name().equals(order.getCancelReason());
    }

    /** Steps 1 to 7 of the void, inside the request guard's transaction. */
    String voidInside(String instituteId, String orderId, String reason, PosDtos.Approval approval, boolean manager,
                      String actor) {
        // 1. The order (lock 2).
        CommerceOrder order = lockPosOrder(instituteId, orderId);
        if (voided(order)) {
            return order.getId();
        }
        if (CommerceOrderStatus.of(order.getStatus()) != CommerceOrderStatus.DELIVERED) {
            throw new ConflictException(CommerceOrderDeskService.ORDER_STATE_CHANGED + ": the bill is "
                    + order.getStatus() + ", not DELIVERED");
        }
        String locationId = order.getFulfilmentLocationId();

        // 2. The PIN (remote role check), before the session, stock and series locks.
        String approver = approve(instituteId, locationId, actor, approval, manager, PosApprovalAction.POS_VOID,
                "ORDER", order.getId(), order.getTotal(), reason);

        // 3. The session FOR SHARE (lock 3): a void belongs to the open session of the bill.
        PosSession session = lockSession(instituteId, order.getPosSessionId());
        if (session == null || !session.isOpen()) {
            throw new ConflictException(VOID_SESSION_CLOSED + ": the counter was closed after this bill; take a "
                    + "return instead");
        }
        List<CommerceOrderLine> lines = desk.freshLines(order.getId());
        for (CommerceReturn ret : returnRepository.findByOrderIdOrderByCreatedAtAsc(order.getId())) {
            if (!ReturnStatus.REJECTED.name().equals(ret.getStatus())) {
                throw new ConflictException(VOID_HAS_RETURNS + ": goods of this bill were returned; take a return "
                        + "instead");
            }
        }
        for (CommerceOrderLine line : lines) {
            if (line.getQtyReturned() != null && line.getQtyReturned() > 0) {
                throw new ConflictException(VOID_HAS_RETURNS + ": goods of this bill were returned; take a return "
                        + "instead");
            }
        }
        List<CommerceOrderTender> tenders = tenderRepository.findByOrderIdOrderByCreatedAtAsc(order.getId());
        for (CommerceOrderTender tender : tenders) {
            if (TenderMode.CREDIT_NOTE.name().equals(tender.getMode())
                    && !CommerceOrderTender.STATUS_VOID.equals(tender.getStatus())) {
                throw new ConflictException(VOID_HAS_EXCHANGE + ": this bill used a return's credit; take a return "
                        + "instead");
            }
        }

        // 4. Stock: every POS_SALE of the bill's lines put back, at the sale's cost, in one ledger call.
        List<CommerceOrderLine> items = CommerceOrderDeskService.items(lines);
        List<String> lineIds = items.stream().map(CommerceOrderLine::getId).toList();
        List<StockMovement> sales = lineIds.isEmpty() ? List.of()
                : movementRepository.findByInstituteIdAndReferenceTypeAndReferenceIdInOrderByCreatedAtAsc(instituteId,
                REFERENCE_ORDER_LINE, lineIds);
        List<StockPosting> reversals = new ArrayList<>();
        List<StockMovement> pieceSales = new ArrayList<>();
        for (StockMovement sale : sales) {
            if (!StockMovementType.POS_SALE.name().equals(sale.getType()) || sale.getQuantityDelta() >= 0
                    || StringUtils.hasText(sale.getReversesMovementId())) {
                continue;
            }
            long left = Math.abs((long) sale.getQuantityDelta())
                    - Math.abs(movementRepository.sumReversed(instituteId, sale.getId()));
            if (left <= 0) {
                continue;
            }
            reversals.add(reversal(sale, (int) left, actor));
            if (StringUtils.hasText(sale.getPieceId())) {
                pieceSales.add(sale);
            }
        }
        if (!reversals.isEmpty()) {
            ledger.postAll(reversals);
        }
        for (StockMovement sale : pieceSales) {
            if (pieceRepository.unlinkFromLine(instituteId, sale.getPieceId(), sale.getReferenceId()) != 1) {
                throw new ConflictException(PosSaleService.PIECE_STATE + ": a piece of this bill is no longer on "
                        + "its line");
            }
        }

        // 5. Tenders VOID, plans cancelled, lines and order cancelled.
        for (CommerceOrderTender tender : tenders) {
            if (!CommerceOrderTender.STATUS_RECEIVED.equals(tender.getStatus())) {
                continue;
            }
            tender.setStatus(CommerceOrderTender.STATUS_VOID);
            tenderRepository.save(tender);
            hookVoided(instituteId, tender);
        }
        List<String> planIds = new ArrayList<>();
        for (CommerceOrderLine line : lines) {
            if (StringUtils.hasText(line.getUserPlanId())) {
                planIds.add(line.getUserPlanId());
            }
        }
        if (!planIds.isEmpty()) {
            legacyRepository.cancelPlans(planIds);
        }
        for (CommerceOrderLine line : items) {
            line.setQtyShipped(0);
            line.setQtyCancelled(line.getQuantity());
            line.setPieceId(null);
        }
        lineRepository.saveAll(items);
        CommerceOrderTransitions.require(CommerceOrderStatus.DELIVERED, CommerceOrderStatus.CANCELLED);
        order.setStatus(CommerceOrderStatus.CANCELLED.name());
        order.setCancelReason(CancelReason.POS_VOID.name());
        order.setCancelledAt(new Date());
        order.setAmountPaid(BigDecimal.ZERO.setScale(2));
        order.setPaymentStatus(CommerceOrderWriter.PAYMENT_UNPAID);
        order = orderRepository.save(order);

        // 6. The document is cancelled; its number stays (the reversal rule of a same-session void).
        for (PosReadRepository.InvoiceFact invoice : readRepository.invoicesOf(instituteId, List.of(order.getId()))) {
            if (!invoice.cancelled()) {
                invoiceService.cancel(instituteId, actor, invoice.id(), REASON_POS_VOID + ": " + reason);
            }
        }

        // 7. History, audit, the event (no message to the buyer).
        writer.history(order, CommerceOrderStatus.DELIVERED, CommerceOrderStatus.CANCELLED, actor,
                REASON_POS_VOID + ": " + reason);
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("order_number", order.getOrderNumber());
        detail.put("total", order.getTotal() == null ? null : order.getTotal().toPlainString());
        detail.put("session_id", session.getId());
        detail.put("approved_by", approver);
        auditService.record(instituteId, actor, locationId, "POS_VOID", "ORDER", order.getId(), null,
                CommerceInputRules.json(detail), reason);
        events.afterCommit(desk.event(CommerceOrderEvents.ORDER_CANCELLED, order, null, false));
        log.info("POS void of bill {} ({}) at session {} by {}", order.getOrderNumber(), order.getId(),
                session.getId(), actor);
        return order.getId();
    }

    /** The reversal of one POS_SALE movement: units back at its location, named by its line. */
    static StockPosting reversal(StockMovement sale, int quantity, String actor) {
        return StockPosting.builder()
                .instituteId(sale.getInstituteId())
                .locationId(sale.getLocationId())
                .packageSessionId(sale.getPackageSessionId())
                .pieceId(sale.getPieceId())
                .type(StockMovementType.POS_SALE)
                .quantityDelta(quantity)
                .reversesMovementId(sale.getId())
                .reason(REASON_POS_VOID)
                .referenceType(REFERENCE_ORDER_LINE)
                .referenceId(sale.getReferenceId())
                .actorUserId(actor)
                .idempotencyKey("POS_VOID:" + sale.getId())
                .build();
    }

    // ================================================================== tender change

    /** {@code POST /pos/sales/{orderId}/tenders/{tenderId}/change}: answers the bill and its receipt. */
    public PosDtos.SaleAnswer changeTender(CustomUserDetails user, String instituteId, String orderId,
                                           String tenderId, PosDtos.TenderChangeRequest request) {
        if (request == null) {
            throw validation("the request has no body");
        }
        String key = CommerceRequestGuard.requireClientKey(request.clientRequestId());
        TenderMode mode = TenderMode.of(request.mode());
        if (mode == null || !TenderMode.STAFF_RECEIVED.contains(mode)) {
            throw validation("mode is CASH, UPI, CARD, BANK_TRANSFER or CHEQUE");
        }
        String reference = PosSaleService.text(request.reference(), "reference", 100);
        if (reference != null && !PosSaleService.REFERENCE.matcher(reference).matches()) {
            throw validation("reference holds letters, digits, spaces and / _ . : # -");
        }
        if ((mode == TenderMode.UPI || mode == TenderMode.CARD) && reference == null) {
            throw validation("a " + mode.name() + " tender needs its reference");
        }
        String tender = tenderId == null ? null : tenderId.trim();
        if (tender == null || tender.isEmpty() || tender.length() > 36) {
            throw validation("tenderId is required");
        }
        CommerceOrder seen = receipts.readPosOrder(instituteId, orderId);
        access.requireAt(user, instituteId, PosAccess.TILL, seen.getFulfilmentLocationId());
        boolean manager = PosAccess.isManager(user);
        if (!manager && request.approval() == null) {
            throw PosSessionService.approvalRequired(PosApprovalAction.POS_TENDER_CHANGE, "a payment mode is changed "
                    + "with a manager's PIN");
        }
        String actor = user.getUserId();
        String hash = CommerceRequestGuard.hash("POS_TENDER_CHANGE", request.withoutApproval(), seen.getId(), tender);
        CommerceRequestGuard.Outcome<String> outcome = requestGuard.run(new CommerceRequestGuard.Key(instituteId, key,
                        "POS_TENDER_CHANGE", "ORDER_TENDER", tender, hash, actor),
                () -> changeInside(instituteId, seen.getId(), tender, mode, reference, request.approval(), manager,
                        actor),
                seen::getId);
        return answer(user, instituteId, outcome.value(), outcome.replayed());
    }

    String changeInside(String instituteId, String orderId, String tenderId, TenderMode mode, String reference,
                        PosDtos.Approval approval, boolean manager, String actor) {
        CommerceOrder order = lockPosOrder(instituteId, orderId);
        if (CommerceOrderStatus.of(order.getStatus()) != CommerceOrderStatus.DELIVERED) {
            throw new ConflictException(CommerceOrderDeskService.ORDER_STATE_CHANGED + ": the bill is "
                    + order.getStatus() + ", not DELIVERED");
        }
        CommerceOrderTender old = tenderRepository.findById(tenderId).orElse(null);
        if (old != null && entityManager != null) {
            entityManager.refresh(old);
        }
        if (old == null || !order.getId().equals(old.getOrderId())) {
            throw new ConflictException(TENDER_STATE_CHANGED + ": no such payment on this bill");
        }
        String locationId = order.getFulfilmentLocationId();
        String approver = approve(instituteId, locationId, actor, approval, manager,
                PosApprovalAction.POS_TENDER_CHANGE, "ORDER_TENDER", old.getId(), old.getAmount(), null);
        PosSession session = lockSession(instituteId, order.getPosSessionId());
        if (session == null || !session.isOpen()) {
            throw new ConflictException(PosSessionService.SESSION_NOT_OPEN + ": the counter of this bill is closed");
        }
        if (!CommerceOrderTender.STATUS_RECEIVED.equals(old.getStatus())
                || TenderMode.CREDIT_NOTE.name().equals(old.getMode())) {
            throw new ConflictException(TENDER_STATE_CHANGED + ": this payment is " + old.getStatus()
                    + (TenderMode.CREDIT_NOTE.name().equals(old.getMode()) ? " (a return's credit)" : ""));
        }
        if (mode.name().equals(old.getMode()) && Objects.equals(reference, old.getReference())) {
            throw validation("nothing changes");
        }
        old.setStatus(CommerceOrderTender.STATUS_VOID);
        tenderRepository.save(old);
        CommerceOrderTender now = new CommerceOrderTender();
        now.setInstituteId(order.getInstituteId());
        now.setOrderId(order.getId());
        now.setPosSessionId(old.getPosSessionId());
        now.setMode(mode.name());
        now.setAmount(old.getAmount());
        now.setReference(reference);
        now.setStatus(CommerceOrderTender.STATUS_RECEIVED);
        now.setReceivedAt(new Date());
        now.setRecordedBy(actor);
        now.setCashTendered(null);
        now = tenderRepository.save(now);

        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("order_number", order.getOrderNumber());
        detail.put("old_tender_id", old.getId());
        detail.put("new_tender_id", now.getId());
        detail.put("old_mode", old.getMode());
        detail.put("new_mode", mode.name());
        detail.put("amount", old.getAmount().toPlainString());
        detail.put("session_id", session.getId());
        detail.put("approved_by", approver);
        auditService.record(instituteId, actor, locationId, "POS_TENDER_CHANGED", "ORDER", order.getId(), null,
                CommerceInputRules.json(detail), approval == null ? null : approval.reason());
        hookVoided(instituteId, old);
        String newId = now.getId();
        String newMode = now.getMode();
        BigDecimal amount = now.getAmount();
        String id = order.getId();
        desk.afterCommitMoney(hook -> hook.tenderReceived(instituteId, id, newId, newMode, amount));
        return order.getId();
    }

    // ================================================================== shared

    private CommerceOrder lockPosOrder(String instituteId, String orderId) {
        CommerceOrder order = desk.lockOrder(instituteId, orderId);
        if (!CommerceOrderWriter.CHANNEL_POS.equals(order.getChannel())) {
            throw new VacademyException(HttpStatus.NOT_FOUND, "ORDER_NOT_FOUND: no such counter bill");
        }
        return order;
    }

    private PosSession lockSession(String instituteId, String sessionId) {
        if (sessionId == null) {
            return null;
        }
        PosSession session = sessionRepository.lockForShare(instituteId, sessionId).orElse(null);
        if (session != null && entityManager != null) {
            entityManager.refresh(session);
        }
        return session;
    }

    /** The PIN of a cashier's action, inside its transaction; null for a manager (no PIN). */
    private String approve(String instituteId, String locationId, String actor, PosDtos.Approval approval,
                           boolean manager, PosApprovalAction action, String referenceType, String referenceId,
                           BigDecimal amount, String fallbackReason) {
        if (manager) {
            return null;
        }
        if (approval == null) {
            throw PosSessionService.approvalRequired(action, "a manager's PIN is needed");
        }
        String reason = StringUtils.hasText(approval.reason()) ? approval.reason() : fallbackReason;
        approvalService.approve(instituteId, locationId, actor, approval.approverUserId(), approval.pin(),
                action.name(), referenceType, referenceId, amount, clip(reason, 500));
        return approval.approverUserId();
    }

    private void hookVoided(String instituteId, CommerceOrderTender tender) {
        String orderId = tender.getOrderId();
        String tenderId = tender.getId();
        String mode = tender.getMode();
        BigDecimal amount = tender.getAmount();
        desk.afterCommitMoney(hook -> hook.tenderVoided(instituteId, orderId, tenderId, mode, amount));
    }

    private PosDtos.SaleAnswer answer(CustomUserDetails user, String instituteId, String orderId, boolean replayed) {
        return new PosDtos.SaleAnswer(receipts.saleDetail(user, instituteId, orderId),
                receipts.receipt(instituteId, orderId), replayed);
    }

    private static String clip(String value, int max) {
        if (value == null || value.isBlank()) {
            return null;
        }
        String v = value.trim();
        return v.length() <= max ? v : v.substring(0, max);
    }

    static InvalidRequestException validation(String message) {
        return new InvalidRequestException("VALIDATION: " + message);
    }
}
