package vacademy.io.admin_core_service.features.commerce.stock.scheduler;

import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLevelRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLevelRepository.PieceDriftRow;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLevelRepository.SellableRow;
import vacademy.io.common.logging.SentryLogger;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Nightly check of the sellable invariant, per TRACKED variant:
 * <pre>
 * max_seats                          = on hand at locations that sell online
 * available_slots - sellable_deficit = that quantity - held quantity - sold-but-unshipped quantity
 * </pre>
 * and, for one-of-a-kind stock, on hand at a location = its pieces IN_STOCK or RESERVED there.
 *
 * <p>It reports drift (log and one Sentry warning per run) and changes nothing: after-commit
 * stock steps can fail, and a person decides what the right number is. A hold that was being
 * released while the job read can show as drift for one night; a row that stays is real.
 *
 * <p>ShedLock keeps the pods from all running it. The JVM is in UTC: 21:20 is 02:50 in India.
 */
@Slf4j
@Component
public class StockReconciliationJob {

    /** Rows read and reported per run; the log says when the cap was reached. */
    static final int MAX_ROWS = 500;

    /**
     * One variant whose counters do not match the ledger. {@code expectedAvailableSlots} is
     * on hand online less held less sold-and-unshipped, and can be below zero: then
     * available_slots should be 0 and {@code sellableDeficit} should be the rest.
     */
    public record Drift(String instituteId, String packageSessionId, Integer maxSeats, long expectedMaxSeats,
                        Integer availableSlots, long expectedAvailableSlots, long sellableDeficit) {
    }

    private final StockLevelRepository levelRepository;

    public StockReconciliationJob(StockLevelRepository levelRepository) {
        this.levelRepository = levelRepository;
    }

    @Scheduled(cron = "${commerce.stock.reconcile.cron:0 20 21 * * *}")
    @SchedulerLock(name = "CommerceStockReconciliationJob", lockAtMostFor = "PT30M", lockAtLeastFor = "PT1M")
    public void run() {
        try {
            List<Drift> drifted = findSellableDrift();
            List<PieceDriftRow> pieceDrift = levelRepository.findPieceDrift(MAX_ROWS);
            for (Drift drift : drifted) {
                log.error("STOCK DRIFT: variant {} of institute {} has max_seats {} (ledger says {}) and "
                                + "available_slots {} less deficit {} (ledger says {})",
                        drift.packageSessionId(), drift.instituteId(), drift.maxSeats(), drift.expectedMaxSeats(),
                        drift.availableSlots(), drift.sellableDeficit(), drift.expectedAvailableSlots());
            }
            for (PieceDriftRow row : pieceDrift) {
                log.error("STOCK DRIFT: variant {} at location {} of institute {} has on_hand {} but {} piece(s)",
                        row.getPackageSessionId(), row.getLocationId(), row.getInstituteId(), row.getOnHand(),
                        row.getPieces());
            }
            if (drifted.isEmpty() && pieceDrift.isEmpty()) {
                log.info("Stock reconciliation: no drift");
                return;
            }
            SentryLogger.logWarning("Commerce stock reconciliation found drift; nothing was corrected",
                    Map.of("variants", String.valueOf(drifted.size()),
                            "pieceLevels", String.valueOf(pieceDrift.size()),
                            "capped", String.valueOf(drifted.size() >= MAX_ROWS || pieceDrift.size() >= MAX_ROWS)));
        } catch (Exception e) {
            log.error("StockReconciliationJob failed: {}", e.getMessage(), e);
        }
    }

    /**
     * The drifted variants, at most {@link #MAX_ROWS}. Changes nothing. The comparison is made
     * in the query; here the row is only turned into the two numbers a person compares:
     * what may be sold (available_slots less the deficit) and what the ledger says.
     */
    public List<Drift> findSellableDrift() {
        List<Drift> drifted = new ArrayList<>();
        for (SellableRow row : levelRepository.findSellableDrift(MAX_ROWS)) {
            long online = value(row.getOnlineOnHand());
            long expected = online - value(row.getHeld()) - value(row.getSoldUnshipped());
            drifted.add(new Drift(row.getInstituteId(), row.getPackageSessionId(), row.getMaxSeats(), online,
                    row.getAvailableSlots(), expected, value(row.getDeficit())));
        }
        return drifted;
    }

    private static long value(Long number) {
        return number == null ? 0 : number;
    }
}
