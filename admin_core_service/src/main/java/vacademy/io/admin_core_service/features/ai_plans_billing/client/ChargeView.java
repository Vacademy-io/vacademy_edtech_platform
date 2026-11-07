package vacademy.io.admin_core_service.features.ai_plans_billing.client;

import vacademy.io.admin_core_service.features.ai_plans_billing.client.AiPlansInternalClient.Json;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.Map;

/**
 * One {@code ai_subscription_charge} as ai_service reports it (GET /charges, checkout, change).
 * Parsed tolerantly: unknown fields are ignored, and a few context fields (plan name, institute,
 * subscription status, grace end) may sit on the charge or in a nested {@code subscription} /
 * {@code plan} object.
 *
 * <p>Status: DUE | LINK_SENT | DEBIT_SCHEDULED | PAID | FAILED | VOID | WAIVED | REFUNDED |
 * PARTIALLY_REFUNDED. Kind: PERIOD | UPGRADE.
 */
public record ChargeView(
        String id,
        String subscriptionId,
        String instituteId,
        String kind,
        String status,
        Instant serviceStart,
        Instant serviceEnd,
        String planVersionId,
        String currency,
        boolean taxInclusive,
        String sacCode,
        String description,
        long baseMinor,
        Long taxMinor,
        Long totalMinor,
        /** The list price for a tax-inclusive version (else null): base/tax are derived from it. */
        Long listPriceMinor,
        String platformPaymentId,
        String vendorPaymentId,
        String paymentLinkId,
        String paymentLinkUrl,
        Instant linkExpiresAt,
        String mandateId,
        int debitAttempts,
        Instant nextAttemptAt,
        Instant preDebitNoticeSentAt,
        String subscriptionStatus,
        String planKey,
        String planName,
        Instant graceUntil,
        Integer graceDays) {

    public static final String KIND_PERIOD = "PERIOD";
    public static final String KIND_UPGRADE = "UPGRADE";

    public boolean isUpgrade() {
        return KIND_UPGRADE.equalsIgnoreCase(kind);
    }

    /** The first charge of a checkout: the subscription is still PENDING (never live). */
    public boolean isFirstPurchase() {
        return "PENDING".equalsIgnoreCase(subscriptionStatus);
    }

    public boolean isOpen() {
        return "DUE".equalsIgnoreCase(status) || "LINK_SENT".equalsIgnoreCase(status)
                || "DEBIT_SCHEDULED".equalsIgnoreCase(status) || "FAILED".equalsIgnoreCase(status);
    }

    public boolean isPaid() {
        return "PAID".equalsIgnoreCase(status);
    }

    /** End of the grace window: ai_service's value, else service_start + grace_days (default 7). */
    public Instant graceEnd() {
        if (graceUntil != null) {
            return graceUntil;
        }
        if (serviceStart == null) {
            return null;
        }
        int days = graceDays == null ? 7 : Math.max(0, graceDays);
        return serviceStart.plusSeconds(days * 86_400L);
    }

    public static ChargeView from(Map<String, Object> m) {
        if (m == null) {
            return null;
        }
        Map<String, Object> sub = Json.map(m, "subscription");
        Map<String, Object> plan = Json.map(m, "plan");
        String id = Json.str(m, "id", "charge_id");
        if (id == null) {
            return null;
        }
        Long debit = Json.lng(m, "debit_attempts");
        Long graceDays = Json.lng(m, "grace_days");
        if (graceDays == null) {
            graceDays = Json.lng(sub, "grace_days");
        }
        return new ChargeView(
                id,
                first(Json.str(m, "subscription_id"), Json.str(sub, "id")),
                first(Json.str(m, "institute_id"), Json.str(sub, "institute_id")),
                first(Json.str(m, "kind"), KIND_PERIOD),
                Json.str(m, "status"),
                instant(Json.raw(m, "service_start")),
                instant(Json.raw(m, "service_end")),
                Json.str(m, "plan_version_id"),
                first(Json.str(m, "currency"), "INR"),
                Json.bool(m, "is_tax_inclusive"),
                Json.str(m, "sac_code"),
                Json.str(m, "description"),
                orZero(Json.lng(m, "base_minor")),
                Json.lng(m, "tax_minor"),
                Json.lng(m, "total_minor"),
                Json.lng(m, "list_price_minor", "price_minor"),
                Json.str(m, "platform_payment_id"),
                Json.str(m, "vendor_payment_id"),
                Json.str(m, "payment_link_id"),
                Json.str(m, "payment_link_url"),
                instant(Json.raw(m, "link_expires_at")),
                Json.str(m, "mandate_id"),
                debit == null ? 0 : debit.intValue(),
                instant(Json.raw(m, "next_attempt_at")),
                instant(Json.raw(m, "pre_debit_notice_sent_at")),
                first(Json.str(m, "subscription_status"), Json.str(sub, "status")),
                first(Json.str(m, "plan_key"), Json.str(plan, "plan_key", "key")),
                first(Json.str(m, "plan_name"), Json.str(plan, "name")),
                instant(first(Json.raw(m, "grace_until"), Json.raw(sub, "grace_until"))),
                graceDays == null ? null : graceDays.intValue());
    }

    private static long orZero(Long v) {
        return v == null ? 0L : v;
    }

    @SafeVarargs
    private static <T> T first(T... values) {
        for (T v : values) {
            if (v != null) {
                return v;
            }
        }
        return null;
    }

    /** ISO-8601 with offset, a bare ISO instant, or epoch seconds. */
    public static Instant instant(Object v) {
        if (v == null) {
            return null;
        }
        if (v instanceof Number n) {
            return Instant.ofEpochSecond(n.longValue());
        }
        String s = v.toString().trim();
        if (s.isEmpty()) {
            return null;
        }
        try {
            return OffsetDateTime.parse(s).toInstant();
        } catch (DateTimeParseException e) {
            try {
                return Instant.parse(s);
            } catch (DateTimeParseException e2) {
                try {
                    // naive timestamp: treat as UTC
                    return java.time.LocalDateTime.parse(s).toInstant(java.time.ZoneOffset.UTC);
                } catch (DateTimeParseException e3) {
                    return null;
                }
            }
        }
    }
}
