package vacademy.io.notification_service.features.email_billing;

/**
 * How an outgoing email is treated by email billing.
 *
 * <ul>
 *   <li>{@link #FREE}: OTP, password reset, login credentials, our own mail to the institute.
 *       Never counted, charged or blocked.</li>
 *   <li>{@link #ESSENTIAL}: payment receipts and invoices. Counted and charged, never blocked —
 *       a learner who paid must get proof even when the institute is out of credits.</li>
 *   <li>{@link #BILLABLE}: everything else. Blocked once the free allowance and credits run out.</li>
 *   <li>{@link #EXCLUDED}: no institute (platform mail) or Engagement Engine mail, which admin-core
 *       already charges per message. Recorded for reconciliation only.</li>
 * </ul>
 */
public enum EmailBillingClass {
    FREE,
    ESSENTIAL,
    BILLABLE,
    EXCLUDED;

    /** Counts toward the monthly allowance and is charged beyond it. */
    public boolean chargeable() {
        return this == ESSENTIAL || this == BILLABLE;
    }

    /** May be stopped when the institute has no allowance and no credits left. */
    public boolean blockable() {
        return this == BILLABLE;
    }

    /** Parses a caller-supplied class; null or unknown means "decide from the source". */
    public static EmailBillingClass parse(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return EmailBillingClass.valueOf(value.trim().toUpperCase());
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}
