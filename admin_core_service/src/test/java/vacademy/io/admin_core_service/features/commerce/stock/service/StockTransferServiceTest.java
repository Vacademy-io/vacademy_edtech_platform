package vacademy.io.admin_core_service.features.commerce.stock.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.function.Executable;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.common.request.CommerceRequestGuard;
import vacademy.io.admin_core_service.features.commerce.common.request.CommerceRequestRepository;
import vacademy.io.admin_core_service.features.commerce.document.repository.CommerceDocumentSeriesRepository;
import vacademy.io.admin_core_service.features.commerce.document.service.CommerceDocumentNumberService;
import vacademy.io.admin_core_service.features.commerce.document.service.CommerceSellerLookup;
import vacademy.io.admin_core_service.features.commerce.document.service.DocumentClock;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceStockShortFlagger;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessDeniedException;
import vacademy.io.admin_core_service.features.commerce.security.CommerceApprovalService;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.CancelRequest;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.Caller;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.ReceiveLineInput;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.TransferDispatchRequest;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.TransferLineInput;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.TransferReceiveRequest;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.TransferUpdateRequest;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockLocation;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockTransfer;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockTransferLine;
import vacademy.io.admin_core_service.features.commerce.stock.repository.CommercePieceRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.CommercePieceRepository.PieceRow;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLocationRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockOpsReadRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockOpsReadRepository.ItemFacts;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockTransferLineRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockTransferRepository;
import vacademy.io.admin_core_service.features.commerce.storefront.service.StorefrontSnapshotLoader;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxMode;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxContext;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxSettingService;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Transfer rules that need no database: the lines (piece against quantity, twice, untracked,
 * retired, a piece not at the source), the GSTIN rule of a dispatch (equal, different, both
 * empty; the external document by a manager only), the receive sheet (above sent, a reason for a
 * shortfall and none without one, every line once) and the state table (a dispatched transfer is
 * not cancelled or edited; only a dispatched one is received).
 */
class StockTransferServiceTest {

    private static final String INST = "inst-1";
    private static final String L1 = "loc-store";
    private static final String L2 = "loc-wh";
    private static final String L3 = "loc-other";
    private static final String KEY = "transfer-0001";

    private final StockTransferRepository transfers = mock(StockTransferRepository.class);
    private final StockTransferLineRepository lines = mock(StockTransferLineRepository.class);
    private final StockLocationRepository locations = mock(StockLocationRepository.class);
    private final CommercePieceRepository pieces = mock(CommercePieceRepository.class);
    private final StockOpsReadRepository reads = mock(StockOpsReadRepository.class);
    private final StockLedgerService ledger = mock(StockLedgerService.class);
    private final CommerceSellerLookup sellers = mock(CommerceSellerLookup.class);
    private final CommerceTaxSettingService taxSettings = mock(CommerceTaxSettingService.class);
    private final CommerceDocumentNumberService numbers = mock(CommerceDocumentNumberService.class);
    private final CommerceRequestRepository requests = mock(CommerceRequestRepository.class);
    private StockTransferService service;

    private final Caller staffAtL2 = new Caller("wh-2", false, false, true, false, Set.of(L2));
    private final Caller manager = new Caller("manager-m", false, true, true, true, Set.of(L1, L2, L3));

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        PlatformTransactionManager tx = mock(PlatformTransactionManager.class);
        service = new StockTransferService(transfers, lines, locations, pieces, reads, ledger,
                mock(CommerceCounterService.class), new CommerceRequestGuard(requests, tx),
                mock(CommerceAuditService.class), sellers, taxSettings, numbers,
                mock(CommerceDocumentSeriesRepository.class), mock(DocumentClock.class),
                mock(StorefrontSnapshotLoader.class), mock(CommerceStockSettings.class),
                mock(CommerceApprovalService.class), (ObjectProvider<CommerceStockShortFlagger>) mock(ObjectProvider.class),
                tx);
        when(requests.findByInstituteIdAndClientRequestId(anyString(), anyString())).thenReturn(Optional.empty());
        when(taxSettings.context(INST)).thenReturn(CommerceTaxContext.builder().configured(true).mode(TaxMode.REGULAR)
                .sellerGstin("09AAACH7409R1ZZ").fyStartMonth(4).build());
        for (String id : List.of(L1, L2, L3)) {
            StockLocation location = new StockLocation();
            location.setId(id);
            location.setInstituteId(INST);
            location.setName("Place " + id);
            location.setStatus("ACTIVE");
            when(locations.findByInstituteIdAndId(INST, id)).thenReturn(Optional.of(location));
        }
        when(locations.findByInstituteIdOrderByCodeAsc(INST)).thenReturn(List.of());
    }

    private static String code(Executable call) {
        RuntimeException e = assertThrows(RuntimeException.class, call);
        if (e instanceof CommerceAccessDeniedException denied) {
            return denied.getCode();
        }
        String message = String.valueOf(e.getMessage());
        return message.contains(":") ? message.substring(0, message.indexOf(':')) : message;
    }

    private static ItemFacts item(String variant, String stockMode, String policy, String variantStatus) {
        return new ItemFacts(variant, "pkg-" + variant, "SKU-" + variant, "Item " + variant, Map.of(), "One size",
                stockMode, policy, variantStatus, "ACTIVE", "PCS", 1, 1, null, null, null, "0000", null);
    }

    private static PieceRow piece(String id, String status, String location) {
        PieceRow piece = mock(PieceRow.class);
        when(piece.getId()).thenReturn(id);
        when(piece.getCode()).thenReturn("P" + id.toUpperCase().replace("-", ""));
        when(piece.getPackageSessionId()).thenReturn("ps-scarf");
        when(piece.getStatus()).thenReturn(status);
        when(piece.getLocationId()).thenReturn(location);
        return piece;
    }

    private static StockTransferLine line(String id, int sent, String pieceId) {
        StockTransferLine line = new StockTransferLine();
        line.setId(id);
        line.setQtySent(sent);
        line.setPieceId(pieceId);
        line.setPackageSessionId(pieceId == null ? "ps-bottle" : "ps-scarf");
        return line;
    }

    private StockTransfer transfer(String status, String from, String to) {
        StockTransfer transfer = new StockTransfer();
        transfer.setId("t-1");
        transfer.setInstituteId(INST);
        transfer.setTransferNumber("TRF-000001");
        transfer.setFromLocationId(from);
        transfer.setToLocationId(to);
        transfer.setStatus(status);
        when(transfers.findByInstituteIdAndId(INST, "t-1")).thenReturn(Optional.of(transfer));
        when(transfers.lockForUpdate(INST, "t-1")).thenReturn(Optional.of(transfer));
        when(lines.findByInstituteIdAndTransferIdOrderByCreatedAtAscIdAsc(INST, "t-1"))
                .thenReturn(List.of(line("line-1", 2, null)));
        return transfer;
    }

    private void gstins(String from, String to) {
        when(sellers.resolve(eq(INST), eq(L2), any())).thenReturn(CommerceSellerLookup.Seller.builder().gstin(from)
                .build());
        when(sellers.resolve(eq(INST), eq(L3), any())).thenReturn(CommerceSellerLookup.Seller.builder().gstin(to)
                .build());
        when(sellers.resolve(eq(INST), eq(L1), any())).thenReturn(CommerceSellerLookup.Seller.builder().gstin(from)
                .build());
    }

    private static TransferDispatchRequest send(String type, String number) {
        return new TransferDispatchRequest(KEY, null, type, number, null);
    }

    // ------------------------------------------------------------------ lines

    @Test
    void linesAreCheckedBeforeAnythingIsWritten() {
        when(reads.itemFacts(eq(INST), anyCollection())).thenReturn(Map.of(
                "ps-bottle", item("ps-bottle", "QUANTITY", "TRACKED", "ACTIVE"),
                "ps-scarf", item("ps-scarf", "PIECE", "TRACKED", "ACTIVE"),
                "ps-bag", item("ps-bag", "QUANTITY", "UNTRACKED", "ACTIVE"),
                "ps-old", item("ps-old", "QUANTITY", "TRACKED", "ARCHIVED")));
        PieceRow here = piece("p-here", "IN_STOCK", L2);
        PieceRow away = piece("p-away", "IN_STOCK", L1);
        PieceRow sold = piece("p-sold", "SOLD", null);
        when(pieces.findRow(INST, "p-here")).thenReturn(Optional.of(here));
        when(pieces.findRow(INST, "p-away")).thenReturn(Optional.of(away));
        when(pieces.findRow(INST, "p-sold")).thenReturn(Optional.of(sold));
        when(pieces.findRow(INST, "p-none")).thenReturn(Optional.empty());

        assertEquals("PIECE_SCAN_REQUIRED", code(() -> resolve(qty("ps-scarf", 1))));
        assertEquals("ITEM_UNTRACKED", code(() -> resolve(qty("ps-bag", 1))));
        assertEquals("ITEM_ARCHIVED", code(() -> resolve(qty("ps-old", 1))));
        assertEquals("ITEM_NOT_FOUND", code(() -> resolve(qty("ps-unknown", 1))));
        assertEquals("ITEM_NOT_FOUND", code(() -> resolve(pieceLine("p-none"))));
        assertEquals("PIECE_NOT_HERE", code(() -> resolve(pieceLine("p-away"))));
        assertEquals("PIECE_NOT_HERE", code(() -> resolve(pieceLine("p-sold"))));
        assertEquals("VALIDATION", code(() -> resolve(qty("ps-bottle", 0))));
        assertEquals("VALIDATION", code(() -> resolve(qty("ps-bottle", StockTransferService.MAX_QUANTITY + 1))));
        assertEquals("VALIDATION", code(() -> resolve(qty("ps-bottle", 2), qty("ps-bottle", 3))), "one line a variant");
        assertEquals("VALIDATION", code(() -> resolve(pieceLine("p-here"), pieceLine("p-here"))), "one line a piece");
        assertEquals("VALIDATION", code(() -> resolve(new TransferLineInput(null, null, null, null, null))));
        List<TransferLineInput> tooMany = new ArrayList<>(Collections.nCopies(StockTransferService.MAX_LINES + 1,
                qty("ps-bottle", 1)));
        assertEquals("VALIDATION", code(() -> service.resolveLines(INST, L2, tooMany)));

        List<StockTransferService.NewLine> ok = resolve(qty("ps-bottle", 5), pieceLine("p-here"));
        assertEquals(2, ok.size());
        assertEquals(5, ok.get(0).quantity());
        assertEquals("p-here", ok.get(1).pieceId());
        assertEquals(1, ok.get(1).quantity());
        assertEquals("ps-scarf", ok.get(1).packageSessionId());
        assertTrue(service.resolveLines(INST, L2, null).isEmpty(), "an empty draft");
    }

    private List<StockTransferService.NewLine> resolve(TransferLineInput... input) {
        return service.resolveLines(INST, L2, List.of(input));
    }

    private static TransferLineInput qty(String variant, int quantity) {
        return new TransferLineInput(variant, quantity, null, null, null);
    }

    private static TransferLineInput pieceLine(String pieceId) {
        return new TransferLineInput(null, null, pieceId, null, null);
    }

    @Test
    void aQuantityItemDoesNotTravelAsAPiece() {
        assertEquals("VALIDATION", code(() -> StockTransferService.requireMovable(
                item("ps-bottle", "QUANTITY", "TRACKED", "ACTIVE"), true)));
        StockTransferService.requireMovable(item("ps-scarf", "PIECE", "TRACKED", "ACTIVE"), true);
    }

    // ------------------------------------------------------------------ GSTIN rule

    @Test
    void twoGstinsNeedTheDocumentAManagerRecords() {
        transfer("DRAFT", L2, L3);
        gstins("09AAACH7409R1ZZ", "27AAACH7409R1ZZ");
        assertEquals("TRANSFER_NEEDS_DOCUMENT", code(() -> service.dispatch(INST, staffAtL2, "t-1", send(null, null))));
        assertEquals("TRANSFER_NEEDS_DOCUMENT", code(() -> service.dispatch(INST, manager, "t-1",
                send("DELIVERY_CHALLAN", null))));
        assertEquals("ROLE_NOT_ALLOWED", code(() -> service.dispatch(INST, staffAtL2, "t-1",
                send("EXTERNAL_INVOICE", "EXT/77"))));
        assertEquals("ROLE_NOT_ALLOWED", code(() -> service.dispatch(INST, staffAtL2, "t-1",
                new TransferDispatchRequest(KEY, null, null, null, true))), "promised units: a manager");
        assertEquals("VALIDATION", code(() -> service.dispatch(INST, manager, "t-1", send("EXTERNAL_INVOICE", ""))));
        assertEquals("VALIDATION", code(() -> service.dispatch(INST, manager, "t-1",
                send("EXTERNAL_INVOICE", "EXT#77"))));
        assertEquals("VALIDATION", code(() -> service.dispatch(INST, manager, "t-1", send("CHEQUE", "x"))));
        verify(transfers, never()).lockForUpdate(anyString(), anyString());
        verify(ledger, never()).postAll(any());
        verify(numbers, never()).allocate(any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void aDestinationChangedBetweenTheCheckAndTheLockIsRefused() {
        // Checked: L2 -> L1, one GSTIN, a delivery challan. Then an edit of the draft moved it to L3
        // (another GSTIN) before the dispatch took the row lock.
        gstins("09AAACH7409R1ZZ", "27AAACH7409R1ZZ");
        transfer("DRAFT", L2, L1);
        StockTransfer edited = new StockTransfer();
        edited.setId("t-1");
        edited.setInstituteId(INST);
        edited.setTransferNumber("TRF-000001");
        edited.setFromLocationId(L2);
        edited.setToLocationId(L3);
        edited.setStatus("DRAFT");
        when(transfers.lockForUpdate(INST, "t-1")).thenReturn(Optional.of(edited));
        assertEquals("TRANSFER_CHANGED", code(() -> service.dispatch(INST, staffAtL2, "t-1", send(null, null))));
        verify(ledger, never()).postAll(any());
        verify(numbers, never()).allocate(any(), any(), any(), any(), any(), any(), any());

        // Same destination, but its GSTIN changed meanwhile: refused the same way.
        StockTransfer same = transfer("DRAFT", L2, L1);
        when(transfers.lockForUpdate(INST, "t-1")).thenAnswer(call -> {
            when(sellers.resolve(eq(INST), eq(L1), any())).thenReturn(CommerceSellerLookup.Seller.builder()
                    .gstin("27AAACH7409R1ZZ").build());
            return Optional.of(same);
        });
        assertEquals("TRANSFER_CHANGED", code(() -> service.dispatch(INST, staffAtL2, "t-1",
                new TransferDispatchRequest("transfer-0002", null, null, null, null))));
        verify(ledger, never()).postAll(any());
    }

    @Test
    void oneGstinTravelsWithAChallanOnly() {
        transfer("DRAFT", L2, L1);
        gstins("09AAACH7409R1ZZ", "09AAACH7409R1ZZ");
        assertEquals("TRANSFER_DOCUMENT_NOT_ALLOWED", code(() -> service.dispatch(INST, manager, "t-1",
                send("EXTERNAL_INVOICE", "EXT/77"))));
        assertEquals("VALIDATION", code(() -> service.dispatch(INST, manager, "t-1",
                send("DELIVERY_CHALLAN", "DC/1"))), "the challan number comes from the series");
        assertEquals("VALIDATION", code(() -> service.dispatch(INST, staffAtL2, "t-1",
                new TransferDispatchRequest(KEY, "EWB-12", null, null, null))), "e-way bill: letters and digits");
        verify(transfers, never()).lockForUpdate(anyString(), anyString());
    }

    @Test
    void twoPlacesWithNoGstinAreEqual() {
        transfer("DRAFT", L2, L3);
        gstins(null, null);
        // Past the rule: the dispatch reaches its lock (the mock has no row → not found).
        when(transfers.lockForUpdate(INST, "t-1")).thenReturn(Optional.empty());
        assertEquals("TRANSFER_NOT_FOUND", code(() -> service.dispatch(INST, staffAtL2, "t-1", send(null, null))));
        verify(transfers).lockForUpdate(INST, "t-1");
    }

    // ------------------------------------------------------------------ receive sheet

    @Test
    void theReceiveSheetNamesEveryLineOnceWithAReasonForAShortfall() {
        List<StockTransferLine> sent = List.of(line("line-1", 10, null), line("line-2", 1, "p-1"));
        assertEquals("RECEIVED_ABOVE_SENT", code(() -> StockTransferService.receivedLines(sent, List.of(
                new ReceiveLineInput("line-1", 11, null), new ReceiveLineInput("line-2", 1, null)))));
        assertEquals("RECEIVED_ABOVE_SENT", code(() -> StockTransferService.receivedLines(sent, List.of(
                new ReceiveLineInput("line-1", 10, null), new ReceiveLineInput("line-2", 2, null)))),
                "a piece line is 0 or 1");
        assertEquals("SHORTFALL_REASON_REQUIRED", code(() -> StockTransferService.receivedLines(sent, List.of(
                new ReceiveLineInput("line-1", 7, null), new ReceiveLineInput("line-2", 1, null)))));
        assertEquals("VALIDATION", code(() -> StockTransferService.receivedLines(sent, List.of(
                new ReceiveLineInput("line-1", 10, "LOST"), new ReceiveLineInput("line-2", 1, null)))),
                "a full line takes no reason");
        assertEquals("VALIDATION", code(() -> StockTransferService.receivedLines(sent, List.of(
                new ReceiveLineInput("line-1", 7, "STOLEN"), new ReceiveLineInput("line-2", 1, null)))));
        assertEquals("VALIDATION", code(() -> StockTransferService.receivedLines(sent, List.of(
                new ReceiveLineInput("line-1", 10, null)))), "every line");
        assertEquals("VALIDATION", code(() -> StockTransferService.receivedLines(sent, List.of(
                new ReceiveLineInput("line-1", 10, null), new ReceiveLineInput("line-1", 10, null)))), "once");
        assertEquals("VALIDATION", code(() -> StockTransferService.receivedLines(sent, List.of(
                new ReceiveLineInput("line-1", 10, null), new ReceiveLineInput("line-9", 1, null)))), "its own lines");
        assertEquals("VALIDATION", code(() -> StockTransferService.receivedLines(sent, List.of(
                new ReceiveLineInput("line-1", -1, "LOST"), new ReceiveLineInput("line-2", 1, null)))));

        Map<String, StockTransferService.Received> ok = StockTransferService.receivedLines(sent, List.of(
                new ReceiveLineInput("line-2", 0, "damaged_in_transit"), new ReceiveLineInput("line-1", 7, "LOST")));
        assertEquals(7, ok.get("line-1").quantity());
        assertEquals("LOST", ok.get("line-1").reason());
        assertEquals("DAMAGED_IN_TRANSIT", ok.get("line-2").reason());
    }

    // ------------------------------------------------------------------ states

    @Test
    void theStateTable() {
        StockTransfer transfer = transfer("DISPATCHED", L2, L1);
        assertEquals("TRANSFER_DISPATCHED", code(() -> service.cancel(INST, staffAtL2, "t-1",
                new CancelRequest(KEY, null))));
        assertEquals("TRANSFER_NOT_DRAFT", code(() -> service.update(INST, staffAtL2, "t-1",
                new TransferUpdateRequest(KEY, null, "late note", null))));
        assertEquals("TRANSFER_NOT_DRAFT", code(() -> service.dispatch(INST, staffAtL2, "t-1", send(null, null))));
        transfer.setStatus("RECEIVED");
        assertEquals("TRANSFER_NOT_DRAFT", code(() -> service.cancel(INST, staffAtL2, "t-1",
                new CancelRequest(KEY, null))));
        assertEquals("TRANSFER_NOT_DISPATCHED", code(() -> service.receive(INST, manager, "t-1",
                new TransferReceiveRequest(KEY, List.of(new ReceiveLineInput("line-1", 2, null)), null, null))));
        transfer.setStatus("DRAFT");
        assertEquals("TRANSFER_NOT_DISPATCHED", code(() -> service.receive(INST, manager, "t-1",
                new TransferReceiveRequest(KEY, List.of(new ReceiveLineInput("line-1", 2, null)), null, null))));
        when(lines.findByInstituteIdAndTransferIdOrderByCreatedAtAscIdAsc(INST, "t-1")).thenReturn(List.of());
        assertEquals("TRANSFER_EMPTY", code(() -> service.dispatch(INST, staffAtL2, "t-1", send(null, null))));
        verify(ledger, never()).postAll(any());
    }

    // ------------------------------------------------------------------ round 2: units on the list and in PROMISED_ONLINE

    private static ItemFacts measured(String variant, String unit, int scale) {
        return new ItemFacts(variant, "pkg-" + variant, "SKU-" + variant, "Item " + variant, Map.of(), "One size",
                "QUANTITY", "TRACKED", "ACTIVE", "ACTIVE", unit, scale, 1, null, null, null, "5208", null);
    }

    /** A list row names its sum only in the unit every line shares: 23.7 m, 12 pieces, or mixed. */
    @Test
    void aListRowNamesTheUnitItsLinesShare() {
        StockTransferService.RowMeasure cloth = StockTransferService.rowMeasure(1L, "MTR", 10);
        assertEquals("MTR", cloth.unit());
        assertEquals(10, cloth.qtyScale());
        assertEquals(null, cloth.mixedUnits());
        StockTransferService.RowMeasure pieces = StockTransferService.rowMeasure(1L, null, 1);
        assertEquals(null, pieces.unit());
        assertEquals(1, pieces.qtyScale());
        StockTransferService.RowMeasure mixed = StockTransferService.rowMeasure(2L, "MTR", 10);
        assertEquals(Boolean.TRUE, mixed.mixedUnits());
        assertEquals(null, mixed.qtyScale());
        assertEquals(null, mixed.unit());
        assertEquals(null, StockTransferService.rowMeasure(1L, " ", 10).unit(), "an old blank unit names none");
    }

    /** PROMISED_ONLINE of a cloth carries its scale and unit, so the screen says 2.5 m, not 25 units. */
    @Test
    void promisedOnlineNamesTheScaleAndUnitWhenTheItemsShareThem() {
        Map<String, ItemFacts> facts = Map.of("cotton", measured("cotton", "MTR", 10),
                "linen", measured("linen", "mtr", 10), "rice", measured("rice", "KGS", 1000),
                "bottle", item("bottle", "QUANTITY", "TRACKED", "ACTIVE"));
        assertEquals(" (qty_scale 10, unit MTR)", StockTransferService.shortfallMeasure(List.of("cotton"), facts));
        assertEquals(" (qty_scale 10, unit MTR)",
                StockTransferService.shortfallMeasure(List.of("cotton", "linen"), facts));
        assertEquals("", StockTransferService.shortfallMeasure(List.of("cotton", "rice"), facts), "two units");
        assertEquals("", StockTransferService.shortfallMeasure(List.of("bottle"), facts), "pieces: the count");
        assertEquals("", StockTransferService.shortfallMeasure(List.of("cotton", "bottle"), facts));
    }
}
