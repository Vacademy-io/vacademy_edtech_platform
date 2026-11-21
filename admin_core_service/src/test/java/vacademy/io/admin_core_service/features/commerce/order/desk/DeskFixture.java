package vacademy.io.admin_core_service.features.commerce.order.desk;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.common.request.CommerceRequestGuard;
import vacademy.io.admin_core_service.features.commerce.document.dto.CreditNoteDTO;
import vacademy.io.admin_core_service.features.commerce.document.repository.CommerceCreditNoteLineRepository;
import vacademy.io.admin_core_service.features.commerce.document.service.CommerceCreditNoteService;
import vacademy.io.admin_core_service.features.commerce.document.service.CommerceInvoiceService;
import vacademy.io.admin_core_service.features.commerce.document.service.DocumentClock;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceOrderQueryService;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceOrderWriter;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceRefundHook;
import vacademy.io.admin_core_service.features.commerce.order.dto.CartPriceSnapshot;
import vacademy.io.admin_core_service.features.commerce.order.dto.StaffOrderDtos;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrder;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderLine;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderTender;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderLegacyRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderLineRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderTenderRepository;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.shipment.carrier.ManualCarrierAdapter;
import vacademy.io.admin_core_service.features.commerce.shipment.entity.CommerceShipment;
import vacademy.io.admin_core_service.features.commerce.shipment.entity.CommerceShipmentLine;
import vacademy.io.admin_core_service.features.commerce.shipment.repository.CommerceShipmentLineRepository;
import vacademy.io.admin_core_service.features.commerce.shipment.repository.CommerceShipmentRepository;
import vacademy.io.admin_core_service.features.commerce.shipment.service.CommerceShipmentService;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockLocation;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockMovement;
import vacademy.io.admin_core_service.features.commerce.stock.repository.CommercePieceRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLocationRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockMovementRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockVariantRepository;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockLedgerService;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockPeriodGuard;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockPostResult;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockPosting;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSettings;
import vacademy.io.admin_core_service.features.commerce.storefront.service.CommerceStorefrontSettings;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxLineResult;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxResult;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxHead;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxLineType;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxMode;
import vacademy.io.admin_core_service.features.invoice.entity.Invoice;
import vacademy.io.admin_core_service.features.invoice.repository.InvoiceLineItemRepository;
import vacademy.io.admin_core_service.features.stock_hold.service.StockHoldService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;

/**
 * The order desk services over mocks: one order of the institute at one online location, with
 * item lines, an optional live shipment, tenders and holds, read back by the repository mocks.
 * The request guard runs the change directly (its own test proves the key handling).
 */
@SuppressWarnings("unchecked")
class DeskFixture {

    static final String INST = "inst-1";
    static final String LOC = "loc-1";
    static final String ORDER = "order-1";
    static final String SHIPMENT = "sh-1";
    static final String KEY = "client-key-1";

    final CommerceOrderRepository orderRepository = mock(CommerceOrderRepository.class);
    final CommerceOrderLineRepository lineRepository = mock(CommerceOrderLineRepository.class);
    final CommerceOrderTenderRepository tenderRepository = mock(CommerceOrderTenderRepository.class);
    final CommerceOrderLegacyRepository legacyRepository = mock(CommerceOrderLegacyRepository.class);
    final CommerceOrderWriter writer = mock(CommerceOrderWriter.class);
    final CommerceShipmentRepository shipmentRepository = mock(CommerceShipmentRepository.class);
    final CommerceShipmentLineRepository shipmentLineRepository = mock(CommerceShipmentLineRepository.class);
    final CommercePieceRepository pieceRepository = mock(CommercePieceRepository.class);
    final StockHoldService stockHoldService = mock(StockHoldService.class);
    final StockLedgerService ledger = mock(StockLedgerService.class);
    final StockMovementRepository movementRepository = mock(StockMovementRepository.class);
    final CommerceInvoiceService invoiceService = mock(CommerceInvoiceService.class);
    final CommerceCreditNoteService creditNoteService = mock(CommerceCreditNoteService.class);
    final CommerceCreditNoteLineRepository creditNoteLineRepository = mock(CommerceCreditNoteLineRepository.class);
    final CommerceAuditService auditService = mock(CommerceAuditService.class);
    final CommerceRefundHook refundHook = mock(CommerceRefundHook.class);
    final CommerceOrderEvents events = mock(CommerceOrderEvents.class);
    final CommerceRequestGuard requestGuard = mock(CommerceRequestGuard.class);
    final CommerceAccessGuard accessGuard;
    final CommerceOrderQueryService queryService = mock(CommerceOrderQueryService.class);
    final ObjectMapper objectMapper = new ObjectMapper().findAndRegisterModules();
    final ObjectProvider<CommerceSalesMoneyHook> moneyHook = mock(ObjectProvider.class);
    final ObjectProvider<CommerceShipmentService> shipmentProvider = mock(ObjectProvider.class);
    final InvoiceLineItemRepository invoiceLineItemRepository = mock(InvoiceLineItemRepository.class);
    final PlatformTransactionManager transactionManager = mock(PlatformTransactionManager.class);
    final StockVariantRepository variantRepository = mock(StockVariantRepository.class);
    final StockLocationRepository locationRepository = mock(StockLocationRepository.class);
    final CommerceStockShortFlagger stockShortFlagger = mock(CommerceStockShortFlagger.class);
    final CommerceStorefrontSettings storefrontSettings = mock(CommerceStorefrontSettings.class);
    final DocumentClock clock = mock(DocumentClock.class);
    final ObjectProvider<StockPeriodGuard> periodGuard = mock(ObjectProvider.class);

    final CommerceOrderDeskService desk;
    final CommerceShipmentService shipments;

    final CommerceOrder order = new CommerceOrder();
    final List<CommerceOrderLine> lines = new ArrayList<>();
    final List<CommerceOrderTender> tenders = new ArrayList<>();
    final List<CommerceShipmentLine> shipmentLines = new ArrayList<>();
    CommerceShipment shipment;
    final List<StockPosting> posted = new ArrayList<>();
    final AtomicInteger ids = new AtomicInteger();
    final LocalDate today = LocalDate.now(java.time.ZoneId.of("Asia/Kolkata"));
    final StockLocation location = new StockLocation();

    DeskFixture() {
        this(mock(CommerceAccessGuard.class));
    }

    DeskFixture(CommerceAccessGuard accessGuard) {
        this.accessGuard = accessGuard;
        desk = new CommerceOrderDeskService(orderRepository, lineRepository, tenderRepository, legacyRepository,
                writer, shipmentRepository, shipmentLineRepository, pieceRepository, stockHoldService, ledger,
                movementRepository, invoiceService, creditNoteService, creditNoteLineRepository, auditService,
                refundHook, events, requestGuard, accessGuard, queryService, objectMapper, moneyHook, shipmentProvider,
                invoiceLineItemRepository, transactionManager);
        shipments = new CommerceShipmentService(desk, orderRepository, lineRepository, tenderRepository,
                legacyRepository, writer, shipmentRepository, shipmentLineRepository, pieceRepository,
                variantRepository, locationRepository, ledger, stockHoldService, auditService, events, requestGuard,
                stockShortFlagger, storefrontSettings, new ManualCarrierAdapter(), clock, periodGuard,
                transactionManager);
        lenient().when(shipmentProvider.getObject()).thenReturn(shipments);
        lenient().when(requestGuard.run(any(), any(), any())).thenAnswer(call -> new CommerceRequestGuard.Outcome<>(
                ((Supplier<Object>) call.getArgument(1)).get(), false));
        lenient().when(queryService.staffDetail(anyString(), anyString(), any(), anyBoolean(), anyBoolean()))
                .thenAnswer(call -> StaffOrderDtos.StaffOrderDetail.builder().build());
        lenient().when(clock.today(anyString())).thenReturn(today);
        lenient().when(storefrontSettings.read(anyString())).thenReturn(settings(true));

        order.setId(ORDER);
        order.setInstituteId(INST);
        order.setOrderNumber("ORD-000001");
        order.setChannel("ONLINE");
        order.setPaymentMethod("PREPAID");
        order.setPaymentStatus("PAID");
        order.setPaymentGroupId("group-1");
        order.setFulfilmentLocationId(LOC);
        order.setCurrency("INR");
        order.setSubtotal(new BigDecimal("1000.00"));
        order.setDiscount(new BigDecimal("0.00"));
        order.setShipping(new BigDecimal("60.00"));
        order.setTax(new BigDecimal("50.48"));
        order.setTotal(new BigDecimal("1060.00"));
        order.setAmountPaid(new BigDecimal("1060.00"));
        order.setStatus("CONFIRMED");
        lenient().when(orderRepository.findByIdAndInstituteId(ORDER, INST)).thenAnswer(call -> Optional.of(order));
        lenient().when(orderRepository.lockById(ORDER)).thenAnswer(call -> Optional.of(order));
        lenient().when(orderRepository.findById(ORDER)).thenAnswer(call -> Optional.of(order));
        lenient().when(lineRepository.findByOrderIdOrderByLineNoAsc(ORDER)).thenAnswer(call -> lines);
        lenient().when(tenderRepository.findByOrderIdOrderByCreatedAtAsc(ORDER)).thenAnswer(call -> tenders);
        lenient().when(tenderRepository.settleOne(anyString(), anyString(), any(), any())).thenAnswer(call -> {
            for (CommerceOrderTender t : tenders) {
                if (t.getId().equals(call.getArgument(0)) && CommerceOrderTender.STATUS_PENDING.equals(t.getStatus())) {
                    t.setStatus(call.getArgument(1));
                    return 1;
                }
            }
            return 0;
        });
        lenient().when(tenderRepository.save(any(CommerceOrderTender.class))).thenAnswer(call -> {
            CommerceOrderTender t = call.getArgument(0);
            if (t.getId() == null) {
                t.setId("tender-" + ids.incrementAndGet());
                tenders.add(t);
            }
            return t;
        });
        lenient().when(shipmentRepository.findLiveId(ORDER)).thenAnswer(call -> shipment == null
                || "CANCELLED".equals(shipment.getStatus()) ? Optional.empty() : Optional.of(shipment.getId()));
        lenient().when(shipmentRepository.lockId(anyString(), eq(INST))).thenAnswer(call -> shipment != null
                && shipment.getId().equals(call.getArgument(0)) ? Optional.of(shipment.getId()) : Optional.empty());
        lenient().when(shipmentRepository.findById(anyString())).thenAnswer(call -> Optional.ofNullable(shipment));
        lenient().when(shipmentRepository.findByIdAndInstituteId(anyString(), eq(INST)))
                .thenAnswer(call -> Optional.ofNullable(shipment));
        lenient().when(shipmentRepository.saveAndFlush(any(CommerceShipment.class))).thenAnswer(call -> {
            CommerceShipment s = call.getArgument(0);
            if (s.getId() == null) {
                s.setId(SHIPMENT);
            }
            shipment = s;
            return s;
        });
        lenient().when(shipmentRepository.save(any(CommerceShipment.class))).thenAnswer(call -> call.getArgument(0));
        lenient().when(shipmentLineRepository.findByShipmentIdOrderByCreatedAtAscIdAsc(anyString()))
                .thenAnswer(call -> new ArrayList<>(shipmentLines));
        lenient().when(shipmentLineRepository.saveAllAndFlush(anyList())).thenAnswer(call -> {
            List<CommerceShipmentLine> saved = (List<CommerceShipmentLine>) call.getArgument(0);
            for (CommerceShipmentLine l : saved) {
                if (l.getId() == null) {
                    l.setId("shl-" + l.getOrderLineId());
                }
                shipmentLines.add(l);
            }
            return saved;
        });
        location.setId(LOC);
        location.setStatus("ACTIVE");
        location.setSellsOnline(true);
        location.setStateCode("09");
        lenient().when(locationRepository.findByInstituteIdAndId(INST, LOC)).thenReturn(Optional.of(location));
        lenient().when(ledger.postAll(anyList())).thenAnswer(call -> {
            List<StockPosting> asked = (List<StockPosting>) call.getArgument(0);
            posted.addAll(asked);
            List<StockPostResult> out = new ArrayList<>();
            for (StockPosting p : asked) {
                StockMovement m = new StockMovement();
                m.setId("mv-" + ids.incrementAndGet());
                m.setType(p.getType().name());
                m.setQuantityDelta(p.getQuantityDelta());
                m.setReferenceId(p.getReferenceId());
                m.setReferenceType(p.getReferenceType());
                m.setIdempotencyKey(p.getIdempotencyKey());
                m.setPieceId(p.getPieceId());
                m.setLocationId(p.getLocationId());
                m.setPackageSessionId(p.getPackageSessionId());
                m.setUnitCost(new BigDecimal("100.00"));
                out.add(new StockPostResult(m, true, 0));
            }
            return out;
        });
        lenient().when(invoiceService.issue(anyString(), any())).thenAnswer(call -> {
            Invoice invoice = new Invoice();
            invoice.setId("inv-" + ids.incrementAndGet());
            invoice.setInvoiceNumber("INV-" + ids.get());
            return new CommerceInvoiceService.Issued(invoice, false);
        });
        lenient().when(invoiceService.liveDocument(anyString(), anyList())).thenReturn(Optional.empty());
        lenient().when(creditNoteService.issue(anyString(), any(), any())).thenAnswer(call ->
                CreditNoteDTO.builder().id("cn-" + ids.incrementAndGet()).build());
        lenient().when(legacyRepository.findHoldsOfPlans(anyList())).thenReturn(List.of());
        lenient().when(movementRepository.findByInstituteIdAndReferenceTypeAndReferenceIdInOrderByCreatedAtAsc(
                anyString(), anyString(), any(Collection.class))).thenReturn(List.of());
    }

    static StorefrontSettings settings(boolean refundShippingOnRto) {
        return new StorefrontSettings("en", 3, null, List.of(), java.util.Map.of(), null, null, 10, List.of(), null, 10,
                refundShippingOnRto);
    }

    /** An item line of the order: two units of a quantity-counted variant unless said otherwise. */
    CommerceOrderLine line(String id, int quantity, String lineTotal) {
        CommerceOrderLine line = new CommerceOrderLine();
        line.setId(id);
        line.setInstituteId(INST);
        line.setOrderId(ORDER);
        line.setLineNo(lines.size() + 1);
        line.setLineType(CommerceOrderLine.TYPE_ITEM);
        line.setLineRef("ref-" + id);
        line.setPackageSessionId("ps-" + id);
        line.setUserPlanId("plan-" + id);
        line.setPaymentLogId("log-" + id);
        line.setQuantity(quantity);
        line.setLineTotal(new BigDecimal(lineTotal));
        line.setLogAmount(new BigDecimal(lineTotal));
        line.setSkuSnapshot("SKU-" + id);
        lines.add(line);
        return line;
    }

    /** The tracking facts of a variant: TRACKED, QUANTITY or PIECE. */
    void facts(String packageSessionId, String policy, String mode) {
        StockVariantRepository.VariantFacts facts = mock(StockVariantRepository.VariantFacts.class);
        lenient().when(facts.getStockPolicy()).thenReturn(policy);
        lenient().when(facts.getStockMode()).thenReturn(mode);
        lenient().when(variantRepository.findFacts(INST, packageSessionId)).thenReturn(Optional.of(facts));
    }

    /** The plan's SOLD hold row for the line, holding {@code quantity}. */
    void soldHold(CommerceOrderLine line, int quantity) {
        CommerceOrderLegacyRepository.HoldRow row = mock(CommerceOrderLegacyRepository.HoldRow.class);
        lenient().when(row.getId()).thenReturn("hold-" + line.getId());
        lenient().when(row.getUserPlanId()).thenReturn(line.getUserPlanId());
        lenient().when(row.getPackageSessionId()).thenReturn(line.getPackageSessionId());
        lenient().when(row.getStatus()).thenReturn("SOLD");
        lenient().when(row.getQuantity()).thenReturn(quantity);
        lenient().when(legacyRepository.findHoldsOfPlans(List.of(line.getUserPlanId()))).thenReturn(List.of(row));
    }

    CommerceShipment shipment(String status) {
        shipment = new CommerceShipment();
        shipment.setId(SHIPMENT);
        shipment.setInstituteId(INST);
        shipment.setOrderId(ORDER);
        shipment.setLocationId(LOC);
        shipment.setStatus(status);
        shipment.setShipCount(status.equals("PACKED") ? 0 : 1);
        if (!status.equals("PACKED")) {
            shipment.setShippedAt(java.sql.Timestamp.valueOf(today.minusDays(2).atStartOfDay()));
        }
        return shipment;
    }

    CommerceShipmentLine shipmentLine(CommerceOrderLine line, int quantity) {
        CommerceShipmentLine row = new CommerceShipmentLine();
        row.setId("shl-" + line.getId());
        row.setInstituteId(INST);
        row.setShipmentId(SHIPMENT);
        row.setOrderLineId(line.getId());
        row.setQuantity(quantity);
        shipmentLines.add(row);
        return row;
    }

    CommerceOrderTender tender(String mode, String status, String amount) {
        CommerceOrderTender tender = new CommerceOrderTender();
        tender.setId("tender-" + ids.incrementAndGet());
        tender.setInstituteId(INST);
        tender.setOrderId(ORDER);
        tender.setMode(mode);
        tender.setStatus(status);
        tender.setAmount(new BigDecimal(amount));
        tenders.add(tender);
        return tender;
    }

    /** A placement snapshot whose tax lines are the item lines (5 %, CGST and SGST) and delivery. */
    void snapshot() {
        List<TaxLineResult> taxLines = new ArrayList<>();
        BigDecimal total = BigDecimal.ZERO;
        for (CommerceOrderLine line : lines) {
            BigDecimal net = line.getLineTotal();
            BigDecimal taxable = net.multiply(new BigDecimal("100")).divide(new BigDecimal("105"), 2,
                    java.math.RoundingMode.HALF_UP);
            BigDecimal tax = net.subtract(taxable);
            BigDecimal cgst = tax.divide(BigDecimal.valueOf(2), 2, java.math.RoundingMode.DOWN);
            taxLines.add(TaxLineResult.builder().lineRef(line.getLineRef()).lineType(TaxLineType.ITEM)
                    .quantity(line.getQuantity()).qtyScale(1).gross(net).lineDiscount(BigDecimal.ZERO.setScale(2))
                    .orderDiscount(BigDecimal.ZERO.setScale(2)).net(net).ratePercent(new BigDecimal("5"))
                    .cessPercent(BigDecimal.ZERO).taxableValue(taxable).cgst(cgst).sgst(tax.subtract(cgst))
                    .igst(BigDecimal.ZERO.setScale(2)).cess(BigDecimal.ZERO.setScale(2)).taxAmount(tax).build());
            total = total.add(net);
        }
        BigDecimal shipping = order.getShipping() == null ? BigDecimal.ZERO.setScale(2) : order.getShipping();
        if (shipping.signum() > 0) {
            taxLines.add(TaxLineResult.builder().lineRef("SHIPPING").lineType(TaxLineType.SHIPPING).quantity(1)
                    .qtyScale(1).gross(shipping).lineDiscount(BigDecimal.ZERO.setScale(2))
                    .orderDiscount(BigDecimal.ZERO.setScale(2)).net(shipping).ratePercent(BigDecimal.ZERO)
                    .cessPercent(BigDecimal.ZERO).taxableValue(shipping).cgst(BigDecimal.ZERO.setScale(2))
                    .sgst(BigDecimal.ZERO.setScale(2)).igst(BigDecimal.ZERO.setScale(2))
                    .cess(BigDecimal.ZERO.setScale(2)).taxAmount(BigDecimal.ZERO.setScale(2)).build());
            total = total.add(shipping);
        }
        TaxResult tax = TaxResult.builder().mode(TaxMode.REGULAR).taxHead(TaxHead.CGST_SGST).lines(taxLines)
                .roundOff(BigDecimal.ZERO.setScale(2)).total(total).build();
        CartPriceSnapshot snapshot = CartPriceSnapshot.builder().tax(tax).total(total).build();
        try {
            order.setPriceSnapshotJson(objectMapper.writeValueAsString(snapshot));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
        order.setTotal(total);
        order.setSubtotal(total.subtract(shipping));
    }

    /** A principal with these authorities. */
    static CustomUserDetails user(String... authorities) {
        CustomUserDetails user = mock(CustomUserDetails.class);
        lenient().when(user.getUserId()).thenReturn("user-1");
        List<GrantedAuthority> granted = new ArrayList<>();
        for (String a : authorities) {
            granted.add(new SimpleGrantedAuthority(a));
        }
        lenient().when(user.getAuthorities()).thenAnswer(call -> granted);
        return user;
    }

    static CustomUserDetails manager() {
        return user("COMMERCE_STORE_MANAGER");
    }
}
