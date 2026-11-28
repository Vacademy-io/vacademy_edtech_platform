package vacademy.io.admin_core_service.features.commerce.stock.service;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLevelRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLevelRepository.SellableRow;
import vacademy.io.admin_core_service.features.commerce.stock.scheduler.StockReconciliationJob;
import vacademy.io.admin_core_service.features.commerce.stock.scheduler.StockReconciliationJob.Drift;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The nightly job reports and never corrects. Which rows are drifted is decided by the query
 * (proven on a database in CommerceM1StockTaxDatabaseProofIT); here: every row the query
 * returns is reported, with the numbers a person compares.
 */
class StockReconciliationJobTest {

    private static SellableRow row(String id, Integer maxSeats, Integer available, long online, long held,
                                   long sold, long deficit) {
        SellableRow row = mock(SellableRow.class);
        when(row.getInstituteId()).thenReturn("inst-1");
        when(row.getPackageSessionId()).thenReturn(id);
        when(row.getMaxSeats()).thenReturn(maxSeats);
        when(row.getAvailableSlots()).thenReturn(available);
        when(row.getOnlineOnHand()).thenReturn(online);
        when(row.getHeld()).thenReturn(held);
        when(row.getSoldUnshipped()).thenReturn(sold);
        when(row.getDeficit()).thenReturn(deficit);
        return row;
    }

    private static StockReconciliationJob job(List<SellableRow> drifted) {
        StockLevelRepository levels = mock(StockLevelRepository.class);
        when(levels.findSellableDrift(anyInt())).thenReturn(drifted);
        return new StockReconciliationJob(levels);
    }

    @Test
    void noRowFromTheQueryMeansNoDrift() {
        assertTrue(job(List.of()).findSellableDrift().isEmpty());
    }

    @Test
    void aDriftedRowIsReportedWithWhatTheLedgerSays() {
        // 10 on the shelf, 2 held, 3 sold and waiting for dispatch: 5 may be sold, 10 is stored.
        SellableRow availableOff = row("ps-1", 10, 10, 10, 2, 3, 0);
        // 1 on the shelf, 2 held: 1 unit is owed, and the counters say nothing is.
        SellableRow deficitMissing = row("ps-2", 1, 0, 1, 2, 0, 0);
        SellableRow neverCounted = row("ps-3", null, null, 0, 0, 0, 0);

        List<Drift> drift = job(List.of(availableOff, deficitMissing, neverCounted)).findSellableDrift();

        assertEquals(3, drift.size());
        assertEquals(10, drift.get(0).expectedMaxSeats());
        assertEquals(5, drift.get(0).expectedAvailableSlots());
        assertEquals(-1, drift.get(1).expectedAvailableSlots());
        assertEquals(0, drift.get(1).sellableDeficit());
        assertEquals("ps-3", drift.get(2).packageSessionId());
    }

    @Test
    void theRowLimitIsAppliedByTheQuery() {
        StockLevelRepository levels = mock(StockLevelRepository.class);
        when(levels.findSellableDrift(anyInt())).thenReturn(List.of());
        new StockReconciliationJob(levels).findSellableDrift();
        verify(levels).findSellableDrift(500);
    }
}
