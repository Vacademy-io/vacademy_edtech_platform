package vacademy.io.admin_core_service.features.utm_attribution.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.audience.service.LeadReportSettingService;
import vacademy.io.admin_core_service.features.utm_attribution.dto.UtmDashboardResponse;
import vacademy.io.admin_core_service.features.utm_attribution.dto.UtmFilterOptionsResponse;

import java.sql.Timestamp;
import java.sql.Types;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;

/**
 * Read models for the campaign-attribution dashboard and the list pages'
 * campaign filter dropdowns.
 *
 * The dashboard pulls every touch in the window ONCE, with the person behind
 * it already resolved (see {@link #TOUCH_SQL}), and does all the grouping in
 * Java. Eight aggregate queries over the same CTE would cost eight identity
 * resolutions of the same rows; a window's worth of touches for one institute
 * is a few hundred to a few thousand rows and fits comfortably in memory.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class UtmDashboardService {

    private static final int DEFAULT_RANGE_DAYS = 30;
    private static final int MAX_TOUCH_ROWS = 200_000;
    private static final int MAX_OPTIONS_PER_DIMENSION = 500;

    private final NamedParameterJdbcTemplate jdbc;
    private final LeadReportSettingService settingService;

    /**
     * One row per touch in the window, with the person resolved to a stable
     * key. resolved_user_id is the user id the touch carried, else the user id
     * that a learner row or a lead in this institute later captured for the
     * same email / mobile — the identity the attribution card on the profile
     * already uses. person_key falls back to the contact detail itself for a
     * touch nobody has claimed yet, so "people" never under-counts.
     *
     * Values are lower-cased on the way out: "Facebook" and "facebook" are one
     * source to a marketer, and the FE builder lower-cases what it emits, so
     * mixed case only ever comes from links built elsewhere.
     */
    private static final String TOUCH_SQL = """
            WITH touches AS (
                SELECT u.id, u.user_id, u.email,
                       CASE WHEN u.mobile_number IS NOT NULL
                                 AND LENGTH(REGEXP_REPLACE(u.mobile_number, '[^0-9]', '', 'g')) >= 8
                            THEN u.mobile_number END AS mobile_number,
                       LOWER(u.utm_source) AS utm_source,
                       LOWER(u.utm_medium) AS utm_medium,
                       LOWER(u.utm_campaign) AS utm_campaign,
                       LOWER(u.utm_content) AS utm_content,
                       LOWER(u.utm_term) AS utm_term,
                       u.source_type, u.created_at
                FROM utm_attribution u
                WHERE u.institute_id = :instituteId
                  AND u.created_at >= :fromTs AND u.created_at < :toTs
            ),
            resolved AS (
                SELECT t.*,
                       COALESCE(t.user_id,
                           (SELECT s.user_id FROM student s
                             WHERE t.email IS NOT NULL AND LOWER(s.email) = t.email
                               AND s.user_id IS NOT NULL LIMIT 1),
                           (SELECT s.user_id FROM student s
                             WHERE t.mobile_number IS NOT NULL AND s.mobile_number = t.mobile_number
                               AND s.user_id IS NOT NULL LIMIT 1),
                           (SELECT ar.user_id FROM audience_response ar
                              JOIN audience a ON a.id = ar.audience_id AND a.institute_id = :instituteId
                             WHERE t.email IS NOT NULL AND LOWER(ar.parent_email) = t.email
                               AND ar.user_id IS NOT NULL LIMIT 1),
                           (SELECT ar.user_id FROM audience_response ar
                              JOIN audience a ON a.id = ar.audience_id AND a.institute_id = :instituteId
                             WHERE t.mobile_number IS NOT NULL AND ar.parent_mobile = t.mobile_number
                               AND ar.user_id IS NOT NULL LIMIT 1)
                       ) AS resolved_user_id
                FROM touches t
            )
            SELECT r.id,
                   COALESCE(r.resolved_user_id, r.email, r.mobile_number) AS person_key,
                   (r.resolved_user_id IS NOT NULL AND EXISTS (
                        SELECT 1 FROM student_session_institute_group_mapping m
                         WHERE m.user_id = r.resolved_user_id
                           AND m.institute_id = :instituteId
                           AND m.status = 'ACTIVE')) AS enrolled,
                   r.utm_source, r.utm_medium, r.utm_campaign, r.utm_content, r.utm_term,
                   r.source_type, r.created_at
            FROM resolved r
            ORDER BY r.created_at
            LIMIT %d
            """.formatted(MAX_TOUCH_ROWS);

    /** Leads submitted in the window (soft-deleted excluded) — the coverage denominator. */
    private static final String LEADS_IN_WINDOW_SQL = """
            SELECT COUNT(*) FROM audience_response ar
              JOIN audience a ON a.id = ar.audience_id AND a.institute_id = :instituteId
             WHERE ar.submitted_at >= :fromTs AND ar.submitted_at < :toTs
               AND ar.audience_status = 'ACTIVE'
            """;

    /** Of those, how many have any recorded touch (at any time) — the coverage numerator. */
    private static final String ATTRIBUTED_LEADS_IN_WINDOW_SQL = LEADS_IN_WINDOW_SQL + """
               AND EXISTS (
                   SELECT 1 FROM utm_attribution u
                    WHERE u.institute_id = :instituteId
                      AND ((u.user_id IS NOT NULL AND (u.user_id = ar.user_id OR u.user_id = ar.student_user_id))
                        OR (u.email IS NOT NULL AND ar.parent_email IS NOT NULL AND LOWER(ar.parent_email) = u.email)
                        OR (u.mobile_number IS NOT NULL
                            AND LENGTH(REGEXP_REPLACE(u.mobile_number, '[^0-9]', '', 'g')) >= 8
                            AND ar.parent_mobile = u.mobile_number)))
            """;

    // ── Dashboard ────────────────────────────────────────────────────────

    public UtmDashboardResponse dashboard(String instituteId, String fromDate, String toDate) {
        ZoneId zone = zoneFor(instituteId);
        Window w = resolveWindow(fromDate, toDate, zone);
        MapSqlParameterSource params = new MapSqlParameterSource()
                .addValue("instituteId", instituteId)
                .addValue("fromTs", w.fromUtc(), Types.TIMESTAMP)
                .addValue("toTs", w.toUtc(), Types.TIMESTAMP);

        List<Touch> touches = jdbc.query(TOUCH_SQL, params, (rs, i) -> new Touch(
                rs.getString("person_key"),
                rs.getBoolean("enrolled"),
                rs.getString("utm_source"),
                rs.getString("utm_medium"),
                rs.getString("utm_campaign"),
                rs.getString("utm_content"),
                rs.getString("utm_term"),
                rs.getString("source_type"),
                rs.getTimestamp("created_at")));

        long leadsInWindow = count(LEADS_IN_WINDOW_SQL, params);
        long attributedLeads = leadsInWindow == 0 ? 0 : count(ATTRIBUTED_LEADS_IN_WINDOW_SQL, params);

        return UtmDashboardResponse.builder()
                .totals(totals(touches, leadsInWindow, attributedLeads))
                .bySource(buckets(touches, Touch::source))
                .byMedium(buckets(touches, Touch::medium))
                .byCampaign(buckets(touches, Touch::campaign))
                .byContent(buckets(touches, Touch::content))
                .byTerm(buckets(touches, Touch::term))
                .bySourceType(buckets(touches, Touch::sourceType))
                .trend(trend(touches, w, zone))
                .campaigns(campaignRows(touches))
                .build();
    }

    private UtmDashboardResponse.Totals totals(List<Touch> touches, long leadsInWindow, long attributedLeads) {
        Set<String> people = new HashSet<>();
        Set<String> enrolled = new HashSet<>();
        Set<String> sources = new HashSet<>();
        Set<String> campaigns = new HashSet<>();
        for (Touch t : touches) {
            if (t.personKey() != null) {
                people.add(t.personKey());
                if (t.enrolled()) enrolled.add(t.personKey());
            }
            if (t.source() != null) sources.add(t.source());
            if (t.campaign() != null) campaigns.add(t.campaign());
        }
        return UtmDashboardResponse.Totals.builder()
                .touches(touches.size())
                .people(people.size())
                .enrolled(enrolled.size())
                .distinctSources(sources.size())
                .distinctCampaigns(campaigns.size())
                .leadsInWindow(leadsInWindow)
                .attributedLeadsInWindow(attributedLeads)
                .build();
    }

    /** Group by one dimension; null keys (touch had no value) form their own bucket. */
    private List<UtmDashboardResponse.Bucket> buckets(List<Touch> touches, Function<Touch, String> key) {
        Map<String, Agg> byKey = new LinkedHashMap<>();
        for (Touch t : touches) {
            byKey.computeIfAbsent(key.apply(t), k -> new Agg()).add(t);
        }
        List<UtmDashboardResponse.Bucket> out = new ArrayList<>();
        byKey.forEach((k, agg) -> out.add(UtmDashboardResponse.Bucket.builder()
                .key(k)
                .touches(agg.touches)
                .people(agg.people.size())
                .enrolled(agg.enrolled.size())
                .build()));
        // Most people first; the "no value" bucket sinks below every named one
        // of equal size so a report never opens on a blank label.
        out.sort(Comparator.comparingLong(UtmDashboardResponse.Bucket::getPeople).reversed()
                .thenComparing(Comparator.comparingLong(UtmDashboardResponse.Bucket::getTouches).reversed())
                .thenComparingInt(b -> b.getKey() == null ? 1 : 0)
                .thenComparing(b -> b.getKey() == null ? "" : b.getKey()));
        return out;
    }

    /** One point per calendar day of the window (institute timezone), zero-filled. */
    private List<UtmDashboardResponse.TrendPoint> trend(List<Touch> touches, Window w, ZoneId zone) {
        Map<LocalDate, Agg> byDay = new LinkedHashMap<>();
        LocalDate from = w.fromUtc().toInstant().atZone(ZoneOffset.UTC).withZoneSameInstant(zone).toLocalDate();
        LocalDate to = w.toUtc().toInstant().atZone(ZoneOffset.UTC).withZoneSameInstant(zone).toLocalDate();
        // Guard against a runaway window producing hundreds of thousands of points.
        long days = Math.min(400, Math.max(1, java.time.temporal.ChronoUnit.DAYS.between(from, to)));
        for (long i = 0; i < days; i++) byDay.put(from.plusDays(i), new Agg());
        for (Touch t : touches) {
            if (t.createdAt() == null) continue;
            LocalDate day = t.createdAt().toInstant().atZone(ZoneOffset.UTC).withZoneSameInstant(zone).toLocalDate();
            Agg agg = byDay.get(day);
            if (agg != null) agg.add(t);
        }
        List<UtmDashboardResponse.TrendPoint> out = new ArrayList<>();
        byDay.forEach((day, agg) -> out.add(UtmDashboardResponse.TrendPoint.builder()
                .date(day.toString())
                .touches(agg.touches)
                .people(agg.people.size())
                .build()));
        return out;
    }

    private List<UtmDashboardResponse.CampaignRow> campaignRows(List<Touch> touches) {
        Map<String, CampaignAgg> byKey = new LinkedHashMap<>();
        for (Touch t : touches) {
            String k = String.join("",
                    nz(t.campaign()), nz(t.source()), nz(t.medium()), nz(t.sourceType()));
            byKey.computeIfAbsent(k, x -> new CampaignAgg(t)).add(t);
        }
        List<UtmDashboardResponse.CampaignRow> out = new ArrayList<>();
        for (CampaignAgg agg : byKey.values()) {
            out.add(UtmDashboardResponse.CampaignRow.builder()
                    .utmCampaign(agg.first.campaign())
                    .utmSource(agg.first.source())
                    .utmMedium(agg.first.medium())
                    .sourceType(agg.first.sourceType())
                    .touches(agg.touches)
                    .people(agg.people.size())
                    .enrolled(agg.enrolled.size())
                    .firstSeen(agg.firstSeen)
                    .lastSeen(agg.lastSeen)
                    .build());
        }
        out.sort(Comparator.comparingLong(UtmDashboardResponse.CampaignRow::getPeople).reversed()
                .thenComparing(Comparator.comparingLong(UtmDashboardResponse.CampaignRow::getTouches).reversed()));
        return out;
    }

    // ── Filter options ───────────────────────────────────────────────────

    public UtmFilterOptionsResponse filterOptions(String instituteId) {
        MapSqlParameterSource params = new MapSqlParameterSource("instituteId", instituteId);
        Long total = jdbc.queryForObject(
                "SELECT COUNT(*) FROM utm_attribution WHERE institute_id = :instituteId", params, Long.class);
        return UtmFilterOptionsResponse.builder()
                .sources(distinct("LOWER(utm_source)", params))
                .mediums(distinct("LOWER(utm_medium)", params))
                .campaigns(distinct("LOWER(utm_campaign)", params))
                .contents(distinct("LOWER(utm_content)", params))
                .terms(distinct("LOWER(utm_term)", params))
                .sourceTypes(distinct("source_type", params))
                .totalTouches(total == null ? 0 : total)
                .build();
    }

    private List<String> distinct(String expr, MapSqlParameterSource params) {
        // expr is one of a fixed set of column expressions above — never user input.
        String sql = "SELECT DISTINCT " + expr + " AS v FROM utm_attribution "
                + "WHERE institute_id = :instituteId AND " + expr + " IS NOT NULL AND " + expr + " <> '' "
                + "ORDER BY v LIMIT " + MAX_OPTIONS_PER_DIMENSION;
        return jdbc.query(sql, params, (rs, i) -> rs.getString("v"));
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    private long count(String sql, MapSqlParameterSource params) {
        Long n = jdbc.queryForObject(sql, params, Long.class);
        return n == null ? 0 : n;
    }

    private ZoneId zoneFor(String instituteId) {
        try {
            return ZoneId.of(settingService.get(instituteId).timezone());
        } catch (Exception e) {
            return ZoneId.of("Asia/Kolkata");
        }
    }

    /**
     * fromDate/toDate are dates in the institute timezone; created_at is UTC
     * wall-clock in a timestamp-without-time-zone column, so the bounds are
     * converted here and the SQL compares plain timestamps.
     */
    private static Window resolveWindow(String fromDate, String toDate, ZoneId zone) {
        LocalDate today = LocalDate.now(zone);
        LocalDate to = parseOr(toDate, today);
        LocalDate from = parseOr(fromDate, to.minusDays(DEFAULT_RANGE_DAYS - 1L));
        if (from.isAfter(to)) from = to;
        return new Window(
                Timestamp.valueOf(from.atStartOfDay(zone).withZoneSameInstant(ZoneOffset.UTC).toLocalDateTime()),
                Timestamp.valueOf(to.plusDays(1).atStartOfDay(zone).withZoneSameInstant(ZoneOffset.UTC).toLocalDateTime()));
    }

    private static LocalDate parseOr(String iso, LocalDate fallback) {
        if (iso == null || iso.isBlank()) return fallback;
        try {
            return LocalDate.parse(iso.trim());
        } catch (Exception e) {
            return fallback;
        }
    }

    private static String nz(String s) {
        return s == null ? "" : s;
    }

    private record Window(Timestamp fromUtc, Timestamp toUtc) {
    }

    private record Touch(String personKey, boolean enrolled, String source, String medium,
                         String campaign, String content, String term, String sourceType,
                         Timestamp createdAt) {
    }

    private static class Agg {
        long touches;
        final Set<String> people = new HashSet<>();
        final Set<String> enrolled = new HashSet<>();

        void add(Touch t) {
            touches++;
            if (t.personKey() != null) {
                people.add(t.personKey());
                if (t.enrolled()) enrolled.add(t.personKey());
            }
        }
    }

    private static class CampaignAgg extends Agg {
        final Touch first;
        Timestamp firstSeen;
        Timestamp lastSeen;

        CampaignAgg(Touch first) {
            this.first = first;
        }

        @Override
        void add(Touch t) {
            super.add(t);
            if (t.createdAt() != null) {
                if (firstSeen == null || t.createdAt().before(firstSeen)) firstSeen = t.createdAt();
                if (lastSeen == null || t.createdAt().after(lastSeen)) lastSeen = t.createdAt();
            }
        }
    }
}
