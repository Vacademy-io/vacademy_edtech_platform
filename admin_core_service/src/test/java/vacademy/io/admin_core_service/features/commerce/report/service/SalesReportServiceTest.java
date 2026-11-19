package vacademy.io.admin_core_service.features.commerce.report.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.report.dto.ReportDtos.ReportAnswer;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyReportRepository;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyRows.ActiveProduct;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyRows.Location;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyRows.Membership;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyRows.ProductLine;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyRows.SalesDocument;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

import static org.junit.jupiter.api.Assertions.assertEquals;
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

/** Sales from documents (contract 2.12) and products in display units (contract 2.13). */
class SalesReportServiceTest {

    private static final LocalDate D1 = LocalDate.of(2026, 11, 5);
    private static final LocalDate D2 = LocalDate.of(2026, 11, 6);

    private MoneyReportRepository repository;
    private SalesReportService service;
    private ReportQuery query;

    @BeforeEach
    void setUp() {
        repository = mock(MoneyReportRepository.class);
        service = new SalesReportService(repository);
        when(repository.locations("inst-1")).thenReturn(List.of(new Location("L1", "S1", "Test City store")));
        query = ReportQuery.builder().instituteId("inst-1").range(new ReportRange(LocalDate.of(2026, 11, 1), D2))
                .scope(new ReportScope(true, null, true, null)).today(LocalDate.of(2026, 11, 19))
                .staffNames(Map.of("u-cashier", "Test Cashier")).build();
        List<SalesDocument> documents = List.of(
                // A POS bill: 2.5 m cloth (one measured line = 1 item) + 2 bottles.
                invoice("i-1", D1, "POS", "u-cashier", "OFFLINE", "381.00", "-0.15", "358.50", "22.65", "381.15",
                        "10.00", 3),
                invoice("i-2", D2, "ONLINE", "u-shopper", "PREPAID", "105.00", "0.00", "100.00", "5.00", "105.00",
                        "0.00", 1),
                new SalesDocument("NOTE", "n-1", D2, "POS", "L1", "POS", "u-cashier", "OFFLINE",
                        new BigDecimal("155.12"), new BigDecimal("0.00"), BigDecimal.ZERO, BigDecimal.ZERO,
                        BigDecimal.ZERO, BigDecimal.ZERO, 0));
        doAnswer(inv -> {
            Consumer<SalesDocument> sink = inv.getArgument(1);
            documents.forEach(sink);
            return null;
        }).when(repository).salesDocuments(any(), any());
    }

    private static SalesDocument invoice(String id, LocalDate day, String channel, String staff, String method,
                                         String total, String roundOff, String taxable, String tax, String amount,
                                         String discount, long items) {
        return new SalesDocument("INVOICE", id, day, channel, "L1", channel, staff, method, new BigDecimal(total),
                new BigDecimal(roundOff), new BigDecimal(taxable), new BigDecimal(tax), new BigDecimal(amount),
                new BigDecimal(discount), items);
    }

    @Test
    void salesAreInvoicesAndReturnsAreCreditNotes() {
        ReportAnswer a = service.sales(query);
        assertEquals("date", a.getColumns().get(0).getKey());
        assertEquals(2, a.getRows().size());
        Map<String, Object> first = a.getRows().get(0);
        assertEquals("2026-11-05", first.get("date"));
        assertEquals(3L, first.get("items"));
        assertEquals(new BigDecimal("391.15"), first.get("gross"), "line amounts + discount");
        assertEquals(new BigDecimal("381.00"), first.get("net"));
        Map<String, Object> second = a.getRows().get(1);
        assertEquals(new BigDecimal("155.12"), second.get("returns"), "a credit note sits on its own date");
        assertEquals(new BigDecimal("-50.12"), second.get("net_after_returns"));
        Map<String, Object> totals = a.getTotals();
        assertEquals(2L, totals.get("invoices"));
        assertEquals(new BigDecimal("486.00"), totals.get("net"), "Σ net = Σ live invoice totals");
        assertEquals(new BigDecimal("-0.15"), totals.get("round_off"));
        assertEquals(new BigDecimal("155.12"), totals.get("returns"));
        assertEquals(new BigDecimal("330.88"), totals.get("net_after_returns"));
    }

    @Test
    void everyGroupingNamesItsColumn() {
        Map<String, String> columns = Map.of("day", "date", "month", "month", "channel", "channel", "location",
                "location", "staff", "staff", "payment_method", "payment_method");
        for (String group : SalesReportService.SALES_GROUPS) {
            ReportAnswer a = service.sales(query.toBuilder().groupBy(group).build());
            assertEquals(columns.get(group), a.getColumns().get(0).getKey(), group);
            assertEquals(group, a.getFilters().get("group_by"));
        }
        ReportAnswer month = service.sales(query.toBuilder().groupBy("month").build());
        assertEquals("2026-11", month.getRows().get(0).get("month"));
        assertEquals(1, month.getRows().size());
        InvalidRequestException e = assertThrows(InvalidRequestException.class,
                () -> service.sales(query.toBuilder().groupBy("colour").build()));
        assertTrue(e.getMessage().startsWith("VALIDATION"));
    }

    @Test
    void staffIsTheCashierAndOnlineReadsOnline() {
        ReportAnswer a = service.sales(query.toBuilder().groupBy("staff").build());
        assertEquals(List.of("Online", "Test Cashier"), a.getRows().stream().map(r -> r.get("staff")).toList());
        Map<String, Object> cashier = a.getRows().get(1);
        assertEquals(new BigDecimal("155.12"), cashier.get("returns"), "a note follows its invoice's staff");
        when(repository.salesStaff(any())).thenReturn(List.of("u-cashier"));
        assertEquals(List.of("u-cashier"), service.staffIds(query.toBuilder().groupBy("staff").build()));
        assertEquals(List.of(), service.staffIds(query));
        verify(repository, org.mockito.Mockito.times(1)).salesStaff(any());
    }

    // ------------------------------------------------------------------ products

    private void productLines(List<ProductLine> lines) {
        doAnswer(inv -> {
            Consumer<ProductLine> sink = inv.getArgument(1);
            lines.forEach(sink);
            return null;
        }).when(repository).productLines(any(), any());
    }

    private static ProductLine cloth(String kind, String document, long base, String amount) {
        return new ProductLine(kind, document, "ps-cloth", "pk-cloth", "Cotton cloth", "Plain", "CLOTH-1", base, 10,
                "MTR", new BigDecimal(amount), new BigDecimal(amount));
    }

    @Test
    void productsAreInDisplayUnitsWithAnAverageRate() {
        productLines(List.of(
                cloth("INVOICE", "i-1", 25, "308.50"),
                cloth("INVOICE", "i-2", 34, "419.56"),
                cloth("NOTE", "n-1", 12, "148.08"),
                new ProductLine("INVOICE", "i-1", "ps-bottle", "pk-bottle", "Steel bottle", "Default", "BOTTLE-1",
                        2, 1, "PCS", new BigDecimal("200.00"), new BigDecimal("190.00"))));
        when(repository.activeProducts("inst-1")).thenReturn(List.of(
                new ActiveProduct("pk-cloth", "Cotton cloth", "MTR", "CLOTH-1"),
                new ActiveProduct("pk-bottle", "Steel bottle", "PCS", "BOTTLE-1"),
                new ActiveProduct("pk-scarf", "Silk scarf", "PIECE", "SCARF-1")));
        ReportAnswer a = service.products(query);
        Map<String, Object> cloth = a.getRows().get(0);
        assertEquals("Cotton cloth", cloth.get("product"));
        assertEquals(new BigDecimal("5.9"), cloth.get("sold"));
        assertEquals("5.9 m", cloth.get("sold_text"));
        assertEquals("1.2 m", cloth.get("returned_text"));
        assertEquals(new BigDecimal("4.7"), cloth.get("net_units"));
        assertEquals(new BigDecimal("579.98"), cloth.get("net_value"));
        assertEquals(new BigDecimal("123.40"), cloth.get("average_rate"));
        assertEquals("₹123.40 / m", cloth.get("average_rate_text"));
        assertEquals(2L, cloth.get("invoices"));
        Map<String, Object> bottle = a.getRows().get(1);
        assertEquals(new BigDecimal("2"), bottle.get("sold"));
        assertEquals("2 pcs", bottle.get("sold_text"));
        assertEquals("₹100.00", bottle.get("average_rate_text"));
        // Never sold: active products with no invoice line in the range.
        var never = a.getSections().get(0);
        assertEquals("never_sold", never.getKey());
        assertEquals(1, never.getRows().size());
        assertEquals("Silk scarf", never.getRows().get(0).get("product"));
        assertEquals("4.7 m, 2 pcs", a.getTotals().get("net_text"));
        assertEquals(new BigDecimal("779.98"), a.getTotals().get("net_value"));
        // Distinct invoices are a count of their own, never the column's sum: the column total stays empty.
        assertNull(a.getTotals().get("invoices"));
        assertTrue(a.getTotals().get("distinct_invoices") instanceof Long);
    }

    @Test
    void aProductInTwoCollectionsIsInBothAndThereIsNoGrandTotal() {
        productLines(List.of(cloth("INVOICE", "i-1", 25, "308.50")));
        when(repository.activeProducts("inst-1")).thenReturn(List.of());
        when(repository.memberships(eq("inst-1"), eq("COLLECTION"))).thenReturn(List.of(
                new Membership("pk-cloth", "c-1", "Summer"), new Membership("pk-cloth", "c-2", "Basics")));
        ReportAnswer a = service.products(query.toBuilder().groupBy("collection").build());
        assertEquals("collection", a.getColumns().get(0).getKey());
        assertEquals(2, a.getRows().size());
        assertTrue(a.getTotals().isEmpty(), "no grand total in the collection view");
        assertEquals(SalesReportService.NO_GRAND_TOTAL, a.getWarnings().get(0).getCode());
        service.products(query.toBuilder().groupBy("category").build());
        verify(repository).memberships("inst-1", "CATEGORY");
        verify(repository, never()).memberships("inst-1", "VARIANT");
    }

    @Test
    void mixedUnitsHaveNoSingleQuantity() {
        SalesReportService.Units units = new SalesReportService.Units();
        units.add(25, 10, "MTR");
        units.add(3, 1, "PCS");
        assertNull(units.number());
        assertEquals("2.5 m, 3 pcs", units.text());
        InvalidRequestException e = assertThrows(InvalidRequestException.class,
                () -> service.products(query.toBuilder().groupBy("colour").build()));
        assertTrue(e.getMessage().startsWith("VALIDATION"));
    }
}
