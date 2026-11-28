package vacademy.io.admin_core_service.features.commerce.label.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.common.request.CommerceRequestGuard;
import vacademy.io.admin_core_service.features.commerce.common.request.CommerceRequestRepository;
import vacademy.io.admin_core_service.features.commerce.label.dto.LabelDtos;
import vacademy.io.admin_core_service.features.commerce.label.entity.CommerceLabelRequest;
import vacademy.io.admin_core_service.features.commerce.label.repository.CommerceLabelRequestRepository;
import vacademy.io.admin_core_service.features.commerce.notify.CommerceNotificationShopSettings;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessDeniedException;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.Caller;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockReceiptLine;
import vacademy.io.admin_core_service.features.commerce.stock.repository.CommercePieceRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.CommercePieceRepository.PieceRow;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockOpsReadRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockOpsReadRepository.ItemFacts;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockVariantRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockVariantRepository.VariantFacts;
import vacademy.io.admin_core_service.features.commerce.stock.service.ScanCodeGenerator;
import vacademy.io.admin_core_service.features.commerce.storefront.service.StorefrontSnapshotLoader;
import vacademy.io.admin_core_service.features.commerce.storefront.service.StorefrontSnapshotLoader.CartVariant;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The label queue: what a receipt queues (one row a piece, one row a quantity line, one label for
 * a measured item), the rules of a manual request (a reprint says why and is audited; a piece is
 * labelled where it lies, by staff of that place), mark printed stamping today's price and MRP,
 * and print data refusing a printed row.
 */
class LabelQueueServiceTest {

    private static final String INST = "inst-1";
    private static final String L1 = "loc-store";
    private static final String L2 = "loc-wh";

    private final CommerceLabelRequestRepository repository = mock(CommerceLabelRequestRepository.class);
    private final CommercePieceRepository pieces = mock(CommercePieceRepository.class);
    private final StockOpsReadRepository reads = mock(StockOpsReadRepository.class);
    private final StorefrontSnapshotLoader snapshots = mock(StorefrontSnapshotLoader.class);
    private final CommerceAuditService audit = mock(CommerceAuditService.class);
    private final CommerceRequestRepository requests = mock(CommerceRequestRepository.class);
    private final CommerceNotificationShopSettings shopSettings = mock(CommerceNotificationShopSettings.class);
    private LabelQueueService service;

    private final Caller staffAtL1 = new Caller("wh-1", false, false, true, false, Set.of(L1));

    @BeforeEach
    void setUp() {
        PlatformTransactionManager tx = mock(PlatformTransactionManager.class);
        service = new LabelQueueService(repository, pieces, mock(StockVariantRepository.class), reads,
                mock(ScanCodeGenerator.class), snapshots, shopSettings,
                new CommerceRequestGuard(requests, tx), audit, tx);
        when(requests.findByInstituteIdAndClientRequestId(anyString(), anyString())).thenReturn(Optional.empty());
        when(reads.locationOfInstitute(INST, L1)).thenReturn(true);
        when(reads.locationOfInstitute(INST, L2)).thenReturn(true);
        when(shopSettings.read(INST)).thenReturn(new CommerceNotificationShopSettings.Shop(null, 0, Map.of()));
        when(repository.saveAllAndFlush(anyList())).thenAnswer(call -> {
            List<CommerceLabelRequest> rows = call.getArgument(0);
            int n = 0;
            for (CommerceLabelRequest row : rows) {
                row.setId("row-" + (++n));
            }
            return rows;
        });
    }

    private static StockReceiptLine receiptLine(String variant, int quantity) {
        StockReceiptLine line = new StockReceiptLine();
        line.setPackageSessionId(variant);
        line.setQtyReceived(quantity);
        return line;
    }

    private static VariantFacts scale(int qtyScale) {
        VariantFacts facts = mock(VariantFacts.class);
        when(facts.getQtyScale()).thenReturn(qtyScale);
        return facts;
    }

    private static PieceRow piece(String id, String status, String location) {
        PieceRow piece = mock(PieceRow.class);
        when(piece.getId()).thenReturn(id);
        when(piece.getCode()).thenReturn("PABCDEFGH2");
        when(piece.getPackageSessionId()).thenReturn("ps-scarf");
        when(piece.getStatus()).thenReturn(status);
        when(piece.getLocationId()).thenReturn(location);
        return piece;
    }

    private static ItemFacts item(String variant, String stockMode, String policy, String productStatus) {
        return item(variant, stockMode, policy, productStatus, "PCS", 1);
    }

    private static ItemFacts item(String variant, String stockMode, String policy, String productStatus, String unit,
                                  int qtyScale) {
        return new ItemFacts(variant, "pkg", "SKU-" + variant, "Cotton scarf", Map.of("en", "Cotton scarf"),
                "One size", stockMode, policy, "ACTIVE", productStatus, unit, qtyScale, 1, "VLABEL0001", null, null,
                "0000", null);
    }

    private static CartVariant priced(String price) {
        CartVariant variant = mock(CartVariant.class);
        when(variant.price()).thenReturn(price == null ? null : new BigDecimal(price));
        when(variant.names()).thenReturn(Map.of("en", "Item"));
        when(variant.options()).thenReturn(List.of());
        return variant;
    }

    private static CommerceLabelRequest pending(String id, String variant, int quantity) {
        CommerceLabelRequest row = new CommerceLabelRequest();
        row.setId(id);
        row.setInstituteId(INST);
        row.setLocationId(L1);
        row.setPackageSessionId(variant);
        row.setStatus("PENDING");
        row.setQuantity(quantity);
        row.setSourceType("MANUAL");
        row.setSourceId("group-1");
        return row;
    }

    private static LabelDtos.LabelRequestsRequest ask(String reason, String reprintReason, String note,
                                                      LabelDtos.LabelLineInput line) {
        return new LabelDtos.LabelRequestsRequest("labels-0001", L1, reason, reprintReason, note, List.of(line));
    }

    @Test
    void aReceiptQueuesARowAPieceAndARowAQuantityLine() {
        service.queueReceiptLine(INST, L1, "rcpt-1", receiptLine("ps-scarf", 2), scale(1), List.of("p-1", "p-2"),
                "wh-1");
        verify(repository).queueReceiptRow(anyString(), eq(INST), eq(L1), eq("ps-scarf"), eq("p-1"), eq(1),
                eq("rcpt-1"), eq("wh-1"));
        verify(repository).queueReceiptRow(anyString(), eq(INST), eq(L1), eq("ps-scarf"), eq("p-2"), eq(1),
                eq("rcpt-1"), eq("wh-1"));
        service.queueReceiptLine(INST, L1, "rcpt-1", receiptLine("ps-bottle", 3), scale(1), List.of(), "wh-1");
        verify(repository).queueReceiptRow(anyString(), eq(INST), eq(L1), eq("ps-bottle"), isNull(), eq(3),
                eq("rcpt-1"), eq("wh-1"));
        // A measured item: one label for the roll; a huge line is one row of the table's maximum.
        service.queueReceiptLine(INST, L1, "rcpt-1", receiptLine("ps-cloth", 300), scale(10), null, "wh-1");
        verify(repository).queueReceiptRow(anyString(), eq(INST), eq(L1), eq("ps-cloth"), isNull(), eq(1),
                eq("rcpt-1"), eq("wh-1"));
        service.queueReceiptLine(INST, L1, "rcpt-2", receiptLine("ps-spoon", 25_000), null, null, "wh-1");
        verify(repository).queueReceiptRow(anyString(), eq(INST), eq(L1), eq("ps-spoon"), isNull(),
                eq(LabelQueueService.MAX_QUANTITY), eq("rcpt-2"), eq("wh-1"));
    }

    @Test
    void aReversedReceiptCancelsItsPendingRows() {
        when(repository.cancelPendingOfSource(INST, "STOCK_RECEIPT", "rcpt-1", "m-1")).thenReturn(3);
        assertEquals(3, service.cancelPendingOfSource(INST, "STOCK_RECEIPT", "rcpt-1", "m-1"));
    }

    @Test
    void aReprintSaysWhyAndIsAudited() {
        LabelDtos.LabelLineInput bottles = new LabelDtos.LabelLineInput("ps-bottle", 2, null, null);
        when(reads.itemFacts(eq(INST), anyCollection())).thenReturn(Map.of("ps-bottle",
                item("ps-bottle", "QUANTITY", "TRACKED", "ACTIVE")));
        for (LabelDtos.LabelRequestsRequest bad : List.of(ask("REPRINT", null, null, bottles),
                ask("REPRINT", "OTHER", null, bottles), ask("PRICE_CHANGE", "TORN", null, bottles),
                ask("NEW_RECEIPT", null, null, bottles), ask("REPRINT", "TORN", "x".repeat(201), bottles))) {
            InvalidRequestException refused = assertThrows(InvalidRequestException.class,
                    () -> service.request(INST, staffAtL1, bad));
            assertTrue(refused.getMessage().startsWith("VALIDATION"), refused.getMessage());
        }
        verify(repository, never()).saveAllAndFlush(anyList());

        LabelDtos.LabelsAnswer answer = service.request(INST, staffAtL1, ask("REPRINT", "TORN", null, bottles));
        assertEquals(1, answer.requests().size());
        assertEquals(2, answer.requests().get(0).quantity());
        assertEquals("REPRINT", answer.requests().get(0).reason());
        assertEquals("TORN", answer.requests().get(0).reprintReason());
        assertEquals(L1, answer.requests().get(0).locationId());
        verify(audit).record(eq(INST), eq("wh-1"), eq(L1), eq("LABEL_REPRINT"), anyString(), eq("row-1"), isNull(),
                anyString(), isNull());
    }

    @Test
    void aPieceIsLabelledWhereItLiesByStaffOfThatPlace() {
        PieceRow sold = piece("p-sold", "SOLD", null);
        PieceRow atL2 = piece("p-l2", "IN_STOCK", L2);
        PieceRow atL1 = piece("p-l1", "RESERVED", L1);
        when(pieces.findRow(INST, "p-sold")).thenReturn(Optional.of(sold));
        when(pieces.findRow(INST, "p-l2")).thenReturn(Optional.of(atL2));
        when(pieces.findRow(INST, "p-l1")).thenReturn(Optional.of(atL1));
        ConflictException gone = assertThrows(ConflictException.class, () -> service.request(INST, staffAtL1,
                ask("REPRINT", "LOST", null, new LabelDtos.LabelLineInput(null, null, "p-sold", null))));
        assertTrue(gone.getMessage().startsWith("PIECE_NOT_HERE"), gone.getMessage());
        CommerceAccessDeniedException elsewhere = assertThrows(CommerceAccessDeniedException.class,
                () -> service.request(INST, staffAtL1, ask("REPRINT", "LOST", null,
                        new LabelDtos.LabelLineInput(null, null, "p-l2", null))));
        assertEquals("LOCATION_NOT_ALLOWED", elsewhere.getCode());
        LabelDtos.LabelsAnswer answer = service.request(INST, staffAtL1, ask("REPRINT", "LOST", null,
                new LabelDtos.LabelLineInput(null, null, "p-l1", null)));
        assertEquals("p-l1", answer.requests().get(0).pieceId());
        assertEquals(1, answer.requests().get(0).quantity());
        // A tracked PIECE item never takes a quantity label: a reprint scans the piece.
        when(reads.itemFacts(eq(INST), anyCollection())).thenReturn(Map.of("ps-scarf",
                item("ps-scarf", "PIECE", "TRACKED", "ACTIVE")));
        InvalidRequestException quantity = assertThrows(InvalidRequestException.class, () -> service.request(INST,
                staffAtL1, new LabelDtos.LabelRequestsRequest("labels-0002", L1, "REPRINT", "TORN", null,
                        List.of(new LabelDtos.LabelLineInput("ps-scarf", 1, null, null)))));
        assertTrue(quantity.getMessage().startsWith("PIECE_SCAN_REQUIRED"), quantity.getMessage());
    }

    @Test
    void aPriceChangeLabelsEveryPieceOnTheShelfAndOneLabelPerRoll() {
        when(reads.itemFacts(eq(INST), anyCollection())).thenReturn(Map.of(
                "ps-scarf", item("ps-scarf", "PIECE", "TRACKED", "ACTIVE"),
                "ps-cloth", item("ps-cloth", "QUANTITY", "TRACKED", "ACTIVE", "MTR", 10)));
        // No piece on the shelf here: nothing to relabel.
        when(reads.piecesOnShelf(eq(INST), eq(L1), anyCollection())).thenReturn(Map.of());
        ConflictException none = assertThrows(ConflictException.class, () -> service.request(INST, staffAtL1,
                new LabelDtos.LabelRequestsRequest("labels-0003", L1, "PRICE_CHANGE", null, null,
                        List.of(new LabelDtos.LabelLineInput("ps-scarf", null, null, null)))));
        assertTrue(none.getMessage().startsWith("PIECE_NOT_HERE"), none.getMessage());
        // A measured item gets one label per roll, never one per base unit.
        InvalidRequestException perUnit = assertThrows(InvalidRequestException.class, () -> service.request(INST,
                staffAtL1, new LabelDtos.LabelRequestsRequest("labels-0004", L1, "PRICE_CHANGE", null, null,
                        List.of(new LabelDtos.LabelLineInput("ps-cloth", 200, null, null)))));
        assertTrue(perUnit.getMessage().contains("one label per roll"), perUnit.getMessage());

        when(reads.piecesOnShelf(eq(INST), eq(L1), anyCollection())).thenReturn(Map.of("ps-scarf",
                List.of("p-1", "p-2", "p-3")));
        LabelDtos.LabelsAnswer answer = service.request(INST, staffAtL1, new LabelDtos.LabelRequestsRequest(
                "labels-0005", L1, "PRICE_CHANGE", null, null, List.of(
                new LabelDtos.LabelLineInput("ps-scarf", 1, null, null),
                new LabelDtos.LabelLineInput("ps-cloth", 2, null, null))));
        assertEquals(4, answer.requests().size(), "3 pieces + 1 cloth row");
        assertEquals(List.of("p-1", "p-2", "p-3"), answer.requests().stream()
                .filter(r -> r.pieceId() != null).map(LabelDtos.LabelRow::pieceId).toList());
        LabelDtos.LabelRow cloth = answer.requests().stream().filter(r -> "ps-cloth".equals(r.packageSessionId()))
                .findFirst().orElseThrow();
        assertEquals(2, cloth.quantity());
        assertEquals("MTR", cloth.unit());
        assertEquals(10, cloth.qtyScale());
        assertEquals("QUANTITY", cloth.stockMode());
    }

    @Test
    void aLocationOfAnotherInstituteIsRefused() {
        when(reads.itemFacts(eq(INST), anyCollection())).thenReturn(Map.of("ps-bottle",
                item("ps-bottle", "QUANTITY", "TRACKED", "ACTIVE")));
        InvalidRequestException refused = assertThrows(InvalidRequestException.class, () -> service.request(INST,
                new Caller("ad-1", true, true, true, true, null), new LabelDtos.LabelRequestsRequest("labels-0006",
                        "loc-foreign", "REPRINT", "TORN", null,
                        List.of(new LabelDtos.LabelLineInput("ps-bottle", 1, null, null)))));
        assertTrue(refused.getMessage().startsWith("LOCATION_NOT_FOUND"), refused.getMessage());
        verify(repository, never()).saveAllAndFlush(anyList());
    }

    @Test
    void printDataSkipsItemsWithoutAPriceAndMarkPrintedSkipsWhatIsDone() {
        CommerceLabelRequest bottle = pending("row-1", "ps-bottle", 3);
        CommerceLabelRequest quick = pending("row-2", "ps-quick", 2);
        when(repository.findByInstituteIdAndIdIn(INST, List.of("row-1", "row-2"))).thenReturn(List.of(bottle, quick));
        when(reads.itemFacts(eq(INST), anyCollection())).thenReturn(Map.of(
                "ps-bottle", item("ps-bottle", "QUANTITY", "TRACKED", "ACTIVE"),
                "ps-quick", item("ps-quick", "QUANTITY", "TRACKED", "DRAFT")));
        CartVariant bottlePrice = priced("450.00");
        CartVariant noPrice = priced(null);
        when(snapshots.cartVariants(eq(INST), anyCollection(), anyList())).thenReturn(Map.of("ps-bottle", bottlePrice,
                "ps-quick", noPrice));
        LabelDtos.PrintDataAnswer data = service.printData(INST, staffAtL1,
                new LabelDtos.PrintDataRequest(List.of("row-1", "row-2"), null, null));
        assertEquals(1, data.labels().size());
        assertEquals(3, data.totalCopies());
        assertEquals(1, data.skipped().size());
        assertEquals("row-2", data.skipped().get(0).requestId());
        assertEquals("NO_PRICE", data.skipped().get(0).reason());
        // Only unpriced rows: nothing to print.
        when(repository.findByInstituteIdAndIdIn(INST, List.of("row-2"))).thenReturn(List.of(quick));
        ConflictException nothing = assertThrows(ConflictException.class, () -> service.printData(INST, staffAtL1,
                new LabelDtos.PrintDataRequest(List.of("row-2"), null, null)));
        assertTrue(nothing.getMessage().startsWith("LABEL_NO_PRICE"), nothing.getMessage());

        // A second chunk naming a row already printed: skipped, not refused.
        when(repository.findByInstituteIdAndIdIn(INST, List.of("row-1", "row-2", "row-gone")))
                .thenReturn(List.of(bottle, quick));
        when(repository.markPrinted(eq(INST), eq("row-1"), any(LocalDateTime.class), eq("wh-1"), any(), any()))
                .thenReturn(0);
        when(repository.markPrinted(eq(INST), eq("row-2"), any(LocalDateTime.class), eq("wh-1"), any(), any()))
                .thenReturn(1);
        LabelDtos.PrintedAnswer printed = service.markPrinted(INST, staffAtL1,
                new LabelDtos.LabelIdsRequest("printed-0009", List.of("row-1", "row-2", "row-gone")));
        assertEquals(1, printed.printed());
        assertEquals(List.of("row-1", "row-gone"), printed.skipped());
    }

    /** Item 1: a receipt line of more than 500 units prints in rounds of at most 500, never blocks the rest. */
    @Test
    void printDataDrawsAtMost500LabelsAndMarkPrintedKeepsTheRestWaiting() {
        CommerceLabelRequest big = pending("row-1", "ps-bottle", 1200);
        CommerceLabelRequest small = pending("row-2", "ps-spoon", 3);
        when(repository.findByInstituteIdAndIdIn(INST, List.of("row-1", "row-2"))).thenReturn(List.of(big, small));
        when(reads.itemFacts(eq(INST), anyCollection())).thenReturn(Map.of(
                "ps-bottle", item("ps-bottle", "QUANTITY", "TRACKED", "ACTIVE"),
                "ps-spoon", item("ps-spoon", "QUANTITY", "TRACKED", "ACTIVE")));
        CartVariant bottlePrice = priced("450.00");
        CartVariant spoonPrice = priced("60.00");
        when(snapshots.cartVariants(eq(INST), anyCollection(), anyList())).thenReturn(Map.of("ps-bottle", bottlePrice,
                "ps-spoon", spoonPrice));
        LabelDtos.PrintDataAnswer data = service.printData(INST, staffAtL1,
                new LabelDtos.PrintDataRequest(List.of("row-1", "row-2"), null, null));
        assertEquals(500, data.totalCopies(), "one print draws at most 500 labels");
        assertEquals(1, data.labels().size());
        assertEquals("row-1", data.labels().get(0).requestId());
        assertEquals(500, data.labels().get(0).copies());
        assertEquals(703, data.leftOutCopies());
        assertEquals(List.of(new LabelDtos.LeftOutLabel("row-1", "SKU-ps-bottle", 700),
                new LabelDtos.LeftOutLabel("row-2", "SKU-ps-spoon", 3)), data.leftOut());

        // "Yes, printed" for the drawn part: the row keeps waiting with 700, nothing is stamped printed.
        when(repository.findByInstituteIdAndIdIn(INST, List.of("row-1"))).thenReturn(List.of(big));
        // The part print is stamped with the price it printed at, so "Tags to replace" sees those labels.
        when(repository.markPartlyPrinted(INST, "row-1", 500, new BigDecimal("450.00"), new BigDecimal("450.00")))
                .thenReturn(1);
        LabelDtos.PrintedAnswer part = service.markPrinted(INST, staffAtL1,
                new LabelDtos.LabelIdsRequest("printed-0101", List.of("row-1"), Map.of("row-1", 500)));
        assertEquals(0, part.printed());
        assertEquals(List.of("row-1"), part.partly());
        verify(repository, never()).markPrinted(anyString(), anyString(), any(), anyString(), any(), any());
        verify(audit).record(eq(INST), eq("wh-1"), eq(L1), eq(LabelQueueService.AUDIT_PART_PRINTED), anyString(),
                eq("row-1"), isNull(), anyString(), isNull());

        // The last round: fewer labels left than were drawn, so the row is printed in full.
        when(repository.markPartlyPrinted(eq(INST), eq("row-1"), eq(200), any(), any())).thenReturn(0);
        when(repository.markPrinted(eq(INST), eq("row-1"), any(LocalDateTime.class), eq("wh-1"), any(), any()))
                .thenReturn(1);
        LabelDtos.PrintedAnswer last = service.markPrinted(INST, staffAtL1,
                new LabelDtos.LabelIdsRequest("printed-0102", List.of("row-1"), Map.of("row-1", 200)));
        assertEquals(1, last.printed());
        assertEquals(null, last.partly());

        // printed_copies names only ids of the request, 1 to 500 each.
        assertThrows(InvalidRequestException.class, () -> service.markPrinted(INST, staffAtL1,
                new LabelDtos.LabelIdsRequest("printed-0103", List.of("row-1"), Map.of("row-9", 5))));
        assertThrows(InvalidRequestException.class, () -> service.markPrinted(INST, staffAtL1,
                new LabelDtos.LabelIdsRequest("printed-0104", List.of("row-1"), Map.of("row-1", 501))));
    }

    /** Review m6: a round naming a row printed elsewhere leaves that row out and says so. */
    @Test
    void printDataLeavesOutARowPrintedElsewhere() {
        CommerceLabelRequest done = pending("row-1", "ps-bottle", 3);
        done.setStatus("PRINTED");
        CommerceLabelRequest waiting = pending("row-2", "ps-spoon", 2);
        when(repository.findByInstituteIdAndIdIn(INST, List.of("row-1", "row-2"))).thenReturn(List.of(done, waiting));
        when(reads.itemFacts(eq(INST), anyCollection())).thenReturn(Map.of(
                "ps-bottle", item("ps-bottle", "QUANTITY", "TRACKED", "ACTIVE"),
                "ps-spoon", item("ps-spoon", "QUANTITY", "TRACKED", "ACTIVE")));
        CartVariant spoonPrice = priced("60.00");
        when(snapshots.cartVariants(eq(INST), anyCollection(), anyList())).thenReturn(Map.of("ps-spoon", spoonPrice));
        LabelDtos.PrintDataAnswer data = service.printData(INST, staffAtL1,
                new LabelDtos.PrintDataRequest(List.of("row-1", "row-2"), null, null));
        assertEquals(List.of("row-2"), data.labels().stream().map(LabelDtos.PrintLabel::requestId).toList());
        assertEquals(List.of(new LabelDtos.SkippedLabel("row-1", "SKU-ps-bottle", "NOT_PENDING")), data.skipped());
    }

    /** Review m4: a row printed in rounds shows the labels it was queued with and how many are printed. */
    @Test
    void aRowPrintedInRoundsShowsItsOriginalQuantity() {
        CommerceLabelRequest big = pending("row-1", "ps-bottle", 200);
        big.setSourceType("STOCK_RECEIPT");
        big.setSourceId("rcpt-1");
        when(repository.search(anyString(), eq(true), anyCollection(), any(), any(), any(), any(), any(), any()))
                .thenReturn(new org.springframework.data.domain.PageImpl<>(List.of(big)));
        CommerceLabelRequestRepository.PartPrinted part = mock(CommerceLabelRequestRepository.PartPrinted.class);
        when(part.getRequestId()).thenReturn("row-1");
        when(part.getCopies()).thenReturn(1000L);
        when(repository.partPrinted(INST, List.of("row-1"))).thenReturn(List.of(part));
        LabelDtos.LabelRow row = service.list(INST, new Caller("ad-1", true, true, true, true, null), null, null, null,
                null, null, 0, 50).requests().get(0);
        assertEquals(200, row.quantity(), "still waiting");
        assertEquals(1200, row.originalQuantity());
        assertEquals(1000, row.printedQuantity());
    }

    @Test
    void cancelRefusesPrintedCopies() {
        assertThrows(InvalidRequestException.class, () -> service.cancel(INST, staffAtL1,
                new LabelDtos.LabelIdsRequest("cancel-0001", List.of("row-1"), Map.of("row-1", 5))));
        verify(repository, never()).cancelPending(anyString(), anyCollection(), anyString());
    }

    @Test
    void tagsToReplaceSayHowManyLabelsEachItemNeeds() {
        CommerceLabelRequestRepository.LastPrinted scarf = last("ps-scarf");
        CommerceLabelRequestRepository.LastPrinted cloth = last("ps-cloth");
        CommerceLabelRequestRepository.LastPrinted spoon = last("ps-spoon");
        when(repository.lastPrinted(INST, L1)).thenReturn(List.of(scarf, cloth, spoon));
        CartVariant scarfPrice = priced("1300.00");
        CartVariant clothPrice = priced("30.00");
        CartVariant spoonPrice = priced("60.00");
        when(snapshots.cartVariants(eq(INST), anyCollection(), anyList())).thenReturn(Map.of(
                "ps-scarf", scarfPrice, "ps-cloth", clothPrice, "ps-spoon", spoonPrice));
        when(reads.itemFacts(eq(INST), anyCollection())).thenReturn(Map.of(
                "ps-scarf", item("ps-scarf", "PIECE", "TRACKED", "ACTIVE"),
                "ps-cloth", item("ps-cloth", "QUANTITY", "TRACKED", "ACTIVE", "MTR", 10),
                "ps-spoon", item("ps-spoon", "QUANTITY", "TRACKED", "ACTIVE")));
        when(reads.onHandAt(eq(INST), eq(L1), anyCollection())).thenReturn(Map.of("ps-scarf", 2, "ps-cloth", 200,
                "ps-spoon", 900));
        when(reads.piecesOnShelf(eq(INST), eq(L1), anyCollection())).thenReturn(Map.of("ps-scarf",
                List.of("p-1", "p-2")));
        Map<String, LabelDtos.ReplaceRow> rows = new java.util.HashMap<>();
        service.toReplace(INST, L1).rows().forEach(r -> rows.put(r.packageSessionId(), r));
        assertEquals(2, rows.get("ps-scarf").labels(), "one per piece on the shelf");
        assertEquals("PIECE", rows.get("ps-scarf").stockMode());
        assertEquals(1, rows.get("ps-cloth").labels(), "one per roll, not 200");
        assertEquals(10, rows.get("ps-cloth").qtyScale());
        assertEquals(500, rows.get("ps-spoon").labels());
        assertTrue(rows.get("ps-spoon").capped());
        assertTrue(rows.get("ps-spoon").hasPrice());
    }

    private static CommerceLabelRequestRepository.LastPrinted last(String variant) {
        CommerceLabelRequestRepository.LastPrinted row = mock(CommerceLabelRequestRepository.LastPrinted.class);
        when(row.getPackageSessionId()).thenReturn(variant);
        when(row.getPrintedPrice()).thenReturn(new BigDecimal("1.00"));
        return row;
    }

    @Test
    void markPrintedStampsTodaysPriceAndMrp() {
        CommerceLabelRequest row = new CommerceLabelRequest();
        row.setId("row-1");
        row.setInstituteId(INST);
        row.setLocationId(L1);
        row.setPackageSessionId("ps-bottle");
        row.setStatus("PENDING");
        row.setQuantity(3);
        when(repository.findByInstituteIdAndIdIn(INST, List.of("row-1"))).thenReturn(List.of(row));
        CartVariant noMrp = mock(CartVariant.class);
        when(noMrp.price()).thenReturn(new BigDecimal("450.00"));
        when(snapshots.cartVariants(eq(INST), anyCollection(), anyList())).thenReturn(Map.of("ps-bottle", noMrp));
        when(repository.markPrinted(eq(INST), eq("row-1"), any(LocalDateTime.class), eq("wh-1"), any(), any()))
                .thenReturn(1);
        LabelDtos.PrintedAnswer answer = service.markPrinted(INST, staffAtL1,
                new LabelDtos.LabelIdsRequest("printed-0001", List.of("row-1")));
        assertEquals(1, answer.printed());
        // No MRP: the price is the MRP printed.
        verify(repository).markPrinted(eq(INST), eq("row-1"), any(LocalDateTime.class), eq("wh-1"),
                eq(new BigDecimal("450.00")), eq(new BigDecimal("450.00")));

        // Print data refuses a row that is not PENDING.
        row.setStatus("PRINTED");
        ConflictException printed = assertThrows(ConflictException.class, () -> service.printData(INST, staffAtL1,
                new LabelDtos.PrintDataRequest(List.of("row-1"), null, null)));
        assertTrue(printed.getMessage().startsWith("LABEL_NOT_PENDING"), printed.getMessage());
        // Staff of another place cannot mark it.
        Caller staffAtL2 = new Caller("wh-2", false, false, true, false, Set.of(L2));
        assertEquals("LOCATION_NOT_ALLOWED", assertThrows(CommerceAccessDeniedException.class,
                () -> service.markPrinted(INST, staffAtL2, new LabelDtos.LabelIdsRequest("printed-0002",
                        List.of("row-1")))).getCode());
        verify(repository, times(1)).markPrinted(anyString(), anyString(), any(), anyString(), any(), any());
        verify(repository, never()).cancelPending(anyString(), anyCollection(), anyString());
    }
}
