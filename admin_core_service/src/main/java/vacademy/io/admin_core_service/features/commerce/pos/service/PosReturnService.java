package vacademy.io.admin_core_service.features.commerce.pos.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.common.request.CommerceRequestGuard;
import vacademy.io.admin_core_service.features.commerce.document.entity.CommerceCreditNote;
import vacademy.io.admin_core_service.features.commerce.document.repository.CommerceCreditNoteRepository;
import vacademy.io.admin_core_service.features.commerce.document.service.DocumentClock;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceOrderDeskService;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrder;
import vacademy.io.admin_core_service.features.commerce.order.enums.ReturnCondition;
import vacademy.io.admin_core_service.features.commerce.pos.dto.PosDtos;
import vacademy.io.admin_core_service.features.commerce.pos.entity.PosSession;
import vacademy.io.admin_core_service.features.commerce.pos.enums.PosApprovalAction;
import vacademy.io.admin_core_service.features.commerce.pos.repository.PosSessionRepository;
import vacademy.io.admin_core_service.features.commerce.returns.dto.ReturnDtos;
import vacademy.io.admin_core_service.features.commerce.returns.entity.CommerceRefund;
import vacademy.io.admin_core_service.features.commerce.returns.entity.CommerceReturn;
import vacademy.io.admin_core_service.features.commerce.returns.enums.RefundKind;
import vacademy.io.admin_core_service.features.commerce.returns.enums.RefundMethod;
import vacademy.io.admin_core_service.features.commerce.returns.enums.RefundSource;
import vacademy.io.admin_core_service.features.commerce.returns.enums.RefundStatus;
import vacademy.io.admin_core_service.features.commerce.returns.enums.ReturnStatus;
import vacademy.io.admin_core_service.features.commerce.returns.policy.CommerceReturnPolicy;
import vacademy.io.admin_core_service.features.commerce.returns.repository.CommerceRefundRepository;
import vacademy.io.admin_core_service.features.commerce.returns.repository.CommerceReturnRepository;
import vacademy.io.admin_core_service.features.commerce.returns.service.CommerceRefundService;
import vacademy.io.admin_core_service.features.commerce.returns.service.CommerceReturnService;
import vacademy.io.admin_core_service.features.commerce.security.CommerceApprovalService;
import vacademy.io.admin_core_service.features.commerce.stock.service.CommerceCounterService;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceInputRules;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * A return at the billing counter (WP-42), of any delivered and paid bill (any channel, any
 * store): created, approved and received at once at the session's location, then settled by
 * money back from this drawer (CASH, UPI, BANK_TRANSFER; the refund is stamped with the session)
 * or kept as credit for a new bill (EXCHANGE: the screen starts a bill with
 * {@code exchange.return_id}). The return service does the stock, the credit note and the
 * order's refund due; the refund service writes the refund. One transaction, in the shop's lock
 * order: the order, the PINs (remote), the session FOR SHARE, then the return's own locks.
 */
@Slf4j
@Service
public class PosReturnService {

    public static final String SETTLE_REFUND = "REFUND";
    public static final String SETTLE_EXCHANGE = "EXCHANGE";
    static final int MAX_ENTRIES = 100;
    /** Placeholder reason of a preview that names none (its REASON_NOT_ALLOWED warning is dropped). */
    static final String PREVIEW_REASON = "OTHER";

    private final PosAccess access;
    private final PosSettingsService settings;
    private final PosSessionRepository sessionRepository;
    private final CommerceOrderDeskService desk;
    private final CommerceReturnService returnService;
    private final CommerceRefundService refundService;
    private final CommerceReturnRepository returnRepository;
    private final CommerceRefundRepository refundRepository;
    private final CommerceCreditNoteRepository creditNoteRepository;
    private final CommerceCounterService counterService;
    private final CommerceApprovalService approvalService;
    private final CommerceAuditService auditService;
    private final CommerceRequestGuard requestGuard;
    private final DocumentClock clock;
    private final TransactionTemplate readOnly;

    @PersistenceContext
    private EntityManager entityManager;

    public PosReturnService(PosAccess access, PosSettingsService settings, PosSessionRepository sessionRepository,
                            CommerceOrderDeskService desk, CommerceReturnService returnService,
                            CommerceRefundService refundService, CommerceReturnRepository returnRepository,
                            CommerceRefundRepository refundRepository,
                            CommerceCreditNoteRepository creditNoteRepository, CommerceCounterService counterService,
                            CommerceApprovalService approvalService, CommerceAuditService auditService,
                            CommerceRequestGuard requestGuard, DocumentClock clock,
                            PlatformTransactionManager transactionManager) {
        this.access = access;
        this.settings = settings;
        this.sessionRepository = sessionRepository;
        this.desk = desk;
        this.returnService = returnService;
        this.refundService = refundService;
        this.returnRepository = returnRepository;
        this.refundRepository = refundRepository;
        this.creditNoteRepository = creditNoteRepository;
        this.counterService = counterService;
        this.approvalService = approvalService;
        this.auditService = auditService;
        this.requestGuard = requestGuard;
        this.clock = clock;
        this.readOnly = new TransactionTemplate(transactionManager);
        this.readOnly.setReadOnly(true);
    }

    /** The answer of a return, and whether it answers an earlier request with the same key. */
    public record Outcome(PosDtos.ReturnAnswer answer, boolean replayed) {
    }

    // ================================================================== validation

    /** How the return is settled, as validated. */
    record CleanSettle(String kind, RefundMethod method, String reference) {

        boolean cashRefund() {
            return SETTLE_REFUND.equals(kind) && method == RefundMethod.CASH;
        }
    }

    /** The body as validated: the create body, the receive lines, the settle. */
    record Clean(String clientRequestId, String sessionId, String orderId, ReturnDtos.CreateReturnRequest create,
                 List<ReturnDtos.ReceiveLine> received, CleanSettle settle, PosDtos.Approval approval) {
    }

    static Clean validate(PosDtos.ReturnRequest request) {
        if (request == null) {
            throw validation("the request has no body");
        }
        String key = CommerceRequestGuard.requireClientKey(request.clientRequestId());
        String sessionId = required(request.sessionId(), "session_id");
        String orderId = required(request.orderId(), "order_id");
        List<PosDtos.ReturnLine> asked = request.lines();
        if (asked == null || asked.isEmpty() || asked.size() > MAX_ENTRIES) {
            throw validation("lines holds 1 to " + MAX_ENTRIES + " entries");
        }
        Map<String, Integer> units = new LinkedHashMap<>();
        Set<String> seen = new LinkedHashSet<>();
        List<ReturnDtos.ReceiveLine> received = new ArrayList<>();
        for (PosDtos.ReturnLine line : asked) {
            String lineId = line == null ? null : PosSaleService.text(line.orderLineId(), "order_line_id", 36);
            if (lineId == null || line.quantity() == null || line.quantity() < 1 || line.quantity() > 100_000) {
                throw validation("every line names an order_line_id and a quantity of at least 1");
            }
            ReturnCondition condition = ReturnCondition.of(line.condition());
            if (condition == null) {
                throw validation("condition is RESALEABLE or DAMAGED");
            }
            if (!seen.add(lineId + "|" + condition.name())) {
                throw validation("a line appears once per condition");
            }
            units.merge(lineId, line.quantity(), Integer::sum);
            received.add(ReturnDtos.ReceiveLine.builder().orderLineId(lineId).condition(condition.name())
                    .quantity(line.quantity())
                    .pieceIds(line.pieceIds() == null || line.pieceIds().isEmpty() ? null
                            : new ArrayList<>(line.pieceIds()))
                    .build());
        }
        CleanSettle settle = settle(request.settle());
        List<ReturnDtos.LineRequest> lines = new ArrayList<>();
        units.forEach((id, quantity) -> lines.add(ReturnDtos.LineRequest.builder().orderLineId(id).quantity(quantity)
                .build()));
        ReturnDtos.CreateReturnRequest create = ReturnDtos.CreateReturnRequest.builder()
                .clientRequestId(key)
                .orderId(orderId)
                .reason(request.reason())
                .reasonNote(request.reasonNote())
                .overrideReason(request.overrideReason())
                .lines(lines)
                .build();
        return new Clean(key, sessionId, orderId, create, received, settle, request.approval());
    }

    static CleanSettle settle(PosDtos.Settle settle) {
        String kind = settle == null || settle.kind() == null ? null
                : settle.kind().trim().toUpperCase(Locale.ROOT);
        if (SETTLE_EXCHANGE.equals(kind)) {
            if (settle.method() != null || settle.reference() != null) {
                throw validation("settle.method and settle.reference are only for a REFUND");
            }
            return new CleanSettle(kind, null, null);
        }
        if (!SETTLE_REFUND.equals(kind)) {
            throw validation("settle.kind is REFUND or EXCHANGE");
        }
        RefundMethod method = RefundMethod.of(settle.method());
        if (method != RefundMethod.CASH && method != RefundMethod.UPI && method != RefundMethod.BANK_TRANSFER) {
            throw validation("settle.method is CASH, UPI or BANK_TRANSFER");
        }
        String reference = PosSaleService.text(settle.reference(), "settle.reference", 100);
        if (reference != null && !PosSaleService.REFERENCE.matcher(reference).matches()) {
            throw validation("settle.reference holds letters, digits, spaces and / _ . : # -");
        }
        if (method != RefundMethod.CASH && reference == null) {
            throw validation("a " + method.name() + " refund needs its reference");
        }
        if (method == RefundMethod.CASH && reference != null) {
            throw validation("a CASH refund has no reference");
        }
        return new CleanSettle(kind, method, reference);
    }

    // ================================================================== preview

    /** {@code POST /pos/returns/preview}: the policy, warnings, credit estimate and the PINs it needs. */
    public PosDtos.ReturnPreview preview(CustomUserDetails user, String instituteId,
                                         PosDtos.ReturnPreviewRequest request) {
        if (request == null) {
            throw validation("the request has no body");
        }
        access.session(user, instituteId, required(request.sessionId(), "session_id"));
        String orderId = required(request.orderId(), "order_id");
        desk.readOrder(instituteId, orderId);
        Map<String, Integer> units = new LinkedHashMap<>();
        if (request.lines() != null) {
            for (PosDtos.ReturnLine line : request.lines()) {
                if (line == null || line.orderLineId() == null || line.quantity() == null) {
                    throw validation("every line names an order_line_id and a quantity of at least 1");
                }
                units.merge(line.orderLineId().trim(), line.quantity(), Integer::sum);
            }
        }
        if (units.isEmpty()) {
            throw validation("lines holds 1 to " + MAX_ENTRIES + " entries");
        }
        boolean reasonGiven = StringUtils.hasText(request.reason());
        List<ReturnDtos.LineRequest> lines = new ArrayList<>();
        units.forEach((id, quantity) -> lines.add(ReturnDtos.LineRequest.builder().orderLineId(id).quantity(quantity)
                .build()));
        ReturnDtos.ReturnPreview preview = returnService.previewForCounter(instituteId,
                ReturnDtos.CreateReturnRequest.builder().orderId(orderId)
                        .reason(reasonGiven ? request.reason() : PREVIEW_REASON).lines(lines).build());
        List<String> warnings = new ArrayList<>(preview.getWarnings() == null ? List.of() : preview.getWarnings());
        if (!reasonGiven) {
            warnings.remove(CommerceReturnPolicy.REASON_NOT_ALLOWED);
        }
        CleanSettle settle = null;
        if (request.settle() != null) {
            try {
                settle = settle(request.settle());
            } catch (InvalidRequestException e) {
                settle = null;
            }
        }
        boolean cash = settle == null || settle.cashRefund();
        List<String> needs = needsApproval(PosAccess.isManager(user), warnings, cash, preview.getCreditEstimate(),
                settings.limits(instituteId).cashRefundLimit());
        List<PosDtos.Returnable> returnable = new ArrayList<>();
        if (preview.getLines() != null) {
            for (ReturnDtos.ReturnableLine line : preview.getLines()) {
                returnable.add(new PosDtos.Returnable(line.getOrderLineId(),
                        Math.max(0, line.getReturnableQuantity() == null ? 0 : line.getReturnableQuantity())));
            }
        }
        return new PosDtos.ReturnPreview(returnable, warnings, preview.getPolicy(), preview.getCreditEstimate(),
                needs);
    }

    /**
     * The PINs a cashier needs: {@code POS_RETURN_OVERRIDE} when the policy warns,
     * {@code POS_CASH_REFUND} when cash going back is more than the cashier's limit. A manager
     * needs none.
     */
    static List<String> needsApproval(boolean manager, List<String> warnings, boolean cashRefund,
                                      BigDecimal credit, BigDecimal cashRefundLimit) {
        List<String> needs = new ArrayList<>();
        if (manager) {
            return needs;
        }
        if (warnings != null && !warnings.isEmpty()) {
            needs.add(PosApprovalAction.POS_RETURN_OVERRIDE.name());
        }
        if (cashRefund && aboveLimit(credit, cashRefundLimit)) {
            needs.add(PosApprovalAction.POS_CASH_REFUND.name());
        }
        return needs;
    }

    static boolean aboveLimit(BigDecimal amount, BigDecimal limit) {
        BigDecimal l = limit == null ? BigDecimal.ZERO : limit;
        return amount != null && amount.compareTo(l) > 0;
    }

    // ================================================================== the return

    /** What the transaction needs, decided before it opens. */
    record Plan(String instituteId, Clean clean, PosSession session, String number, String hash, String actor,
                boolean manager, boolean override, boolean cashApproved, BigDecimal estimate, BigDecimal limit) {
    }

    /** {@code POST /pos/returns}. */
    public Outcome create(CustomUserDetails user, String instituteId, PosDtos.ReturnRequest request) {
        Clean clean = validate(request);
        PosSession session = access.session(user, instituteId, clean.sessionId());
        PosSessionService.requireOpen(session);
        String actor = user.getUserId();
        String hash = CommerceRequestGuard.hash("POS_RETURN", request.withoutApproval());
        CommerceReturn earlier = readOnly.execute(tx -> returnRepository
                .findByInstituteIdAndClientRequestId(instituteId, clean.clientRequestId()).orElse(null));
        boolean manager = PosAccess.isManager(user);
        boolean override = false;
        boolean cashApproved = false;
        BigDecimal estimate = null;
        BigDecimal limit = settings.limits(instituteId).cashRefundLimit();
        String number;
        if (earlier != null) {
            // A repeat: the request guard answers it (or refuses another body); no rule is asked again.
            number = earlier.getReturnNumber();
        } else {
            desk.readOrder(instituteId, clean.orderId());
            ReturnDtos.ReturnPreview preview = returnService.previewForCounter(instituteId, copy(clean.create()));
            List<String> warnings = preview.getWarnings() == null ? List.of() : preview.getWarnings();
            estimate = preview.getCreditEstimate();
            if (!warnings.isEmpty() && !StringUtils.hasText(clean.create().getOverrideReason())) {
                throw new ConflictException(CommerceReturnService.RETURN_POLICY_WARNING + ": "
                        + String.join(", ", warnings) + "; go ahead with override_reason");
            }
            override = !warnings.isEmpty() && !manager;
            if (override && clean.approval() == null) {
                throw PosSessionService.approvalRequired(PosApprovalAction.POS_RETURN_OVERRIDE,
                        "a return against the shop's policy needs a manager's PIN");
            }
            boolean cashNeeded = clean.settle().cashRefund() && !manager && aboveLimit(estimate, limit);
            if (cashNeeded && clean.approval() == null) {
                throw PosSessionService.approvalRequired(PosApprovalAction.POS_CASH_REFUND, "cash back of "
                        + estimate.toPlainString() + " is above the cashier's limit");
            }
            // A PIN sent with a cash refund that neither rule above asked for answers the check
            // after the credit note (the credit came out above the limit): it covers the cash.
            cashApproved = clean.settle().cashRefund() && !manager && clean.approval() != null
                    && (cashNeeded || !override);
            number = counterService.nextNumber(instituteId, CommerceReturnService.COUNTER_SCOPE);
        }
        Plan plan = new Plan(instituteId, clean, session, number, hash, actor, manager, override, cashApproved,
                estimate, limit);
        CommerceRequestGuard.Outcome<String> outcome = requestGuard.run(new CommerceRequestGuard.Key(instituteId,
                        clean.clientRequestId(), "POS_RETURN", "ORDER", clean.orderId(), hash, actor),
                () -> write(plan),
                () -> returnRepository.findByInstituteIdAndClientRequestId(instituteId, clean.clientRequestId())
                        .map(CommerceReturn::getId).orElse(null));
        return new Outcome(answer(instituteId, outcome.value(), outcome.replayed()), outcome.replayed());
    }

    /** Steps 1 to 4, inside the request guard's transaction. */
    String write(Plan plan) {
        String instituteId = plan.instituteId();
        Clean clean = plan.clean();
        String actor = plan.actor();
        // 1. The order (lock 2), the PINs (remote), the session FOR SHARE (lock 3).
        CommerceOrder order = desk.lockOrder(instituteId, clean.orderId());
        String locationId = plan.session().getLocationId();
        String approver = null;
        PosDtos.Approval approval = clean.approval();
        String why = approval == null ? null : StringUtils.hasText(approval.reason()) ? approval.reason()
                : clean.create().getOverrideReason();
        if (plan.override()) {
            approvalService.approve(instituteId, locationId, actor, approval.approverUserId(), approval.pin(),
                    PosApprovalAction.POS_RETURN_OVERRIDE.name(), "ORDER", order.getId(), plan.estimate(),
                    clip(why, 500));
            approver = approval.approverUserId();
        }
        if (plan.cashApproved()) {
            approvalService.approve(instituteId, locationId, actor, approval.approverUserId(), approval.pin(),
                    PosApprovalAction.POS_CASH_REFUND.name(), "ORDER", order.getId(), plan.estimate(),
                    clip(why, 500));
            approver = approval.approverUserId();
        }
        PosSession session = sessionRepository.lockForShare(instituteId, plan.session().getId()).orElse(null);
        if (session != null && entityManager != null) {
            entityManager.refresh(session);
        }
        if (session == null || !session.isOpen()
                || (!plan.manager() && !actor.equals(session.getCashierUserId()))) {
            throw new ConflictException(PosSessionService.SESSION_NOT_OPEN + ": this counter is closed");
        }

        // 2. The return: created COUNTER, approved, received here (stock, credit note, refund due).
        CommerceReturnService.CounterReturn made = returnService.counterReturnInside(instituteId,
                copy(clean.create()), locationId, plan.number(), plan.hash(), actor, clean.received());
        BigDecimal credit = made.credit() == null ? BigDecimal.ZERO.setScale(2) : made.credit();

        // 3. Settle: money back from this drawer, or the credit kept for a new bill.
        CommerceRefund refund = null;
        CleanSettle settle = clean.settle();
        if (SETTLE_REFUND.equals(settle.kind()) && credit.signum() > 0) {
            CommerceRefundService.requireWithinDue(order, credit);
            if (settle.cashRefund() && !plan.manager() && !plan.cashApproved()
                    && aboveLimit(credit, plan.limit())) {
                throw PosSessionService.approvalRequired(PosApprovalAction.POS_CASH_REFUND, "cash back of "
                        + credit.toPlainString() + " is above the cashier's limit");
            }
            RefundStatus status = settle.method() == RefundMethod.CASH || settle.reference() != null
                    ? RefundStatus.PROCESSED : RefundStatus.PENDING;
            refund = refundService.insertInside(order, new CommerceRefundService.NewRefund(RefundKind.ORDER,
                    RefundSource.STAFF, settle.method(), status, credit, made.returnId(), made.creditNoteId(), null,
                    null, null, settle.reference(), null,
                    status == RefundStatus.PROCESSED ? clock.today(instituteId) : null,
                    "Counter return " + made.returnNumber(), refundKey(made.returnId()), actor, session.getId()));
        }

        // 4. Audit.
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("return_number", made.returnNumber());
        detail.put("order_number", order.getOrderNumber());
        detail.put("credit", credit.toPlainString());
        detail.put("settle", settle.kind());
        detail.put("method", settle.method() == null ? null : settle.method().name());
        detail.put("refund_id", refund == null ? null : refund.getId());
        detail.put("session_id", session.getId());
        detail.put("approved_by", approver);
        auditService.record(instituteId, actor, locationId, "POS_RETURN", "RETURN", made.returnId(), null,
                CommerceInputRules.json(detail), clean.create().getReasonNote());
        log.info("POS return {} of order {} at session {}: credit {}, {}", made.returnNumber(), order.getOrderNumber(),
                session.getId(), credit, settle.kind());
        return made.returnId();
    }

    static String refundKey(String returnId) {
        return "POSRET:" + returnId;
    }

    /** The answer of a return: its credit note, and the refund or the credit kept for a new bill. */
    PosDtos.ReturnAnswer answer(String instituteId, String returnId, boolean replayed) {
        return readOnly.execute(tx -> {
            CommerceReturn ret = returnRepository.findByIdAndInstituteId(returnId, instituteId).orElseThrow();
            if (entityManager != null) {
                entityManager.refresh(ret);
            }
            String noteNumber = ret.getCreditNoteId() == null ? null : creditNoteRepository
                    .findById(ret.getCreditNoteId()).map(CommerceCreditNote::getCreditNoteNumber).orElse(null);
            CommerceRefund refund = refundRepository.findByInstituteIdAndIdempotencyKey(instituteId,
                    refundKey(ret.getId())).orElse(null);
            PosDtos.RefundRef refundRef = refund == null ? null : new PosDtos.RefundRef(refund.getId(),
                    refund.getMethod(), refund.getAmount(), refund.getStatus());
            BigDecimal exchangeCredit = refund == null && ReturnStatus.RECEIVED.name().equals(ret.getStatus())
                    ? ret.getCreditTotal() : null;
            return new PosDtos.ReturnAnswer(ret.getId(), ret.getReturnNumber(), ret.getCreditNoteId(), noteNumber,
                    ret.getCreditTotal(), refundRef, exchangeCredit, replayed);
        });
    }

    /** A fresh copy of a create body (the return service sets fields on the one it is given). */
    static ReturnDtos.CreateReturnRequest copy(ReturnDtos.CreateReturnRequest c) {
        return ReturnDtos.CreateReturnRequest.builder()
                .clientRequestId(c.getClientRequestId())
                .orderId(c.getOrderId())
                .locationId(c.getLocationId())
                .reason(c.getReason())
                .reasonNote(c.getReasonNote())
                .requestedVia(c.getRequestedVia())
                .lines(c.getLines() == null ? null : new ArrayList<>(c.getLines()))
                .photoMediaIds(c.getPhotoMediaIds())
                .overrideReason(c.getOverrideReason())
                .approveNow(c.getApproveNow())
                .note(c.getNote())
                .build();
    }

    private static String required(String raw, String field) {
        String value = PosSaleService.text(raw, field, 36);
        if (value == null) {
            throw validation(field + " is required");
        }
        return value;
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
