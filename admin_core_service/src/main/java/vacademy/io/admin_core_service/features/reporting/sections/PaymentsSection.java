package vacademy.io.admin_core_service.features.reporting.sections;

import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentGroupSql;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.reporting.spi.ReportContext;
import vacademy.io.admin_core_service.features.reporting.spi.ReportSection;
import vacademy.io.admin_core_service.features.reporting.spi.SectionFacts;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Money collected, pending and failed.
 *
 * <h3>Payments carry no institute id — attribution is two-path</h3>
 * {@code payment_log} has {@code user_id} and {@code user_plan_id} but no
 * institute. The normal path is {@code user_plan → enroll_invite → institute_id},
 * which covers 86% of all rows but only 57% of recent ones: 1,917 of the last
 * 4,434 payments have no {@code user_plan_id} at all. Reporting only the
 * resolvable ones would understate an institute's revenue by roughly 40% while
 * looking authoritative, which is the worst thing a money section can do.
 *
 * Those rows are recoverable because 1,868 of them belong to users who DO have an
 * active enrolment, and 99.3% of those users belong to exactly one institute. So
 * the fallback attributes a plan-less payment to the user's single active
 * institute, and deliberately drops the ~10 users enrolled at several — an
 * ambiguous payment counted in two institutes' revenue is worse than one omitted.
 *
 * <h3>Currency is not assumed</h3>
 * Amounts span INR, USD and 2,608 rows with a blank currency, so nothing is ever
 * summed across currencies. Totals are computed per currency and rendered
 * separately; blank is shown as "unspecified" rather than folded into the
 * institute's main currency.
 *
 * <h3>Which status means what</h3>
 * Three columns look like status. {@code status} is the row's lifecycle
 * (ACTIVE/SUCCESS) and {@code order_status} is often null; the one that describes
 * the money is {@code payment_status} — PAID, PAYMENT_PENDING, FAILED.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class PaymentsSection implements ReportSection {

    /** Chase list length. Sized for the runner's 25-row display budget. */
    private static final int MAX_ROWS = 15;

    private final JdbcTemplate jdbcTemplate;

    @Override
    public String key() {
        return "payments";
    }

    @Override
    public String title() {
        return "Payments";
    }

    @Override
    public String description() {
        return "Collected, pending and failed payments for the period, with the "
                + "learners whose payments need chasing.";
    }

    @Override
    public Set<String> visibleToRoles() {
        return Set.of("ADMIN"); // revenue is an owner concern, not a teaching one
    }

    @Override
    public boolean identifying() {
        return true; // the chase list names learners
    }

    @Override
    public Set<ReportContext.ScopeType> supportedScopes() {
        // A payment has no dependable batch dimension, so a per-batch document
        // would be a copy of the institute one.
        return Set.of(ReportContext.ScopeType.INSTITUTE);
    }


    @Override
    public boolean isAvailableFor(String instituteId) {
        Integer n = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM payment_log pl "
                        + "LEFT JOIN user_plan up ON up.id = pl.user_plan_id "
                        + "LEFT JOIN enroll_invite ei ON ei.id = up.enroll_invite_id "
                        + "WHERE pl.created_at > now() - INTERVAL '90 days' "
                        + "AND ei.institute_id = ?",
                Integer.class, instituteId);
        return n != null && n > 0;
    }

    @Override
    public SectionFacts compute(ReportContext ctx) {
        Timestamp from = Timestamp.from(ctx.getWindowStart());
        Timestamp to = Timestamp.from(ctx.getWindowEnd());
        long span = ctx.getWindowEnd().toEpochMilli() - ctx.getWindowStart().toEpochMilli();
        Timestamp prevFrom = Timestamp.from(
                Instant.ofEpochMilli(ctx.getWindowStart().toEpochMilli() - span));

        List<Map<String, Object>> agg = jdbcTemplate.queryForList(SUMMARY_SQL,
                prevFrom, to, ctx.getInstituteId(), ctx.getInstituteId(), from, from, from, from);

        // Per currency, so nothing is ever added across them.
        Map<String, Double> paidNow = new LinkedHashMap<>();
        Map<String, Double> paidPrev = new LinkedHashMap<>();
        Map<String, Double> failed = new LinkedHashMap<>();
        Map<String, Double> pending = new LinkedHashMap<>();
        int paidCount = 0, failedCount = 0, pendingCount = 0;

        for (Map<String, Object> r : agg) {
            String cur = str(r.get("currency"), "UNSPECIFIED");
            String status = str(r.get("payment_status"), "");
            int nWindow = num(r.get("n_window"));
            double amtWindow = dbl(r.get("amt_window"));
            switch (status) {
                case "PAID" -> {
                    paidCount += nWindow;
                    if (amtWindow > 0) paidNow.merge(cur, amtWindow, Double::sum);
                    double prevAmt = dbl(r.get("amt_prev"));
                    if (prevAmt > 0) paidPrev.merge(cur, prevAmt, Double::sum);
                }
                case "FAILED" -> {
                    failedCount += nWindow;
                    if (amtWindow > 0) failed.merge(cur, amtWindow, Double::sum);
                }
                case "PAYMENT_PENDING" -> {
                    pendingCount += nWindow;
                    if (amtWindow > 0) pending.merge(cur, amtWindow, Double::sum);
                }
                default -> { /* unknown status — counted nowhere rather than guessed */ }
            }
        }

        List<SectionFacts.Row> rows = new ArrayList<>();
        int named = 0;
        for (Map<String, Object> r : jdbcTemplate.queryForList(CHASE_SQL,
                from, to, ctx.getInstituteId(), ctx.getInstituteId(), MAX_ROWS)) {
            String userId = (String) r.get("user_id");
            // Enforced here so a mis-configured schedule cannot widen a teacher's
            // view. In practice this section is ADMIN-only, but the guard is the
            // contract, not the current role list.
            if (ctx.namingRestricted()
                    && (userId == null || !ctx.getVisibleLearnerIds().contains(userId))) {
                continue;
            }
            named++;
            rows.add(SectionFacts.Row.builder()
                    .subjectId(userId)
                    .value(str(r.get("payer"), "(unnamed learner)"))
                    .value("PAYMENT_PENDING".equals(str(r.get("payment_status"), ""))
                            ? "pending" : "failed")
                    .value(money(str(r.get("currency"), "UNSPECIFIED"), dbl(r.get("payment_amount"))))
                    .value(String.valueOf(r.get("day")))
                    .build());
        }

        int chaseable = failedCount + pendingCount;
        if (chaseable > named && named > 0) {
            rows.add(SectionFacts.Row.builder()
                    .value((chaseable - named) + " more awaiting payment or failed")
                    .value("").value("").value("")
                    .build());
        }

        return SectionFacts.builder()
                .sectionKey(key())
                .title(title())
                .identifying(true)
                .empty(paidCount == 0 && chaseable == 0)
                .headline("Collected", amounts(paidNow))
                .headline("vs previous period", describeDelta(paidNow, paidPrev))
                .headline("Payments taken", String.valueOf(paidCount))
                .headline("Failed", failedCount == 0
                        ? "0" : failedCount + " · " + amounts(failed))
                .headline("Awaiting payment", pendingCount == 0
                        ? "0" : pendingCount + " · " + amounts(pending))
                .tone("Failed", failedCount == 0 ? "good" : "bad")
                .tone("Awaiting payment", pendingCount == 0 ? "good" : "warn")
                .column("Learner")
                .column("Status")
                .column("Amount")
                .column("When")
                .rows(rows)
                .build();
    }

    /**
     * Renders one total per currency. Never adds across them — "₹24,589 + $120" is
     * honest where a single summed number would be fiction.
     */
    private static String amounts(Map<String, Double> byCurrency) {
        if (byCurrency.isEmpty()) return "—";
        return byCurrency.entrySet().stream()
                .map(e -> money(e.getKey(), e.getValue()))
                .reduce((a, b) -> a + " + " + b)
                .orElse("—");
    }

    private static String money(String currency, double amount) {
        String n = amount >= 1000
                ? String.format("%,.0f", amount)
                : String.format("%,.0f", amount);
        return switch (currency) {
            case "INR" -> "₹" + n;
            case "USD" -> "$" + n;
            case "EUR" -> "€" + n;
            case "GBP" -> "£" + n;
            case "UNSPECIFIED" -> n + " (currency unspecified)";
            default -> n + " " + currency;
        };
    }

    /**
     * Only compares when the currencies line up. A percentage across a changed
     * currency mix would be meaningless, so it says so instead.
     */
    private static String describeDelta(Map<String, Double> now, Map<String, Double> before) {
        if (before.isEmpty()) return now.isEmpty() ? "—" : "first payments";
        if (!now.keySet().equals(before.keySet())) return "currency mix changed";
        double n = now.values().stream().mapToDouble(Double::doubleValue).sum();
        double b = before.values().stream().mapToDouble(Double::doubleValue).sum();
        if (b <= 0) return n > 0 ? "first payments" : "—";
        long pct = Math.round(100.0 * (n - b) / b);
        if (pct == 0) return "unchanged";
        return (pct > 0 ? "+" : "") + pct + "%";
    }

    private static int num(Object o) {
        return o == null ? 0 : ((Number) o).intValue();
    }

    private static double dbl(Object o) {
        return o == null ? 0d : ((Number) o).doubleValue();
    }

    private static String str(Object o, String fallback) {
        String v = o == null ? null : String.valueOf(o).trim();
        return (v == null || v.isEmpty()) ? fallback : v;
    }

    /**
     * Payments attributable to this institute, over both windows.
     *
     * The fallback branch aggregates over ALL of the payer's active enrolments and
     * requires exactly one distinct institute which is this one. Putting the
     * institute test in the WHERE instead would make the HAVING a no-op — the
     * filtered set trivially has one distinct institute — and multi-institute
     * payers would be counted in every institute's revenue.
     *
     * Params: prevStart, windowEnd, instituteId, instituteId.
     */
    private static final String SCOPED_CTE = """
            WITH scoped AS (
                SELECT pl.id, pl.user_id, pl.payment_status, pl.payment_amount,
                       pl.created_at,""" + PaymentGroupSql.GROUP_KEY_PL + """
                       AS pay_key,
                       COALESCE(NULLIF(btrim(pl.currency), ''), 'UNSPECIFIED') AS currency
                FROM payment_log pl
                LEFT JOIN user_plan up ON up.id = pl.user_plan_id
                LEFT JOIN enroll_invite ei ON ei.id = up.enroll_invite_id
                WHERE pl.created_at >= ? AND pl.created_at < ?
                  AND""" + PaymentGroupSql.NOT_ORDER_PARENT_PL + """
                  AND (
                    ei.institute_id = ?
                    OR (pl.user_plan_id IS NULL AND EXISTS (
                          SELECT 1
                          FROM student_session_institute_group_mapping m
                          WHERE m.user_id = pl.user_id AND m.status = 'ACTIVE'
                          HAVING count(DISTINCT m.institute_id) = 1
                             AND min(m.institute_id) = ?))
                  )
            )
            """;

    /** Params: SCOPED_CTE params, then windowStart four times. */
    private static final String SUMMARY_SQL = SCOPED_CTE + """
            SELECT currency, payment_status,
                   count(DISTINCT pay_key) FILTER (WHERE created_at >= ?)  AS n_window,
                   sum(payment_amount) FILTER (WHERE created_at >= ?) AS amt_window,
                   count(DISTINCT pay_key) FILTER (WHERE created_at < ?)   AS n_prev,
                   sum(payment_amount) FILTER (WHERE created_at < ?)  AS amt_prev
            FROM scoped
            GROUP BY currency, payment_status
            """;

    /**
     * The chase list: money not collected, largest first, current window only.
     * Params: SCOPED_CTE params (windowStart as prevStart — this query does not
     * look back), limit.
     */
    private static final String CHASE_SQL = SCOPED_CTE + """
            SELECT s.user_id, s.payment_status, s.payment_amount, s.currency,
                   s.created_at::date AS day,
                   st.full_name AS payer
            FROM scoped s
            LEFT JOIN LATERAL (
                SELECT stu.full_name FROM student stu
                WHERE stu.user_id = s.user_id
                ORDER BY stu.created_at DESC NULLS LAST
                LIMIT 1
            ) st ON TRUE
            WHERE s.payment_status IN ('FAILED', 'PAYMENT_PENDING')
            ORDER BY s.payment_amount DESC NULLS LAST, s.created_at DESC
            LIMIT ?
            """;
}
