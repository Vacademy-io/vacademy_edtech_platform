package vacademy.io.admin_core_service.features.telephony.providers.airtel;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.List;

/**
 * Polls the Airtel CCR/CDR export bucket for new objects and hands each to
 * {@link AirtelCcrImportService} (idempotent by s3 key). Lists by recent date
 * prefixes ({@code <YYYYMMDD>/}) — the export is forward-fill, so old dates
 * never gain new objects; a small look-back absorbs the UTC/IST date boundary.
 *
 * Inert unless {@code telephony.airtel.s3.enabled=true}.
 */
@Component
@ConditionalOnProperty(prefix = "telephony.airtel.s3", name = "enabled", havingValue = "true")
public class AirtelCcrImportScheduler {

    private static final Logger log = LoggerFactory.getLogger(AirtelCcrImportScheduler.class);
    private static final DateTimeFormatter DATE_PREFIX = DateTimeFormatter.ofPattern("yyyyMMdd");

    @Autowired private AirtelCcrS3Reader s3;
    @Autowired private AirtelCcrImportService importService;

    @Value("${telephony.airtel.s3.lookback-days:2}")
    private int lookbackDays;

    @Value("${telephony.airtel.import.max-per-run:500}")
    private int maxPerRun;

    // Without the lock this fired on all 4 replicas every tick, so four pods listed
    // the same S3 prefixes and raced to insert the same rows: three lost each time
    // on uk_aci_s3_key. Measured in production over 6h: 20 duplicate-key failures
    // across just 3 distinct recordings, and the s3-key existence probe alone ran at
    // ~155 queries/sec (about a quarter of all admin-core query volume).
    //
    // lockAtMostFor must cover a WHOLE sweep, and max-per-run does not bound one:
    // AirtelCcrImportService.importObject returns false for an already-imported key
    // (it short-circuits on existsByS3Key), so `imported` stays put and the loop
    // still probes every key in the lookback window on every tick -- measured at
    // ~4,600 probes per pod per tick. Run time therefore scales with accumulated
    // call volume over the lookback, not with max-per-run.
    //
    // Hence 15m rather than something near the 2m interval. The asymmetry is the
    // point: over-leasing costs a delayed CDR import if a pod dies mid-sweep, while
    // under-leasing lets the lease expire mid-run, admits a second pod, and reopens
    // the duplicate-insert race this annotation exists to close.
    @Scheduled(
            fixedDelayString = "${telephony.airtel.import.poll-ms:120000}",
            initialDelayString = "${telephony.airtel.import.initial-delay-ms:60000}")
    // lockAtLeastFor is just UNDER the 2m poll interval, not a token 30s. ShedLock
    // shortens the lease to locked_at + lockAtLeastFor when the run finishes, so a
    // short value only prevents CONCURRENT runs, not extra ones: with 4 replicas
    // ticking on staggered 2m timers, a 30s floor left the lock free again after
    // ~30s and whichever pod ticked next simply re-ran the sweep. Observed in
    // production as the lock changing hands every 50-80s across all four pods,
    // which held the s3-key probe reduction to 47% instead of the ~75% that
    // single-pod execution should give. Holding the lease for almost the whole
    // interval makes the sweep genuinely once-per-interval.
    //
    // Keep this strictly below the poll interval -- at or above it, a tick can find
    // the lock still held and skip the cycle entirely.
    @SchedulerLock(name = "AirtelCcrImportScheduler_poll", lockAtMostFor = "PT15M", lockAtLeastFor = "PT110S")
    public void poll() {
        try {
            int imported = 0;
            LocalDate today = LocalDate.now(ZoneOffset.UTC);
            for (int d = 0; d <= lookbackDays && imported < maxPerRun; d++) {
                String prefix = today.minusDays(d).format(DATE_PREFIX) + "/";
                List<String> keys = s3.listKeys(prefix);
                for (String key : keys) {
                    if (imported >= maxPerRun) break;
                    boolean target = (key.contains("/Cdr/") && key.endsWith(".json"))
                            || (key.contains("/Rec/") && key.endsWith(".mp3"));
                    if (!target) continue;
                    if (importService.importObject(key)) imported++;
                }
            }
            if (imported > 0) {
                log.info("Airtel CCR import: {} new object(s) ingested", imported);
            }
        } catch (Exception e) {
            log.error("Airtel CCR import poll failed: {}", e.getMessage(), e);
        }
    }
}
