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
import java.util.concurrent.ConcurrentHashMap;
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
    private static final String DEFAULT_CURRENCY = "INR";
    private static final long CURRENCY_TTL_MS = 30L * 60 * 1000;
    /** institute id -> its payment currency; bounded by the number of institutes. */
    private final Map<String, CachedCurrency> currencyCache = new ConcurrentHashMap<>();
    /** Lead rows returned to the tab (and its CSV); the totals are never capped. */
    private static final int MAX_LEAD_ROWS = 5000;
    private static final int AUTH_BATCH_SIZE = 500;
    private static final DateTimeFormatter LOCAL_DATE_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm");

    /**
     * Enrolment states counted as an admission, the same set the Admissions tab counts. A hard
     * removal leaves the row INVITED with source TERMINATED; that is a removed student, not an
     * admission, so it is excluded.
     */
    private static final String ENROLLED_STATUSES = " ('ACTIVE', 'COMPLETED', 'INVITED')\n"
            + "              AND NOT (m.status = 'INVITED' AND COALESCE(m.source, '') = 'TERMINATED')\n";

    /** The admission day: enrolled_date, else the mapping's created_at in the institute timezone. */
    private static final String ENROLLED_DAY = "COALESCE(m.enrolled_date, (m.created_at AT TIME ZONE 'UTC' AT TIME ZONE :tz)::date)";

    /** Courses with an in-window enrolment — the candidates the conversion policy is evaluated on. */
    private static final String CANDIDATE_PACKAGES_SQL = """
            SELECT DISTINCT ps.package_id
            FROM student_session_institute_group_mapping m
            JOIN package_session ps ON ps.id = m.package_session_id
            WHERE m.institute_id = :instituteId
              AND """ + " " + ENROLLED_DAY + " >= :fromDay AND " + ENROLLED_DAY + """
               < :toDay
              AND m.status IN """ + ENROLLED_STATUSES;

    /**
     * Counted enrolments: every in-window admission (same day rule and statuses as the Admissions
     * tab) of a student who has a lead profile. Source = the student's first enquiry.
     */
    private static final String CONV_CTE = """
            conv AS (
                SELECT m.id         AS enrolment_id,
                       m.user_id,
                       m.created_at AS enrolled_at,
                       m.enrolled_date AS enrolled_day,
                       m.status     AS enrolment_status,
                       m.user_plan_id,
                       ps.package_id,
                       fe.audience_id,
                       """ + ReportSourceSql.firstEnquirySource("fe", "ulp.best_source_type") + """
                           AS source_type,
                       COALESCE(lu.user_id, ulp.assigned_counselor_id)           AS counsellor_id
                FROM student_session_institute_group_mapping m
                JOIN package_session ps ON ps.id = m.package_session_id
                JOIN user_lead_profile ulp
                    ON ulp.user_id = m.user_id AND ulp.institute_id = m.institute_id
                LEFT JOIN audience_response ar ON ar.id = ulp.best_score_response_id
                """ + ReportSourceSql.firstEnquiryJoin("fe", "m.user_id", "m.institute_id") + """
                LEFT JOIN LATERAL (
                    SELECT lu2.user_id FROM linked_users lu2
                    WHERE lu2.source = 'ENQUIRY' AND lu2.source_id = ar.enquiry_id
                    ORDER BY lu2.created_at DESC LIMIT 1
                ) lu ON true
                WHERE m.institute_id = :instituteId
                  AND """ + " " + ENROLLED_DAY + " >= :fromDay AND " + ENROLLED_DAY + """
                   < :toDay
                  AND m.status IN """ + ENROLLED_STATUSES + """
                  AND ps.package_id = ANY(STRING_TO_ARRAY(:packageCsv, ','))
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

    /**
     * Lead rows with the money side of each admission: the fee plan's booked fee, what is paid,
     * how many installments are paid, and the next unpaid installment. A plan bought for several
     * courses is shown once, on its earliest enrolment (the plan owner), so a column total never
     * counts one plan twice; the other rows of that plan carry plan_shared = true.
     *
     * <p>The owner is picked only among the rows the tab actually gets (rn <= :shownLimit). When
     * the list is cut at the row cap, a plan whose earliest enrolment fell outside it still shows
     * its amounts on its earliest row that is listed, instead of on a row nobody sees.
     *
     * <p>Ownership is a window function, not a join back onto a CTE: the planner estimates a CTE
     * at one row and nested-loops it, which cost seconds on institutes with thousands of
     * enrolments. The fee table is read once, through its user_plan_id index, for owner plans only.
     * plan_shared is set only when the plan has fee rows, so a plan with no fee never reads as
     * "in another course's fee plan".
     */
    private static final String LEADS_SQL = "WITH " + CONV_CTE + """
            , ranked AS (
                SELECT c.*,
                       ROW_NUMBER() OVER (
                           ORDER BY COALESCE(c.enrolled_day, CAST(c.enrolled_at AS date)) DESC,
                                    c.enrolled_at DESC, c.enrolment_id
                       ) AS rn
                FROM conv c
            ),
            page AS (
                SELECT r.*,
                       (r.user_plan_id IS NOT NULL AND r.rn <= :shownLimit
                        AND ROW_NUMBER() OVER (
                                PARTITION BY r.user_plan_id, (r.rn <= :shownLimit)
                                ORDER BY COALESCE(r.enrolled_day, CAST(r.enrolled_at AS date)),
                                         r.enrolled_at, r.enrolment_id
                            ) = 1) AS plan_owner
                FROM ranked r
                WHERE r.rn <= :rowLimit
            ),
            money AS (
                SELECT f.user_plan_id,
                       SUM(f.amount_expected)                                                   AS fee,
                       SUM(COALESCE(f.amount_paid, 0))                                          AS paid,
                       COUNT(*)                                                                 AS installments,
                       COUNT(*) FILTER (WHERE COALESCE(f.amount_paid, 0) >= f.amount_expected)  AS installments_paid,
                       (ARRAY_AGG(f.amount_expected - COALESCE(f.amount_paid, 0)
                                  ORDER BY f.due_date NULLS LAST, f.installment_number NULLS LAST, f.created_at)
                            FILTER (WHERE COALESCE(f.amount_paid, 0) < f.amount_expected))[1]   AS next_amount,
                       (ARRAY_AGG(f.due_date
                                  ORDER BY f.due_date NULLS LAST, f.installment_number NULLS LAST, f.created_at)
                            FILTER (WHERE COALESCE(f.amount_paid, 0) < f.amount_expected))[1]   AS next_due_date
                FROM student_fee_payment f
                WHERE f.user_plan_id IN (SELECT user_plan_id FROM page WHERE plan_owner)
                  AND f.amount_expected IS NOT NULL
                  AND COALESCE(f.status, '') NOT IN ('CANCELLED', 'VOIDED', 'WAIVED')
                GROUP BY f.user_plan_id
            )
            SELECT c.enrolment_id, c.user_id, c.enrolled_at, c.enrolled_day, c.enrolment_status, c.package_id,
                   c.source_type, c.counsellor_id,
                   p.package_name,
                   a.campaign_name,
                   (c.user_plan_id IS NOT NULL AND NOT c.plan_owner
                    AND c.user_plan_id IN (SELECT user_plan_id FROM money)) AS plan_shared,
                   mo.fee, mo.paid, mo.installments, mo.installments_paid,
                   mo.next_amount, mo.next_due_date
            FROM page c
            LEFT JOIN package p ON p.id = c.package_id
            LEFT JOIN audience a ON a.id = c.audience_id
            LEFT JOIN money mo ON c.plan_owner AND mo.user_plan_id = c.user_plan_id
            ORDER BY c.rn
            """;

    /** Modal currency across this institute's PAID converted-lead payments (same as Revenue). */
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

    @Transactional(readOnly = true)
    public ConversionReportDTO getConversions(String instituteId, String fromDate, String toDate,
                                              String teamId, String counsellorUserId, String callerUserId) {
        LeadReportSettingService.ReportSettings settings = settingService.get(instituteId);
        ZoneId zone = safeZone(settings.timezone());
        Window w = resolveWindow(fromDate, toDate, zone);
        String scopeCsv = scopeResolver.resolveScopeUsersCsv(
                instituteId, callerUserId, trimToNull(teamId), trimToNull(counsellorUserId));

        List<String> convertingPackages = convertingPackageIds(instituteId, w, zone);
        if (convertingPackages.isEmpty()) {
            return emptyReport();
        }
        MapSqlParameterSource p = windowParams(instituteId, w, zone)
                .addValue("scopeCsv", scopeCsv, Types.VARCHAR)
                .addValue("packageCsv", String.join(",", convertingPackages))
                // One extra row tells us whether the list was cut off.
                .addValue("rowLimit", MAX_LEAD_ROWS + 1)
                // The fee plan's row is picked among the rows actually returned (the extra one is cut).
                .addValue("shownLimit", MAX_LEAD_ROWS);

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
                        .enrolledAt(rs.getDate("enrolled_day") != null
                                ? rs.getDate("enrolled_day").toLocalDate().atStartOfDay().format(LOCAL_DATE_TIME)
                                : toLocal(rs.getTimestamp("enrolled_at"), zone))
                        .enrolmentStatus(rs.getString("enrolment_status"))
                        .counsellorId(rs.getString("counsellor_id"))
                        .campaignName(rs.getString("campaign_name"))
                        .sourceType(rs.getString("source_type"))
                        .planShared(rs.getBoolean("plan_shared"))
                        .fee(rs.getBigDecimal("fee"))
                        .paid(rs.getBigDecimal("paid"))
                        .installments(nullableInt(rs, "installments"))
                        .installmentsPaid(nullableInt(rs, "installments_paid"))
                        .nextDueAmount(rs.getBigDecimal("next_amount"))
                        .nextDueDate(rs.getDate("next_due_date") != null
                                ? rs.getDate("next_due_date").toLocalDate().toString() : null)
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
                .currency(resolveCurrency(instituteId))
                .build();
    }

    // ─────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────

    /** In-window enrolled courses whose enrolment counts as a conversion (per-course policy). */
    private List<String> convertingPackageIds(String instituteId, Window w, ZoneId zone) {
        List<String> candidates = jdbc.queryForList(CANDIDATE_PACKAGES_SQL,
                windowParams(instituteId, w, zone), String.class);
        return candidates.stream()
                .filter(id -> id != null && !id.isBlank())
                .filter(id -> leadConversionPolicyService.countsAsConversion(instituteId, id))
                .collect(Collectors.toList());
    }

    private static Integer nullableInt(java.sql.ResultSet rs, String column) throws java.sql.SQLException {
        int v = rs.getInt(column);
        return rs.wasNull() ? null : v;
    }

    /**
     * The institute's payment currency, cached for {@link #CURRENCY_TTL_MS}: it only formats the fee
     * columns and almost never changes, so the payment_log scan behind it should not run on every
     * open of the tab.
     */
    private String resolveCurrency(String instituteId) {
        long now = System.currentTimeMillis();
        CachedCurrency hit = currencyCache.get(instituteId);
        if (hit != null && now - hit.at() < CURRENCY_TTL_MS) {
            return hit.currency();
        }
        String currency;
        try {
            List<String> found = jdbc.queryForList(CURRENCY_SQL,
                    new MapSqlParameterSource("instituteId", instituteId), String.class);
            currency = found.isEmpty() || found.get(0) == null ? DEFAULT_CURRENCY : found.get(0);
        } catch (Exception e) {
            // Not cached, so the next call tries again.
            return DEFAULT_CURRENCY;
        }
        currencyCache.put(instituteId, new CachedCurrency(currency, now));
        return currency;
    }

    private record CachedCurrency(String currency, long at) {
    }

    private static ConversionReportDTO emptyReport() {
        return ConversionReportDTO.builder()
                .totals(ConversionReportDTO.Totals.builder().convertedLeads(0).enrolments(0).build())
                .byCounsellor(List.of())
                .leads(List.of())
                .leadsTruncated(false)
                .currency(DEFAULT_CURRENCY)
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
        return new Window(from, to.plusDays(1));
    }

    /** Institute, timezone and the [fromDay, toDay) admission-day window. */
    private static MapSqlParameterSource windowParams(String instituteId, Window w, ZoneId zone) {
        return new MapSqlParameterSource()
                .addValue("instituteId", instituteId)
                .addValue("tz", zone.getId())
                .addValue("fromDay", java.sql.Date.valueOf(w.fromDay()), Types.DATE)
                .addValue("toDay", java.sql.Date.valueOf(w.toDay()), Types.DATE);
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

    private record Window(LocalDate fromDay, LocalDate toDay) {
    }
}
