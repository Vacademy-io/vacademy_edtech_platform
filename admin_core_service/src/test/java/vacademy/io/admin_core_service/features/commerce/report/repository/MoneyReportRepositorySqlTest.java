package vacademy.io.admin_core_service.features.commerce.report.repository;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import vacademy.io.admin_core_service.features.commerce.report.repository.AuditReadRepository.AuditFilter;
import vacademy.io.admin_core_service.features.commerce.report.repository.AuditReadRepository.AuditKeyset;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.DocFilter;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.Keyset;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.time.LocalDate;
import java.time.LocalDateTime;
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
 * The text of every money, counter, sales and audit query, captured at the driver: institute
 * first, no server clock, a timestamp turned into a date only through the India zone, no keyword
 * glued to the token before it (text blocks drop the indentation a splice relies on), and the
 * money rules of the day book that live in SQL.
 */
class MoneyReportRepositorySqlTest {

    private static final Pattern GLUED = Pattern.compile(
            "[A-Za-z0-9_)'](AND|FROM|WHERE|JOIN|ORDER BY|GROUP BY|UNION|LIMIT|SELECT|AS|THEN|END|WHEN|ELSE)\\b");

    private final List<String> statements = new ArrayList<>();
    private final List<Integer> fetchSizes = new ArrayList<>();
    private MoneyReportRepository money;
    private AuditReadRepository audit;
    private final DocFilter filter = new DocFilter("inst-1", LocalDate.of(2026, 11, 1), LocalDate.of(2026, 11, 19),
            null, Set.of("loc-1"), "POS", null);
    private final LocalDateTime from = LocalDateTime.of(2026, 10, 31, 18, 30);
    private final LocalDateTime to = LocalDateTime.of(2026, 11, 19, 18, 30);

    @BeforeEach
    void setUp() throws Exception {
        DataSource dataSource = mock(DataSource.class);
        Connection connection = mock(Connection.class);
        when(dataSource.getConnection()).thenReturn(connection);
        when(connection.prepareStatement(anyString())).thenAnswer(inv -> {
            statements.add(inv.getArgument(0));
            PreparedStatement statement = mock(PreparedStatement.class);
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
        NamedParameterJdbcTemplate jdbc = new NamedParameterJdbcTemplate(new JdbcTemplate(dataSource));
        money = new MoneyReportRepository(jdbc);
        audit = new AuditReadRepository(jdbc);
    }

    private void runEverything() {
        Keyset after = new Keyset(LocalDate.of(2026, 11, 3), "ORD-3", "o-3");
        money.locations("inst-1");
        money.moneyRows(filter, from, to, row -> { });
        money.documentRows(filter, row -> { });
        money.footerSessions(filter, from, to, row -> { });
        money.sessionsOpenedIn(filter, from, to, row -> { });
        money.liveInvoicesOfSessions("inst-1", List.of("s-1"));
        money.paidNotInvoiced(filter, from, to, row -> { });
        money.codOutstanding(filter, LocalDate.of(2026, 11, 19), to, row -> { });
        money.codInTransit(filter, to, row -> { });
        money.remittances(filter, row -> { });
        money.rto(filter, from, to);
        money.dues(filter, after, 101, row -> { });
        money.dueTotals(filter);
        money.salesDocuments(filter, row -> { });
        money.productLines(filter, row -> { });
        money.activeProducts("inst-1");
        money.memberships("inst-1", "COLLECTION");
        money.dayBookStaff(filter, from, to);
        money.sessionCashiers(filter, from, to);
        money.salesStaff(filter);
        AuditFilter auditFilter = new AuditFilter("inst-1", from, to, "user-1", "POS_VOID", Set.of("loc-1"),
                List.of("ord-1"));
        AuditKeyset auditAfter = new AuditKeyset(LocalDateTime.of(2026, 11, 7, 7, 0), "a-2");
        audit.audit(auditFilter, auditAfter, 101, row -> { });
        audit.approvals(auditFilter, auditAfter, 101, row -> { });
        audit.kinds("inst-1");
        audit.actors(auditFilter);
        audit.referenceIds("inst-1", "INV/2627-00003");
    }

    private String statementWith(String text) {
        return statements.stream().filter(s -> s.contains(text)).findFirst()
                .orElseThrow(() -> new AssertionError("no statement with " + text));
    }

    @Test
    void everyStatementFiltersTheInstituteAndReadsNoServerClock() {
        runEverything();
        assertEquals(25, statements.size(), "statements: " + statements.size());
        for (String sql : statements) {
            assertTrue(sql.contains("institute_id = ?"), sql);
            String lower = sql.toLowerCase(Locale.ROOT);
            assertFalse(lower.contains("now()"), sql);
            assertFalse(lower.contains("current_date"), sql);
            assertFalse(lower.contains("current_timestamp"), sql);
            assertFalse(lower.contains("localtimestamp"), sql);
            assertFalse(lower.contains("set time zone"), sql);
            assertFalse(lower.contains("set local"), "the runner sets the timeout, never a query: " + sql);
        }
    }

    @Test
    void noKeywordIsGluedToTheTokenBeforeIt() {
        runEverything();
        for (String sql : statements) {
            Matcher m = GLUED.matcher(sql);
            assertFalse(m.find(), () -> "glued keyword near '" + sql.substring(Math.max(0, m.start() - 40),
                    Math.min(sql.length(), m.end() + 30)) + "'");
        }
    }

    @Test
    void aTimestampBecomesADayOrATimeOnlyThroughTheIndiaZone() {
        runEverything();
        for (String sql : statements) {
            int at = sql.indexOf("::date");
            while (at >= 0) {
                String before = sql.substring(Math.max(0, at - 60), at);
                assertTrue(before.contains("AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')"), sql);
                at = sql.indexOf("::date", at + 1);
            }
            int text = sql.indexOf("'YYYY-MM-DD HH24:MI'");
            while (text >= 0) {
                String before = sql.substring(Math.max(0, text - 70), text);
                assertTrue(before.contains("AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')"), sql);
                text = sql.indexOf("'YYYY-MM-DD HH24:MI'", text + 1);
            }
        }
    }

    @Test
    void theMoneyRulesOfTheDayBookLiveInOneQuery() {
        runEverything();
        String sql = statementWith("'RECEIPT_ON_CREDIT'");
        // Only RECEIVED tenders are money; CREDIT (what is still owed) never is.
        assertTrue(sql.contains("t.status = 'RECEIVED'"));
        assertTrue(sql.contains("t.mode <> 'CREDIT'"));
        // A receipt on credit: a RECEIVED tender of a staff order written after the order.
        assertTrue(sql.contains("WHEN o.channel = 'ADMIN' AND t.created_at > o.created_at THEN 'RECEIPT_ON_CREDIT'"));
        // COD collected is dated by the remittance; a credit note used is not money.
        assertTrue(sql.contains("WHEN t.mode = 'COD' THEN 'COD_COLLECTED'"));
        assertTrue(sql.contains("COALESCE(r.received_on,"));
        assertTrue(sql.contains("WHEN t.mode = 'CREDIT_NOTE' THEN 'CREDIT_NOTE_USED'"));
        // Refunds paid only, by paid_on else processed_at; an exchange credit is labelled apart.
        assertTrue(sql.contains("f.status = 'PROCESSED'"));
        assertTrue(sql.contains("WHEN f.method = 'EXCHANGE_CREDIT' THEN 'EXCHANGE_CREDIT'"));
        assertTrue(sql.contains("COALESCE(f.paid_on,"));
        // Counter cash in and out by its typed date else the India day it was keyed.
        assertTrue(sql.contains("COALESCE(c.document_date,"));
        // Location: the counter session's, else the order's.
        assertTrue(sql.contains("COALESCE(ps.location_id, o.fulfilment_location_id)"));
        assertTrue(sql.contains("m.location_id IN (?)"));
        assertTrue(sql.contains("t.received_at >= ?") && sql.contains("t.received_at < ?"));
    }

    @Test
    void documentsAndSalesReadCommerceDocumentsOnly() {
        runEverything();
        String dayBook = statementWith("AS paper_number");
        assertTrue(dayBook.contains("i.document_type IS NOT NULL"));
        assertTrue(dayBook.contains("i.location_id IN (?)"), "a credit note takes its invoice's location");
        String sales = statementWith("AS line_amount");
        assertTrue(sales.contains("i.document_type IS NOT NULL"));
        assertTrue(sales.contains("i.cancelled_at IS NULL"), "cancelled invoices are not sales");
        assertTrue(sales.contains("THEN 1"), "a measured line counts as one item");
        assertTrue(sales.contains("i.channel = ?"));
        String products = statementWith("AS product_name");
        assertTrue(products.contains("i.cancelled_at IS NULL"));
        assertTrue(products.contains("li.package_session_id IS NOT NULL"));
    }

    @Test
    void codAsOfAndDuesFollowTheDesk() {
        runEverything();
        String outstanding = statementWith("r.received_on <= ?");
        assertTrue(outstanding.contains("o.delivered_at < ?"));
        assertTrue(outstanding.contains("o.payment_method = 'COD'"));
        String dues = statementWith("ORDER BY 3, o.order_number, o.id");
        assertTrue(dues.contains("o.channel = 'ADMIN'"));
        assertTrue(dues.contains("o.payment_status IN ('UNPAID', 'PARTIALLY_PAID')"));
        assertTrue(dues.contains("o.status NOT IN ('CANCELLED', 'RTO')"));
        assertTrue(dues.contains("SUM(r.credit_total - r.due_raised)"));
        assertTrue(dues.contains("r.status IN ('RECEIVED', 'CLOSED')"));
        assertTrue(dues.contains(", o.order_number, o.id) > (?, ?, ?)"), "keyset paging");
        String totals = statementWith("GREATEST(x.total - x.amount_paid - x.credited, 0)");
        assertTrue(totals.contains("COUNT(DISTINCT"));
    }

    @Test
    void auditIsNewestFirstWithAKeysetAndScopedByLocation() {
        runEverything();
        String sql = statementWith("AS reference_label");
        assertTrue(sql.contains("(a.created_at, a.id) < (?, ?)"));
        assertTrue(sql.contains("ORDER BY a.created_at DESC, a.id DESC"));
        assertTrue(sql.contains("a.location_id IN (?)"));
        assertTrue(sql.contains("a.actor_user_id = ?") && sql.contains("a.kind = ?")
                && sql.contains("a.reference_id IN (?)"));
        String approvals = statementWith("FROM commerce_approval ap");
        assertTrue(approvals.contains("x.location_id IN (?)"), "an approval is placed through its reference");
        assertTrue(approvals.contains("ap.reference_id IN (?)"));
        String kinds = statementWith("SELECT DISTINCT a.kind");
        assertTrue(kinds.contains("LIMIT 200"));
    }

    @Test
    void streamingReadsAskForAThousandRowsAtATime() {
        runEverything();
        assertTrue(fetchSizes.stream().allMatch(size -> size == 1000), fetchSizes.toString());
        assertTrue(fetchSizes.size() >= statements.size() - 2);
    }

    @Test
    void anEmptyLocationSetMatchesNothing() {
        DocFilter none = new DocFilter("inst-1", filter.from(), filter.to(), null, Set.of(), null, null);
        money.moneyRows(none, from, to, row -> { });
        assertTrue(statements.get(0).contains("AND FALSE"));
        assertEquals(1, statements.size());
    }
}
