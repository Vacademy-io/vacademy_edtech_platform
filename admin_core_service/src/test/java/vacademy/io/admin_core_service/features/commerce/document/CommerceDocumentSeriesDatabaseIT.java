package vacademy.io.admin_core_service.features.commerce.document;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.data.jpa.repository.Query;
import vacademy.io.admin_core_service.features.commerce.document.repository.CommerceDocumentSeriesRepository;
import vacademy.io.admin_core_service.features.commerce.document.service.DocumentNumberAllocator;

import java.lang.reflect.Method;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.List;
import java.util.TreeSet;
import java.util.UUID;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * Database-backed proof of the number allocation (acceptance: 50 parallel
 * issues on one series give 50 consecutive numbers; no gap after a rollback).
 *
 * <p>Not part of the default build: the name ends in IT and every test is skipped unless
 * COMMERCE_IT_PG_URL names a local throwaway Postgres that already holds the migrated schema
 * (V682), exactly as for {@code CommerceM1DatabaseProofIT}. It uses plain JDBC, one connection
 * and one transaction per issuer, and runs the very SQL of
 * {@link CommerceDocumentSeriesRepository}, read from its {@code @Query} annotations, so the
 * statements proven here are the statements the service runs.
 */
@EnabledIfEnvironmentVariable(named = "COMMERCE_IT_PG_URL",
        matches = "jdbc:postgresql://(127\\.0\\.0\\.1|localhost)[:/].*")
class CommerceDocumentSeriesDatabaseIT {

    private final String instituteId = "it-" + UUID.randomUUID().toString().substring(0, 30);
    private final String seriesId = UUID.randomUUID().toString();

    private static Connection connect() throws Exception {
        String user = System.getenv("COMMERCE_IT_PG_USER") != null ? System.getenv("COMMERCE_IT_PG_USER") : "postgres";
        String password = System.getenv("COMMERCE_IT_PG_PASSWORD") != null
                ? System.getenv("COMMERCE_IT_PG_PASSWORD") : "";
        Connection connection = DriverManager.getConnection(System.getenv("COMMERCE_IT_PG_URL"), user, password);
        connection.setAutoCommit(false);
        return connection;
    }

    /** The native SQL of a repository method, with its named parameters turned into JDBC ones. */
    private static String sqlOf(String methodName, String... parameterOrder) throws Exception {
        for (Method method : CommerceDocumentSeriesRepository.class.getDeclaredMethods()) {
            if (method.getName().equals(methodName)) {
                String sql = method.getAnnotation(Query.class).value();
                for (String name : parameterOrder) {
                    sql = sql.replaceFirst(":" + name + "\\b", "?");
                }
                if (sql.contains(":")) {
                    throw new IllegalStateException("unmapped parameter in " + methodName + ": " + sql);
                }
                return sql;
            }
        }
        throw new IllegalStateException("no such repository method: " + methodName);
    }

    /** One issuer: its own connection, its own transaction. */
    private final class JdbcStore implements DocumentNumberAllocator.CounterStore {
        private final Connection connection;

        JdbcStore(Connection connection) {
            this.connection = connection;
        }

        @Override
        public Long lockNextValue(String institute, String series) {
            // The statement order in the annotation is seriesId, then instituteId.
            try (PreparedStatement statement = connection.prepareStatement(
                    sqlOf("lockNextValue", "seriesId", "instituteId"))) {
                statement.setString(1, series);
                statement.setString(2, institute);
                try (ResultSet rows = statement.executeQuery()) {
                    return rows.next() ? rows.getLong(1) : null;
                }
            } catch (Exception e) {
                throw new IllegalStateException(e);
            }
        }

        @Override
        public void storeNextValue(String series, long nextValue) {
            try (PreparedStatement statement = connection.prepareStatement(
                    sqlOf("storeNextValue", "nextValue", "seriesId"))) {
                statement.setLong(1, nextValue);
                statement.setString(2, series);
                assertEquals(1, statement.executeUpdate());
            } catch (Exception e) {
                throw new IllegalStateException(e);
            }
        }
    }

    @BeforeEach
    void createSeries() throws Exception {
        try (Connection connection = connect(); PreparedStatement statement = connection.prepareStatement(
                "INSERT INTO commerce_document_series (id, institute_id, channel, document_type, kind, prefix,"
                        + " financial_year, next_value, status)"
                        + " VALUES (?, ?, 'ALL', 'TAX_INVOICE', 'SYSTEM', 'IT/', '2026-27', 1, 'ACTIVE')")) {
            statement.setString(1, seriesId);
            statement.setString(2, instituteId);
            statement.executeUpdate();
            connection.commit();
        }
    }

    @AfterEach
    void removeSeries() throws Exception {
        try (Connection connection = connect(); PreparedStatement statement = connection.prepareStatement(
                "DELETE FROM commerce_document_series WHERE institute_id = ?")) {
            statement.setString(1, instituteId);
            statement.executeUpdate();
            connection.commit();
        }
    }

    private long storedNextValue() throws Exception {
        try (Connection connection = connect(); PreparedStatement statement = connection.prepareStatement(
                "SELECT next_value FROM commerce_document_series WHERE id = ?")) {
            statement.setString(1, seriesId);
            try (ResultSet rows = statement.executeQuery()) {
                rows.next();
                return rows.getLong(1);
            }
        }
    }

    @Test
    void fiftyParallelTransactionsGetFiftyConsecutiveNumbers() throws Exception {
        int issuers = 50;
        ExecutorService pool = Executors.newFixedThreadPool(issuers);
        CountDownLatch start = new CountDownLatch(1);
        ConcurrentLinkedQueue<Long> values = new ConcurrentLinkedQueue<>();
        ConcurrentLinkedQueue<String> numbers = new ConcurrentLinkedQueue<>();
        List<Future<?>> futures = new ArrayList<>();
        for (int i = 0; i < issuers; i++) {
            futures.add(pool.submit(() -> {
                try (Connection connection = connect()) {
                    start.await();
                    DocumentNumberAllocator.Allocation allocation = new DocumentNumberAllocator(
                            new JdbcStore(connection)).allocate(instituteId, seriesId, "IT/", "2026-27");
                    // Hold the lock for a moment, as a real document insert would.
                    Thread.sleep(5);
                    connection.commit();
                    values.add(allocation.value());
                    numbers.add(allocation.number());
                }
                return null;
            }));
        }
        start.countDown();
        for (Future<?> future : futures) {
            future.get(60, TimeUnit.SECONDS);
        }
        pool.shutdown();

        TreeSet<Long> distinct = new TreeSet<>(values);
        assertEquals(issuers, distinct.size(), "no number was handed out twice");
        assertEquals(1L, distinct.first().longValue());
        assertEquals(issuers, distinct.last().longValue());
        assertEquals(issuers, new TreeSet<>(numbers).size());
        assertEquals(issuers + 1L, storedNextValue());
    }

    @Test
    void aRolledBackTransactionLeavesNoGap() throws Exception {
        try (Connection connection = connect()) {
            assertEquals("IT/2627-00001", new DocumentNumberAllocator(new JdbcStore(connection))
                    .allocate(instituteId, seriesId, "IT/", "2026-27").number());
            connection.rollback();
        }
        assertEquals(1L, storedNextValue());
        try (Connection connection = connect()) {
            assertEquals("IT/2627-00001", new DocumentNumberAllocator(new JdbcStore(connection))
                    .allocate(instituteId, seriesId, "IT/", "2026-27").number());
            connection.commit();
        }
        assertEquals(2L, storedNextValue());
    }

    @Test
    void aSeriesOfAnotherInstituteOrAClosedOneCannotBeLocked() throws Exception {
        try (Connection connection = connect()) {
            assertNull(new JdbcStore(connection).lockNextValue("another-institute", seriesId));
            try (PreparedStatement close = connection.prepareStatement(
                    "UPDATE commerce_document_series SET status = 'CLOSED' WHERE id = ?")) {
                close.setString(1, seriesId);
                close.executeUpdate();
            }
            assertNull(new JdbcStore(connection).lockNextValue(instituteId, seriesId));
            connection.rollback();
        }
    }
}
