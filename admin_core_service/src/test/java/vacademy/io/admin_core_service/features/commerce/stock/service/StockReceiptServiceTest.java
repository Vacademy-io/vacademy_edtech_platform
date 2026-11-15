package vacademy.io.admin_core_service.features.commerce.stock.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.admin_core_service.features.capabilities.service.CapabilityResolver;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessDeniedException;
import vacademy.io.admin_core_service.features.commerce.stock.dto.ReceiptRequest;
import vacademy.io.admin_core_service.features.commerce.stock.entity.CommercePiece;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockLocation;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockMovement;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockReceipt;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockReceiptLine;
import vacademy.io.admin_core_service.features.commerce.stock.enums.StockMovementType;
import vacademy.io.admin_core_service.features.commerce.stock.repository.CommercePieceRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLocationRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockMovementRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockReceiptLineRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockReceiptLineRepository.LineRow;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockReceiptRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockVariantRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockVariantRepository.VariantFacts;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockPosting.CostTreatment;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** A goods receipt: who may state a cost, where the cost comes from, and how it is undone. */
class StockReceiptServiceTest {

    private static final String INST = "inst-1";

    private StockReceiptRepository receipts;
    private StockReceiptLineRepository lines;
    private StockLocationRepository locations;
    private StockVariantRepository variants;
    private CommercePieceRepository pieces;
    private StockMovementRepository movements;
    private StockLedgerService ledger;
    private CommerceCounterService counters;
    private CapabilityResolver capabilities;
    private StockReceiptService service;
    private final List<VariantFacts> known = new ArrayList<>();

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        receipts = mock(StockReceiptRepository.class);
        lines = mock(StockReceiptLineRepository.class);
        locations = mock(StockLocationRepository.class);
        variants = mock(StockVariantRepository.class);
        pieces = mock(CommercePieceRepository.class);
        movements = mock(StockMovementRepository.class);
        ledger = mock(StockLedgerService.class);
        counters = mock(CommerceCounterService.class);
        capabilities = mock(CapabilityResolver.class);
        ScanCodeGenerator codes = mock(ScanCodeGenerator.class);
        StockClock clock = mock(StockClock.class);
        when(clock.today(anyString())).thenReturn(LocalDate.of(2026, 11, 14));
        AtomicInteger codeSeq = new AtomicInteger();
        when(codes.newPieceCode()).thenAnswer(inv -> "PAAAAAAAA" + (2 + codeSeq.getAndIncrement()));
        when(codes.newVariantLabelCode()).thenReturn("VAAAAAAAA2");
        service = new StockReceiptService(receipts, lines, locations, variants, pieces, movements, ledger, codes,
                counters, mock(CommerceAuditService.class), capabilities, clock,
                (ObjectProvider<StockSupplierDirectory>) mock(ObjectProvider.class),
                (ObjectProvider<StockPeriodGuard>) mock(ObjectProvider.class),
                mock(PlatformTransactionManager.class));

        when(counters.nextNumber(INST, "GRN")).thenReturn("GRN-000001");
        when(receipts.findByInstituteIdAndClientRequestId(anyString(), anyString())).thenReturn(Optional.empty());
        when(receipts.saveAndFlush(any(StockReceipt.class))).thenAnswer(inv -> {
            StockReceipt receipt = inv.getArgument(0);
            receipt.setId("rcpt-1");
            return receipt;
        });
        AtomicInteger lineSeq = new AtomicInteger();
        when(lines.saveAndFlush(any(StockReceiptLine.class))).thenAnswer(inv -> {
            StockReceiptLine line = inv.getArgument(0);
            line.setId("line-" + lineSeq.incrementAndGet());
            return line;
        });
        AtomicInteger pieceSeq = new AtomicInteger();
        when(pieces.saveAllAndFlush(anyList())).thenAnswer(inv -> {
            List<CommercePiece> saved = new ArrayList<>((List<CommercePiece>) inv.getArgument(0));
            saved.forEach(piece -> piece.setId("piece-" + pieceSeq.incrementAndGet()));
            return saved;
        });
        when(variants.findFactsIn(eq(INST), anyCollection())).thenAnswer(inv -> new ArrayList<>(known));
        when(ledger.post(any(StockPosting.class))).thenAnswer(inv -> {
            StockMovement movement = new StockMovement();
            movement.setId("mov-1");
            movement.setUnitCost(new BigDecimal("95.0000"));
            return new StockPostResult(movement, true, 0);
        });

        StockLocation store = new StockLocation();
        store.setId("loc-1");
        store.setStatus("ACTIVE");
        when(locations.findByInstituteIdAndId(INST, "loc-1")).thenReturn(Optional.of(store));
    }

    private void item(String packageSessionId, String stockMode, String standardCost) {
        VariantFacts facts = mock(VariantFacts.class);
        when(facts.getPackageSessionId()).thenReturn(packageSessionId);
        when(facts.getSku()).thenReturn("SKU-" + packageSessionId);
        when(facts.getStockMode()).thenReturn(stockMode);
        when(facts.getStockPolicy()).thenReturn("TRACKED");
        when(facts.getStatus()).thenReturn("DRAFT"); // a DRAFT item may be received
        when(facts.getLabelCode()).thenReturn("VEXISTING2");
        when(facts.getStandardCost()).thenReturn(standardCost == null ? null : new BigDecimal(standardCost));
        known.add(facts);
    }

    private static ReceiptRequest request(String sourceKind, Object... idAndQuantity) {
        ReceiptRequest request = new ReceiptRequest();
        request.setLocationId("loc-1");
        request.setSourceKind(sourceKind);
        request.setNote("from the Tuesday van");
        request.setClientRequestId("req-1");
        List<ReceiptRequest.Line> requestLines = new ArrayList<>();
        for (int i = 0; i < idAndQuantity.length; i += 2) {
            ReceiptRequest.Line line = new ReceiptRequest.Line();
            line.setPackageSessionId((String) idAndQuantity[i]);
            line.setQuantity((Integer) idAndQuantity[i + 1]);
            requestLines.add(line);
        }
        request.setLines(requestLines);
        return request;
    }

    private List<StockPosting> posted(int times) {
        ArgumentCaptor<StockPosting> captor = ArgumentCaptor.forClass(StockPosting.class);
        verify(ledger, times(times)).post(captor.capture());
        return captor.getAllValues();
    }

    @Test
    void warehouseStaffCannotStateACostAndNoNumberIsTaken() {
        ReceiptRequest request = request("OTHER", "ps-a", 5);
        request.getLines().get(0).setUnitCost(new BigDecimal("10"));

        assertThrows(CommerceAccessDeniedException.class, () -> service.create(INST, "staff-1", false, request));

        verifyNoInteractions(counters, ledger);
    }

    @Test
    void linesArePostedInPackageSessionOrderWithTheReceiptKey() {
        item("ps-a", "QUANTITY", null);
        item("ps-b", "QUANTITY", null);

        StockReceipt receipt = service.create(INST, "staff-1", false, request("OTHER", "ps-b", 3, "ps-a", 5));

        assertEquals("GRN-000001", receipt.getReceiptNumber());
        assertEquals("NOT_APPLICABLE", receipt.getBillStatus());
        List<StockPosting> postings = posted(2);
        assertEquals("ps-a", postings.get(0).getPackageSessionId());
        assertEquals("ps-b", postings.get(1).getPackageSessionId());
        assertEquals("RECEIPT:line-1", postings.get(0).getIdempotencyKey());
        assertEquals(StockMovementType.RECEIPT, postings.get(0).getType());
        assertEquals(5, postings.get(0).getQuantityDelta());
        assertEquals("rcpt-1", postings.get(0).getReferenceId());
    }

    @Test
    void goodsWithNoBillTakeTheStandardCostAndWithoutOneTheRunningAverageAsAStandIn() {
        item("ps-a", "QUANTITY", "80");
        item("ps-b", "QUANTITY", null);

        service.create(INST, "staff-1", false, request("OPENING", "ps-a", 5, "ps-b", 3));

        List<StockPosting> postings = posted(2);
        assertEquals(CostTreatment.KNOWN, postings.get(0).getCostTreatment());
        assertEquals(new BigDecimal("80"), postings.get(0).getUnitCost());
        assertEquals("OPENING", postings.get(0).getReason());
        assertEquals(CostTreatment.PROVISIONAL, postings.get(1).getCostTreatment());
        assertNull(postings.get(1).getUnitCost());
        // Only the line with no stated cost is stamped afterwards, with what the ledger stamped.
        verify(ledger).stampReceiptLineCost(INST, "line-2", new BigDecimal("95.0000"));
        verify(ledger, never()).stampReceiptLineCost(eq(INST), eq("line-1"), any());
    }

    @Test
    void aManagersTypedCostWinsOverTheStandardCost() {
        item("ps-a", "QUANTITY", "80");
        ReceiptRequest request = request("OTHER", "ps-a", 5);
        request.getLines().get(0).setUnitCost(new BigDecimal("72.5"));

        service.create(INST, "manager-1", true, request);

        assertEquals(new BigDecimal("72.5000"), posted(1).get(0).getUnitCost());
        ArgumentCaptor<StockReceiptLine> line = ArgumentCaptor.forClass(StockReceiptLine.class);
        verify(lines).saveAndFlush(line.capture());
        assertEquals("TYPED", line.getValue().getCostSource());
    }

    @Test
    void aOneOfAKindItemGetsOnePieceAndOneMovementPerUnit() {
        item("ps-a", "PIECE", "2500");

        service.create(INST, "staff-1", false, request("OPENING", "ps-a", 3));

        ArgumentCaptor<List<CommercePiece>> saved = ArgumentCaptor.forClass(List.class);
        verify(pieces).saveAllAndFlush(saved.capture());
        assertEquals(3, saved.getValue().size());
        CommercePiece first = saved.getValue().get(0);
        assertEquals("IN_STOCK", first.getStatus());
        assertEquals("loc-1", first.getLocationId());
        assertEquals(new BigDecimal("2500"), first.getUnitCost());
        assertTrue(first.getCode().startsWith("P"));
        List<StockPosting> postings = posted(3);
        assertEquals(1, postings.get(0).getQuantityDelta());
        assertEquals("RECEIPT:line-1:piece-1", postings.get(0).getIdempotencyKey());
        assertEquals("piece-3", postings.get(2).getPieceId());
    }

    @Test
    void theSameRequestTwiceReturnsTheFirstReceiptAndADifferentOneIsRefused() {
        item("ps-a", "QUANTITY", null);
        StockReceipt first = service.create(INST, "staff-1", false, request("OTHER", "ps-a", 5));
        when(receipts.findByInstituteIdAndClientRequestId(INST, "req-1")).thenReturn(Optional.of(first));

        assertSame(first, service.create(INST, "staff-1", false, request("OTHER", "ps-a", 5)));
        ConflictException refused = assertThrows(ConflictException.class,
                () -> service.create(INST, "staff-1", false, request("OTHER", "ps-a", 6)));

        assertTrue(refused.getMessage().startsWith("IDEMPOTENCY_MISMATCH"));
        verify(ledger, times(1)).post(any());
        verify(counters, times(1)).nextNumber(INST, "GRN");
    }

    @Test
    void aForeignLocationOrItemIsRefused() {
        item("ps-a", "QUANTITY", null);
        ReceiptRequest elsewhere = request("OTHER", "ps-a", 5);
        elsewhere.setLocationId("loc-of-another-institute");
        when(locations.findByInstituteIdAndId(INST, "loc-of-another-institute")).thenReturn(Optional.empty());
        assertThrows(InvalidRequestException.class, () -> service.create(INST, "staff-1", false, elsewhere));

        ReceiptRequest foreignItem = request("OTHER", "ps-foreign", 5);
        foreignItem.setClientRequestId("req-2");
        assertThrows(InvalidRequestException.class, () -> service.create(INST, "staff-1", false, foreignItem));
        verify(ledger, never()).post(any());
    }

    @Test
    void aSupplierReceiptNeedsTheAccountsFeatureAndASupplierDirectory() {
        item("ps-a", "QUANTITY", null);
        ReceiptRequest request = request("SUPPLIER", "ps-a", 5);
        request.setSupplierId("sup-1");

        assertThrows(CommerceAccessDeniedException.class, () -> service.create(INST, "staff-1", false, request));

        when(capabilities.isFeatureGranted(INST, "commerce.accounts")).thenReturn(true);
        InvalidRequestException refused = assertThrows(InvalidRequestException.class,
                () -> service.create(INST, "staff-1", false, request));
        assertTrue(refused.getMessage().startsWith("SUPPLIERS_NOT_AVAILABLE"));
        verify(ledger, never()).post(any());
    }

    @Test
    void anOwnSourceReceiptNeedsASourceLocation() {
        item("ps-a", "QUANTITY", null);
        StockLocation notASource = new StockLocation();
        notASource.setId("loc-2");
        when(locations.findByInstituteIdAndId(INST, "loc-2")).thenReturn(Optional.of(notASource));
        ReceiptRequest request = request("OWN_SOURCE", "ps-a", 5);
        request.setSourceLocationId("loc-2");

        assertThrows(InvalidRequestException.class, () -> service.create(INST, "staff-1", false, request));

        notASource.setSource(true);
        request.setClientRequestId("req-2");
        service.create(INST, "staff-1", false, request);
        verify(ledger, times(1)).post(any());
    }

    // ── reverse ─────────────────────────────────────────────────────────────

    private void postedReceipt(int qtyBilled, String costSource, String unitCost) {
        StockReceipt receipt = new StockReceipt();
        receipt.setId("rcpt-1");
        receipt.setLocationId("loc-1");
        receipt.setReceivedDate(LocalDate.of(2026, 11, 13));
        when(receipts.findByInstituteIdAndId(INST, "rcpt-1")).thenReturn(Optional.of(receipt));
        when(receipts.lockStatus(INST, "rcpt-1")).thenReturn(Optional.of("POSTED"));
        LineRow line = mock(LineRow.class);
        when(line.getId()).thenReturn("line-1");
        when(line.getPackageSessionId()).thenReturn("ps-a");
        when(line.getQtyReceived()).thenReturn(5);
        when(line.getQtyBilled()).thenReturn(qtyBilled);
        when(line.getCostSource()).thenReturn(costSource);
        when(line.getUnitCost()).thenReturn(unitCost == null ? null : new BigDecimal(unitCost));
        when(lines.findRowsOfReceipt(INST, "rcpt-1")).thenReturn(List.of(line));
        StockMovement original = new StockMovement();
        original.setId("mov-original");
        when(movements.findByInstituteIdAndIdempotencyKey(INST, "RECEIPT:line-1")).thenReturn(Optional.of(original));
        when(pieces.findRowsByReceiptLine(INST, "line-1")).thenReturn(List.of());
    }

    @Test
    void reversingPostsTheOppositeMovementNamingTheOriginalAndMarksTheReceipt() {
        postedReceipt(0, "STANDARD", "80");
        when(receipts.markReversed(INST, "rcpt-1", "manager-1")).thenReturn(1);

        service.reverse(INST, "manager-1", "rcpt-1", "wrong item scanned");

        StockPosting posting = posted(1).get(0);
        assertEquals(StockMovementType.RECEIPT, posting.getType());
        assertEquals(-5, posting.getQuantityDelta());
        assertEquals("mov-original", posting.getReversesMovementId());
        assertEquals("RECEIPT_REVERSAL", posting.getReason());
        assertEquals("RECEIPT_REVERSAL:line-1", posting.getIdempotencyKey());
        assertEquals(new BigDecimal("80"), posting.getUnitCost());
        verify(receipts).markReversed(INST, "rcpt-1", "manager-1");
    }

    @Test
    void aProvisionalLineLeavesAtTheAverageNotAtItsStandInCost() {
        postedReceipt(0, "PROVISIONAL", "95");
        when(receipts.markReversed(INST, "rcpt-1", "manager-1")).thenReturn(1);

        service.reverse(INST, "manager-1", "rcpt-1", "wrong item scanned");

        assertNull(posted(1).get(0).getUnitCost());
    }

    @Test
    void aReceiptWithABilledQuantityCannotBeReversed() {
        postedReceipt(2, "BILL", "80");

        ConflictException refused = assertThrows(ConflictException.class,
                () -> service.reverse(INST, "manager-1", "rcpt-1", "wrong item scanned"));

        assertTrue(refused.getMessage().startsWith("RECEIPT_BILLED"));
        verify(ledger, never()).post(any());
        verify(receipts, never()).markReversed(anyString(), anyString(), anyString());
    }

    @Test
    void reversingTwiceChangesNothingTheSecondTime() {
        postedReceipt(0, "STANDARD", "80");
        when(receipts.lockStatus(INST, "rcpt-1")).thenReturn(Optional.of("REVERSED"));

        service.reverse(INST, "manager-1", "rcpt-1", "wrong item scanned");

        verify(ledger, never()).post(any());
        verify(receipts, never()).markReversed(anyString(), anyString(), anyString());
    }

    @Test
    void aReversalNeedsAReason() {
        assertThrows(InvalidRequestException.class, () -> service.reverse(INST, "manager-1", "rcpt-1", " "));
    }
}
