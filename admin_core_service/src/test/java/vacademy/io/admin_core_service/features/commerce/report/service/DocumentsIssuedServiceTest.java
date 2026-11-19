package vacademy.io.admin_core_service.features.commerce.report.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.report.dto.ReportDtos;
import vacademy.io.admin_core_service.features.commerce.report.dto.ReportDtos.ReportAnswer;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.DocumentRow;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static vacademy.io.admin_core_service.features.commerce.report.service.ReportFixtures.book;
import static vacademy.io.admin_core_service.features.commerce.report.service.ReportFixtures.query;
import static vacademy.io.admin_core_service.features.commerce.report.service.ReportFixtures.systemSeries;

/** Documents issued: number parsing, the all-time gap check, back-dated notes, bill books apart. */
class DocumentsIssuedServiceTest {

    private static final LocalDate IN = LocalDate.of(2026, 11, 5);
    private static final LocalDate BEFORE = LocalDate.of(2026, 10, 20);

    private ReportFixtures.FakeRepository repo;
    private GstReportService service;

    @BeforeEach
    void setUp() {
        repo = new ReportFixtures.FakeRepository();
        service = new GstReportService(repo, new DocumentsIssuedService(repo));
    }

    private void doc(String kind, String series, String number, String page, LocalDate date, boolean cancelled) {
        DocumentRow row = new DocumentRow(kind, series, number, page, date, cancelled);
        repo.allTime.add(row);
        if (!date.isBefore(LocalDate.of(2026, 11, 1))) {
            repo.inRange.add(row);
        }
    }

    private static ReportDtos.Section section(ReportAnswer a, String key) {
        return a.getSections().stream().filter(s -> s.getKey().equals(key)).findFirst().orElseThrow();
    }

    @Test
    void parsesTheSequenceAfterPrefixAndYear() {
        assertEquals(12, DocumentsIssuedService.parseSequence("INV/2627-00012", "INV/", "2026-27"));
        assertEquals(123456, DocumentsIssuedService.parseSequence("A-2627-123456", "A-", "2026-27"));
        assertEquals(7, DocumentsIssuedService.parseSequence("CN2026-00007", "CN", "2026"));
        assertEquals(-1, DocumentsIssuedService.parseSequence("INV/2526-00012", "INV/", "2026-27"));
        assertEquals(-1, DocumentsIssuedService.parseSequence("INV/2627-", "INV/", "2026-27"));
        assertEquals(-1, DocumentsIssuedService.parseSequence("INV/2627-12a", "INV/", "2026-27"));
    }

    @Test
    void anUnbrokenSeriesHasNoGapAndAVoidedBillCountsAsCancelled() {
        repo.series.add(systemSeries("s-inv", "TAX_INVOICE", "INV/", 4));
        doc("INVOICE", "s-inv", "INV/2627-00001", null, BEFORE, false);
        doc("INVOICE", "s-inv", "INV/2627-00002", null, IN, false);
        doc("INVOICE", "s-inv", "INV/2627-00003", null, IN, true);

        ReportAnswer a = service.documentsIssued(query());

        Map<String, Object> row = section(a, "system").getRows().get(0);
        assertEquals("Invoices for outward supply", row.get("nature"));
        assertEquals("INV/2627-00002", row.get("from_number"));
        assertEquals("INV/2627-00003", row.get("to_number"));
        assertEquals(2L, row.get("total"));
        assertEquals(1L, row.get("cancelled"));
        assertEquals(1L, row.get("net_issued"));
        assertEquals(3L, row.get("issued_all_time"));
        assertEquals("none", row.get("gap"));
        assertNull(row.get("dated_in_other_period"));
        assertTrue(a.getWarnings().isEmpty(), a.getWarnings().toString());
        assertEquals(1L, section(a, "system").getTotals().get("cancelled"));
    }

    @Test
    void aMissingNumberIsAGap() {
        repo.series.add(systemSeries("s-inv", "TAX_INVOICE", "INV/", 4));
        doc("INVOICE", "s-inv", "INV/2627-00001", null, IN, false);
        doc("INVOICE", "s-inv", "INV/2627-00003", null, IN, false);

        ReportAnswer a = service.documentsIssued(query());

        assertEquals("missing INV/2627-00002", section(a, "system").getRows().get(0).get("gap"));
        assertEquals("SERIES_GAP", a.getWarnings().get(0).getCode());
        assertEquals("INV/2627", a.getWarnings().get(0).getRef());
    }

    @Test
    void aBackDatedCreditNoteIsDatedInAnotherPeriodNotMissing() {
        repo.series.add(systemSeries("s-cn", "CREDIT_NOTE", "CN/", 4));
        doc("CREDIT_NOTE", "s-cn", "CN/2627-00001", null, IN, false);
        // Numbered after note 1 but dated back into the previous month.
        doc("CREDIT_NOTE", "s-cn", "CN/2627-00002", null, BEFORE, false);
        doc("CREDIT_NOTE", "s-cn", "CN/2627-00003", null, IN, false);

        ReportAnswer a = service.documentsIssued(query());

        Map<String, Object> row = section(a, "system").getRows().get(0);
        assertEquals("Credit Note", row.get("nature"));
        assertEquals(2L, row.get("total"));
        assertEquals("none", row.get("gap"));
        assertEquals("CN/2627-00002", row.get("dated_in_other_period"));
        assertTrue(a.getWarnings().isEmpty());
    }

    @Test
    void billBooksAreListedApartWithPagesNotEntered() {
        repo.series.add(book("s-book", 100, 199));
        doc("INVOICE", "s-book", "BK/2627-00101", "101", IN, false);
        doc("INVOICE", "s-book", "BK/2627-00103", "103", IN, true);

        ReportAnswer a = service.documentsIssued(query());

        assertTrue(section(a, "system").getRows().isEmpty());
        Map<String, Object> row = section(a, "bill_books").getRows().get(0);
        assertEquals("100–199", row.get("book_range"));
        assertEquals("101", row.get("from_page"));
        assertEquals("103", row.get("to_page"));
        assertEquals(2L, row.get("total"));
        assertEquals(1L, row.get("cancelled"), "a voided paper bill");
        assertEquals("102", row.get("not_entered"));
        assertEquals(1L, row.get("not_entered_count"));
        assertEquals(List.of(102L), DocumentsIssuedService.notEntered(List.of(101L, 103L)));
        assertEquals(List.of(), DocumentsIssuedService.notEntered(List.of()));
    }

    @Test
    void aChallanSeriesIsListedAsOtherThanSupply() {
        repo.series.add(systemSeries("s-dc", "DELIVERY_CHALLAN", "DC/", 2));
        doc("DELIVERY_CHALLAN", "s-dc", "DC/2627-00001", null, IN, false);
        ReportAnswer a = service.documentsIssued(query());
        assertEquals("Delivery Challan in cases other than by way of supply",
                section(a, "system").getRows().get(0).get("nature"));
    }
}
