package vacademy.io.notification_service.features.email_billing;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.sql.Date;
import java.time.LocalDate;
import java.util.List;

/**
 * Counts what was sent: per institute, IST day and class, plus the running monthly total the
 * gate and the charge job read. Both writes are single-statement upserts, safe from any number of
 * dispatch threads and pods.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class EmailUsageStore {

    private final JdbcTemplate jdbc;

    private static final String UPSERT_DAILY = """
            INSERT INTO email_usage_daily (institute_id, usage_date, billing_class, emails, units, updated_at)
            VALUES (?, ?, ?, 1, ?, CURRENT_TIMESTAMP)
            ON CONFLICT (institute_id, usage_date, billing_class) DO UPDATE
                SET emails = email_usage_daily.emails + 1,
                    units = email_usage_daily.units + EXCLUDED.units,
                    updated_at = CURRENT_TIMESTAMP
            """;

    private static final String UPSERT_MONTH = """
            INSERT INTO email_billing_month (institute_id, period_month, chargeable_units, updated_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT (institute_id, period_month) DO UPDATE
                SET chargeable_units = email_billing_month.chargeable_units + EXCLUDED.chargeable_units,
                    updated_at = CURRENT_TIMESTAMP
            """;

    /**
     * Records one sent email. Never throws: counting must not fail an email that already went out.
     */
    public void recordSent(String instituteId, EmailBillingClass cls, int units) {
        if (instituteId == null || instituteId.isBlank() || cls == null) {
            return;
        }
        try {
            LocalDate day = EmailBillingSettings.today();
            jdbc.update(UPSERT_DAILY, instituteId, Date.valueOf(day), cls.name(), Math.max(1, units));
            if (cls.chargeable()) {
                jdbc.update(UPSERT_MONTH, instituteId, EmailBillingSettings.month(day), Math.max(1, units));
            }
        } catch (Exception e) {
            log.error("Could not record email usage for institute {} ({} units, {}): {}",
                    instituteId, units, cls, e.getMessage());
        }
    }

    /** Chargeable units sent this month and the units beyond the allowance already charged. */
    public record MonthTotals(long chargeableUnits, long chargedUnits, BigDecimal chargedCredits) {
        static final MonthTotals EMPTY = new MonthTotals(0, 0, BigDecimal.ZERO);
    }

    public MonthTotals monthTotals(String instituteId, String month) {
        List<MonthTotals> rows = jdbc.query("""
                SELECT chargeable_units, charged_units, charged_credits
                FROM email_billing_month WHERE institute_id = ? AND period_month = ?
                """, (rs, i) -> new MonthTotals(rs.getLong(1), rs.getLong(2), rs.getBigDecimal(3)),
                instituteId, month);
        return rows.isEmpty() ? MonthTotals.EMPTY : rows.get(0);
    }

    public record DailyRow(LocalDate day, String billingClass, int emails, int units) {
    }

    public List<DailyRow> daily(String instituteId, LocalDate from, LocalDate to) {
        return jdbc.query("""
                SELECT usage_date, billing_class, emails, units FROM email_usage_daily
                WHERE institute_id = ? AND usage_date BETWEEN ? AND ?
                ORDER BY usage_date, billing_class
                """, (rs, i) -> new DailyRow(rs.getDate(1).toLocalDate(), rs.getString(2), rs.getInt(3), rs.getInt(4)),
                instituteId, Date.valueOf(from), Date.valueOf(to));
    }
}
