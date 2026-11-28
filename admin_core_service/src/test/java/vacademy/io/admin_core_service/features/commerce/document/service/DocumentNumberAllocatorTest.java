package vacademy.io.admin_core_service.features.commerce.document.service;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.document.entity.CommerceDocumentSeries;
import vacademy.io.admin_core_service.features.commerce.document.enums.DocumentChannel;
import vacademy.io.admin_core_service.features.commerce.document.enums.SeriesKind;
import vacademy.io.admin_core_service.features.commerce.document.enums.SeriesStatus;
import vacademy.io.common.exceptions.ConflictException;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.ReentrantLock;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The number allocation logic: consecutive numbers, no gap after a rollback, no reuse, no random
 * fallback. The store here is a stand-in for the series row: a lock that is held until the
 * "transaction" ends, like SELECT ... FOR UPDATE. The proof against a real database (50 parallel
 * transactions on one series) is a later database-backed test.
 */
class DocumentNumberAllocatorTest {

    /** One series row with a row lock that a transaction holds until it commits or rolls back. */
    private static final class FakeSeriesRow implements DocumentNumberAllocator.CounterStore {
        private final ReentrantLock rowLock = new ReentrantLock();
        private long committed;
        private final ThreadLocal<Long> pending = new ThreadLocal<>();
        private boolean active = true;

        FakeSeriesRow(long nextValue) {
            this.committed = nextValue;
        }

        @Override
        public Long lockNextValue(String instituteId, String seriesId) {
            rowLock.lock();
            return active ? committed : null;
        }

        @Override
        public void storeNextValue(String seriesId, long nextValue) {
            assertTrue(rowLock.isHeldByCurrentThread(), "the counter is written only under the row lock");
            pending.set(nextValue);
        }

        void commit() {
            if (pending.get() != null) {
                committed = pending.get();
            }
            end();
        }

        void rollback() {
            end();
        }

        private void end() {
            pending.remove();
            while (rowLock.isHeldByCurrentThread()) {
                rowLock.unlock();
            }
        }
    }

    @Test
    void numbersAreConsecutiveAndCarryPrefixAndYear() {
        FakeSeriesRow row = new FakeSeriesRow(1);
        DocumentNumberAllocator allocator = new DocumentNumberAllocator(row);

        DocumentNumberAllocator.Allocation first = allocator.allocate("inst", "s1", "CC/", "2026-27");
        row.commit();
        DocumentNumberAllocator.Allocation second = allocator.allocate("inst", "s1", "CC/", "2026-27");
        row.commit();

        assertEquals("CC/2627-00001", first.number());
        assertEquals("CC/2627-00002", second.number());
        assertEquals(1, first.value());
        assertEquals("s1", second.seriesId());
        assertTrue(second.number().length() <= DocumentNumberAllocator.MAX_NUMBER_LENGTH);
    }

    @Test
    void aRolledBackDocumentLeavesNoGap() {
        FakeSeriesRow row = new FakeSeriesRow(7);
        DocumentNumberAllocator allocator = new DocumentNumberAllocator(row);

        assertEquals("INV2627-00007", allocator.allocate("inst", "s1", "INV", "2026-27").number());
        row.rollback();
        assertEquals("INV2627-00007", allocator.allocate("inst", "s1", "INV", "2026-27").number());
        row.commit();
        assertEquals("INV2627-00008", allocator.allocate("inst", "s1", "INV", "2026-27").number());
        row.commit();
    }

    @Test
    void fiftyParallelIssuesGiveFiftyConsecutiveNumbers() throws Exception {
        FakeSeriesRow row = new FakeSeriesRow(1);
        DocumentNumberAllocator allocator = new DocumentNumberAllocator(row);
        int issuers = 50;
        ExecutorService pool = Executors.newFixedThreadPool(issuers);
        CountDownLatch start = new CountDownLatch(1);
        ConcurrentLinkedQueue<Long> values = new ConcurrentLinkedQueue<>();
        ConcurrentLinkedQueue<String> numbers = new ConcurrentLinkedQueue<>();
        List<java.util.concurrent.Future<?>> futures = new ArrayList<>();
        for (int i = 0; i < issuers; i++) {
            futures.add(pool.submit(() -> {
                start.await();
                try {
                    DocumentNumberAllocator.Allocation allocation =
                            allocator.allocate("inst", "s1", "CC/", "2026-27");
                    values.add(allocation.value());
                    numbers.add(allocation.number());
                    row.commit();
                } catch (RuntimeException e) {
                    row.rollback();
                    throw e;
                }
                return null;
            }));
        }
        start.countDown();
        for (java.util.concurrent.Future<?> future : futures) {
            future.get(30, TimeUnit.SECONDS);
        }
        pool.shutdown();

        Set<Long> distinct = new TreeSet<>(values);
        assertEquals(issuers, distinct.size(), "no number was handed out twice");
        assertEquals(1L, distinct.iterator().next().longValue());
        assertEquals((long) issuers, ((TreeSet<Long>) distinct).last().longValue());
        assertEquals(issuers, new TreeSet<>(numbers).size());
        assertEquals("CC/2627-00051", allocator.allocate("inst", "s1", "CC/", "2026-27").number());
        row.commit();
    }

    @Test
    void parallelIssuesWithRollbacksStillLeaveNoGap() throws Exception {
        FakeSeriesRow row = new FakeSeriesRow(1);
        DocumentNumberAllocator allocator = new DocumentNumberAllocator(row);
        ExecutorService pool = Executors.newFixedThreadPool(20);
        ConcurrentLinkedQueue<Long> committed = new ConcurrentLinkedQueue<>();
        List<java.util.concurrent.Future<?>> futures = new ArrayList<>();
        for (int i = 0; i < 60; i++) {
            boolean fails = i % 3 == 0;
            futures.add(pool.submit(() -> {
                DocumentNumberAllocator.Allocation allocation = allocator.allocate("inst", "s1", "CC/", "2026-27");
                if (fails) {
                    row.rollback();
                } else {
                    committed.add(allocation.value());
                    row.commit();
                }
                return null;
            }));
        }
        for (java.util.concurrent.Future<?> future : futures) {
            future.get(30, TimeUnit.SECONDS);
        }
        pool.shutdown();

        TreeSet<Long> values = new TreeSet<>(committed);
        assertEquals(40, values.size());
        assertEquals(1L, values.first().longValue());
        assertEquals(40L, values.last().longValue());
    }

    @Test
    void aClosedOrForeignSeriesIsRefusedAndNothingIsWritten() {
        FakeSeriesRow row = new FakeSeriesRow(5);
        row.active = false;
        DocumentNumberAllocator allocator = new DocumentNumberAllocator(row);

        ConflictException refused = assertThrows(ConflictException.class,
                () -> allocator.allocate("inst", "s1", "CC/", "2026-27"));
        row.rollback();

        assertTrue(refused.getMessage().startsWith("SERIES_NOT_ACTIVE"));
        assertEquals(5, row.committed);
    }

    @Test
    void anExhaustedSeriesIsRefusedInsteadOfIssuingALongerNumber() {
        // Prefix of six characters: 6 + 4 + 1 + 5 = 16. The value 100000 would need 17.
        FakeSeriesRow row = new FakeSeriesRow(100_000);
        DocumentNumberAllocator allocator = new DocumentNumberAllocator(row);

        ConflictException refused = assertThrows(ConflictException.class,
                () -> allocator.allocate("inst", "s1", "ABCD/-", "2026-27"));
        row.rollback();

        assertTrue(refused.getMessage().startsWith("SERIES_EXHAUSTED"));
        assertEquals(100_000, row.committed);
        assertEquals(16, DocumentNumberAllocator.format("ABCD/-", "2026-27", 99_999).length());
    }

    // ------------------------------------------------------------------ financial year

    @Test
    void theFinancialYearTurnsOnTheFirstOfApril() {
        assertEquals("2025-26", FinancialYear.of(LocalDate.of(2026, 3, 31), 4));
        assertEquals("2026-27", FinancialYear.of(LocalDate.of(2026, 4, 1), 4));
        assertEquals("2026-27", FinancialYear.of(LocalDate.of(2027, 1, 15), 4));
        assertEquals("2099-00", FinancialYear.of(LocalDate.of(2099, 12, 1), 4));
        assertEquals("2026", FinancialYear.of(LocalDate.of(2026, 12, 31), 1));
        assertEquals("2627", FinancialYear.token("2026-27"));
        assertEquals("2026", FinancialYear.token("2026"));
        assertEquals(2026, FinancialYear.startYear("2026-27"));
        assertThrows(IllegalArgumentException.class, () -> FinancialYear.token("26-27"));
    }

    @Test
    void aNewYearStartsAgainAtOneWithADifferentNumber() {
        assertEquals("CC/2627-00001", DocumentNumberAllocator.format("CC/", "2026-27", 1));
        assertEquals("CC/2728-00001", DocumentNumberAllocator.format("CC/", "2027-28", 1));
    }

    // ------------------------------------------------------------------ choosing the series

    @Test
    void theMostSpecificSeriesWins() {
        CommerceDocumentSeries institute = series("A", null, null, DocumentChannel.ALL, null);
        CommerceDocumentSeries location = series("B", "loc-1", null, DocumentChannel.ALL, null);
        CommerceDocumentSeries register = series("C", "loc-1", "reg-1", DocumentChannel.POS, null);
        List<CommerceDocumentSeries> all = List.of(institute, location, register);

        assertEquals("C", SeriesPicker.pick(all, null, "loc-1", "reg-1", "POS").orElseThrow().getPrefix());
        // Another register of the same location falls back to the location series.
        assertEquals("B", SeriesPicker.pick(all, null, "loc-1", "reg-2", "POS").orElseThrow().getPrefix());
        assertEquals("B", SeriesPicker.pick(all, null, "loc-1", null, "ONLINE").orElseThrow().getPrefix());
        assertEquals("A", SeriesPicker.pick(all, null, "loc-2", null, "ONLINE").orElseThrow().getPrefix());
    }

    @Test
    void aSeriesOfAnotherGstinChannelOrKindNeverMatches() {
        CommerceDocumentSeries otherGstin = series("G", null, null, DocumentChannel.ALL, "27AAPFU0939F1ZV");
        CommerceDocumentSeries posOnly = series("P", null, null, DocumentChannel.POS, null);
        CommerceDocumentSeries book = series("M", null, null, DocumentChannel.ALL, null);
        book.setKind(SeriesKind.MANUAL_BOOK.name());
        CommerceDocumentSeries closed = series("X", null, null, DocumentChannel.ALL, null);
        closed.setStatus(SeriesStatus.CLOSED.name());

        Optional<CommerceDocumentSeries> picked = SeriesPicker.pick(List.of(otherGstin, posOnly, book, closed),
                "09AAACH7409R1ZZ", null, null, "ONLINE");

        assertTrue(picked.isEmpty());
        assertEquals("G", SeriesPicker.pick(List.of(otherGstin), "27AAPFU0939F1ZV", null, null, "ONLINE")
                .orElseThrow().getPrefix());
    }

    @Test
    void equalCandidatesAreChosenByPrefixNotByRowOrder() {
        CommerceDocumentSeries b = series("B", null, null, DocumentChannel.ALL, null);
        CommerceDocumentSeries a = series("A", null, null, DocumentChannel.ALL, null);

        assertEquals("A", SeriesPicker.pick(List.of(b, a), null, null, null, "ONLINE").orElseThrow().getPrefix());
        assertEquals("A", SeriesPicker.pick(List.of(a, b), null, null, null, "ONLINE").orElseThrow().getPrefix());
    }

    private static CommerceDocumentSeries series(String prefix, String locationId, String registerId,
                                                 DocumentChannel channel, String gstin) {
        CommerceDocumentSeries series = new CommerceDocumentSeries();
        series.setPrefix(prefix);
        series.setLocationId(locationId);
        series.setRegisterId(registerId);
        series.setChannel(channel.name());
        series.setSellerGstin(gstin);
        series.setKind(SeriesKind.SYSTEM.name());
        series.setStatus(SeriesStatus.ACTIVE.name());
        series.setFinancialYear("2026-27");
        series.setDocumentType("TAX_INVOICE");
        return series;
    }
}
