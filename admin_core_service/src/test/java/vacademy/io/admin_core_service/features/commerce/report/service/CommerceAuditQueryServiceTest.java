package vacademy.io.admin_core_service.features.commerce.report.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.admin_core_service.features.commerce.report.repository.AuditReadRepository;
import vacademy.io.admin_core_service.features.commerce.report.repository.AuditReadRepository.ApprovalRow;
import vacademy.io.admin_core_service.features.commerce.report.repository.AuditReadRepository.AuditFilter;
import vacademy.io.admin_core_service.features.commerce.report.repository.AuditReadRepository.AuditKeyset;
import vacademy.io.admin_core_service.features.commerce.report.repository.AuditReadRepository.AuditRow;
import vacademy.io.admin_core_service.features.commerce.report.service.CommerceAuditQueryService.AuditEntry;
import vacademy.io.admin_core_service.features.commerce.report.service.CommerceAuditQueryService.AuditQuery;
import vacademy.io.admin_core_service.features.commerce.report.service.CommerceAuditQueryService.Change;
import vacademy.io.admin_core_service.features.commerce.report.service.CommerceAuditQueryService.Page;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockClock;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.io.ByteArrayOutputStream;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** The audit list (contract 6.4): filters, location scope, document numbers, keyset paging, old → new. */
class CommerceAuditQueryServiceTest {

    private static final ReportRange RANGE = new ReportRange(LocalDate.of(2026, 11, 1), LocalDate.of(2026, 11, 19));
    private static final ReportScope ADMIN = new ReportScope(true, null, true, null);

    private AuditReadRepository repository;
    private CommerceAuditQueryService service;

    @BeforeEach
    void setUp() {
        repository = mock(AuditReadRepository.class);
        service = new CommerceAuditQueryService(repository);
    }

    private static AuditRow row(String id, LocalDateTime at, String oldJson, String newJson) {
        return new AuditRow(id, at, at.toString() + ":00.000000", "u-1", "L1", "Test City store", "PRODUCT_UPDATED",
                "PRODUCT", "pk-1", null, oldJson, newJson, "new rate");
    }

    private void rows(List<AuditRow> rows) {
        doAnswer(inv -> {
            Consumer<AuditRow> sink = inv.getArgument(3);
            rows.forEach(sink);
            return null;
        }).when(repository).audit(any(), any(), any(), any());
    }

    private AuditFilter captured() {
        ArgumentCaptor<AuditFilter> filter = ArgumentCaptor.forClass(AuditFilter.class);
        verify(repository).audit(filter.capture(), any(), any(), any());
        return filter.getValue();
    }

    @Test
    void filtersAndIndiaBoundsReachTheQuery() {
        rows(List.of());
        service.audit(new AuditQuery("inst-1", RANGE, ADMIN, "u-1", "POS_VOID", null, null, 0));
        AuditFilter f = captured();
        assertEquals("u-1", f.actorUserId());
        assertEquals("POS_VOID", f.kind());
        assertNull(f.locationIn(), "an ADMIN sees rows with and without a location");
        assertNull(f.referenceIds());
        assertEquals(StockClock.storedStartOf(LocalDate.of(2026, 11, 1)), f.storedFrom());
        assertEquals(StockClock.storedStartOf(LocalDate.of(2026, 11, 20)), f.storedTo());
        verify(repository).audit(any(), eq(null), eq(ReportQuery.DEFAULT_SIZE + 1), any());
    }

    @Test
    void aLocationLimitedReaderSeesItsLocationsOnly() {
        rows(List.of());
        service.audit(new AuditQuery("inst-1", RANGE, new ReportScope(false, Set.of("L2"), false, null), null, null,
                null, null, 0));
        assertEquals(Set.of("L2"), captured().locationIn(), "rows without a location are left out too");
    }

    @Test
    void aDocumentNumberBecomesTheIdsItStandsFor() {
        rows(List.of());
        when(repository.referenceIds("inst-1", "INV/2627-00003")).thenReturn(List.of("inv-3", "ord-3"));
        service.audit(new AuditQuery("inst-1", RANGE, ADMIN, null, null, "INV/2627-00003", null, 0));
        assertEquals(List.of("inv-3", "ord-3"), captured().referenceIds());
    }

    @Test
    void anUnknownNumberFindsNothing() {
        rows(List.of());
        when(repository.referenceIds("inst-1", "NOPE")).thenReturn(List.of());
        Page<AuditEntry> page = service.audit(new AuditQuery("inst-1", RANGE, ADMIN, null, null, "NOPE", null, 0));
        assertEquals(List.of(), captured().referenceIds(), "an empty id list matches no row");
        assertTrue(page.getRows().isEmpty());
    }

    @Test
    void pagesContinueFromTheLastRowWithoutRepeats() {
        LocalDateTime t1 = LocalDateTime.of(2026, 11, 10, 7, 0);
        LocalDateTime t2 = LocalDateTime.of(2026, 11, 9, 7, 0);
        LocalDateTime t3 = LocalDateTime.of(2026, 11, 8, 7, 0);
        rows(List.of(row("a-1", t1, null, null), row("a-2", t2, null, null), row("a-3", t3, null, null)));
        Page<AuditEntry> first = service.audit(new AuditQuery("inst-1", RANGE, ADMIN, null, null, null, null, 2));
        assertEquals(2, first.getRows().size());
        assertNotNull(first.getNextCursor());
        AuditKeyset keyset = CommerceAuditQueryService.decode(first.getNextCursor());
        assertEquals(new AuditKeyset(t2, "a-2"), keyset);
        service.audit(new AuditQuery("inst-1", RANGE, ADMIN, null, null, null, first.getNextCursor(), 2));
        verify(repository).audit(any(), eq(keyset), eq(3), any());
        assertThrows(InvalidRequestException.class, () -> CommerceAuditQueryService.decode("not-a-cursor"));
    }

    @Test
    void changesAreOldToNewPerKey() throws Exception {
        List<Change> changes = CommerceAuditQueryService.changes("{\"price\":\"10.00\",\"name\":\"Cotton cloth\"}",
                "{\"price\":\"12.34\",\"name\":\"Cotton cloth\",\"hsn\":\"5208\"}");
        assertEquals(List.of(new Change("price", "10.00", "12.34"), new Change("hsn", null, "5208")), changes);
        assertEquals(List.of(new Change("total", null, "52.50")),
                CommerceAuditQueryService.changes(null, "{\"total\":\"52.50\"}"));
        assertEquals(List.of(new Change("value", "OPEN", "CLOSED")),
                CommerceAuditQueryService.changes("\"OPEN\"", "\"CLOSED\""));
        assertTrue(CommerceAuditQueryService.changes(null, null).isEmpty());
        String json = new ObjectMapper().writeValueAsString(changes.get(0));
        assertTrue(json.contains("\"new\":\"12.34\"") && json.contains("\"old\":\"10.00\""), json);
    }

    @Test
    void timesAreIndiaTimes() {
        rows(List.of(row("a-1", LocalDateTime.of(2026, 11, 10, 7, 0), null, null)));
        AuditEntry e = service.audit(new AuditQuery("inst-1", RANGE, ADMIN, null, null, null, null, 0))
                .getRows().get(0);
        // Stored times are UTC wall times in production (the JVM runs in UTC).
        String expected = LocalDateTime.of(2026, 11, 10, 7, 0).atZone(java.time.ZoneId.systemDefault())
                .withZoneSameInstant(java.time.ZoneId.of("Asia/Kolkata")).toOffsetDateTime().toString();
        assertEquals(expected, e.getCreatedAt());
        assertTrue(e.getCreatedAt().endsWith("+05:30"));
    }

    @Test
    void namesAreFilledAfterTheRead() {
        rows(List.of(row("a-1", LocalDateTime.of(2026, 11, 10, 7, 0), null, null)));
        Page<AuditEntry> page = service.audit(new AuditQuery("inst-1", RANGE, ADMIN, null, null, null, null, 0));
        assertEquals(Set.of("u-1"), CommerceAuditQueryService.userIds(page));
        CommerceAuditQueryService.fillNames(page, Map.of("u-1", "Test Manager"));
        assertEquals("Test Manager", page.getRows().get(0).getActorName());
        CommerceAuditQueryService.fillNames(page, Map.of());
        assertEquals("u-1", page.getRows().get(0).getActorName(), "no name: the id");
    }

    @Test
    void approvalsArePagedAndNamed() {
        doAnswer(inv -> {
            Consumer<ApprovalRow> sink = inv.getArgument(3);
            sink.accept(new ApprovalRow("ap-1", LocalDateTime.of(2026, 11, 7, 7, 0), "2026-11-07T07:00:00.000000",
                    "POS_VOID", "ORDER", "o-1", "ORD-1", "u-cashier", "u-manager", new BigDecimal("52.5"),
                    "wrong item", "L1", "Test City store"));
            return null;
        }).when(repository).approvals(any(), any(), any(), any());
        Page<CommerceAuditQueryService.ApprovalEntry> page = service.approvals(
                new AuditQuery("inst-1", RANGE, ADMIN, null, null, null, null, 0));
        assertEquals(new BigDecimal("52.50"), page.getRows().get(0).getAmount());
        assertEquals(Set.of("u-cashier", "u-manager"), CommerceAuditQueryService.userIds(page));
        CommerceAuditQueryService.fillNames(page, Map.of("u-manager", "Test Manager"));
        assertEquals("Test Manager", page.getRows().get(0).getApprovedByName());
        assertEquals("u-cashier", page.getRows().get(0).getRequestedByName());
        assertNull(page.getNextCursor());
    }

    @Test
    void theCsvIsEscapedAndCarriesNames() throws Exception {
        rows(List.of(new AuditRow("a-1", LocalDateTime.of(2026, 11, 10, 7, 0), "x", "u-1", null, null,
                "PRODUCT_UPDATED", "PRODUCT", "pk-1", null, "{\"name\":\"Old\"}",
                "{\"name\":\"=HYPERLINK(\\\"http://x\\\")\"}", "rate")));
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        int rows = service.exportCsv(new AuditQuery("inst-1", RANGE, ADMIN, null, null, null, null, 0),
                Map.of("u-1", "Test Manager"), out, 10);
        assertEquals(1, rows);
        String csv = out.toString(StandardCharsets.UTF_8);
        assertTrue(csv.startsWith("﻿when,who,location,kind,reference_type,reference,changes,reason"), csv);
        assertTrue(csv.contains("Test Manager"));
        assertTrue(csv.contains("name: Old → =HYPERLINK"), "the change text is one cell; it starts with the key");
        verify(repository, never()).referenceIds(any(), any());
    }
}
