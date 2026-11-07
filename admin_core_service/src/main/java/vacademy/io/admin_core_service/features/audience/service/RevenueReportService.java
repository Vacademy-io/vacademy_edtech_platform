package vacademy.io.admin_core_service.features.audience.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.audience.dto.reports.CohortAnalysisReportDTO;
import vacademy.io.admin_core_service.features.audience.dto.reports.RevenueForecastDTO;
import vacademy.io.admin_core_service.features.audience.dto.reports.RevenuePaymentsDTO;
import vacademy.io.admin_core_service.features.audience.dto.reports.RevenueReportDTO;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentGroupSql;
import vacademy.io.common.auth.dto.UserDTO;

import java.sql.Timestamp;
import java.sql.Types;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;

/**
 * Money reports for the Reports Center: revenue, cohort-analysis and revenue-forecast.
 *
 * <p>Revenue recognition (product decision): a {@code payment_log} row counts only when it is
 * {@code payment_status='PAID'} AND the paying user is an institute lead whose
 * {@code user_lead_profile.conversion_status='CONVERTED'} — "revenue only comes after the lead is
 * converted". Attribution uses the lead profile's denormalized {@code best_source_type} /
 * {@code assigned_counselor_id}, the same identity the rest of the suite scopes on. payment_log has
 * no institute_id, so the join to {@code user_lead_profile} (which does) provides institute scope —
 * and only this institute's converted leads' payments are ever in range.
 *
 * <p>Same conventions as {@link PipelineReportService}: read-only JdbcTemplate SQL, never JOINs
 * users (names via one {@link AuthService} batch), RBAC scope CSV from {@link ReportScopeResolver}
 * (null = no filter, "" = matches nothing), windows are institute-TZ dates converted to UTC
 * wall-clock bounds (columns store UTC in timestamp-without-time-zone).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class RevenueReportService {

    private final NamedParameterJdbcTemplate jdbc;
    private final ReportScopeResolver scopeResolver;
    private final LeadReportSettingService settingService;
    private final AuthService authService;

    private static final int DEFAULT_RANGE_DAYS = 30;
    private static final int FORECAST_TRAILING_DAYS = 90;
    private static final int[] FORECAST_HORIZONS = {30, 60, 90};
    private static final String DEFAULT_CURRENCY = "INR";

    // ─────────────────────────────────────────────────────────────────────
    // Revenue report
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Converted-lead attribution shared by every money query. The lead's counsellor is resolved the
     * SAME way the rest of the report suite resolves it: the enquiry counsellor on the lead's
     * representative response (best_score_response_id → linked_users), falling back to the lead
     * profile's assigned_counselor_id. assigned_counselor_id alone is almost never populated, so
     * scoping on it would zero out every scoped (non-admin) caller. Source = the student's first
     * enquiry, see {@link #leadAttribution}.
     */
    private static final String CONV_CTE = "conv AS (" + leadAttribution(true) + ")\n";

    /**
     * Lead attribution: source = the student's first enquiry (its campaign type), counsellor = the
     * enquiry counsellor on the profile's best-scoring response, falling back to
     * assigned_counselor_id.
     */
    private static String leadAttribution(boolean convertedOnly) {
        return """
                SELECT ulp.user_id,
                       """ + ReportSourceSql.firstEnquirySource("fe", "ulp.best_source_type") + """
                           AS source_type,
                       COALESCE(lu.user_id, ulp.assigned_counselor_id)           AS counsellor_id
                FROM user_lead_profile ulp
                LEFT JOIN audience_response ar ON ar.id = ulp.best_score_response_id
                """ + ReportSourceSql.firstEnquiryJoin("fe", "ulp.user_id", "ulp.institute_id") + """
                LEFT JOIN LATERAL (
                    SELECT lu2.user_id FROM linked_users lu2
                    WHERE lu2.source = 'ENQUIRY' AND lu2.source_id = ar.enquiry_id
                    ORDER BY lu2.created_at DESC LIMIT 1
                ) lu ON true
                WHERE ulp.institute_id = :instituteId
                """ + (convertedOnly ? """
                  AND ulp.conversion_status = 'CONVERTED'
                  AND (:scopeCsv IS NULL OR COALESCE(lu.user_id, ulp.assigned_counselor_id) = ANY(STRING_TO_ARRAY(:scopeCsv, ',')))
                """ : "");
    }

    /**
     * PAID payments in-window from the scoped converted leads. payment_amount NOT NULL keeps
     * SUM/COUNT aligned. The window and {@code pay_day} follow {@link ReportPaymentSql}: a hand-recorded
     * payment counts on its transaction date, not on the day it was entered.
     *
     * <p>One row per payment_log row, but a payment stored per course (admission package, multi-course
     * checkout) is several rows: money is the SUM of the rows, and "payments" counts
     * {@code pay_key} once ({@link PaymentGroupSql}). A checkout's planless parent row repeats its
     * courses' money and is left out.
     */
    private static final String PAID_CTE = """
            paid AS (
                SELECT c.user_id, c.source_type, c.counsellor_id,
                       pl.payment_amount,""" + PaymentGroupSql.GROUP_KEY_PL + """
                    AS pay_key,""" + ReportPaymentSql.paymentDay("pl") + """
                    AS pay_day
                FROM payment_log pl
                JOIN conv c ON c.user_id = pl.user_id
                WHERE pl.payment_status = 'PAID'
                  AND pl.payment_amount IS NOT NULL
                  AND""" + PaymentGroupSql.NOT_ORDER_PARENT_PL + """
                  AND """ + ReportPaymentSql.inWindow("pl") + """

            )
            """;

    private static final String REVENUE_TOTALS_SQL = "WITH " + CONV_CTE + ", " + PAID_CTE + """
            SELECT COALESCE(SUM(payment_amount), 0) AS revenue,
                   COUNT(DISTINCT user_id)          AS paying_leads,
                   COUNT(DISTINCT pay_key)          AS payments
            FROM paid
            """;

    private static final String REVENUE_BY_SOURCE_SQL = "WITH " + CONV_CTE + ", " + PAID_CTE + """
            SELECT source_type,
                   COALESCE(SUM(payment_amount), 0) AS revenue,
                   COUNT(DISTINCT user_id)          AS paying_leads,
                   COUNT(DISTINCT pay_key)          AS payments
            FROM paid
            GROUP BY source_type
            ORDER BY revenue DESC, source_type
            """;

    private static final String REVENUE_BY_COUNSELLOR_SQL = "WITH " + CONV_CTE + ", " + PAID_CTE + """
            SELECT paid.counsellor_id              AS user_id,
                   COALESCE(SUM(paid.payment_amount), 0) AS revenue,
                   COUNT(DISTINCT paid.user_id)    AS paying_leads,
                   COUNT(DISTINCT paid.pay_key)    AS payments
            FROM paid
            WHERE paid.counsellor_id IS NOT NULL
            GROUP BY paid.counsellor_id
            ORDER BY revenue DESC
            """;

    private static final String REVENUE_TREND_SQL = "WITH " + CONV_CTE + ", " + PAID_CTE + """
            SELECT pay_day AS day,
                   COALESCE(SUM(payment_amount), 0) AS revenue,
                   COUNT(DISTINCT pay_key)          AS payments
            FROM paid
            GROUP BY 1
            ORDER BY 1
            """;

    /** Modal currency across this institute's PAID converted-lead payments (not window-bound). */
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
    public RevenueReportDTO getRevenue(String instituteId, String fromDate, String toDate,
                                       String teamId, String counsellorUserId, String callerUserId) {
        LeadReportSettingService.ReportSettings settings = settingService.get(instituteId);
        ZoneId zone = safeZone(settings.timezone());
        Window w = resolveWindow(fromDate, toDate, zone);
        String scopeCsv = scopeResolver.resolveScopeUsersCsv(
                instituteId, callerUserId, trimToNull(teamId), trimToNull(counsellorUserId));
        MapSqlParameterSource p = baseParams(instituteId, w, scopeCsv).addValue("tz", zone.getId());

        RevenueReportDTO.Totals totals = jdbc.queryForObject(REVENUE_TOTALS_SQL, p, (rs, i) -> {
            double revenue = rs.getDouble("revenue");
            long payingLeads = rs.getLong("paying_leads");
            return RevenueReportDTO.Totals.builder()
                    .revenue(round2(revenue))
                    .payingLeads(payingLeads)
                    .payments(rs.getLong("payments"))
                    .avgDealValue(payingLeads > 0 ? round2(revenue / payingLeads) : null)
                    .build();
        });

        List<RevenueReportDTO.SourceRow> bySource = jdbc.query(REVENUE_BY_SOURCE_SQL, p, (rs, i) -> {
            double revenue = rs.getDouble("revenue");
            long payingLeads = rs.getLong("paying_leads");
            return RevenueReportDTO.SourceRow.builder()
                    .sourceType(rs.getString("source_type"))
                    .revenue(round2(revenue))
                    .payingLeads(payingLeads)
                    .payments(rs.getLong("payments"))
                    .avgDealValue(payingLeads > 0 ? round2(revenue / payingLeads) : null)
                    .build();
        });

        List<RevenueReportDTO.CounsellorRow> byCounsellor = jdbc.query(REVENUE_BY_COUNSELLOR_SQL, p, (rs, i) -> {
            double revenue = rs.getDouble("revenue");
            long payingLeads = rs.getLong("paying_leads");
            return RevenueReportDTO.CounsellorRow.builder()
                    .userId(rs.getString("user_id"))
                    .revenue(round2(revenue))
                    .payingLeads(payingLeads)
                    .payments(rs.getLong("payments"))
                    .avgDealValue(payingLeads > 0 ? round2(revenue / payingLeads) : null)
                    .build();
        });

        Map<String, String> names = resolveNames(
                byCounsellor.stream().map(RevenueReportDTO.CounsellorRow::getUserId).toList());
        byCounsellor.forEach(r -> r.setName(names.getOrDefault(r.getUserId(), r.getUserId())));

        Map<String, RevenueReportDTO.DayPoint> trendByDay = new LinkedHashMap<>();
        jdbc.query(REVENUE_TREND_SQL, p, (RowCallbackHandler) rs -> {
            String day = rs.getDate("day").toLocalDate().toString();
            trendByDay.put(day, RevenueReportDTO.DayPoint.builder()
                    .date(day)
                    .revenue(round2(rs.getDouble("revenue")))
                    .payments(rs.getLong("payments"))
                    .build());
        });
        List<RevenueReportDTO.DayPoint> trend = gapFillDays(w, zone, trendByDay);

        return RevenueReportDTO.builder()
                .currency(resolveCurrency(instituteId))
                .totals(totals)
                .bySource(bySource)
                .byCounsellor(byCounsellor)
                .trend(trend)
                .build();
    }

    // ─────────────────────────────────────────────────────────────────────
    // Revenue payments (drill-down behind a Collected number)
    // ─────────────────────────────────────────────────────────────────────

    private static final int PAYMENTS_LIMIT = 2000;

    /**
     * The payment rows behind {@link #PAID_CTE}, with the student, receipt and course. Same CTEs, so
     * a counsellor-scoped list sums to that counsellor's Collected. Totals are window functions,
     * computed before the LIMIT, so they cover every match.
     * One row per payment: the per-course rows of one payment (admission package, multi-course
     * checkout) come back as a single row with their amounts summed, every receipt number and every
     * course, so the count here matches the Payments figure of the tab.
     */
    private static final String PAYMENTS_SQL = "WITH " + CONV_CTE + ", " + """
            paid AS (
                SELECT pl.id, pl.user_id, pl.user_plan_id, c.source_type, c.counsellor_id,
                       pl.payment_amount, pl.payment_mode, pl.payment_sub_mode, pl.vendor,
                       pl.payment_reference, pl.created_at,""" + PaymentGroupSql.GROUP_KEY_PL + """
                    AS pay_key,
                       """ + ReportPaymentSql.paymentDay("pl") + """
                    AS pay_day
                FROM payment_log pl
                JOIN conv c ON c.user_id = pl.user_id
                WHERE pl.payment_status = 'PAID'
                  AND pl.payment_amount IS NOT NULL
                  AND""" + PaymentGroupSql.NOT_ORDER_PARENT_PL + """
                  AND """ + ReportPaymentSql.inWindow("pl") + """

            ),
            grouped AS (
                SELECT DISTINCT ON (p.pay_key)
                       p.pay_key, p.id, p.user_id, p.source_type, p.counsellor_id,
                       p.payment_mode, p.payment_sub_mode, p.vendor, p.payment_reference,
                       p.created_at, p.pay_day,
                       SUM(p.payment_amount) OVER (PARTITION BY p.pay_key) AS payment_amount,
                       ARRAY_AGG(p.id) OVER (PARTITION BY p.pay_key)           AS log_ids,
                       ARRAY_AGG(p.user_plan_id) OVER (PARTITION BY p.pay_key) AS plan_ids
                FROM paid p
                ORDER BY p.pay_key, p.created_at, p.id
            ),
            page AS (
                SELECT g.*,
                       SUM(g.payment_amount) OVER () AS total_amount,
                       COUNT(*) OVER ()              AS total_count
                FROM grouped g
                ORDER BY g.pay_day DESC, g.created_at DESC, g.id
                LIMIT :limit
            )
            SELECT pg.*,
                   (pg.created_at AT TIME ZONE 'UTC' AT TIME ZONE :tz)::date AS entry_day,
                   st.full_name, st.mobile_number,
                   (SELECT string_agg(DISTINCT i.invoice_number, ', ')
                      FROM invoice_payment_log_mapping m
                      JOIN invoice i ON i.id = m.invoice_id
                     WHERE m.payment_log_id = ANY(pg.log_ids)) AS receipt,
                   (SELECT string_agg(DISTINCT pk.package_name, ', ')
                      FROM student_session_institute_group_mapping s
                      JOIN package_session ps ON ps.id = s.package_session_id
                      JOIN package pk ON pk.id = ps.package_id
                     WHERE s.user_id = pg.user_id
                       AND s.institute_id = :instituteId
                       AND s.user_plan_id = ANY(pg.plan_ids)) AS courses
            FROM page pg
            LEFT JOIN LATERAL (
                SELECT full_name, mobile_number FROM student
                WHERE user_id = pg.user_id
                ORDER BY created_at DESC LIMIT 1
            ) st ON true
            ORDER BY pg.pay_day DESC, pg.created_at DESC, pg.id
            """;

    /**
     * Every payment counted in the Revenue tab's Collected for the same filters. Pass the clicked
     * counsellor as {@code counsellorUserId} to get exactly that row's payments (RBAC still applies).
     */
    @Transactional(readOnly = true)
    public RevenuePaymentsDTO getRevenuePayments(String instituteId, String fromDate, String toDate,
                                                 String teamId, String counsellorUserId, String callerUserId) {
        LeadReportSettingService.ReportSettings settings = settingService.get(instituteId);
        ZoneId zone = safeZone(settings.timezone());
        Window w = resolveWindow(fromDate, toDate, zone);
        String scopeCsv = scopeResolver.resolveScopeUsersCsv(
                instituteId, callerUserId, trimToNull(teamId), trimToNull(counsellorUserId));
        MapSqlParameterSource p = baseParams(instituteId, w, scopeCsv)
                .addValue("tz", zone.getId())
                .addValue("limit", PAYMENTS_LIMIT);

        double[] total = {0};
        long[] count = {0};
        List<RevenuePaymentsDTO.PaymentRow> rows = jdbc.query(PAYMENTS_SQL, p, (rs, i) -> {
            total[0] = rs.getDouble("total_amount");
            count[0] = rs.getLong("total_count");
            java.sql.Date entry = rs.getDate("entry_day");
            return RevenuePaymentsDTO.PaymentRow.builder()
                    .paymentId(rs.getString("id"))
                    .userId(rs.getString("user_id"))
                    .studentName(rs.getString("full_name"))
                    .phone(rs.getString("mobile_number"))
                    .paymentDate(rs.getDate("pay_day").toLocalDate().toString())
                    .enteredOn(entry == null ? null : entry.toLocalDate().toString())
                    .amount(round2(rs.getDouble("payment_amount")))
                    .paymentMode(Optional.ofNullable(rs.getString("payment_mode")).orElse(rs.getString("vendor")))
                    .paymentSubMode(rs.getString("payment_sub_mode"))
                    .paymentReference(rs.getString("payment_reference"))
                    .receiptNumber(rs.getString("receipt"))
                    .courses(rs.getString("courses"))
                    .sourceType(rs.getString("source_type"))
                    .counsellorId(rs.getString("counsellor_id"))
                    .build();
        });

        Map<String, String> names = resolveNames(rows.stream()
                .map(RevenuePaymentsDTO.PaymentRow::getCounsellorId).filter(id -> id != null).distinct().toList());
        rows.forEach(r -> r.setCounsellorName(r.getCounsellorId() == null ? null : names.get(r.getCounsellorId())));

        return RevenuePaymentsDTO.builder()
                .currency(resolveCurrency(instituteId))
                .total(round2(total[0]))
                .count(count[0])
                .truncated(count[0] > rows.size())
                .payments(rows)
                .build();
    }

    // ─────────────────────────────────────────────────────────────────────
    // Cohort analysis
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Acquisition-cohort maturation. Each lead profile is bucketed by the institute-TZ month of its
     * acquisition (created_at, falling back to last_calculated_at for legacy rows missing it); the
     * window selects which acquisition months appear. Revenue is the cohort's converted leads'
     * lifetime PAID revenue (NOT window-bound — a cohort's value accrues after acquisition).
     */
    /**
     * Lead-scope join for queries over ALL leads (not just converted) — resolves the same enquiry
     * counsellor as {@link #CONV_CTE} so RBAC scoping doesn't collapse on the rarely-populated
     * assigned_counselor_id. Pair with {@link #LEAD_SCOPE_PRED} in the WHERE.
     */
    private static final String LEAD_SCOPE_JOIN = """
            FROM user_lead_profile ulp
            LEFT JOIN audience_response ar ON ar.id = ulp.best_score_response_id
            LEFT JOIN LATERAL (
                SELECT lu2.user_id FROM linked_users lu2
                WHERE lu2.source = 'ENQUIRY' AND lu2.source_id = ar.enquiry_id
                ORDER BY lu2.created_at DESC LIMIT 1
            ) lu ON true
            """;

    private static final String LEAD_SCOPE_PRED =
            " AND (:scopeCsv IS NULL OR COALESCE(lu.user_id, ulp.assigned_counselor_id) = ANY(STRING_TO_ARRAY(:scopeCsv, ',')))";

    private static final String COHORT_SQL = "WITH leads AS ("
            + """
                SELECT ulp.user_id,
                       COALESCE(ulp.created_at, ulp.last_calculated_at) AS acq,
                       ulp.conversion_status,
                       ulp.converted_at
            """ + LEAD_SCOPE_JOIN + """
                WHERE ulp.institute_id = :instituteId
                  AND COALESCE(ulp.created_at, ulp.last_calculated_at) >= :fromTs
                  AND COALESCE(ulp.created_at, ulp.last_calculated_at) <  :toTs
            """ + LEAD_SCOPE_PRED + """
            ),
            rev AS (
                SELECT pl.user_id, SUM(pl.payment_amount) AS revenue
                FROM payment_log pl
                WHERE pl.payment_status = 'PAID' AND pl.payment_amount IS NOT NULL
                  AND""" + PaymentGroupSql.NOT_ORDER_PARENT_PL + """
                GROUP BY pl.user_id
            )
            SELECT to_char((l.acq AT TIME ZONE 'UTC' AT TIME ZONE :tz), 'YYYY-MM') AS cohort,
                   COUNT(*)                                                        AS leads,
                   COUNT(*) FILTER (WHERE l.conversion_status = 'CONVERTED')        AS converted,
                   COALESCE(SUM(r.revenue) FILTER (WHERE l.conversion_status = 'CONVERTED'), 0) AS revenue,
                   PERCENTILE_CONT(0.5) WITHIN GROUP (
                       ORDER BY EXTRACT(EPOCH FROM (l.converted_at - l.acq)) / 86400.0)
                       FILTER (WHERE l.conversion_status = 'CONVERTED' AND l.converted_at IS NOT NULL)
                       AS median_days_to_convert
            FROM leads l
            LEFT JOIN rev r ON r.user_id = l.user_id
            GROUP BY 1
            ORDER BY 1
            """;

    @Transactional(readOnly = true)
    public CohortAnalysisReportDTO getCohortAnalysis(String instituteId, String fromDate, String toDate,
                                                     String teamId, String counsellorUserId, String callerUserId) {
        LeadReportSettingService.ReportSettings settings = settingService.get(instituteId);
        ZoneId zone = safeZone(settings.timezone());
        Window w = resolveWindow(fromDate, toDate, zone);
        String scopeCsv = scopeResolver.resolveScopeUsersCsv(
                instituteId, callerUserId, trimToNull(teamId), trimToNull(counsellorUserId));
        MapSqlParameterSource p = baseParams(instituteId, w, scopeCsv).addValue("tz", zone.getId());

        List<CohortAnalysisReportDTO.CohortRow> cohorts = jdbc.query(COHORT_SQL, p, (rs, i) -> {
            long leads = rs.getLong("leads");
            long converted = rs.getLong("converted");
            double revenue = rs.getDouble("revenue");
            return CohortAnalysisReportDTO.CohortRow.builder()
                    .cohort(rs.getString("cohort"))
                    .leads(leads)
                    .converted(converted)
                    .conversionRate(percentage(converted, leads))
                    .revenue(round2(revenue))
                    .avgDealValue(converted > 0 ? round2(revenue / converted) : null)
                    .revenuePerLead(leads > 0 ? round2(revenue / leads) : null)
                    .medianDaysToConvert(round1(getNullableDouble(rs, "median_days_to_convert")))
                    .build();
        });

        return CohortAnalysisReportDTO.builder()
                .currency(resolveCurrency(instituteId))
                .cohorts(cohorts)
                .build();
    }

    // ─────────────────────────────────────────────────────────────────────
    // Revenue forecast
    // ─────────────────────────────────────────────────────────────────────

    private static final String TRAILING_REVENUE_SQL = "WITH " + CONV_CTE + ", " + PAID_CTE + """
            SELECT COALESCE(SUM(payment_amount), 0) AS revenue,
                   COUNT(DISTINCT user_id)          AS paying_leads
            FROM paid
            """;

    /** Leads acquired in the trailing window + those converted in it (velocity ratio inputs). */
    private static final String TRAILING_LEADS_SQL = """
            SELECT COUNT(*) FILTER (
                       WHERE COALESCE(ulp.created_at, ulp.last_calculated_at) >= :fromTs
                         AND COALESCE(ulp.created_at, ulp.last_calculated_at) <  :toTs) AS leads,
                   COUNT(*) FILTER (
                       WHERE ulp.converted_at >= :fromTs AND ulp.converted_at < :toTs) AS conversions
            """ + LEAD_SCOPE_JOIN + """
            WHERE ulp.institute_id = :instituteId
            """ + LEAD_SCOPE_PRED;

    /** Open pipeline right now: leads not yet won or lost, scoped. */
    private static final String OPEN_PIPELINE_SQL = """
            SELECT COUNT(*) AS open_leads
            """ + LEAD_SCOPE_JOIN + """
            WHERE ulp.institute_id = :instituteId
              AND ulp.conversion_status = 'LEAD'
            """ + LEAD_SCOPE_PRED;

    @Transactional(readOnly = true)
    public RevenueForecastDTO getForecast(String instituteId, String teamId,
                                          String counsellorUserId, String callerUserId) {
        LeadReportSettingService.ReportSettings settings = settingService.get(instituteId);
        ZoneId zone = safeZone(settings.timezone());
        // Trailing window ends at "now" (institute TZ start of tomorrow, exclusive) and spans
        // FORECAST_TRAILING_DAYS — independent of the page's date filter, which forecasting ignores.
        LocalDate today = LocalDate.now(zone);
        Window trailing = new Window(
                toUtc(today.minusDays(FORECAST_TRAILING_DAYS - 1L), zone),
                toUtc(today.plusDays(1), zone));
        String scopeCsv = scopeResolver.resolveScopeUsersCsv(
                instituteId, callerUserId, trimToNull(teamId), trimToNull(counsellorUserId));
        MapSqlParameterSource p = baseParams(instituteId, trailing, scopeCsv).addValue("tz", zone.getId());

        double[] rev = jdbc.queryForObject(TRAILING_REVENUE_SQL, p,
                (rs, i) -> new double[]{rs.getDouble("revenue"), rs.getLong("paying_leads")});
        double trailingRevenue = rev != null ? rev[0] : 0.0;
        long payingLeads = rev != null ? (long) rev[1] : 0L;

        long[] leadCounts = jdbc.queryForObject(TRAILING_LEADS_SQL, p,
                (rs, i) -> new long[]{rs.getLong("leads"), rs.getLong("conversions")});
        long trailingLeads = leadCounts != null ? leadCounts[0] : 0L;
        long trailingConversions = leadCounts != null ? leadCounts[1] : 0L;

        Long openLeadsObj = jdbc.queryForObject(OPEN_PIPELINE_SQL,
                new MapSqlParameterSource()
                        .addValue("instituteId", instituteId)
                        .addValue("scopeCsv", scopeCsv, Types.VARCHAR),
                Long.class);
        long openPipeline = openLeadsObj != null ? openLeadsObj : 0L;

        double avgDailyRevenue = trailingRevenue / FORECAST_TRAILING_DAYS;
        Double conversionRate = percentage(trailingConversions, trailingLeads); // 0–100
        Double avgDealValue = payingLeads > 0 ? round2(trailingRevenue / payingLeads) : null;

        // Pipeline expected value if it fully matures: open × p(convert) × avg deal value.
        // historicalConversionRate is a velocity ratio (conversions ÷ acquisitions in the same
        // window) and can exceed 100% when a backlog is being worked down — clamp the probability
        // to [0,1] so the forecast can't over-count the open pipeline.
        double convProb = conversionRate != null ? Math.max(0.0, Math.min(1.0, conversionRate / 100.0)) : 0.0;
        double pipelineFull = avgDealValue != null ? openPipeline * convProb * avgDealValue : 0.0;

        List<RevenueForecastDTO.HorizonRow> horizons = new ArrayList<>();
        for (int days : FORECAST_HORIZONS) {
            double runRate = avgDailyRevenue * days;
            // Pipeline matures over ≈ the trailing conversion window; ramp linearly, cap at full.
            double pipeline = pipelineFull * Math.min(1.0, (double) days / FORECAST_TRAILING_DAYS);
            horizons.add(RevenueForecastDTO.HorizonRow.builder()
                    .days(days)
                    .runRateRevenue(round2(runRate))
                    .pipelineRevenue(round2(pipeline))
                    .blendedRevenue(round2((runRate + pipeline) / 2.0))
                    .build());
        }

        return RevenueForecastDTO.builder()
                .currency(resolveCurrency(instituteId))
                .assumptions(RevenueForecastDTO.Assumptions.builder()
                        .trailingDays(FORECAST_TRAILING_DAYS)
                        .trailingRevenue(round2(trailingRevenue))
                        .avgDailyRevenue(round2(avgDailyRevenue))
                        .trailingLeads(trailingLeads)
                        .trailingConversions(trailingConversions)
                        .historicalConversionRate(conversionRate)
                        .avgDealValue(avgDealValue)
                        .openPipelineLeads(openPipeline)
                        .build())
                .horizons(horizons)
                .build();
    }

    // ─────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────

    private String resolveCurrency(String instituteId) {
        try {
            List<String> found = jdbc.queryForList(CURRENCY_SQL,
                    new MapSqlParameterSource("instituteId", instituteId), String.class);
            return found.isEmpty() || found.get(0) == null ? DEFAULT_CURRENCY : found.get(0);
        } catch (Exception e) {
            return DEFAULT_CURRENCY;
        }
    }

    /** Dense daily series across the window so the FE chart has no gaps. */
    private List<RevenueReportDTO.DayPoint> gapFillDays(Window w, ZoneId zone,
                                                        Map<String, RevenueReportDTO.DayPoint> byDay) {
        List<RevenueReportDTO.DayPoint> out = new ArrayList<>();
        LocalDate from = localDay(w.fromUtc(), zone);
        LocalDate toExclusive = localDay(w.toUtc(), zone);
        for (LocalDate d = from; d.isBefore(toExclusive); d = d.plusDays(1)) {
            String key = d.toString();
            out.add(byDay.getOrDefault(key, RevenueReportDTO.DayPoint.builder()
                    .date(key).revenue(0).payments(0).build()));
        }
        return out;
    }

    private Window resolveWindow(String fromDate, String toDate, ZoneId zone) {
        LocalDate today = LocalDate.now(zone);
        LocalDate to = parseOr(toDate, today);
        LocalDate from = parseOr(fromDate, to.minusDays(DEFAULT_RANGE_DAYS - 1L));
        return new Window(toUtc(from, zone), toUtc(to.plusDays(1), zone));
    }

    /** Institute-TZ calendar date of a UTC wall-clock window bound. */
    private static LocalDate localDay(Timestamp utc, ZoneId zone) {
        return utc.toLocalDateTime().atZone(ZoneOffset.UTC).withZoneSameInstant(zone).toLocalDate();
    }

    private static Timestamp toUtc(LocalDate localDate, ZoneId zone) {
        return Timestamp.valueOf(localDate.atStartOfDay(zone)
                .withZoneSameInstant(ZoneOffset.UTC).toLocalDateTime());
    }

    private static MapSqlParameterSource baseParams(String instituteId, Window w, String scopeCsv) {
        return new MapSqlParameterSource()
                .addValue("instituteId", instituteId)
                .addValue("fromTs", w.fromUtc(), Types.TIMESTAMP)
                .addValue("toTs", w.toUtc(), Types.TIMESTAMP)
                .addValue("scopeCsv", scopeCsv, Types.VARCHAR);
    }

    private ZoneId safeZone(String tz) {
        try {
            return ZoneId.of(tz);
        } catch (Exception e) {
            log.warn("[RevenueReport] invalid institute timezone '{}', falling back to Asia/Kolkata", tz);
            return ZoneId.of("Asia/Kolkata");
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
            log.warn("[RevenueReport] name hydration failed: {}", e.getMessage());
            return Collections.emptyMap();
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

    private static Double percentage(long num, long denom) {
        if (denom == 0) return null;
        return Math.round((num * 1000.0) / denom) / 10.0;
    }

    private static double round2(double v) {
        return Math.round(v * 100.0) / 100.0;
    }

    private static Double round1(Double v) {
        return v == null ? null : Math.round(v * 10.0) / 10.0;
    }

    private static Double getNullableDouble(java.sql.ResultSet rs, String col) throws java.sql.SQLException {
        double v = rs.getDouble(col);
        return rs.wasNull() ? null : v;
    }

    private record Window(Timestamp fromUtc, Timestamp toUtc) {
    }
}
