package vacademy.io.admin_core_service.features.usage_metering.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.io.IOException;
import java.sql.Date;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * Turns the raw usage sources into daily per-institute rows:
 * {@code institute_storage_usage_daily} and {@code institute_bandwidth_usage_daily}.
 *
 * <p>Collection runs outside any transaction (it is minutes of S3 reads); each day's
 * rows are then replaced in one short transaction, so a re-run for a day is safe.
 */
@Slf4j
@Service
public class UsageMeteringService {

    public static final String CHANNEL_CDN = "CDN";
    public static final String CHANNEL_S3_DIRECT = "S3_DIRECT";

    private final UsageSourceReader reader;
    private final JdbcTemplate jdbcTemplate;
    private final TransactionTemplate transactionTemplate;
    private final List<String> mediaBuckets;

    public UsageMeteringService(UsageSourceReader reader,
                                JdbcTemplate jdbcTemplate,
                                TransactionTemplate transactionTemplate,
                                @Value("${usage.s3.media-buckets:vacademy-media-storage,vacademy-media-storage-public}") List<String> mediaBuckets) {
        this.reader = reader;
        this.jdbcTemplate = jdbcTemplate;
        this.transactionTemplate = transactionTemplate;
        this.mediaBuckets = mediaBuckets;
    }

    public boolean configured() {
        return reader.configured();
    }

    /** Running totals for one row. */
    static final class Totals {
        long bytes;
        long count;
    }

    record StorageKey(String instituteId, String bucket, String category) {
    }

    record BandwidthKey(String instituteId, String channel, String category) {
    }

    /** Institute ids plus every live-session schedule's id and provider meeting id -> its institute. */
    UsageKeyClassifier loadClassifier() {
        Set<String> instituteIds = new HashSet<>(jdbcTemplate.queryForList("SELECT id FROM institutes", String.class));
        Map<String, String> meetings = new HashMap<>();
        jdbcTemplate.query("""
                SELECT s.id, s.provider_meeting_id, l.institute_id
                FROM session_schedules s
                JOIN live_session l ON l.id = s.session_id
                WHERE l.institute_id IS NOT NULL
                """, rs -> {
            String institute = rs.getString(3);
            meetings.put(rs.getString(1), institute);
            String meetingId = rs.getString(2);
            if (meetingId != null && !meetingId.isBlank()) {
                meetings.put(meetingId, institute);
            }
        });
        return new UsageKeyClassifier(instituteIds, meetings);
    }

    /**
     * Storage from each media bucket's newest inventory report.
     *
     * @return the report date written, or empty when no report exists yet
     */
    public Optional<LocalDate> meterStorage() throws IOException {
        UsageKeyClassifier classifier = loadClassifier();
        Map<StorageKey, Totals> totals = new HashMap<>();
        LocalDate reportDate = null;
        for (String bucket : mediaBuckets) {
            Optional<LocalDate> date = reader.readLatestInventory(bucket.trim(), (key, bytes) -> {
                Totals t = totals.computeIfAbsent(new StorageKey(classifier.instituteFor(key), bucket.trim(),
                        UsageKeyClassifier.categoryFor(key)), k -> new Totals());
                t.bytes += bytes;
                t.count++;
            });
            if (date.isPresent() && (reportDate == null || date.get().isAfter(reportDate))) {
                reportDate = date.get();
            }
        }
        if (reportDate == null) {
            log.info("[usage-metering] no inventory report yet; storage skipped");
            return Optional.empty();
        }
        LocalDate day = reportDate;
        List<Object[]> rows = new ArrayList<>();
        totals.forEach((k, t) -> rows.add(new Object[]{UUID.randomUUID().toString(), Date.valueOf(day),
                k.instituteId(), k.bucket(), k.category(), t.bytes, t.count}));
        transactionTemplate.executeWithoutResult(status -> {
            jdbcTemplate.update("DELETE FROM institute_storage_usage_daily WHERE usage_date = ?", Date.valueOf(day));
            jdbcTemplate.batchUpdate("""
                    INSERT INTO institute_storage_usage_daily
                        (id, usage_date, institute_id, bucket, category, bytes, object_count)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """, rows);
        });
        log.info("[usage-metering] storage for {}: {} rows", day, rows.size());
        return Optional.of(day);
    }

    /** Bandwidth for one UTC day from the CDN logs and each media bucket's access logs. */
    public int meterBandwidth(LocalDate day) throws IOException {
        UsageKeyClassifier classifier = loadClassifier();
        Map<BandwidthKey, Totals> totals = new HashMap<>();
        reader.readCdnLogs(day, (key, bytes) -> add(totals, classifier, key, CHANNEL_CDN, bytes));
        for (String bucket : mediaBuckets) {
            reader.readS3AccessLogs(bucket.trim(), day, (key, bytes) -> add(totals, classifier, key, CHANNEL_S3_DIRECT, bytes));
        }
        List<Object[]> rows = new ArrayList<>();
        totals.forEach((k, t) -> rows.add(new Object[]{UUID.randomUUID().toString(), Date.valueOf(day),
                k.instituteId(), k.channel(), k.category(), t.bytes, t.count}));
        transactionTemplate.executeWithoutResult(status -> {
            jdbcTemplate.update("DELETE FROM institute_bandwidth_usage_daily WHERE usage_date = ?", Date.valueOf(day));
            jdbcTemplate.batchUpdate("""
                    INSERT INTO institute_bandwidth_usage_daily
                        (id, usage_date, institute_id, channel, category, bytes, requests)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """, rows);
        });
        log.info("[usage-metering] bandwidth for {}: {} rows", day, rows.size());
        return rows.size();
    }

    private static void add(Map<BandwidthKey, Totals> totals, UsageKeyClassifier classifier,
                            String key, String channel, long bytes) {
        Totals t = totals.computeIfAbsent(new BandwidthKey(classifier.instituteFor(key), channel,
                UsageKeyClassifier.categoryFor(key)), k -> new Totals());
        t.bytes += bytes;
        t.count++;
    }
}
