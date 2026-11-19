package vacademy.io.admin_core_service.features.commerce.order.desk;

import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.common.request.CommerceRequestGuard;
import vacademy.io.admin_core_service.features.commerce.document.service.DocumentClock;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceOrderWriter;
import vacademy.io.admin_core_service.features.commerce.order.desk.dto.OrderDeskDtos;
import vacademy.io.admin_core_service.features.commerce.order.dto.CartPriceRequest;
import vacademy.io.admin_core_service.features.commerce.order.dto.StaffOrderDtos;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrder;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderLine;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderTender;
import vacademy.io.admin_core_service.features.commerce.order.enums.CommerceOrderStatus;
import vacademy.io.admin_core_service.features.commerce.order.enums.TenderMode;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderTenderRepository;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceInputRules;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ConflictException;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * {@code POST /orders/{id}/receipts}: money received on a staff order that was left on credit
 * (cash at the counter, a bank transfer, a cheque). Store manager or accountant.
 *
 * <p>Under the order lock: the amount is at most what is due (409 RECEIPT_ABOVE_DUE): total less paid
 * less the credit of goods returned before payment ({@link #amountDue}); a RECEIVED
 * tender is written, the CREDIT tender PENDING is voided and a new one carries what is still
 * due. When the order is paid in full its logs turn PAID and its plans ACTIVE in the same
 * transaction ({@link CommerceStaffOrderService#settlePaid}). A cash-on-delivery order is paid
 * by a courier remittance, never here (409 USE_COD_REMITTANCE).
 */
@Service
public class CommerceReceiptService {

    static final Set<CommerceRole> MONEY = Set.of(CommerceRole.STORE_MANAGER, CommerceRole.ACCOUNTANT);
    private static final ZoneId INDIA = ZoneId.of("Asia/Kolkata");
    private static final BigDecimal MAX_AMOUNT = new BigDecimal("9999999999.99");

    private final CommerceOrderDeskService desk;
    private final CommerceOrderRepository orderRepository;
    private final CommerceOrderTenderRepository tenderRepository;
    private final CommerceStaffOrderService staffOrders;
    private final CommerceAuditService auditService;
    private final CommerceRequestGuard requestGuard;
    private final DocumentClock clock;

    public CommerceReceiptService(CommerceOrderDeskService desk, CommerceOrderRepository orderRepository,
                                  CommerceOrderTenderRepository tenderRepository,
                                  CommerceStaffOrderService staffOrders, CommerceAuditService auditService,
                                  CommerceRequestGuard requestGuard, DocumentClock clock) {
        this.desk = desk;
        this.orderRepository = orderRepository;
        this.tenderRepository = tenderRepository;
        this.staffOrders = staffOrders;
        this.auditService = auditService;
        this.requestGuard = requestGuard;
        this.clock = clock;
    }

    public StaffOrderDtos.StaffOrderDetail record(CustomUserDetails user, String instituteId, String orderId,
                                                  OrderDeskDtos.ReceiptRequest request) {
        if (request == null) {
            throw CommerceOrderDeskService.validation("the request has no body");
        }
        String key = CommerceRequestGuard.requireClientKey(request.getClientRequestId());
        TenderMode mode = TenderMode.of(request.getMode());
        if (mode == null || !TenderMode.STAFF_RECEIVED.contains(mode)) {
            throw CommerceOrderDeskService.validation("mode is CASH, UPI, CARD, BANK_TRANSFER or CHEQUE");
        }
        BigDecimal amount = amount(request.getAmount(), "amount");
        String reference = CommerceOrderDeskService.text(request.getReference(), "reference", 100);
        LocalDate receivedOn = request.getReceivedOn();
        CommerceOrder seen = desk.readOrder(instituteId, orderId);
        if (receivedOn != null && receivedOn.isAfter(clock.today(instituteId))) {
            throw CommerceOrderDeskService.validation("received_on cannot be after today");
        }
        desk.authorize(user, instituteId, seen.getFulfilmentLocationId(), MONEY);
        String actor = user.getUserId();
        CommerceRequestGuard.Outcome<String> outcome = requestGuard.run(new CommerceRequestGuard.Key(instituteId, key,
                        "RECEIPT", "ORDER", orderId, CommerceRequestGuard.hash("RECEIPT", request, orderId), actor),
                () -> {
                    CommerceOrder order = desk.lockOrder(instituteId, orderId);
                    receiveInside(order, desk.freshLines(orderId), mode, amount, reference, receivedOn, actor);
                    return orderId;
                }, () -> orderId);
        return desk.detail(instituteId, orderId, user, outcome.replayed());
    }

    /** The receipt, under the order lock. */
    void receiveInside(CommerceOrder order, List<CommerceOrderLine> lines, TenderMode mode, BigDecimal amount,
                       String reference, LocalDate receivedOn, String actor) {
        if (CartPriceRequest.COD.equals(order.getPaymentMethod())) {
            throw new ConflictException("USE_COD_REMITTANCE: the cash of a COD order is recorded with the courier's "
                    + "remittance");
        }
        CommerceOrderStatus status = CommerceOrderStatus.of(order.getStatus());
        String paymentStatus = order.getPaymentStatus();
        if (!CommerceOrderWriter.CHANNEL_ADMIN.equals(order.getChannel())
                || status == CommerceOrderStatus.CANCELLED || status == CommerceOrderStatus.RTO
                || !(CommerceOrderWriter.PAYMENT_UNPAID.equals(paymentStatus)
                || CommerceOrderWriter.PAYMENT_PARTIALLY_PAID.equals(paymentStatus))) {
            throw new ConflictException(CommerceOrderDeskService.ORDER_STATE_CHANGED
                    + ": this order has nothing due on a receipt");
        }
        BigDecimal paid = CommerceOrderDeskService.nz(order.getAmountPaid());
        // Goods returned before payment were credited without any money going back: that credit
        // lowers what is still due.
        BigDecimal returned = CommerceOrderDeskService.nz(orderRepository.sumReturnCreditNotRaised(order.getId()));
        BigDecimal due = amountDue(order.getTotal(), paid, returned);
        if (amount.compareTo(due) > 0) {
            throw new ConflictException("RECEIPT_ABOVE_DUE: " + due.toPlainString() + " is due on this order");
        }
        Date receivedAt = receivedOn == null ? new Date() : Date.from(receivedOn.atStartOfDay(INDIA).toInstant());

        CommerceOrderTender receipt = new CommerceOrderTender();
        receipt.setInstituteId(order.getInstituteId());
        receipt.setOrderId(order.getId());
        receipt.setMode(mode.name());
        receipt.setAmount(amount);
        receipt.setReference(reference);
        receipt.setStatus(CommerceOrderTender.STATUS_RECEIVED);
        receipt.setReceivedAt(receivedAt);
        receipt.setRecordedBy(actor);
        receipt = tenderRepository.save(receipt);

        // The credit that is left: the old PENDING row is voided, a new one carries the rest.
        for (CommerceOrderTender tender : tenderRepository.findByOrderIdOrderByCreatedAtAsc(order.getId())) {
            if (CommerceOrderTender.STATUS_PENDING.equals(tender.getStatus())
                    && tenderRepository.settleOne(tender.getId(), CommerceOrderTender.STATUS_VOID, null, null) != 1) {
                throw new ConflictException(CommerceOrderDeskService.ORDER_STATE_CHANGED
                        + ": the money of this order changed meanwhile");
            }
        }
        BigDecimal nowPaid = paid.add(amount);
        BigDecimal rest = amountDue(order.getTotal(), nowPaid, returned);
        if (rest.signum() > 0) {
            CommerceOrderTender credit = new CommerceOrderTender();
            credit.setInstituteId(order.getInstituteId());
            credit.setOrderId(order.getId());
            credit.setMode(CommerceOrderTender.MODE_CREDIT);
            credit.setAmount(rest);
            credit.setStatus(CommerceOrderTender.STATUS_PENDING);
            credit.setRecordedBy(actor);
            tenderRepository.save(credit);
        }
        order.setAmountPaid(nowPaid);
        order.setPaymentStatus(rest.signum() > 0 ? CommerceOrderWriter.PAYMENT_PARTIALLY_PAID
                : CommerceOrderWriter.PAYMENT_PAID);
        orderRepository.save(order);
        if (rest.signum() <= 0) {
            staffOrders.settlePaid(order, lines);
        }
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("tender_id", receipt.getId());
        detail.put("mode", mode.name());
        detail.put("amount", amount.toPlainString());
        detail.put("reference", reference);
        detail.put("amount_paid", nowPaid.toPlainString());
        detail.put("due", rest.max(BigDecimal.ZERO).toPlainString());
        auditService.record(order.getInstituteId(), actor, order.getFulfilmentLocationId(), "RECEIPT_RECORDED",
                "ORDER", order.getId(), null, CommerceInputRules.json(detail), null);
        String instituteId = order.getInstituteId();
        String orderId = order.getId();
        String tenderId = receipt.getId();
        desk.afterCommitMoney(hook -> hook.tenderReceived(instituteId, orderId, tenderId, mode.name(), amount));
    }

    /**
     * What a staff order still owes: total less what was paid less the credit of goods returned
     * that was not owed back as money ({@code credit_total - due_raised} of its received returns);
     * never below 0. The order detail and "Record receipt" use this figure.
     */
    public static BigDecimal amountDue(BigDecimal total, BigDecimal paid, BigDecimal returnCreditNotRaised) {
        BigDecimal due = CommerceOrderDeskService.nz(total).subtract(CommerceOrderDeskService.nz(paid))
                .subtract(CommerceOrderDeskService.nz(returnCreditNotRaised));
        return due.signum() < 0 ? BigDecimal.ZERO.setScale(2) : due;
    }

    /** A money amount: positive, at most two decimals. */
    static BigDecimal amount(BigDecimal raw, String field) {
        if (raw == null || raw.signum() <= 0 || raw.stripTrailingZeros().scale() > 2
                || raw.compareTo(MAX_AMOUNT) > 0) {
            throw CommerceOrderDeskService.validation(field + " is an amount above 0 with at most two decimals");
        }
        return raw.setScale(2, RoundingMode.UNNECESSARY);
    }
}
