package vacademy.io.admin_core_service.features.commerce.returns.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.common.request.CommerceRequestGuard;
import vacademy.io.admin_core_service.features.commerce.document.dto.CreditNoteDTO;
import vacademy.io.admin_core_service.features.commerce.document.dto.CreditNoteLineDTO;
import vacademy.io.admin_core_service.features.commerce.document.dto.CreditNoteLineRequest;
import vacademy.io.admin_core_service.features.commerce.document.dto.CreditNoteRequest;
import vacademy.io.admin_core_service.features.commerce.document.entity.CommerceCreditNote;
import vacademy.io.admin_core_service.features.commerce.document.repository.CommerceCreditNoteRepository;
import vacademy.io.admin_core_service.features.commerce.document.service.CommerceCreditNoteService;
import vacademy.io.admin_core_service.features.commerce.document.service.DocumentClock;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceLineCancelService;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceOrderDeskService;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceOrderEvents;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceOrderRemainder;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrder;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderLine;
import vacademy.io.admin_core_service.features.commerce.order.enums.CommerceOrderStatus;
import vacademy.io.admin_core_service.features.commerce.order.enums.ReturnCondition;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderLineRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderRepository;
import vacademy.io.admin_core_service.features.commerce.returns.dto.ReturnDtos;
import vacademy.io.admin_core_service.features.commerce.returns.entity.CommerceRefund;
import vacademy.io.admin_core_service.features.commerce.returns.entity.CommerceReturn;
import vacademy.io.admin_core_service.features.commerce.returns.entity.CommerceReturnLine;
import vacademy.io.admin_core_service.features.commerce.returns.enums.RefundStatus;
import vacademy.io.admin_core_service.features.commerce.returns.enums.RequestedVia;
import vacademy.io.admin_core_service.features.commerce.returns.enums.ReturnReason;
import vacademy.io.admin_core_service.features.commerce.returns.enums.ReturnStatus;
import vacademy.io.admin_core_service.features.commerce.returns.policy.CommerceReturnPolicy;
import vacademy.io.admin_core_service.features.commerce.returns.policy.CommerceReturnSettings;
import vacademy.io.admin_core_service.features.commerce.returns.repository.CommerceRefundRepository;
import vacademy.io.admin_core_service.features.commerce.returns.repository.CommerceReturnLineRepository;
import vacademy.io.admin_core_service.features.commerce.returns.repository.CommerceReturnRepository;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.admin_core_service.features.commerce.shipment.entity.CommerceShipment;
import vacademy.io.admin_core_service.features.commerce.shipment.entity.CommerceShipmentLine;
import vacademy.io.admin_core_service.features.commerce.shipment.repository.CommerceShipmentLineRepository;
import vacademy.io.admin_core_service.features.commerce.shipment.repository.CommerceShipmentRepository;
import vacademy.io.admin_core_service.features.commerce.shipment.service.CommerceShipmentService;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockLocation;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockMovement;
import vacademy.io.admin_core_service.features.commerce.catalogue.enums.StockMode;
import vacademy.io.admin_core_service.features.commerce.stock.enums.StockMovementType;
import vacademy.io.admin_core_service.features.commerce.catalogue.enums.StockPolicy;
import vacademy.io.admin_core_service.features.commerce.stock.repository.CommercePieceRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLocationRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockVariantRepository;
import vacademy.io.admin_core_service.features.commerce.stock.service.CommerceCounterService;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockLedgerService;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockPosting;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxLineResult;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxResult;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxHead;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceInputRules;
import vacademy.io.admin_core_service.features.invoice.entity.Invoice;
import vacademy.io.admin_core_service.features.invoice.entity.InvoiceLineItem;
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
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Returns of delivered goods (WP-32), created by staff (the buyer asks by phone or WhatsApp).
 *
 * <p>REQUESTED, then APPROVED or REJECTED; APPROVED, then RECEIVED (or REJECTED); RECEIVED, then
 * CLOSED when its money went back. A return never changes the order's status. Receiving it, in
 * one transaction under the order lock: the stock comes back at the return's location (RETURN, and
 * DAMAGE for what came back damaged), the order's invoice gets a credit note for the units, the
 * credit is raised into the order's refund due (for a COD order not yet remitted, when the
 * remittance is recorded) and the lines count the returned units.
 *
 * <p>Every change runs through {@link CommerceRequestGuard} and compares the status the client
 * saw ({@code from_status}) under the lock (409 RETURN_STATE_CHANGED).
 */
@Slf4j
@Service
public class CommerceReturnService {

    public static final String RETURN_STATE_CHANGED = "RETURN_STATE_CHANGED";
    public static final String RETURN_POLICY_WARNING = "RETURN_POLICY_WARNING";
    public static final String REFERENCE_RETURN_LINE = "RETURN_LINE";
    public static final String REASON_RETURN_DAMAGED = "RETURN_DAMAGED";
    public static final String COUNTER_SCOPE = "RET";
    static final String POS_CHANNEL = "POS";
    static final Set<CommerceRole> MANAGER = Set.of(CommerceRole.STORE_MANAGER);
    static final Set<CommerceRole> FLOOR = Set.of(CommerceRole.STORE_MANAGER, CommerceRole.WAREHOUSE_STAFF);
    static final Set<CommerceRole> READERS = Set.of(CommerceRole.STORE_MANAGER, CommerceRole.WAREHOUSE_STAFF,
            CommerceRole.ACCOUNTANT);
    static final int MAX_LINES = 50;
    static final int MAX_PHOTOS = 5;
    private static final Pattern MEDIA_ID = Pattern.compile("^[A-Za-z0-9_-]{1,36}$");
    private static final ZoneId INDIA = CommerceReturnPolicy.INDIA;

    private final CommerceOrderDeskService desk;
    private final CommerceRefundService refundService;
    private final CommerceReturnDueService dueService;
    private final CommerceReturnRepository returnRepository;
    private final CommerceReturnLineRepository returnLineRepository;
    private final CommerceRefundRepository refundRepository;
    private final CommerceOrderRepository orderRepository;
    private final CommerceOrderLineRepository orderLineRepository;
    private final StockLocationRepository locationRepository;
    private final CommerceShipmentRepository shipmentRepository;
    private final CommerceShipmentLineRepository shipmentLineRepository;
    private final CommercePieceRepository pieceRepository;
    private final StockVariantRepository variantRepository;
    private final StockLedgerService ledger;
    private final CommerceCreditNoteService creditNoteService;
    private final CommerceCreditNoteRepository creditNoteRepository;
    private final CommerceCounterService counterService;
    private final CommerceReturnSettings returnSettings;
    private final CommerceRequestGuard requestGuard;
    private final CommerceAccessGuard accessGuard;
    private final CommerceAuditService auditService;
    private final CommerceOrderEvents events;
    private final ObjectProvider<CommerceShipmentService> shipmentService;
    private final DocumentClock clock;
    private final ObjectMapper objectMapper;
    private final TransactionTemplate ownTransaction;

    public CommerceReturnService(CommerceOrderDeskService desk, CommerceRefundService refundService,
                                 CommerceReturnDueService dueService, CommerceReturnRepository returnRepository,
                                 CommerceReturnLineRepository returnLineRepository,
                                 CommerceRefundRepository refundRepository, CommerceOrderRepository orderRepository,
                                 CommerceOrderLineRepository orderLineRepository,
                                 StockLocationRepository locationRepository,
                                 CommerceShipmentRepository shipmentRepository,
                                 CommerceShipmentLineRepository shipmentLineRepository,
                                 CommercePieceRepository pieceRepository, StockVariantRepository variantRepository,
                                 StockLedgerService ledger, CommerceCreditNoteService creditNoteService,
                                 CommerceCreditNoteRepository creditNoteRepository,
                                 CommerceCounterService counterService, CommerceReturnSettings returnSettings,
                                 CommerceRequestGuard requestGuard, CommerceAccessGuard accessGuard,
                                 CommerceAuditService auditService, CommerceOrderEvents events,
                                 ObjectProvider<CommerceShipmentService> shipmentService, DocumentClock clock,
                                 ObjectMapper objectMapper, PlatformTransactionManager transactionManager) {
        this.desk = desk;
        this.refundService = refundService;
        this.dueService = dueService;
        this.returnRepository = returnRepository;
        this.returnLineRepository = returnLineRepository;
        this.refundRepository = refundRepository;
        this.orderRepository = orderRepository;
        this.orderLineRepository = orderLineRepository;
        this.locationRepository = locationRepository;
        this.shipmentRepository = shipmentRepository;
        this.shipmentLineRepository = shipmentLineRepository;
        this.pieceRepository = pieceRepository;
        this.variantRepository = variantRepository;
        this.ledger = ledger;
        this.creditNoteService = creditNoteService;
        this.creditNoteRepository = creditNoteRepository;
        this.counterService = counterService;
        this.returnSettings = returnSettings;
        this.requestGuard = requestGuard;
        this.accessGuard = accessGuard;
        this.auditService = auditService;
        this.events = events;
        this.shipmentService = shipmentService;
        this.clock = clock;
        this.objectMapper = objectMapper;
        this.ownTransaction = new TransactionTemplate(transactionManager);
        this.ownTransaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    /** A validated create (or preview) body. */
    record Clean(String clientRequestId, String orderId, String locationId, ReturnReason reason, String reasonNote,
                 RequestedVia requestedVia, Map<String, Integer> lines, List<String> photoMediaIds,
                 String overrideReason, boolean approveNow, String note) {
    }

    /** The policy facts of a return of an order. */
    record Assessment(CommerceReturnPolicy.Settings settings, LocalDate deliveredOn, LocalDate today,
                      Integer collectionWindow, List<String> warnings) {
    }

    // ================================================================== routes

    /** {@code POST /returns/preview}: the policy and its warnings for a body; nothing is written. */
    public ReturnDtos.ReturnPreview preview(CustomUserDetails user, String instituteId,
                                            ReturnDtos.CreateReturnRequest request) {
        Clean clean = validate(request, false);
        CommerceOrder seen = desk.readOrder(instituteId, clean.orderId());
        desk.authorize(user, instituteId, clean.locationId() != null ? clean.locationId()
                : seen.getFulfilmentLocationId(), MANAGER);
        return previewOf(instituteId, clean);
    }

    /**
     * The preview of a return at the billing counter (WP-42): the same answer as
     * {@link #preview}, without its access check. The caller has checked who may ask (the
     * counter's session guard); only the POS package calls this.
     */
    public ReturnDtos.ReturnPreview previewForCounter(String instituteId, ReturnDtos.CreateReturnRequest request) {
        return previewOf(instituteId, validate(request, false));
    }

    private ReturnDtos.ReturnPreview previewOf(String instituteId, Clean clean) {
        return ownTransaction.execute(status -> {
            CommerceOrder order = orderRepository.findByIdAndInstituteId(clean.orderId(), instituteId)
                    .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "ORDER_NOT_FOUND: no such order"));
            requireReturnable(order);
            List<CommerceOrderLine> lines = orderLineRepository.findByOrderIdOrderByLineNoAsc(order.getId());
            Assessment a = assess(order, lines, clean);
            List<ReturnDtos.ReturnableLine> returnable = new ArrayList<>();
            for (CommerceOrderLine line : CommerceOrderDeskService.items(lines)) {
                returnable.add(ReturnDtos.ReturnableLine.builder().orderLineId(line.getId())
                        .returnableQuantity(returnable(line)).build());
            }
            BigDecimal estimate = BigDecimal.ZERO.setScale(2);
            TaxResult placement = desk.placementTax(order);
            TaxHead head = placement.getTaxHead() == null ? TaxHead.NONE : placement.getTaxHead();
            for (Map.Entry<String, Integer> asked : clean.lines().entrySet()) {
                CommerceOrderLine line = CommerceOrderDeskService.byId(lines, asked.getKey());
                if (line == null || !CommerceOrderLine.TYPE_ITEM.equals(line.getLineType())) {
                    throw validation("order_line_id " + asked.getKey() + " is not an item line of this order");
                }
                int before = nz(line.getQtyCancelled()) + nz(line.getQtyReturned());
                int quantity = Math.min(asked.getValue(), Math.max(0, line.getQuantity() - before));
                if (quantity > 0) {
                    estimate = estimate.add(CommerceOrderRemainder.cancelValue(CommerceOrderRemainder.taxLinesOf(
                            placement, line.getLineRef()), line.getQuantity(), before, quantity, head).net());
                }
            }
            CommerceReturnPolicy.Settings s = a.settings();
            return ReturnDtos.ReturnPreview.builder()
                    .policy(ReturnDtos.Policy.builder()
                            .windowDays(CommerceReturnPolicy.windowDays(s, a.collectionWindow()))
                            .deliveredOn(a.deliveredOn() == null ? null : a.deliveredOn().toString())
                            .daysSinceDelivery(a.deliveredOn() == null ? null
                                    : CommerceReturnPolicy.daysSince(a.deliveredOn(), a.today()))
                            .allowedReasons(s.allowedReasons()).photoRequired(s.photoRequired())
                            .returnShippingPaidBy(s.returnShippingPaidBy()).policyText(s.policyText()).build())
                    .warnings(a.warnings())
                    .lines(returnable)
                    .creditEstimate(estimate)
                    .build();
        });
    }

    /** {@code POST /returns} (R1): a return REQUESTED, or APPROVED at once with {@code approve_now}. */
    public ReturnDtos.ReturnView create(CustomUserDetails user, String instituteId,
                                        ReturnDtos.CreateReturnRequest request) {
        Clean clean = validate(request, true);
        CommerceOrder seen = desk.readOrder(instituteId, clean.orderId());
        String location = clean.locationId() != null ? clean.locationId() : seen.getFulfilmentLocationId();
        desk.authorize(user, instituteId, location, MANAGER);
        String hash = CommerceRequestGuard.hash("RETURN_CREATE", request);
        String actor = user.getUserId();
        CommerceReturn earlier = ownTransaction.execute(status -> returnRepository
                .findByInstituteIdAndClientRequestId(instituteId, clean.clientRequestId()).orElse(null));
        // Taken before the transaction (its own short one): gaps are allowed.
        String number = earlier != null ? earlier.getReturnNumber()
                : counterService.nextNumber(instituteId, COUNTER_SCOPE);
        CommerceRequestGuard.Outcome<String> outcome = requestGuard.run(new CommerceRequestGuard.Key(instituteId,
                        clean.clientRequestId(), "RETURN_CREATE", "ORDER", clean.orderId(), hash, actor),
                () -> createInside(instituteId, clean, location, number, hash, actor, true, null),
                () -> returnRepository.findByInstituteIdAndClientRequestId(instituteId, clean.clientRequestId())
                        .map(CommerceReturn::getId).orElse(null));
        return view(instituteId, outcome.value(), user, outcome.replayed());
    }

    /**
     * {@code notifyApproved}: false for a return taken at the billing counter, whose buyer is
     * standing there (no "return approved" message); the refund and credit-note messages stay.
     * {@code posSessionId}: the counter session of such a return, else null.
     */
    String createInside(String instituteId, Clean clean, String locationId, String number, String hash,
                        String actor, boolean notifyApproved, String posSessionId) {
        CommerceOrder order = desk.lockOrder(instituteId, clean.orderId());
        requireReturnable(order);
        List<CommerceOrderLine> lines = desk.freshLines(order.getId());
        for (Map.Entry<String, Integer> asked : clean.lines().entrySet()) {
            CommerceOrderLine line = CommerceOrderDeskService.byId(lines, asked.getKey());
            if (line == null || !CommerceOrderLine.TYPE_ITEM.equals(line.getLineType())) {
                throw validation("order_line_id " + asked.getKey() + " is not an item line of this order");
            }
            int left = returnable(line);
            if (asked.getValue() > left) {
                throw new ConflictException("RETURN_QTY_EXCEEDED: line " + line.getLineNo() + " has " + Math.max(0,
                        left) + " unit(s) that can still be returned");
            }
        }
        requireLocation(instituteId, locationId);
        Assessment a = assess(order, lines, clean);
        if (!a.warnings().isEmpty() && clean.overrideReason() == null) {
            throw new ConflictException(RETURN_POLICY_WARNING + ": " + String.join(", ", a.warnings())
                    + "; a manager may go ahead with override_reason");
        }
        CommerceReturn ret = new CommerceReturn();
        ret.setInstituteId(instituteId);
        ret.setReturnNumber(number);
        ret.setOrderId(order.getId());
        ret.setStatus(ReturnStatus.REQUESTED.name());
        ret.setReason(clean.reason().name());
        ret.setReasonNote(clean.reasonNote());
        ret.setRequestedVia(clean.requestedVia().name());
        ret.setLocationId(locationId);
        ret.setRequestedBy(actor);
        ret.setPolicyWarningsJson(a.warnings().isEmpty() ? null : json(a.warnings()));
        ret.setOverrideReason(a.warnings().isEmpty() ? null : clean.overrideReason());
        ret.setPhotoMediaIdsJson(clean.photoMediaIds().isEmpty() ? null : json(clean.photoMediaIds()));
        ret.setNote(clean.note());
        ret.setClientRequestId(clean.clientRequestId());
        ret.setRequestHash(hash);
        ret.setPosSessionId(posSessionId);
        ret = returnRepository.saveAndFlush(ret);
        for (Map.Entry<String, Integer> asked : clean.lines().entrySet()) {
            CommerceReturnLine line = new CommerceReturnLine();
            line.setInstituteId(instituteId);
            line.setReturnId(ret.getId());
            line.setOrderLineId(asked.getKey());
            line.setQuantity(asked.getValue());
            returnLineRepository.save(line);
        }
        returnLineRepository.flush();
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("return_number", number);
        detail.put("order_id", order.getId());
        detail.put("reason", clean.reason().name());
        detail.put("lines", clean.lines());
        auditService.record(instituteId, actor, locationId, "RETURN_CREATED", "RETURN", ret.getId(), null,
                CommerceInputRules.json(detail), clean.reasonNote());
        if (!a.warnings().isEmpty()) {
            auditService.record(instituteId, actor, locationId, "RETURN_POLICY_OVERRIDE", "RETURN", ret.getId(), null,
                    CommerceInputRules.json(Map.of("warnings", a.warnings())), clean.overrideReason());
        }
        if (clean.approveNow()) {
            approveInside(order, ret, actor, clean.note(), notifyApproved);
        }
        return ret.getId();
    }

    /** What a counter return made: the return, its credit note and the credit. */
    public record CounterReturn(String returnId, String returnNumber, String creditNoteId, String creditNoteNumber,
                                BigDecimal credit) {
    }

    /**
     * A return taken at the billing counter (WP-42), in the <b>caller's</b> transaction: created
     * {@code COUNTER} and approved at once, then received at {@code locationId} with the units
     * named by condition (and the pieces) in {@code received}: stock back, credit note, refund
     * due raised, {@code qty_returned}. No request guard and no access check of its own: the
     * POS route has both. {@code request} is a create body; its {@code requested_via} and
     * {@code approve_now} are set here.
     */
    public CounterReturn counterReturnInside(String instituteId, ReturnDtos.CreateReturnRequest request,
                                             String locationId, String number, String hash, String actor,
                                             List<ReturnDtos.ReceiveLine> received) {
        return counterReturnInside(instituteId, request, locationId, number, hash, actor, received, null);
    }

    /**
     * As {@link #counterReturnInside(String, ReturnDtos.CreateReturnRequest, String, String, String, String, List)},
     * stamping the return with the counter session it was taken in ({@code pos_session_id}): the
     * till lets that session's cashier spend its credit on a new bill without a PIN. No "return
     * approved" message is sent: the buyer is at the counter.
     */
    public CounterReturn counterReturnInside(String instituteId, ReturnDtos.CreateReturnRequest request,
                                             String locationId, String number, String hash, String actor,
                                             List<ReturnDtos.ReceiveLine> received, String posSessionId) {
        request.setRequestedVia(RequestedVia.COUNTER.name());
        request.setApproveNow(Boolean.TRUE);
        request.setLocationId(locationId);
        Clean clean = validate(request, true);
        Map<String, Named> named = named(received);
        String returnId = createInside(instituteId, clean, locationId, number, hash, actor, false, posSessionId);
        receiveInside(instituteId, returnId, clean.orderId(), ReturnStatus.APPROVED, null, named, actor,
                clean.note());
        CommerceReturn ret = returnRepository.findByIdAndInstituteId(returnId, instituteId).orElseThrow();
        String noteNumber = ret.getCreditNoteId() == null ? null : creditNoteRepository.findById(ret.getCreditNoteId())
                .map(CommerceCreditNote::getCreditNoteNumber).orElse(null);
        return new CounterReturn(ret.getId(), ret.getReturnNumber(), ret.getCreditNoteId(), noteNumber,
                ret.getCreditTotal());
    }

    /** {@code POST /returns/{id}/approve} (R2). */
    public ReturnDtos.ReturnView approve(CustomUserDetails user, String instituteId, String returnId,
                                         ReturnDtos.ApproveRequest request) {
        if (request == null) {
            throw validation("the request has no body");
        }
        String key = CommerceRequestGuard.requireClientKey(request.getClientRequestId());
        ReturnStatus from = status(request.getFromStatus());
        String note = text(request.getNote(), "note", 500);
        CommerceReturn seen = readReturn(user, instituteId, returnId, MANAGER);
        desk.authorize(user, instituteId, seen.getLocationId(), MANAGER);
        String actor = user.getUserId();
        CommerceRequestGuard.Outcome<String> outcome = requestGuard.run(new CommerceRequestGuard.Key(instituteId, key,
                        "RETURN_APPROVE", "RETURN", seen.getId(),
                        CommerceRequestGuard.hash("RETURN_APPROVE", request, seen.getId()), actor),
                () -> {
                    CommerceOrder order = desk.lockOrder(instituteId, seen.getOrderId());
                    CommerceReturn ret = refundService.lockReturn(instituteId, seen.getId());
                    requireFrom(ret, from, ReturnStatus.REQUESTED);
                    approveInside(order, ret, actor, note);
                    return ret.getId();
                }, seen::getId);
        return view(instituteId, outcome.value(), user, outcome.replayed());
    }

    private void approveInside(CommerceOrder order, CommerceReturn ret, String actor, String note) {
        approveInside(order, ret, actor, note, true);
    }

    private void approveInside(CommerceOrder order, CommerceReturn ret, String actor, String note, boolean notify) {
        ret.setStatus(ReturnStatus.APPROVED.name());
        ret.setApprovedAt(new Date());
        ret.setApprovedBy(actor);
        returnRepository.save(ret);
        auditService.record(ret.getInstituteId(), actor, ret.getLocationId(), "RETURN_APPROVED", "RETURN", ret.getId(),
                null, null, note);
        if (notify) {
            events.afterCommit(desk.event(CommerceOrderEvents.RETURN_APPROVED, order, ret.getId(), true));
        }
    }

    /** {@code POST /returns/{id}/reject} (R3): its units may be asked for again. */
    public ReturnDtos.ReturnView reject(CustomUserDetails user, String instituteId, String returnId,
                                        ReturnDtos.RejectRequest request) {
        if (request == null) {
            throw validation("the request has no body");
        }
        String key = CommerceRequestGuard.requireClientKey(request.getClientRequestId());
        ReturnStatus from = status(request.getFromStatus());
        String reason = text(request.getReason(), "reason", 500);
        if (reason == null) {
            throw validation("reason is required");
        }
        CommerceReturn seen = readReturn(user, instituteId, returnId, MANAGER);
        desk.authorize(user, instituteId, seen.getLocationId(), MANAGER);
        String actor = user.getUserId();
        CommerceRequestGuard.Outcome<String> outcome = requestGuard.run(new CommerceRequestGuard.Key(instituteId, key,
                        "RETURN_REJECT", "RETURN", seen.getId(),
                        CommerceRequestGuard.hash("RETURN_REJECT", request, seen.getId()), actor),
                () -> {
                    desk.lockOrder(instituteId, seen.getOrderId());
                    CommerceReturn ret = refundService.lockReturn(instituteId, seen.getId());
                    requireFrom(ret, from, ReturnStatus.REQUESTED, ReturnStatus.APPROVED);
                    ret.setStatus(ReturnStatus.REJECTED.name());
                    ret.setRejectedAt(new Date());
                    ret.setRejectedBy(actor);
                    ret.setRejectReason(reason);
                    returnRepository.save(ret);
                    auditService.record(instituteId, actor, ret.getLocationId(), "RETURN_REJECTED", "RETURN",
                            ret.getId(), CommerceInputRules.json(Map.of("status", from.name())), null, reason);
                    return ret.getId();
                }, seen::getId);
        return view(instituteId, outcome.value(), user, outcome.replayed());
    }

    /** {@code POST /returns/{id}/receive} (R4): stock, credit note and money in one transaction. */
    public ReturnDtos.ReturnView receive(CustomUserDetails user, String instituteId, String returnId,
                                         ReturnDtos.ReceiveRequest request) {
        if (request == null) {
            throw validation("the request has no body");
        }
        String key = CommerceRequestGuard.requireClientKey(request.getClientRequestId());
        ReturnStatus from = status(request.getFromStatus());
        String note = text(request.getNote(), "note", 500);
        String newLocation = text(request.getLocationId(), "location_id", 36);
        Map<String, Named> named = named(request.getLines());
        CommerceReturn seen = readReturn(user, instituteId, returnId, FLOOR);
        desk.authorize(user, instituteId, newLocation != null ? newLocation : seen.getLocationId(), FLOOR);
        String actor = user.getUserId();
        CommerceRequestGuard.Outcome<String> outcome = requestGuard.run(new CommerceRequestGuard.Key(instituteId, key,
                        "RETURN_RECEIVE", "RETURN", seen.getId(),
                        CommerceRequestGuard.hash("RETURN_RECEIVE", request, seen.getId()), actor),
                () -> receiveInside(instituteId, seen.getId(), seen.getOrderId(), from, newLocation, named, actor,
                        note),
                seen::getId);
        return view(instituteId, outcome.value(), user, outcome.replayed());
    }

    /** What the receive body names for one order line: units by condition and the pieces. */
    static final class Named {
        int resaleable;
        int damaged;
        final Set<String> pieces = new LinkedHashSet<>();
        final Set<String> damagedPieces = new LinkedHashSet<>();
    }

    String receiveInside(String instituteId, String returnId, String orderId, ReturnStatus from, String newLocation,
                         Map<String, Named> named, String actor, String note) {
        CommerceOrder order = desk.lockOrder(instituteId, orderId);
        CommerceReturn ret = refundService.lockReturn(instituteId, returnId);
        requireFrom(ret, from, ReturnStatus.APPROVED);
        if (CommerceOrderStatus.of(order.getStatus()) != CommerceOrderStatus.DELIVERED) {
            throw new ConflictException(CommerceOrderDeskService.ORDER_STATE_CHANGED + ": the order is "
                    + order.getStatus() + ", not DELIVERED");
        }
        if (newLocation != null && !newLocation.equals(ret.getLocationId())) {
            requireLocation(instituteId, newLocation);
            ret.setLocationId(newLocation);
        }
        shipmentService.getObject().requirePeriodOpen(instituteId);
        List<CommerceOrderLine> lines = desk.freshLines(order.getId());
        Invoice invoice = desk.liveInvoice(order, lines);
        if (invoice == null) {
            throw new ConflictException("INVOICE_MISSING: the order has no live invoice yet; the invoice backlog "
                    + "issues it, try again shortly");
        }
        List<CommerceReturnLine> returnLines = returnLineRepository.findByReturnIdOrderByCreatedAtAscIdAsc(ret.getId());
        for (String lineId : named.keySet()) {
            if (returnLines.stream().noneMatch(l -> l.getOrderLineId().equals(lineId))) {
                throw validation("order_line_id " + lineId + " is not on this return");
            }
        }

        // 1. Stock at the return's location.
        CommerceShipment delivered = deliveredShipment(order.getId());
        List<CommerceShipmentLine> shipped = delivered == null ? List.of()
                : shipmentLineRepository.findByShipmentIdOrderByCreatedAtAscIdAsc(delivered.getId());
        List<StockMovement> sales = delivered == null ? List.of()
                : desk.currentSales(instituteId, delivered, shipped);
        List<StockPosting> postings = new ArrayList<>();
        Map<String, Object> audit = new LinkedHashMap<>();
        for (CommerceReturnLine rl : returnLines) {
            CommerceOrderLine line = CommerceOrderDeskService.byId(lines, rl.getOrderLineId());
            Named n = named.get(rl.getOrderLineId());
            if (line == null || n == null || n.resaleable + n.damaged != rl.getQuantity()) {
                throw new InvalidRequestException("RETURN_LINES_INCOMPLETE: name every unit of every line of the "
                        + "return with its condition");
            }
            StockVariantRepository.VariantFacts facts = variantRepository.findFacts(instituteId,
                    line.getPackageSessionId()).orElse(null);
            boolean tracked = facts != null && StockPolicy.TRACKED.name().equals(facts.getStockPolicy());
            boolean pieceStock = tracked && StockMode.PIECE.name().equals(facts.getStockMode());
            if (!pieceStock && !n.pieces.isEmpty()) {
                throw validation("line " + line.getLineNo() + " is counted by quantity and has no pieces");
            }
            rl.setQtyResaleable(n.resaleable);
            rl.setQtyDamaged(n.damaged);
            audit.put(rl.getOrderLineId(), Map.of("resaleable", n.resaleable, "damaged", n.damaged));
            if (!tracked) {
                continue;
            }
            StockPosting.StockPostingBuilder base = StockPosting.builder()
                    .instituteId(instituteId)
                    .locationId(ret.getLocationId())
                    .packageSessionId(line.getPackageSessionId())
                    .referenceType(REFERENCE_RETURN_LINE)
                    .referenceId(rl.getId())
                    .actorUserId(actor);
            if (pieceStock) {
                if (n.pieces.size() != rl.getQuantity() || n.damagedPieces.size() != n.damaged) {
                    throw new InvalidRequestException("RETURN_LINES_INCOMPLETE: name the " + rl.getQuantity()
                            + " piece(s) of line " + line.getLineNo() + " with their condition");
                }
                Map<String, String> statusOf = new HashMap<>();
                pieceRepository.findRowsByOrderLine(instituteId, line.getId())
                        .forEach(p -> statusOf.put(p.getId(), p.getStatus()));
                for (String pieceId : n.pieces) {
                    if (!statusOf.containsKey(pieceId)) {
                        throw new InvalidRequestException("RETURN_LINES_INCOMPLETE: a named piece is not a piece of "
                                + "line " + line.getLineNo());
                    }
                    if (!"SOLD".equals(statusOf.get(pieceId))) {
                        throw new ConflictException("PIECE_STATE: a named piece of line " + line.getLineNo() + " is "
                                + statusOf.get(pieceId) + ", not SOLD");
                    }
                }
                for (String pieceId : n.pieces) {
                    postings.add(base.type(StockMovementType.RETURN).pieceId(pieceId).quantityDelta(1).reason(null)
                            .idempotencyKey("RET:" + rl.getId() + ":" + pieceId).build());
                    if (n.damagedPieces.contains(pieceId)) {
                        postings.add(base.type(StockMovementType.DAMAGE).pieceId(pieceId).quantityDelta(-1)
                                .reason(REASON_RETURN_DAMAGED)
                                .idempotencyKey("RET_DMG:" + rl.getId() + ":" + pieceId).build());
                    }
                }
                rl.setPieceIdsJson(json(new ArrayList<>(n.pieces)));
            } else {
                BigDecimal saleCost = saleCost(shipped, sales, line.getId());
                if (saleCost == null && POS_CHANNEL.equals(order.getChannel())) {
                    // A counter sale has no parcel: its line keeps the cost the POS_SALE took out at.
                    saleCost = counterUnitCost(line);
                }
                StockPosting.StockPostingBuilder back = base.type(StockMovementType.RETURN)
                        .quantityDelta(rl.getQuantity()).idempotencyKey("RET:" + rl.getId());
                if (saleCost != null) {
                    back.unitCost(saleCost).costTreatment(StockPosting.CostTreatment.KNOWN);
                }
                postings.add(back.build());
                if (n.damaged > 0) {
                    postings.add(StockPosting.builder()
                            .instituteId(instituteId)
                            .locationId(ret.getLocationId())
                            .packageSessionId(line.getPackageSessionId())
                            .referenceType(REFERENCE_RETURN_LINE)
                            .referenceId(rl.getId())
                            .actorUserId(actor)
                            .type(StockMovementType.DAMAGE)
                            .quantityDelta(-n.damaged)
                            .reason(REASON_RETURN_DAMAGED)
                            .idempotencyKey("RET_DMG:" + rl.getId())
                            .build());
                }
            }
        }
        if (!postings.isEmpty()) {
            ledger.postAll(postings);
        }

        // 2. The credit note for the units (shipping and COD charge are never credited by a return).
        TaxResult placement = desk.placementTax(order);
        List<InvoiceLineItem> invoiceLines = desk.invoiceLines(invoice.getId());
        List<CreditNoteLineRequest> credit = new ArrayList<>();
        Map<String, List<String>> invoiceLinesOf = new HashMap<>();
        for (CommerceReturnLine rl : returnLines) {
            CommerceOrderLine line = CommerceOrderDeskService.byId(lines, rl.getOrderLineId());
            List<InvoiceLineItem> mine = new ArrayList<>();
            for (InvoiceLineItem item : invoiceLines) {
                if (line.getLineRef().equals(item.getSourceId())) {
                    mine.add(item);
                }
            }
            List<TaxLineResult> taxLines = CommerceOrderRemainder.taxLinesOf(placement, line.getLineRef());
            int[] per = CommerceLineCancelService.perUnitCounts(mine, taxLines, line.getQuantity());
            List<String> ids = new ArrayList<>();
            for (int i = 0; i < mine.size(); i++) {
                credit.add(CreditNoteLineRequest.builder().invoiceLineItemId(mine.get(i).getId())
                        .quantity(rl.getQuantity() * per[i]).build());
                ids.add(mine.get(i).getId());
            }
            invoiceLinesOf.put(rl.getId(), ids);
        }
        CreditNoteDTO noteDto = null;
        if (!credit.isEmpty()) {
            String reason = ret.getReason() + (ret.getReasonNote() == null ? "" : ": " + ret.getReasonNote());
            noteDto = creditNoteService.issue(instituteId, actor, CreditNoteRequest.builder()
                    .clientRequestId("RET:" + ret.getId())
                    .invoiceId(invoice.getId())
                    .full(false)
                    .reason(reason.length() > 500 ? reason.substring(0, 500) : reason)
                    .returnId(ret.getId())
                    .lines(credit)
                    .build());
        }
        Map<String, BigDecimal> amountOfInvoiceLine = new HashMap<>();
        if (noteDto != null && noteDto.getLines() != null) {
            for (CreditNoteLineDTO c : noteDto.getLines()) {
                amountOfInvoiceLine.merge(c.getInvoiceLineItemId(), c.getAmount() == null ? BigDecimal.ZERO
                        : c.getAmount(), BigDecimal::add);
            }
        }
        Map<String, BigDecimal> costOfInvoiceLine = new HashMap<>();
        for (CommerceReturnLine rl : returnLines) {
            CommerceOrderLine line = CommerceOrderDeskService.byId(lines, rl.getOrderLineId());
            List<String> ids = invoiceLinesOf.getOrDefault(rl.getId(), List.of());
            BigDecimal credited = BigDecimal.ZERO.setScale(2);
            for (String id : ids) {
                credited = credited.add(amountOfInvoiceLine.getOrDefault(id, BigDecimal.ZERO));
            }
            rl.setCreditedValue(credited);
            BigDecimal cost = lineCost(line, rl.getQuantity());
            rl.setCostTotal(cost);
            if (cost != null) {
                costOfInvoiceLine.putAll(splitCost(cost, ids, amountOfInvoiceLine));
            }
            returnLineRepository.save(rl);
            line.setQtyReturned(nz(line.getQtyReturned()) + rl.getQuantity());
            line.setReturnedValue(nzm(line.getReturnedValue()).add(credited));
            orderLineRepository.save(line);
        }
        if (noteDto != null) {
            desk.setCreditCosts(instituteId, noteDto, costOfInvoiceLine);
        }
        BigDecimal creditTotal = noteDto == null || noteDto.getTotal() == null ? BigDecimal.ZERO.setScale(2)
                : noteDto.getTotal();

        // 3. Money: the credit is due back (capped by what was paid; a COD order waits for its remittance).
        BigDecimal before = nzm(order.getRefundDue());
        BigDecimal room = nzm(order.getAmountPaid()).subtract(before);
        BigDecimal target = creditTotal.min(room.max(BigDecimal.ZERO));
        desk.raiseRefundDue(order, target, "RET:" + ret.getId(), "Goods of the paid order were returned.");
        BigDecimal raised = nzm(order.getRefundDue()).subtract(before);
        orderRepository.save(order);

        ret.setCreditNoteId(noteDto == null ? null : noteDto.getId());
        ret.setCreditTotal(creditTotal);
        ret.setDueRaised(raised);
        ret.setStatus(ReturnStatus.RECEIVED.name());
        ret.setReceivedAt(new Date());
        ret.setReceivedBy(actor);
        returnRepository.save(ret);
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("lines", audit);
        detail.put("credit_note_id", ret.getCreditNoteId());
        detail.put("credit_total", creditTotal.toPlainString());
        detail.put("due_raised", raised.toPlainString());
        detail.put("location_id", ret.getLocationId());
        auditService.record(instituteId, actor, ret.getLocationId(), "RETURN_RECEIVED", "RETURN", ret.getId(), null,
                CommerceInputRules.json(detail), note);
        dueService.closeReady(order);
        return ret.getId();
    }

    // ================================================================== reads

    public ReturnDtos.ReturnView get(CustomUserDetails user, String instituteId, String returnId) {
        CommerceReturn ret = readReturn(user, instituteId, returnId, READERS);
        desk.authorize(user, instituteId, ret.getLocationId(), READERS);
        return view(instituteId, ret.getId(), user, false);
    }

    public ReturnDtos.ReturnPage list(CustomUserDetails user, String instituteId, String status, String orderId,
                                      LocalDate from, LocalDate to, int page, int pageSize) {
        accessGuard.require(user, instituteId, CommerceFeature.ORDERS, READERS);
        String s = status == null || status.isBlank() ? null : status.trim().toUpperCase(Locale.ROOT);
        if (s != null && ReturnStatus.of(s) == null) {
            throw validation("status is REQUESTED, APPROVED, REJECTED, RECEIVED or CLOSED");
        }
        if (from != null && to != null && to.isBefore(from)) {
            throw validation("to is before from");
        }
        int size = Math.min(Math.max(pageSize, 1), 50);
        int index = Math.max(page, 0);
        Date fromTime = from == null ? null : Date.from(from.atStartOfDay(INDIA).toInstant());
        Date toTime = to == null ? null : Date.from(to.plusDays(1).atStartOfDay(INDIA).toInstant());
        String o = orderId == null || orderId.isBlank() ? null : orderId.trim();
        return ownTransaction.execute(tx -> {
            Page<CommerceReturn> found = returnRepository.search(instituteId, s, o, fromTime, toTime,
                    PageRequest.of(index, size));
            return ReturnDtos.ReturnPage.builder().returns(summaries(found.getContent())).page(index).pageSize(size)
                    .total(found.getTotalElements()).build();
        });
    }

    /** Summaries of returns (inside a transaction). */
    public List<ReturnDtos.ReturnSummary> summaries(List<CommerceReturn> returns) {
        List<ReturnDtos.ReturnSummary> out = new ArrayList<>();
        if (returns.isEmpty()) {
            return out;
        }
        // Units as the offers count them: a measured line (2.5 m) is one item, a counted line its
        // quantity. The order lines give the scale (one batch read).
        List<CommerceReturnLine> returnLines = returnLineRepository.findByReturnIdIn(returns.stream()
                .map(CommerceReturn::getId).toList());
        Map<String, Integer> scaleByOrderLine = new HashMap<>();
        Set<String> orderLineIds = new LinkedHashSet<>();
        returnLines.forEach(line -> orderLineIds.add(line.getOrderLineId()));
        orderLineIds.remove(null);
        if (!orderLineIds.isEmpty()) {
            for (CommerceOrderLine ol : orderLineRepository.findAllById(orderLineIds)) {
                scaleByOrderLine.put(ol.getId(), ol.getQtyScale() == null ? 1 : ol.getQtyScale());
            }
        }
        Map<String, Integer> units = new HashMap<>();
        for (CommerceReturnLine line : returnLines) {
            units.merge(line.getReturnId(), summaryUnits(line, scaleByOrderLine), Integer::sum);
        }
        Map<String, String> numbers = new HashMap<>();
        for (CommerceReturn r : returns) {
            String orderNumber = numbers.computeIfAbsent(r.getOrderId(), id -> orderRepository.findById(id)
                    .map(CommerceOrder::getOrderNumber).orElse(null));
            out.add(ReturnDtos.ReturnSummary.builder()
                    .id(r.getId()).returnNumber(r.getReturnNumber()).orderId(r.getOrderId()).orderNumber(orderNumber)
                    .status(r.getStatus()).reason(r.getReason()).locationId(r.getLocationId())
                    .units(units.getOrDefault(r.getId(), 0)).creditTotal(r.getCreditTotal())
                    .refunded(nzm(refundRepository.sumProcessedOfReturn(r.getId())))
                    .createdAt(CommerceRefundService.instant(r.getCreatedAt()))
                    .build());
        }
        return out;
    }

    /** One return line in a summary's {@code units}: 1 for a measured line, else its quantity. */
    static int summaryUnits(CommerceReturnLine line, Map<String, Integer> scaleByOrderLine) {
        int quantity = line.getQuantity() == null ? 0 : line.getQuantity();
        Integer scale = line.getOrderLineId() == null ? null : scaleByOrderLine.get(line.getOrderLineId());
        return scale != null && scale > 1 && quantity > 0 ? 1 : quantity;
    }

    /** The return as it is now (its own transaction), with the caller's next actions. */
    public ReturnDtos.ReturnView view(String instituteId, String returnId, CustomUserDetails user,
                                      boolean replayed) {
        return ownTransaction.execute(tx -> {
            CommerceReturn r = returnRepository.findByIdAndInstituteId(returnId, instituteId)
                    .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "RETURN_NOT_FOUND: no such return"));
            CommerceOrder order = orderRepository.findById(r.getOrderId()).orElse(null);
            List<CommerceOrderLine> orderLines = orderLineRepository.findByOrderIdOrderByLineNoAsc(r.getOrderId());
            List<ReturnDtos.ReturnLineView> lines = new ArrayList<>();
            for (CommerceReturnLine l : returnLineRepository.findByReturnIdOrderByCreatedAtAscIdAsc(r.getId())) {
                CommerceOrderLine ol = CommerceOrderDeskService.byId(orderLines, l.getOrderLineId());
                List<String> pieceIds = list(l.getPieceIdsJson());
                List<String> codes = null;
                if (!pieceIds.isEmpty() && ol != null) {
                    codes = new ArrayList<>();
                    for (var piece : pieceRepository.findRowsByOrderLine(instituteId, ol.getId())) {
                        if (pieceIds.contains(piece.getId())) {
                            codes.add(piece.getCode());
                        }
                    }
                }
                lines.add(ReturnDtos.ReturnLineView.builder().id(l.getId()).orderLineId(l.getOrderLineId())
                        .lineNo(ol == null ? null : ol.getLineNo()).name(ol == null ? null : ol.getNameSnapshot())
                        .sku(ol == null ? null : ol.getSkuSnapshot()).quantity(l.getQuantity())
                        .qtyResaleable(l.getQtyResaleable()).qtyDamaged(l.getQtyDamaged()).pieceCodes(codes)
                        .creditedValue(l.getCreditedValue()).build());
            }
            List<CommerceRefund> refunds = refundRepository.findByReturnIdOrderByCreatedAtAsc(r.getId());
            BigDecimal refunded = refunds.stream().filter(x -> RefundStatus.PROCESSED.name().equals(x.getStatus()))
                    .map(CommerceRefund::getAmount).reduce(BigDecimal.ZERO.setScale(2), BigDecimal::add);
            BigDecimal live = refunds.stream().filter(x -> !RefundStatus.FAILED.name().equals(x.getStatus()))
                    .map(CommerceRefund::getAmount).reduce(BigDecimal.ZERO.setScale(2), BigDecimal::add);
            ReturnDtos.CreditNoteRef note = null;
            if (r.getCreditNoteId() != null) {
                CommerceCreditNote cn = creditNoteRepository.findById(r.getCreditNoteId()).orElse(null);
                if (cn != null) {
                    note = ReturnDtos.CreditNoteRef.builder().id(cn.getId()).number(cn.getCreditNoteNumber())
                            .total(cn.getTotal()).build();
                }
            }
            return ReturnDtos.ReturnView.builder()
                    .id(r.getId()).returnNumber(r.getReturnNumber()).orderId(r.getOrderId())
                    .orderNumber(order == null ? null : order.getOrderNumber()).status(r.getStatus())
                    .reason(r.getReason()).reasonNote(r.getReasonNote()).requestedVia(r.getRequestedVia())
                    .locationId(r.getLocationId()).lines(lines).policyWarnings(list(r.getPolicyWarningsJson()))
                    .overrideReason(r.getOverrideReason()).photoMediaIds(list(r.getPhotoMediaIdsJson()))
                    .creditNote(note).creditTotal(r.getCreditTotal()).dueRaised(r.getDueRaised()).refunded(refunded)
                    .refunds(refundService.summaries(refunds)).requestedBy(r.getRequestedBy())
                    .createdAt(CommerceRefundService.instant(r.getCreatedAt()))
                    .approvedAt(CommerceRefundService.instant(r.getApprovedAt())).approvedBy(r.getApprovedBy())
                    .rejectedAt(CommerceRefundService.instant(r.getRejectedAt())).rejectedBy(r.getRejectedBy())
                    .rejectReason(r.getRejectReason())
                    .receivedAt(CommerceRefundService.instant(r.getReceivedAt())).receivedBy(r.getReceivedBy())
                    .closedAt(CommerceRefundService.instant(r.getClosedAt()))
                    .nextActions(nextActions(r, live, user))
                    .replayed(replayed ? Boolean.TRUE : null)
                    .build();
        });
    }

    static List<String> nextActions(CommerceReturn r, BigDecimal liveRefunds, CustomUserDetails user) {
        Set<CommerceRole> roles = CommerceAccessGuard.rolesOf(user);
        boolean admin = user != null && user.getAuthorities() != null && user.getAuthorities().stream()
                .anyMatch(a -> a != null && "ADMIN".equalsIgnoreCase(String.valueOf(a.getAuthority()).trim()));
        boolean manager = admin || roles.contains(CommerceRole.STORE_MANAGER);
        boolean floor = manager || roles.contains(CommerceRole.WAREHOUSE_STAFF);
        List<String> out = new ArrayList<>();
        ReturnStatus status = ReturnStatus.of(r.getStatus());
        if (status == ReturnStatus.REQUESTED && manager) {
            out.add("APPROVE");
            out.add("REJECT");
        } else if (status == ReturnStatus.APPROVED) {
            if (floor) {
                out.add("RECEIVE");
            }
            if (manager) {
                out.add("REJECT");
            }
        } else if ((status == ReturnStatus.RECEIVED || status == ReturnStatus.CLOSED) && manager
                && r.getDueRaised().compareTo(liveRefunds) > 0) {
            out.add("REFUND");
        }
        return out;
    }

    // ================================================================== helpers

    /**
     * 409 unless the order is a delivered, paid (or COD awaiting remittance) order. A counter
     * bill (channel POS) is returned the same way, at the counter or at this desk.
     */
    static void requireReturnable(CommerceOrder order) {
        if (CommerceOrderStatus.of(order.getStatus()) != CommerceOrderStatus.DELIVERED) {
            throw new ConflictException("ORDER_NOT_RETURNABLE: only a delivered order is returned here");
        }
        boolean paid = "PAID".equals(order.getPaymentStatus());
        if (!paid && !CommerceReturnDueService.dueDeferred(order)) {
            throw new ConflictException("ORDER_NOT_PAID: an order is returned once it is paid");
        }
    }

    /** Units of the line that may still be asked for: shipped less returned less open returns. */
    int returnable(CommerceOrderLine line) {
        return nz(line.getQtyShipped()) - nz(line.getQtyReturned())
                - (int) returnRepository.openQuantity(line.getId());
    }

    private void requireLocation(String instituteId, String locationId) {
        StockLocation location = locationId == null ? null
                : locationRepository.findByInstituteIdAndId(instituteId, locationId).orElse(null);
        if (location == null || !"ACTIVE".equals(location.getStatus())) {
            throw new ConflictException("LOCATION_INACTIVE: the goods come back to an active location of the shop");
        }
    }

    Assessment assess(CommerceOrder order, List<CommerceOrderLine> lines, Clean clean) {
        CommerceReturnPolicy.Settings settings = returnSettings.read(order.getInstituteId());
        LocalDate today = clock.today(order.getInstituteId());
        CommerceShipment delivered = deliveredShipment(order.getId());
        LocalDate deliveredOn = delivered != null && delivered.getDeliveredOn() != null ? delivered.getDeliveredOn()
                : order.getDeliveredAt() == null ? null : CommerceReturnPolicy.indiaDay(order.getDeliveredAt()
                .toInstant());
        Set<String> packageIds = new LinkedHashSet<>();
        for (String lineId : clean.lines().keySet()) {
            CommerceOrderLine line = CommerceOrderDeskService.byId(lines, lineId);
            if (line != null && line.getPackageId() != null) {
                packageIds.add(line.getPackageId());
            }
        }
        Integer window = packageIds.isEmpty() ? null
                : returnRepository.smallestCollectionWindow(order.getInstituteId(), packageIds);
        List<String> warnings = CommerceReturnPolicy.check(settings, deliveredOn, today, window,
                clean.reason().name(), clean.photoMediaIds().size());
        return new Assessment(settings, deliveredOn, today, window, warnings);
    }

    private CommerceShipment deliveredShipment(String orderId) {
        CommerceShipment found = null;
        for (CommerceShipment s : shipmentRepository.findByOrderIdOrderByCreatedAtAsc(orderId)) {
            if ("DELIVERED".equals(s.getStatus())) {
                found = s;
            }
        }
        return found;
    }

    /** The unit cost the SALE of the line's delivered parcel took the goods out at; null when not known. */
    private static BigDecimal saleCost(List<CommerceShipmentLine> shipped, List<StockMovement> sales,
                                       String orderLineId) {
        Set<String> shipmentLineIds = new LinkedHashSet<>();
        for (CommerceShipmentLine s : shipped) {
            if (orderLineId.equals(s.getOrderLineId())) {
                shipmentLineIds.add(s.getId());
            }
        }
        for (StockMovement sale : sales) {
            if (shipmentLineIds.contains(sale.getReferenceId()) && sale.getUnitCost() != null
                    && !sale.isCostProvisional()) {
                return sale.getUnitCost();
            }
        }
        return null;
    }

    /**
     * The unit cost of a counter sale's line: its {@code cost_total} over its quantity (4
     * decimals); null when the line has no cost.
     */
    static BigDecimal counterUnitCost(CommerceOrderLine line) {
        if (line.getCostTotal() == null || line.getQuantity() == null || line.getQuantity() < 1) {
            return null;
        }
        return line.getCostTotal().divide(BigDecimal.valueOf(line.getQuantity()), 4, RoundingMode.HALF_UP);
    }

    /** The order line's cost of the goods for {@code quantity} returned units; null when the line has none. */
    static BigDecimal lineCost(CommerceOrderLine line, int quantity) {
        if (line.getCostTotal() == null || line.getQtyShipped() == null || line.getQtyShipped() < 1) {
            return null;
        }
        return line.getCostTotal().multiply(BigDecimal.valueOf(quantity))
                .divide(BigDecimal.valueOf(line.getQtyShipped()), 2, RoundingMode.HALF_UP);
    }

    /** {@code cost} shared over the invoice lines by their credited amount; the last takes the rest. */
    static Map<String, BigDecimal> splitCost(BigDecimal cost, List<String> invoiceLineIds,
                                             Map<String, BigDecimal> amountOfInvoiceLine) {
        Map<String, BigDecimal> out = new LinkedHashMap<>();
        if (invoiceLineIds.isEmpty()) {
            return out;
        }
        BigDecimal net = BigDecimal.ZERO;
        for (String id : invoiceLineIds) {
            net = net.add(amountOfInvoiceLine.getOrDefault(id, BigDecimal.ZERO));
        }
        BigDecimal given = BigDecimal.ZERO;
        for (int i = 0; i < invoiceLineIds.size(); i++) {
            String id = invoiceLineIds.get(i);
            BigDecimal share = i == invoiceLineIds.size() - 1 ? cost.subtract(given)
                    : net.signum() == 0 ? BigDecimal.ZERO.setScale(2)
                    : cost.multiply(amountOfInvoiceLine.getOrDefault(id, BigDecimal.ZERO)).divide(net, 2,
                    RoundingMode.HALF_UP);
            given = given.add(share);
            out.put(id, share);
        }
        return out;
    }

    private CommerceReturn readReturn(CustomUserDetails user, String instituteId, String returnId,
                                      Set<CommerceRole> roles) {
        CommerceReturn ret = ownTransaction.execute(status -> StringUtils.hasText(returnId)
                ? returnRepository.findByIdAndInstituteId(returnId.trim(), instituteId).orElse(null) : null);
        if (ret == null) {
            accessGuard.require(user, instituteId, CommerceFeature.ORDERS, roles);
            throw new VacademyException(HttpStatus.NOT_FOUND, "RETURN_NOT_FOUND: no such return");
        }
        return ret;
    }

    private static void requireFrom(CommerceReturn ret, ReturnStatus from, ReturnStatus... allowed) {
        boolean ok = from.name().equals(ret.getStatus());
        boolean moveAllowed = false;
        for (ReturnStatus a : allowed) {
            moveAllowed |= a == from;
        }
        if (!ok || !moveAllowed) {
            throw new ConflictException(RETURN_STATE_CHANGED + ": the return is " + ret.getStatus() + " now");
        }
    }

    private static ReturnStatus status(String raw) {
        ReturnStatus status = ReturnStatus.of(raw);
        if (status == null) {
            throw validation("from_status is a return status");
        }
        return status;
    }

    /** The receive lines by order line: units per condition (each condition once per line) and pieces. */
    static Map<String, Named> named(List<ReturnDtos.ReceiveLine> lines) {
        if (lines == null || lines.isEmpty() || lines.size() > 2 * MAX_LINES) {
            throw new InvalidRequestException("RETURN_LINES_INCOMPLETE: name every unit of the return with its "
                    + "condition");
        }
        Map<String, Named> out = new LinkedHashMap<>();
        Set<String> seen = new LinkedHashSet<>();
        Set<String> pieces = new LinkedHashSet<>();
        for (ReturnDtos.ReceiveLine line : lines) {
            if (line == null || !StringUtils.hasText(line.getOrderLineId()) || line.getQuantity() == null
                    || line.getQuantity() < 1 || line.getQuantity() > 100_000) {
                throw validation("every line names an order_line_id, a condition and a quantity of at least 1");
            }
            ReturnCondition condition = ReturnCondition.of(line.getCondition());
            if (condition == null) {
                throw validation("condition is RESALEABLE or DAMAGED");
            }
            String id = line.getOrderLineId().trim();
            if (id.length() > 36 || !seen.add(id + "|" + condition.name())) {
                throw validation("a line appears once per condition");
            }
            Named n = out.computeIfAbsent(id, k -> new Named());
            if (condition == ReturnCondition.DAMAGED) {
                n.damaged += line.getQuantity();
            } else {
                n.resaleable += line.getQuantity();
            }
            if (line.getPieceIds() != null) {
                if (line.getPieceIds().size() > 1000) {
                    throw validation("at most 1000 pieces");
                }
                for (String raw : line.getPieceIds()) {
                    String piece = raw == null ? "" : raw.trim();
                    if (piece.isEmpty() || piece.length() > 36 || !pieces.add(piece)) {
                        throw validation("piece_ids are distinct ids of at most 36 characters");
                    }
                    n.pieces.add(piece);
                    if (condition == ReturnCondition.DAMAGED) {
                        n.damagedPieces.add(piece);
                    }
                }
            }
        }
        return out;
    }

    Clean validate(ReturnDtos.CreateReturnRequest request, boolean write) {
        if (request == null) {
            throw validation("the request has no body");
        }
        String key = write ? CommerceRequestGuard.requireClientKey(request.getClientRequestId()) : null;
        String orderId = text(request.getOrderId(), "order_id", 36);
        if (orderId == null) {
            throw validation("order_id is required");
        }
        ReturnReason reason = ReturnReason.of(request.getReason());
        if (reason == null) {
            throw validation("reason is DEFECTIVE, WRONG_ITEM, DAMAGED_IN_TRANSIT, SIZE, CHANGED_MIND or OTHER");
        }
        RequestedVia via = request.getRequestedVia() == null || request.getRequestedVia().isBlank()
                ? RequestedVia.PHONE : RequestedVia.of(request.getRequestedVia());
        if (via == null) {
            throw validation("requested_via is PHONE, WHATSAPP, EMAIL, COUNTER or OTHER");
        }
        List<ReturnDtos.LineRequest> asked = request.getLines();
        if (asked == null || asked.isEmpty() || asked.size() > MAX_LINES) {
            throw validation("lines holds 1 to " + MAX_LINES + " lines");
        }
        Map<String, Integer> lines = new LinkedHashMap<>();
        for (ReturnDtos.LineRequest line : asked) {
            String id = line == null ? null : text(line.getOrderLineId(), "order_line_id", 36);
            if (id == null || line.getQuantity() == null || line.getQuantity() < 1 || line.getQuantity() > 100_000) {
                throw validation("every line names an order_line_id and a quantity of at least 1");
            }
            if (lines.put(id, line.getQuantity()) != null) {
                throw validation("a line is named twice");
            }
        }
        List<String> photos = new ArrayList<>();
        if (request.getPhotoMediaIds() != null) {
            if (request.getPhotoMediaIds().size() > MAX_PHOTOS) {
                throw validation("photo_media_ids holds at most " + MAX_PHOTOS + " ids");
            }
            for (String raw : request.getPhotoMediaIds()) {
                String id = raw == null ? "" : raw.trim();
                if (!MEDIA_ID.matcher(id).matches() || photos.contains(id)) {
                    throw validation("photo_media_ids are distinct media ids of at most 36 letters, digits, - or _");
                }
                photos.add(id);
            }
        }
        return new Clean(key, orderId, text(request.getLocationId(), "location_id", 36), reason,
                text(request.getReasonNote(), "reason_note", 500), via, lines, photos,
                text(request.getOverrideReason(), "override_reason", 500),
                Boolean.TRUE.equals(request.getApproveNow()), text(request.getNote(), "note", 500));
    }

    private String json(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private List<String> list(String json) {
        if (!StringUtils.hasText(json)) {
            return new ArrayList<>();
        }
        try {
            return objectMapper.readValue(json, new TypeReference<List<String>>() { });
        } catch (Exception e) {
            return new ArrayList<>();
        }
    }

    static String text(String raw, String field, int max) {
        return CommerceRefundService.text(raw, field, max);
    }

    static InvalidRequestException validation(String message) {
        return new InvalidRequestException("VALIDATION: " + message);
    }

    static int nz(Integer value) {
        return value == null ? 0 : value;
    }

    static BigDecimal nzm(BigDecimal value) {
        return value == null ? BigDecimal.ZERO.setScale(2) : value;
    }
}
