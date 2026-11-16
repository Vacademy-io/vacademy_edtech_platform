package vacademy.io.admin_core_service.features.commerce.returns.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.document.entity.CommerceCreditNote;
import vacademy.io.admin_core_service.features.commerce.document.repository.CommerceCreditNoteRepository;
import vacademy.io.admin_core_service.features.commerce.document.service.DocumentClock;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceOrderDeskService;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrder;
import vacademy.io.admin_core_service.features.commerce.returns.entity.CommerceRefund;
import vacademy.io.admin_core_service.features.commerce.returns.entity.CommerceReturn;
import vacademy.io.admin_core_service.features.commerce.returns.enums.RefundKind;
import vacademy.io.admin_core_service.features.commerce.returns.enums.RefundMethod;
import vacademy.io.admin_core_service.features.commerce.returns.enums.RefundSource;
import vacademy.io.admin_core_service.features.commerce.returns.enums.RefundStatus;
import vacademy.io.admin_core_service.features.commerce.returns.enums.ReturnStatus;
import vacademy.io.admin_core_service.features.commerce.returns.repository.CommerceRefundRepository;
import vacademy.io.admin_core_service.features.commerce.returns.repository.CommerceReturnRepository;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceInputRules;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * An exchange (WP-32, staff order channel): the credit of a received return is used, in full,
 * on a new staff order. Called from the staff order write, in its transaction, before the new
 * order is written:
 * <ol>
 *   <li>{@link #lock}: the old order, then the return, both locked; the return must be RECEIVED,
 *       worth something, raised in full and named by no live refund, and the old order's open due
 *       must cover it (409 EXCHANGE_NOT_AVAILABLE).</li>
 *   <li>The new order takes a CREDIT_NOTE tender of min(credit, new total) (counted in its
 *       {@code amount_paid}) and names the old order ({@code exchange_of_order_id}).</li>
 *   <li>{@link #apply}: the old order gets an EXCHANGE_CREDIT refund of the same amount
 *       (PROCESSED), and, when the credit is more than the new order, a refund of the rest by the
 *       method staff chose (cash and a referenced bank or UPI payout at once; the gateway after the
 *       commit).</li>
 * </ol>
 */
@Slf4j
@Service
public class CommerceExchangeService {

    public static final String EXCHANGE_NOT_AVAILABLE = "EXCHANGE_NOT_AVAILABLE";
    public static final String EXCHANGE_REMAINDER_REQUIRED = "EXCHANGE_REMAINDER_REQUIRED";

    private final CommerceOrderDeskService desk;
    private final CommerceRefundService refundService;
    private final CommerceReturnDueService dueService;
    private final CommerceReturnRepository returnRepository;
    private final CommerceRefundRepository refundRepository;
    private final CommerceCreditNoteRepository creditNoteRepository;
    private final CommerceAuditService auditService;
    private final DocumentClock clock;

    public CommerceExchangeService(CommerceOrderDeskService desk, CommerceRefundService refundService,
                                   CommerceReturnDueService dueService, CommerceReturnRepository returnRepository,
                                   CommerceRefundRepository refundRepository,
                                   CommerceCreditNoteRepository creditNoteRepository,
                                   CommerceAuditService auditService, DocumentClock clock) {
        this.desk = desk;
        this.refundService = refundService;
        this.dueService = dueService;
        this.returnRepository = returnRepository;
        this.refundRepository = refundRepository;
        this.creditNoteRepository = creditNoteRepository;
        this.auditService = auditService;
        this.clock = clock;
    }

    /** What the exchange of a staff order asks: the return, and how a remainder goes back. */
    public record Ask(String returnId, RefundMethod remainderMethod, String remainderReference) {
    }

    /** The locked old order and return, and what the credit is worth. */
    public record Locked(CommerceOrder oldOrder, CommerceReturn ret, BigDecimal credit, String creditNoteNumber) {
    }

    /** The old order (the location the new one is checked against), read without a lock; 404 otherwise. */
    public CommerceReturn readReturn(String instituteId, String returnId) {
        CommerceReturn ret = returnRepository.findByIdAndInstituteId(returnId, instituteId).orElse(null);
        if (ret == null) {
            throw new VacademyException(HttpStatus.NOT_FOUND, "RETURN_NOT_FOUND: no such return");
        }
        return ret;
    }

    /** Step 1, inside the staff order transaction, before anything is written. */
    public Locked lock(String instituteId, Ask ask) {
        CommerceReturn seen = readReturn(instituteId, ask.returnId());
        CommerceOrder oldOrder = desk.lockOrder(instituteId, seen.getOrderId());
        CommerceReturn ret = refundService.lockReturn(instituteId, seen.getId());
        BigDecimal credit = ret.getCreditTotal();
        if (!ReturnStatus.RECEIVED.name().equals(ret.getStatus()) || credit == null || credit.signum() <= 0
                || ret.getDueRaised().compareTo(credit) != 0) {
            throw new ConflictException(EXCHANGE_NOT_AVAILABLE + ": the return is not a received return whose "
                    + "credit is due in full");
        }
        BigDecimal live = CommerceRefundService.nz(refundRepository.sumLiveOfReturn(ret.getId()));
        if (live.signum() > 0) {
            throw new ConflictException(EXCHANGE_NOT_AVAILABLE + ": the return was refunded already");
        }
        BigDecimal open = CommerceRefundService.nz(oldOrder.getRefundDue())
                .subtract(CommerceRefundService.nz(oldOrder.getRefundCommitted()));
        if (open.compareTo(credit) < 0) {
            throw new ConflictException(EXCHANGE_NOT_AVAILABLE + ": the order's open due is less than the return's "
                    + "credit");
        }
        String number = ret.getCreditNoteId() == null ? null : creditNoteRepository.findById(ret.getCreditNoteId())
                .map(CommerceCreditNote::getCreditNoteNumber).orElse(null);
        return new Locked(oldOrder, ret, credit, number);
    }

    /** After the staff order committed: a gateway remainder refund of its exchange is sent now. */
    public void executeRemainder(String instituteId, String newOrderId) {
        refundRepository.findByInstituteIdAndIdempotencyKey(instituteId, "EXCH_REST:" + newOrderId)
                .ifPresent(refund -> refundService.executeIfPending(refund.getId()));
    }

    /** The CREDIT_NOTE tender of the new order: the credit, at most the new order's total. */
    public static BigDecimal applied(BigDecimal credit, BigDecimal newTotal) {
        return credit.min(newTotal);
    }

    /** 400 EXCHANGE_REMAINDER_REQUIRED when the credit is more than the new order and no method was given. */
    public static void requireRemainder(Ask ask, BigDecimal credit, BigDecimal newTotal) {
        if (credit.compareTo(newTotal) > 0 && ask.remainderMethod() == null) {
            throw new InvalidRequestException(EXCHANGE_REMAINDER_REQUIRED + ": the credit ("
                    + credit.toPlainString() + ") is more than the new order (" + newTotal.toPlainString()
                    + "); say how the rest is refunded (remainder_refund)");
        }
    }

    /**
     * Step 3, after the new order was written: the refunds on the old order. Returns the id of a
     * remainder refund that still needs the gateway (executed after the commit), or null.
     */
    public String apply(Locked locked, CommerceOrder newOrder, Ask ask, String actor) {
        CommerceOrder oldOrder = locked.oldOrder();
        CommerceReturn ret = locked.ret();
        BigDecimal applied = applied(locked.credit(), newOrder.getTotal());
        refundService.insertInside(oldOrder, new CommerceRefundService.NewRefund(RefundKind.ORDER,
                RefundSource.EXCHANGE, RefundMethod.EXCHANGE_CREDIT, RefundStatus.PROCESSED, applied, ret.getId(),
                ret.getCreditNoteId(), null, null, null, locked.creditNoteNumber(), newOrder.getId(),
                clock.today(oldOrder.getInstituteId()), "Exchange: credit used on order " + newOrder.getOrderNumber(),
                "EXCH:" + newOrder.getId(), actor));
        String pendingGateway = null;
        BigDecimal rest = locked.credit().subtract(applied);
        if (rest.signum() > 0) {
            RefundMethod method = ask.remainderMethod();
            String reference = ask.remainderReference();
            RefundStatus status;
            String paymentId = null;
            switch (method) {
                case CASH -> status = RefundStatus.PROCESSED;
                case UPI, BANK_TRANSFER -> status = StringUtils.hasText(reference) ? RefundStatus.PROCESSED
                        : RefundStatus.PENDING;
                case GATEWAY -> {
                    paymentId = refundService.payingRow(oldOrder.getId()).getGatewayPaymentId();
                    status = RefundStatus.PENDING;
                    reference = null;
                }
                default -> throw new InvalidRequestException("VALIDATION: remainder_refund.method is GATEWAY, CASH, "
                        + "UPI or BANK_TRANSFER");
            }
            CommerceRefund remainder = refundService.insertInside(oldOrder, new CommerceRefundService.NewRefund(
                    RefundKind.ORDER, RefundSource.EXCHANGE, method, status, rest, ret.getId(), ret.getCreditNoteId(),
                    paymentId, null, null, reference, null,
                    status == RefundStatus.PROCESSED ? clock.today(oldOrder.getInstituteId()) : null,
                    "Exchange: the credit left over after order " + newOrder.getOrderNumber(),
                    "EXCH_REST:" + newOrder.getId(), actor));
            if (method == RefundMethod.GATEWAY) {
                pendingGateway = remainder.getId();
            }
        }
        dueService.closeReady(oldOrder);
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("return_id", ret.getId());
        detail.put("new_order_id", newOrder.getId());
        detail.put("credit", locked.credit().toPlainString());
        detail.put("applied", applied.toPlainString());
        detail.put("remainder", rest.toPlainString());
        detail.put("remainder_method", rest.signum() > 0 ? ask.remainderMethod().name() : null);
        auditService.record(oldOrder.getInstituteId(), actor, oldOrder.getFulfilmentLocationId(), "EXCHANGE_APPLIED",
                "ORDER", oldOrder.getId(), null, CommerceInputRules.json(detail), null);
        log.info("Commerce exchange: return {} of order {} credited {} on order {}", ret.getReturnNumber(),
                oldOrder.getOrderNumber(), applied, newOrder.getOrderNumber());
        return pendingGateway;
    }
}
