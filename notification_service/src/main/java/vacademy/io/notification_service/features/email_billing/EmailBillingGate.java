package vacademy.io.notification_service.features.email_billing;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Optional;

/**
 * Decides whether a BILLABLE email may go out, and estimates what a send will cost.
 *
 * <p>An email may go when the institute still has free allowance this month, or its wallet,
 * less what it has used but not yet been charged for, is above zero. FREE and ESSENTIAL mail is
 * never stopped, nor is anything while enforcement is off or the institute is exempt.
 *
 * <p>Fails open: if the balance cannot be read, the email goes. An outage of the credit service
 * must not stop an institute's mail.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class EmailBillingGate {

    private final EmailBillingSettings settings;
    private final EmailUsageStore usageStore;
    private final CreditLedgerClient ledger;

    /** What a send of {@code units} would cost the institute right now. */
    public record Estimate(
            String billingClass,
            int units,
            long freeUnitsPerMonth,
            long freeUnitsRemaining,
            long chargeableUnits,
            BigDecimal credits,
            BigDecimal creditsPerUnit,
            BigDecimal balance,            // null when unknown
            BigDecimal pendingCredits,     // used this month, not yet on the ledger
            BigDecimal availableCredits,   // balance - pending; null when unknown
            boolean enforced,              // false: nothing is blocked for this institute/class
            boolean allowed) {
    }

    /** True when mail of this class can be stopped for this institute right now (enforcement on, not exempt). */
    public boolean enforcedFor(String instituteId, EmailBillingClass cls) {
        EmailBillingSettings.Snapshot s = settings.get();
        return s.enforce() && cls != null && cls.blockable() && !s.isExempt(instituteId);
    }

    /** True when this one email may be sent. */
    public boolean allows(String instituteId, EmailBillingClass cls, int units) {
        EmailBillingSettings.Snapshot s = settings.get();
        if (!s.enforce() || cls == null || !cls.blockable() || s.isExempt(instituteId)) {
            return true;
        }
        return estimate(instituteId, cls, units, s, false).allowed();
    }

    /** For display before a send: always includes the wallet balance. */
    public Estimate estimate(String instituteId, EmailBillingClass cls, int units) {
        return estimate(instituteId, cls, units, settings.get(), true);
    }

    private Estimate estimate(String instituteId, EmailBillingClass cls, int units, EmailBillingSettings.Snapshot s,
            boolean showBalance) {
        units = Math.max(0, units);
        BigDecimal rate = s.creditsPerUnit();
        boolean chargeable = cls != null && cls.chargeable() && !s.isExempt(instituteId);
        boolean enforced = s.enforce() && cls != null && cls.blockable() && !s.isExempt(instituteId);

        EmailUsageStore.MonthTotals month = usageStore.monthTotals(instituteId, EmailBillingSettings.currentMonth());
        long free = s.freeUnitsPerMonth();
        long freeRemaining = Math.max(0, free - month.chargeableUnits());
        long beyondFreeSoFar = Math.max(0, month.chargeableUnits() - free);
        long pendingUnits = Math.max(0, beyondFreeSoFar - month.chargedUnits());
        BigDecimal pendingCredits = credits(pendingUnits, rate);

        long chargeableUnits = chargeable ? Math.max(0, units - freeRemaining) : 0;
        BigDecimal cost = credits(chargeableUnits, rate);

        // The wallet is only asked when credits are needed (or shown): a send inside the free
        // allowance makes no call to admin-core.
        Optional<BigDecimal> balance = (enforced && chargeableUnits > 0) || (showBalance && chargeable)
                ? ledger.balance(instituteId) : Optional.empty();
        BigDecimal available = balance.map(b -> b.subtract(pendingCredits)).orElse(null);

        boolean allowed;
        if (!enforced || chargeableUnits == 0) {
            allowed = true;
        } else if (available == null) {
            log.warn("Email billing: balance unknown for institute {}, letting {} unit(s) through", instituteId, units);
            allowed = true;
        } else {
            // One email may take the wallet just below zero; a batch needs enough for all of it.
            allowed = units <= 1 ? available.signum() > 0 : available.compareTo(cost) >= 0;
        }
        return new Estimate(cls == null ? null : cls.name(), units, free, freeRemaining, chargeableUnits, cost, rate,
                balance.orElse(null), pendingCredits, available, enforced, allowed);
    }

    static BigDecimal credits(long units, BigDecimal rate) {
        return rate.multiply(BigDecimal.valueOf(units)).setScale(2, RoundingMode.HALF_UP);
    }
}
