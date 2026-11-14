package vacademy.io.notification_service.features.email_billing;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import vacademy.io.notification_service.service.EmailService;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;

/** Reads and actions behind {@link EmailBillingController}. */
@Service
@RequiredArgsConstructor
@Slf4j
public class EmailBillingService {

    private static final int RESEND_LIMIT = 200;

    private final EmailBillingSettings settings;
    private final EmailBillingGate gate;
    private final EmailUsageStore usageStore;
    private final BlockedEmailStore blockedStore;
    private final CreditLedgerClient ledger;
    private final EmailService emailService;
    private final JdbcTemplate jdbc;

    public record DayUsage(LocalDate date, int emails, int units, int chargeableUnits) {
    }

    public record ClassUsage(int emails, int units) {
    }

    public record UsageSummary(
            String month,
            long freeUnitsPerMonth,
            long freeUnitsUsed,
            long freeUnitsRemaining,
            long chargeableUnits,
            long unitsBeyondFree,
            BigDecimal creditsPerUnit,
            BigDecimal chargedCredits,
            BigDecimal pendingCredits,
            BigDecimal balance,
            BigDecimal availableCredits,
            boolean enforced,
            boolean exempt,
            long blockedCount,
            Map<String, ClassUsage> byClass,
            List<DayUsage> daily,
            Map<String, Long> delivery) {
    }

    public record ResendResult(int resent, int skipped, int stillBlocked, String message) {
    }

    public UsageSummary usage(String instituteId, String monthParam) {
        YearMonth ym = parseMonth(monthParam);
        String month = ym.toString();
        EmailBillingSettings.Snapshot s = settings.get();
        boolean exempt = s.isExempt(instituteId);
        EmailUsageStore.MonthTotals totals = usageStore.monthTotals(instituteId, month);
        long free = s.freeUnitsPerMonth();
        long beyond = Math.max(0, totals.chargeableUnits() - free);
        BigDecimal pending = exempt ? BigDecimal.ZERO
                : EmailBillingGate.credits(Math.max(0, beyond - totals.chargedUnits()), s.creditsPerUnit());

        boolean current = month.equals(EmailBillingSettings.currentMonth());
        if (current) {
            ledger.forget(instituteId); // an admin looking at usage should see the latest balance
        }
        BigDecimal balance = current ? ledger.balance(instituteId).orElse(null) : null;
        BigDecimal available = balance == null ? null : balance.subtract(pending);

        Map<String, ClassUsage> byClass = new LinkedHashMap<>();
        Map<LocalDate, int[]> days = new TreeMap<>();
        for (EmailUsageStore.DailyRow r : usageStore.daily(instituteId, ym.atDay(1), ym.atEndOfMonth())) {
            ClassUsage prev = byClass.getOrDefault(r.billingClass(), new ClassUsage(0, 0));
            byClass.put(r.billingClass(), new ClassUsage(prev.emails() + r.emails(), prev.units() + r.units()));
            int[] d = days.computeIfAbsent(r.day(), k -> new int[3]);
            d[0] += r.emails();
            d[1] += r.units();
            if (EmailBillingClass.valueOf(r.billingClass()).chargeable()) {
                d[2] += r.units();
            }
        }
        List<DayUsage> daily = new ArrayList<>();
        days.forEach((day, d) -> daily.add(new DayUsage(day, d[0], d[1], d[2])));

        return new UsageSummary(month, free, Math.min(free, totals.chargeableUnits()),
                Math.max(0, free - totals.chargeableUnits()), totals.chargeableUnits(), beyond, s.creditsPerUnit(),
                totals.chargedCredits(), pending, balance, available, s.enforce() && !exempt, exempt,
                blockedStore.count(instituteId, "BLOCKED"), byClass, daily, delivery(instituteId, ym));
    }

    /** SES events received this month for the institute's email, by type (SEND, DELIVERY, OPEN, ...). */
    private Map<String, Long> delivery(String instituteId, YearMonth ym) {
        Map<String, Long> out = new LinkedHashMap<>();
        try {
            Timestamp from = Timestamp.from(ym.atDay(1).atStartOfDay(EmailBillingSettings.ZONE).toInstant());
            Timestamp to = Timestamp.from(ym.plusMonths(1).atDay(1).atStartOfDay(EmailBillingSettings.ZONE).toInstant());
            jdbc.query("""
                    SELECT upper(split_part(split_part(body, E'\\n', 1), ': ', 2)) AS event_type, count(*)
                    FROM notification_log
                    WHERE institute_id = ? AND notification_type = 'EMAIL_EVENT'
                      AND notification_date >= ? AND notification_date < ?
                    GROUP BY 1
                    """, rs -> {
                String type = rs.getString(1);
                if (type != null && !type.isBlank()) {
                    out.put(type.trim(), rs.getLong(2));
                }
            }, instituteId, from, to);
        } catch (Exception e) {
            log.warn("Email delivery stats for institute {} unavailable: {}", instituteId, e.getMessage());
        }
        return out;
    }

    public EmailBillingGate.Estimate estimate(String instituteId, String billingClass, int recipients, int copies,
            long attachmentBytes) {
        EmailBillingClass cls = EmailBillingClass.parse(billingClass);
        if (cls == null) {
            cls = EmailBillingClass.BILLABLE;
        }
        long perEmail = EmailUnits.ofCount(copies, attachmentBytes);
        long units = perEmail * Math.max(0, recipients);
        return gate.estimate(instituteId, cls, (int) Math.min(units, Integer.MAX_VALUE));
    }

    public Map<String, Object> blocked(String instituteId, int page, int size) {
        int limit = Math.min(Math.max(size, 1), 200);
        List<Map<String, Object>> rows = new ArrayList<>();
        for (BlockedEmailStore.BlockedEmail b : blockedStore.list(instituteId, "BLOCKED", limit, Math.max(page, 0) * limit)) {
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("id", b.id());
            r.put("to", b.toEmail());
            r.put("subject", b.subject());
            r.put("units", b.units());
            r.put("hasAttachments", !b.attachments().isEmpty() || b.attachmentsDropped());
            r.put("attachmentsTooLargeToKeep", b.attachmentsDropped());
            r.put("createdAt", b.createdAt());
            rows.add(r);
        }
        return Map.of("total", blockedStore.count(instituteId, "BLOCKED"), "page", Math.max(page, 0),
                "size", limit, "items", rows);
    }

    /** Resends the given held-back emails (all of them, up to 200, when none are given) while credits allow. */
    public ResendResult resend(String instituteId, List<String> ids) {
        List<BlockedEmailStore.BlockedEmail> todo = new ArrayList<>();
        if (ids == null || ids.isEmpty()) {
            todo.addAll(blockedStore.list(instituteId, "BLOCKED", RESEND_LIMIT, 0));
        } else {
            for (String id : ids.stream().distinct().limit(RESEND_LIMIT).toList()) {
                blockedStore.find(instituteId, id).filter(b -> "BLOCKED".equals(b.status())).ifPresent(todo::add);
            }
        }
        int resent = 0;
        int skipped = 0;
        int stillBlocked = 0;
        for (int i = 0; i < todo.size(); i++) {
            BlockedEmailStore.BlockedEmail b = todo.get(i);
            if (b.attachmentsDropped()) {
                skipped++;
                continue;
            }
            // Checked first so a resend never goes straight back into the blocked list.
            if (!gate.allows(instituteId, EmailBillingClass.BILLABLE, b.units())) {
                stillBlocked += todo.size() - i;
                break;
            }
            EmailService.SendOutcome outcome = b.attachments().isEmpty()
                    ? emailService.sendHtmlEmail(b.toEmail(), b.subject(), b.logSource(), b.body(), instituteId,
                            b.fromEmail(), b.fromName(), b.emailType(), null, b.userId(), b.cc(), b.ccMode(),
                            EmailBillingClass.BILLABLE)
                    : emailService.sendAttachmentEmail(b.toEmail(), b.subject(), b.logSource(), b.body(),
                            b.attachments(), instituteId, b.emailType(), b.cc(), b.ccMode(), EmailBillingClass.BILLABLE);
            switch (outcome) {
                case SENT, DEFERRED -> {
                    blockedStore.resolve(instituteId, b.id(), "RESENT");
                    resent++;
                }
                // Blocked again in a race: EmailService kept a fresh copy, so this one is closed.
                case SKIPPED_NO_CREDITS -> {
                    blockedStore.resolve(instituteId, b.id(), "DISCARDED");
                    stillBlocked++;
                }
                default -> {
                    blockedStore.resolve(instituteId, b.id(), "DISCARDED");
                    skipped++;
                }
            }
        }
        String message = stillBlocked > 0
                ? "Credits ran out after " + resent + " email(s). Add credits to resend the rest."
                : resent + " email(s) resent.";
        return new ResendResult(resent, skipped, stillBlocked, message);
    }

    public int discard(String instituteId, List<String> ids) {
        int n = 0;
        for (String id : ids == null ? List.<String>of() : ids.stream().distinct().limit(1000).toList()) {
            if (blockedStore.resolve(instituteId, id, "DISCARDED")) {
                n++;
            }
        }
        return n;
    }

    static YearMonth parseMonth(String month) {
        if (month == null || month.isBlank()) {
            return YearMonth.now(EmailBillingSettings.ZONE);
        }
        try {
            return YearMonth.parse(month.trim().toUpperCase(Locale.ROOT));
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_MONTH");
        }
    }
}
