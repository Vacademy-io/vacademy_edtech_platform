package vacademy.io.notification_service.features.email_sending_controls.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.sql.Date;
import java.time.LocalDate;
import java.util.List;

/**
 * Atomic per-sender daily counter. {@link #tryReserve} increments only while the
 * counter is below the cap, in one statement, so concurrent dispatch threads (and
 * multiple pods) can never over-send. A reserved slot is consumed even if the
 * SMTP send later fails — conservative on purpose for warm-up.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class EmailDailyQuotaService {

    private final JdbcTemplate jdbc;

    private static final String RESERVE = """
            INSERT INTO email_daily_quota (sender_key, quota_date, sent, updated_at)
            VALUES (?, ?, 1, CURRENT_TIMESTAMP)
            ON CONFLICT (sender_key, quota_date) DO UPDATE
                SET sent = email_daily_quota.sent + 1, updated_at = CURRENT_TIMESTAMP
                WHERE email_daily_quota.sent < ?
            RETURNING sent
            """;

    /** @return true if a slot was reserved for today; false if the cap is already reached. */
    public boolean tryReserve(String senderKey, LocalDate day, int maxPerDay) {
        if (maxPerDay <= 0) return true;
        List<Integer> rows = jdbc.query(RESERVE, (rs, i) -> rs.getInt(1), senderKey, Date.valueOf(day), maxPerDay);
        boolean ok = !rows.isEmpty();
        if (!ok) log.info("Daily cap reached for sender {} on {} (max {})", senderKey, day, maxPerDay);
        return ok;
    }

    public int sentToday(String senderKey, LocalDate day) {
        List<Integer> rows = jdbc.query("SELECT sent FROM email_daily_quota WHERE sender_key = ? AND quota_date = ?",
                (rs, i) -> rs.getInt(1), senderKey, Date.valueOf(day));
        return rows.isEmpty() ? 0 : rows.get(0);
    }
}
