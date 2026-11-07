package vacademy.io.admin_core_service.features.audience.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;

import java.time.Duration;
import java.time.ZoneId;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * Per-institute report settings for the Reports Center, read from the
 * {@code LEAD_SETTING} blob the Settings UI saves:
 *
 * <pre>
 * institute.setting → setting → LEAD_SETTING → data → reports → {
 *   "timezone": "Asia/Kolkata",                  // IANA zone for day/hour bucketing
 *   "connected_call_statuses": ["COMPLETED"],    // telephony statuses counted as "connected"
 *   "interested_status_keys": ["INTERESTED"]     // lead-status keys counted as "interested"
 * }
 * </pre>
 *
 * Every report query reads this, so lookups go through a 5-minute Caffeine
 * cache (same pattern as {@link LeadScoringSettingService}) instead of hitting
 * the institute row each time. There is no evict hook on the generic
 * save-setting endpoint — a settings change takes effect within 5 minutes.
 *
 * Defensive parsing: a missing subtree, an invalid timezone (validated via
 * {@link ZoneId#of}), or an empty/blank status array falls back to the
 * defaults below, so a bad manual edit of the JSON can never blank out live
 * reports. Status sets are returned as unmodifiable {@link LinkedHashSet}s
 * (NOT {@code Set.of}) so {@code contains(null)} is safe for callers checking
 * possibly-null call statuses.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LeadReportSettingService {

    /** Effective report settings for one institute. */
    public record ReportSettings(String timezone,
                                 java.util.Set<String> connectedCallStatuses,
                                 java.util.Set<String> interestedStatusKeys,
                                 java.util.List<String> courseGroupOrder,
                                 String admissionFieldId) {
    }

    public static final String DEFAULT_TIMEZONE = "Asia/Kolkata";

    public static final ReportSettings DEFAULTS = new ReportSettings(
            DEFAULT_TIMEZONE,
            nullSafeSet(Set.of("COMPLETED")),
            nullSafeSet(Set.of("INTERESTED")),
            List.of(),
            null);

    private final InstituteRepository instituteRepository;
    private final ObjectMapper objectMapper;

    private final Cache<String, ReportSettings> byInstituteId = Caffeine.newBuilder()
            .maximumSize(2000)
            .expireAfterWrite(Duration.ofMinutes(5))
            .build();

    /** Cached 5-min; defaults {@code Asia/Kolkata}, {@code ["COMPLETED"]}, {@code ["INTERESTED"]}. */
    public ReportSettings get(String instituteId) {
        if (instituteId == null || instituteId.isBlank()) return DEFAULTS;
        return byInstituteId.get(instituteId, this::load);
    }

    /**
     * The institute's report {@link ZoneId} (already validated on load; defaults
     * to {@code Asia/Kolkata}). Use this to convert an institute-local date
     * window into UTC bounds before querying UTC-stored timestamps.
     */
    public ZoneId zoneOf(String instituteId) {
        try {
            return ZoneId.of(get(instituteId).timezone());
        } catch (Exception e) {
            return ZoneId.of(DEFAULT_TIMEZONE);
        }
    }

    private ReportSettings load(String instituteId) {
        try {
            String settingJson = instituteRepository.findById(instituteId)
                    .map(i -> i.getSetting())
                    .orElse(null);
            if (settingJson == null || settingJson.isBlank()) return DEFAULTS;

            JsonNode root = objectMapper.readTree(settingJson);
            JsonNode reports = root.path("setting").path("LEAD_SETTING").path("data").path("reports");
            if (!reports.isObject()) return DEFAULTS;

            String timezone = validTimezoneOrDefault(reports.path("timezone"), instituteId);

            // Telephony call statuses are stored uppercase (COMPLETED, NO_ANSWER, ...) —
            // normalize so a hand-edited "completed" still matches.
            Set<String> connected = stringSetOrDefault(reports.path("connected_call_statuses"),
                    DEFAULTS.connectedCallStatuses(), true);

            // Lead-status keys are institute-defined catalog keys — keep them as saved.
            Set<String> interested = stringSetOrDefault(reports.path("interested_status_keys"),
                    DEFAULTS.interestedStatusKeys(), false);

            // Course tags in the institute's priority order: a student who joined courses from
            // several groups at once is counted once, under the group that comes first here.
            List<String> courseGroupOrder = orderedStrings(reports.path("course_group_order"));

            // Custom field (e.g. Branch) the Admissions report breaks admissions down by.
            String admissionFieldId = reports.path("admission_field_id").isTextual()
                    && !reports.path("admission_field_id").asText().isBlank()
                    ? reports.path("admission_field_id").asText().trim()
                    : null;

            return new ReportSettings(timezone, connected, interested, courseGroupOrder, admissionFieldId);
        } catch (Exception e) {
            log.warn("Failed to read lead report settings for institute {} — using defaults: {}",
                    instituteId, e.getMessage());
            return DEFAULTS;
        }
    }

    private String validTimezoneOrDefault(JsonNode node, String instituteId) {
        if (!node.isTextual() || node.asText().isBlank()) return DEFAULT_TIMEZONE;
        String candidate = node.asText().trim();
        try {
            ZoneId.of(candidate);
            return candidate;
        } catch (Exception e) {
            log.warn("Invalid report timezone '{}' for institute {} — using default {}",
                    candidate, instituteId, DEFAULT_TIMEZONE);
            return DEFAULT_TIMEZONE;
        }
    }

    /**
     * Parse a JSON array of non-blank strings. Missing, non-array, or
     * empty-after-filtering values fall back to {@code fallback} — an empty
     * connected/interested set would silently zero every report, which always
     * indicates a misconfig rather than intent.
     */
    private Set<String> stringSetOrDefault(JsonNode node, Set<String> fallback, boolean uppercase) {
        if (!node.isArray()) return fallback;
        Set<String> values = new LinkedHashSet<>();
        for (JsonNode item : node) {
            if (!item.isTextual()) continue;
            String v = item.asText().trim();
            if (v.isEmpty()) continue;
            values.add(uppercase ? v.toUpperCase() : v);
        }
        return values.isEmpty() ? fallback : Collections.unmodifiableSet(values);
    }

    /** A JSON array of non-blank strings in saved order, duplicates dropped; empty when absent. */
    private static List<String> orderedStrings(JsonNode node) {
        if (!node.isArray()) return List.of();
        Set<String> values = new LinkedHashSet<>();
        for (JsonNode item : node) {
            if (item.isTextual() && !item.asText().isBlank()) values.add(item.asText().trim());
        }
        return List.copyOf(values);
    }

    /** Unmodifiable set that tolerates {@code contains(null)} (unlike Set.of). */
    private static Set<String> nullSafeSet(Set<String> values) {
        return Collections.unmodifiableSet(new LinkedHashSet<>(values));
    }
}
