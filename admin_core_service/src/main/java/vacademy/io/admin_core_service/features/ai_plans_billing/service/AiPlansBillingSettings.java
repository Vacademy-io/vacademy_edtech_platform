package vacademy.io.admin_core_service.features.ai_plans_billing.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.platform_billing.service.PlatformBillingFlags;

import java.util.List;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicReference;

/**
 * The AI-plan billing switches (ai_platform_settings, global, written by the portal). All are dark
 * by default: an absent row, an unreadable table or any value that is not literally true reads as
 * off, and an unknown storefront mode reads as OFF.
 *
 * <ul>
 *   <li>{@value #PAYMENTS_ENABLED}: checkout, links, debits and the billing job.</li>
 *   <li>{@value #AUTOPAY_ENABLED}: mandate registration and scheduled debits (needs payments too).</li>
 *   <li>{@value #STOREFRONT_MODE}: OFF | ALLOWLIST | SEGMENTS | ALL.</li>
 *   <li>{@value PlatformBillingFlags#INVOICE_SERIES_V2}: subscriptions refuse checkout without it.</li>
 * </ul>
 */
@Slf4j
@Component
public class AiPlansBillingSettings {

    public static final String PAYMENTS_ENABLED = "billing.subscriptions.payments.enabled";
    public static final String AUTOPAY_ENABLED = "billing.autopay.enabled";
    public static final String STOREFRONT_MODE = "billing.storefront.mode";

    public enum StorefrontMode { OFF, ALLOWLIST, SEGMENTS, ALL }

    static final String SELECT_SETTING =
            "SELECT CAST(setting_value AS text) FROM ai_platform_settings WHERE setting_key = ?";
    private static final long TTL_MILLIS = 30_000L;

    private final PlatformBillingFlags flags;
    private final JdbcTemplate jdbcTemplate;
    private final AtomicReference<Object[]> modeCache = new AtomicReference<>();

    public AiPlansBillingSettings(PlatformBillingFlags flags, JdbcTemplate jdbcTemplate) {
        this.flags = flags;
        this.jdbcTemplate = jdbcTemplate;
    }

    public boolean paymentsEnabled() {
        return flags.isTrue(PAYMENTS_ENABLED);
    }

    /** Autopay needs payments on as well. */
    public boolean autopayEnabled() {
        return paymentsEnabled() && flags.isTrue(AUTOPAY_ENABLED);
    }

    public boolean invoiceSeriesV2Enabled() {
        return flags.invoiceSeriesV2Enabled();
    }

    public StorefrontMode storefrontMode() {
        long now = System.currentTimeMillis();
        Object[] hit = modeCache.get();
        if (hit != null && (long) hit[0] > now) {
            return (StorefrontMode) hit[1];
        }
        StorefrontMode mode = readMode();
        modeCache.set(new Object[] { now + TTL_MILLIS, mode });
        return mode;
    }

    public void invalidate() {
        modeCache.set(null);
        flags.invalidate();
    }

    private StorefrontMode readMode() {
        try {
            List<String> rows = jdbcTemplate.queryForList(SELECT_SETTING, String.class, STOREFRONT_MODE);
            return rows.isEmpty() ? StorefrontMode.OFF : parseMode(rows.get(0));
        } catch (Exception e) {
            log.debug("[ai-plans-billing] could not read {}: {}", STOREFRONT_MODE, e.getMessage());
            return StorefrontMode.OFF;
        }
    }

    static StorefrontMode parseMode(String raw) {
        if (raw == null) {
            return StorefrontMode.OFF;
        }
        String v = raw.trim();
        if (v.length() >= 2 && v.startsWith("\"") && v.endsWith("\"")) {
            v = v.substring(1, v.length() - 1).trim();
        }
        try {
            return StorefrontMode.valueOf(v.toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            return StorefrontMode.OFF;
        }
    }
}
