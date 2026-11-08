package vacademy.io.notification_service.features.email_billing;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * The email-billing switches (table email_billing_settings) and per-institute exemptions, read
 * with a one-minute cache so they can be flipped in the database without a redeploy.
 *
 * <p>If the settings cannot be read, everything is treated as OFF: a settings failure must never
 * start blocking or charging anyone.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class EmailBillingSettings {

    /** Months and days are counted in India time: the free allowance resets at IST midnight. */
    public static final ZoneId ZONE = ZoneId.of("Asia/Kolkata");
    private static final DateTimeFormatter MONTH = DateTimeFormatter.ofPattern("yyyy-MM");
    private static final long CACHE_MILLIS = 60_000;

    public record Snapshot(boolean enforce, boolean charge, boolean notifyEnabled, int freeUnitsPerMonth,
            BigDecimal creditsPerUnit, Set<String> exempt) {

        static final Snapshot OFF = new Snapshot(false, false, false, 1000, new BigDecimal("0.04"), Set.of());

        public boolean isExempt(String instituteId) {
            return instituteId != null && exempt.contains(instituteId);
        }
    }

    private final JdbcTemplate jdbc;

    private volatile Snapshot cached;
    private volatile long cachedAt;

    public Snapshot get() {
        Snapshot s = cached;
        if (s != null && System.currentTimeMillis() - cachedAt < CACHE_MILLIS) {
            return s;
        }
        try {
            List<Snapshot> rows = jdbc.query("""
                    SELECT enforce_enabled, charge_enabled, notify_enabled, free_units_per_month, credits_per_unit
                    FROM email_billing_settings WHERE id = 1
                    """, (rs, i) -> new Snapshot(rs.getBoolean(1), rs.getBoolean(2), rs.getBoolean(3),
                    rs.getInt(4), rs.getBigDecimal(5), Set.of()));
            Set<String> exempt = ConcurrentHashMap.newKeySet();
            exempt.addAll(jdbc.queryForList("""
                    SELECT institute_id FROM email_billing_exemption
                    WHERE until_date IS NULL OR until_date >= ?
                    """, String.class, java.sql.Date.valueOf(today())));
            Snapshot base = rows.isEmpty() ? Snapshot.OFF : rows.get(0);
            s = new Snapshot(base.enforce(), base.charge(), base.notifyEnabled(), base.freeUnitsPerMonth(),
                    base.creditsPerUnit(), Set.copyOf(exempt));
        } catch (Exception e) {
            log.warn("Email billing settings unreadable, treating billing as off: {}", e.getMessage());
            s = Snapshot.OFF;
        }
        cached = s;
        cachedAt = System.currentTimeMillis();
        return s;
    }

    public static LocalDate today() {
        return LocalDate.now(ZONE);
    }

    public static String month(LocalDate day) {
        return day.format(MONTH);
    }

    public static String currentMonth() {
        return month(today());
    }
}
