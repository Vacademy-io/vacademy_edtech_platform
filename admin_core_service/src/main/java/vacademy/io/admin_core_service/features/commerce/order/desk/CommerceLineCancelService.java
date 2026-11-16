package vacademy.io.admin_core_service.features.commerce.order.desk;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.catalogue.enums.StockMode;
import vacademy.io.admin_core_service.features.commerce.catalogue.enums.StockPolicy;
import vacademy.io.admin_core_service.features.commerce.common.request.CommerceRequestGuard;
import vacademy.io.admin_core_service.features.commerce.document.dto.CreditNoteLineRequest;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceOrderWriter;
import vacademy.io.admin_core_service.features.commerce.order.desk.dto.OrderDeskDtos;
import vacademy.io.admin_core_service.features.commerce.order.dto.CartPriceRequest;
import vacademy.io.admin_core_service.features.commerce.order.dto.StaffOrderDtos;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrder;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderLine;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderTender;
import vacademy.io.admin_core_service.features.commerce.order.enums.CancelReason;
import vacademy.io.admin_core_service.features.commerce.order.enums.CommerceOrderStatus;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderLegacyRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderLineRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderTenderRepository;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.admin_core_service.features.commerce.shipment.entity.CommerceShipment;
import vacademy.io.admin_core_service.features.commerce.shipment.entity.CommerceShipmentLine;
import vacademy.io.admin_core_service.features.commerce.shipment.enums.CommerceShipmentStatus;
import vacademy.io.admin_core_service.features.commerce.shipment.repository.CommerceShipmentLineRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.CommercePieceRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockVariantRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockVariantRepository.VariantFacts;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxHead;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxLineResult;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxResult;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceInputRules;
import vacademy.io.admin_core_service.features.invoice.entity.Invoice;
import vacademy.io.admin_core_service.features.invoice.entity.InvoiceLineItem;
import vacademy.io.admin_core_service.features.stock_hold.service.StockHoldService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * {@code POST /orders/{id}/lines/{lineId}/cancel}: part or all of one line of an order that has
 * not shipped (COD_PENDING_CONFIRMATION, CONFIRMED, PACKED). Store manager.
 *
 * <p>In the order transaction: the units go back on sale ({@code giveBackSold}); at PACKED the
 * parcel holds fewer units and named one-of-a-kind pieces go back IN_STOCK; the value of the
 * cancel (the credit the tax calculator gives for those units, {@link CommerceOrderRemainder})
 * comes off the order's subtotal, discount, tax and total (delivery and the COD charge stay); a
 * live invoice is credited for those units ({@code LCAN:<line>:<cancelled after>}).
 *
 * <p>Money: an unpaid order's logs are split again over the new total (a fully cancelled
 * line's log carries 0 and its plan is cancelled) and its pending tender is replaced by one for
 * the new due; a paid order keeps its logs and records the value as due back
 * ({@code refund_due}, REFUND_DUE). When every item line is cancelled the whole order is
 * cancelled in the same transaction (reason LINES_CANCELLED).
 */
@Service
public class CommerceLineCancelService {

    static final Set<CommerceRole> MANAGER = Set.of(CommerceRole.STORE_MANAGER);
    static final String HOLD_REASON = "LINE_CANCELLED";
    private static final Set<CommerceOrderStatus> CANCELLABLE = EnumSet.of(
            CommerceOrderStatus.COD_PENDING_CONFIRMATION, CommerceOrderStatus.CONFIRMED, CommerceOrderStatus.PACKED);

    private final CommerceOrderDeskService desk;
    private final CommerceOrderRepository orderRepository;
    private final CommerceOrderLineRepository lineRepository;
    private final CommerceOrderTenderRepository tenderRepository;
    private final CommerceOrderLegacyRepository legacyRepository;
    private final CommerceShipmentLineRepository shipmentLineRepository;
    private final CommercePieceRepository pieceRepository;
    private final StockVariantRepository variantRepository;
    private final StockHoldService stockHoldService;
    private final CommerceStaffOrderService staffOrders;
    private final CommerceAuditService auditService;
    private final CommerceRequestGuard requestGuard;

    public CommerceLineCancelService(CommerceOrderDeskService desk, CommerceOrderRepository orderRepository,
                                     CommerceOrderLineRepository lineRepository,
                                     CommerceOrderTenderRepository tenderRepository,
                                     CommerceOrderLegacyRepository legacyRepository,
                                     CommerceShipmentLineRepository shipmentLineRepository,
                                     CommercePieceRepository pieceRepository, StockVariantRepository variantRepository,
                                     StockHoldService stockHoldService, CommerceStaffOrderService staffOrders,
                                     CommerceAuditService auditService, CommerceRequestGuard requestGuard) {
        this.desk = desk;
        this.orderRepository = orderRepository;
        this.lineRepository = lineRepository;
        this.tenderRepository = tenderRepository;
        this.legacyRepository = legacyRepository;
        this.shipmentLineRepository = shipmentLineRepository;
        this.pieceRepository = pieceRepository;
        this.variantRepository = variantRepository;
        this.stockHoldService = stockHoldService;
        this.staffOrders = staffOrders;
        this.auditService = auditService;
        this.requestGuard = requestGuard;
    }

    public StaffOrderDtos.StaffOrderDetail cancelLine(CustomUserDetails user, String instituteId, String orderId,
                                                      String lineId, OrderDeskDtos.LineCancelRequest request) {
        if (request == null) {
            throw CommerceOrderDeskService.validation("the request has no body");
        }
        String key = CommerceRequestGuard.requireClientKey(request.getClientRequestId());
        if (request.getQuantity() == null || request.getQuantity() < 1) {
            throw CommerceOrderDeskService.validation("quantity is at least 1");
        }
        int quantity = request.getQuantity();
        String reason = CommerceOrderDeskService.text(request.getReason(), "reason", 200);
        if (reason == null) {
            throw CommerceOrderDeskService.validation("reason is required");
        }
        String note = CommerceOrderDeskService.text(request.getNote(), "note", CommerceOrderDeskService.MAX_TEXT);
        List<String> pieceIds = pieceIds(request.getPieceIds());
        if (!StringUtils.hasText(lineId) || lineId.trim().length() > 36) {
            throw CommerceOrderDeskService.validation("the line id is required");
        }
        String line = lineId.trim();
        CommerceOrder seen = desk.readOrder(instituteId, orderId);
        desk.authorize(user, instituteId, seen.getFulfilmentLocationId(), MANAGER);
        String actor = user.getUserId();
        CommerceRequestGuard.Outcome<String> outcome = requestGuard.run(new CommerceRequestGuard.Key(instituteId, key,
                        "LINE_CANCEL", "ORDER_LINE", line,
                        CommerceRequestGuard.hash("LINE_CANCEL", request, orderId, line), actor),
                () -> {
                    CommerceOrder order = desk.lockOrder(instituteId, orderId);
                    cancelInside(order, desk.freshLines(orderId), line, quantity, pieceIds, reason, note, actor);
                    return orderId;
                }, () -> orderId);
        return desk.detail(instituteId, orderId, user, outcome.replayed());
    }

    /** The cancel, under the order lock. */
    void cancelInside(CommerceOrder order, List<CommerceOrderLine> lines, String lineId, int quantity,
                      List<String> pieceIds, String reason, String note, String actor) {
        CommerceOrderStatus status = CommerceOrderStatus.of(order.getStatus());
        if (!CANCELLABLE.contains(status)) {
            throw new ConflictException("LINE_NOT_CANCELLABLE: a line is cancelled before the order ships; this "
                    + "order is " + order.getStatus());
        }
        CommerceOrderLine line = CommerceOrderDeskService.byId(lines, lineId);
        if (line == null || !CommerceOrderLine.TYPE_ITEM.equals(line.getLineType())) {
            throw new VacademyException(HttpStatus.NOT_FOUND, "LINE_NOT_FOUND: no such item line on this order");
        }
        int open = line.openQuantity();
        if (quantity > open) {
            throw new ConflictException("LINE_NOT_CANCELLABLE: line " + line.getLineNo() + " has " + open
                    + " unit(s) that can be cancelled");
        }
        int before = CommerceOrderDeskService.nz(line.getQtyCancelled());
        int after = before + quantity;

        VariantFacts facts = variantRepository.findFacts(order.getInstituteId(), line.getPackageSessionId())
                .orElse(null);
        boolean pieceStock = facts != null && StockMode.PIECE.name().equals(facts.getStockMode())
                && StockPolicy.TRACKED.name().equals(facts.getStockPolicy());
        boolean packed = status == CommerceOrderStatus.PACKED;
        if (!pieceIds.isEmpty() && !(packed && pieceStock)) {
            throw CommerceOrderDeskService.validation("piece_ids are named only for a packed one-of-a-kind line");
        }
        if (packed && pieceStock && pieceIds.size() != quantity) {
            throw new ConflictException("PIECE_SCAN_REQUIRED: name the " + quantity + " piece(s) of line "
                    + line.getLineNo() + " that come out of the parcel");
        }

        // 1. The units go back on sale now.
        if (desk.hasHold(line)) {
            stockHoldService.giveBackSold(line.getUserPlanId(), line.getPackageSessionId(), quantity, HOLD_REASON);
        }

        // 2. A packed parcel holds fewer units; named pieces go back on the shelf.
        if (packed) {
            unpackUnits(order, line, quantity, pieceStock, pieceIds);
        }

        // 3. What the units were worth comes off the order.
        TaxResult placement = desk.placementTax(order);
        List<TaxLineResult> taxLines = CommerceOrderRemainder.taxLinesOf(placement, line.getLineRef());
        TaxHead head = placement.getTaxHead() == null ? TaxHead.NONE : placement.getTaxHead();
        CommerceOrderRemainder.Amounts value = CommerceOrderRemainder.cancelValue(taxLines, line.getQuantity(),
                before, quantity, head);
        line.setQtyCancelled(after);
        line.setCancelledValue(CommerceOrderDeskService.nz(line.getCancelledValue()).add(value.net()));
        int stillShort = CommerceOrderDeskService.nz(line.getStockShortQty());
        line.setStockShortQty(Math.max(0, Math.min(stillShort, line.openQuantity())));
        lineRepository.save(line);
        order.setSubtotal(order.getSubtotal().subtract(value.gross()));
        order.setDiscount(order.getDiscount().subtract(value.discount()));
        order.setTax(order.getTax().subtract(value.taxAmount()));
        order.setTotal(order.getTotal().subtract(value.net()));
        if (lines.stream().noneMatch(l -> CommerceOrderDeskService.nz(l.getStockShortQty()) > 0)) {
            order.setStockShort(false);
            order.setStockShortAt(null);
        }

        // 4. The live invoice is credited for these units.
        String eventKey = "LCAN:" + line.getId() + ":" + after;
        creditUnits(order, lines, line, taxLines, quantity, eventKey, reason, actor);

        Map<String, Object> old = new LinkedHashMap<>();
        old.put("qty_cancelled", before);
        Map<String, Object> now = new LinkedHashMap<>();
        now.put("qty_cancelled", after);
        now.put("value", value.net().toPlainString());
        now.put("reason", reason);
        auditService.record(order.getInstituteId(), actor, order.getFulfilmentLocationId(), "LINE_CANCELLED",
                "ORDER_LINE", line.getId(), CommerceInputRules.json(old), CommerceInputRules.json(now), note);

        // 5. Money, or the whole order when nothing is left of it.
        boolean everyLineCancelled = CommerceOrderDeskService.items(lines).stream()
                .allMatch(l -> l.liveQuantity() <= 0);
        if (everyLineCancelled) {
            orderRepository.save(order);
            desk.cancel(order, lines, CancelReason.LINES_CANCELLED, actor, note == null ? reason : note);
            return;
        }
        if (CommerceOrderWriter.PAYMENT_PAID.equals(order.getPaymentStatus())) {
            desk.raiseRefundDue(order, value.net(), eventKey, "A line of the paid order was cancelled.");
            if (line.liveQuantity() <= 0 && StringUtils.hasText(line.getUserPlanId())) {
                legacyRepository.cancelPlans(List.of(line.getUserPlanId()));
            }
            orderRepository.save(order);
            return;
        }
        resplitUnpaid(order, lines, line, eventKey, actor);
        orderRepository.save(order);
    }

    /**
     * An order not paid in full after a line cancel: its logs carry the new total (or what was
     * already paid, when that is more), the pending tender is replaced for the new due, and a
     * cash-on-delivery order collects the new total.
     */
    void resplitUnpaid(CommerceOrder order, List<CommerceOrderLine> lines, CommerceOrderLine cancelled,
                       String eventKey, String actor) {
        BigDecimal paid = CommerceOrderDeskService.nz(order.getAmountPaid());
        BigDecimal total = order.getTotal();
        BigDecimal target = total.max(paid);
        Map<String, BigDecimal> remaining = new LinkedHashMap<>();
        for (CommerceOrderLine item : CommerceOrderDeskService.items(lines)) {
            if (item.liveQuantity() > 0 && StringUtils.hasText(item.getPaymentLogId())) {
                remaining.put(item.getId(), CommerceOrderDeskService.nz(item.getLineTotal())
                        .subtract(CommerceOrderDeskService.nz(item.getCancelledValue())));
            }
        }
        Map<String, BigDecimal> split = CommerceOrderRemainder.splitLogs(target, remaining);
        for (CommerceOrderLine item : CommerceOrderDeskService.items(lines)) {
            if (!StringUtils.hasText(item.getPaymentLogId())) {
                continue;
            }
            BigDecimal amount = split.getOrDefault(item.getId(), BigDecimal.ZERO.setScale(2));
            if (item.getLogAmount() != null && item.getLogAmount().compareTo(amount) == 0) {
                continue;
            }
            legacyRepository.setLogAmount(item.getPaymentLogId(), order.getPaymentGroupId(), amount);
            item.setLogAmount(amount);
            lineRepository.save(item);
        }
        if (cancelled.liveQuantity() <= 0 && StringUtils.hasText(cancelled.getUserPlanId())) {
            legacyRepository.cancelPlans(List.of(cancelled.getUserPlanId()));
        }

        // The pending tender (cash on delivery or credit) is replaced for the new due.
        String mode = null;
        for (CommerceOrderTender tender : tenderRepository.findByOrderIdOrderByCreatedAtAsc(order.getId())) {
            if (CommerceOrderTender.STATUS_PENDING.equals(tender.getStatus())) {
                mode = mode == null ? tender.getMode() : mode;
            }
        }
        desk.voidPendingTenders(order);
        BigDecimal due = total.subtract(paid);
        if (due.signum() > 0) {
            CommerceOrderTender pending = new CommerceOrderTender();
            pending.setInstituteId(order.getInstituteId());
            pending.setOrderId(order.getId());
            pending.setMode(mode != null ? mode : CartPriceRequest.COD.equals(order.getPaymentMethod())
                    ? CommerceOrderTender.MODE_COD : CommerceOrderTender.MODE_CREDIT);
            pending.setAmount(due);
            pending.setStatus(CommerceOrderTender.STATUS_PENDING);
            pending.setRecordedBy(actor);
            tenderRepository.save(pending);
        }
        if (CartPriceRequest.COD.equals(order.getPaymentMethod())) {
            order.setCodAmount(total);
            // A packed parcel collects the new amount too.
            desk.syncPackedCodAmount(order);
        }
        if (paid.signum() > 0 && paid.compareTo(total) >= 0) {
            // What was received already covers the smaller order: it is paid, the rest is due back.
            order.setPaymentStatus(CommerceOrderWriter.PAYMENT_PAID);
            staffOrders.settlePaid(order, lines);
            desk.raiseRefundDue(order, paid.subtract(total), eventKey, "A line of the order was cancelled after "
                    + "part of it was paid.");
        }
    }

    /** At PACKED: the parcel line holds fewer units (gone at 0) and the named pieces go back IN_STOCK. */
    private void unpackUnits(CommerceOrder order, CommerceOrderLine line, int quantity, boolean pieceStock,
                             List<String> pieceIds) {
        CommerceShipment shipment = desk.liveShipment(order);
        if (shipment == null || CommerceShipmentStatus.of(shipment.getStatus()) != CommerceShipmentStatus.PACKED) {
            throw new ConflictException(CommerceOrderDeskService.SHIPMENT_STATE_CHANGED
                    + ": the order has no packed parcel");
        }
        CommerceShipmentLine packed = null;
        for (CommerceShipmentLine row : shipmentLineRepository.findByShipmentIdOrderByCreatedAtAscIdAsc(
                shipment.getId())) {
            if (row.getOrderLineId().equals(line.getId())) {
                packed = row;
            }
        }
        if (packed == null || packed.getQuantity() < quantity) {
            throw new ConflictException(CommerceOrderDeskService.SHIPMENT_STATE_CHANGED + ": the parcel does not "
                    + "hold " + quantity + " unit(s) of line " + line.getLineNo());
        }
        if (pieceStock) {
            if (pieceIds.size() != quantity) {
                throw new ConflictException("PIECE_SCAN_REQUIRED: name the " + quantity + " piece(s) of line "
                        + line.getLineNo() + " that come out of the parcel");
            }
            for (String pieceId : pieceIds) {
                if (pieceRepository.unreserve(order.getInstituteId(), pieceId, line.getId()) != 1) {
                    throw new ConflictException("PIECE_NOT_AVAILABLE: a named piece is not packed for line "
                            + line.getLineNo());
                }
                if (pieceId.equals(line.getPieceId())) {
                    line.setPieceId(null);
                }
            }
        } else if (!pieceIds.isEmpty()) {
            throw CommerceOrderDeskService.validation("line " + line.getLineNo() + " is counted by quantity and has "
                    + "no pieces");
        }
        if (packed.getQuantity() == quantity) {
            shipmentLineRepository.delete(packed);
        } else {
            packed.setQuantity(packed.getQuantity() - quantity);
            shipmentLineRepository.save(packed);
        }
        shipmentLineRepository.flush();
    }

    /**
     * Credits {@code quantity} units of the line on the live invoice, if there is one. A set line
     * has one invoice line per part, each holding {@code units × per-unit count} of that part; the
     * per-unit count of each invoice line is read from its own quantity (never from the order of
     * the rows), so every part is credited for exactly the cancelled units.
     */
    private void creditUnits(CommerceOrder order, List<CommerceOrderLine> lines, CommerceOrderLine line,
                             List<TaxLineResult> taxLines, int quantity, String key, String reason, String actor) {
        Invoice invoice = desk.liveInvoice(order, lines);
        if (invoice == null) {
            return;
        }
        List<InvoiceLineItem> mine = new ArrayList<>();
        for (InvoiceLineItem item : desk.invoiceLines(invoice.getId())) {
            if (line.getLineRef().equals(item.getSourceId())) {
                mine.add(item);
            }
        }
        int[] per = perUnitCounts(mine, taxLines, line.getQuantity());
        List<CreditNoteLineRequest> credit = new ArrayList<>();
        for (int i = 0; i < mine.size(); i++) {
            credit.add(CreditNoteLineRequest.builder().invoiceLineItemId(mine.get(i).getId())
                    .quantity(quantity * per[i]).build());
        }
        desk.creditLines(order, lines, key, reason, actor, credit);
    }

    /**
     * How many units of each invoice line one unit of the order line is. Every invoice line of the
     * order line was issued for the same number of order-line units U, so line i holds
     * {@code U × per_i}, and Σ invoice quantities = U × Σ per of the placement tax lines. U comes
     * from those sums and {@code per_i = quantity_i / U}. A single line (the common case) is 1 per
     * unit as the tax line says. Anything that does not divide falls back to 1.
     */
    public static int[] perUnitCounts(List<InvoiceLineItem> invoiceLines, List<TaxLineResult> taxLines, int lineQuantity) {
        int[] per = new int[invoiceLines.size()];
        Arrays.fill(per, 1);
        if (invoiceLines.isEmpty() || taxLines.isEmpty()) {
            return per;
        }
        int perSum = 0;
        for (TaxLineResult taxLine : taxLines) {
            perSum += CommerceOrderRemainder.unitsPerLineUnit(taxLine, lineQuantity);
        }
        if (taxLines.size() == 1 || invoiceLines.size() != taxLines.size()) {
            // One part (or rows that do not pair up): every invoice line is the one tax line's count.
            Arrays.fill(per, taxLines.size() == 1 ? perSum : 1);
            return per;
        }
        int quantitySum = 0;
        for (InvoiceLineItem item : invoiceLines) {
            quantitySum += item.getQuantity() == null ? 0 : item.getQuantity();
        }
        if (perSum <= 0 || quantitySum <= 0 || quantitySum % perSum != 0) {
            return per;
        }
        int units = quantitySum / perSum;
        for (int i = 0; i < invoiceLines.size(); i++) {
            Integer q = invoiceLines.get(i).getQuantity();
            if (q != null && q > 0 && q % units == 0) {
                per[i] = q / units;
            }
        }
        return per;
    }

    private static List<String> pieceIds(List<String> raw) {
        Set<String> out = new LinkedHashSet<>();
        if (raw == null) {
            return List.of();
        }
        if (raw.size() > 1000) {
            throw CommerceOrderDeskService.validation("at most 1000 piece_ids");
        }
        for (String id : raw) {
            if (id == null || id.isBlank()) {
                continue;
            }
            String v = id.trim();
            if (v.length() > 36 || !out.add(v)) {
                throw CommerceOrderDeskService.validation("piece_ids are distinct ids of at most 36 characters");
            }
        }
        return new ArrayList<>(out);
    }
}
