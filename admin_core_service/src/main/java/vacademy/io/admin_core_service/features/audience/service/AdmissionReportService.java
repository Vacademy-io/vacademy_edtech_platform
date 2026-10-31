package vacademy.io.admin_core_service.features.audience.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.audience.dto.reports.AdmissionReportDTO;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.common.auth.dto.UserDTO;

import java.sql.Types;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Admissions report: students enrolled in the range, the fee they booked, what is paid and what is
 * still due, split by month, source, course, course tag, counsellor and an institute-chosen custom
 * field. Built for institutes that track admissions the way a front office does (per month, per
 * course group, per branch) rather than by collected cash, which the Revenue tab covers.
 *
 * <p>One SQL row per admission (a student x the month they enrolled); every breakdown is grouped
 * from those rows here, so all tables add up to the same totals.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AdmissionReportService {

    private static final int DEFAULT_RANGE_DAYS = 30;
    private static final String DEFAULT_CURRENCY = "INR";
    private static final String UNKNOWN = "UNKNOWN";

    private final NamedParameterJdbcTemplate jdbc;
    private final ReportScopeResolver scopeResolver;
    private final LeadReportSettingService settingService;
    private final AuthService authService;

    /** The student's enrolments in the window, with the course and its tags. */
    private static final String ENR_CTE = """
            enr AS (
                SELECT s.id, s.user_id, s.user_plan_id, s.created_at, ps.package_id, p.package_name,
                       p.comma_separated_tags,
                       to_char(COALESCE(s.enrolled_date, (s.created_at AT TIME ZONE 'UTC' AT TIME ZONE :tz)::date),
                               'YYYY-MM') AS month
                FROM student_session_institute_group_mapping s
                JOIN package_session ps ON ps.id = s.package_session_id
                JOIN package p ON p.id = ps.package_id
                WHERE s.institute_id = :instituteId
                  AND s.status IN ('ACTIVE', 'COMPLETED', 'INVITED')
                  AND COALESCE(s.enrolled_date, (s.created_at AT TIME ZONE 'UTC' AT TIME ZONE :tz)::date) >= :fromDay
                  AND COALESCE(s.enrolled_date, (s.created_at AT TIME ZONE 'UTC' AT TIME ZONE :tz)::date) <  :toDay
            )
            """;

    /**
     * One row per admission. A course's group tag is the first of its tags in the institute's
     * group order (else its first tag); the main course of a student who joined several in a month
     * is the one with the best-ranked tag, then the earliest enrolment. A fee plan belongs to the
     * first month it was enrolled in, so a plan spanning two months is not counted twice.
     * The lead side (source, counsellor) mirrors the Revenue report: the profile's best-scoring
     * enquiry, its campaign and its enquiry counsellor.
     */
    private static final String ADMISSIONS_SQL = "WITH " + ENR_CTE + """
            , enr_tag AS (
                SELECT e.*, t.tag, t.tag_rank
                FROM enr e
                LEFT JOIN LATERAL (
                    SELECT TRIM(x.tag) AS tag,
                           COALESCE(array_position(STRING_TO_ARRAY(:tagOrderCsv, ','), TRIM(x.tag)), 1000) * 1000
                               + x.ord AS tag_rank
                    FROM unnest(STRING_TO_ARRAY(COALESCE(e.comma_separated_tags, ''), ',')) WITH ORDINALITY AS x(tag, ord)
                    WHERE TRIM(x.tag) <> ''
                    ORDER BY 2
                    LIMIT 1
                ) t ON true
            ),
            main AS (
                SELECT DISTINCT ON (user_id, month) user_id, month, package_id, package_name, tag
                FROM enr_tag
                ORDER BY user_id, month, COALESCE(tag_rank, 2000000), created_at, package_name
            ),
            courses AS (
                SELECT user_id, month, COUNT(DISTINCT package_id) AS n_courses FROM enr GROUP BY user_id, month
            ),
            plans AS (
                SELECT user_plan_id, MIN(user_id) AS user_id, MIN(month) AS month
                FROM enr WHERE user_plan_id IS NOT NULL GROUP BY user_plan_id
            ),
            money AS (
                SELECT pl.user_id, pl.month,
                       SUM(f.amount_expected)             AS fee,
                       SUM(COALESCE(f.amount_paid, 0))    AS paid
                FROM plans pl
                JOIN student_fee_payment f ON f.user_plan_id = pl.user_plan_id
                WHERE f.amount_expected IS NOT NULL
                  AND COALESCE(f.status, '') NOT IN ('CANCELLED', 'VOIDED', 'WAIVED')
                GROUP BY pl.user_id, pl.month
            ),
            ld AS (
                SELECT ulp.user_id,
                       """ + ReportSourceSql.effective("COALESCE(ulp.best_source_type, ar.source_type)", "sa.campaign_type") + """
                           AS source_type,
                       """ + ReportSourceSql.fromCampaignType("COALESCE(ulp.best_source_type, ar.source_type)", "sa.campaign_type") + """
                           AS from_campaign,
                       COALESCE(lu.user_id, ulp.assigned_counselor_id) AS counsellor_id
                FROM user_lead_profile ulp
                LEFT JOIN audience_response ar ON ar.id = ulp.best_score_response_id
                LEFT JOIN audience sa ON sa.id = ar.audience_id
                LEFT JOIN LATERAL (
                    SELECT lu2.user_id FROM linked_users lu2
                    WHERE lu2.source = 'ENQUIRY' AND lu2.source_id = ar.enquiry_id
                    ORDER BY lu2.created_at DESC LIMIT 1
                ) lu ON true
                WHERE ulp.institute_id = :instituteId
                  AND ulp.user_id IN (SELECT user_id FROM main)
            )
            SELECT m.user_id, m.month, m.package_id, m.package_name, m.tag, c.n_courses,
                   COALESCE(mo.fee, 0)  AS fee,
                   COALESCE(mo.paid, 0) AS paid,
                   ld.source_type, ld.from_campaign, ld.counsellor_id,
                   """ + "%FIELD_VALUE%" + """
                       AS field_value
            FROM main m
            JOIN courses c ON c.user_id = m.user_id AND c.month = m.month
            LEFT JOIN money mo ON mo.user_id = m.user_id AND mo.month = m.month
            LEFT JOIN ld ON ld.user_id = m.user_id
            WHERE (:scopeCsv IS NULL OR ld.counsellor_id = ANY(STRING_TO_ARRAY(:scopeCsv, ',')))
            """;

    /**
     * The admission's value of the chosen field: pinned on one of the month's enrolments first,
     * else the latest on the student's profile or any of their enquiries.
     */
    private static final String FIELD_VALUE_SQL = """
            (SELECT v.value FROM custom_field_values v
                WHERE v.custom_field_id = :fieldId AND v.value <> ''
                  AND ((v.source_type = 'STUDENT_SESSION_INSTITUTE_GROUP_MAPPING'
                        AND v.source_id IN (SELECT e2.id FROM enr e2 WHERE e2.user_id = m.user_id AND e2.month = m.month))
                    OR (v.source_type = 'USER' AND v.source_id = m.user_id)
                    OR (v.source_type = 'AUDIENCE_RESPONSE'
                        AND v.source_id IN (SELECT r.id FROM audience_response r WHERE r.user_id = m.user_id)))
                ORDER BY CASE WHEN v.source_type = 'STUDENT_SESSION_INSTITUTE_GROUP_MAPPING' THEN 0 ELSE 1 END,
                         COALESCE(v.updated_at, v.created_at) DESC
                LIMIT 1)""";

    private static final String CURRENCY_SQL = """
            SELECT pl.currency
            FROM payment_log pl
            JOIN user_lead_profile ulp
                ON ulp.user_id = pl.user_id AND ulp.institute_id = :instituteId
            WHERE pl.payment_status = 'PAID' AND pl.currency IS NOT NULL
              AND ulp.conversion_status = 'CONVERTED'
            GROUP BY pl.currency
            ORDER BY COUNT(*) DESC
            LIMIT 1
            """;

    private static final String COURSE_TAGS_SQL = """
            SELECT DISTINCT TRIM(t.tag) AS tag
            FROM student_session_institute_group_mapping s
            JOIN package_session ps ON ps.id = s.package_session_id
            JOIN package p ON p.id = ps.package_id
            CROSS JOIN LATERAL unnest(STRING_TO_ARRAY(COALESCE(p.comma_separated_tags, ''), ',')) AS t(tag)
            WHERE s.institute_id = :instituteId AND TRIM(t.tag) <> ''
            ORDER BY 1
            """;

    private static final String FIELDS_SQL = """
            SELECT DISTINCT cf.id, cf.field_name, cf.field_type
            FROM institute_custom_fields icf
            JOIN custom_fields cf ON cf.id = icf.custom_field_id
            WHERE icf.institute_id = :instituteId
              AND COALESCE(icf.status, 'ACTIVE') <> 'DELETED'
              AND COALESCE(cf.status, 'ACTIVE') <> 'DELETED'
              AND cf.field_name IS NOT NULL
            ORDER BY cf.field_name
            """;

    private static final String FIELD_NAME_SQL = "SELECT field_name FROM custom_fields WHERE id = :fieldId";

    record AdmissionRow(String userId, String month, String packageId, String packageName,
                                String tag, int courses, double fee, double paid,
                                String source, boolean fromCampaign, String counsellorId, String fieldValue) {
    }

    @Transactional(readOnly = true)
    public AdmissionReportDTO getAdmissions(String instituteId, String fromDate, String toDate,
                                            String teamId, String counsellorUserId, String callerUserId) {
        LeadReportSettingService.ReportSettings settings = settingService.get(instituteId);
        ZoneId zone = safeZone(settings.timezone());
        LocalDate today = LocalDate.now(zone);
        LocalDate to = parseOr(toDate, today);
        LocalDate from = parseOr(fromDate, to.minusDays(DEFAULT_RANGE_DAYS - 1L));
        String scopeCsv = scopeResolver.resolveScopeUsersCsv(
                instituteId, callerUserId, trimToNull(teamId), trimToNull(counsellorUserId));
        List<String> tagOrder = settings.courseGroupOrder() == null ? List.of() : settings.courseGroupOrder();
        String fieldId = settings.admissionFieldId();

        MapSqlParameterSource p = new MapSqlParameterSource()
                .addValue("instituteId", instituteId)
                .addValue("tz", zone.getId())
                .addValue("fromDay", java.sql.Date.valueOf(from), Types.DATE)
                .addValue("toDay", java.sql.Date.valueOf(to.plusDays(1)), Types.DATE)
                .addValue("scopeCsv", scopeCsv, Types.VARCHAR)
                .addValue("tagOrderCsv", String.join(",", tagOrder), Types.VARCHAR)
                .addValue("fieldId", fieldId, Types.VARCHAR);
        String sql = ADMISSIONS_SQL.replace("%FIELD_VALUE%", fieldId != null ? FIELD_VALUE_SQL : "CAST(NULL AS text)");

        List<AdmissionRow> rows = jdbc.query(sql, p, (rs, i) -> new AdmissionRow(
                rs.getString("user_id"),
                rs.getString("month"),
                rs.getString("package_id"),
                rs.getString("package_name"),
                emptyToBlank(rs.getString("tag")),
                rs.getInt("n_courses"),
                rs.getDouble("fee"),
                rs.getDouble("paid"),
                Optional.ofNullable(rs.getString("source_type")).orElse(UNKNOWN),
                rs.getBoolean("from_campaign"),
                rs.getString("counsellor_id"),
                trimToNull(rs.getString("field_value"))));

        List<String> courseTags = orderedTags(rows, tagOrder);

        Map<String, String> names = resolveNames(rows.stream().map(AdmissionRow::counsellorId).toList());
        Map<String, String> courseTagById = new LinkedHashMap<>();
        rows.forEach(r -> courseTagById.putIfAbsent(r.packageId(), r.tag()));

        List<AdmissionReportDTO.Row> byMonth = group(rows, AdmissionRow::month, k -> null, courseTags);
        byMonth.sort(Comparator.comparing(AdmissionReportDTO.Row::getKey));

        List<AdmissionReportDTO.Row> bySource = group(rows, AdmissionRow::source, k -> null, courseTags);
        Set<String> campaignSources = rows.stream().filter(AdmissionRow::fromCampaign)
                .map(AdmissionRow::source).collect(Collectors.toSet());
        bySource.forEach(r -> r.setCampaignType(campaignSources.contains(r.getKey()) ? r.getKey() : null));

        List<AdmissionReportDTO.Row> byCourseTag = group(rows, AdmissionRow::tag, k -> null, courseTags);
        byCourseTag.sort(Comparator.comparingInt(r -> courseTags.indexOf(r.getKey())));

        Map<String, String> courseNames = new LinkedHashMap<>();
        rows.forEach(r -> courseNames.putIfAbsent(r.packageId(), r.packageName()));
        List<AdmissionReportDTO.Row> byCourse = group(rows, AdmissionRow::packageId, courseNames::get, courseTags);
        byCourse.forEach(r -> r.setCourseTag(courseTagById.get(r.getKey())));

        List<AdmissionReportDTO.Row> byCounsellor = group(rows, r -> r.counsellorId() == null ? "" : r.counsellorId(),
                k -> k.isEmpty() ? null : names.getOrDefault(k, k), courseTags);

        List<AdmissionReportDTO.Row> byField = fieldId == null ? List.of()
                : group(rows, r -> r.fieldValue() == null ? "" : r.fieldValue(), k -> null, courseTags);

        return AdmissionReportDTO.builder()
                .currency(resolveCurrency(instituteId))
                .totals(total(rows, courseTags))
                .courseTags(courseTags)
                .fieldName(fieldId == null ? null : fieldName(fieldId))
                .multiCourseAdmissions(rows.stream().filter(r -> r.courses() > 1).count())
                .byMonth(byMonth)
                .bySource(bySource)
                .byCourseTag(byCourseTag)
                .byCourse(byCourse)
                .byCounsellor(byCounsellor)
                .byField(byField)
                .build();
    }

    /** The course tags and custom fields an admin can pick in the report settings. */
    @Transactional(readOnly = true)
    public AdmissionReportDTO.Options getOptions(String instituteId) {
        MapSqlParameterSource p = new MapSqlParameterSource("instituteId", instituteId);
        List<String> tags = jdbc.queryForList(COURSE_TAGS_SQL, p, String.class);
        List<AdmissionReportDTO.Field> fields = jdbc.query(FIELDS_SQL, p, (rs, i) ->
                AdmissionReportDTO.Field.builder()
                        .id(rs.getString("id"))
                        .name(rs.getString("field_name"))
                        .type(rs.getString("field_type"))
                        .build());
        return AdmissionReportDTO.Options.builder().courseTags(tags).fields(fields).build();
    }

    // ─────────────────────────────────────────────────────────────────────
    // Grouping
    // ─────────────────────────────────────────────────────────────────────

    /** Rows grouped by {@code key}, biggest first (admissions, then fees). */
    static List<AdmissionReportDTO.Row> group(List<AdmissionRow> rows, Function<AdmissionRow, String> key,
                                              Function<String, String> label, List<String> courseTags) {
        Map<String, List<AdmissionRow>> byKey = new LinkedHashMap<>();
        rows.forEach(r -> byKey.computeIfAbsent(key.apply(r), k -> new ArrayList<>()).add(r));
        List<AdmissionReportDTO.Row> out = new ArrayList<>();
        byKey.forEach((k, list) -> {
            AdmissionReportDTO.Row row = total(list, courseTags);
            row.setKey(k);
            row.setLabel(label.apply(k));
            out.add(row);
        });
        out.sort(Comparator.comparingLong(AdmissionReportDTO.Row::getAdmissions).reversed()
                .thenComparing(Comparator.comparingDouble(AdmissionReportDTO.Row::getFees).reversed()));
        return out;
    }

    static AdmissionReportDTO.Row total(List<AdmissionRow> rows, List<String> courseTags) {
        double fees = rows.stream().mapToDouble(AdmissionRow::fee).sum();
        double paid = rows.stream().mapToDouble(AdmissionRow::paid).sum();
        Map<String, Long> tagCounts = new LinkedHashMap<>();
        courseTags.forEach(t -> tagCounts.put(t, 0L));
        rows.forEach(r -> tagCounts.merge(r.tag(), 1L, Long::sum));
        return AdmissionReportDTO.Row.builder()
                .admissions(rows.size())
                .fees(round2(fees))
                .paid(round2(paid))
                .due(round2(fees - paid))
                .tagCounts(tagCounts)
                .build();
    }

    /** The institute's group order first (only tags that occur), then the rest by admissions. */
    static List<String> orderedTags(List<AdmissionRow> rows, List<String> tagOrder) {
        Map<String, Long> counts = rows.stream()
                .collect(Collectors.groupingBy(AdmissionRow::tag, LinkedHashMap::new, Collectors.counting()));
        Set<String> out = new LinkedHashSet<>();
        tagOrder.stream().filter(counts::containsKey).forEach(out::add);
        counts.entrySet().stream()
                .sorted(Map.Entry.<String, Long>comparingByValue().reversed()
                        .thenComparing(e -> e.getKey().isEmpty() ? "￿" : e.getKey()))
                .forEach(e -> out.add(e.getKey()));
        return new ArrayList<>(out);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────

    private String fieldName(String fieldId) {
        try {
            List<String> found = jdbc.queryForList(FIELD_NAME_SQL,
                    new MapSqlParameterSource("fieldId", fieldId), String.class);
            return found.isEmpty() ? null : found.get(0);
        } catch (Exception e) {
            return null;
        }
    }

    private String resolveCurrency(String instituteId) {
        try {
            List<String> found = jdbc.queryForList(CURRENCY_SQL,
                    new MapSqlParameterSource("instituteId", instituteId), String.class);
            return found.isEmpty() || found.get(0) == null ? DEFAULT_CURRENCY : found.get(0);
        } catch (Exception e) {
            return DEFAULT_CURRENCY;
        }
    }

    private Map<String, String> resolveNames(Collection<String> userIds) {
        List<String> ids = userIds.stream()
                .filter(s -> s != null && !s.isBlank()).distinct().collect(Collectors.toList());
        if (ids.isEmpty()) return Collections.emptyMap();
        try {
            List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(ids);
            if (users == null) return Collections.emptyMap();
            return users.stream()
                    .filter(u -> u != null && u.getId() != null)
                    .collect(Collectors.toMap(UserDTO::getId,
                            u -> Optional.ofNullable(u.getFullName()).orElse(u.getId()), (a, b) -> a));
        } catch (Exception e) {
            log.warn("[AdmissionReport] name hydration failed: {}", e.getMessage());
            return Collections.emptyMap();
        }
    }

    private ZoneId safeZone(String tz) {
        try {
            return ZoneId.of(tz);
        } catch (Exception e) {
            return ZoneId.of(LeadReportSettingService.DEFAULT_TIMEZONE);
        }
    }

    private static LocalDate parseOr(String iso, LocalDate fallback) {
        if (iso == null || iso.isBlank()) return fallback;
        try {
            return LocalDate.parse(iso.trim());
        } catch (Exception e) {
            return fallback;
        }
    }

    private static String trimToNull(String s) {
        return (s == null || s.isBlank()) ? null : s.trim();
    }

    private static String emptyToBlank(String s) {
        return s == null ? "" : s.trim();
    }

    private static double round2(double v) {
        return Math.round(v * 100.0) / 100.0;
    }
}
