package vacademy.io.admin_core_service.features.platform_billing.service;

import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.platform_billing.service.PlatformDocumentSequenceService.Series;
import vacademy.io.common.exceptions.VacademyException;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Series v2 numbering: FY in Asia/Kolkata, Rule 46(b) shape, and (against a real Postgres when
 * PLATFORM_BILLING_PG_URL is set) concurrent allocation with no duplicates or gaps.
 */
class PlatformDocumentSequenceServiceTest {

    @Test
    void financialYearRollsOverAtMidnightIstNotUtc() {
        // 31 Mar 2027 23:59:59 IST = 18:29:59 UTC -> still FY 2026-27
        assertEquals("2627", PlatformDocumentSequenceService.financialYear(Instant.parse("2027-03-31T18:29:59Z")));
        // 1 Apr 2027 00:00:00 IST = 18:30:00 UTC on 31 Mar -> FY 2027-28 although UTC still says March
        assertEquals("2728", PlatformDocumentSequenceService.financialYear(Instant.parse("2027-03-31T18:30:00Z")));
        assertEquals("2627", PlatformDocumentSequenceService.financialYear(Instant.parse("2026-03-31T18:30:00Z")));
        assertEquals("2526", PlatformDocumentSequenceService.financialYear(Instant.parse("2026-03-31T18:29:59Z")));
        assertEquals("2627", PlatformDocumentSequenceService.financialYear(Instant.parse("2026-10-16T09:00:00Z")));
        assertEquals("2627", PlatformDocumentSequenceService.financialYear(Instant.parse("2027-01-01T00:00:00Z")));
        // century wrap
        assertEquals("9900", PlatformDocumentSequenceService.financialYear(Instant.parse("2099-06-01T00:00:00Z")));
    }

    @Test
    void numbersMatchRule46ShapeAndNeverExceed16Chars() {
        assertEquals("VT/2627/I00042", PlatformDocumentSequenceService.format(Series.INVOICE, "2627", 42));
        assertEquals("VT/2627/C00003", PlatformDocumentSequenceService.format(Series.CREDIT_NOTE, "2627", 3));
        for (long n : new long[] { 1, 9, 99_999, 100_000, 9_999_999 }) {
            for (Series s : Series.values()) {
                String number = PlatformDocumentSequenceService.format(s, "2627", n);
                assertTrue(number.length() <= 16, number);
                assertTrue(PlatformDocumentSequenceService.ALLOWED.matcher(number).matches(), number);
                assertTrue(PlatformDocumentSequenceService.isSeriesV2(number));
            }
        }
        assertEquals(14, PlatformDocumentSequenceService.format(Series.INVOICE, "2627", 1).length());
        assertThrows(VacademyException.class,
                () -> PlatformDocumentSequenceService.format(Series.INVOICE, "2627", 10_000_000));
        assertThrows(VacademyException.class, () -> PlatformDocumentSequenceService.format(Series.INVOICE, "2627", 0));
        assertFalse(PlatformDocumentSequenceService.isSeriesV2("INV-AICRED-202610-0004"));
    }

    @Test
    void allocationSqlIsOneAtomicUpsertWithReturning() {
        String sql = PlatformDocumentSequenceService.ALLOCATE_SQL;
        assertTrue(sql.contains("ON CONFLICT (series_key, fy)"));
        assertTrue(sql.contains("RETURNING next_no - 1"));
        assertFalse(sql.contains("::"), "no colon casts in native SQL");
        // no glued keywords (text-block trap): every clause boundary has a space
        assertFalse(sql.matches("(?s).*[a-z0-9)]ON CONFLICT.*"));
        assertFalse(sql.matches("(?s).*[a-z0-9)]DO UPDATE.*"));
        assertFalse(sql.matches("(?s).*[a-z0-9]RETURNING.*"));
    }

    /**
     * Real Postgres: 8 threads x 40 allocations, each in its own transaction, across two FYs.
     * Every number is unique and the series has no gaps. Skipped unless PLATFORM_BILLING_PG_URL
     * (a JDBC URL to a scratch database) is set.
     */
    @Test
    void concurrentAllocationOnPostgresHasNoDuplicatesOrGaps() throws Exception {
        String url = System.getenv("PLATFORM_BILLING_PG_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(), "PLATFORM_BILLING_PG_URL not set");

        String ddl = sequenceDdlFromMigration();
        try (Connection c = DriverManager.getConnection(url); Statement st = c.createStatement()) {
            st.execute("DROP TABLE IF EXISTS platform_document_sequence");
            st.execute(ddl);
        }
        String jdbcSql = PlatformDocumentSequenceService.ALLOCATE_SQL.replace(":k", "?").replace(":fy", "?");

        int threads = 8;
        int perThread = 40;
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        List<Future<List<String>>> futures = new ArrayList<>();
        for (int t = 0; t < threads; t++) {
            final int tt = t;
            Callable<List<String>> job = () -> {
                List<String> out = new ArrayList<>();
                try (Connection c = DriverManager.getConnection(url)) {
                    c.setAutoCommit(false);
                    for (int i = 0; i < perThread; i++) {
                        String fy = (i + tt) % 2 == 0 ? "2627" : "2728";
                        try (PreparedStatement ps = c.prepareStatement(jdbcSql)) {
                            ps.setString(1, "I");
                            ps.setString(2, fy);
                            try (ResultSet rs = ps.executeQuery()) {
                                rs.next();
                                out.add(PlatformDocumentSequenceService.format(Series.INVOICE, fy, rs.getLong(1)));
                            }
                        }
                        c.commit();
                    }
                }
                return out;
            };
            futures.add(pool.submit(job));
        }
        List<String> all = new ArrayList<>();
        for (Future<List<String>> f : futures) {
            all.addAll(f.get());
        }
        pool.shutdown();

        assertEquals(threads * perThread, all.size());
        assertEquals(all.size(), all.stream().distinct().count(), "duplicate document numbers");
        for (String fy : new String[] { "2627", "2728" }) {
            List<Long> ns = new ArrayList<>();
            for (String n : all) {
                if (n.startsWith("VT/" + fy + "/I")) {
                    ns.add(Long.parseLong(n.substring(9)));
                }
            }
            Collections.sort(ns);
            for (int i = 0; i < ns.size(); i++) {
                assertEquals(i + 1L, ns.get(i), "gap in FY " + fy);
            }
            assertTrue(all.stream().allMatch(n -> n.length() <= 16));
        }

        // A rolled-back allocation leaves no gap: the counter goes back with the transaction.
        try (Connection c = DriverManager.getConnection(url)) {
            c.setAutoCommit(false);
            try (PreparedStatement ps = c.prepareStatement(jdbcSql)) {
                ps.setString(1, "C");
                ps.setString(2, "2627");
                ps.executeQuery().close();
            }
            c.rollback();
            try (PreparedStatement ps = c.prepareStatement(jdbcSql)) {
                ps.setString(1, "C");
                ps.setString(2, "2627");
                try (ResultSet rs = ps.executeQuery()) {
                    rs.next();
                    assertEquals(1L, rs.getLong(1));
                }
            }
            c.commit();
        }
    }

    /** The CREATE TABLE for platform_document_sequence, verbatim from V590. */
    static String sequenceDdlFromMigration() throws Exception {
        Path p = Path.of("src/main/resources/db/migration/V590__ai_plan_payments_storefront.sql");
        if (!Files.exists(p)) {
            p = Path.of("admin_core_service").resolve(p);
        }
        String sql = Files.readString(p);
        Matcher m = Pattern.compile("(?s)CREATE TABLE IF NOT EXISTS platform_document_sequence \\(.*?\\n\\);").matcher(sql);
        assertTrue(m.find(), "platform_document_sequence DDL not found in V590");
        return m.group();
    }
}
