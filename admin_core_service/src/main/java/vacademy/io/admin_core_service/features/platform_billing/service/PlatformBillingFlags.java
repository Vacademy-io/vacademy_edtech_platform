package vacademy.io.admin_core_service.features.platform_billing.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Reads the platform-billing switches from {@code ai_platform_settings} (written by the
 * super-admin portal through ai_service's SETTING_SPECS).
 *
 * <p>Every switch here is <b>off unless explicitly true</b>: an absent row, an unreadable table
 * or any value other than {@code true} reads as false, so a fresh deploy behaves exactly as
 * before. Values are cached for 30 seconds per key.
 */
@Slf4j
@Component
public class PlatformBillingFlags {

    /** New 16-character financial-year invoice series (VT/2627/I00042). Subscriptions always use it. */
    public static final String INVOICE_SERIES_V2 = "billing.invoice.series_v2.enabled";

    /** Credit packs: refuse an order without the buyer's GST state (subscriptions always require it). */
    public static final String BUYER_STATE_REQUIRED = "billing.buyer_state.required";

    /** Hourly reconcile of unpaid credit-pack payment links (lost webhooks, expired links). */
    public static final String PACK_RECONCILE = "billing.packs.reconcile.enabled";

    static final String SELECT_SETTING =
            "SELECT CAST(setting_value AS text) FROM ai_platform_settings WHERE setting_key = ?";

    private static final long TTL_MILLIS = 30_000L;

    private final JdbcTemplate jdbcTemplate;
    private final Map<String, long[]> cache = new ConcurrentHashMap<>();

    public PlatformBillingFlags(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public boolean invoiceSeriesV2Enabled() {
        return isTrue(INVOICE_SERIES_V2);
    }

    public boolean buyerStateRequiredForPacks() {
        return isTrue(BUYER_STATE_REQUIRED);
    }

    public boolean packReconcileEnabled() {
        return isTrue(PACK_RECONCILE);
    }

    /** True only when the setting exists and is literally true ({@code true} or {@code "true"}). */
    public boolean isTrue(String key) {
        long now = System.currentTimeMillis();
        long[] hit = cache.get(key);
        if (hit != null && hit[0] > now) {
            return hit[1] == 1L;
        }
        boolean value = read(key);
        cache.put(key, new long[] { now + TTL_MILLIS, value ? 1L : 0L });
        return value;
    }

    /** Drops the cache (tests, or after a portal write). */
    public void invalidate() {
        cache.clear();
    }

    private boolean read(String key) {
        try {
            List<String> rows = jdbcTemplate.queryForList(SELECT_SETTING, String.class, key);
            return !rows.isEmpty() && parseTrue(rows.get(0));
        } catch (Exception e) {
            log.debug("[platform-billing] could not read {}: {}", key, e.getMessage());
            return false;
        }
    }

    static boolean parseTrue(String raw) {
        if (raw == null) {
            return false;
        }
        String v = raw.trim();
        if (v.length() >= 2 && v.startsWith("\"") && v.endsWith("\"")) {
            v = v.substring(1, v.length() - 1).trim();
        }
        return "true".equalsIgnoreCase(v);
    }
}
