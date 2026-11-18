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
    private LabelQueueService service;

    private final Caller staffAtL1 = new Caller("wh-1", false, false, true, false, Set.of(L1));

    @BeforeEach
    void setUp() {
        PlatformTransactionManager tx = mock(PlatformTransactionManager.class);
        service = new LabelQueueService(repository, pieces, mock(StockVariantRepository.class), reads,
                mock(ScanCodeGenerator.class), snapshots, mock(CommerceNotificationShopSettings.class),
                new CommerceRequestGuard(requests, tx), audit, tx);
        when(requests.findByInstituteIdAndClientRequestId(anyString(), anyString())).thenReturn(Optional.empty());
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
        return new ItemFacts(variant, "pkg", "SKU-1", "Cotton scarf", Map.of("en", "Cotton scarf"), "One size",
                stockMode, policy, "ACTIVE", productStatus, "PCS", 1, 1, null, null, null, "0000", null);
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
        // A tracked PIECE item never takes a quantity label.
        when(reads.itemFacts(eq(INST), anyCollection())).thenReturn(Map.of("ps-scarf",
                item("ps-scarf", "PIECE", "TRACKED", "ACTIVE")));
        InvalidRequestException quantity = assertThrows(InvalidRequestException.class, () -> service.request(INST,
                staffAtL1, new LabelDtos.LabelRequestsRequest("labels-0002", L1, "PRICE_CHANGE", null, null,
                        List.of(new LabelDtos.LabelLineInput("ps-scarf", 1, null, null)))));
        assertTrue(quantity.getMessage().startsWith("PIECE_SCAN_REQUIRED"), quantity.getMessage());
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
