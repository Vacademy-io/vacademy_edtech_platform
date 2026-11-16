package vacademy.io.admin_core_service.features.commerce.order.cod;

import vacademy.io.admin_core_service.features.commerce.returns.service.CommerceReturnDueService;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.common.request.CommerceRequestGuard;
import vacademy.io.admin_core_service.features.commerce.document.service.DocumentClock;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceOrderWriter;
import vacademy.io.admin_core_service.features.commerce.order.cod.dto.CodRemittanceDtos;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceOrderDeskService;
import vacademy.io.admin_core_service.features.commerce.order.dto.CartPriceRequest;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrder;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderLine;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderTender;
import vacademy.io.admin_core_service.features.commerce.order.enums.CommerceOrderStatus;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderTenderRepository;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockPeriodGuard;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceInputRules;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentLogService;
import vacademy.io.admin_core_service.features.user_subscription.service.UserPlanService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;

/**
 * {@code POST /cod/remittances} (WP-31): a courier paid over the cash of delivered COD orders.
 * Store manager or accountant.
 *
 * <ol>
 *   <li>Validate: {@code net = gross − deductions}, {@code received_on} not after today, the
 *       order ids distinct (1 to 500).</li>
 *   <li>Replay: the remittance row is its own guard. The same {@code client_request_id} with
 *       the same body answers the remittance it made, another body is 409
 *       {@code IDEMPOTENCY_MISMATCH}; the same {@code reference} with another body is 409
 *       {@code REMITTANCE_REFERENCE_REUSED}.</li>
 *   <li>Each order's location is checked against the caller's; the period lock (when there is
 *       one) against {@code received_on}.</li>
 *   <li>One transaction: the orders locked in id order; each must be COD, DELIVERED, UNPAID and
 *       in no remittance (409 {@code REMITTANCE_ORDER_NOT_DUE} naming the order). A gross amount
 *       other than the sum of the orders' COD amounts needs a written reason (400
 *       {@code REMITTANCE_DIFFERENCE_REASON_REQUIRED}, nothing written).</li>
 *   <li>The remittance row; per order: the payment logs of the lines that still have units are
 *       claimed PAID ({@code PaymentLogService.markCommerceLogsPaid}) and their plans activated,
 *       a fully cancelled line's log stays unpaid; the COD tender turns RECEIVED with the
 *       remittance reference; the order is PAID for its {@code cod_amount} and names the
 *       remittance (a conditional UPDATE, so one order is in at most one remittance); a
 *       history note and an audit row; the books' hook after the commit.</li>
 * </ol>
 * The orders read PAID in full even when the courier short-paid: the gap is the written reason
 * (owner decision).
 */
@Slf4j
@Service
public class CommerceCodRemittanceService {

    public static final String REMITTANCE_ORDER_NOT_DUE = "REMITTANCE_ORDER_NOT_DUE";
    public static final String REMITTANCE_REFERENCE_REUSED = "REMITTANCE_REFERENCE_REUSED";
    public static final String REMITTANCE_DIFFERENCE_REASON_REQUIRED = "REMITTANCE_DIFFERENCE_REASON_REQUIRED";
    public static final String AUDIT_KIND = "COD_REMITTANCE_RECORDED";
    static final Set<CommerceRole> MONEY = Set.of(CommerceRole.STORE_MANAGER, CommerceRole.ACCOUNTANT);
    static final int MAX_ORDERS = 500;
    static final int MAX_PAGE_SIZE = 50;
    private static final ZoneId INDIA = ZoneId.of("Asia/Kolkata");
    private static final BigDecimal MAX_AMOUNT = new BigDecimal("9999999999.99");

    private final CommerceCodRemittanceRepository remittanceRepository;
    private final CommerceOrderTenderRepository tenderRepository;
    private final CommerceOrderDeskService desk;
    private final PaymentLogService paymentLogService;
    private final UserPlanService userPlanService;
    private final CommerceOrderWriter writer;
    private final CommerceAuditService auditService;
    private final CommerceAccessGuard accessGuard;
    private final DocumentClock clock;
    private final ObjectProvider<StockPeriodGuard> periodGuard;
    private final TransactionTemplate transaction;

    @PersistenceContext
    private EntityManager entityManager;

    /** Returns (WP-32); set by Spring, absent in tests built by hand. */
    private ObjectProvider<CommerceReturnDueService> returnDueService;

    @org.springframework.beans.factory.annotation.Autowired(required = false)
    public void setReturnDueService(ObjectProvider<CommerceReturnDueService> returnDueService) {
        this.returnDueService = returnDueService;
    }

    public CommerceCodRemittanceService(CommerceCodRemittanceRepository remittanceRepository,
                                        CommerceOrderTenderRepository tenderRepository,
                                        CommerceOrderDeskService desk,
                                        PaymentLogService paymentLogService,
                                        UserPlanService userPlanService,
                                        CommerceOrderWriter writer,
                                        CommerceAuditService auditService,
                                        CommerceAccessGuard accessGuard,
                                        DocumentClock clock,
                                        ObjectProvider<StockPeriodGuard> periodGuard,
                                        PlatformTransactionManager transactionManager) {
        this.remittanceRepository = remittanceRepository;
        this.tenderRepository = tenderRepository;
        this.desk = desk;
        this.paymentLogService = paymentLogService;
        this.userPlanService = userPlanService;
        this.writer = writer;
        this.auditService = auditService;
        this.accessGuard = accessGuard;
        this.clock = clock;
        this.periodGuard = periodGuard;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    /** The answer of a record call, and whether it made the remittance (201) or repeated it (200). */
    public record Recorded(CodRemittanceDtos.RemittanceView view, boolean created) {
    }

    /** The request after validation. */
    record Clean(String clientRequestId, String reference, String courierName, LocalDate receivedOn,
                 BigDecimal gross, BigDecimal deductions, BigDecimal net, String differenceReason, String note,
                 List<String> orderIds, String hash) {
    }

    // ------------------------------------------------------------------ record

    public Recorded record(CustomUserDetails user, String instituteId, CodRemittanceDtos.RemittanceRequest request) {
        accessGuard.require(user, instituteId, CommerceFeature.ORDERS, MONEY);
        Clean clean = validate(request, clock.today(instituteId));

        Recorded earlier = replayIfKnown(instituteId, clean, user);
        if (earlier != null) {
            return earlier;
        }

        // Who may settle each order: the caller's location against each order's. A missing order
        // is 404 before anything is locked.
        Set<String> found = new LinkedHashSet<>(transaction.execute(status ->
                remittanceRepository.findOrderIdsOfInstitute(instituteId, clean.orderIds())));
        for (String orderId : clean.orderIds()) {
            if (!found.contains(orderId)) {
                throw new VacademyException(HttpStatus.NOT_FOUND, "ORDER_NOT_FOUND: no such order " + orderId);
            }
            CommerceOrder seen = desk.readOrder(instituteId, orderId);
            desk.authorize(user, instituteId, seen.getFulfilmentLocationId(), MONEY);
        }
        periodGuard.ifAvailable(guard -> guard.assertOpen(instituteId, clean.receivedOn()));

        String actor = user.getUserId();
        String remittanceId;
        try {
            remittanceId = transaction.execute(status -> recordInside(instituteId, clean, actor));
        } catch (DataIntegrityViolationException | ConflictException e) {
            // A request with the same key or reference may have won meanwhile (it locked the
            // orders first): its remittance is the answer, not this refusal.
            Recorded winner = replayIfKnown(instituteId, clean, user);
            if (winner != null) {
                return winner;
            }
            throw e;
        }
        log.info("Commerce COD remittance {} ({}) recorded for institute {}: {} order(s), gross {}", clean.reference(),
                remittanceId, instituteId, clean.orderIds().size(), clean.gross());
        return new Recorded(view(instituteId, remittanceId, true, false), true);
    }

    /** Step 4 and 5, in the caller's transaction. Returns the new remittance's id. */
    String recordInside(String instituteId, Clean clean, String actor) {
        // Orders first, in id order (the lock order of the desk), each read again under its lock.
        List<CommerceOrder> orders = new ArrayList<>();
        BigDecimal ordersTotal = BigDecimal.ZERO.setScale(2);
        for (String orderId : new TreeSet<>(clean.orderIds())) {
            CommerceOrder order = desk.lockOrder(instituteId, orderId);
            requireDue(order);
            ordersTotal = ordersTotal.add(order.getCodAmount());
            orders.add(order);
        }
        if (clean.gross().compareTo(ordersTotal) != 0 && clean.differenceReason() == null) {
            throw new InvalidRequestException(REMITTANCE_DIFFERENCE_REASON_REQUIRED + ": the orders add up to "
                    + ordersTotal.toPlainString() + ", not " + clean.gross().toPlainString()
                    + "; give difference_reason");
        }

        CommerceCodRemittance remittance = new CommerceCodRemittance();
        remittance.setId(UUID.randomUUID().toString());
        remittance.setInstituteId(instituteId);
        remittance.setReference(clean.reference());
        remittance.setCourierName(clean.courierName());
        remittance.setReceivedOn(clean.receivedOn());
        remittance.setGrossAmount(clean.gross());
        remittance.setDeductions(clean.deductions());
        remittance.setNetAmount(clean.net());
        remittance.setOrdersTotal(ordersTotal);
        remittance.setOrderCount(orders.size());
        remittance.setDifferenceReason(clean.differenceReason());
        remittance.setNote(clean.note());
        remittance.setRecordedBy(actor);
        remittance.setClientRequestId(clean.clientRequestId());
        remittance.setRequestHash(clean.hash());
        // Flushed now: a second remittance with this key or reference fails on its unique key here.
        remittance = remittanceRepository.saveAndFlush(remittance);
        String remittanceId = remittance.getId();

        Date receivedAt = Date.from(clean.receivedOn().atStartOfDay(INDIA).toInstant());
        Date now = new Date();
        List<Map<String, Object>> settled = new ArrayList<>();
        for (CommerceOrder order : orders) {
            settleLogs(order, desk.freshLines(order.getId()));
            receiveCodTender(order, clean.reference(), receivedAt);
            if (remittanceRepository.markRemitted(instituteId, order.getId(), remittanceId, now) != 1) {
                throw new ConflictException(REMITTANCE_ORDER_NOT_DUE + ": order " + order.getOrderNumber()
                        + " is not waiting for COD money");
            }
            if (entityManager != null) {
                entityManager.refresh(order);
            }
            CommerceReturnDueService dues = returnDueService == null ? null : returnDueService.getIfAvailable();
            if (dues != null) {
                // A return received before the money came in: what it is worth is due back now.
                dues.raiseDeferred(order);
            }
            writer.history(order, CommerceOrderStatus.DELIVERED, CommerceOrderStatus.DELIVERED, actor,
                    "Cash on delivery received: remittance " + clean.reference());
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("order_id", order.getId());
            row.put("order_number", order.getOrderNumber());
            row.put("cod_amount", order.getCodAmount().toPlainString());
            settled.add(row);
        }

        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("reference", clean.reference());
        detail.put("received_on", clean.receivedOn().toString());
        detail.put("gross_amount", clean.gross().toPlainString());
        detail.put("deductions", clean.deductions().toPlainString());
        detail.put("net_amount", clean.net().toPlainString());
        detail.put("orders_total", ordersTotal.toPlainString());
        detail.put("difference_reason", clean.differenceReason());
        detail.put("orders", settled);
        auditService.record(instituteId, actor, null, AUDIT_KIND, "COD_REMITTANCE", remittanceId, null,
                CommerceInputRules.json(detail), clean.note());
        BigDecimal net = clean.net();
        desk.afterCommitMoney(hook -> hook.codRemitted(instituteId, remittanceId, net));
        return remittanceId;
    }

    /** 409 REMITTANCE_ORDER_NOT_DUE unless the order is a delivered, unpaid COD order in no remittance. */
    static void requireDue(CommerceOrder order) {
        boolean due = CartPriceRequest.COD.equals(order.getPaymentMethod())
                && CommerceOrderStatus.DELIVERED.name().equals(order.getStatus())
                && CommerceOrderWriter.PAYMENT_UNPAID.equals(order.getPaymentStatus())
                && !StringUtils.hasText(order.getCodRemittanceId())
                && order.getCodAmount() != null;
        if (!due) {
            throw new ConflictException(REMITTANCE_ORDER_NOT_DUE + ": order " + order.getOrderNumber()
                    + " is not a delivered cash-on-delivery order waiting for its money");
        }
    }

    /**
     * Exactly the payment logs of the lines that still have units are claimed PAID (in id order,
     * {@code PaymentLogService.markCommerceLogsPaid}) and their plans activated; a fully
     * cancelled line's log (amount 0) stays PAYMENT_PENDING and its plan stays cancelled. A log
     * that could not be claimed means the money rows changed: the whole remittance stops.
     */
    void settleLogs(CommerceOrder order, List<CommerceOrderLine> lines) {
        Map<String, String> planOfLog = new LinkedHashMap<>();
        for (CommerceOrderLine line : CommerceOrderDeskService.items(lines)) {
            if (line.liveQuantity() > 0 && StringUtils.hasText(line.getPaymentLogId())) {
                planOfLog.put(line.getPaymentLogId(), line.getUserPlanId());
            }
        }
        if (planOfLog.isEmpty()) {
            throw new ConflictException(REMITTANCE_ORDER_NOT_DUE + ": order " + order.getOrderNumber()
                    + " has no line left to pay for");
        }
        List<String> claimed = paymentLogService.markCommerceLogsPaid(planOfLog.keySet());
        if (claimed.size() != planOfLog.size()) {
            throw new ConflictException(CommerceOrderDeskService.ORDER_STATE_CHANGED + ": the payment of order "
                    + order.getOrderNumber() + " changed meanwhile");
        }
        for (String logId : claimed) {
            String planId = planOfLog.get(logId);
            if (StringUtils.hasText(planId)) {
                // An already SOLD or RESTORED (shipped) hold is left as it is.
                userPlanService.activateCommercePlan(userPlanService.findById(planId));
            }
        }
    }

    /** The order's one PENDING COD tender turns RECEIVED with the courier's reference. */
    private void receiveCodTender(CommerceOrder order, String reference, Date receivedAt) {
        CommerceOrderTender pending = null;
        for (CommerceOrderTender tender : tenderRepository.findByOrderIdOrderByCreatedAtAsc(order.getId())) {
            if (CommerceOrderTender.STATUS_PENDING.equals(tender.getStatus())) {
                if (pending != null || !CommerceOrderTender.MODE_COD.equals(tender.getMode())) {
                    throw new ConflictException(CommerceOrderDeskService.ORDER_STATE_CHANGED + ": the money of order "
                            + order.getOrderNumber() + " is not one pending COD amount");
                }
                pending = tender;
            }
        }
        if (pending == null || pending.getAmount().compareTo(order.getCodAmount()) != 0
                || tenderRepository.settleOne(pending.getId(), CommerceOrderTender.STATUS_RECEIVED, receivedAt,
                reference) != 1) {
            throw new ConflictException(CommerceOrderDeskService.ORDER_STATE_CHANGED + ": the COD amount of order "
                    + order.getOrderNumber() + " changed meanwhile");
        }
    }

    /**
     * The remittance an earlier request with this key or reference made: the answer when the
     * body is the same; 409 when it is not. Null when there is none.
     */
    private Recorded replayIfKnown(String instituteId, Clean clean, CustomUserDetails user) {
        CommerceCodRemittance byKey = transaction.execute(status -> remittanceRepository
                .findByInstituteIdAndClientRequestId(instituteId, clean.clientRequestId()).orElse(null));
        if (byKey != null) {
            if (!clean.hash().equals(byKey.getRequestHash())) {
                throw new ConflictException(CommerceRequestGuard.IDEMPOTENCY_MISMATCH
                        + ": client_request_id was already used for another request");
            }
            return new Recorded(view(instituteId, byKey.getId(), true, true), false);
        }
        CommerceCodRemittance byReference = transaction.execute(status -> remittanceRepository
                .findByInstituteIdAndReference(instituteId, clean.reference()).orElse(null));
        if (byReference != null) {
            if (!clean.hash().equals(byReference.getRequestHash())) {
                throw new ConflictException(REMITTANCE_REFERENCE_REUSED + ": a remittance with reference "
                        + clean.reference() + " is already recorded");
            }
            return new Recorded(view(instituteId, byReference.getId(), true, true), false);
        }
        return null;
    }

    // ------------------------------------------------------------------ read

    public CodRemittanceDtos.RemittanceView get(CustomUserDetails user, String instituteId, String remittanceId) {
        accessGuard.require(user, instituteId, CommerceFeature.ORDERS, MONEY);
        return view(instituteId, remittanceId, true, false);
    }

    public CodRemittanceDtos.RemittancePage list(CustomUserDetails user, String instituteId, LocalDate from,
                                                 LocalDate to, Integer page, Integer pageSize) {
        accessGuard.require(user, instituteId, CommerceFeature.ORDERS, MONEY);
        int p = page == null ? 0 : page;
        int size = pageSize == null ? 20 : pageSize;
        if (p < 0 || size < 1 || size > MAX_PAGE_SIZE) {
            throw validation("page is 0 or more and pageSize 1 to " + MAX_PAGE_SIZE);
        }
        if (from != null && to != null && from.isAfter(to)) {
            throw validation("from is not after to");
        }
        Page<CommerceCodRemittance> rows = transaction.execute(status ->
                remittanceRepository.search(instituteId, from, to, PageRequest.of(p, size)));
        List<CodRemittanceDtos.RemittanceView> items = new ArrayList<>();
        for (CommerceCodRemittance row : rows.getContent()) {
            items.add(base(row));
        }
        return CodRemittanceDtos.RemittancePage.builder().items(items).page(p).pageSize(size)
                .total(rows.getTotalElements()).build();
    }

    CodRemittanceDtos.RemittanceView view(String instituteId, String remittanceId, boolean withOrders,
                                          boolean replayed) {
        CodRemittanceDtos.RemittanceView view = transaction.execute(status -> {
            CommerceCodRemittance row = remittanceId == null ? null
                    : remittanceRepository.findByIdAndInstituteId(remittanceId, instituteId).orElse(null);
            if (row == null) {
                return null;
            }
            CodRemittanceDtos.RemittanceView v = base(row);
            if (withOrders) {
                List<CodRemittanceDtos.RemittedOrder> orders = new ArrayList<>();
                for (CommerceCodRemittanceRepository.RemittedOrder o : remittanceRepository.findOrders(instituteId,
                        row.getId())) {
                    orders.add(CodRemittanceDtos.RemittedOrder.builder().orderId(o.getOrderId())
                            .orderNumber(o.getOrderNumber()).codAmount(o.getCodAmount()).build());
                }
                v.setOrders(orders);
            }
            return v;
        });
        if (view == null) {
            throw new VacademyException(HttpStatus.NOT_FOUND, "REMITTANCE_NOT_FOUND: no such remittance");
        }
        view.setReplayed(replayed ? Boolean.TRUE : null);
        return view;
    }

    private static CodRemittanceDtos.RemittanceView base(CommerceCodRemittance row) {
        return CodRemittanceDtos.RemittanceView.builder()
                .id(row.getId()).reference(row.getReference()).courierName(row.getCourierName())
                .receivedOn(row.getReceivedOn()).grossAmount(row.getGrossAmount()).deductions(row.getDeductions())
                .netAmount(row.getNetAmount()).ordersTotal(row.getOrdersTotal()).orderCount(row.getOrderCount())
                .differenceReason(row.getDifferenceReason()).note(row.getNote()).recordedBy(row.getRecordedBy())
                .createdAt(row.getCreatedAt() == null ? null : row.getCreatedAt().toInstant().toString())
                .build();
    }

    // ------------------------------------------------------------------ validation

    static Clean validate(CodRemittanceDtos.RemittanceRequest request, LocalDate today) {
        if (request == null) {
            throw validation("the request has no body");
        }
        String key = CommerceRequestGuard.requireClientKey(request.getClientRequestId());
        String reference = text(request.getReference(), "reference", 100);
        if (reference == null) {
            throw validation("reference is required: the courier's statement or transfer reference");
        }
        String courier = text(request.getCourierName(), "courier_name", 100);
        LocalDate receivedOn = request.getReceivedOn();
        if (receivedOn == null) {
            throw validation("received_on is required");
        }
        if (today != null && receivedOn.isAfter(today)) {
            throw validation("received_on cannot be after today");
        }
        BigDecimal gross = amount(request.getGrossAmount(), "gross_amount", true);
        BigDecimal deductions = request.getDeductions() == null ? BigDecimal.ZERO.setScale(2)
                : amount(request.getDeductions(), "deductions", false);
        BigDecimal net = amount(request.getNetAmount(), "net_amount", true);
        if (net.compareTo(gross.subtract(deductions)) != 0) {
            throw validation("net_amount must be gross_amount minus deductions");
        }
        String reason = text(request.getDifferenceReason(), "difference_reason", 500);
        String note = text(request.getNote(), "note", 500);
        List<String> ids = request.getOrderIds();
        if (ids == null || ids.isEmpty() || ids.size() > MAX_ORDERS) {
            throw validation("order_ids holds 1 to " + MAX_ORDERS + " orders");
        }
        Set<String> distinct = new LinkedHashSet<>();
        for (String id : ids) {
            String v = id == null ? null : id.trim();
            if (v == null || v.isEmpty() || v.length() > 36 || !distinct.add(v)) {
                throw validation("order_ids holds distinct order ids");
            }
        }
        List<String> orderIds = new ArrayList<>(distinct);
        // The hash of the request: the ids in a fixed order, amounts without trailing zeros.
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("reference", reference);
        body.put("courier_name", courier);
        body.put("received_on", receivedOn.toString());
        body.put("gross_amount", gross);
        body.put("deductions", deductions);
        body.put("net_amount", net);
        body.put("difference_reason", reason);
        body.put("note", note);
        body.put("order_ids", new ArrayList<>(new TreeSet<>(orderIds)));
        String hash = CommerceRequestGuard.hash("COD_REMITTANCE", body);
        return new Clean(key, reference, courier, receivedOn, gross, deductions, net, reason, note, orderIds, hash);
    }

    private static BigDecimal amount(BigDecimal raw, String field, boolean required) {
        if (raw == null) {
            if (required) {
                throw validation(field + " is required");
            }
            return BigDecimal.ZERO.setScale(2);
        }
        if (raw.signum() < 0 || raw.stripTrailingZeros().scale() > 2 || raw.compareTo(MAX_AMOUNT) > 0) {
            throw validation(field + " is an amount of 0 or more with at most two decimals");
        }
        return raw.setScale(2, RoundingMode.UNNECESSARY);
    }

    private static String text(String raw, String field, int max) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        String value = raw.trim();
        if (value.length() > max) {
            throw validation(field + " is at most " + max + " characters");
        }
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (c < 0x20 && c != '\n' && c != '\t') {
                throw validation(field + " contains a control character");
            }
        }
        return value;
    }

    private static InvalidRequestException validation(String message) {
        return new InvalidRequestException("VALIDATION: " + message);
    }
}
