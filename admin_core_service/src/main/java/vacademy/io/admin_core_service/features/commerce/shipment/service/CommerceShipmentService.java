package vacademy.io.admin_core_service.features.commerce.shipment.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.catalogue.enums.StockMode;
import vacademy.io.admin_core_service.features.commerce.catalogue.enums.StockPolicy;
import vacademy.io.admin_core_service.features.commerce.common.request.CommerceRequestGuard;
import vacademy.io.admin_core_service.features.commerce.document.dto.CreditNoteDTO;
import vacademy.io.admin_core_service.features.commerce.document.dto.CreditNoteLineDTO;
import vacademy.io.admin_core_service.features.commerce.document.service.DocumentClock;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceOrderWriter;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceOrderDeskService;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceOrderEvents;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceStockShortFlagger;
import vacademy.io.admin_core_service.features.commerce.order.desk.dto.OrderDeskDtos;
import vacademy.io.admin_core_service.features.commerce.order.dto.CartPriceRequest;
import vacademy.io.admin_core_service.features.commerce.order.dto.StaffOrderDtos;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrder;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderLine;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderTender;
import vacademy.io.admin_core_service.features.commerce.order.enums.CommerceOrderStatus;
import vacademy.io.admin_core_service.features.commerce.order.enums.ReturnCondition;
import vacademy.io.admin_core_service.features.commerce.order.enums.RtoReason;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderLegacyRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderLegacyRepository.HoldRow;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderLineRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderTenderRepository;
import vacademy.io.admin_core_service.features.commerce.order.service.CommerceOrderTransitions;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.admin_core_service.features.commerce.shipment.carrier.CarrierAdapter;
import vacademy.io.admin_core_service.features.commerce.shipment.carrier.ManualCarrierAdapter;
import vacademy.io.admin_core_service.features.commerce.shipment.dto.ShipmentDtos;
import vacademy.io.admin_core_service.features.commerce.shipment.entity.CommerceShipment;
import vacademy.io.admin_core_service.features.commerce.shipment.entity.CommerceShipmentLine;
import vacademy.io.admin_core_service.features.commerce.shipment.enums.CommerceShipmentStatus;
import vacademy.io.admin_core_service.features.commerce.shipment.repository.CommerceShipmentLineRepository;
import vacademy.io.admin_core_service.features.commerce.shipment.repository.CommerceShipmentRepository;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockLocation;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockMovement;
import vacademy.io.admin_core_service.features.commerce.stock.enums.LocationStatus;
import vacademy.io.admin_core_service.features.commerce.stock.enums.StockMovementType;
import vacademy.io.admin_core_service.features.commerce.stock.repository.CommercePieceRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.CommercePieceRepository.PieceRow;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLocationRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockVariantRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockVariantRepository.VariantFacts;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockLedgerService;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockPeriodGuard;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockPostResult;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockPosting;
import vacademy.io.admin_core_service.features.commerce.storefront.service.CommerceStorefrontSettings;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceInputRules;
import vacademy.io.admin_core_service.features.invoice.entity.Invoice;
import vacademy.io.admin_core_service.features.stock_hold.service.StockHoldService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;

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

/**
 * Pack, ship, deliver, RTO and RTO received (rows 4, 7, 9, 11 and 12 of the order desk table),
 * the tracking correction, and the hand-over of a staff order.
 *
 * <p><b>Pack</b> sets pieces aside (RESERVED for the line) and issues the invoice in the same
 * transaction; no stock moves. <b>Ship</b> is where stock leaves: one SALE movement per shipment
 * line (per piece for one-of-a-kind stock) at the shipment's location, keyed with the ship
 * count so a ship after an undo posts again, and the line's SOLD hold closed in the same
 * transaction (the reconciliation counts open SOLD holds as sold and not shipped). A ship the
 * ledger refuses rolls back whole, and the order is then flagged stock short in a transaction of
 * its own. <b>RTO</b> moves no stock (the unit is in a van, not on a shelf); <b>RTO received</b>
 * posts a RETURN per unit and, for a damaged unit, a DAMAGE after it.
 *
 * <p>Pack and ship need the order's fulfilment location to be active and to sell online: the
 * order's holds took the online counters, so a SALE anywhere else would break them.
 */
@Slf4j
@Service
public class CommerceShipmentService {

    public static final String REASON_DAMAGED_IN_TRANSIT = "DAMAGED_IN_TRANSIT";
    static final Set<CommerceRole> FLOOR = Set.of(CommerceRole.STORE_MANAGER, CommerceRole.WAREHOUSE_STAFF);
    static final int MAX_LINES = 50;
    private static final ZoneId INDIA = ZoneId.of("Asia/Kolkata");

    private final CommerceOrderDeskService desk;
    private final CommerceOrderRepository orderRepository;
    private final CommerceOrderLineRepository lineRepository;
    private final CommerceOrderTenderRepository tenderRepository;
    private final CommerceOrderLegacyRepository legacyRepository;
    private final CommerceOrderWriter writer;
    private final CommerceShipmentRepository shipmentRepository;
    private final CommerceShipmentLineRepository shipmentLineRepository;
    private final CommercePieceRepository pieceRepository;
    private final StockVariantRepository variantRepository;
    private final StockLocationRepository locationRepository;
    private final StockLedgerService ledger;
    private final StockHoldService stockHoldService;
    private final CommerceAuditService auditService;
    private final CommerceOrderEvents events;
    private final CommerceRequestGuard requestGuard;
    private final CommerceStockShortFlagger stockShortFlagger;
    private final CommerceStorefrontSettings storefrontSettings;
    private final ManualCarrierAdapter manualCarrier;
    private final DocumentClock clock;
    private final ObjectProvider<StockPeriodGuard> periodGuard;
    private final TransactionTemplate ownTransaction;

    public CommerceShipmentService(CommerceOrderDeskService desk,
                                   CommerceOrderRepository orderRepository,
                                   CommerceOrderLineRepository lineRepository,
                                   CommerceOrderTenderRepository tenderRepository,
                                   CommerceOrderLegacyRepository legacyRepository,
                                   CommerceOrderWriter writer,
                                   CommerceShipmentRepository shipmentRepository,
                                   CommerceShipmentLineRepository shipmentLineRepository,
                                   CommercePieceRepository pieceRepository,
                                   StockVariantRepository variantRepository,
                                   StockLocationRepository locationRepository,
                                   StockLedgerService ledger,
                                   StockHoldService stockHoldService,
                                   CommerceAuditService auditService,
                                   CommerceOrderEvents events,
                                   CommerceRequestGuard requestGuard,
                                   CommerceStockShortFlagger stockShortFlagger,
                                   CommerceStorefrontSettings storefrontSettings,
                                   ManualCarrierAdapter manualCarrier,
                                   DocumentClock clock,
                                   ObjectProvider<StockPeriodGuard> periodGuard,
                                   PlatformTransactionManager transactionManager) {
        this.desk = desk;
        this.orderRepository = orderRepository;
        this.lineRepository = lineRepository;
        this.tenderRepository = tenderRepository;
        this.legacyRepository = legacyRepository;
        this.writer = writer;
        this.shipmentRepository = shipmentRepository;
        this.shipmentLineRepository = shipmentLineRepository;
        this.pieceRepository = pieceRepository;
        this.variantRepository = variantRepository;
        this.locationRepository = locationRepository;
        this.ledger = ledger;
        this.stockHoldService = stockHoldService;
        this.auditService = auditService;
        this.events = events;
        this.requestGuard = requestGuard;
        this.stockShortFlagger = stockShortFlagger;
        this.storefrontSettings = storefrontSettings;
        this.manualCarrier = manualCarrier;
        this.clock = clock;
        this.periodGuard = periodGuard;
        this.ownTransaction = new TransactionTemplate(transactionManager);
        this.ownTransaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    /** One line to pack: the units and, for one-of-a-kind stock, the pieces (ids or scan codes). */
    public record PackLine(int quantity, List<String> pieceIds, List<String> pieceCodes) {
    }

    // ================================================================== routes

    /** {@code POST /shipments}: row 4. */
    public StaffOrderDtos.StaffOrderDetail pack(CustomUserDetails user, String instituteId,
                                                ShipmentDtos.PackRequest request) {
        if (request == null) {
            throw validation("the request has no body");
        }
        String key = CommerceRequestGuard.requireClientKey(request.getClientRequestId());
        String orderId = required(request.getOrderId(), "order_id");
        CommerceOrderStatus from = fromStatus(request.getFromStatus());
        if (request.getLines() == null || request.getLines().isEmpty() || request.getLines().size() > MAX_LINES) {
            throw validation("lines holds 1 to " + MAX_LINES + " order lines");
        }
        Map<String, PackLine> named = new LinkedHashMap<>();
        for (ShipmentDtos.PackLine line : request.getLines()) {
            if (line == null || !StringUtils.hasText(line.getOrderLineId()) || line.getQuantity() == null
                    || line.getQuantity() < 1) {
                throw validation("every line names an order_line_id and a quantity of at least 1");
            }
            if (named.put(line.getOrderLineId().trim(), new PackLine(line.getQuantity(), clean(line.getPieceIds()),
                    clean(line.getPieceCodes()))) != null) {
                throw validation("an order line is named twice");
            }
        }
        Integer weight = weight(request.getWeightGrams());
        CommerceOrder seen = desk.readOrder(instituteId, orderId);
        desk.authorize(user, instituteId, seen.getFulfilmentLocationId(), FLOOR);
        String actor = user.getUserId();
        CommerceRequestGuard.Outcome<String> outcome = requestGuard.run(new CommerceRequestGuard.Key(instituteId, key,
                        "SHIPMENT_PACK", "ORDER", orderId, CommerceRequestGuard.hash("SHIPMENT_PACK", request), actor),
                () -> {
                    CommerceOrder order = desk.lockOrder(instituteId, orderId);
                    requirePackFrom(order, from);
                    packInside(order, desk.freshLines(orderId), named, weight, actor);
                    return orderId;
                }, () -> orderId);
        return desk.detail(instituteId, orderId, user, outcome.replayed());
    }

    /** Bulk PACK: every open line at its open quantity; one-of-a-kind stock must be scanned on the order. */
    public void packAll(CustomUserDetails user, String instituteId, String orderId, String itemKey, String fromStatus) {
        CommerceOrderStatus from = fromStatus(fromStatus);
        CommerceOrder seen = desk.readOrder(instituteId, orderId);
        desk.authorize(user, instituteId, seen.getFulfilmentLocationId(), FLOOR);
        Map<String, Object> body = Map.of("action", "PACK", "from_status", from.name());
        requestGuard.run(new CommerceRequestGuard.Key(instituteId, itemKey, "SHIPMENT_PACK", "ORDER", orderId,
                        CommerceRequestGuard.hash("SHIPMENT_PACK", body, orderId), user.getUserId()),
                () -> {
                    CommerceOrder order = desk.lockOrder(instituteId, orderId);
                    requirePackFrom(order, from);
                    List<CommerceOrderLine> lines = desk.freshLines(orderId);
                    packInside(order, lines, openLines(order, lines), null, user.getUserId());
                    return orderId;
                }, () -> orderId);
    }

    /** {@code POST /shipments/{id}/ship}: row 7. */
    public StaffOrderDtos.StaffOrderDetail ship(CustomUserDetails user, String instituteId, String shipmentId,
                                                ShipmentDtos.ShipRequest request) {
        if (request == null) {
            throw validation("the request has no body");
        }
        String key = CommerceRequestGuard.requireClientKey(request.getClientRequestId());
        CarrierAdapter.Booked booked = manualCarrier.book(new CarrierAdapter.Booking(request.getCarrierName(),
                request.getTrackingNumber(), request.getTrackingUrl(), request.getWeightGrams()));
        Integer weight = weight(request.getWeightGrams());
        boolean notify = request.getNotifyCustomer() == null || request.getNotifyCustomer();
        CommerceShipment seen = readShipment(instituteId, shipmentId);
        desk.authorize(user, instituteId, seen.getLocationId(), FLOOR);
        String orderId = seen.getOrderId();
        String actor = user.getUserId();
        CommerceRequestGuard.Outcome<String> outcome = runShip(instituteId, orderId, () -> requestGuard.run(
                new CommerceRequestGuard.Key(instituteId, key, "SHIPMENT_SHIP", "SHIPMENT", shipmentId,
                        CommerceRequestGuard.hash("SHIPMENT_SHIP", request, shipmentId), actor),
                () -> {
                    CommerceOrder order = desk.lockOrder(instituteId, orderId);
                    CommerceShipment shipment = desk.lockShipment(instituteId, shipmentId);
                    shipInside(order, desk.freshLines(orderId), shipment, booked, weight, actor, notify);
                    return orderId;
                }, () -> orderId));
        return desk.detail(instituteId, orderId, user, outcome.replayed());
    }

    /** Bulk SHIP: the order's packed parcel with the courier and tracking of the item. */
    public void shipOrder(CustomUserDetails user, String instituteId, String orderId, String itemKey,
                          OrderDeskDtos.BulkItem item) {
        CommerceOrderStatus from = fromStatus(item.getFromStatus());
        CarrierAdapter.Booked booked = manualCarrier.book(new CarrierAdapter.Booking(item.getCarrierName(),
                item.getTrackingNumber(), item.getTrackingUrl(), null));
        CommerceOrder seen = desk.readOrder(instituteId, orderId);
        desk.authorize(user, instituteId, seen.getFulfilmentLocationId(), FLOOR);
        runShip(instituteId, orderId, () -> requestGuard.run(new CommerceRequestGuard.Key(instituteId, itemKey,
                        "SHIPMENT_SHIP", "ORDER", orderId, CommerceRequestGuard.hash("SHIPMENT_SHIP", item, orderId),
                        user.getUserId()),
                () -> {
                    CommerceOrder order = desk.lockOrder(instituteId, orderId);
                    CommerceOrderDeskService.requireStatus(order, from);
                    CommerceShipment shipment = desk.liveShipment(order);
                    if (shipment == null) {
                        throw new ConflictException(CommerceOrderDeskService.SHIPMENT_STATE_CHANGED
                                + ": the order has no packed parcel");
                    }
                    shipInside(order, desk.freshLines(orderId), shipment, booked, null, user.getUserId(), true);
                    return orderId;
                }, () -> orderId));
    }

    /** {@code POST /shipments/{id}/status}: rows 9, 11 and 12. */
    public StaffOrderDtos.StaffOrderDetail status(CustomUserDetails user, String instituteId, String shipmentId,
                                                  ShipmentDtos.StatusRequest request) {
        if (request == null) {
            throw validation("the request has no body");
        }
        String key = CommerceRequestGuard.requireClientKey(request.getClientRequestId());
        CommerceShipmentStatus to = CommerceShipmentStatus.of(request.getTo() == null ? null
                : request.getTo().trim().toUpperCase(Locale.ROOT));
        if (to != CommerceShipmentStatus.DELIVERED && to != CommerceShipmentStatus.RTO
                && to != CommerceShipmentStatus.RTO_RECEIVED) {
            throw validation("to is DELIVERED, RTO or RTO_RECEIVED");
        }
        String note = text(request.getNote(), "note", 500);
        RtoReason rtoReason = null;
        if (to == CommerceShipmentStatus.RTO) {
            rtoReason = RtoReason.of(request.getRtoReason());
            if (rtoReason == null) {
                throw validation("rto_reason is REFUSED, UNREACHABLE, ADDRESS_ISSUE, DAMAGED or OTHER");
            }
        }
        CommerceShipment seen = readShipment(instituteId, shipmentId);
        desk.authorize(user, instituteId, seen.getLocationId(), FLOOR);
        String orderId = seen.getOrderId();
        String actor = user.getUserId();
        RtoReason reason = rtoReason;
        CommerceRequestGuard.Outcome<String> outcome = requestGuard.run(new CommerceRequestGuard.Key(instituteId, key,
                        "SHIPMENT_" + to.name(), "SHIPMENT", shipmentId,
                        CommerceRequestGuard.hash("SHIPMENT_STATUS", request, shipmentId), actor),
                () -> {
                    CommerceOrder order = desk.lockOrder(instituteId, orderId);
                    CommerceShipment shipment = desk.lockShipment(instituteId, shipmentId);
                    List<CommerceOrderLine> lines = desk.freshLines(orderId);
                    switch (to) {
                        case DELIVERED -> deliverInside(order, shipment, request.getDeliveredOn(), actor, note);
                        case RTO -> rtoInside(order, lines, shipment, reason, actor, note);
                        default -> rtoReceivedInside(order, lines, shipment, request.getLines(), actor, note);
                    }
                    return orderId;
                }, () -> orderId);
        return desk.detail(instituteId, orderId, user, outcome.replayed());
    }

    /** Bulk DELIVER. */
    public void deliverOrder(CustomUserDetails user, String instituteId, String orderId, String itemKey,
                             OrderDeskDtos.BulkItem item) {
        CommerceOrderStatus from = fromStatus(item.getFromStatus());
        CommerceOrder seen = desk.readOrder(instituteId, orderId);
        desk.authorize(user, instituteId, seen.getFulfilmentLocationId(), FLOOR);
        requestGuard.run(new CommerceRequestGuard.Key(instituteId, itemKey, "SHIPMENT_DELIVERED", "ORDER", orderId,
                        CommerceRequestGuard.hash("SHIPMENT_DELIVERED", item, orderId), user.getUserId()),
                () -> {
                    CommerceOrder order = desk.lockOrder(instituteId, orderId);
                    CommerceOrderDeskService.requireStatus(order, from);
                    CommerceShipment shipment = desk.liveShipment(order);
                    if (shipment == null) {
                        throw new ConflictException(CommerceOrderDeskService.SHIPMENT_STATE_CHANGED
                                + ": the order has no parcel in transit");
                    }
                    deliverInside(order, shipment, item.getDeliveredOn(), user.getUserId(), null);
                    return orderId;
                }, () -> orderId);
    }

    /** {@code PATCH /shipments/{id}}: courier or tracking of a parcel in transit. */
    public StaffOrderDtos.StaffOrderDetail patch(CustomUserDetails user, String instituteId, String shipmentId,
                                                 ShipmentDtos.PatchRequest request) {
        if (request == null) {
            throw validation("the request has no body");
        }
        String key = CommerceRequestGuard.requireClientKey(request.getClientRequestId());
        String carrierName = ManualCarrierAdapter.carrierName(request.getCarrierName(), false);
        String tracking = ManualCarrierAdapter.trackingNumber(request.getTrackingNumber(), false);
        String url = ManualCarrierAdapter.trackingUrl(request.getTrackingUrl());
        if (carrierName == null && tracking == null && url == null) {
            throw validation("name carrier_name, tracking_number or tracking_url");
        }
        CommerceShipment seen = readShipment(instituteId, shipmentId);
        desk.authorize(user, instituteId, seen.getLocationId(), FLOOR);
        String orderId = seen.getOrderId();
        String actor = user.getUserId();
        CommerceRequestGuard.Outcome<String> outcome = requestGuard.run(new CommerceRequestGuard.Key(instituteId, key,
                        "SHIPMENT_TRACKING", "SHIPMENT", shipmentId,
                        CommerceRequestGuard.hash("SHIPMENT_TRACKING", request, shipmentId), actor),
                () -> {
                    desk.lockOrder(instituteId, orderId);
                    CommerceShipment shipment = desk.lockShipment(instituteId, shipmentId);
                    if (CommerceShipmentStatus.of(shipment.getStatus()) != CommerceShipmentStatus.SHIPPED) {
                        throw new ConflictException(CommerceOrderDeskService.SHIPMENT_STATE_CHANGED
                                + ": tracking is edited while the parcel is in transit");
                    }
                    Map<String, Object> old = new LinkedHashMap<>();
                    old.put("carrier_name", shipment.getCarrierName());
                    old.put("tracking_number", shipment.getTrackingNumber());
                    old.put("tracking_url", shipment.getTrackingUrl());
                    if (carrierName != null) {
                        shipment.setCarrierName(carrierName);
                    }
                    if (tracking != null) {
                        shipment.setTrackingNumber(tracking);
                    }
                    if (url != null) {
                        shipment.setTrackingUrl(url);
                    }
                    shipmentRepository.save(shipment);
                    Map<String, Object> now = new LinkedHashMap<>();
                    now.put("carrier_name", shipment.getCarrierName());
                    now.put("tracking_number", shipment.getTrackingNumber());
                    now.put("tracking_url", shipment.getTrackingUrl());
                    auditService.record(instituteId, actor, shipment.getLocationId(), "TRACKING_EDITED", "SHIPMENT",
                            shipmentId, CommerceInputRules.json(old), CommerceInputRules.json(now), null);
                    return orderId;
                }, () -> orderId);
        return desk.detail(instituteId, orderId, user, outcome.replayed());
    }

    // ================================================================== steps (inside the order lock)

    /**
     * Row 4. Every open item line must be named at its open quantity; one-of-a-kind stock names
     * its pieces, which become RESERVED for the line. The invoice is issued here.
     */
    public CommerceShipment packInside(CommerceOrder order, List<CommerceOrderLine> lines,
                                       Map<String, PackLine> named, Integer weightGrams, String actor) {
        requireOrderStatus(order, CommerceOrderStatus.CONFIRMED, CommerceOrderStatus.PACKED);
        String locationId = requireOnlineLocation(order);
        List<CommerceOrderLine> open = new ArrayList<>();
        for (CommerceOrderLine line : CommerceOrderDeskService.items(lines)) {
            if (line.openQuantity() > 0) {
                open.add(line);
            }
        }
        for (String lineId : named.keySet()) {
            CommerceOrderLine line = CommerceOrderDeskService.byId(lines, lineId);
            if (line == null || !CommerceOrderLine.TYPE_ITEM.equals(line.getLineType())) {
                throw validation("order_line_id " + lineId + " is not an item line of this order");
            }
        }
        if (open.isEmpty()) {
            throw new ConflictException("NOT_FULLY_PACKED: the order has nothing left to pack");
        }
        for (CommerceOrderLine line : open) {
            PackLine asked = named.get(line.getId());
            if (asked == null || asked.quantity() != line.openQuantity()) {
                throw new ConflictException("NOT_FULLY_PACKED: line " + line.getLineNo() + " needs "
                        + line.openQuantity() + " unit(s) packed");
            }
        }
        for (String lineId : named.keySet()) {
            if (CommerceOrderDeskService.byId(open, lineId) == null) {
                throw new ConflictException("NOT_FULLY_PACKED: line " + lineId + " has nothing left to pack");
            }
        }
        Date now = new Date();
        CommerceShipment shipment = new CommerceShipment();
        shipment.setInstituteId(order.getInstituteId());
        shipment.setOrderId(order.getId());
        shipment.setLocationId(locationId);
        shipment.setCarrierCode(CommerceShipment.CARRIER_MANUAL);
        shipment.setStatus(CommerceShipmentStatus.PACKED.name());
        shipment.setShipCount(0);
        shipment.setWeightGrams(weightGrams);
        shipment.setPackedAt(now);
        shipment.setPackedBy(actor);
        if (CartPriceRequest.COD.equals(order.getPaymentMethod())) {
            shipment.setCodAmount(order.getCodAmount());
        }
        shipment = shipmentRepository.saveAndFlush(shipment);

        List<CommerceShipmentLine> shipmentLines = new ArrayList<>();
        for (CommerceOrderLine line : open) {
            CommerceShipmentLine row = new CommerceShipmentLine();
            row.setInstituteId(order.getInstituteId());
            row.setShipmentId(shipment.getId());
            row.setOrderLineId(line.getId());
            row.setQuantity(line.openQuantity());
            shipmentLines.add(row);
        }
        shipmentLineRepository.saveAllAndFlush(shipmentLines);

        for (CommerceOrderLine line : open) {
            VariantFacts facts = facts(order, line);
            requireSettled(order, line, facts, line.openQuantity());
            PackLine asked = named.get(line.getId());
            boolean pieceStock = facts != null && StockMode.PIECE.name().equals(facts.getStockMode())
                    && StockPolicy.TRACKED.name().equals(facts.getStockPolicy());
            if (!pieceStock) {
                if (!asked.pieceIds().isEmpty() || !asked.pieceCodes().isEmpty()) {
                    throw validation("line " + line.getLineNo() + " is counted by quantity and has no pieces");
                }
                continue;
            }
            List<String> pieces = resolvePieces(order, line, asked);
            if (pieces.size() != line.openQuantity()) {
                throw new ConflictException("PIECE_SCAN_REQUIRED: line " + line.getLineNo() + " needs "
                        + line.openQuantity() + " piece(s) scanned");
            }
            for (String pieceId : pieces) {
                if (pieceRepository.reserveForLine(order.getInstituteId(), pieceId, locationId, line.getId()) != 1) {
                    throw new ConflictException("PIECE_NOT_AVAILABLE: a piece of line " + line.getLineNo()
                            + " is not in stock at the shipping location");
                }
            }
            if (line.getQuantity() == 1 && pieces.size() == 1) {
                line.setPieceId(pieces.get(0));
                lineRepository.save(line);
            }
        }

        // The pack fails whole when the invoice cannot be issued (tax not set up, stale seller).
        Invoice invoice = desk.issueInvoice(order, lines, actor);
        shipment.setInvoiceId(invoice.getId());
        shipmentRepository.save(shipment);

        CommerceOrderStatus from = CommerceOrderStatus.of(order.getStatus());
        order.setStatus(CommerceOrderStatus.PACKED.name());
        order.setPackedAt(now);
        orderRepository.save(order);
        writer.history(order, from, CommerceOrderStatus.PACKED, actor, "Packed; invoice " + invoice.getInvoiceNumber());
        return shipment;
    }

    /**
     * Row 7. Stock leaves: SALE movements, holds closed, cost of the goods worked out from the
     * SALE rows. The order's stock-short flag is cleared.
     */
    public void shipInside(CommerceOrder order, List<CommerceOrderLine> lines, CommerceShipment shipment,
                           CarrierAdapter.Booked booked, Integer weightGrams, String actor, boolean notify) {
        if (CommerceShipmentStatus.of(shipment.getStatus()) != CommerceShipmentStatus.PACKED
                || !shipment.getOrderId().equals(order.getId())) {
            throw new ConflictException(CommerceOrderDeskService.SHIPMENT_STATE_CHANGED + ": the parcel is "
                    + shipment.getStatus() + ", not PACKED");
        }
        requireOrderStatus(order, CommerceOrderStatus.PACKED, CommerceOrderStatus.SHIPPED);
        requireOnlineLocation(order);
        requirePeriodOpen(order.getInstituteId());
        int shipCount = shipment.getShipCount() == null ? 1 : shipment.getShipCount() + 1;
        List<CommerceShipmentLine> shipped = shipmentLineRepository.findByShipmentIdOrderByCreatedAtAscIdAsc(
                shipment.getId());
        List<StockPosting> postings = new ArrayList<>();
        Map<String, Boolean> tracked = new HashMap<>();
        for (CommerceShipmentLine row : shipped) {
            CommerceOrderLine line = CommerceOrderDeskService.byId(lines, row.getOrderLineId());
            VariantFacts facts = facts(order, line);
            boolean isTracked = facts != null && StockPolicy.TRACKED.name().equals(facts.getStockPolicy());
            tracked.put(row.getId(), isTracked);
            if (!isTracked) {
                continue;
            }
            requireSettled(order, line, facts, row.getQuantity());
            StockPosting.StockPostingBuilder base = StockPosting.builder()
                    .instituteId(order.getInstituteId())
                    .locationId(shipment.getLocationId())
                    .packageSessionId(line.getPackageSessionId())
                    .type(StockMovementType.SALE)
                    .referenceType(CommerceOrderDeskService.REFERENCE_SHIPMENT_LINE)
                    .referenceId(row.getId())
                    .actorUserId(actor);
            if (StockMode.PIECE.name().equals(facts.getStockMode())) {
                List<PieceRow> pieces = pieceRepository.findRowsByOrderLine(order.getInstituteId(), line.getId())
                        .stream().filter(p -> "RESERVED".equals(p.getStatus())).toList();
                if (pieces.size() != row.getQuantity()) {
                    throw new ConflictException("PIECE_STATE: line " + line.getLineNo() + " has " + pieces.size()
                            + " piece(s) packed, not " + row.getQuantity());
                }
                for (PieceRow piece : pieces) {
                    postings.add(base.pieceId(piece.getId()).quantityDelta(-1)
                            .idempotencyKey("SALE:" + row.getId() + ":" + piece.getId() + ":" + shipCount).build());
                }
            } else {
                postings.add(base.quantityDelta(-row.getQuantity())
                        .idempotencyKey("SALE:" + row.getId() + ":" + shipCount).build());
            }
        }
        List<StockPostResult> results = ledger.postAll(postings);

        Map<String, BigDecimal> cost = new HashMap<>();
        Set<String> costUnknown = new LinkedHashSet<>();
        for (StockPostResult result : results) {
            StockMovement movement = result.movement();
            if (movement == null) {
                continue;
            }
            String rowId = movement.getReferenceId();
            if (movement.getUnitCost() == null) {
                costUnknown.add(rowId);
                continue;
            }
            cost.merge(rowId, movement.getUnitCost().multiply(BigDecimal.valueOf(-movement.getQuantityDelta())),
                    BigDecimal::add);
        }
        for (CommerceShipmentLine row : shipped) {
            CommerceOrderLine line = CommerceOrderDeskService.byId(lines, row.getOrderLineId());
            if (Boolean.TRUE.equals(tracked.get(row.getId()))) {
                stockHoldService.closeWithoutGiveBack(line.getUserPlanId(), line.getPackageSessionId(),
                        StockHoldService.REASON_SHIPPED);
            }
            line.setQtyShipped(line.getQtyShipped() + row.getQuantity());
            BigDecimal lineCost = cost.get(row.getId());
            line.setCostTotal(costUnknown.contains(row.getId()) || lineCost == null ? null
                    : lineCost.setScale(2, RoundingMode.HALF_UP));
            lineRepository.save(line);
        }

        Date now = new Date();
        shipment.setShipCount(shipCount);
        shipment.setCarrierCode(booked.carrierCode());
        shipment.setCarrierName(booked.carrierName());
        shipment.setTrackingNumber(booked.trackingNumber());
        shipment.setTrackingUrl(booked.trackingUrl());
        shipment.setCarrierPayloadJson(booked.payloadJson());
        if (weightGrams != null) {
            shipment.setWeightGrams(weightGrams);
        }
        shipment.setStatus(CommerceShipmentStatus.SHIPPED.name());
        shipment.setShippedAt(now);
        shipment.setShippedBy(actor);
        shipmentRepository.save(shipment);

        CommerceOrderStatus from = CommerceOrderStatus.of(order.getStatus());
        order.setStatus(CommerceOrderStatus.SHIPPED.name());
        order.setShippedAt(now);
        desk.clearShort(order, lines);
        orderRepository.save(order);
        writer.history(order, from, CommerceOrderStatus.SHIPPED, actor,
                "Shipped" + (booked.carrierName() == null ? "" : " with " + booked.carrierName())
                        + (booked.trackingNumber() == null ? "" : ", tracking " + booked.trackingNumber()));
        events.afterCommit(desk.event(CommerceOrderEvents.ORDER_SHIPPED, order, shipment.getId(), notify));
    }

    /** Row 9. {@code deliveredOn} defaults to today; it is not after today nor before the ship date. */
    public void deliverInside(CommerceOrder order, CommerceShipment shipment, LocalDate deliveredOn, String actor,
                              String note) {
        requireShipment(order, shipment, CommerceShipmentStatus.SHIPPED);
        requireOrderStatus(order, CommerceOrderStatus.SHIPPED, CommerceOrderStatus.DELIVERED);
        LocalDate today = clock.today(order.getInstituteId());
        LocalDate day = deliveredOn == null ? today : deliveredOn;
        if (day.isAfter(today)) {
            throw validation("delivered_on cannot be after today");
        }
        if (shipment.getShippedAt() != null && day.isBefore(shipment.getShippedAt().toInstant().atZone(INDIA)
                .toLocalDate())) {
            throw validation("delivered_on cannot be before the parcel was shipped");
        }
        Date now = new Date();
        shipment.setStatus(CommerceShipmentStatus.DELIVERED.name());
        shipment.setDeliveredOn(day);
        shipment.setDeliveredAt(now);
        shipment.setDeliveredBy(actor);
        shipmentRepository.save(shipment);
        CommerceOrderStatus from = CommerceOrderStatus.of(order.getStatus());
        order.setStatus(CommerceOrderStatus.DELIVERED.name());
        order.setDeliveredAt(now);
        orderRepository.save(order);
        writer.history(order, from, CommerceOrderStatus.DELIVERED, actor,
                "Delivered on " + day + (note == null ? "" : ": " + note));
        events.afterCommit(desk.event(CommerceOrderEvents.ORDER_DELIVERED, order, shipment.getId(), true));
    }

    /**
     * Row 11. The parcel is coming back. No stock moves (the holds closed at ship). A COD order:
     * its pending COD tender is voided, its unpaid plans cancelled, and the phone gets one more
     * refusal. The invoice is credited in full; its lines carry the cost of the goods.
     */
    public void rtoInside(CommerceOrder order, List<CommerceOrderLine> lines, CommerceShipment shipment,
                          RtoReason reason, String actor, String note) {
        requireShipment(order, shipment, CommerceShipmentStatus.SHIPPED);
        requireOrderStatus(order, CommerceOrderStatus.SHIPPED, CommerceOrderStatus.RTO);
        boolean cod = CartPriceRequest.COD.equals(order.getPaymentMethod());
        if (cod) {
            for (CommerceOrderTender tender : tenderRepository.findByOrderIdOrderByCreatedAtAsc(order.getId())) {
                if (CommerceOrderTender.MODE_COD.equals(tender.getMode())
                        && CommerceOrderTender.STATUS_PENDING.equals(tender.getStatus())
                        && tenderRepository.settleOne(tender.getId(), CommerceOrderTender.STATUS_VOID, null, null) == 1) {
                    String instituteId = order.getInstituteId();
                    String orderId = order.getId();
                    String tenderId = tender.getId();
                    BigDecimal amount = tender.getAmount();
                    desk.afterCommitMoney(hook -> hook.tenderVoided(instituteId, orderId, tenderId,
                            CommerceOrderTender.MODE_COD, amount));
                }
            }
            List<String> planIds = new ArrayList<>();
            for (CommerceOrderLine line : lines) {
                if (StringUtils.hasText(line.getUserPlanId())) {
                    planIds.add(line.getUserPlanId());
                }
            }
            if (!planIds.isEmpty() && !"PAID".equals(order.getPaymentStatus())) {
                legacyRepository.cancelPendingPlans(planIds);
            }
            if (StringUtils.hasText(order.getCustomerPhone())) {
                orderRepository.incrementCodRefusals(order.getInstituteId(), order.getCustomerPhone());
            }
        }
        CreditNoteDTO note2 = desk.creditRest(order, lines, "RTO:" + shipment.getId(), "Returned to sender", actor);
        desk.setCreditCosts(order.getInstituteId(), note2, costsByInvoiceLine(order, lines, note2));
        Date now = new Date();
        shipment.setStatus(CommerceShipmentStatus.RTO.name());
        shipment.setRtoReason(reason.name());
        shipment.setRtoAt(now);
        shipment.setRtoBy(actor);
        if (note != null) {
            shipment.setNote(note);
        }
        shipmentRepository.save(shipment);
        CommerceOrderStatus from = CommerceOrderStatus.of(order.getStatus());
        order.setStatus(CommerceOrderStatus.RTO.name());
        orderRepository.save(order);
        writer.history(order, from, CommerceOrderStatus.RTO, actor, "Returned to sender: " + reason.name()
                + (note == null ? "" : ": " + note));
        events.afterCommit(desk.event(CommerceOrderEvents.ORDER_RTO, order, shipment.getId(), true));
    }

    /**
     * Row 12. Every shipped unit is named with its condition. A resaleable unit comes back on
     * sale (RETURN at the shipment's location, at the cost the SALE took it out at); a damaged one
     * comes back and is written off at once (RETURN then DAMAGE, reason DAMAGED_IN_TRANSIT). A
     * paid prepaid order records the money due back (less the delivery charge when the shop keeps
     * it). The order stays RTO.
     */
    public void rtoReceivedInside(CommerceOrder order, List<CommerceOrderLine> lines, CommerceShipment shipment,
                                  List<ShipmentDtos.StatusLine> named, String actor, String note) {
        requireShipment(order, shipment, CommerceShipmentStatus.RTO);
        if (CommerceOrderStatus.of(order.getStatus()) != CommerceOrderStatus.RTO) {
            throw new ConflictException(CommerceOrderDeskService.ORDER_STATE_CHANGED + ": the order is "
                    + order.getStatus() + ", not RTO");
        }
        requirePeriodOpen(order.getInstituteId());
        List<CommerceShipmentLine> shipped = shipmentLineRepository.findByShipmentIdOrderByCreatedAtAscIdAsc(
                shipment.getId());
        if (named == null || named.isEmpty()) {
            throw new InvalidRequestException("RTO_LINES_INCOMPLETE: name every shipped unit with its condition");
        }
        Map<String, int[]> counted = new HashMap<>();
        Map<String, Set<String>> damagedPieces = new HashMap<>();
        Map<String, Set<String>> allPieces = new HashMap<>();
        for (ShipmentDtos.StatusLine line : named) {
            if (line == null || !StringUtils.hasText(line.getOrderLineId()) || line.getQuantity() == null
                    || line.getQuantity() < 1) {
                throw validation("every line names an order_line_id, a condition and a quantity of at least 1");
            }
            ReturnCondition condition = ReturnCondition.of(line.getCondition());
            if (condition == null) {
                throw validation("condition is RESALEABLE or DAMAGED");
            }
            String lineId = line.getOrderLineId().trim();
            if (shipped.stream().noneMatch(row -> row.getOrderLineId().equals(lineId))) {
                throw validation("order_line_id " + lineId + " is not in this parcel");
            }
            int[] count = counted.computeIfAbsent(lineId, k -> new int[2]);
            count[condition == ReturnCondition.DAMAGED ? 1 : 0] += line.getQuantity();
            for (String pieceId : clean(line.getPieceIds())) {
                if (!allPieces.computeIfAbsent(lineId, k -> new LinkedHashSet<>()).add(pieceId)) {
                    throw validation("a piece is named twice");
                }
                if (condition == ReturnCondition.DAMAGED) {
                    damagedPieces.computeIfAbsent(lineId, k -> new LinkedHashSet<>()).add(pieceId);
                }
            }
        }
        for (CommerceShipmentLine row : shipped) {
            int[] count = counted.getOrDefault(row.getOrderLineId(), new int[2]);
            if (count[0] + count[1] != row.getQuantity()) {
                throw new InvalidRequestException("RTO_LINES_INCOMPLETE: the parcel has " + row.getQuantity()
                        + " unit(s) of a line and " + (count[0] + count[1]) + " were named");
            }
        }

        List<StockMovement> sales = desk.currentSales(order.getInstituteId(), shipment, shipped);
        List<StockPosting> postings = new ArrayList<>();
        Map<String, Object> audit = new LinkedHashMap<>();
        for (CommerceShipmentLine row : shipped) {
            CommerceOrderLine line = CommerceOrderDeskService.byId(lines, row.getOrderLineId());
            VariantFacts facts = facts(order, line);
            int[] count = counted.get(row.getOrderLineId());
            audit.put(row.getOrderLineId(), Map.of("resaleable", count[0], "damaged", count[1]));
            if (facts == null || !StockPolicy.TRACKED.name().equals(facts.getStockPolicy())) {
                continue;
            }
            StockPosting.StockPostingBuilder base = StockPosting.builder()
                    .instituteId(order.getInstituteId())
                    .locationId(shipment.getLocationId())
                    .packageSessionId(line.getPackageSessionId())
                    .referenceType(CommerceOrderDeskService.REFERENCE_SHIPMENT_LINE)
                    .referenceId(row.getId())
                    .actorUserId(actor);
            if (StockMode.PIECE.name().equals(facts.getStockMode())) {
                Set<String> namedPieces = allPieces.getOrDefault(row.getOrderLineId(), Set.of());
                Set<String> damaged = damagedPieces.getOrDefault(row.getOrderLineId(), Set.of());
                Set<String> soldPieces = new LinkedHashSet<>();
                for (PieceRow piece : pieceRepository.findRowsByOrderLine(order.getInstituteId(), line.getId())) {
                    if ("SOLD".equals(piece.getStatus())) {
                        soldPieces.add(piece.getId());
                    }
                }
                if (!soldPieces.equals(namedPieces) || damaged.size() != count[1]) {
                    throw new InvalidRequestException("RTO_LINES_INCOMPLETE: name every piece of line "
                            + line.getLineNo() + " with its condition");
                }
                for (String pieceId : soldPieces) {
                    // The builder is shared by the pieces: a DAMAGE before this one set a reason
                    // that a RETURN must not carry.
                    postings.add(base.type(StockMovementType.RETURN).pieceId(pieceId).quantityDelta(1).reason(null)
                            .idempotencyKey("RTO_RET:" + row.getId() + ":" + pieceId).build());
                    if (damaged.contains(pieceId)) {
                        postings.add(base.type(StockMovementType.DAMAGE).pieceId(pieceId).quantityDelta(-1)
                                .reason(REASON_DAMAGED_IN_TRANSIT)
                                .idempotencyKey("RTO_DMG:" + row.getId() + ":" + pieceId).build());
                    }
                }
            } else {
                BigDecimal saleCost = null;
                for (StockMovement sale : sales) {
                    if (row.getId().equals(sale.getReferenceId()) && sale.getUnitCost() != null
                            && !sale.isCostProvisional()) {
                        saleCost = sale.getUnitCost();
                        break;
                    }
                }
                StockPosting.StockPostingBuilder back = base.type(StockMovementType.RETURN)
                        .quantityDelta(row.getQuantity())
                        .idempotencyKey("RTO_RET:" + row.getId());
                if (saleCost != null) {
                    back.unitCost(saleCost).costTreatment(StockPosting.CostTreatment.KNOWN);
                }
                postings.add(back.build());
                if (count[1] > 0) {
                    postings.add(StockPosting.builder()
                            .instituteId(order.getInstituteId())
                            .locationId(shipment.getLocationId())
                            .packageSessionId(line.getPackageSessionId())
                            .referenceType(CommerceOrderDeskService.REFERENCE_SHIPMENT_LINE)
                            .referenceId(row.getId())
                            .actorUserId(actor)
                            .type(StockMovementType.DAMAGE)
                            .quantityDelta(-count[1])
                            .reason(REASON_DAMAGED_IN_TRANSIT)
                            .idempotencyKey("RTO_DMG:" + row.getId())
                            .build());
                }
            }
        }
        ledger.postAll(postings);

        boolean cod = CartPriceRequest.COD.equals(order.getPaymentMethod());
        if (!cod && order.getAmountPaid() != null && order.getAmountPaid().signum() > 0) {
            BigDecimal kept = storefrontSettings.read(order.getInstituteId()).refundShippingOnRto()
                    ? BigDecimal.ZERO : CommerceOrderDeskService_nz(order.getShipping());
            BigDecimal due = order.getAmountPaid().subtract(CommerceOrderDeskService_nz(order.getRefundDue()))
                    .subtract(kept);
            desk.raiseRefundDue(order, due, "RTO:" + shipment.getId(), "The parcel came back to the seller.");
            orderRepository.save(order);
        }
        shipment.setStatus(CommerceShipmentStatus.RTO_RECEIVED.name());
        shipment.setRtoReceivedAt(new Date());
        shipment.setRtoReceivedBy(actor);
        shipmentRepository.save(shipment);
        auditService.record(order.getInstituteId(), actor, shipment.getLocationId(), "RTO_RECEIVED", "SHIPMENT",
                shipment.getId(), null, CommerceInputRules.json(audit), note);
    }

    /**
     * The hand-over of a staff order to a buyer at the shop: pack every line, ship with carrier
     * HANDOVER and deliver today, in the caller's transaction.
     */
    public void handOverInside(CommerceOrder order, List<CommerceOrderLine> lines, String actor) {
        CommerceShipment shipment = packInside(order, lines, openLines(order, lines), null, actor);
        shipInside(order, lines, shipment, new CarrierAdapter.Booked(CommerceShipment.CARRIER_HANDOVER,
                "Handed over", null, null, null), null, actor, true);
        deliverInside(order, shipment, null, actor, "Handed over at the shop");
    }

    // ================================================================== helpers

    /** Every open item line at its open quantity, refusing one-of-a-kind stock (it must be scanned). */
    private Map<String, PackLine> openLines(CommerceOrder order, List<CommerceOrderLine> lines) {
        Map<String, PackLine> all = new LinkedHashMap<>();
        for (CommerceOrderLine line : CommerceOrderDeskService.items(lines)) {
            if (line.openQuantity() <= 0) {
                continue;
            }
            VariantFacts facts = facts(order, line);
            if (facts != null && StockMode.PIECE.name().equals(facts.getStockMode())
                    && StockPolicy.TRACKED.name().equals(facts.getStockPolicy())) {
                throw new ConflictException("PIECE_SCAN_REQUIRED: line " + line.getLineNo()
                        + " is a one-of-a-kind item; scan its piece on the order");
            }
            all.put(line.getId(), new PackLine(line.openQuantity(), List.of(), List.of()));
        }
        return all;
    }

    private CommerceRequestGuard.Outcome<String> runShip(String instituteId, String orderId,
                                                         java.util.function.Supplier<CommerceRequestGuard.Outcome<String>> ship) {
        try {
            return ship.get();
        } catch (ConflictException e) {
            String message = e.getMessage() == null ? "" : e.getMessage();
            if (message.startsWith("NOT_IN_STOCK") || message.startsWith("PIECE_STATE")) {
                // The goods the order was promised are not on the shelf: say so on the order.
                stockShortFlagger.flagOrder(instituteId, orderId);
            }
            throw e;
        }
    }

    private void requirePackFrom(CommerceOrder order, CommerceOrderStatus from) {
        if (from != CommerceOrderStatus.CONFIRMED) {
            throw new ConflictException("ORDER_TRANSITION_NOT_ALLOWED: an order is packed from CONFIRMED");
        }
        CommerceOrderDeskService.requireStatus(order, from);
    }

    /** The fulfilment location of the order: set, active, and the one that sells online. */
    private String requireOnlineLocation(CommerceOrder order) {
        String locationId = order.getFulfilmentLocationId();
        if (!StringUtils.hasText(locationId)) {
            throw new ConflictException("NO_FULFILMENT_LOCATION: the order has no location to ship from");
        }
        StockLocation location = locationRepository.findByInstituteIdAndId(order.getInstituteId(), locationId)
                .orElseThrow(() -> new ConflictException("NO_FULFILMENT_LOCATION: the order's location is gone"));
        if (!LocationStatus.ACTIVE.name().equals(location.getStatus()) || !location.isSellsOnline()) {
            throw new ConflictException("LOCATION_NOT_ONLINE: the order's location is not the active location "
                    + "that sells online");
        }
        return locationId;
    }

    private void requirePeriodOpen(String instituteId) {
        periodGuard.ifAvailable(guard -> guard.assertOpen(instituteId, clock.today(instituteId)));
    }

    /**
     * A shipment route moves the order from exactly one status (the table also holds the undo
     * moves, which have the transition route): anything else is 409 ORDER_TRANSITION_NOT_ALLOWED.
     */
    private static void requireOrderStatus(CommerceOrder order, CommerceOrderStatus from, CommerceOrderStatus to) {
        CommerceOrderStatus now = CommerceOrderStatus.of(order.getStatus());
        if (now != from) {
            throw new ConflictException("ORDER_TRANSITION_NOT_ALLOWED: an order is " + to.name().toLowerCase(Locale.ROOT)
                    + " from " + from.name() + "; this one is " + order.getStatus());
        }
        CommerceOrderTransitions.require(now, to);
    }

    private static void requireShipment(CommerceOrder order, CommerceShipment shipment,
                                        CommerceShipmentStatus expected) {
        if (!shipment.getOrderId().equals(order.getId())
                || CommerceShipmentStatus.of(shipment.getStatus()) != expected) {
            throw new ConflictException(CommerceOrderDeskService.SHIPMENT_STATE_CHANGED + ": the parcel is "
                    + shipment.getStatus() + ", not " + expected.name());
        }
    }

    /** A TRACKED line must hold its stock as a SOLD hold before it is packed or shipped. */
    private void requireSettled(CommerceOrder order, CommerceOrderLine line, VariantFacts facts, int quantity) {
        if (facts == null || !StockPolicy.TRACKED.name().equals(facts.getStockPolicy())) {
            return;
        }
        if (!StringUtils.hasText(line.getUserPlanId())) {
            throw new ConflictException("STOCK_NOT_SETTLED: line " + line.getLineNo() + " has no plan");
        }
        boolean held = false;
        boolean any = false;
        for (HoldRow row : legacyRepository.findHoldsOfPlans(List.of(line.getUserPlanId()))) {
            if (!line.getPackageSessionId().equals(row.getPackageSessionId())) {
                continue;
            }
            any = true;
            if ("SOLD".equals(row.getStatus()) && row.getQuantity() != null && row.getQuantity() >= quantity) {
                held = true;
            }
        }
        if (any && !held) {
            throw new ConflictException("STOCK_NOT_SETTLED: the stock of line " + line.getLineNo()
                    + " is not sold to this order");
        }
        if (!any) {
            log.warn("Order {} line {} of a tracked item has no stock hold (made before stock was tracked)",
                    order.getId(), line.getId());
        }
    }

    private VariantFacts facts(CommerceOrder order, CommerceOrderLine line) {
        if (line == null || !StringUtils.hasText(line.getPackageSessionId())) {
            return null;
        }
        return variantRepository.findFacts(order.getInstituteId(), line.getPackageSessionId()).orElse(null);
    }

    private List<String> resolvePieces(CommerceOrder order, CommerceOrderLine line, PackLine asked) {
        List<String> ids = new ArrayList<>();
        Set<String> seen = new LinkedHashSet<>();
        for (String id : asked.pieceIds()) {
            PieceRow piece = pieceRepository.findRow(order.getInstituteId(), id)
                    .orElseThrow(() -> new ConflictException("PIECE_NOT_AVAILABLE: a piece of line " + line.getLineNo()
                            + " is not a piece of this shop"));
            add(line, piece, ids, seen);
        }
        for (String code : asked.pieceCodes()) {
            PieceRow piece = pieceRepository.findRowByCode(order.getInstituteId(), code.toUpperCase(Locale.ROOT))
                    .orElseThrow(() -> new ConflictException("PIECE_NOT_AVAILABLE: piece " + code + " is not a piece "
                            + "of this shop"));
            add(line, piece, ids, seen);
        }
        return ids;
    }

    private static void add(CommerceOrderLine line, PieceRow piece, List<String> ids, Set<String> seen) {
        if (!line.getPackageSessionId().equals(piece.getPackageSessionId())) {
            throw new ConflictException("PIECE_NOT_AVAILABLE: piece " + piece.getCode() + " is not of line "
                    + line.getLineNo());
        }
        if (!seen.add(piece.getId())) {
            throw validation("piece " + piece.getCode() + " is named twice");
        }
        ids.add(piece.getId());
    }

    /** The cost of the goods on each credited invoice line: the order line's cost, shared out. */
    private Map<String, BigDecimal> costsByInvoiceLine(CommerceOrder order, List<CommerceOrderLine> lines,
                                                       CreditNoteDTO note) {
        Map<String, BigDecimal> out = new HashMap<>();
        if (note == null || note.getLines() == null) {
            return out;
        }
        Map<String, List<CreditNoteLineDTO>> byRef = new HashMap<>();
        Map<String, String> refOfInvoiceLine = desk.invoiceLineRefs(note.getInvoiceId());
        for (CreditNoteLineDTO credited : note.getLines()) {
            String ref = refOfInvoiceLine.get(credited.getInvoiceLineItemId());
            if (ref != null) {
                byRef.computeIfAbsent(ref, k -> new ArrayList<>()).add(credited);
            }
        }
        for (CommerceOrderLine line : CommerceOrderDeskService.items(lines)) {
            List<CreditNoteLineDTO> credited = byRef.get(line.getLineRef());
            if (credited == null || line.getCostTotal() == null || line.getQtyShipped() == null
                    || line.getQtyShipped() < 1) {
                continue;
            }
            BigDecimal net = credited.stream().map(c -> c.getAmount() == null ? BigDecimal.ZERO : c.getAmount())
                    .reduce(BigDecimal.ZERO, BigDecimal::add);
            BigDecimal given = BigDecimal.ZERO;
            for (int i = 0; i < credited.size(); i++) {
                CreditNoteLineDTO c = credited.get(i);
                BigDecimal share = i == credited.size() - 1 ? line.getCostTotal().subtract(given)
                        : net.signum() == 0 ? BigDecimal.ZERO
                        : line.getCostTotal().multiply(c.getAmount()).divide(net, 2, RoundingMode.HALF_UP);
                given = given.add(share);
                out.put(c.getInvoiceLineItemId(), share);
            }
        }
        return out;
    }

    private CommerceShipment readShipment(String instituteId, String shipmentId) {
        CommerceShipment shipment = ownTransaction.execute(status -> StringUtils.hasText(shipmentId)
                ? shipmentRepository.findByIdAndInstituteId(shipmentId.trim(), instituteId).orElse(null) : null);
        if (shipment == null) {
            throw new vacademy.io.common.exceptions.VacademyException(org.springframework.http.HttpStatus.NOT_FOUND,
                    "SHIPMENT_NOT_FOUND: no such shipment");
        }
        return shipment;
    }

    private static CommerceOrderStatus fromStatus(String raw) {
        CommerceOrderStatus status = CommerceOrderStatus.of(raw == null ? null : raw.trim().toUpperCase(Locale.ROOT));
        if (status == null) {
            throw validation("from_status is an order status");
        }
        return status;
    }

    private static Integer weight(Integer grams) {
        if (grams == null) {
            return null;
        }
        if (grams < 1 || grams > 1_000_000) {
            throw validation("weight_grams is a whole number from 1 to 1000000");
        }
        return grams;
    }

    private static List<String> clean(List<String> values) {
        List<String> out = new ArrayList<>();
        if (values == null) {
            return out;
        }
        if (values.size() > 1000) {
            throw validation("at most 1000 pieces");
        }
        for (String value : values) {
            if (value != null && !value.isBlank()) {
                String v = value.trim();
                if (v.length() > 36) {
                    throw validation("a piece id or code is at most 36 characters");
                }
                out.add(v);
            }
        }
        return out;
    }

    private static String required(String raw, String field) {
        if (raw == null || raw.isBlank() || raw.trim().length() > 36) {
            throw validation(field + " is required");
        }
        return raw.trim();
    }

    private static String text(String raw, String field, int max) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        String value = raw.trim();
        if (value.length() > max) {
            throw validation(field + " is at most " + max + " characters");
        }
        return value;
    }

    private static BigDecimal CommerceOrderDeskService_nz(BigDecimal value) {
        return value == null ? BigDecimal.ZERO.setScale(2) : value;
    }

    private static InvalidRequestException validation(String message) {
        return new InvalidRequestException("VALIDATION: " + message);
    }
}
