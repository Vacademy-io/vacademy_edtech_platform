package vacademy.io.admin_core_service.features.audience.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.audience.dto.reports.ConversionReportDTO;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.course_settings.service.LeadConversionPolicyService;
import vacademy.io.common.auth.dto.UserDTO;

import java.sql.Timestamp;
import java.sql.Types;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Conversions report for the Reports Center: leads enrolled into a course in the window, per
 * counsellor, with the lead-level rows behind the numbers.
 *
 * <p>A conversion is an enrolment row, not {@code user_lead_profile.conversion_status}: the profile
 * flag is overwritten by any pipeline status picked later, while the enrolment row is what
 * actually happened. Only courses whose enrolment counts as a conversion
 * ({@link LeadConversionPolicyService}) are counted — the policy is evaluated per course in Java,
 * then bound into the SQL as a package-id CSV.
 *
 * <p>Same conventions as {@link RevenueReportService}: read-only JdbcTemplate SQL, never JOINs
 * users (names via {@link AuthService} batches), RBAC scope CSV from {@link ReportScopeResolver}
 * (null = no filter, "" = matches nothing), counsellor resolved as the enquiry counsellor on the
 * lead's representative response falling back to assigned_counselor_id, windows are institute-TZ
 * dates converted to UTC wall-clock bounds.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ConversionReportService {

    private final NamedParameterJdbcTemplate jdbc;
    private final ReportScopeResolver scopeResolver;
    private final LeadReportSettingService settingService;
    private final AuthService authService;
    private final LeadConversionPolicyService leadConversionPolicyService;

    private static final int DEFAULT_RANGE_DAYS = 30;
    /** Lead rows returned to the tab (and its CSV); the totals are never capped. */
    private static final int MAX_LEAD_ROWS = 5000;
    private static final int AUTH_BATCH_SIZE = 500;
    private static final DateTimeFormatter LOCAL_DATE_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm");

    /** Enrolment states that mean the enrolment really happened (excludes INVITED / PENDING_FOR_APPROVAL / DELETED). */
    private static final String ENROLLED_STATUSES = " ('ACTIVE', 'INACTIVE', 'TERMINATED', 'EXPIRED')\n";

    /** Courses with an in-window enrolment — the candidates the conversion policy is evaluated on. */
    private static final String CANDIDATE_PACKAGES_SQL = """
            SELECT DISTINCT ps.package_id
            FROM student_session_institute_group_mapping m
            JOIN package_session ps ON ps.id = m.package_session_id
            WHERE m.institute_id = :instituteId
              AND m.created_at >= :fromTs AND m.created_at < :toTs
              AND m.status IN """ + ENROLLED_STATUSES;

    /**
     * Counted enrolments. The user must already have been a lead when they enrolled — their lead
     * profile existed, or (profiles can be built late by the batch rebuild) they had a campaign
     * response by then — so an existing student who fills a form later is not a conversion.
     */
    private static final String CONV_CTE = """
            conv AS (
                SELECT m.id         AS enrolment_id,
                       m.user_id,
                       m.created_at AS enrolled_at,
                       m.status     AS enrolment_status,
                       ps.package_id,
                       ar.audience_id,
                       COALESCE(ulp.best_source_type, ar.source_type, 'UNKNOWN') AS source_type,
                       COALESCE(lu.user_id, ulp.assigned_counselor_id)           AS counsellor_id
                FROM student_session_institute_group_mapping m
                JOIN package_session ps ON ps.id = m.package_session_id
                JOIN user_lead_profile ulp
                    ON ulp.user_id = m.user_id AND ulp.institute_id = m.institute_id
                LEFT JOIN audience_response ar ON ar.id = ulp.best_score_response_id
                LEFT JOIN LATERAL (
                    SELECT lu2.user_id FROM linked_users lu2
                    WHERE lu2.source = 'ENQUIRY' AND lu2.source_id = ar.enquiry_id
                    ORDER BY lu2.created_at DESC LIMIT 1
                ) lu ON true
                WHERE m.institute_id = :instituteId
                  AND m.created_at >= :fromTs AND m.created_at < :toTs
                  AND m.status IN """ + ENROLLED_STATUSES + """
                  AND ps.package_id = ANY(STRING_TO_ARRAY(:packageCsv, ','))
                  AND (COALESCE(ulp.created_at, ulp.last_calculated_at) <= m.created_at
                       OR EXISTS (SELECT 1 FROM audience_response r
                                  JOIN audience a ON a.id = r.audience_id
                                  WHERE r.user_id = m.user_id
                                    AND a.institute_id = m.institute_id
                                    AND r.created_at <= m.created_at))
                  AND (:scopeCsv IS NULL OR COALESCE(lu.user_id, ulp.assigned_counselor_id) = ANY(STRING_TO_ARRAY(:scopeCsv, ',')))
            )
            """;

    /**
     * Per counsellor. counsellor_id is derived per user (from the lead profile), so a lead lands in
     * exactly one group and the totals are the column sums — no separate totals scan.
     */
    private static final String BY_COUNSELLOR_SQL = "WITH " + CONV_CTE + """
            SELECT counsellor_id,
                   COUNT(DISTINCT user_id) AS converted_leads,
                   COUNT(*)                AS enrolments
            FROM conv
            GROUP BY counsellor_id
            ORDER BY converted_leads DESC, enrolments DESC
            """;

    private static final String LEADS_SQL = "WITH " + CONV_CTE + """
            SELECT c.enrolment_id, c.user_id, c.enrolled_at, c.enrolment_status, c.package_id,
                   c.source_type, c.counsellor_id,
                   p.package_name,
                   a.campaign_name
            FROM conv c
            LEFT JOIN package p ON p.id = c.package_id
            LEFT JOIN audience a ON a.id = c.audience_id
            ORDER BY c.enrolled_at DESC
            LIMIT :rowLimit
            """;

    @Transactional(readOnly = true)
    public ConversionReportDTO getConversions(String instituteId, String fromDate, String toDate,
                                              String teamId, String counsellorUserId, String callerUserId) {
        LeadReportSettingService.ReportSettings settings = settingService.get(instituteId);
        ZoneId zone = safeZone(settings.timezone());
        Window w = resolveWindow(fromDate, toDate, zone);
        String scopeCsv = scopeResolver.resolveScopeUsersCsv(
                instituteId, callerUserId, trimToNull(teamId), trimToNull(counsellorUserId));

        List<String> convertingPackages = convertingPackageIds(instituteId, w);
        if (convertingPackages.isEmpty()) {
            return emptyReport();
        }
        MapSqlParameterSource p = new MapSqlParameterSource()
                .addValue("instituteId", instituteId)
                .addValue("fromTs", w.fromUtc(), Types.TIMESTAMP)
                .addValue("toTs", w.toUtc(), Types.TIMESTAMP)
                .addValue("scopeCsv", scopeCsv, Types.VARCHAR)
                .addValue("packageCsv", String.join(",", convertingPackages))
                // One extra row tells us whether the list was cut off.
                .addValue("rowLimit", MAX_LEAD_ROWS + 1);

        List<ConversionReportDTO.CounsellorRow> byCounsellor = jdbc.query(BY_COUNSELLOR_SQL, p, (rs, i) ->
                ConversionReportDTO.CounsellorRow.builder()
                        .userId(rs.getString("counsellor_id"))
                        .convertedLeads(rs.getLong("converted_leads"))
                        .enrolments(rs.getLong("enrolments"))
                        .build());
        ConversionReportDTO.Totals totals = ConversionReportDTO.Totals.builder()
                .convertedLeads(byCounsellor.stream().mapToLong(ConversionReportDTO.CounsellorRow::getConvertedLeads).sum())
                .enrolments(byCounsellor.stream().mapToLong(ConversionReportDTO.CounsellorRow::getEnrolments).sum())
                .build();

        List<ConversionReportDTO.LeadRow> leads = jdbc.query(LEADS_SQL, p, (rs, i) ->
                ConversionReportDTO.LeadRow.builder()
                        .enrolmentId(rs.getString("enrolment_id"))
                        .userId(rs.getString("user_id"))
                        .packageId(rs.getString("package_id"))
                        .courseName(rs.getString("package_name"))
                        .enrolledAt(toLocal(rs.getTimestamp("enrolled_at"), zone))
                        .enrolmentStatus(rs.getString("enrolment_status"))
                        .counsellorId(rs.getString("counsellor_id"))
                        .campaignName(rs.getString("campaign_name"))
                        .sourceType(rs.getString("source_type"))
                        .build());
        boolean truncated = leads.size() > MAX_LEAD_ROWS;
        if (truncated) {
            leads = new ArrayList<>(leads.subList(0, MAX_LEAD_ROWS));
        }

        List<String> userIds = new ArrayList<>();
        byCounsellor.forEach(r -> userIds.add(r.getUserId()));
        leads.forEach(r -> {
            userIds.add(r.getUserId());
            userIds.add(r.getCounsellorId());
        });
        Map<String, UserDTO> users = resolveUsers(userIds);

        byCounsellor.forEach(r -> r.setName(nameOf(users, r.getUserId())));
        leads.forEach(r -> {
            UserDTO lead = users.get(r.getUserId());
            if (lead != null) {
                r.setLeadName(lead.getFullName());
                r.setPhone(lead.getMobileNumber());
                r.setEmail(lead.getEmail());
            }
            r.setCounsellorName(nameOf(users, r.getCounsellorId()));
        });

        return ConversionReportDTO.builder()
                .totals(totals)
                .byCounsellor(byCounsellor)
                .leads(leads)
                .leadsTruncated(truncated)
                .build();
    }

    // ─────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────

    /** In-window enrolled courses whose enrolment counts as a conversion (per-course policy). */
    private List<String> convertingPackageIds(String instituteId, Window w) {
        List<String> candidates = jdbc.queryForList(CANDIDATE_PACKAGES_SQL,
                new MapSqlParameterSource()
                        .addValue("instituteId", instituteId)
                        .addValue("fromTs", w.fromUtc(), Types.TIMESTAMP)
                        .addValue("toTs", w.toUtc(), Types.TIMESTAMP),
                String.class);
        return candidates.stream()
                .filter(id -> id != null && !id.isBlank())
                .filter(id -> leadConversionPolicyService.countsAsConversion(instituteId, id))
                .collect(Collectors.toList());
    }

    private static ConversionReportDTO emptyReport() {
        return ConversionReportDTO.builder()
                .totals(ConversionReportDTO.Totals.builder().convertedLeads(0).enrolments(0).build())
                .byCounsellor(List.of())
                .leads(List.of())
                .leadsTruncated(false)
                .build();
    }

    private static String nameOf(Map<String, UserDTO> users, String userId) {
        if (userId == null) return null;
        UserDTO u = users.get(userId);
        return u != null && u.getFullName() != null ? u.getFullName() : userId;
    }

    private Map<String, UserDTO> resolveUsers(Collection<String> userIds) {
        List<String> ids = userIds.stream()
                .filter(s -> s != null && !s.isBlank()).distinct().collect(Collectors.toList());
        if (ids.isEmpty()) return Collections.emptyMap();
        Map<String, UserDTO> out = new HashMap<>();
        for (int from = 0; from < ids.size(); from += AUTH_BATCH_SIZE) {
            List<String> batch = ids.subList(from, Math.min(from + AUTH_BATCH_SIZE, ids.size()));
            try {
                List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(batch);
                if (users == null) continue;
                users.stream()
                        .filter(u -> u != null && u.getId() != null)
                        .forEach(u -> out.putIfAbsent(u.getId(), u));
            } catch (Exception e) {
                log.warn("[ConversionReport] user hydration failed for a batch of {}: {}", batch.size(), e.getMessage());
            }
        }
        return out;
    }

    /** UTC wall-clock column value → institute-local yyyy-MM-dd'T'HH:mm. */
    private static String toLocal(Timestamp utc, ZoneId zone) {
        if (utc == null) return null;
        return utc.toLocalDateTime().atZone(ZoneOffset.UTC).withZoneSameInstant(zone)
                .toLocalDateTime().format(LOCAL_DATE_TIME);
    }

    private Window resolveWindow(String fromDate, String toDate, ZoneId zone) {
        LocalDate today = LocalDate.now(zone);
        LocalDate to = parseOr(toDate, today);
        LocalDate from = parseOr(fromDate, to.minusDays(DEFAULT_RANGE_DAYS - 1L));
        return new Window(toUtc(from, zone), toUtc(to.plusDays(1), zone));
    }

    private static Timestamp toUtc(LocalDate localDate, ZoneId zone) {
        return Timestamp.valueOf(localDate.atStartOfDay(zone)
                .withZoneSameInstant(ZoneOffset.UTC).toLocalDateTime());
    }

    private ZoneId safeZone(String tz) {
        try {
            return ZoneId.of(tz);
        } catch (Exception e) {
            log.warn("[ConversionReport] invalid institute timezone '{}', falling back to Asia/Kolkata", tz);
            return ZoneId.of("Asia/Kolkata");
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

    private record Window(Timestamp fromUtc, Timestamp toUtc) {
    }
}
