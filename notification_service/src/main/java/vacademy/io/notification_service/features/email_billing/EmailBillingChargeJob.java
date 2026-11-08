package vacademy.io.notification_service.features.email_billing;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

/**
 * Moves email usage onto the credit ledger, once an hour.
 *
 * <p>Per institute and month it charges the units beyond the free allowance not yet charged, as
 * one ledger row. Each charge is first written to email_billing_charge (and the month's
 * charged_units advanced) in the same transaction, then sent with that row's idempotency key, so a
 * crash or retry can never charge the same units twice. Unsent rows are retried on the next run.
 *
 * <p>Exempt institutes have their units marked charged without any ledger row, so lifting an
 * exemption never back-charges them.
 *
 * <p>One pod runs it at a time: a transaction-scoped advisory lock (pgbouncer runs in transaction
 * mode, where a session lock would leak).
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class EmailBillingChargeJob {

    static final long LOCK_KEY = 0x454D41494C42494CL; // "EMAILBIL"

    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;
    private final EmailBillingSettings settings;
    private final CreditLedgerClient ledger;
    private final EmailBillingNotifier notifier;

    private record MonthRow(String instituteId, String month, long chargeable, long charged) {
    }

    private record ChargeRow(String id, String instituteId, String month, long fromUnit, long toUnit,
            BigDecimal credits, String key) {
    }

    @Scheduled(fixedDelayString = "${email.billing.charge.interval.ms:3600000}", initialDelay = 120000)
    public void run() {
        EmailBillingSettings.Snapshot s = settings.get();
        if (s.charge()) {
            List<ChargeRow> created = tx.execute(status -> {
                Boolean locked = jdbc.queryForObject("SELECT pg_try_advisory_xact_lock(?)", Boolean.class, LOCK_KEY);
                return Boolean.TRUE.equals(locked) ? createCharges(s) : null;
            });
            if (created == null) {
                log.info("Email billing charge run skipped: another pod holds the lock");
                return;
            }
            sendPending();
        }
        if (s.notifyEnabled()) {
            notifier.sendAllowanceNotices(s);
        }
    }

    /** Inside the locked transaction: one PENDING charge row per institute-month with new usage. */
    private List<ChargeRow> createCharges(EmailBillingSettings.Snapshot s) {
        String current = EmailBillingSettings.currentMonth();
        String previous = EmailBillingSettings.month(EmailBillingSettings.today().minusMonths(1));
        long free = s.freeUnitsPerMonth();
        List<MonthRow> due = jdbc.query("""
                SELECT institute_id, period_month, chargeable_units, charged_units FROM email_billing_month
                WHERE period_month IN (?, ?) AND chargeable_units - ? > charged_units
                FOR UPDATE
                """, (rs, i) -> new MonthRow(rs.getString(1), rs.getString(2), rs.getLong(3), rs.getLong(4)),
                current, previous, free);
        List<ChargeRow> created = new java.util.ArrayList<>();
        for (MonthRow m : due) {
            long to = m.chargeable() - free;
            long from = m.charged();
            if (s.isExempt(m.instituteId())) {
                jdbc.update("UPDATE email_billing_month SET charged_units = ?, updated_at = CURRENT_TIMESTAMP "
                        + "WHERE institute_id = ? AND period_month = ?", to, m.instituteId(), m.month());
                continue;
            }
            BigDecimal credits = EmailBillingGate.credits(to - from, s.creditsPerUnit());
            if (credits.signum() <= 0) {
                continue;
            }
            ChargeRow c = new ChargeRow(UUID.randomUUID().toString(), m.instituteId(), m.month(), from, to, credits,
                    "email:" + m.instituteId() + ":" + m.month() + ":" + from + "-" + to);
            jdbc.update("""
                    INSERT INTO email_billing_charge (id, institute_id, period_month, from_unit, to_unit, credits,
                        status, idempotency_key)
                    VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?)
                    """, c.id(), c.instituteId(), c.month(), c.fromUnit(), c.toUnit(), c.credits(), c.key());
            jdbc.update("""
                    UPDATE email_billing_month SET charged_units = ?, charged_credits = charged_credits + ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE institute_id = ? AND period_month = ?
                    """, to, credits, m.instituteId(), m.month());
            created.add(c);
        }
        if (!created.isEmpty()) {
            log.info("Email billing: {} new charge(s) recorded", created.size());
        }
        return created;
    }

    /** Sends every PENDING charge (new and earlier failures) to the ledger. */
    private void sendPending() {
        List<ChargeRow> pending = jdbc.query("""
                SELECT id, institute_id, period_month, from_unit, to_unit, credits, idempotency_key
                FROM email_billing_charge WHERE status = 'PENDING' ORDER BY created_at LIMIT 500
                """, (rs, i) -> new ChargeRow(rs.getString(1), rs.getString(2), rs.getString(3), rs.getLong(4),
                rs.getLong(5), rs.getBigDecimal(6), rs.getString(7)));
        for (ChargeRow c : pending) {
            boolean ok = ledger.charge(c.instituteId(), c.credits(), c.toUnit() - c.fromUnit(), c.month(), c.key());
            if (ok) {
                jdbc.update("UPDATE email_billing_charge SET status = 'CHARGED', charged_at = CURRENT_TIMESTAMP, "
                        + "attempts = attempts + 1, last_error = NULL WHERE id = ?", c.id());
            } else {
                jdbc.update("UPDATE email_billing_charge SET attempts = attempts + 1, last_error = ? WHERE id = ?",
                        "ledger did not confirm", c.id());
                log.warn("Email billing charge {} ({} credits) not confirmed; will retry", c.key(), c.credits());
            }
        }
    }
}
