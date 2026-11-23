package vacademy.io.admin_core_service.features.commerce.report.repository;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.DocFilter;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.Keyset;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * The text of every report query, captured at the driver: institute first, no {@code now()} or
 * {@code CURRENT_DATE}, a timestamp turned into a date only through the India zone, no two
 * keywords glued together by a text block, live documents only where the contract says so, and
 * the fetch size of a streaming read.
 */
class ReportReadRepositorySqlTest {

    private static final Pattern GLUED = Pattern.compile(
            "[A-Za-z0-9_)'](AND|FROM|WHERE|JOIN|ORDER BY|GROUP BY|UNION|LIMIT|SELECT)\\b");

    private final List<String> statements = new ArrayList<>();
    private final List<Integer> fetchSizes = new ArrayList<>();
    private ReportReadRepository repository;
    private final DocFilter filter = new DocFilter("inst-1", LocalDate.of(2026, 11, 1), LocalDate.of(2026, 11, 19),
            "29AAAAA0000A1Z5", Set.of("loc-1"), "POS", "ACTIVE");

    @BeforeEach
    void setUp() throws Exception {
        DataSource dataSource = mock(DataSource.class);
        Connection connection = mock(Connection.class);
        when(dataSource.getConnection()).thenReturn(connection);
        when(connection.prepareStatement(anyString())).thenAnswer(inv -> {
            statements.add(inv.getArgument(0));
            PreparedStatement statement = mock(PreparedStatement.class);
            // One row of nulls, so every reader (including queryForMap) runs to its end.
            ResultSet oneRow = mock(ResultSet.class);
            when(oneRow.next()).thenReturn(true, false);
            java.sql.ResultSetMetaData meta = mock(java.sql.ResultSetMetaData.class);
            when(meta.getColumnCount()).thenReturn(1);
            when(meta.getColumnLabel(1)).thenReturn("value");
            when(oneRow.getMetaData()).thenReturn(meta);
            when(statement.executeQuery()).thenReturn(oneRow);
            org.mockito.Mockito.doAnswer(set -> fetchSizes.add(set.getArgument(0))).when(statement)
                    .setFetchSize(org.mockito.ArgumentMatchers.anyInt());
            return statement;
        });
        repository = new ReportReadRepository(new NamedParameterJdbcTemplate(new JdbcTemplate(dataSource)));
    }

    private void runEverything() {
        Keyset after = new Keyset(LocalDate.of(2026, 11, 3), "INV/2627-00003", "inv-3");
        repository.locationIds("inst-1");
        repository.places("inst-1");
        quietly(() -> repository.documentsWithoutGstin(filter));
        quietly(() -> repository.taxInvoiceDocumentSums(filter));
        repository.sellerGstins(filter);
        repository.salesRegister(filter, after, 101, row -> { });
        repository.salesRegister(filter, null, null, row -> { });
        quietly(() -> repository.salesRegisterTotals(filter));
        repository.creditNotes(filter, after, 101, row -> { });
        quietly(() -> repository.creditNoteTotals(filter));
        repository.invoiceLines(filter, row -> { });
        repository.noteLines(filter, row -> { });
        repository.snapshots("inst-1", List.of("inv-1"));
        repository.documentsInRange(filter, row -> { });
        repository.series("inst-1", List.of("s-1"));
        repository.seriesDocuments("inst-1", List.of("s-1"), row -> { });
    }

    /** queryForMap needs a row; the empty mock result refuses it after the statement was prepared. */
    private static void quietly(Runnable call) {
        try {
            call.run();
        } catch (RuntimeException expected) {
            // the SQL was captured
        }
    }

    @Test
    void everyStatementFiltersTheInstituteAndReadsNoServerClock() {
        runEverything();
        assertEquals(19, statements.size(), "statements: " + statements);
        for (String sql : statements) {
            assertTrue(sql.contains("institute_id = ?"), sql);
            String lower = sql.toLowerCase(Locale.ROOT);
            assertFalse(lower.contains("now()"), sql);
            assertFalse(lower.contains("current_date"), sql);
            assertFalse(lower.contains("current_timestamp"), sql);
            assertFalse(lower.contains("localtimestamp"), sql);
            assertFalse(lower.contains("set time zone"), sql);
        }
    }

    @Test
    void noKeywordIsGluedToTheTokenBeforeIt() {
        runEverything();
        for (String sql : statements) {
            Matcher m = GLUED.matcher(sql);
            assertFalse(m.find(), () -> "glued keyword near '" + sql.substring(Math.max(0, m.start() - 30),
                    Math.min(sql.length(), m.end() + 30)) + "'");
        }
    }

    @Test
    void aTimestampBecomesADateOnlyThroughTheIndiaZone() {
        runEverything();
        for (String sql : statements) {
            int at = sql.indexOf("::date");
            while (at >= 0) {
                String before = sql.substring(Math.max(0, at - 60), at);
                assertTrue(before.contains("AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')"), sql);
                at = sql.indexOf("::date", at + 1);
            }
        }
    }

    @Test
    void invoiceQueriesReadCommerceDocumentsAndLiveLinesOnly() {
        runEverything();
        String lines = statements.stream().filter(s -> s.contains("li.description")).findFirst().orElseThrow();
        assertTrue(lines.contains("i.document_type IS NOT NULL"));
        assertTrue(lines.contains("i.cancelled_at IS NULL"), "cancelled invoices are out of every summary");
        String totals = statements.stream().filter(s -> s.contains("cancelled_invoices")).findFirst().orElseThrow();
        assertTrue(totals.contains("FILTER (WHERE i.cancelled_at IS NULL)"));
        String register = statements.stream().filter(s -> s.contains("WITH inv AS")).findFirst().orElseThrow();
        assertTrue(register.contains("(i.document_date, i.invoice_number, i.id) > (?, ?, ?)"), "keyset paging");
        assertTrue(register.contains("LIMIT ?"));
        assertTrue(register.contains("i.seller_gstin = ?") && register.contains("i.location_id IN (?)")
                && register.contains("i.channel = ?"), register);
        String notes = statements.stream().filter(s -> s.contains("WITH nt AS")).findFirst().orElseThrow();
        assertTrue(notes.contains("n.seller_gstin = ?") && notes.contains("i.location_id IN (?)"),
                "a credit note takes location and channel from its invoice");
    }

    @Test
    void streamingReadsAskForAThousandRowsAtATime() {
        runEverything();
        assertTrue(fetchSizes.stream().allMatch(size -> size == 1000), fetchSizes.toString());
        assertTrue(fetchSizes.size() >= statements.size() - 1);
    }

    @Test
    void anEmptyLocationSetMatchesNothing() {
        DocFilter none = new DocFilter("inst-1", filter.from(), filter.to(), null, Set.of(), null, null);
        repository.invoiceLines(none, row -> { });
        assertTrue(statements.get(0).contains("AND FALSE"));
        assertEquals(1, statements.size());
    }
}
