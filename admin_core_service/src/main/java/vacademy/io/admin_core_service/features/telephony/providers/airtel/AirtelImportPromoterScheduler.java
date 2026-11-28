package vacademy.io.admin_core_service.features.telephony.providers.airtel;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.domain.Limit;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.AirtelCallImport;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.AirtelCallImportRepository;

import java.util.List;

/**
 * Drains RECEIVED {@code airtel_call_import} rows through {@link AirtelImportPromoter}
 * (each row in its own transaction). Runs slightly after the import poll so CDRs
 * land before their recordings are matched. Inert unless the importer is enabled.
 */
@Component
@ConditionalOnProperty(prefix = "telephony.airtel.s3", name = "enabled", havingValue = "true")
public class AirtelImportPromoterScheduler {

    private static final Logger log = LoggerFactory.getLogger(AirtelImportPromoterScheduler.class);

    @Autowired private AirtelCallImportRepository importRepo;
    @Autowired private AirtelImportPromoter promoter;

    @Value("${telephony.airtel.promote.max-per-run:200}")
    private int maxPerRun;

    // Same reason as AirtelCcrImportScheduler: unlocked, all 4 replicas drained the
    // same RECEIVED rows each tick, so four pods promoted the same import
    // concurrently. Locking also keeps the "runs slightly after the import poll"
    // ordering meaningful -- it is only true if one pod owns each stage.
    @Scheduled(
            fixedDelayString = "${telephony.airtel.promote.poll-ms:120000}",
            initialDelayString = "${telephony.airtel.promote.initial-delay-ms:90000}")
    // 15m for the same reason as the importer. This batch IS bounded (Limit.of
    // max-per-run rows), but each row is promoted in its own transaction and a
    // recording promotion can reach media_service, so 200 rows is not reliably a
    // sub-2-minute unit of work.
    //
    // lockAtLeastFor stays at 30s here, unlike the importer. The waste the importer
    // needed to suppress was its re-probe of every key in the lookback window; this
    // job instead pulls a bounded, indexed batch of RECEIVED rows, so an extra run
    // costs one cheap query and drains any backlog sooner. Only concurrency needs
    // preventing, which is what the lock already does.
    @SchedulerLock(name = "AirtelImportPromoterScheduler_poll", lockAtMostFor = "PT15M", lockAtLeastFor = "PT30S")
    public void poll() {
        List<AirtelCallImport> batch;
        try {
            batch = importRepo.findByProcessingStatusOrderByReceivedAtAsc(
                    AirtelCallImport.STATUS_RECEIVED, Limit.of(maxPerRun));
        } catch (Exception e) {
            log.error("Airtel promoter: failed to load batch: {}", e.getMessage(), e);
            return;
        }
        int processed = 0, failed = 0;
        for (AirtelCallImport imp : batch) {
            // Per-row isolation: each promoteRow is its OWN tx (cross-bean proxy).
            // A single bad row must not abort the whole batch — on failure we record
            // it via markFailed (a SEPARATE tx) so it goes FAILED with the reason in
            // process_detail, instead of rolling back to RECEIVED and re-failing
            // forever (the bug that left every row stuck at RECEIVED).
            try {
                promoter.promoteRow(imp.getId());
                processed++;
            } catch (Exception e) {
                failed++;
                log.error("Airtel promote failed for import {}: {}", imp.getId(), e.getMessage());
                try {
                    promoter.markFailed(imp.getId(), e.getMessage());
                } catch (Exception ignored) {
                    // best-effort — never let recording the failure break the loop
                }
            }
        }
        if (processed > 0 || failed > 0) {
            log.info("Airtel promoter: {} processed, {} failed (of {} RECEIVED in batch)",
                    processed, failed, batch.size());
        }
    }
}
