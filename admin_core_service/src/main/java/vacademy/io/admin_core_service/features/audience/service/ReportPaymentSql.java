package vacademy.io.admin_core_service.features.audience.service;

/**
 * Which day a payment counts on in the money reports.
 *
 * <p>A payment an admin records by hand (MANUAL / OFFLINE) counts on the transaction date typed into
 * the form ({@code payment_log.date}), not on the day it was entered: front offices often record a
 * week of bank transfers at once, and the money belongs to the month it reached the bank. The typed
 * date is trusted only when it is on or before the entry day and less than a year before it, so a
 * typo (year 0026) falls back to the entry day. When the admin leaves the date blank the server
 * stores the institute's own today ({@code PaymentDateDefaults}), so an untyped date is the entry
 * day too. Gateway payments (Razorpay ...) keep the entry
 * timestamp: their {@code date} is the UTC day, which is a day early for evening IST payments.
 *
 * <p>Needs the {@code :tz}, {@code :fromTs} and {@code :toTs} binds. The window stays in UTC
 * wall-clock like every other report bound; the institute-TZ days are derived from it in SQL.
 *
 * <p>Both fragments start and end with a space: callers splice them right after a text-block line
 * ending in {@code AND } or {@code , }, and a text block drops that trailing space.
 */
final class ReportPaymentSql {

    private ReportPaymentSql() {
    }

    /** Institute-TZ calendar day the payment {@code alias} counts on. */
    static String paymentDay(String alias) {
        String entryDay = "(" + alias + ".created_at AT TIME ZONE 'UTC' AT TIME ZONE :tz)::date";
        return " " + """
                (CASE WHEN %1$s.vendor IN ('MANUAL', 'OFFLINE')
                           AND %1$s.date IS NOT NULL
                           AND %1$s.date <= %2$s
                           AND %1$s.date > %2$s - 366
                      THEN %1$s.date
                      ELSE %2$s END)""".formatted(alias, entryDay) + " ";
    }

    /**
     * Payment {@code alias} counts inside the [fromTs, toTs) window. The created_at bounds are implied
     * by {@link #paymentDay} (a payment counts on or before the day it was entered, and at most 365
     * days before it) and keep the (user_id, created_at) index usable, so a past window does not
     * scan every later payment.
     */
    static String inWindow(String alias) {
        String day = paymentDay(alias);
        return " " + alias + ".created_at >= :fromTs"
                + " AND " + alias + ".created_at < CAST(:toTs AS timestamp) + INTERVAL '367 days'"
                + " AND " + day + " >= (CAST(:fromTs AS timestamp) AT TIME ZONE 'UTC' AT TIME ZONE :tz)::date"
                + " AND " + day + " <  (CAST(:toTs AS timestamp) AT TIME ZONE 'UTC' AT TIME ZONE :tz)::date ";
    }
}
